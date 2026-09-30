"""m11 — Surgical Pathology Intelligence.

Structured validation of the pathology REPORT itself: synoptic completeness, missing
parameters, tumor regression grade, margin mapping, LVI/PNI, biomarker extraction,
molecular correlation, histology variant.

This module is about the QUALITY & STRUCTURE of the pathology report, so its primary
source is the pathology department's STRUCTURED case — `state["pathology_case"]`
(synoptic CAP fields + tnm.latest AJCC staging). The uploaded `pathology_documents`
(free-text HPR) are a secondary source. When neither exists, the surgeon's intra-op
`management` staging is a thin fallback and most validator rows honestly read
'Awaiting formal pathology' — the report can't be validated if it doesn't exist yet.
Never fabricate a pathology parameter.

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m11 is DECISION SUPPORT, not transcription. Each validator/extraction row names the
  expected STANDARD in `reference` (CAP synoptic complete, Mandard/CAP TRG scale, LVI/PNI
  reported, site-appropriate biomarkers) and judges the report against it. HARD BOUNDARY
  (same as m7): every pathology fact — synoptic fields, grade, TRG, biomarkers, LVI/PNI —
  comes STRICTLY from pathology_case / pathology_documents; only the general standard in
  `reference` is trained knowledge. If has_formal_pathology is FALSE the FINDING stays
  'Awaiting formal pathology' (neutral) while reference + action are still filled, so the
  Reference/Expected column shows WHAT the report is expected to contain.

Sources (all read-only, active booking + pathology):
  - `pathology_case` : synoptic {procedure, tumor_site, histologic_type, grade,
                       tumor_greatest_dimension_cm, depth_of_invasion, margins,
                       total_nodes_examined, positive_nodes, lymphovascular_invasion,
                       perineural_invasion, tumor_deposits}, tnm {pT/pN/pM, final_stage,
                       tnm_code, final_diagnosis} — the structured report to validate.
  - `pathology_documents` : raw_markdown, parameterwise_markdown, parameterwise_content,
                            sections, parameters — the uploaded report, secondary.
  - `management` (fallback) : stagingT/N/M, resection, margins, frozenReport, tumourSize,
                              findings, postOperativeDiagnosis.
  - `booking.preOpDiagnosis` : histology context (adenocarcinoma etc.).
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class PathologyIntelAgent(BaseDashboardAgent):
    MODULE_ID = "m11"
    TITLE = "Surgical Pathology Intelligence"
    PARAMETERS = [
        "Synoptic Pathology Validator",
        "Missing Pathology Parameter Detection",
        "Tumor Regression Grade",
        "Margin Mapping Visualization",
        "Lymphovascular & Perineural Invasion",
        "Biomarker Extraction Engine",
        "Molecular Report Correlation",
        "Histology Variant Recognition",
        "Pathology Completeness Dashboard",
        "Structured Pathology Intelligence Report",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        mgmt = active.get("management") or {}
        path_docs = state.get("pathology_documents") or []
        pathology_case = state.get("pathology_case") or {}

        # Carry the fuller structured text for m11 — it validates report CONTENT, so it
        # gets parameterwise_content (dated, structured) in addition to the markdown.
        slim_docs = []
        for d in path_docs:
            slim_docs.append({
                "investigation": d.get("investigation"),
                "date_of_order": d.get("date_of_order"),
                "parameters": d.get("parameters"),
                "raw_markdown": d.get("raw_markdown"),
                "parameterwise_markdown": d.get("parameterwise_markdown"),
                "parameterwise_content": d.get("parameterwise_content"),
                "sections": d.get("sections"),
            })

        return {
            # formal pathology exists if the structured synoptic case OR an uploaded HPR is present
            "has_formal_pathology": bool(pathology_case) or bool(path_docs),

            # --- AUTHORITATIVE structured synoptic + TNM (pathology dept) ---
            "pathology_case": pathology_case,

            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),

            # --- intra-op staging (fallback when no formal HPR) ---
            "stagingT": mgmt.get("stagingT", ""),
            "stagingN": mgmt.get("stagingN", ""),
            "stagingM": mgmt.get("stagingM", ""),
            "resection": mgmt.get("resection", ""),
            "margins": mgmt.get("margins", []),
            "frozen": mgmt.get("frozen", ""),
            "frozenReport": mgmt.get("frozenReport", ""),
            "tumourSize": mgmt.get("tumourSize", ""),
            "findings": mgmt.get("findings", ""),
            "postOperativeDiagnosis": mgmt.get("postOperativeDiagnosis", ""),

            # --- the uploaded report to validate (secondary) ---
            "pathology_documents": slim_docs,
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m11 specifically: this module VALIDATES and EXTRACTS from the pathology REPORT. Its main "
            "source is the STRUCTURED pathology_case (pathology_case.synoptic = CAP fields; pathology_case.tnm "
            "= AJCC staging); the uploaded pathology_documents are secondary. Every pathology fact comes "
            "STRICTLY from the DATA — never fabricate a parameter, grade, or biomarker. If has_formal_pathology "
            "is FALSE the report does not exist yet: the FINDING reads 'Awaiting formal pathology' "
            "(status='neutral') and you may only reflect the surgeon's intra-op staging where noted — but STILL "
            "name the expected standard in 'reference' and the next step in 'action', so the Reference/Expected "
            "column shows WHAT the report should contain.\n\n"
            "PARAMETER GUIDANCE — [finding source, record-only] · reference=[standard] · judge→[pill/action]. "
            "finding='Awaiting formal pathology' if has_formal_pathology is FALSE (still fill reference + action):\n"
            "- Synoptic Pathology Validator: check pathology_case.synoptic (else the HPR) has the expected "
            "synoptic elements (procedure/specimen, tumor_site, histologic_type, grade, depth_of_invasion, "
            "margins, total_nodes_examined, stage). reference='CAP synoptic protocol complete'. judge→'Complete'"
            "(ok) if all elements present, 'Review'(watch) if partial, neutral if none.\n"
            "- Missing Pathology Parameter Detection: LIST which expected synoptic parameters are absent from "
            "pathology_case.synoptic/tnm (e.g. missing grade, node count, margin distance). reference='No missing "
            "CAP-required fields'. judge→'Complete'(ok) if nothing missing, 'Review'(watch) naming the gaps; if no "
            "report, finding='Awaiting formal pathology'.\n"
            "- Tumor Regression Grade: extract TRG (Mandard / CAP TRG) ONLY if stated — relevant post-neoadjuvant. "
            "reference='Mandard/CAP TRG reported post-neoadjuvant'. judge→'Noted'(neutral) reporting the grade; "
            "'Not available' if absent (action='Request TRG on the post-neoadjuvant specimen').\n"
            "- Margin Mapping Visualization: describe margin status per site from pathology_case.synoptic "
            "(proximal/distal/circumferential margin_status + distance_cm), else management margins/frozenReport. "
            "reference='All margins clear (R0), distance reported'. judge→'Normal'(ok) if all clear, "
            "'Critical'(alert) if any involved.\n"
            "- Lymphovascular & Perineural Invasion: report LVI/PNI from pathology_case.synoptic "
            "(lymphovascular_invasion, perineural_invasion) ONLY if stated (present/absent). reference='LVI & PNI "
            "status reported'. judge→'Normal'(ok) if both absent, 'Review'(watch) or 'Critical'(alert) if present "
            "(adverse feature); 'Not available' if not stated.\n"
            "- Biomarker Extraction Engine: extract biomarkers/IHC (HER2, PD-L1, MMR/MSI) from pathology_case/"
            "pathology_documents (parameterwise_content/entities). reference='Site-appropriate biomarkers "
            "reported'. judge→'Noted'(neutral) reporting results; 'Review'(watch) if a panel is pending; 'Not "
            "available' if none. Do NOT invent values.\n"
            "- Molecular Report Correlation: correlate molecular findings with histology ONLY if molecular data "
            "present. reference='Molecular results correlated with histology'. judge→'Noted'(neutral) if "
            "correlated; 'Not available' if no molecular data.\n"
            "- Histology Variant Recognition: the histological type/variant + grade (e.g. 'moderately "
            "differentiated adenocarcinoma') from pathology_case.synoptic.histologic_type/grade, else the HPR / "
            "diagnoses. reference='Histologic type & grade documented'. judge→'Noted'(neutral) reporting the "
            "variant; 'Not available' if absent.\n"
            "- Pathology Completeness Dashboard: overall completeness — 'Complete' (structured synoptic case "
            "present), 'Partial' (only intra-op staging), or 'Pending' (nothing). reference='Structured synoptic "
            "report on file'. judge→'Complete'(ok) / 'Review'(watch) / 'Pending'(watch) accordingly.\n"
            "- Structured Pathology Intelligence Report: one concise synthesis line of the pathology picture "
            "(histology + stage + margins + key features), or 'Awaiting formal pathology'. reference='Complete "
            "structured pathology intelligence'. judge→'Complete'(ok) if a full picture is on file.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
