"""m10 — Multidisciplinary Oncology Intelligence.

Cross-specialty coordination: assembles the tumor-board packet and correlates the
surgery with the chemotherapy and radiotherapy timeline (this patient had neoadjuvant
CROSS-protocol chemoradiotherapy before surgery, with radiotherapy recorded for adjuvant).

Record-grounded FINDINGS with a guideline REFERENCE (user decision — m7-style reasoning,
via base._reasoning_license): the `reference` column may name the general cross-specialty
standard (guideline-concordant sequencing, MDT sign-off on file, risk stratification) as
trained knowledge, and judge the documented pathway against it. But the FINDING stays
STRICTLY record-grounded — report the DOCUMENTED treatment sequence, correlations, and MDT
decisions; say 'Not available' for anything the record doesn't contain (e.g. clinical-trial
matching — there is no trial database here, so a trial is reported only if the record itself
names one). The stage-migration flag logic below (Upstaged/Downstaged → status='flag') is
UNCHANGED.

Sources (all read-only, active booking):
  - `tumor_board`  : the AUTHORITATIVE MDT care-pathway plan (tumorBoardPlan collection) —
                     sequenced cross-specialty steps, per-specialty approvals, safety flags,
                     guideline basis. Preferred for the MDT/sequence/roadmap/decision rows.
  - `booking`     : preOpDiagnosis, mdtComments, highRiskMDT (the MDT decision + staging).
  - `pac.otherHistory` : full neoadjuvant chemo + RT history (sequence & correlation).
  - `pathology_case` : the pathology dept's structured pTNM (tnm.latest) + synoptic — the
                       basis for stage-migration detection and the molecular tumor board.
  - `management`  : stagingT/N/M, resection, postOperativeDiagnosis (surgical outcome, fallback).
  - `discharge.adjuvantPlan` : recorded adjuvant chemo/RT plan.
  - `pathology_documents` : molecular / biomarker results for the molecular tumor board.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class MDTAgent(BaseDashboardAgent):
    MODULE_ID = "m10"
    TITLE = "Multidisciplinary Oncology Intelligence"
    PARAMETERS = [
        "Tumor Board Preparation Engine",
        "Stage Migration Detection",
        "Treatment Sequence Recommendation",
        "Surgery–Chemotherapy Correlation",
        "Surgery–Radiotherapy Correlation",
        "Molecular Tumor Board Support",
        "Clinical Trial Eligibility",
        "Cross-specialty Guideline Compliance",
        "Patient-specific Risk Stratification",
        "Personalized Treatment Roadmap",
        "MDT Decision Tracking",
        "Longitudinal Oncology Dashboard",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        pac = (active.get("anaesthesia") or {}).get("pac") or {}
        mgmt = active.get("management") or {}
        discharge = active.get("discharge") or {}
        path_docs = state.get("pathology_documents") or []

        slim_docs = []
        for d in path_docs:
            slim_docs.append({
                "investigation": d.get("investigation"),
                "date_of_order": d.get("date_of_order"),
                "parameters": d.get("parameters"),
                "parameterwise_markdown": d.get("parameterwise_markdown"),
            })

        return {
            # --- diagnosis + MDT decision ---
            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),
            "mdtComments": booking.get("mdtComments", ""),
            "highRiskMDT": booking.get("highRiskMDT", ""),

            # --- AUTHORITATIVE tumor-board / MDT care-pathway plan (tumorBoardPlan) ---
            # The dedicated cross-specialty plan: sequenced steps, specialist approvals,
            # guideline basis, safety flags. Preferred over the booking's mdtComments prose.
            "tumor_board": state.get("tumor_board") or {},

            # --- multimodal treatment history (chemo + RT sequence) ---
            "otherHistory": pac.get("otherHistory", ""),          # neoadjuvant CRT narrative
            "preOperativeRemarks": pac.get("preOperativeRemarks", ""),

            # --- AUTHORITATIVE pathology (pTNM for stage migration, molecular for MTB) ---
            "pathology_case": state.get("pathology_case") or {},

            # --- surgical outcome (fallback staging) ---
            "stagingT": mgmt.get("stagingT", ""),
            "stagingN": mgmt.get("stagingN", ""),
            "stagingM": mgmt.get("stagingM", ""),
            "resection": mgmt.get("resection", ""),
            "intentOfProcedure": mgmt.get("intentOfProcedure", ""),
            "postOperativeDiagnosis": mgmt.get("postOperativeDiagnosis", ""),

            # --- adjuvant / next-phase plan ---
            "adjuvantPlan": discharge.get("adjuvantPlan", ""),

            # --- molecular / biomarker (for molecular tumor board) ---
            "pathology_documents": slim_docs,
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m10 specifically: this is the MULTIDISCIPLINARY (cross-specialty) coordination module. "
            "Correlate the surgery with the chemotherapy and radiotherapy timeline as DOCUMENTED in the "
            "record — the FACTS stay STRICTLY record-grounded; do NOT invent trials, molecular results, or "
            "treatment steps that aren't in the DATA. The `reference` may name the general cross-specialty "
            "standard (guideline-concordant sequencing, MDT sign-off, risk stratification) to judge the "
            "documented pathway against.\n\n"
            "PRIMARY MDT SOURCE — the `tumor_board` object is the AUTHORITATIVE tumor-board / care-pathway "
            "plan (from the dedicated tumorBoardPlan collection). PREFER it over the booking's free-text "
            "mdtComments wherever it has content. Its shape: treatmentIntent (curative/palliative), diagnosis, "
            "cancerStage, contributingSpecialties, a sequenced `steps` list (each with phase / modality / "
            "treatment / timing / dependsOnStep / specialty / guideline / status / statusReason), "
            "sequenceRationale, safetyFlags, approvals (per-specialty sign-off) and confidenceScore. When the "
            "plan itself says a field is 'Not formally documented'/'Not formally staged', REPORT that verbatim — "
            "do NOT substitute a value from elsewhere or invent one.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[standard] · judge→[pill/action]. "
            "'Not available' finding only if the source is empty (still fill reference + action):\n"
            "- Tumor Board Preparation Engine: assemble the MDT packet in one line from tumor_board — "
            "treatmentIntent + diagnosis + cancerStage + contributingSpecialties + number of steps. Fall back to "
            "mdtComments + otherHistory + staging only if tumor_board is empty. reference='MDT packet complete "
            "before decision'. judge→'Complete'(ok) if a plan exists; 'Review'(watch) if partial.\n"
            "- Stage Migration Detection: cTNM (preOpDiagnosis) vs pTNM/ypTNM (pathology_case.tnm, else "
            "management staging fields). reference='AJCC 8th (c vs p stage)'. judge→if pathology raised the stage "
            "=> 'Upstaged' status='flag'; lowered => 'Downstaged' (flag); same => 'Concordant' status='ok'; no "
            "pathology => 'Not available'. (tumor_board's cancerStage is the CLINICAL plan stage, not a "
            "pathological restage — don't treat it as migration.)\n"
            "- Treatment Sequence Recommendation: state the DOCUMENTED sequence from tumor_board.steps in order "
            "(phase/modality + timing + dependency), and the sequenceRationale. Name the next actionable step "
            "(the earliest step whose status is pending/on_hold). Fall back to otherHistory + adjuvantPlan only if "
            "tumor_board is empty. reference='Guideline-concordant multimodal sequence'. judge→'Concordant'(ok) if "
            "the sequence is coherent/on-guideline; 'Pending'(watch) if a step is outstanding. Don't prescribe "
            "beyond the record.\n"
            "- Surgery–Chemotherapy Correlation: relate surgery to the chemo given (neoadjuvant chemo in otherHistory: "
            "agent, cycles, timing vs surgery) and to any chemotherapy-modality step in tumor_board.steps. "
            "reference='Chemo–surgery interval per protocol'. judge→'Concordant'(ok) if the sequence is "
            "coherent/documented; 'Review'(watch) if timing is unclear.\n"
            "- Surgery–Radiotherapy Correlation: relate surgery to RT (neoadjuvant EBRT dose/fractions in otherHistory; "
            "any radiation-modality step in tumor_board.steps or adjuvantPlan). reference='RT–surgery interval per "
            "protocol'. judge→'Concordant'(ok) if documented and coherent; 'Not available' if no RT documented.\n"
            "- Molecular Tumor Board Support: molecular/genomic results ONLY from pathology_case/pathology_documents; "
            "else 'Not available'. reference='Actionable biomarkers reviewed'. judge→'Review'(watch) if a panel is "
            "pending; 'Noted'(neutral) reporting a result. (A tumor_board step calling for a 'biomarker panel' is a "
            "PLANNED test, not a result — report it as pending, not as a molecular finding.)\n"
            "- Clinical Trial Eligibility: report a trial ONLY if the record names one. There is NO trial-matching "
            "database here, so otherwise finding='Not available'. reference='Trial screening where eligible'. "
            "judge→'Not available'/neutral (no trial DB); do NOT invent trial matches.\n"
            "- Cross-specialty Guideline Compliance: whether the pathway aligns with guideline — use the per-step "
            "`guideline` / guideline_support fields and sequenceRationale in tumor_board. reference=the guideline "
            "named. judge→'Concordant'(ok) if guideline-supported; 'Review'(watch) if it deviates.\n"
            "- Patient-specific Risk Stratification: qualitative band (low/intermediate/high) justified by documented "
            "factors — tumor_board.safetyFlags + cancerStage + node status + comorbidity in otherHistory. Surface any "
            "safetyFlags explicitly. reference='Risk-stratified by stage / nodes / fitness'. judge→pill reflects the "
            "band ('Review'/watch or 'Critical'/alert when a safety flag is present). Not a fabricated score.\n"
            "- Personalized Treatment Roadmap: past -> present -> future strictly from the record. PREFER the ordered "
            "tumor_board.steps as the forward roadmap (with each step's status), anchored by the surgery + R-status "
            "and any adjuvant plan. reference='Individualised, sequenced roadmap'. judge→'Complete'(ok) if a coherent "
            "roadmap is on file; 'Review'(watch) if gaps remain.\n"
            "- MDT Decision Tracking: from tumor_board — was the case taken to MDT and signed off. Report planStatus + "
            "approvals (which specialties approved) + mdtBasisSummary + confidenceScore. Fall back to mdtComments + "
            "highRiskMDT only if tumor_board is empty. reference='All contributing specialties signed off'. "
            "judge→'Approved'(ok) if all contributing specialties approved; 'Pending'(watch) if sign-off outstanding.\n"
            "- Longitudinal Oncology Dashboard: one concise summary line across the whole timeline. "
            "reference='Continuous cross-specialty pathway'. judge→'Complete'(ok) if the pathway is coherent end-to-end.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
