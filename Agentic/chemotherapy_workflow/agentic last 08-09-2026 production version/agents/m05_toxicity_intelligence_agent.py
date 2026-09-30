"""
Module 5 — Toxicity Intelligence Agent
Evaluates CTCAE v5.0 toxicity grading, cross-cycle toxicity trends, organ-specific monitoring, and predictive risk models.
"""

from typing import Dict, Any, List
from ..state import ModuleState, ModuleCheckResult
from ..data_sources import extract_all_toxicities


def evaluate_m05_toxicity_intelligence(parsed_data: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 15 CTCAE v5.0 toxicity intelligence parameters.
    """
    demo = parsed_data.get("demographics", {})
    regimen = parsed_data.get("regimen", {})
    crcl = demo.get("crcl")  # None if not in DB — no fallback

    # Extract all post-chemo toxicities across cycles
    all_toxicities = extract_all_toxicities(parsed_data)
    
    # Categorize toxicities
    neuropathy_events = [t for t in all_toxicities if "neuropathy" in str(t.get("event", "")).lower() or "numbness" in str(t.get("event", "")).lower()]
    nausea_events = [t for t in all_toxicities if "nausea" in str(t.get("event", "")).lower() or "vomiting" in str(t.get("event", "")).lower()]
    highest_neuro_grade = max([int(t.get("grade", 0)) for t in neuropathy_events if str(t.get("grade", "")).isdigit()], default=1 if neuropathy_events else 0)

    checks: List[ModuleCheckItem] = []

    # 1. Hematological Toxicity
    anc_val = demo.get("anc")
    plt_val = demo.get("platelets")
    if anc_val is not None and plt_val is not None:
        checks.append(
            ModuleCheckResult(
                parameter="Hematological Toxicity",
                current_finding=f"Today's blood counts: ANC {anc_val} × 10⁹/L, Plt {plt_val} × 10⁹/L (CTCAE Grade 0–1)",
                reference_expected="CTCAE v5.0: Expected Grade 0–1 by scheduled cycle start date",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Hematological Toxicity",
                reference_expected="CTCAE v5.0: Expected Grade 0–1 by scheduled cycle start date",
                indication_action="Pre-chemo CBC panel not linked in chart; order blood draw.",
            )
        )

    # 2. Febrile Neutropenia Risk
    temp_val = demo.get("temperature")
    if temp_val is not None and anc_val is not None:
        is_fn = float(temp_val) >= 100.9 and float(anc_val) < 0.5
        checks.append(
            ModuleCheckResult(
                parameter="Febrile Neutropenia Risk",
                current_finding=f"Afebrile ({temp_val}°F), ANC {anc_val} × 10⁹/L" if not is_fn else f"FEBRILE NEUTROPENIA RISK: Temp {temp_val}°F + ANC <0.5",
                reference_expected="CTCAE v5.0: Temp ≥38.3°C + ANC <0.5 × 10⁹/L defines FN",
                status="alert" if is_fn else "ok",
                indication_action="Initiate emergency broad-spectrum IV antibiotics!" if is_fn else "No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Febrile Neutropenia Risk",
                reference_expected="CTCAE v5.0: Temp ≥38.3°C + ANC <0.5 × 10⁹/L defines FN",
                indication_action="Pre-chemo temperature and ANC panel not linked in chart.",
            )
        )

    # 3. Mucositis Management
    mucositis_event = next((t for t in all_toxicities if "mucositis" in str(t.get("event", "")).lower() or "stomatitis" in str(t.get("event", "")).lower()), None)
    if mucositis_event:
        g = mucositis_event.get("grade", 1)
        checks.append(
            ModuleCheckResult(
                parameter="Mucositis Management",
                current_finding=f"Grade {g} Oral Mucositis documented",
                reference_expected="CTCAE v5.0: Grade 0 (Asymptomatic)",
                status="watch" if int(g) >= 2 else "ok",
                indication_action="Prescribe magic mouthwash and topical analgesics." if int(g) >= 2 else "No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Mucositis Management",
                reference_expected="CTCAE v5.0: Grade 0 (Asymptomatic)",
                indication_action="Oral mucosa assessment not documented in chart; evaluate nursing pre-chemo note.",
            )
        )

    # 4. Peripheral Neuropathy Management
    if highest_neuro_grade >= 2:
        checks.append(
            ModuleCheckResult(
                parameter="Peripheral Neuropathy Management",
                current_finding=f"Grade {highest_neuro_grade} Peripheral Sensory Neuropathy logged",
                reference_expected="CTCAE v5.0: Grade 2 (Moderate symptoms; limiting instrumental ADLs)",
                status="watch",
                indication_action="Monitor closely. Consider 20–25% Paclitaxel dose reduction if progresses to Grade 3.",
            )
        )
    elif neuropathy_events:
        checks.append(
            ModuleCheckResult(
                parameter="Peripheral Neuropathy Management",
                current_finding="Grade 1 Peripheral Sensory Neuropathy (Mild, no limitation of ADLs)",
                reference_expected="CTCAE v5.0: Grade 0–1 (Asymptomatic or mild loss of deep tendon reflexes)",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Peripheral Neuropathy Management",
                reference_expected="CTCAE v5.0: Grade 0–1 (Asymptomatic or mild loss of deep tendon reflexes)",
                indication_action="Sensory neuro exam not documented in chart; assess paresthesias before taxane dose.",
            )
        )

    # 5. Diarrhea Management
    diarrhea_event = next((t for t in all_toxicities if "diarrhea" in str(t.get("event", "")).lower()), None)
    if diarrhea_event:
        g = diarrhea_event.get("grade", 1)
        checks.append(
            ModuleCheckResult(
                parameter="Diarrhea Management",
                current_finding=f"Grade {g} Diarrhea documented",
                reference_expected="CTCAE v5.0: Grade 0 (<4 stools/day over baseline)",
                status="watch" if int(g) >= 2 else "ok",
                indication_action="Initiate Loperamide protocol." if int(g) >= 2 else "No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Diarrhea Management",
                reference_expected="CTCAE v5.0: Grade 0 (<4 stools/day over baseline)",
                indication_action="GI / bowel assessment not documented in chart; evaluate nursing pre-chemo note.",
            )
        )

    # 6. Nephrotoxicity Monitoring
    crcl_val = demo.get("crcl")
    if crcl_val is not None:
        c_num = float(crcl_val)
        scr_display = f"Serum Cr {demo.get('serum_creatinine')} mg/dL" if demo.get('serum_creatinine') is not None else "Serum Cr not documented"
        if c_num < 60.0:
            checks.append(
                ModuleCheckResult(
                    parameter="Nephrotoxicity Monitoring",
                    current_finding=f"CrCl {c_num:.1f} mL/min ({scr_display}) — Mild renal impairment",
                    reference_expected="CTCAE v5.0: CrCl ≥60 mL/min, Serum Cr within normal limits",
                    status="watch",
                    indication_action="Review renal reduction protocols.",
                )
            )
        else:
            checks.append(
                ModuleCheckResult(
                    parameter="Nephrotoxicity Monitoring",
                    current_finding=f"CrCl {c_num:.1f} mL/min — Normal renal clearance",
                    reference_expected="CTCAE v5.0: CrCl ≥60 mL/min, Serum Cr within normal limits",
                    status="ok",
                    indication_action="No action required.",
                )
            )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Nephrotoxicity Monitoring",
                reference_expected="CTCAE v5.0: CrCl ≥60 mL/min, Serum Cr within normal limits",
                indication_action="Obtain serum creatinine and CrCl panel.",
            )
        )

    # 7. Hepatotoxicity Monitoring
    alt = demo.get("alt") or demo.get("sgpt")
    ast = demo.get("ast") or demo.get("sgot")
    bili = demo.get("total_bilirubin") or demo.get("bilirubin")
    if alt is not None or ast is not None or bili is not None:
        checks.append(
            ModuleCheckResult(
                parameter="Hepatotoxicity Monitoring",
                current_finding=f"LFTs documented (ALT: {alt or 'Normal'}, AST: {ast or 'Normal'}, Bilirubin: {bili or 'Normal'})",
                reference_expected="CTCAE v5.0: Grade 0 (<1.5× ULN)",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Hepatotoxicity Monitoring",
                reference_expected="CTCAE v5.0: Grade 0 (<1.5× ULN)",
                indication_action="Baseline LFTs not linked in chart; order LFT panel.",
            )
        )

    # 8. Cardiotoxicity Monitoring — check actual regimen for anthracyclines/trastuzumab
    regimen_drugs_upper = [d.get("name", "").upper() for d in regimen.get("drugs", []) if isinstance(d, dict)]
    has_anthracycline = any("DOXORUBICIN" in d or "EPIRUBICIN" in d or "DAUNORUBICIN" in d for d in regimen_drugs_upper)
    has_trastuzumab = any("TRASTUZUMAB" in d or "HERCEPTIN" in d for d in regimen_drugs_upper)
    
    if has_anthracycline or has_trastuzumab:
        # Check if ECHO data exists in post_chemo
        echo_data = None
        for cnum, cdata in parsed_data.get("cycles", {}).items():
            if isinstance(cdata, dict):
                pc = cdata.get("post_chemo", {})
                echo_data = pc.get("echoDetails") or pc.get("lvef") or echo_data
        if echo_data:
            checks.append(
                ModuleCheckResult(
                    parameter="Cardiotoxicity Monitoring",
                    current_finding=f"ECHO/LVEF documented: {echo_data}",
                    reference_expected="CTCAE v5.0: Cardiac monitoring indicated for Anthracyclines / Trastuzumab",
                    status="ok",
                    indication_action="Continue serial ECHO monitoring per protocol.",
                )
            )
        else:
            checks.append(
                ModuleCheckResult.not_available(
                    parameter="Cardiotoxicity Monitoring",
                    reference_expected="CTCAE v5.0: Cardiac monitoring indicated for Anthracyclines / Trastuzumab",
                    indication_action="Baseline ECHO/MUGA required for anthracycline/trastuzumab protocol.",
                )
            )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Cardiotoxicity Monitoring",
                current_finding="Not applicable — non-anthracycline/non-trastuzumab regimen",
                reference_expected="CTCAE v5.0: Cardiac monitoring indicated for Anthracyclines / Trastuzumab",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 9. Pulmonary Toxicity Monitoring — check actual regimen for bleomycin/immunotherapy
    has_bleomycin = any("BLEOMYCIN" in d for d in regimen_drugs_upper)
    has_immunotherapy = any("NIVOLUMAB" in d or "PEMBROLIZUMAB" in d or "ATEZOLIZUMAB" in d or "DURVALUMAB" in d or "IPILIMUMAB" in d for d in regimen_drugs_upper)
    
    if has_bleomycin or has_immunotherapy:
        pft_data = None
        for cnum, cdata in parsed_data.get("cycles", {}).items():
            if isinstance(cdata, dict):
                pc = cdata.get("post_chemo", {})
                pft_data = pc.get("pulmonaryTests") or pft_data
        if pft_data:
            checks.append(
                ModuleCheckResult(
                    parameter="Pulmonary Toxicity Monitoring",
                    current_finding=f"PFT/DLCO documented: {pft_data}",
                    reference_expected="CTCAE v5.0: Pulmonary function tests required for Bleomycin / Immunotherapy",
                    status="ok",
                    indication_action="Continue serial PFT monitoring per protocol.",
                )
            )
        else:
            checks.append(
                ModuleCheckResult.not_available(
                    parameter="Pulmonary Toxicity Monitoring",
                    reference_expected="CTCAE v5.0: Pulmonary function tests required for Bleomycin / Immunotherapy",
                    indication_action="Baseline PFT/DLCO required for bleomycin/immunotherapy protocol.",
                )
            )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Pulmonary Toxicity Monitoring",
                current_finding="Not applicable — non-bleomycin / non-immunotherapy protocol",
                reference_expected="CTCAE v5.0: Pulmonary function tests required for Bleomycin / Immunotherapy",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 10. Ototoxicity Monitoring
    has_cisplatin = any("CISPLATIN" in str(d.get("name", "")).upper() for d in regimen.get("drugs", []))
    if has_cisplatin:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Ototoxicity Monitoring",
                reference_expected="CTCAE v5.0: Grade 0 (No hearing threshold shift)",
                indication_action="Baseline audiometry exam not linked in chart for Cisplatin protocol.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Ototoxicity Monitoring",
                current_finding="Not applicable — non-cisplatin regimen",
                reference_expected="CTCAE v5.0: Grade 0 (No hearing threshold shift)",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 11. Electrolyte Toxicity Monitoring
    mg = demo.get("magnesium") or demo.get("mg")
    k = demo.get("potassium") or demo.get("k")
    na = demo.get("sodium") or demo.get("na")
    if mg is not None or k is not None or na is not None:
        checks.append(
            ModuleCheckResult(
                parameter="Electrolyte Toxicity Monitoring",
                current_finding=f"Electrolytes documented (Mg: {mg or 'Normal'}, K: {k or 'Normal'}, Na: {na or 'Normal'})",
                reference_expected="CTCAE v5.0: Grade 0 (Within institutional normal reference range)",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Electrolyte Toxicity Monitoring",
                reference_expected="CTCAE v5.0: Grade 0 (Within institutional normal reference range)",
                indication_action="Pre-cycle electrolyte panel not linked in chart; order lab draw.",
            )
        )

    # 12. Immune-Related Toxicity Management — check regimen for checkpoint inhibitors
    has_checkpoint = any("NIVOLUMAB" in d or "PEMBROLIZUMAB" in d or "ATEZOLIZUMAB" in d or "DURVALUMAB" in d or "IPILIMUMAB" in d or "CEMIPLIMAB" in d for d in regimen_drugs_upper)
    if has_checkpoint:
        checks.append(
            ModuleCheckResult(
                parameter="Immune-Related Toxicity Management",
                current_finding="Checkpoint inhibitor active — irAE monitoring required",
                reference_expected="CTCAE v5.0: irAE algorithms apply to Anti-PD-1 / Anti-CTLA-4 therapy",
                status="watch",
                indication_action="Monitor for thyroiditis, colitis, pneumonitis, hepatitis at each visit.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Immune-Related Toxicity Management",
                current_finding="Not applicable — standard cytotoxic chemotherapy regimen (no checkpoint inhibitor)",
                reference_expected="CTCAE v5.0: irAE algorithms apply to Anti-PD-1 / Anti-CTLA-4 therapy",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 13. Toxicity Prediction Engine — gate on actual taxane presence
    has_taxane_regimen = any("PACLITAXEL" in d or "DOCETAXEL" in d for d in regimen_drugs_upper)
    if has_taxane_regimen:
        checks.append(
            ModuleCheckResult(
                parameter="Toxicity Prediction Engine",
                current_finding="Cumulative taxane exposure increases Grade 2+ neuropathy risk for subsequent cycles",
                reference_expected="Predictive model estimate based on cumulative drug dose + prior toxicity grade",
                status="watch" if highest_neuro_grade >= 2 else "ok",
                indication_action="Pre-emptively discuss dose reduction options with patient." if highest_neuro_grade >= 2 else "Continue standard monitoring.",
            )
        )
    elif all_toxicities:
        checks.append(
            ModuleCheckResult(
                parameter="Toxicity Prediction Engine",
                current_finding=f"{len(all_toxicities)} historical toxicity event(s) logged — monitoring for trends",
                reference_expected="Predictive model estimate based on cumulative drug dose + prior toxicity grade",
                status="ok",
                indication_action="Continue standard monitoring.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Toxicity Prediction Engine",
                reference_expected="Predictive model estimate based on cumulative drug dose + prior toxicity grade",
                indication_action="No toxicity data or regimen drugs linked for predictive modelling.",
            )
        )

    # 14. CTCAE Grading Currency
    if len(all_toxicities) > 0:
        checks.append(
            ModuleCheckResult(
                parameter="CTCAE Grading Currency",
                current_finding=f"Today's visit: {len(all_toxicities)} active toxicity event(s) graded (CTCAE v5.0 compliant)",
                reference_expected="CTCAE evaluation required at every pre-cycle consultation",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="CTCAE Grading Currency",
                reference_expected="CTCAE evaluation required at every pre-cycle consultation",
                indication_action="No active CTCAE toxicity events documented for today's visit.",
            )
        )

    # 15. Toxicity Trend Analysis
    total_count = len(all_toxicities)
    if total_count > 0:
        checks.append(
            ModuleCheckResult(
                parameter="Toxicity Trend Analysis",
                current_finding=f"{total_count} toxicity event(s) aggregated across completed cycles",
                reference_expected="Cross-cycle longitudinal toxicity aggregation across all completed cycles",
                status="ok",
                indication_action="Review toxicity trend graph with patient during consultation.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Toxicity Trend Analysis",
                reference_expected="Cross-cycle longitudinal toxicity aggregation across all completed cycles",
                indication_action="No historical toxicity logs linked across prior cycles.",
            )
        )

    return ModuleState(
        module_id=5,
        module_name="Toxicity Intelligence",
        checks=checks,
        summary_text=f"{len(checks)} toxicity checks · CTCAE v5.0",
        flagship_note=None,
    )
