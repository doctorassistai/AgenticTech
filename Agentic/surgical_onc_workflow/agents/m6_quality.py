"""m6 — Surgical Quality & Outcome Analytics.

This case's outcome metrics, framed for benchmarking against unit / national standards:
resection completeness, margin distance, node-harvest quality, complication burden,
M&M, re-operation, length of stay, and ERAS compliance.

Mostly a re-projection of data other agents already read — but into a quality-metric
frame (targets & benchmarks in `reference`):
  - `pathology_case` : the pathology dept's STRUCTURED synoptic (authoritative) — per-site
                   margin_status + distance_cm, total_nodes_examined / positive_nodes,
                   tumor size, AJCC pTNM / final_stage. Primary source for the margin /
                   node / R-status quality metrics (same source m4/m11 use).
  - `management` : resection (R0/R1/R2), margins, tumourSize, stagingT/N, bloodLoss,
                   duration, woundClass, drains.
  - `post_op`    : complications[], clavienDindo, readmit30/90, mortality30/90.
  - `pathology_documents` : raw HPR markdown — fallback node counts / margin distance.
  - `discharge`  : admissionDate / dischargeDate (length of stay — empty until discharged).

Benchmarks (esophagectomy, in `reference`): R0 target, node yield >=15, mortality <5%,
anastomotic-leak/complication reference. Report ACTUAL values only — never invent a
benchmark comparison when the metric itself is 'Not available'.

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m6 is DECISION SUPPORT, not transcription. It already frames targets/benchmarks in
  `reference`; the rollout formalises the JUDGEMENT — each metric's pill reflects whether
  the ACTUAL value meets its benchmark (R0 met / node target met / no mortality). HARD
  BOUNDARY (same as m7): the metric values come STRICTLY from the record; only the
  benchmark in `reference` is trained knowledge; an absent metric stays 'Not available'
  (never a fabricated benchmark comparison) while reference + action are still filled.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class QualityAgent(BaseDashboardAgent):
    MODULE_ID = "m6"
    TITLE = "Surgical Quality & Outcome Analytics"
    PARAMETERS = [
        "R0/R1/R2 Resection",
        "Margin Distance Analytics",
        "Lymph Node Harvest Quality",
        "Surgical Quality Indicator Dashboard",
        "Complication Rate (this case)",
        "Mortality & Morbidity",
        "Re-operation Tracking",
        "Length of Stay Analytics",
        "Enhanced Recovery Compliance",
        "Surgical Performance Dashboard",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        mgmt = active.get("management") or {}
        post_op = active.get("post_op") or {}
        discharge = active.get("discharge") or {}
        path_docs = state.get("pathology_documents") or []

        # Keep pathology docs compact — only node/margin-bearing text.
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
            "procedureName": booking.get("procedureName", ""),

            # --- AUTHORITATIVE structured pathology (synoptic CAP + AJCC TNM) ---
            # The pathology dept's synoptic carries the clean, machine-readable margin
            # distances (proximal/distal/circumferential margin_status + distance_cm), node
            # counts (total_nodes_examined / positive_nodes) and stage — the SAME source m4/m11
            # use. m6 reads it FIRST for the margin / node / R-status quality metrics; the raw
            # pathology_documents + surgeon's operative margins remain a fallback.
            "pathology_case": state.get("pathology_case") or {},

            # --- resection / margin / node quality ---
            "resection": mgmt.get("resection", ""),
            "margins": mgmt.get("margins", []),
            "frozenReport": mgmt.get("frozenReport", ""),
            "tumourSize": mgmt.get("tumourSize", ""),
            "stagingT": mgmt.get("stagingT", ""),
            "stagingN": mgmt.get("stagingN", ""),
            "postOperativeDiagnosis": mgmt.get("postOperativeDiagnosis", ""),

            # --- operative quality metrics ---
            "bloodLoss": mgmt.get("bloodLoss", ""),
            "duration": mgmt.get("duration", ""),
            "woundClass": mgmt.get("woundClass", []),

            # --- complication burden / M&M ---
            "hasComplications": post_op.get("hasComplications", ""),
            "complications": post_op.get("complications", []),
            "complicationDescription": post_op.get("description", ""),
            "clavienDindo": post_op.get("clavienDindo", ""),
            "readmit30": post_op.get("readmit30", ""),
            "readmit90": post_op.get("readmit90", ""),
            "mortality30": post_op.get("mortality30", ""),
            "mortality90": post_op.get("mortality90", ""),
            "intraOpComplications": mgmt.get("intraOpComplications", []),

            # --- length of stay (empty until discharge documented) ---
            "admissionDate": discharge.get("admissionDate", ""),
            "dischargeDate": discharge.get("dischargeDate", ""),

            # --- ERAS elements (mirror of m5, for the compliance metric) ---
            "typeOfAnesthesia": mgmt.get("typeOfAnesthesia", []),
            "analgesiaPlan": mgmt.get("analgesiaPlan", ""),
            "dietInstructions": mgmt.get("dietInstructions", ""),
            "dvtProphylaxis": mgmt.get("dvtProphylaxis", ""),
            "postOperativePlan": mgmt.get("postOperativePlan", ""),

            # --- formal pathology (authoritative node / margin numbers) ---
            "pathology_documents": slim_docs,
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m6 specifically: report the case's ACTUAL metric values (STRICTLY from the DATA) and put "
            "the benchmark/target in 'reference'; the pill reflects whether the actual value MEETS the "
            "benchmark. Never invent a metric value or a benchmark comparison when the metric is absent. "
            "The AUTHORITATIVE source for margin / node / resection numbers is the structured "
            "pathology_case: pathology_case.synoptic holds the CAP fields (proximal/distal/circumferential "
            "margin_status + distance_cm, total_nodes_examined, positive_nodes, tumor_greatest_dimension_cm) "
            "and pathology_case.tnm the AJCC pT/pN/pM + final_stage — read it FIRST; pathology_documents "
            "(raw HPR) and the surgeon's operative fields (resection, margins, frozenReport) are fallbacks.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[benchmark] · judge→[pill/action]. "
            "'Not available' finding only if the source is empty (still fill reference + action):\n"
            "- R0/R1/R2 Resection: PREFER pathology_case.synoptic margins + pathology_case.tnm (a clear synoptic "
            "margin => R0); else management.resection. reference='R0 (complete resection) target'. "
            "judge→'Normal'(ok) if R0, 'Critical'(alert) if R1/R2.\n"
            "- Margin Distance Analytics: PREFER pathology_case.synoptic — report the closest margin as "
            "'<site> <distance_cm>' from the proximal/distal/circumferential margin distances (state each named "
            "margin distance available, and call out the closest). Fall back to a distance in pathology_documents / "
            "frozenReport only if the synoptic has none. reference='>1 mm clear'. judge→'Normal'(ok) if the "
            "closest margin is >1 mm clear, 'Review'(watch) if close (<1 mm), 'Critical'(alert) if involved (0 mm / "
            "'positive'). Report the distance ONLY from the record — do NOT fabricate a distance; if no margin "
            "distance is stated anywhere, finding='Not available' (action='Request margin distances on the synoptic').\n"
            "- Lymph Node Harvest Quality: PREFER pathology_case.synoptic.total_nodes_examined (with positive_nodes "
            "if present); else a node count in pathology_documents. reference='>=15 (esophagectomy; >=12 general)'. "
            "judge→'Normal'(ok) if target met, 'Review'(watch) if below, 'Not available' if no count.\n"
            "- Surgical Quality Indicator Dashboard: one line combining R-status + node yield + margin (all from "
            "pathology_case.synoptic where available) — the composite oncological-quality indicator for this case. "
            "reference='R0 + adequate nodes + clear margins'. "
            "judge→'Normal'(ok) if the composite meets standard; 'Review'(watch) if any component is short.\n"
            "- Complication Rate (this case): from hasComplications + complications[] + clavienDindo. This is a single "
            "case, so state the complication(s) that occurred (or 'None documented'), not a population rate. "
            "reference='Clavien 0-I favourable'. judge→'Normal'(ok) if none/minor; 'Review'/'Critical' by grade.\n"
            "- Mortality & Morbidity: from mortality30/90 + morbidity (complications/clavienDindo). reference='No "
            "30/90-day mortality; morbidity minimized'. judge→if mortality both 'No', finding='No 30/90-day "
            "mortality', 'Normal'(ok); summarise morbidity (e.g. 'Grade 2 pneumonia'); 'Critical'(alert) if "
            "mortality documented.\n"
            "- Re-operation Tracking: report a re-operation ONLY if complications/description mention a return to theatre; "
            "otherwise finding='No re-operation documented'. reference='No unplanned re-operation'. judge→'Normal'"
            "(ok) if none; 'Critical'(alert) if a return to theatre occurred.\n"
            "- Length of Stay Analytics: compute from admissionDate -> dischargeDate ONLY if BOTH are present. If either is "
            "empty, finding='Not available' (patient not yet discharged), neutral. reference='LOS within expected for "
            "procedure'. judge→'Normal'(ok) if within expected; 'Review'(watch) if prolonged.\n"
            "- Enhanced Recovery Compliance: same ERAS elements as m5 (epidural, VTE prophylaxis, early nutrition, care "
            "plan) framed as a compliance metric. reference='ERAS core elements met (target >=90%)'. judge→'Normal'"
            "(ok) if core elements present; 'Review'(watch) if sparse.\n"
            "- Surgical Performance Dashboard: one concise sentence — operative metrics (blood loss, duration) + oncological "
            "quality (R-status, nodes) + outcome (complication grade). reference='EBL / op-time / oncologic quality "
            "within benchmark'. judge→'Normal'(ok) if within benchmark; 'Review'(watch) otherwise.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
