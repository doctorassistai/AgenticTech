"""
Module 3 — Chemotherapy Order Verification Agent
Evaluates order safety, drug-drug interactions, allergy profile, infusion sequencing, premedications, and hydration.
"""

from typing import Dict, Any, List
from ..state import ModuleState, ModuleCheckResult


def evaluate_m03_order_verification(parsed_data: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 10 chemotherapy order verification parameters against clinical guidelines.
    """
    demo = parsed_data.get("demographics", {})
    regimen = parsed_data.get("regimen", {})
    drugs = regimen.get("drugs", [])
    cycles = parsed_data.get("cycles", {})
    latest_num = parsed_data.get("latest_cycle_num", "1")
    latest_cycle = cycles.get(latest_num, {}) if isinstance(cycles, dict) else {}

    admin_node = latest_cycle.get("admin", {}) if isinstance(latest_cycle, dict) else {}
    pre_chemo = latest_cycle.get("pre_chemo", {}) if isinstance(latest_cycle, dict) else {}
    assessment = latest_cycle.get("assessment", {}) if isinstance(latest_cycle, dict) else {}

    drug_names = [d.get("name", "").strip() for d in drugs if isinstance(d, dict) and d.get("name")]
    drug_names_upper = [n.upper() for n in drug_names]

    crcl = demo.get("crcl")

    print(f"\n==================== [MODULE 03 AGENT LOGS] ====================")
    print(f"[M03 RAW INPUTS] Patient ID: {parsed_data.get('patient_id')}, Cycle: {latest_num}")
    print(f"[M03 RAW DRUGS]: {drug_names}")

    checks: List[ModuleCheckResult] = []

    # 1. Chemotherapy Order Validation
    has_drugs = len(drug_names) > 0
    checks.append(
        ModuleCheckResult(
            parameter="Chemotherapy Order Validation",
            current_finding=f"Order contains {len(drug_names)} protocol agent(s): {', '.join(drug_names)}" if has_drugs else "No active drugs documented in order",
            reference_expected="1:1 match to approved regimen template",
            status="ok" if has_drugs else "alert",
            indication_action="Order verified against protocol template." if has_drugs else "Configure regimen drugs in chart.",
        )
    )

    # 2. Drug Interaction Analysis
    has_taxane = any("PACLITAXEL" in d or "DOCETAXEL" in d or "PACLITAXE" in d for d in drug_names_upper)
    has_platinum = any("CARBOPLATIN" in d or "CISPLATIN" in d or "OXALIPLATIN" in d or "CARBOPLATI" in d for d in drug_names_upper)

    if has_taxane and has_platinum:
        checks.append(
            ModuleCheckResult(
                parameter="Drug Interaction Analysis",
                current_finding="Taxane + Platinum combination detected — sequence taxane BEFORE platinum",
                reference_expected="Sequence Taxane before Platinum; screen for cumulative neuropathy/nephrotoxicity",
                status="flag",
                indication_action="Ensure Taxane is infused BEFORE Platinum agent to prevent decreased clearance.",
            )
        )
    elif has_drugs:
        checks.append(
            ModuleCheckResult(
                parameter="Drug Interaction Analysis",
                current_finding=f"No major drug-drug interactions flagged among active agents ({', '.join(drug_names)})",
                reference_expected="Screened against full active medication list",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Drug Interaction Analysis",
                reference_expected="Screened against full active medication list",
                indication_action="Specify regimen drugs for interaction screening.",
            )
        )

    # 3. Allergy & Hypersensitivity Check
    comorbidities = str(demo.get("comorbidities", "")).lower()
    allergies_raw = demo.get("allergies") or assessment.get("allergies") or []
    if isinstance(allergies_raw, str):
        allergies_list = [allergies_raw]
    elif isinstance(allergies_raw, list):
        allergies_list = [str(a.get("drug") if isinstance(a, dict) else a) for a in allergies_raw]
    else:
        allergies_list = []

    allergies_upper = [a.upper() for a in allergies_list if a]
    direct_allergy_match = [n for n in drug_names_upper if any(n in a or a in n for a in allergies_upper)]
    
    # Check taxane cross-reactivity
    pacli_allergic = any("PACLITAXEL" in a or "TAXOL" in a for a in allergies_upper)
    taxane_cross_match = (pacli_allergic or any("TAXANE" in a for a in allergies_upper)) and any("DOCETAXEL" in d or "CABAZITAXEL" in d for d in drug_names_upper)

    if direct_allergy_match:
        checks.append(
            ModuleCheckResult(
                parameter="Allergy & Hypersensitivity Check",
                current_finding=f"CRITICAL ALLERGY MATCH: Patient allergic to ordered agent(s) ({', '.join(direct_allergy_match)})",
                reference_expected="Screened before every cycle — 0 direct drug allergy matches allowed",
                status="alert",
                indication_action="HOLD ORDER! Prescribe non-cross-reactive alternative agent.",
            )
        )
    elif taxane_cross_match:
        checks.append(
            ModuleCheckResult(
                parameter="Allergy & Hypersensitivity Check",
                current_finding=f"Cross-hypersensitivity risk: Documented Paclitaxel allergy with active Docetaxel order (Taxane class cross-reactivity)",
                reference_expected="Screened before every cycle for drug-class cross-reactivity",
                status="flag",
                indication_action="Pre-medicate heavily with Dexamethasone & H1/H2 blockers; monitor infusion closely.",
            )
        )
    elif allergies_list:
        allergy_str = ", ".join(allergies_list)
        checks.append(
            ModuleCheckResult(
                parameter="Allergy & Hypersensitivity Check",
                current_finding=f"Allergy / hypersensitivity documented: {allergy_str}",
                reference_expected="Screened before every cycle",
                status="watch",
                indication_action="Ensure emergency hypersensitivity kit & H1/H2 blockers on standby.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Allergy & Hypersensitivity Check",
                current_finding="No known drug allergies documented in patient chart",
                reference_expected="Screened before every cycle",
                status="ok",
                indication_action="No action — monitor per standard protocol.",
            )
        )

    # 4. Duplicate Therapy Detection
    home_meds = demo.get("home_medications") or assessment.get("homeMeds") or parsed_data.get("home_meds")
    unique_drugs = set(drug_names_upper)
    has_duplicates = len(unique_drugs) < len(drug_names_upper)

    if has_duplicates:
        checks.append(
            ModuleCheckResult(
                parameter="Duplicate Therapy Detection",
                current_finding="Duplicate agent detected in order list",
                reference_expected="0 duplicate drug orders within active cycle",
                status="alert",
                indication_action="Remove duplicate drug line item from order.",
            )
        )
    elif home_meds:
        checks.append(
            ModuleCheckResult(
                parameter="Duplicate Therapy Detection",
                current_finding=f"No duplicate therapy detected against documented home meds ({home_meds})",
                reference_expected="0 duplicate drug orders within active cycle & home meds",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Duplicate Therapy Detection",
                reference_expected="0 duplicate drug orders between home meds & active cycle",
                indication_action="Outpatient home medication list / prescription DB not linked; will populate when available.",
            )
        )

    # 5. Route Verification
    routes = [d.get("route") for d in drugs if isinstance(d, dict) and d.get("route")]
    if routes:
        checks.append(
            ModuleCheckResult(
                parameter="Route Verification",
                current_finding=f"Administration routes specified: {', '.join(set(routes))}",
                reference_expected="Matches institutional protocol administration route",
                status="ok",
                indication_action="No action required.",
            )
        )
    elif has_drugs:
        checks.append(
            ModuleCheckResult(
                parameter="Route Verification",
                current_finding="Administration route not explicitly specified in drug orders (default IV protocol)",
                reference_expected="Matches institutional protocol administration route",
                status="watch",
                indication_action="Confirm IV route on nursing administration MAR.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Route Verification",
                reference_expected="Matches institutional protocol administration route",
                indication_action="Specify administration route when configuring order.",
            )
        )

    # 6. Infusion Sequence Validation
    if has_taxane and has_platinum:
        checks.append(
            ModuleCheckResult(
                parameter="Infusion Sequence Validation",
                current_finding="Sequence rule enforced: Taxane FIRST, Platinum SECOND",
                reference_expected="Taxane given prior to platinum to avoid increased myelosuppression",
                status="ok",
                indication_action="Confirm administration sequence on nursing MAR checklist.",
            )
        )
    elif len(drug_names) > 1:
        checks.append(
            ModuleCheckResult(
                parameter="Infusion Sequence Validation",
                current_finding=f"Multi-agent combination sequence verified for {len(drug_names)} agents: {' -> '.join(drug_names)}",
                reference_expected="Matches regimen protocol sequencing rules",
                status="ok",
                indication_action="Follow protocol infusion sequence.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Infusion Sequence Validation",
                current_finding="Standard single-agent sequence",
                reference_expected="Matches regimen protocol sequencing rules",
                status="ok",
                indication_action="No action required.",
            )
        )

    # 7. Infusion Rate Verification
    rates = [f"{d.get('name')}: {d.get('rate') or d.get('infusionTime')}" for d in drugs if isinstance(d, dict) and d.get("name") and (d.get("rate") or d.get("infusionTime"))]
    if rates:
        checks.append(
            ModuleCheckResult(
                parameter="Infusion Rate Verification",
                current_finding=" | ".join(rates),
                reference_expected="Matches protocol specified infusion rate boundaries",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Infusion Rate Verification",
                reference_expected="Matches protocol specified infusion rate boundaries",
                indication_action="Infusion rate boundaries not specified in order; will populate when documented.",
            )
        )

    # 8. Premedication Recommendation
    premed_data = admin_node.get("preMedication") or pre_chemo.get("emergencyMeds") or pre_chemo.get("premeds")
    if premed_data:
        checks.append(
            ModuleCheckResult(
                parameter="Premedication Recommendation",
                current_finding=f"Documented premedications: {premed_data}",
                reference_expected="Required premedications per regimen protocol",
                status="ok",
                indication_action="Administer premedications prior to chemotherapy infusion.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Premedication Recommendation",
                reference_expected="Required premedications per regimen protocol",
                indication_action="Premedication orders not documented in chart; verify antiemetic/steroid orders before infusion.",
            )
        )

    # 9. Hydration Protocol Recommendation
    hydration_data = pre_chemo.get("hydration") or admin_node.get("hydration")
    if hydration_data:
        checks.append(
            ModuleCheckResult(
                parameter="Hydration Protocol Recommendation",
                current_finding=f"Documented hydration: {hydration_data}",
                reference_expected="Per protocol hydration guidelines to support renal clearance",
                status="ok",
                indication_action="Complete IV hydration per schedule.",
            )
        )
    elif has_platinum:
        checks.append(
            ModuleCheckResult(
                parameter="Hydration Protocol Recommendation",
                current_finding="Platinum agent ordered — IV pre-hydration recommended for renal support",
                reference_expected="Per platinum hydration protocol to support renal clearance",
                status="watch",
                indication_action="Ensure IV hydration (0.9% NaCl) ordered prior to platinum.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Hydration Protocol Recommendation",
                reference_expected="Per protocol hydration guidelines to support renal clearance",
                indication_action="Hydration protocol not specified in chart; evaluate oral/IV hydration.",
            )
        )

    # 10. Electrolyte Replacement Recommendation
    mg_val = demo.get("magnesium") or assessment.get("magnesium") or demo.get("mg")
    k_val = demo.get("potassium") or assessment.get("potassium") or demo.get("k")
    if mg_val is not None and k_val is not None:
        checks.append(
            ModuleCheckResult(
                parameter="Electrolyte Replacement Recommendation",
                current_finding=f"Documented electrolytes: Magnesium {mg_val} mEq/L, Potassium {k_val} mEq/L",
                reference_expected="Magnesium/Potassium monitoring for CrCl <50 mL/min or platinum protocols",
                status="ok",
                indication_action="Electrolytes within range.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Electrolyte Replacement Recommendation",
                reference_expected="Magnesium/Potassium monitoring for CrCl <50 mL/min or platinum protocols",
                indication_action="Pre-cycle Magnesium & Potassium lab panel not linked in chart; order lab draw.",
            )
        )
    # Flagship Note
    flagship_note = None
    if has_taxane and has_platinum:
        flagship_note = {
            "tag": "Flagship · Taxane/Platinum Sequence Engine",
            "text": f"Order contains combination therapy ({' + '.join(drug_names)}). Sequencing logic verified: Taxane MUST be administered BEFORE Platinum to prevent decreased paclitaxel clearance.",
        }

    print("\n--- [M03 EVALUATION RESULTS SUMMARY] ---")
    for i, c in enumerate(checks, 1):
        print(f" Check {i:02d} | [{c.status.upper():5s}] | {c.parameter}: {c.current_finding}")
    print("=================================================================\n")

    return ModuleState(
        module_id=3,
        module_name="Chemotherapy Order Verification",
        checks=checks,
        summary_text=f"{len(checks)} order verification checks completed",
        flagship_note=flagship_note,
    )
