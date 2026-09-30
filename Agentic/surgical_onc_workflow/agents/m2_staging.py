"""m2 — Diagnosis, Staging & Surgical Planning.

Maps the active booking's diagnosis/procedure/MDT + doctor's-note imaging orders +
PAC restaging imaging onto the 15 staging & operative-planning parameters. This
module is prose-heavy: clinical stage, approach, reconstruction and the MDT strategy
live in narrative fields (preOpDiagnosis, mdtComments, remarks, ctMri.value) — which
we ARE allowed to extract from. The MDT/guideline/strategy rows additionally prefer
the structured tumor-board plan (`state["tumor_board"]`, from tumorBoardPlan): its
surgical-modality step, contributing specialties, per-specialty approvals and guideline
basis.

Imaging & Pathology Correlation is now backed by the ACTUAL resulted reports, not a thin
flag: `state["completed_documents"]` is split (via pick_imaging_documents /
pick_pathology_documents) into `imaging_reports` (CT/PET-CT/MRI narrative findings) and
`biopsy_reports` (the DIAGNOSTIC biopsy/cytology histology), each as a compact snippet.
The correlation row reads what the scans show against what the tissue shows and the
assigned clinical stage. The full clinical-vs-PATHOLOGICAL (post-resection) stage
discordance still belongs to m4 — m2 stays pre-operative and correlates imaging with the
DIAGNOSTIC biopsy + clinical stage only, never restaging from the HPR.

DESIGN (user decision — extend m7's "LLM clinical knowledge" exception to m2):
  m2 is DECISION SUPPORT, not transcription. The design template (surgical-oncology-
  intelligence-report.html, Module 2) fills the 'Reference / Expected' column of EVERY
  row with the expected STANDARD (e.g. "AJCC 8th", "Minimally invasive preferred",
  "TME with ≥12 node target") and lets the pill reflect a JUDGEMENT of the finding
  against that standard — not a bare "Not available / Noted / No action". So, exactly
  as in m7, the agent MAY apply general surgical-oncology guideline knowledge (NCCN /
  ESMO / AJCC-style) to (a) name the applicable expected standard in `reference`, and
  (b) judge whether the finding meets it, setting the pill and a concrete `action`.
  HARD BOUNDARY (same as m7): the patient-specific FACTS — stage, procedure, approach,
  margins, nodes, positioning, MDT decision, imaging/biopsy findings — come STRICTLY
  from the record and are never invented; only the general STANDARD in `reference` is
  trained knowledge, and every judgement is framed for surgeon/MDT review. If a row's
  data is absent, it stays 'Not available' — the licence never manufactures a fact or a
  judgement.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent
from ..data_sources import (
    _report_snippet, pick_imaging_documents, pick_pathology_documents,
)


class StagingAgent(BaseDashboardAgent):
    MODULE_ID = "m2"
    TITLE = "Diagnosis, Staging & Surgical Planning"
    PARAMETERS = [
        "Clinical TNM Staging",
        "AJCC Stage Grouping",
        "Imaging & Pathology Correlation",
        "Surgical Procedure Recommendation",
        "Surgical Margin Planning",
        "Organ Preservation Assessment",
        "Lymph Node Dissection Recommendation",
        "Reconstruction Planning",
        "Surgical Approach",
        "High-Risk Anatomy Identification",
        "Pre-op Imaging Review",
        "Multidisciplinary Surgical Planning",
        "Surgical Guideline Recommendation",
        "Personalized Surgical Strategy",
        "Pre-operative Planning Summary",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        note = active.get("doctors_note") or {}
        pac = (active.get("anaesthesia") or {}).get("pac") or {}
        inv_suggestion = note.get("investigationSuggestion") or {}
        rad_order = note.get("radOrder") or {}
        investigations = pac.get("investigations") or {}
        tb = state.get("tumor_board") or {}

        # --- Resulted reports for the Imaging & Pathology Correlation row ---
        # Split the completed investigations into imaging (CT/PET/MRI narrative) and the
        # DIAGNOSTIC biopsy/cytology histology, each as a COMPACT snippet so the LLM reads
        # the actual findings without a huge markdown blob (same lesson as m1: hand it the
        # gist, not the raw dump). pick_imaging_documents already excludes pathology docs.
        documents = state.get("completed_documents") or []

        def _slim(d: Dict[str, Any], limit: int) -> Dict[str, Any]:
            return {
                "investigation": d.get("investigation"),
                "modality": d.get("parameters"),           # what was ordered (CT / PET-CT / MRI ...)
                "indication": d.get("clinical_indication"),
                "date": d.get("date_of_order"),
                "findings": _report_snippet(d, limit),     # narrative snippet of the resulted report
            }

        imaging_reports = [_slim(d, 900) for d in pick_imaging_documents(documents)[:8]]
        biopsy_reports = [_slim(d, 700) for d in pick_pathology_documents(documents)[:6]]

        return {
            # --- diagnosis / clinical stage ---
            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),
            "caseStatus": booking.get("caseStatus", ""),
            "natureOfSurgery": pac.get("natureOfSurgery", ""),

            # --- STRUCTURED clinical staging (doctors_note) — the authoritative cTNM ---
            "clinicalStagingT": note.get("clinicalStagingT", ""),
            "clinicalStagingN": note.get("clinicalStagingN", ""),
            "clinicalStagingM": note.get("clinicalStagingM", ""),
            "clinicalStageGroup": note.get("clinicalStageGroup", ""),
            "clinicalDiagnosis": note.get("clinicalDiagnosis", ""),
            "clinicalStagingBasis": note.get("clinicalStagingBasis", []),
            "clinicalStagingNotes": note.get("clinicalStagingNotes", ""),

            # --- procedure & operative strategy (structured + prose) ---
            "procedureName": booking.get("procedureName", ""),
            "laterality": booking.get("laterality", ""),
            "approach": booking.get("approach", []),
            "remarks": booking.get("remarks", ""),           # detailed operative setup prose
            "preOperativeRemarks": pac.get("preOperativeRemarks", ""),

            # --- MDT / guideline strategy ---
            "highRiskMDT": booking.get("highRiskMDT", ""),
            "mdtComments": booking.get("mdtComments", ""),

            # --- TUMOR BOARD (tumorBoardPlan) — the structured cross-specialty plan ---
            # surgicalStep is the surgical-modality step pre-picked; the rest gives the
            # MDT context (intent, contributing specialties, guideline basis, sign-off).
            "tbSurgicalStep": tb.get("surgicalStep", {}),
            "tbTreatmentIntent": tb.get("treatmentIntent", ""),
            "tbContributingSpecialties": tb.get("contributingSpecialties", []),
            "tbSequenceRationale": tb.get("sequenceRationale", ""),
            "tbSafetyFlags": tb.get("safetyFlags", []),
            "tbApprovals": tb.get("approvals", []),
            "tbPlanStatus": tb.get("planStatus", ""),

            # --- imaging / restaging ---
            # imaging_reports / biopsy_reports = the ACTUAL resulted reports (compact
            # snippets) for the Imaging & Pathology Correlation + Pre-op Imaging Review rows.
            # ctMri / radTests / radOrderStatus remain the pre-op ORDER hints (what is
            # ordered / still awaited) as a supplement.
            "imaging_reports": imaging_reports,
            "biopsy_reports": biopsy_reports,
            "ctMri": (investigations.get("ctMri") or {}).get("value", ""),
            "isRadRequired": inv_suggestion.get("isRadRequired", ""),
            "radClinicalIndication": inv_suggestion.get("radClinicalIndication", ""),
            "radTests": inv_suggestion.get("radTests", []),
            "radOrderStatus": rad_order.get("status", ""),
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m2 specifically: the patient-specific facts (stage, procedure, approach, margins, "
            "node plan, positioning, MDT decision, imaging) come STRICTLY from the DATA — read "
            "preOpDiagnosis for the tumour site the reference standard must fit. Most m2 rows are "
            "genuine plans/decisions, so once judged they should NOT default to 'Noted'.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[the expected standard] · judge→[pill/action]. "
            "'Not available' only if the finding source is empty:\n"
            "- Clinical TNM Staging: PREFER structured clinicalStagingT/N/M (bare numbers) — assemble as "
            "'cT<T> N<N> M<M>' (T='1',N='3',M='2' -> 'cT1 N3 M2'); include clinicalDiagnosis if present. "
            "Else extract cTNM from preOpDiagnosis / ctMri prose. reference='cTNM (AJCC 8th)'. judge→ "
            "'Complete'(ok) if a full restaging cTNM is documented; 'Review'(watch) if partial/pre-restaging.\n"
            "- AJCC Stage Grouping: PREFER clinicalStageGroup ('III' -> 'Stage III'); else only if explicitly "
            "stated in prose. Do NOT compute it yourself. reference='AJCC 8th stage group'. judge→'Complete'(ok) "
            "if assigned; action names the group's broad implication (e.g. 'locally advanced — multimodal pathway').\n"
            "- Imaging & Pathology Correlation: NOW backed by the ACTUAL resulted reports — do the "
            "correlation from them, not from a bare flag. Read the IMAGING findings in `imaging_reports` "
            "(each has `modality` (CT/PET-CT/MRI…), `indication`, `date` and the report `findings` snippet) "
            "against the tissue diagnosis in `biopsy_reports` (the DIAGNOSTIC biopsy/cytology histology "
            "snippet) AND the clinical stage (clinicalStagingT/N/M, clinicalStagingBasis, clinicalStagingNotes, "
            "preOpDiagnosis); ctMri is only a supplementary hint. State the CONCRETE concordance, citing what "
            "each source shows (e.g. 'PET-CT: FDG-avid mid-oesophageal mass with regional nodes; biopsy: "
            "invasive SCC — imaging and histology concordant, supports cT3 N1'). reference='Imaging findings "
            "concordant with biopsy histology + clinical stage'. judge→'Concordant'(ok) if imaging and the "
            "biopsy/clinical picture agree; 'Review'(watch) if discordant, equivocal, or a source is still "
            "awaited — name the discrepancy in `action`. IMPORTANT: correlate imaging with the DIAGNOSTIC "
            "biopsy + clinical stage only; the full clinical-vs-PATHOLOGICAL (post-resection HPR) stage "
            "discordance is Module 4's job — do NOT restage from an HPR here. If neither imaging_reports nor "
            "ctMri carries findings, finding='Not available' (imaging not yet resulted).\n"
            "- Surgical Procedure Recommendation: procedureName (+laterality/approach), corroborated by mdtComments "
            "+ tbSurgicalStep.treatment/plan. reference=the guideline-standard operation for THIS site/stage "
            "(e.g. the recognised resection of choice). judge→'Concordant'(ok) if the planned procedure IS the "
            "standard; 'Review'(watch) if a non-standard/salvage option; action='For MDT confirmation'.\n"
            "- Surgical Margin Planning: reason about whether the PLANNED resection can achieve clear "
            "(R0) margins GIVEN the tumour's actual extent — do NOT just echo remarks. Read the tumour "
            "size / location / depth / any invasion or abutment of adjacent structures from `imaging_reports` "
            "findings + `biopsy_reports` (histologic type, depth, grade) + clinicalStagingT + "
            "clinicalStagingNotes + preOpDiagnosis, and the planned clearance / resection intent from remarks + "
            "tbSurgicalStep.plan/treatment + tbTreatmentIntent (curative→R0) + mdtComments + procedureName. "
            "reference=the site-specific R0 margin goal for THIS tumour (e.g. oesophageal: adequate "
            "proximal/distal + circumferential clearance; rectal: CRM ≥1 mm with TME; a named margin distance "
            "where a recognised standard exists). State the intended margin plan AND whether the tumour extent "
            "threatens it. judge→'Planned'(ok) if an adequate, site-appropriate margin goal is documented or is "
            "clearly achievable by the planned procedure with a curative intent; 'Review'(watch) if the plan is "
            "unstated or the imaging shows the tumour abutting/approaching a critical structure so R0 is at risk "
            "(action = the concrete mitigation, e.g. 'confirm CRM on planning MRI', 'consider neoadjuvant "
            "downstaging'). Only if margins are genuinely not addressed anywhere AND imaging shows no threatened "
            "structure: finding='Not available', but STILL give reference='R0 (microscopically negative) expected' "
            "and action='Confirm intended margin at planning'. Do NOT claim an ACHIEVED margin — that (post-"
            "resection margin status) is Module 4's job; here it is the pre-operative PLAN only.\n"
            "- Organ Preservation Assessment: from mdtComments + tbTreatmentIntent (curative→resection vs "
            "preservation). reference='Preservation only if it does not compromise oncologic clearance'. judge→ "
            "'Concordant'(ok) when the documented curative-resection intent aligns with that standard; if no "
            "preservation option is documented, action='No preservation pathway documented — confirm standard "
            "resection is intended' (do NOT leave 'No action.').\n"
            "- Lymph Node Dissection Recommendation: from procedureName + remarks (nodal/frozen-section) + mdtComments. "
            "reference=the nodal-clearance standard for THIS site (e.g. the recognised lymphadenectomy field / node "
            "yield target). judge→'Concordant'(ok) if the planned dissection meets it; 'Review'(watch) otherwise.\n"
            "- Reconstruction Planning: from remarks (anastomosis/conduit/stapler/expander). reference='Reconstruction "
            "appropriate to the resection performed'. judge→'Planned'(ok) if a coherent plan is stated; else "
            "'Not available' with action='Confirm reconstruction plan'.\n"
            "- Surgical Approach: booking approach + remarks (positioning, open/laparoscopic/thoracotomy/robotic) + "
            "procedureName. reference='Minimally-invasive is standard-of-care for resectable disease where expertise "
            "permits (NCCN)'. judge→'Concordant'(ok) if a MIS/appropriate approach is chosen with no stated "
            "contraindication; 'Review'(watch) if open is chosen for a reason worth surfacing; action states the "
            "one-line rationale (e.g. 'No action — approach aligns with MIS standard').\n"
            "- High-Risk Anatomy Identification: remarks (post-CRT fibrosis/friability, vessel/organ proximity) + "
            "highRiskMDT + tbSafetyFlags. reference='No threatened critical structure / margin at risk'. judge→ "
            "'Critical'/'Abnormal'(alert) or 'Review'(watch) when a specific hazard is named, with action = the "
            "mitigation; 'Clear'(ok) only if the record explicitly notes none.\n"
            "- Pre-op Imaging Review: PREFER the resulted `imaging_reports` — list which staging "
            "modalities have actually resulted (e.g. 'CT + PET-CT on file') and the key finding from each; "
            "add ctMri + clinicalStagingBasis + radTests ordered + radOrderStatus for anything still "
            "awaited. reference='Complete staging set before OR'. judge→'Complete'(ok) if the staging "
            "imaging set is resulted / on file; 'Pending'(watch) if staging imaging is ordered "
            "('none'/pending) but not yet resulted, action names what is awaited.\n"
            "- Multidisciplinary Surgical Planning: PREFER tbContributingSpecialties (who attended) + tbApprovals "
            "(per-specialty sign-off, esp. Surgical Oncology) + tbPlanStatus + tbSurgicalStep.status; add highRiskMDT "
            "+ mdtComments. reference='MDT sign-off on file'. judge→'Approved'/'Concordant'(ok) if MDT-reviewed & "
            "signed off; 'Pending'(watch) if planned/awaiting sign-off.\n"
            "- Surgical Guideline Recommendation: PREFER tbSurgicalStep.guideline + tbSequenceRationale; else the "
            "pathway named in mdtComments; else name the recognised guideline for THIS site (reference), but do NOT "
            "claim the record cites it. reference=the guideline (e.g. 'NCCN <site>'). judge→'Concordant'(ok) if the "
            "documented plan matches the guideline pathway for the stage/response; 'Review'(watch) if it deviates.\n"
            "- Personalized Surgical Strategy: synthesise the patient-specific plan from tbSurgicalStep (plan + timing "
            "+ dependsOnStep) + remarks + mdtComments. reference='Individualised to stage + anatomy + response'. "
            "judge→'Complete'(ok) if a coherent patient-specific strategy is on file; else 'Review'(watch).\n"
            "- Pre-operative Planning Summary: ONE concise sentence combining tbSequenceRationale + mdtComments + "
            "preOperativeRemarks + remarks. reference='Planning complete before OR booking'. judge→'Complete'(ok) if "
            "planning is done; 'Pending'(watch) with action naming the outstanding item if not.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
