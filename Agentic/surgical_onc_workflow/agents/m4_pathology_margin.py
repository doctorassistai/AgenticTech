"""m4 — Pathology Correlation & Margin Intelligence  (FLAGSHIP · Stage Discordance).

Compares the pre-operative CLINICAL stage (cTNM, from the booking diagnosis) against
the PATHOLOGICAL stage (pTNM/ypTNM) once pathology is available, and reads margin /
node / residual-disease intelligence.

Three pathological sources, in priority order:
  1. The pathology department's STRUCTURED case — `state["pathology_case"]`
     (synoptic CAP fields + tnm.latest AJCC staging + grossing) — the authoritative
     post-operative synoptic report. This is the primary, machine-readable source.
  2. The completed pathology/HPR document(s) — `state["pathology_documents"]`
     (raw_markdown / sections / parameters) — the uploaded report, secondary.
  3. The surgeon's intra-op staging in `management` (stagingT/N/M, resection, margins,
     frozenReport) — a fallback when neither of the above exists yet.

If no pathological source exists, pTNM-dependent rows are 'Not available' and the
discordance engine reports 'Awaiting pathology' rather than inventing a comparison.

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m4 is the flagship DECISION-SUPPORT module. Each row names the expected STANDARD in
  `reference` (AJCC 8th, R0 / margins clear, CAP synoptic, site-specific node target) and
  judges the finding against it — this is exactly the discordance reasoning m4 already
  does. HARD BOUNDARY (same as m7): every pathological fact — pTNM, margin status, node
  counts, biomarkers — comes STRICTLY from pathology_case / pathology_documents / the
  surgeon's staging; only the general standard in `reference` is trained knowledge. The
  flagship pill logic is UNCHANGED: genuine upstaging/downstaging/positive-margin/MDT-
  trigger rows keep status='flag'/'alert' as specified below.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class PathologyMarginAgent(BaseDashboardAgent):
    MODULE_ID = "m4"
    TITLE = "Pathology Correlation & Margin Intelligence"
    PARAMETERS = [
        "Clinical vs. Pathological Stage",
        "Margin Status Analysis",
        "Positive Margin Detection",
        "Upstaging / Downstaging Detection",
        "Residual Disease Assessment",
        "Lymph Node Yield",
        "Lymph Node Ratio",
        "Histopathology Summarization",
        "Molecular Pathology Integration",
        "Biomarker Correlation",
        "Pathology Quality Validation",
        "Synoptic Report Completeness",
        "MDT Re-discussion Trigger",
        "Adjuvant Therapy Trigger",
        "Surgical Outcome Summary",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        mgmt = active.get("management") or {}
        path_docs = state.get("pathology_documents") or []

        # Keep the pathology documents compact for the prompt (drop null fields).
        slim_docs = []
        for d in path_docs:
            slim_docs.append({
                "investigation": d.get("investigation"),
                "date_of_order": d.get("date_of_order"),
                "parameters": d.get("parameters"),
                "raw_markdown": d.get("raw_markdown"),
                "parameterwise_markdown": d.get("parameterwise_markdown"),
            })

        return {
            # --- clinical stage (pre-op) ---
            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),

            # --- AUTHORITATIVE pathology dept case (synoptic CAP + AJCC TNM) ---
            "pathology_case": state.get("pathology_case") or {},

            # --- pathological stage / margins from the surgeon's operative record ---
            "stagingT": mgmt.get("stagingT", ""),
            "stagingN": mgmt.get("stagingN", ""),
            "stagingM": mgmt.get("stagingM", ""),
            "resection": mgmt.get("resection", ""),
            "margins": mgmt.get("margins", []),
            "frozen": mgmt.get("frozen", ""),
            "frozenReport": mgmt.get("frozenReport", ""),
            "tumourSize": mgmt.get("tumourSize", ""),
            "locationOfTumor": mgmt.get("locationOfTumor", ""),
            "findings": mgmt.get("findings", ""),
            "specimensSent": mgmt.get("specimensSent", ""),
            "materialsForwarded": mgmt.get("materialsForwarded", ""),
            "postOperativeDiagnosis": mgmt.get("postOperativeDiagnosis", ""),
            "intentOfProcedure": mgmt.get("intentOfProcedure", ""),

            # --- the uploaded pathology / HPR document(s), if completed ---
            "pathology_documents": slim_docs,
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m4 specifically (the STAGE DISCORDANCE flagship): every pathological fact comes "
            "STRICTLY from the DATA. The AUTHORITATIVE pathological source is "
            "pathology_case (the pathology department's structured case): pathology_case.tnm holds the "
            "AJCC pTNM (t_stage/n_stage/m_stage, tnm_code, final_stage, final_diagnosis) and "
            "pathology_case.synoptic holds the CAP synoptic fields (histologic_type, grade, "
            "tumor_greatest_dimension_cm, depth_of_invasion, proximal/distal/circumferential margin "
            "status+distance, total_nodes_examined, positive_nodes, lymphovascular_invasion, "
            "perineural_invasion). Use it FIRST. Fall back to pathology_documents (uploaded HPR), then "
            "to the management staging fields (stagingT/N/M, resection, margins, frozenReport).\n\n"
            "PARAMETER GUIDANCE (where to look; 'Not available' if the source is empty):\n"
            "- Clinical vs. Pathological Stage: extract cTNM from preOpDiagnosis and pTNM (or ypTNM after "
            "neoadjuvant) from pathology_case.tnm (t_stage/n_stage/m_stage/tnm_code) — else pathology_documents/"
            "management staging — and state both (e.g. 'cT3 N1-2 M0 -> ypT3 N1 M0'). "
            "If pathology is absent, finding='Awaiting pathology', status='neutral'. reference='AJCC 8th'.\n"
            "- Margin Status Analysis: from pathology_case.synoptic proximal/distal/circumferential "
            "margin_status (+ distance_cm), else management margins + resection. reference='R0 / margins clear'. "
            "status='ok' if all clear/R0.\n"
            "- Positive Margin Detection: status='alert' + statusLabel='Positive' ONLY if a synoptic margin_status "
            "is positive/involved (or R1/R2); otherwise finding='No positive margin', status='ok'.\n"
            "- Upstaging / Downstaging Detection: compare cTNM (preOpDiagnosis) vs pTNM (pathology_case.tnm). If "
            "pathology raises stage => 'Upstaged' status='flag'; lowers => 'Downstaged'; same => 'Concordant' "
            "status='ok'. If no pathology => 'Not available'. This is the flagship trigger — use status='flag' for "
            "a genuine discordance.\n"
            "- Residual Disease Assessment: from resection (R0=no residual) / synoptic margins / pathology residual "
            "tumour comment.\n"
            "- Lymph Node Yield: pathology_case.synoptic.total_nodes_examined (else node count in pathology_documents). "
            "reference varies by site (e.g. esophagectomy target >=15). status='watch' if below target. 'Not "
            "available' if node count absent.\n"
            "- Lymph Node Ratio: synoptic.positive_nodes / synoptic.total_nodes_examined, ONLY if both counts are "
            "present; else Not available. Do NOT fabricate counts.\n"
            "- Histopathology Summarization: concise summary from pathology_case.synoptic (histologic_type, grade, "
            "depth_of_invasion, LVI/PNI) + final_diagnosis; if no case, use the HPR / surgeon's findings.\n"
            "- Molecular Pathology Integration: molecular/genetic results (e.g. MSI, HER2) ONLY if present in "
            "pathology_case/pathology_documents; else Not available.\n"
            "- Biomarker Correlation: IHC/biomarker results ONLY if present; else Not available.\n"
            "- Pathology Quality Validation: whether the report has the expected elements (margins, nodes, grade, stage). "
            "status='ok' if complete.\n"
            "- Synoptic Report Completeness: 'Complete' if a structured synoptic report exists "
            "(pathology_case.synoptic populated); 'Pending' if surgery done but no synoptic/HPR yet; "
            "reference='CAP synoptic'.\n"
            "- MDT Re-discussion Trigger: status='flag' + action to return to MDT if upstaging, positive margin, or LVI is found; "
            "else 'Not triggered', status='ok'.\n"
            "- Adjuvant Therapy Trigger: status='flag' if pathology indicates adjuvant therapy (positive nodes, upstaging, R1); "
            "else 'Not indicated' / 'Awaiting pathology'. (Full recommendation is m7.)\n"
            "- Surgical Outcome Summary: one concise sentence — resection completeness + margins + key pathological finding.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
