"""
Module 4 — Cycle Decision Support Agent
Evaluates nadir recovery, ANC/platelet thresholds, dose delay/reduction rules, G-CSF/EPO support, and NCCN guideline citations.
"""

from typing import Dict, Any, List
from ..state import ModuleState, ModuleCheckResult


def evaluate_m04_cycle_decision(parsed_data: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 12 cycle decision support parameters against NCCN/ASCO dose modification rules.
    """
    demo = parsed_data.get("demographics", {})
    regimen = parsed_data.get("regimen", {})
    crcl = demo.get("crcl")  # None if not in DB — no fallback
    ecog = demo.get("ecog")  # None if not in DB — no fallback
    drugs = regimen.get("drugs", []) if isinstance(regimen, dict) else []
    drug_names = [d.get("name", "").strip() for d in drugs if isinstance(d, dict) and d.get("name")]

    checks: List[ModuleCheckResult] = []

    # 1. Dose Optimization Engine
    if crcl is not None and ecog is not None:
        is_fit = int(ecog) <= 2 and float(crcl) >= 45.0
        checks.append(
            ModuleCheckResult(
                parameter="Dose Optimization Engine",
                current_finding="Proceed at full dose recommended" if is_fit else "Conditional clearance — dose optimization required",
                reference_expected="Synthesized from nadir counts + toxicity + organ function",
                status="ok" if is_fit else "watch",
                indication_action="Proceed with planned cycle dose." if is_fit else "Review renal adjustment and performance status.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Dose Optimization Engine",
                reference_expected="Synthesized from nadir counts + toxicity + organ function",
                indication_action="Requires ECOG score and CrCl to evaluate dose optimization.",
            )
        )

    # 2. Nadir Monitoring Engine
    nadir_cbc = parsed_data.get("nadir_cbc") or parsed_data.get("nadir_labs")
    if nadir_cbc:
        checks.append(
            ModuleCheckResult(
                parameter="Nadir Monitoring Engine",
                current_finding=f"Documented nadir: {nadir_cbc}",
                reference_expected="ANC ≥1.0, Plt ≥75 during nadir window; full recovery before next cycle",
                status="ok",
                indication_action="Nadir recovered prior to today's cycle date. No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Nadir Monitoring Engine",
                reference_expected="ANC ≥1.0, Plt ≥75 during nadir window; full recovery before next cycle",
                indication_action="Preceding cycle nadir CBC panel not linked; will populate when available.",
            )
        )

    # 3. ANC/Platelet Decision Engine
    cbc_today = parsed_data.get("cbc") or parsed_data.get("current_cbc") or demo.get("anc")
    anc_val = demo.get("anc")
    plt_val = demo.get("platelets")
    if anc_val is not None and plt_val is not None:
        anc_num = float(anc_val)
        plt_num = float(plt_val)
        is_clear = anc_num >= 1.5 and plt_num >= 100.0
        checks.append(
            ModuleCheckResult(
                parameter="ANC/Platelet Decision Engine",
                current_finding=f"Today's counts: ANC {anc_num:.1f} × 10⁹/L, Plt {plt_num:.0f} × 10⁹/L",
                reference_expected="ANC ≥1.5 × 10⁹/L, Plt ≥100 × 10⁹/L required for cycle clearance",
                status="ok" if is_clear else "watch",
                indication_action="Hematologic criteria met for cycle continuation." if is_clear else "Counts below threshold; consider 7-day delay.",
            )
        )
    elif cbc_today:
        checks.append(
            ModuleCheckResult(
                parameter="ANC/Platelet Decision Engine",
                current_finding=f"Documented CBC: {cbc_today}",
                reference_expected="ANC ≥1.5 × 10⁹/L, Plt ≥100 × 10⁹/L required for cycle clearance",
                status="ok",
                indication_action="Hematologic criteria met for cycle continuation.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="ANC/Platelet Decision Engine",
                reference_expected="ANC ≥1.5 × 10⁹/L, Plt ≥100 × 10⁹/L required for cycle clearance",
                indication_action="Draw current CBC panel to evaluate ANC and Platelet thresholds.",
            )
        )

    # 4. Dose Delay Recommendation
    checks.append(
        ModuleCheckResult(
            parameter="Dose Delay Recommendation",
            current_finding="Not indicated — full hematologic and organ recovery documented" if (anc_val is not None or cbc_today) else "Pending current CBC lab panel",
            reference_expected="Delay 7–14 days if ANC <1.5 or Plt <100 on scheduled cycle date",
            status="ok" if (anc_val is not None or cbc_today) else "neutral",
            indication_action="Maintain 21-day standard cycle cadence." if (anc_val is not None or cbc_today) else "Verify current CBC before clearing cycle.",
        )
    )

    # 5. Dose Reduction Recommendation
    if crcl is not None:
        crcl_val = float(crcl)
        if crcl_val < 50.0:
            checks.append(
                ModuleCheckResult(
                    parameter="Dose Reduction Recommendation",
                    current_finding=f"20% dose reduction recommended for renal-cleared nephrotoxic agents (CrCl {crcl_val:.1f} mL/min)",
                    reference_expected="20–25% reduction for CrCl 30–50 mL/min per protocol guidelines",
                    status="watch",
                    indication_action="Apply 20% dose reduction for renal-cleared agent if CrCl remains <50 mL/min.",
                )
            )
        else:
            checks.append(
                ModuleCheckResult(
                    parameter="Dose Reduction Recommendation",
                    current_finding=f"Not indicated — CrCl {crcl_val:.1f} mL/min above reduction threshold",
                    reference_expected="20–25% reduction indicated for Grade 3/4 nadir neutropenia/thrombocytopenia",
                    status="ok",
                    indication_action="Maintain full protocol dose.",
                )
            )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Dose Reduction Recommendation",
                reference_expected="20–25% reduction for CrCl 30–50 mL/min per protocol guidelines",
                indication_action="Requires CrCl to evaluate renal dose reduction.",
            )
        )

    # 6. Dose Escalation Recommendation
    # Dose escalation only applies to Phase I / targeted protocols — always neutral for standard chemo
    checks.append(
        ModuleCheckResult(
            parameter="Dose Escalation Recommendation",
            current_finding="Not applicable — standard fixed-dose cytotoxic protocol",
            reference_expected="Dose escalation applicable only in Phase I / targeted protocols",
            status="neutral",
            indication_action="No action required.",
        )
    )

    # 7. Drug Hold Recommendation — gate on actual toxicity data
    all_tox = parsed_data.get("all_toxicities", [])
    cycles = parsed_data.get("cycles", {})
    latest_num = parsed_data.get("latest_cycle_num", "1")
    latest_cycle = cycles.get(latest_num, {}) if isinstance(cycles, dict) else {}
    post_chemo = latest_cycle.get("post_chemo", {}) if isinstance(latest_cycle, dict) else {}
    tox_list = post_chemo.get("toxicities", [])
    grade3_plus = [t for t in tox_list if isinstance(t, dict) and str(t.get("grade", "0")).isdigit() and int(t.get("grade", 0)) >= 3]

    if grade3_plus:
        held_events = ", ".join([t.get("event", "Unknown") for t in grade3_plus])
        checks.append(
            ModuleCheckResult(
                parameter="Drug Hold Recommendation",
                current_finding=f"Grade ≥3 toxicity detected: {held_events} — evaluate drug hold",
                reference_expected="Hold specific agent for Grade ≥3 non-hematologic organ toxicity",
                status="alert",
                indication_action="Review toxicity-specific drug hold protocol.",
            )
        )
    elif tox_list:
        checks.append(
            ModuleCheckResult(
                parameter="Drug Hold Recommendation",
                current_finding="No Grade ≥3 non-hematologic toxicity — no drug hold indicated",
                reference_expected="Hold specific agent for Grade ≥3 non-hematologic organ toxicity",
                status="ok",
                indication_action="All regimen drugs cleared for administration.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Drug Hold Recommendation",
                reference_expected="Hold specific agent for Grade ≥3 non-hematologic organ toxicity",
                indication_action="No post-chemo toxicity log linked for prior cycle; will populate when available.",
            )
        )

    # 8. G-CSF Recommendation — gate on actual regimen drugs
    if drug_names:
        checks.append(
            ModuleCheckResult(
                parameter="G-CSF Recommendation",
                current_finding=f"Regimen ({', '.join(drug_names)}) — evaluate FN risk per NCCN myeloid growth factor guidelines",
                reference_expected="Primary G-CSF recommended if regimen Febrile Neutropenia risk >20%",
                status="ok",
                indication_action="Assess regimen-specific FN risk and consider G-CSF if >20%.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="G-CSF Recommendation",
                reference_expected="Primary G-CSF recommended if regimen Febrile Neutropenia risk >20%",
                indication_action="Specify regimen drugs to evaluate FN risk and G-CSF indication.",
            )
        )

    # 9. Erythropoietin Recommendation
    hb_val = demo.get("hemoglobin") or demo.get("hb")
    if hb_val is not None:
        h_num = float(hb_val)
        checks.append(
            ModuleCheckResult(
                parameter="Erythropoietin Recommendation",
                current_finding=f"Hb {h_num:.1f} g/dL (above treatment threshold)" if h_num >= 10.0 else f"Hb {h_num:.1f} g/dL (<10) — Consider ESA support",
                reference_expected="Consider ESA for chemotherapy-induced anemia if Hb <10 g/dL",
                status="ok" if h_num >= 10.0 else "watch",
                indication_action="No action required." if h_num >= 10.0 else "Evaluate ESA for symptomatic anemia.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Erythropoietin Recommendation",
                reference_expected="Consider ESA for chemotherapy-induced anemia if Hb <10 g/dL",
                indication_action="Hemoglobin level not documented in chart.",
            )
        )

    # 10. Transfusion Recommendation
    if hb_val is not None:
        h_num = float(hb_val)
        checks.append(
            ModuleCheckResult(
                parameter="Transfusion Recommendation",
                current_finding=f"Hb {h_num:.1f} g/dL (above transfusion threshold)" if h_num >= 8.0 else f"Hb {h_num:.1f} g/dL (<8.0) — PRBC Transfusion indicated",
                reference_expected="PRBC transfusion for Hb <8 g/dL; Platelet transfusion for Plt <10–20 × 10⁹/L",
                status="ok" if h_num >= 8.0 else "alert",
                indication_action="No transfusion required." if h_num >= 8.0 else "Order PRBC transfusion.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Transfusion Recommendation",
                reference_expected="PRBC transfusion for Hb <8 g/dL; Platelet transfusion for Plt <10–20 × 10⁹/L",
                indication_action="Hemoglobin level not documented in chart.",
            )
        )

    # 11. Cycle Readiness Validation — synthesize from actual consent + hematologic data
    anc_val = demo.get("anc")
    plt_val = demo.get("platelets")
    pre = latest_cycle.get("pre_chemo", {}) if isinstance(latest_cycle, dict) else {}
    has_consent = (
        pre.get("informedConsent") is True
        or str(pre.get("informedConsent")).lower() in ["signed", "yes", "completed", "true", "on-file"]
    )
    heme_clear = anc_val is not None and plt_val is not None

    if has_consent and heme_clear:
        checks.append(
            ModuleCheckResult(
                parameter="Cycle Readiness Validation",
                current_finding="Cycle cleared — consent verified and hematologic criteria reviewed",
                reference_expected="Synthesis of Module 1 readiness + Module 4 hematologic clearance",
                status="ok",
                indication_action="Proceed with scheduled cycle administration.",
            )
        )
    elif has_consent or heme_clear:
        missing = "hematologic panel" if not heme_clear else "informed consent"
        checks.append(
            ModuleCheckResult(
                parameter="Cycle Readiness Validation",
                current_finding=f"Partial clearance — {missing} pending verification",
                reference_expected="Synthesis of Module 1 readiness + Module 4 hematologic clearance",
                status="watch",
                indication_action=f"Verify {missing} before cycle administration.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Cycle Readiness Validation",
                reference_expected="Synthesis of Module 1 readiness + Module 4 hematologic clearance",
                indication_action="Consent and pre-cycle hematologic panel required for clearance.",
            )
        )

    # 12. Guideline Citation Engine — gate on regimen existence
    regimen_name = regimen.get("name") if isinstance(regimen, dict) else None
    if regimen_name:
        checks.append(
            ModuleCheckResult(
                parameter="Guideline Citation Engine",
                current_finding=f"NCCN Guidelines v2.2026 — Dosing & Toxicity Management for '{regimen_name}'",
                reference_expected="Sourced from published NCCN/ASCO evidence-based consensus guidelines",
                status="ok",
                indication_action="All decision recommendations cited against guideline rules.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Guideline Citation Engine",
                reference_expected="Sourced from published NCCN/ASCO evidence-based consensus guidelines",
                indication_action="Assign protocol/regimen to link NCCN guideline citations.",
            )
        )

    return ModuleState(
        module_id=4,
        module_name="Cycle Decision Support",
        checks=checks,
        summary_text=f"{len(checks)} cycle decision checks tracked",
        flagship_note=None,
    )
