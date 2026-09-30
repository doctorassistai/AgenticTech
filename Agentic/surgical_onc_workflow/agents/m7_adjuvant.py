"""m7 — Adjuvant Therapy Decision Support  (FLAGSHIP · Adjuvant Recommendation).

Once pathology triggers a re-discussion (m4), this module assembles the evidence-based
adjuvant recommendation the MDT will review: chemo / radiotherapy / combined-modality,
high-risk features, residual disease, recurrence risk, and guideline compliance.

DESIGN (user decision — "LLM clinical knowledge"):
  The LLM MAY apply its trained oncology guideline knowledge (NCCN / ESMO-style adjuvant
  logic) to REASON about the case and SUGGEST a recommendation. The hard boundary:
    * The clinical FACTS that drive the recommendation — pTNM/ypTNM, resection status,
      margins, node status, LVI/PNI, neoadjuvant history — come STRICTLY from the record.
      The agent must not invent staging, node counts, or margin status.
    * Every recommendation is framed "for MDT review" — a decision-support suggestion,
      never a directive, and never invented drug doses/cycles unless the record states them.
    * If the pathology facts needed to decide are absent, defer: "Awaiting pathology —
      recommendation pending MDT review".

Sources:
  - `booking.preOpDiagnosis`, `pac.otherHistory` : diagnosis + full neoadjuvant history
    (this patient completed CROSS-protocol CRT pre-op -> post-neoadjuvant adjuvant logic).
  - `pathology_case` : the pathology dept's STRUCTURED facts — tnm {pT/pN/pM, final_stage,
    final_diagnosis} + synoptic {margins, total_nodes_examined, positive_nodes,
    lymphovascular_invasion, perineural_invasion, grade} — the primary basis for the
    recommendation.
  - `management` : ypTNM (stagingT/N/M), resection, margins, intentOfProcedure, findings,
    postOperativeDiagnosis — the surgeon's pathological outcome (fallback).
  - `pathology_documents` : uploaded HPR (grade, LVI/PNI, nodes, biomarkers) when present.
  - `booking.mdtComments` + `discharge.adjuvantPlan` : any adjuvant plan already recorded.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class AdjuvantAgent(BaseDashboardAgent):
    MODULE_ID = "m7"
    TITLE = "Adjuvant Therapy Decision Support"
    PARAMETERS = [
        "Surgery vs. Pathology Correlation",
        "Adjuvant Chemotherapy Recommendation",
        "Adjuvant Radiotherapy Recommendation",
        "Combined Modality Recommendation",
        "High-Risk Feature Identification",
        "Residual Disease Assessment",
        "Recurrence Risk Prediction",
        "Guideline Compliance Analysis",
        "MDT Recommendation Generator",
        "Adjuvant Planning Dashboard",
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
                "raw_markdown": d.get("raw_markdown"),
                "parameterwise_markdown": d.get("parameterwise_markdown"),
            })

        return {
            # --- diagnosis + neoadjuvant history (drives 'adjuvant vs already-treated') ---
            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),
            "otherHistory": pac.get("otherHistory", ""),          # full neoadjuvant CRT narrative
            "preOperativeRemarks": pac.get("preOperativeRemarks", ""),
            "mdtComments": booking.get("mdtComments", ""),
            "highRiskMDT": booking.get("highRiskMDT", ""),

            # --- AUTHORITATIVE pathology facts (pTNM, nodes, margins, LVI/PNI, grade) ---
            "pathology_case": state.get("pathology_case") or {},

            # --- pathological outcome (fallback facts from the operative record) ---
            "stagingT": mgmt.get("stagingT", ""),
            "stagingN": mgmt.get("stagingN", ""),
            "stagingM": mgmt.get("stagingM", ""),
            "resection": mgmt.get("resection", ""),
            "margins": mgmt.get("margins", []),
            "intentOfProcedure": mgmt.get("intentOfProcedure", ""),
            "findings": mgmt.get("findings", ""),
            "postOperativeDiagnosis": mgmt.get("postOperativeDiagnosis", ""),

            # --- adjuvant plan already on record (if any) ---
            "adjuvantPlan": discharge.get("adjuvantPlan", ""),

            # --- uploaded HPR (grade, LVI/PNI, nodes, biomarkers) ---
            "pathology_documents": slim_docs,
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = (
            "This is the flagship ADJUVANT THERAPY DECISION-SUPPORT module. You MAY apply your "
            "oncology guideline knowledge (NCCN / ESMO-style adjuvant logic) to REASON about this "
            "case and SUGGEST an adjuvant recommendation for the MDT to review.\n"
            "HARD BOUNDARIES (do not cross):\n"
            "  * The clinical FACTS — pTNM/ypTNM, resection status, margins, node status, LVI/PNI, "
            "neoadjuvant history — must come ONLY from the DATA, PRIMARILY the structured pathology_case "
            "(pathology_case.tnm for pT/pN/pM + final_stage; pathology_case.synoptic for margins, "
            "total_nodes_examined, positive_nodes, lymphovascular_invasion, perineural_invasion, grade), "
            "then management staging / the HPR. Never invent staging, counts, or margins.\n"
            "  * Frame EVERY recommendation as a suggestion 'for MDT review', never a directive. Do NOT "
            "invent specific drug doses or cycle numbers unless the DATA states them; name a regimen CLASS "
            "(e.g. 'adjuvant chemotherapy', 'immunotherapy per CheckMate-577') and put the guideline in 'reference'.\n"
            "  * If the pathology facts needed to decide are ABSENT, defer: finding='Awaiting pathology — "
            "recommendation pending MDT review', status='neutral'. Do not guess.\n"
            "  * IMPORTANT neoadjuvant nuance: if otherHistory shows the patient ALREADY received neoadjuvant "
            "chemoradiotherapy (e.g. CROSS protocol) before surgery, an adjuvant recommendation must account for "
            "that (e.g. adjuvant immunotherapy for residual disease post-neoadjuvant CRT + R0, per CheckMate-577); "
            "do not recommend repeating completed neoadjuvant therapy.\n\n"
            "PARAMETER GUIDANCE ('Not available' / 'Awaiting pathology' if the source is empty):\n"
            "- Surgery vs. Pathology Correlation: state cTNM (preOpDiagnosis) vs ypTNM (pathology_case.tnm, "
            "else staging fields / HPR) and whether they concord — the pathology basis the recommendation rests on.\n"
            "- Adjuvant Chemotherapy Recommendation: suggest FOR/AGAINST adjuvant chemo with a one-line rationale "
            "tied to the facts (node status, margins, response). reference=guideline (e.g. 'NCCN Esophageal'). "
            "status='flag' if adjuvant therapy is indicated, 'ok' if not indicated, 'neutral' if awaiting pathology.\n"
            "- Adjuvant Radiotherapy Recommendation: similar; note if RT was already given neoadjuvantly. If "
            "adjuvantPlan already records a radiotherapy plan, reflect it.\n"
            "- Combined Modality Recommendation: whether chemo+RT (or chemo+immunotherapy) is suggested together.\n"
            "- High-Risk Feature Identification: list the ACTUAL high-risk features present (positive nodes "
            "from synoptic.positive_nodes, +margin/R1, LVI/PNI from synoptic, high grade, upstaging). Only those "
            "documented. status='flag' if any present.\n"
            "- Residual Disease Assessment: from resection (R0=no residual) / HPR residual-tumour comment.\n"
            "- Recurrence Risk Prediction: a qualitative band (low/intermediate/high) justified by the documented "
            "high-risk features — NOT a fabricated percentage. status reflects the band.\n"
            "- Guideline Compliance Analysis: whether the care pathway aligns with guideline (neoadjuvant CRT then "
            "surgery then adjuvant per stage). reference=guideline name.\n"
            "- MDT Recommendation Generator: the single consolidated recommendation sentence for the MDT to review.\n"
            "- Adjuvant Planning Dashboard: one concise summary line — recommended modality + key driver + next step "
            "(e.g. 'MDT to confirm adjuvant immunotherapy given ypN+ R0 post-CROSS').\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
