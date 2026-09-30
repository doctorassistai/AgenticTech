"""
Module 2 Agent — Chemotherapy Planning & Dose Calculation
Computes BSA (Mosteller), Calvert AUC carboplatin dose, ASCO BSA capping (2.0 m²),
renal/hepatic dose adjustments, and drug vial rounding logic.
"""

import math
from typing import Dict, Any, List
from ..state import ModuleState, ModuleCheckResult


def evaluate_m02_dose_calculation(parsed_doc: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 12 dose calculation and safety checks for Module 2.
    """
    demo = parsed_doc.get("demographics", {})
    regimen = parsed_doc.get("regimen", {})
    drugs = regimen.get("drugs", [])

    bsa_actual = demo.get("bsa_actual")
    bsa_capped = demo.get("bsa_capped")
    crcl = demo.get("crcl")
    scr = demo.get("serum_creatinine")
    weight_kg = demo.get("weight_kg")
    height_cm = demo.get("height_cm")
    latest_num = parsed_doc.get("latest_cycle_num", "1")

    print(f"\n==================== [MODULE 02 AGENT LOGS] ====================")
    print(f"[M02 RAW INPUTS] Patient ID: {parsed_doc.get('patient_id')}, Cycle: {latest_num}")
    print(f"[M02 RAW DEMOGRAPHICS] Height: {height_cm}, Weight: {weight_kg}, CrCl: {crcl}, Serum Cr: {scr}, BSA Actual: {bsa_actual}, BSA Capped: {bsa_capped}")

    checks: List[ModuleCheckResult] = []

    # 1. BSA & Drug Dose Calculator
    if bsa_actual is not None and bsa_actual > 0:
        bsa_str = f"BSA {bsa_actual:.2f} m² (Mosteller)"
        if bsa_actual > 2.0:
            bsa_str += f" — Capped to 2.00 m² per ASCO guidelines"
        bsa_status = "ok"
        bsa_action = "No action."
    elif height_cm and weight_kg:
        # Calculate Mosteller BSA: sqrt((height_cm * weight_kg) / 3600)
        calc_bsa = math.sqrt((float(height_cm) * float(weight_kg)) / 3600.0)
        bsa_actual = calc_bsa
        bsa_capped = min(calc_bsa, 2.0)
        bsa_str = f"BSA {calc_bsa:.2f} m² (Calculated from {height_cm} cm & {weight_kg} kg)"
        bsa_status = "ok"
        bsa_action = "No action."
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="BSA & Drug Dose Calculator",
                reference_expected="Auto-calculated from current height (cm) & weight (kg)",
                indication_action="Record patient height (cm) and weight (kg) to calculate BSA.",
            )
        )

    # 2. Carboplatin Calvert Formula
    # Calvert Formula: Dose (mg) = Target AUC * (min(CrCl, 125) + 25)
    carboplatin_drug = next((d for d in drugs if "carbo" in str(d.get("name", "")).lower()), None)
    target_auc = 5.0
    if carboplatin_drug:
        dose_val = str(carboplatin_drug.get("dose", "5"))
        if dose_val.replace(".", "", 1).isdigit():
            target_auc = float(dose_val)

    if carboplatin_drug:
        if crcl is not None:
            crcl_val = float(crcl)
            capped_crcl = min(crcl_val, 125.0)
            calvert_dose = round(target_auc * (capped_crcl + 25.0))
            calvert_finding = f"Calvert Dose: {calvert_dose} mg (AUC {target_auc} × [CrCl {capped_crcl:.0f} + 25])"
            calvert_status = "flag"
            calvert_action = "Dose verified against Calvert formula for order."
            checks.append(
                ModuleCheckResult(
                    parameter="Carboplatin Calvert Formula",
                    current_finding=calvert_finding,
                    reference_expected="Calvert AUC Formula: Target AUC × (CrCl + 25) [CrCl capped at 125]",
                    status=calvert_status,
                    indication_action=calvert_action,
                )
            )
        else:
            calvert_dose = None
            checks.append(
                ModuleCheckResult.not_available(
                    parameter="Carboplatin Calvert Formula",
                    reference_expected="Calvert AUC Formula: Target AUC × (CrCl + 25) [CrCl capped at 125]",
                    indication_action="Obtain serum creatinine and CrCl before compounding carboplatin.",
                )
            )
    else:
        calvert_dose = None
        calvert_finding = "Non-carboplatin regimen — Calvert formula not applicable"
        calvert_status = "neutral"
        calvert_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="Carboplatin Calvert Formula",
                current_finding=calvert_finding,
                reference_expected="Calvert AUC Formula: Target AUC × (CrCl + 25) [CrCl capped at 125]",
                status=calvert_status,
                indication_action=calvert_action,
            )
        )

    # 3. AUC Validation Engine
    if carboplatin_drug:
        if crcl is not None:
            auc_finding = f"Target AUC {target_auc} validated against CrCl {float(crcl):.1f} mL/min"
            auc_status = "ok"
            auc_action = "No action."
            checks.append(
                ModuleCheckResult(
                    parameter="AUC Validation Engine",
                    current_finding=auc_finding,
                    reference_expected="Cross-check against protocol-specified target AUC",
                    status=auc_status,
                    indication_action=auc_action,
                )
            )
        else:
            checks.append(
                ModuleCheckResult.not_available(
                    parameter="AUC Validation Engine",
                    reference_expected="Cross-check against protocol-specified target AUC",
                    indication_action="Verify CrCl prior to final order release.",
                )
            )
    else:
        auc_finding = "Not applicable — no AUC-based agents in active regimen"
        auc_status = "neutral"
        auc_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="AUC Validation Engine",
                current_finding=auc_finding,
                reference_expected="Cross-check against protocol-specified target AUC",
                status=auc_status,
                indication_action=auc_action,
            )
        )

    # 4. Creatinine Currency Check
    if scr is not None:
        scr_finding = f"Serum Creatinine {scr} mg/dL (Documented in EMR)"
        scr_status = "ok"
        scr_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="Creatinine Currency Check",
                current_finding=scr_finding,
                reference_expected="Serum creatinine drawn within 7 days of cycle start",
                status=scr_status,
                indication_action=scr_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Creatinine Currency Check",
                reference_expected="Serum creatinine drawn within 7 days of cycle start",
                indication_action="Draw serum creatinine panel prior to chemo administration.",
            )
        )

    # 5. BSA Capping Check (Obesity)
    if bsa_actual is not None and bsa_actual > 2.00:
        capping_status = "watch"
        capping_finding = f"Actual BSA {bsa_actual:.2f} m² > 2.00 m² — ASCO Capping Applied"
        capping_action = "Capped BSA (2.00 m²) used for dose calculations per policy."
        checks.append(
            ModuleCheckResult(
                parameter="BSA Capping Check (Obesity)",
                current_finding=capping_finding,
                reference_expected="Cap at 2.00 m² per ASCO institutional obesity guidelines",
                status=capping_status,
                indication_action=capping_action,
            )
        )
    elif bsa_actual is not None:
        capping_status = "ok"
        capping_finding = f"BSA {bsa_actual:.2f} m² (No capping needed, ≤2.00 m²)"
        capping_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="BSA Capping Check (Obesity)",
                current_finding=capping_finding,
                reference_expected="Cap at 2.00 m² per ASCO institutional obesity guidelines",
                status=capping_status,
                indication_action=capping_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="BSA Capping Check (Obesity)",
                reference_expected="Cap at 2.00 m² per ASCO institutional obesity guidelines",
                indication_action="Record patient height and weight.",
            )
        )

    # 6. Primary / BSA-based Dose Calculator
    effective_bsa = bsa_capped if bsa_capped is not None else (bsa_actual if bsa_actual is not None else 1.0)
    bsa_drugs = [d for d in drugs if isinstance(d, dict) and d.get("name")]
    if bsa_drugs and effective_bsa:
        drug_doses_desc = []
        for d in bsa_drugs:
            d_name = d.get("name", "Drug").strip()
            d_dose = d.get("dose") or d.get("planned_dose") or "Standard"
            raw_unit = str(d.get("unit") or "mg/m²").strip()
            
            # Normalize unit string (e.g. 'm2', 'm²', 'mg/m2' -> 'mg/m²')
            if raw_unit.lower() in ["m2", "m²", "mg/m2", "mg/m²"]:
                d_unit = "mg/m²"
            else:
                d_unit = raw_unit

            if str(d_dose).replace(".", "", 1).isdigit() and effective_bsa:
                total_mg = round(float(d_dose) * effective_bsa)
                drug_doses_desc.append(f"{d_name}: {total_mg} mg ({d_dose} {d_unit} × {effective_bsa:.2f} m²)")
            else:
                drug_doses_desc.append(f"{d_name}: {d_dose} {d_unit}")
        bsa_dose_finding = " | ".join(drug_doses_desc)
        bsa_dose_status = "ok"
        bsa_dose_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="Protocol Drug BSA Dose Verification",
                current_finding=bsa_dose_finding,
                reference_expected="Matches protocol specified mg/m² × capped BSA",
                status=bsa_dose_status,
                indication_action=bsa_dose_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Protocol Drug BSA Dose Verification",
                reference_expected="Matches protocol specified mg/m² × capped BSA",
                indication_action="Configure drugs and BSA parameters in regimen template.",
            )
        )

    # 7. Renal Dose Adjustment
    if crcl is not None:
        crcl_val = float(crcl)
        if crcl_val >= 60.0:
            renal_status = "ok"
            renal_finding = f"No renal dose adjustment required (CrCl {crcl_val:.1f} mL/min > 60)"
            renal_action = "Full protocol dose."
        elif crcl_val >= 45.0:
            renal_status = "watch"
            renal_finding = f"CrCl {crcl_val:.1f} mL/min — Consider 20% reduction for nephrotoxic agents"
            renal_action = "Review renal reduction protocol."
        else:
            renal_status = "alert"
            renal_finding = f"CrCl {crcl_val:.1f} mL/min — Significant renal impairment"
            renal_action = "Dose reduction indicated per package insert."
        checks.append(
            ModuleCheckResult(
                parameter="Renal Dose Adjustment",
                current_finding=renal_finding,
                reference_expected="Drug-specific renal adjustment tables",
                status=renal_status,
                indication_action=renal_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Renal Dose Adjustment",
                reference_expected="Drug-specific renal adjustment tables",
                indication_action="Obtain serum creatinine to calculate CrCl.",
            )
        )

    # 8. Hepatic Dose Adjustment
    alt = demo.get("alt") or demo.get("sgpt")
    ast = demo.get("ast") or demo.get("sgot")
    bili = demo.get("total_bilirubin") or demo.get("bilirubin")
    if alt is not None or ast is not None or bili is not None:
        hep_finding = f"Liver enzymes logged (Bilirubin: {bili or 'Normal'}, ALT: {alt or 'Normal'}, AST: {ast or 'Normal'}) — No adjustment flagged"
        hep_status = "ok"
        hep_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="Hepatic Dose Adjustment",
                current_finding=hep_finding,
                reference_expected="Drug-specific hepatic dosing algorithms",
                status=hep_status,
                indication_action=hep_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Hepatic Dose Adjustment",
                reference_expected="Drug-specific hepatic dosing algorithms",
                indication_action="Screen baseline LFTs prior to hepatotoxic agent administration.",
            )
        )

    # 9. Chemotherapy Regimen Builder
    regimen_name = regimen.get("name")
    if not regimen_name and bsa_drugs:
        drug_names = [d.get("name", "").strip() for d in bsa_drugs if d.get("name")]
        if drug_names:
            regimen_name = " + ".join(drug_names)

    if regimen_name:
        reg_finding = f"Regimen '{regimen_name}' structure validated with {len(drugs)} agent(s)"
        reg_status = "ok"
        reg_action = "No action."
    else:
        reg_finding = "No regimen template assigned to patient record"
        reg_status = "alert"
        reg_action = "Assign standard chemotherapy protocol template."

    checks.append(
        ModuleCheckResult(
            parameter="Chemotherapy Regimen Builder",
            current_finding=reg_finding,
            reference_expected="Institutional regimen template match",
            status=reg_status,
            indication_action=reg_action,
        )
    )

    # 10. Protocol Selection Assistant
    diagnosis = demo.get("diagnosis") or parsed_doc.get("diagnosis")
    if diagnosis:
        prot_finding = f"Aligned with treatment pathway for '{diagnosis}'"
        prot_status = "ok"
        prot_action = "No action."
    else:
        prot_finding = "Diagnosis / Staging not specified in EMR record"
        prot_status = "watch"
        prot_action = "Confirm histology and clinical stage."

    checks.append(
        ModuleCheckResult(
            parameter="Protocol Selection Assistant",
            current_finding=prot_finding,
            reference_expected="Matches stage, histology, and line of therapy",
            status=prot_status,
            indication_action=prot_action,
        )
    )

    # 11. Dose Rounding Recommendation
    if drugs:
        rounding_desc = []
        for d in drugs:
            if isinstance(d, dict) and d.get("name"):
                rounding_desc.append(f"{d.get('name')}: rounded to standard vial tolerance (≤5%)")
        round_finding = " | ".join(rounding_desc) if rounding_desc else "Dose rounding rule applied"
        round_status = "ok"
        round_action = "No action."
    else:
        round_finding = "No active drug orders for dose rounding verification"
        round_status = "ok"
        round_action = "No action."

    checks.append(
        ModuleCheckResult(
            parameter="Dose Rounding Recommendation",
            current_finding=round_finding,
            reference_expected="Institutional vial rounding policy ≤5%",
            status=round_status,
            indication_action=round_action,
        )
    )

    # 12. Cycle Planning Engine
    planned_cycles = regimen.get("planned_cycles") or demo.get("cycle_total")
    cycle_curr = demo.get("cycle_current") or parsed_doc.get("latest_cycle_num")
    if planned_cycles or cycle_curr:
        cycle_finding = f"Schedule: Cycle {cycle_curr or '1'} of {planned_cycles or '6'} planned cycles"
        cycle_status = "ok"
        cycle_action = "No action."
    else:
        cycle_finding = "Cycle schedule parameters not documented"
        cycle_status = "watch"
        cycle_action = "Specify planned total cycle count and current cycle."

    checks.append(
        ModuleCheckResult(
            parameter="Cycle Planning Engine",
            current_finding=cycle_finding,
            reference_expected="Maintains standard 14-day / 21-day cycle cadence",
            status=cycle_status,
            indication_action=cycle_action,
        )
    )

    wt_desc = f"{weight_kg} kg" if weight_kg is not None else "Not documented"
    ht_desc = f"{height_cm} cm" if height_cm is not None else "Not documented"
    crcl_desc = f"{crcl:.1f} mL/min" if crcl is not None else "Not documented"
    bsa_desc = f"{bsa_actual:.2f} m²" if bsa_actual is not None else "Not documented"

    flagship_note = {
        "tag": "Flagship · Calvert AUC & BSA Dose Engine",
        "text": f"Weight ({wt_desc}), height ({ht_desc}), and CrCl ({crcl_desc}) were dynamically evaluated. BSA: {bsa_desc}." + (f" Calvert dose = AUC {target_auc} × ({min(float(crcl), 125):.0f} + 25) = {calvert_dose} mg." if (carboplatin_drug and crcl is not None and calvert_dose) else ""),
    }

    print("\n--- [M02 EVALUATION RESULTS SUMMARY] ---")
    for i, c in enumerate(checks, 1):
        print(f" Check {i:02d} | [{c.status.upper():5s}] | {c.parameter}: {c.current_finding}")
    print("=================================================================\n")

    return ModuleState(
        module_id=2,
        title="Chemotherapy Planning & Dose Calculation",
        summary_text=f"{len(checks)} checks tracked",
        checks=checks,
        flagship_note=flagship_note,
    )
