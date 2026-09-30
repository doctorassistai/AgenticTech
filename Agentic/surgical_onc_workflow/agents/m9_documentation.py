"""m9 — Documentation & Clinical Intelligence.

Structurally different from the other modules: it renders with DOC_COLUMNS —
  Document | Status | Last Generated | Completeness | Indication / Action
so each row reports a DOCUMENT TYPE's availability, not a clinical finding. The agent
fills parameter (=document name), status, lastGenerated, completeness, action; the
finding/reference fields are unused by this module's columns.

Each document type maps to the record block that would source it. 'completeness' =
Complete / Partial / Pending based on whether that source block is populated; the source
is auto-generated from the record, so 'lastGenerated' uses the relevant documented date
(consultation/surgery/approval/discharge date) — never a fabricated timestamp.

Sources (all read-only, active booking):
  - `booking`     : preOpDiagnosis, mdtComments, surgeryDate, created_at (consultation / MDT / timeline).
  - `pac` + `doctors_note` + `checklist` : pre-operative assessment.
  - `management`  : procedureDetails, findings, postOperativeDiagnosis (operative note).
  - `post_op`     : complications, description (post-op progress).
  - `discharge`   : courseInHospital, dischargeAdvice, dischargeDate (discharge summary).
  - `pathology_documents` : HPR correlation summary source.
  - `tumor_board` : the approved MDT / tumor-board plan (tumorBoardPlan), already normalized
                    in state — the REAL MDT summary artifact (planStatus, generatedAt,
                    mdtBasisSummary, approvals). Its mere presence => the MDT summary EXISTS.
"""

from typing import Any, Dict

from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from .base import BaseDashboardAgent, SYSTEM_PROMPT
from ..state import ModuleResult, ParameterRow


class DocumentationAgent(BaseDashboardAgent):
    MODULE_ID = "m9"
    TITLE = "Documentation & Clinical Intelligence"
    PARAMETERS = [
        "Surgical Consultation Summary",
        "Pre-operative Summary",
        "Operative Note Generator",
        "Post-operative Progress Summary",
        "Discharge Summary Generator",
        "Histopathology Correlation Summary",
        "MDT Summary Generator",
        "Clinical Timeline Generator",
        "Guideline Evidence Viewer",
        "Explainable AI Surgical Recommendation",
    ]

    # Document-lifecycle → pill-color tier. m9 is the one module with NO clinical
    # 'finding' — its signal is the document's Completeness/Status, not a finding — so it
    # colors the pill from completeness. (The base _snap_pill gates on 'finding', which m9
    # always leaves empty, and would therefore force EVERY pill to grey 'Not Available'.)
    _DOC_TIER = {
        "complete": "ok",       # green — document generated / final
        "partial": "watch",     # amber — drafted, some parts outstanding
        "pending": "neutral",   # grey  — not generated yet
    }
    # Fallback pill text per tier when the LLM didn't supply a document-state label.
    _DOC_LABEL = {"ok": "Ready", "watch": "Draft", "neutral": "Pending"}

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        pac = (active.get("anaesthesia") or {}).get("pac") or {}
        note = active.get("doctors_note") or {}
        checklist = active.get("checklist") or {}
        mgmt = active.get("management") or {}
        post_op = active.get("post_op") or {}
        discharge = active.get("discharge") or {}
        path_docs = state.get("pathology_documents") or []
        tumor_board = state.get("tumor_board") or {}

        # Presence flags + the documented date each document would carry.
        return {
            # consultation
            "has_consultation": bool(booking.get("preOpDiagnosis")),
            "consultationDate": active.get("created_at", ""),
            # pre-op assessment
            "has_preop": bool(pac.get("fitnessStatus") or note.get("asaStatus") or checklist),
            "approvalDate": pac.get("approvalDate", ""),
            # operative note
            "has_operative": bool(mgmt.get("procedureDetails") or mgmt.get("findings")),
            "surgeryDate": booking.get("surgeryDate", ""),
            # post-op progress
            "has_postop": bool(post_op.get("description") or post_op.get("complications")),
            # discharge summary
            "has_discharge": bool(discharge.get("courseInHospital") or discharge.get("dischargeAdvice")),
            "dischargeDate": discharge.get("dischargeDate", ""),
            # HPR correlation
            "has_pathology": bool(path_docs) or bool(mgmt.get("stagingT") or mgmt.get("resection")),
            "pathology_is_formal": bool(path_docs),
            # MDT — the REAL MDT summary is the approved tumor-board plan (tumorBoardPlan),
            # already in state as `tumor_board` (normalized). Its presence => the MDT summary
            # EXISTS (and usually carries a real `generatedAt` date). `has_mdt` (the surgeon's
            # free-text mdtComments) is only a weak secondary hint, NOT the artifact itself.
            "has_mdt_plan": bool(tumor_board),
            "mdtPlanStatus": tumor_board.get("planStatus", ""),
            "mdtGeneratedAt": tumor_board.get("generatedAt", ""),
            "has_mdt": bool(booking.get("mdtComments")),
            # timeline
            "created_at": active.get("created_at", ""),
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        return (
            f"MODULE: {self.TITLE}\n"
            "This module lists auto-generated CLINICAL DOCUMENTS. It renders with columns: "
            "Document | Status | Last Generated | Completeness | Indication/Action.\n"
            "For EACH document below, set: parameter=the exact document name; "
            "status (ok/watch/alert/flag/neutral); statusLabel (a short pill like 'Ready', 'Partial', "
            "'Pending'); lastGenerated (the relevant documented date from DATA, or '' if the source block "
            "is empty — NEVER invent a date); completeness (one of 'Complete', 'Partial', 'Pending'); "
            "action (a short next step, e.g. 'Generate discharge summary').\n"
            "Leave 'finding' and 'reference' empty ('') — this module does not use them.\n\n"
            "Return exactly one row for EACH of these documents, using these EXACT names:\n"
            f"{self.PARAMETERS}\n\n"
            "RULES:\n"
            "- Use ONLY the DATA. A document is 'Complete' only if its source block is populated; "
            "'Partial' if some source data exists but key parts are missing; 'Pending' if the source is empty.\n"
            "- If a source is present, status='ok' + statusLabel='Ready'. If partial, status='watch'. If the "
            "source is empty (document can't be generated yet), status='neutral', completeness='Pending', "
            "lastGenerated='', action names what's needed to generate it.\n"
            "- DATE-GATE (critical): a document may be marked 'Complete' (statusLabel='Ready', status='ok') ONLY "
            "if you can give it a REAL 'lastGenerated' date sourced from the DATA. If NO date is available for a "
            "document, it is NOT a finalised artifact — you MUST set completeness='Pending', status='neutral', "
            "statusLabel='Pending', lastGenerated='', and an action naming what's needed. NEVER output 'Complete' "
            "with an empty date.\n\n"
            "DOCUMENT -> SOURCE MAP (use the has_* flags and dates in DATA):\n"
            "- Surgical Consultation Summary: has_consultation / consultationDate.\n"
            "- Pre-operative Summary: has_preop / approvalDate.\n"
            "- Operative Note Generator: has_operative / surgeryDate.\n"
            "- Post-operative Progress Summary: has_postop (surgeryDate as ref date).\n"
            "- Discharge Summary Generator: has_discharge / dischargeDate. NOTE: if has_discharge is true but "
            "dischargeDate is empty, the summary is drafted from the in-hospital course but not finalised -> "
            "completeness='Partial', statusLabel='Draft'.\n"
            "- Histopathology Correlation Summary: has_pathology. If pathology_is_formal is true -> 'Complete' "
            "(use the pathology report date if available); if only intra-op staging exists (pathology_is_formal "
            "false) -> 'Partial' (awaiting formal HPR), statusLabel='Partial'.\n"
            "- MDT Summary Generator: the MDT summary IS the approved tumor-board plan "
            "(tumor_board), NOT the surgeon's free-text mdtComments. If has_mdt_plan is true the "
            "MDT summary EXISTS: with a mdtGeneratedAt date -> completeness='Complete', status='ok', "
            "statusLabel='Ready', lastGenerated=mdtGeneratedAt, action names the plan status "
            "(mdtPlanStatus, e.g. 'approved'); if has_mdt_plan is true but mdtGeneratedAt is empty "
            "-> the plan exists but is undated, completeness='Partial', status='watch', "
            "statusLabel='Available', lastGenerated='', action='MDT plan on file (<mdtPlanStatus>)'. "
            "If has_mdt_plan is false the plan does NOT exist yet -> completeness='Pending', "
            "status='neutral', statusLabel='Pending', lastGenerated='', action='Generate after MDT "
            "decision' (has_mdt / mdtComments alone is only a free-text note, not the summary).\n"
            "- Clinical Timeline Generator: has content whenever created_at exists -> assemble timeline of the "
            "episode; 'Complete' if created_at + surgeryDate present (use created_at as the date).\n"
            "- Guideline Evidence Viewer: there is no dated guideline-evidence document in the DATA -> "
            "completeness='Pending', status='neutral', statusLabel='Pending', lastGenerated='', action='Requires "
            "guideline link source'.\n"
            "- Explainable AI Surgical Recommendation: no standalone dated document exists (it would be derived "
            "from the other modules) -> completeness='Pending', status='neutral', statusLabel='Pending', "
            "lastGenerated='', action='Derived once modules complete'.\n\n"
            f"DATA:\n{data}"
        )

    def _snap_pill(self, row: ParameterRow) -> None:
        """m9 override: color the pill from the DOCUMENT's Completeness, not a clinical
        finding. m9 rows always carry an empty 'finding' (its signal lives in the
        Completeness/Last-Generated columns), so the base finding-gated snap would wrongly
        force every pill to grey 'Not Available'. Colour is deterministic from completeness;
        the LLM's document-state statusLabel ('Final'/'Ready'/'Draft'/'Not yet generated' …)
        is kept as the pill text, defaulting per tier when the model left it blank.

        DATE-GATE (user decision): a row may only read 'Complete' (green 'Ready') if it
        carries a REAL generated date. With no date it isn't a finalised, dated document,
        so it can't claim completion — it is downgraded to 'Pending' (grey). This stops the
        table ever showing 'Complete' next to a blank 'Last Generated' (e.g. MDT Summary,
        Guideline Evidence Viewer, Explainable AI Recommendation, which have no date source)."""
        comp = (row.completeness or "").strip().lower()
        date_txt = (row.lastGenerated or "").strip()
        has_date = bool(date_txt) and date_txt.lower() != "not available"

        # Match on the leading keyword so richer prose ('Pending discharge',
        # 'Partial — awaiting HPR') still maps to the right tier.
        tier = None
        for key, t in self._DOC_TIER.items():
            if comp.startswith(key):
                tier = t
                break

        # DATE-GATE: 'Complete' (ok) with no real date is not a finalised document →
        # downgrade to 'Pending' (grey). Preserve a genuine LLM action; only backfill a
        # generic one when the action is empty / 'No action.'.
        if tier == "ok" and not has_date:
            row.status = "neutral"
            row.statusLabel = "Pending"
            row.completeness = "Pending"
            if not (row.action or "").strip() or (row.action or "").strip().lower() == "no action.":
                row.action = "Not yet generated — awaiting source."
            return

        if tier is None:
            # No completeness signal at all → the document isn't generated yet.
            row.status = "neutral"
            row.statusLabel = (row.statusLabel or "").strip() or "Pending"
            if not (row.completeness or "").strip():
                row.completeness = "Pending"
            return
        row.status = tier
        row.statusLabel = (row.statusLabel or "").strip() or self._DOC_LABEL[tier]

    async def run(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Same flow as the base, but the empty-guard here is essentially never hit
        (presence flags are always present); kept for symmetry / error safety."""
        data = self._slice(state)
        try:
            result: ModuleResult = await self.structured.ainvoke([
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=self._prompt(data)),
            ])
            result = self._reconcile_rows(result)
            logger.info(f"[{self.MODULE_ID}] {self.TITLE}: {len(result.rows)} document rows")
            return {"modules": {self.MODULE_ID: result}}
        except Exception as e:  # noqa: BLE001
            logger.error(f"[{self.MODULE_ID}] failed: {e}")
            return {
                "modules": {self.MODULE_ID: self._empty_result()},
                "warnings": [f"{self.MODULE_ID}: {e}"],
            }
