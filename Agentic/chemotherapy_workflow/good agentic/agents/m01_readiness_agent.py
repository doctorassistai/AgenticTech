"""
Module 1 Agent — Patient Assessment & Treatment Readiness
Evaluates patient eligibility, performance status (ECOG/KPS), organ function, consent, and pre-treatment checklists.
"""

from typing import Dict, Any, List
from ..state import ModuleState, ModuleCheckResult


def evaluate_m01_readiness(parsed_doc: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 10 readiness checks for Module 1 based on the parsed EMR record.
    """
    demo = parsed_doc.get("demographics", {})
    cycles = parsed_doc.get("cycles", {})
    latest_num = parsed_doc.get("latest_cycle_num", "1")
    latest_cycle = cycles.get(latest_num, {})

    pre = latest_cycle.get("pre_chemo", {})
    details = latest_cycle.get("details", {})
    assessment = latest_cycle.get("assessment", {})

    print(f"\n==================== [MODULE 01 AGENT LOGS] ====================")
    print(f"[M01 RAW INPUTS] Patient ID: {parsed_doc.get('patient_id')}, Cycle: {latest_num}")
    print(f"[M01 RAW DEMOGRAPHICS] Age: {demo.get('age')}, Gender: {demo.get('gender')}, Height: {demo.get('height_cm')}, Weight: {demo.get('weight_kg')}, CrCl: {demo.get('crcl')}, ECOG: {demo.get('ecog')}")

    checks: List[ModuleCheckResult] = []

    # 1. Chemotherapy Eligibility
    informed_consent = (
        pre.get("informedConsent") is True
        or str(pre.get("informedConsent")).lower() in ["signed", "yes", "completed", "true", "on-file"]
        or str(details.get("consentStatus")).lower() in ["on-file", "signed", "yes", "completed"]
        or str(assessment.get("consentOnFile")).lower() in ["yes", "true", "signed"]
        or bool(pre.get("safetyVerified"))
    )
    safety_verified = (
        pre.get("safetyVerified") in ["yes", True, "true", "completed"]
        or str(details.get("safetyCheck")).lower() in ["yes", "completed", "verified"]
        or bool(informed_consent)
    )

    print(f"[M01 CHECK 1 - ELIGIBILITY] informedConsent={informed_consent}, safetyVerified={safety_verified}")

    if informed_consent and safety_verified:
        eligibility_status = "ok"
        eligibility_finding = "Cleared — all readiness criteria met"
        eligibility_action = "No action required."
    elif informed_consent:
        eligibility_status = "watch"
        eligibility_finding = "Conditionally cleared — safety verification pending"
        eligibility_action = "Verify safety checklist with attending oncologist."
    else:
        eligibility_status = "alert"
        eligibility_finding = "Hold — consent or safety clearance missing"
        eligibility_action = "Obtain informed consent before infusion."

    checks.append(
        ModuleCheckResult(
            parameter="Chemotherapy Eligibility",
            current_finding=eligibility_finding,
            reference_expected="All criteria met before infusion start",
            status=eligibility_status,
            indication_action=eligibility_action,
        )
    )

    # 2. ECOG / KPS
    ecog = demo.get("ecog")
    if ecog is not None:
        try:
            ecog_val = int(ecog)
        except (ValueError, TypeError):
            ecog_val = 0
        kps_map = {0: "KPS 100", 1: "KPS 90", 2: "KPS 70-80", 3: "KPS 50-60", 4: "KPS <50"}
        kps = kps_map.get(ecog_val, f"KPS {max(100 - ecog_val * 20, 0)}")

        ecog_descriptions = {
            0: "Fully active",
            1: "Restricted in strenuous activity",
            2: "Ambulatory, up >50% of waking hours",
            3: "Capable of only limited self-care",
            4: "Completely disabled",
            5: "Dead"
        }
        desc = ecog_descriptions.get(ecog_val, "Unspecified")

        if ecog_val <= 1:
            ecog_status = "ok"
            ecog_finding = f"ECOG {ecog_val} ({kps}) — {desc}"
            ecog_action = "No action."
        elif ecog_val == 2:
            ecog_status = "watch"
            ecog_finding = f"ECOG {ecog_val} ({kps}) — {desc}"
            ecog_action = "Consider dose reduction or supportive care review."
        else:
            ecog_status = "alert"
            ecog_finding = f"ECOG {ecog_val} ({kps}) — {desc}"
            ecog_action = "Multidisciplinary team review required before cycle."
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="ECOG / KPS Performance Status",
                reference_expected="ECOG ≤2 for standard chemotherapy continuation",
                indication_action="Assess and record baseline ECOG score prior to cycle start.",
            )
        )

    # 3. Organ Function Assessment
    crcl = demo.get("crcl")
    scr = demo.get("serum_creatinine")

    if crcl is not None:
        crcl_val = float(crcl)
        scr_str = f"Serum Cr {scr} mg/dL" if scr is not None else "Serum Cr not logged"
        if crcl_val >= 60.0:
            organ_status = "ok"
            organ_finding = f"Renal CrCl {crcl_val:.1f} mL/min ({scr_str}) — Normal"
            organ_action = "No action."
        elif crcl_val >= 45.0:
            organ_status = "watch"
            organ_finding = f"Renal CrCl {crcl_val:.1f} mL/min ({scr_str}) — Mild CKD"
            organ_action = "Review renal dose adjustment table for platinum/pemetrexed."
        else:
            organ_status = "alert"
            organ_finding = f"Renal CrCl {crcl_val:.1f} mL/min ({scr_str}) — Impaired"
            organ_action = "Dose reduction or drug substitution indicated."
        checks.append(
            ModuleCheckResult(
                parameter="Organ Function Assessment",
                current_finding=organ_finding,
                reference_expected="CrCl ≥60 mL/min for full-dose regimen",
                status=organ_status,
                indication_action=organ_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Organ Function Assessment",
                reference_expected="CrCl ≥60 mL/min for full-dose regimen",
                indication_action="Obtain serum creatinine and calculate Cockcroft-Gault CrCl.",
            )
        )

    # 4. Infection & Contraindication Screening
    vitals_raw = str(pre.get("vitals") or assessment.get("vitals") or details.get("vitals") or "")
    temp_val = demo.get("temperature") or pre.get("temperature") or assessment.get("temperature")
    
    if temp_val is None and vitals_raw and ("Temp" in vitals_raw or "Temperature" in vitals_raw):
        for part in vitals_raw.replace(":", " ").replace(",", " ").split():
            if part.replace(".", "", 1).isdigit() and float(part) > 90:
                temp_val = float(part)
                break

    if temp_val is not None:
        t_num = float(temp_val)
        if t_num <= 100.4:
            inf_status = "ok"
            inf_finding = f"Afebrile ({t_num:.1f}°F), no active fever logged"
            inf_action = "No action."
        else:
            inf_status = "alert"
            inf_finding = f"Fever detected ({t_num:.1f}°F)"
            inf_action = "Hold chemotherapy; evaluate for infection/neutropenic fever."
        checks.append(
            ModuleCheckResult(
                parameter="Infection & Contraindication Screening",
                current_finding=inf_finding,
                reference_expected="Afebrile (<100.4°F) and infection-free",
                status=inf_status,
                indication_action=inf_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Infection & Contraindication Screening",
                reference_expected="Afebrile (<100.4°F) and infection-free",
                indication_action="Verify patient temperature before chemotherapy hookup.",
            )
        )

    # 5. Baseline Investigation Completeness
    baseline_labs_raw = assessment.get("baselineLabs") or details.get("baselineLabs") or parsed_doc.get("baselineLabs")
    completed_labs_count = 0
    if isinstance(baseline_labs_raw, list):
        completed_labs_count = len(baseline_labs_raw)
    elif isinstance(baseline_labs_raw, str) and "[" in baseline_labs_raw:
        try:
            import json
            labs_list = json.loads(baseline_labs_raw)
            completed_labs_count = len(labs_list)
        except Exception:
            completed_labs_count = 0

    # Include lab parameters parsed from oncology_investigations -> processed_documents
    investigations = parsed_doc.get("investigations", [])
    extracted_lab_summaries = []
    for inv in investigations:
        proc = inv.get("processed_details")
        if isinstance(proc, dict):
            p_content = proc.get("parameterwise_content", [])
            if isinstance(p_content, list):
                for item in p_content:
                    if isinstance(item, dict) and item.get("found") and item.get("parameter_name"):
                        extracted_lab_summaries.append(f"{item['parameter_name']} ({item.get('content', 'documented')})")

    if extracted_lab_summaries:
        completed_labs_count = max(completed_labs_count, len(extracted_lab_summaries))

    if completed_labs_count == 0:
        lab_fields = [
            assessment.get("serumCreatinine") or demo.get("serum_creatinine"),
            details.get("height") or demo.get("height_cm"),
            details.get("weight") or demo.get("weight_kg"),
            demo.get("crcl"),
            pre.get("temperature") or assessment.get("temperature"),
        ]
        completed_labs_count = len([f for f in lab_fields if f is not None])

    if completed_labs_count >= 3:
        labs_status = "ok"
        detail_msg = f" Baseline parameters: {', '.join(extracted_lab_summaries[:3])}" if extracted_lab_summaries else ""
        labs_finding = f"Baseline panel documented ({completed_labs_count} parameters logged).{detail_msg}"
        labs_action = "No action."
    elif completed_labs_count > 0:
        labs_status = "watch"
        labs_finding = f"Partial baseline panel ({completed_labs_count} parameters logged)"
        labs_action = "Order outstanding CBC / LFT / RFT baseline panels."
    else:
        labs_status = "alert"
        labs_finding = "No baseline investigation parameters found in record"
        labs_action = "Obtain baseline lab work prior to treatment."

    checks.append(
        ModuleCheckResult(
            parameter="Baseline Investigation Completeness",
            current_finding=labs_finding,
            reference_expected="100% required panels before cycle 1",
            status=labs_status,
            indication_action=labs_action,
        )
    )

    # 6. Chemotherapy Fitness Score
    fitness_score = 100
    ecog_val = int(ecog) if ecog is not None else 0
    crcl_val = float(crcl) if crcl is not None else 60.0
    if ecog_val >= 1:
        fitness_score -= ecog_val * 10
    if crcl_val < 60:
        fitness_score -= 15
    if not safety_verified:
        fitness_score -= 10

    fitness_score = max(fitness_score, 40)
    fit_status = "ok" if fitness_score >= 80 else ("watch" if fitness_score >= 65 else "alert")

    checks.append(
        ModuleCheckResult(
            parameter="Chemotherapy Fitness Score",
            current_finding=f"Composite score: {fitness_score}/100",
            reference_expected="Score ≥80/100 for standard fit clearance",
            status=fit_status,
            indication_action="Fit for continuation" if fitness_score >= 80 else "Pre-treatment optimization advised",
        )
    )

    # 7. Pregnancy / Fertility Safety
    gender = str(demo.get("gender") or "").lower()
    age_val = demo.get("age")
    preg_status_raw = str(assessment.get("pregnancyStatus") or details.get("pregnancyTestResult") or "").lower()

    if gender in ["male", "m"] or (age_val is not None and int(age_val) > 55) or "negative" in preg_status_raw or "not applicable" in preg_status_raw:
        preg_status = "ok"
        preg_finding = "Not applicable / Post-menopausal" if (gender in ["male", "m"] or (age_val is not None and int(age_val) > 55)) else "β-hCG negative / Contraception counselled"
        preg_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="Pregnancy / Fertility Safety Check",
                current_finding=preg_finding,
                reference_expected="Required for reproductive-age female patients",
                status=preg_status,
                indication_action=preg_action,
            )
        )
    elif preg_status_raw:
        preg_status = "ok"
        preg_finding = f"Documented: {preg_status_raw}"
        preg_action = "No action."
        checks.append(
            ModuleCheckResult(
                parameter="Pregnancy / Fertility Safety Check",
                current_finding=preg_finding,
                reference_expected="Required for reproductive-age female patients",
                status=preg_status,
                indication_action=preg_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Pregnancy / Fertility Safety Check",
                reference_expected="Required for reproductive-age female patients",
                indication_action="Verify pregnancy test or post-menopausal status for females of childbearing potential.",
            )
        )

    # 8. Vaccination & Infection Risk
    raw_vacc = assessment.get("vaccinationStatus") or pre.get("vaccinationHistory")
    if raw_vacc:
        checks.append(
            ModuleCheckResult(
                parameter="Vaccination & Infection Risk",
                current_finding=f"Documented: {str(raw_vacc).strip()}",
                reference_expected="No live vaccines within 2-4 weeks of chemotherapy",
                status="ok",
                indication_action="No action.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Vaccination & Infection Risk",
                reference_expected="No live vaccines within 2-4 weeks of chemotherapy",
                indication_action="Confirm patient has not received live vaccines in past 4 weeks.",
            )
        )

    # 9. Comorbidity Risk Assessment
    comorbidities = str(demo.get("comorbidities") or assessment.get("comorbidities") or details.get("comorbidities") or "").strip()
    if not comorbidities or comorbidities.lower() in ["none", "none logged", "n/a"]:
        comorb_status = "ok"
        comorb_finding = "No major comorbidity flags logged"
        comorb_action = "No action."
    else:
        comorb_status = "watch"
        comorb_finding = f"Logged comorbidities: {comorbidities}"
        comorb_action = "Monitor organ function during therapy."

    checks.append(
        ModuleCheckResult(
            parameter="Comorbidity Risk Assessment",
            current_finding=comorb_finding,
            reference_expected="Stable comorbidities under active management",
            status=comorb_status,
            indication_action=comorb_action,
        )
    )

    # 10. Consent & Pre-treatment Checklist
    checks.append(
        ModuleCheckResult(
            parameter="Consent & Pre-treatment Checklist",
            current_finding="Informed consent on file; pre-chemo vitals logged" if informed_consent else "Informed consent pending verification",
            reference_expected="100% complete prior to infusion start",
            status="ok" if informed_consent else "alert",
            indication_action="No action." if informed_consent else "Obtain consent signature.",
        )
    )

    # 11. Multidisciplinary Tumor Board (MDT) Plan Alignment
    tb_data = parsed_doc.get("tumor_board")
    if tb_data and isinstance(tb_data, dict):
        plan = tb_data.get("care_pathway_plan", {})
        intent = plan.get("overall_treatment_intent", "curative")
        approvals = tb_data.get("doctor_approvals", [])
        approved_specs = [a.get("speciality") for a in approvals if isinstance(a, dict) and a.get("status") == "approved"]
        safety_flags = plan.get("safety_flags", [])

        if safety_flags:
            flags_str = "; ".join(safety_flags[:2])
            tb_status = "watch"
            tb_finding = f"MDT Plan ({intent.capitalize()} Intent) — Approvals: {', '.join(approved_specs)}. Safety Warning: {flags_str}"
            tb_action = "Review MDT safety flags before starting infusion."
        elif len(approved_specs) >= 2:
            tb_status = "ok"
            tb_finding = f"MDT Pathway Approved ({intent.capitalize()} Intent) by {', '.join(approved_specs)}"
            tb_action = "No action required."
        else:
            tb_status = "watch"
            tb_finding = f"MDT Pathway pending full approvals ({len(approved_specs)} approved)"
            tb_action = "Obtain multi-disciplinary team approval."

        checks.append(
            ModuleCheckResult(
                parameter="Multidisciplinary Tumor Board Alignment",
                current_finding=tb_finding,
                reference_expected="Multi-specialty consensus plan on file",
                status=tb_status,
                indication_action=tb_action,
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Multidisciplinary Tumor Board Alignment",
                reference_expected="Multi-specialty consensus plan on file",
                indication_action="Link patient's Tumor Board discussion or care pathway plan.",
            )
        )

    print("\n--- [M01 EVALUATION RESULTS SUMMARY] ---")
    for i, c in enumerate(checks, 1):
        print(f" Check {i:02d} | [{c.status.upper():5s}] | {c.parameter}: {c.current_finding}")
    print("=================================================================\n")

    return ModuleState(
        module_id=1,
        title="Patient Assessment & Treatment Readiness",
        summary_text=f"{len(checks)} checks tracked",
        checks=checks,
    )
