"""
Module 9 — Monitoring & Follow-up Agent
Schedules recurring lab draws, imaging follow-up, organ-specific surveillance, and calculates next visit dates.
"""

from typing import Dict, Any, List
import datetime
from ..state import ModuleState, ModuleCheckResult


def evaluate_m09_monitoring_followup(parsed_data: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 10 monitoring and follow-up scheduling parameters.
    """
    demo = parsed_data.get("demographics", {})
    regimen = parsed_data.get("regimen", {})
    drugs = regimen.get("drugs", []) if isinstance(regimen, dict) else []
    drug_names_upper = [d.get("name", "").upper() for d in drugs if isinstance(d, dict) and d.get("name")]
    cycles = parsed_data.get("cycles", {})

    # Next cycle date calculation (21-day standard interval)
    today = datetime.date.today()
    next_date = today + datetime.timedelta(days=21)
    next_date_str = next_date.strftime("%d %b %Y")

    checks: List[ModuleCheckResult] = []

    # 1. Laboratory Monitoring Scheduler — gate on actual lab data availability
    has_labs = demo.get("serum_creatinine") is not None or demo.get("crcl") is not None
    if has_labs:
        checks.append(
            ModuleCheckResult(
                parameter="Laboratory Monitoring Scheduler",
                current_finding=f"Pre-cycle lab panel documented. Next pre-cycle panel due prior to {next_date_str}",
                reference_expected="Mandatory pre-treatment lab panel within 7 days of each cycle start",
                status="ok",
                indication_action="Order pre-cycle CBC, LFT, RFT for next visit.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Laboratory Monitoring Scheduler",
                reference_expected="Mandatory pre-treatment lab panel within 7 days of each cycle start",
                indication_action="Pre-cycle lab panel not linked in chart; order CBC, LFT, RFT.",
            )
        )

    # 2. Imaging Follow-up Scheduler
    imaging_slot = parsed_data.get("imaging_slot") or parsed_data.get("next_ct_scan")
    if imaging_slot:
        checks.append(
            ModuleCheckResult(
                parameter="Imaging Follow-up Scheduler",
                current_finding=f"Documented slot: {imaging_slot}",
                reference_expected="RECIST response assessment recommended every 3–4 cycles (9–12 weeks)",
                status="ok",
                indication_action="Confirm interim CT radiology slot appointment.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Imaging Follow-up Scheduler",
                reference_expected="RECIST response assessment recommended every 3–4 cycles (9–12 weeks)",
                indication_action="RIS / PACS radiology scheduling system not linked; will populate when available.",
            )
        )

    # 3. Cardiac Monitoring Tracker — check actual regimen for anthracyclines/trastuzumab
    has_anthracycline = any("DOXORUBICIN" in d or "EPIRUBICIN" in d or "DAUNORUBICIN" in d for d in drug_names_upper)
    has_trastuzumab = any("TRASTUZUMAB" in d or "HERCEPTIN" in d for d in drug_names_upper)
    if has_anthracycline or has_trastuzumab:
        checks.append(
            ModuleCheckResult(
                parameter="Cardiac Monitoring Tracker",
                current_finding="ECHO/MUGA monitoring required for cardiotoxic regimen",
                reference_expected="Baseline + cumulative dose ECHO monitoring for anthracycline/HER2 protocols",
                status="watch",
                indication_action="Schedule serial ECHO per protocol intervals.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Cardiac Monitoring Tracker",
                current_finding="Not applicable — non-anthracycline/non-trastuzumab regimen",
                reference_expected="Baseline + cumulative dose ECHO monitoring for anthracycline/HER2 protocols",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 4. Pulmonary Function Monitoring — check actual regimen for bleomycin
    has_bleomycin = any("BLEOMYCIN" in d for d in drug_names_upper)
    if has_bleomycin:
        checks.append(
            ModuleCheckResult(
                parameter="Pulmonary Function Monitoring",
                current_finding="PFT/DLCO monitoring required for bleomycin protocol",
                reference_expected="Baseline + DLCO monitoring every 100 units for Bleomycin",
                status="watch",
                indication_action="Schedule serial PFT/DLCO per protocol intervals.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Pulmonary Function Monitoring",
                current_finding="Not applicable — non-bleomycin regimen",
                reference_expected="Baseline + DLCO monitoring every 100 units for Bleomycin",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 5. Renal Monitoring Tracker
    crcl_val = demo.get("crcl")
    if crcl_val is not None:
        c_num = float(crcl_val)
        if c_num < 60.0:
            checks.append(
                ModuleCheckResult(
                    parameter="Renal Monitoring Tracker",
                    current_finding=f"CrCl {c_num:.1f} mL/min — weekly serum creatinine and pre-cycle CrCl recalculation scheduled",
                    reference_expected="Mandatory CrCl calculation prior to each platinum dose",
                    status="watch",
                    indication_action="Recalculate Cockcroft-Gault CrCl with same-day serum creatinine at next visit.",
                )
            )
        else:
            checks.append(
                ModuleCheckResult(
                    parameter="Renal Monitoring Tracker",
                    current_finding=f"CrCl {c_num:.1f} mL/min — routine pre-cycle renal panel scheduled",
                    reference_expected="Every cycle with platinum agent",
                    status="ok",
                    indication_action="No action required.",
                )
            )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Renal Monitoring Tracker",
                reference_expected="Mandatory CrCl calculation prior to each platinum dose",
                indication_action="Renal panel / CrCl calculation not linked; will populate when available.",
            )
        )

    # 6. Liver Monitoring Tracker — gate on actual LFT data
    alt = demo.get("alt") or demo.get("sgpt")
    ast = demo.get("ast") or demo.get("sgot")
    bili = demo.get("total_bilirubin") or demo.get("bilirubin")
    if alt is not None or ast is not None or bili is not None:
        checks.append(
            ModuleCheckResult(
                parameter="Liver Monitoring Tracker",
                current_finding=f"LFTs documented (ALT: {alt or 'N/A'}, AST: {ast or 'N/A'}, Bilirubin: {bili or 'N/A'})",
                reference_expected="Routine LFT evaluation before each chemotherapy cycle",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Liver Monitoring Tracker",
                reference_expected="Routine LFT evaluation before each chemotherapy cycle",
                indication_action="Baseline LFTs not linked in chart; order LFT panel.",
            )
        )

    # 7. Toxicity Follow-up Scheduler — gate on actual toxicity events
    from ..data_sources import extract_all_toxicities
    all_tox = extract_all_toxicities(parsed_data)
    if all_tox:
        tox_types = list(set([t.get("event", "Unknown") for t in all_tox if t.get("event")]))
        checks.append(
            ModuleCheckResult(
                parameter="Toxicity Follow-up Scheduler",
                current_finding=f"{len(all_tox)} toxicity event(s) logged — follow-up scheduled for: {', '.join(tox_types[:3])}",
                reference_expected="CTCAE evaluation linked to Module 5 toxicity flags",
                status="ok",
                indication_action="Perform clinical assessment of flagged toxicities at next visit.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Toxicity Follow-up Scheduler",
                reference_expected="CTCAE evaluation linked to Module 5 toxicity flags",
                indication_action="No toxicity events logged in prior cycles; will populate when available.",
            )
        )

    # 8. Oral Chemotherapy Adherence Monitoring — check actual drug routes
    routes = [d.get("route", "").lower() for d in drugs if isinstance(d, dict) and d.get("route")]
    has_oral = any("oral" in r or "po" in r for r in routes)
    if has_oral:
        checks.append(
            ModuleCheckResult(
                parameter="Oral Chemotherapy Adherence Monitoring",
                current_finding="Oral chemotherapy agent detected in regimen — adherence monitoring active",
                reference_expected="Adherence log and pill-count monitoring for self-administered oral agents",
                status="watch",
                indication_action="Verify pill-count and adherence log at each visit.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult(
                parameter="Oral Chemotherapy Adherence Monitoring",
                current_finding="Not applicable — IV/infusion regimen",
                reference_expected="Adherence log and pill-count monitoring for self-administered oral agents",
                status="neutral",
                indication_action="No action required.",
            )
        )

    # 9. Missed Cycle Detection — compute from actual cycle data
    total_cycle_keys = len([k for k in cycles.keys() if str(k).isdigit()])
    completed = len([k for k, v in cycles.items() if isinstance(v, dict) and (
        v.get("admin", {}).get("cycleCompleted") == "yes" or v.get("cycle_admin", {}).get("cycleCompleted") == "yes"
    )])
    if total_cycle_keys > 0:
        missed = total_cycle_keys - completed
        checks.append(
            ModuleCheckResult(
                parameter="Missed Cycle Detection",
                current_finding=f"{completed} of {total_cycle_keys} cycle(s) completed" + (f" — {missed} not completed" if missed > 0 else " — no missed cycles"),
                reference_expected="Continuous longitudinal cycle adherence tracking",
                status="ok" if missed == 0 else "watch",
                indication_action="No action required." if missed == 0 else "Review incomplete cycle(s) for scheduling issues.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Missed Cycle Detection",
                reference_expected="Continuous longitudinal cycle adherence tracking",
                indication_action="No cycle data linked for adherence tracking.",
            )
        )

    # 10. Follow-up Recommendation Engine
    checks.append(
        ModuleCheckResult(
            parameter="Follow-up Recommendation Engine",
            current_finding=f"Next cycle consultation scheduled for {next_date_str} (21-day interval)",
            reference_expected="Auto-calculated from protocol cycle length and treatment date",
            status="ok",
            indication_action=f"Book outpatient appointment slot for {next_date_str}.",
        )
    )

    return ModuleState(
        module_id=9,
        module_name="Monitoring & Follow-up",
        checks=checks,
        summary_text=f"{len(checks)} monitoring checks · Next visit {next_date_str}",
        flagship_note=None,
    )
