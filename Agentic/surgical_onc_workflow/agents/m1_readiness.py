"""m1 — Patient Assessment & Surgical Readiness.

Maps the active booking's PAC / doctor's note / checklist / booking + aggregated labs
onto the 10 readiness parameters. Data-availability reality for this module (verified
against the sample record): only ASA, eligibility, comorbidity, checklist and
investigation-completeness have clean structured fields; resectability, neoadjuvant
response and nutrition live only in prose (pac.otherHistory, mdtComments) — which we
ARE allowed to extract from. NRS-2002 has no score in the DB.

Baseline Investigation Completeness is sourced from `state["investigation_register"]` —
the oncology_investigations order register (ALL statuses, ALL ordering doctors) joined to
processed_documents results — NOT the doctor's-note labs. An order counts as COMPLETED once
it carries a result document (document_id) — the same rule the Lab Investigations UI uses —
not merely when a `status` string says so. It reports what was requested, what completed
(with resulted values, or a report snippet for imaging) and what is still pending. The
doctor's-note labs / PAC imaging flags stay only as a supplement.

ECOG is NOT in the surgical booking at all — it is carried by the medical-oncology
side. `state["clinical_context"]` surfaces it structurally (ecogStatus, from the
chemotherapy record's assessment, else the generated clinical summary's functional
status) so ECOG/KPS no longer depends on the surgeon happening to type it into prose.
The same clinical_context supplies a clinical one-liner + active problems/treatments
and the oncology disease stage / organ-function assessment.

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m1 is DECISION SUPPORT, not transcription. Each readiness row names the expected
  STANDARD in `reference` (ECOG 0–1, ASA I–II, comorbidities optimized, NRS-2002 <3,
  full baseline work-up) and judges the finding against it (fit / needs-optimization /
  at-risk), rather than echoing a bare fact. HARD BOUNDARY (same as m7): the patient-
  specific facts — ECOG, ASA, comorbidity status, checklist items — come STRICTLY from
  the record; only the general readiness standard in `reference` is trained knowledge,
  and every judgement is framed for surgeon/MDT review.
"""

from typing import Any, Dict, List

from .base import BaseDashboardAgent
from ..data_sources import summarize_checklist


def _register_summary(register: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministic completeness counts for m1 — the LLM must NOT recount from the raw
    register blob (it miscounts). An order is COMPLETE once it carries a result document
    (document_id) or status=='completed' — the same rule the Lab Investigations UI uses.
    Returns exact totals plus readable name lists the agent quotes verbatim."""
    reg = register or []

    def _done(e: Dict[str, Any]) -> bool:
        return str(e.get("status") or "").strip().lower() == "completed" or bool(e.get("document_id"))

    def _name(e: Dict[str, Any]) -> str:
        inv = str(e.get("investigation") or "").lower()
        kind = "Radiology" if "radiolog" in inv else ("Lab" if "labinvest" in inv else "Investigation")
        label = str((e.get("order_context") or {}).get("label") or "").strip()
        return f"{kind} — {label}" if label else kind

    completed = [e for e in reg if _done(e)]
    pending = [e for e in reg if not _done(e)]
    return {
        "total": len(reg),
        "completed": len(completed),
        "pending": len(pending),
        "completed_list": [_name(e) for e in completed][:40],
        "pending_list": [_name(e) for e in pending][:40],
    }


class ReadinessAgent(BaseDashboardAgent):
    MODULE_ID = "m1"
    TITLE = "Patient Assessment & Surgical Readiness"
    PARAMETERS = [
        "Surgical Eligibility",
        "ECOG/KPS & Frailty",
        "Operability & Resectability",
        "Pre-Anesthesia Risk (ASA)",
        "Comorbidity Optimization",
        "Nutritional Risk (NRS-2002)",
        "Infection & Contraindication Screening",
        "Baseline Investigation Completeness",
        "Neoadjuvant Response Assessment",
        "Pre-operative Checklist",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        note = active.get("doctors_note") or {}
        pac = (active.get("anaesthesia") or {}).get("pac") or {}
        checklist = active.get("checklist") or {}
        labs = state.get("labs") or {}
        clinical = state.get("clinical_context") or {}
        register = state.get("investigation_register", []) or []
        tumor_board = state.get("tumor_board") or {}

        return {
            # --- Surgical Eligibility / Operability (structured + MDT prose) ---
            "highRiskMDT": booking.get("highRiskMDT", ""),
            "mdtComments": booking.get("mdtComments", ""),
            "tumorBoardStatus": tumor_board.get("planStatus", ""),
            "tumorBoardIntent": tumor_board.get("treatmentIntent", ""),
            "tumorBoardApprovals": tumor_board.get("approvals", []),
            "fitnessStatus": pac.get("fitnessStatus", ""),
            "caseStatus": booking.get("caseStatus", ""),
            "natureOfSurgery": pac.get("natureOfSurgery", ""),
            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),

            # --- ASA ---
            "asaClass": booking.get("asaClass", ""),
            "asaStatus": note.get("asaStatus", []),
            "asaGrade": pac.get("asaGrade", ""),

            # --- ECOG / frailty / neoadjuvant / nutrition ---
            # Structured ECOG + clinical summary (med-onc), then the surgeon's own prose.
            "ecogStatus": clinical.get("ecogStatus", ""),
            "ecogSource": clinical.get("ecogSource", ""),
            "karnofsky": clinical.get("karnofsky", ""),
            "mobility": clinical.get("mobility", ""),
            "adl": clinical.get("adl", ""),
            "clinicalOneLiner": clinical.get("clinicalOneLiner", ""),
            "activeProblems": clinical.get("activeProblems", []),
            "activeTreatments": clinical.get("activeTreatments", []),
            "diseaseStage": clinical.get("diseaseStage", ""),
            "otherHistory": pac.get("otherHistory", ""),
            "preOperativeRemarks": pac.get("preOperativeRemarks", ""),

            # --- Comorbidity optimization (PAC systemic review — the 'pre') ---
            "anemiaManagement": pac.get("anemiaManagement", ""),
            "anemiaRemarks": pac.get("anemiaRemarks", ""),
            "cardiac": pac.get("cardiac", "") or clinical.get("cardiacFunction", ""),
            "respiratory": pac.get("respiratory", ""),
            "renal": pac.get("renal", "") or clinical.get("renalFunction", ""),
            "hepatic": clinical.get("hepaticFunction", ""),
            "hypertension": pac.get("hypertension", ""),
            "diabetes": pac.get("diabetes", ""),
            "thyroidDisorder": pac.get("thyroidDisorder", ""),
            "nervousSystem": pac.get("nervousSystem", ""),

            # --- Infection & contraindication screening ---
            "lrti": pac.get("lrti", ""),
            "urti": pac.get("urti", ""),
            "fever": pac.get("fever", ""),
            "drugAllergies": pac.get("drugAllergies", ""),
            "viralMarkers": booking.get("viralMarkers", []),
            "aspirationRisk": note.get("aspirationRisk", ""),

            # --- Baseline investigation completeness ---
            # AUTHORITATIVE source: the oncology_investigations order register (all
            # statuses, all ordering doctors) joined to processed_documents results — what
            # was requested, what completed (with resulted values), what is still pending.
            # `investigation_summary` carries the DETERMINISTIC counts (total/completed/
            # pending + name lists) computed here in Python so the LLM never has to count
            # the register by eye — it just quotes these numbers. labOrder/investigations/
            # labs remain only as supplementary imaging/lab hints.
            "investigation_summary": _register_summary(register),
            "investigation_register": register,
            "labOrder": note.get("labOrder", {}),
            "investigations": pac.get("investigations", {}),
            "labs": labs,

            # --- Pre-operative checklist (custom WHO-aligned safety checklist) ---
            # `checklist_summary` carries the DETERMINISTIC per-phase tallies (yes/no/na/blank,
            # expected, critical 'No's) computed in Python via summarize_checklist so the agent
            # never miscounts the raw `${id}_status` blob (blanks / NA / free-text fields made it
            # default to 'pending'). The raw `checklist` stays only as a supplementary lookup for
            # remarks. m1 focuses the judgement on the pre-induction SIGN IN phase (the intra-op
            # TIME OUT / SIGN OUT phases are filled in theatre, so pre-op they are legitimately blank).
            "checklist_summary": summarize_checklist(checklist),
            "checklist": {k: v for k, v in checklist.items() if str(k).startswith(("signin_", "timeout_", "signout_", "extubation_"))},
            "informedConsent": note.get("informedConsent", []),
            "bloodConfirmed": note.get("bloodConfirmed", ""),
            "machineCheck": note.get("machineCheck", ""),
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m1 specifically: judge each readiness finding against its fitness standard "
            "(the facts — ECOG, ASA, comorbidity control, checklist items — come STRICTLY from the "
            "DATA). Read preOpDiagnosis for the tumour site the reference must fit.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[standard] · judge→[pill/action]. "
            "'Not available' finding only if ALL source fields for the parameter are empty (if partial data exists, evaluate it):\n"
            "- Surgical Eligibility: fitnessStatus + highRiskMDT + mdtComments (plus formal tumorBoardStatus, tumorBoardIntent, tumorBoardApprovals if available). "
            "reference='Fit for surgery, MDT-approved intent'. judge→'Approved'/'Concordant'(ok) if fit & "
            "MDT-cleared (or formally approved in tumor board); 'Review'(watch) if fitness or MDT sign-off is provisional.\n"
            "- ECOG/KPS & Frailty: use the structured ecogStatus FIRST (report it as 'ECOG <n>' with "
            "ecogSource in parentheses, e.g. 'ECOG 1 (from chemotherapy record)'); add karnofsky/mobility/adl "
            "if present. If ecogStatus is empty, fall back to any ECOG/PS stated in otherHistory prose; else "
            "Not available. reference='ECOG 0-1 = fit for major surgery'. judge→'Normal'(ok) if ECOG 0-1; "
            "'Review'(watch) if ECOG>=2.\n"
            "- Operability & Resectability: state the resectability from mdtComments (e.g. 'potentially "
            "resectable') + preOpDiagnosis / diseaseStage (oncology) stage — NOT just 'high-risk MDT: yes'. "
            "reference='Resectable / R0 curative-intent per MDT'. judge→'Resectable'(ok) if resectable, "
            "'Review'(watch) if borderline/potentially resectable, 'Unresectable'(alert) if unresectable.\n"
            "- Pre-Anesthesia Risk (ASA): asaClass / asaStatus / asaGrade. reference='ASA I-II routine; "
            "III acceptable with optimization'. judge→'Normal'(ok) if ASA I-II; 'Review'(watch) if ASA>=III.\n"
            "- Comorbidity Optimization: summarise the PAC systemic review — hypertension, diabetes, "
            "cardiac, respiratory, renal, hepatic, thyroidDisorder, nervousSystem — plus anemiaManagement + "
            "anemiaRemarks + preOperativeRemarks. Report only the systems that carry a documented finding; "
            "cardiac/renal/hepatic may be filled from the oncology assessment when the PAC leaves them blank. "
            "reference='Comorbidities controlled / optimized pre-op'. judge→'Optimized'(ok) if controlled; "
            "'Review'(watch) if any comorbidity is uncontrolled / needs optimization.\n"
            "- Nutritional Risk (NRS-2002): only from prose (e.g. 'mild malnutrition'); there is no NRS score — "
            "if no score, report the prose finding but keep reference='NRS-2002 >=3 = at risk'. judge→'Normal'(ok) "
            "if well-nourished; 'Review'(watch) if malnutrition noted; action names nutritional optimization.\n"
            "- Infection & Contraindication Screening: lrti/urti/fever/drugAllergies/viralMarkers/aspirationRisk. "
            "Empty screening fields => 'No active infection documented' only if aspirationRisk/allergy fields are "
            "explicitly set; otherwise Not available. reference='No active infection / no contraindication'. "
            "judge→'Clear'(ok) if screening is clean; 'Critical'(alert) if an active infection/contraindication.\n"
            "- Baseline Investigation Completeness: `investigation_summary` gives the "
            "AUTHORITATIVE, already-counted totals — USE THESE EXACT NUMBERS, do NOT recount "
            "anything yourself: `total` (orders placed), `completed`, `pending`, plus "
            "`completed_list` / `pending_list` (their names). State completeness verbatim as "
            "'<completed> of <total> investigations completed (<pending> awaited)' using those "
            "exact integers. Name the COMPLETED ones from `completed_list` (add a couple of key "
            "resulted values / the report date from the matching `investigation_register` entry — "
            "each has `requested`, `resulted` (values that came back, OR a short narrative snippet "
            "for imaging like CT/PET/MRI), `report_date`), and LIST the pending ones from "
            "`pending_list` as still awaited. These counts span EVERY ordering doctor (surgical, "
            "anaesthesia PAC, medical-oncology), matching the Lab Investigations UI — count them "
            "all. An imaging order still counts as completed even when its result is only a "
            "narrative snippet. You MAY add imaging flags from `investigations` (ecg/echo2d/ctMri) "
            "or `labs` only as a supplement — the register summary is authoritative. "
            "reference='All ordered baseline investigations resulted'. judge→'Complete'(ok) if "
            "`pending` is 0; 'Pending'(watch) if `pending` > 0 (action names which tests are "
            "awaited from pending_list); 'Not available' only if `total` is 0.\n"
            "- Neoadjuvant Response Assessment: extract from otherHistory (e.g. CROSS chemoradiotherapy completed, "
            "improved swallowing / restaging scan) and activeTreatments (oncology treatment history). "
            "reference='Response assessed / restaged post-neoadjuvant'. judge→'Complete'(ok) if response is "
            "documented/restaged; 'Review'(watch) if restaging is outstanding.\n"
            "- Pre-operative Checklist: use `checklist_summary` — the AUTHORITATIVE, "
            "already-counted tallies (do NOT recount the raw `checklist` keys; blanks / NA / "
            "free-text concern fields are NOT 'No'). It is a CUSTOM checklist aligned to the WHO "
            "Surgical Safety Checklist; m1 is pre-operative, so judge the SIGN IN "
            "(before-induction) phase — find it in `checklist_summary.phases` (phase_id "
            "'signin'). Report as '<yes> of <expected> Sign In items confirmed' using its exact "
            "integers; name any `no_items` and any `pending_items` (still to confirm before "
            "induction). The intra-op TIME OUT / SIGN OUT phases are completed in theatre — if "
            "`checklist_summary.started` is false or those phases are blank, that is EXPECTED "
            "pre-op, NOT a failure. reference='Sign In (pre-induction) confirmed; full WHO "
            "checklist completed in theatre'. judge→'Critical'(alert) if `critical_no` is "
            "non-empty (a safety-critical item answered 'No'); 'Review'(watch) if Sign In has "
            "any other 'No' or unconfirmed (blank) items, action naming them; 'Complete'(ok) if "
            "every Sign In item is confirmed (Yes/NA). If the checklist has not been started at "
            "all, finding states 'Not yet performed' with 'Pending'(watch).\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
