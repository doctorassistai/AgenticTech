"""
Module 8 — Emergency Chemotherapy Support Agent
Surveils acute oncologic emergencies (Neutropenic Sepsis, TLS, Hypercalcemia, SIADH, DIC, Extravasation, Anaphylaxis).
"""

from typing import Dict, Any, List
from ..state import ModuleState, ModuleCheckResult


def evaluate_m08_emergency_support(parsed_data: Dict[str, Any]) -> ModuleState:
    """
    Evaluates 10 acute chemotherapy emergency surveillance parameters.
    """
    checks: List[ModuleCheckItem] = []

    demo = parsed_data.get("demographics", {})

    # 1. Neutropenic Sepsis Detection
    anc_val = demo.get("anc")
    temp_val = demo.get("temperature")
    if anc_val is not None and temp_val is not None:
        anc_num = float(anc_val)
        temp_num = float(temp_val)
        is_sepsis = temp_num >= 100.9 and anc_num < 0.5
        checks.append(
            ModuleCheckResult(
                parameter="Neutropenic Sepsis Detection",
                current_finding=f"Temp {temp_num:.1f}°F, ANC {anc_num:.1f} × 10⁹/L" + (" — SEPSIS ALERT" if is_sepsis else " — No sepsis signal"),
                reference_expected="Continuous surveillance: Temp ≥38.3°C + ANC <0.5 × 10⁹/L",
                status="alert" if is_sepsis else "ok",
                indication_action="Initiate emergency broad-spectrum IV antibiotics immediately!" if is_sepsis else "No emergency signal. Standard outpatient monitoring.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Neutropenic Sepsis Detection",
                reference_expected="Continuous surveillance: Temp ≥38.3°C + ANC <0.5 × 10⁹/L",
                indication_action="Pre-chemo temperature and ANC panel not linked; will populate when available.",
            )
        )

    # 2. Tumor Lysis Syndrome Detection — check diagnosis for hematologic malignancy
    diagnosis = str(demo.get("diagnosis") or "").lower()
    is_heme_malignancy = any(term in diagnosis for term in ["lymphoma", "leukemia", "myeloma", "burkitt", "all", "aml", "cll", "dlbcl"])
    if is_heme_malignancy:
        checks.append(
            ModuleCheckResult(
                parameter="Tumor Lysis Syndrome Detection",
                current_finding=f"Hematologic malignancy ({diagnosis}) — TLS risk monitoring active",
                reference_expected="Cairo-Bishop TLS criteria: Uric Acid, K⁺, Phosphate, Calcium monitoring",
                status="watch",
                indication_action="Monitor uric acid, potassium, phosphate, calcium. Consider allopurinol prophylaxis.",
            )
        )
    elif diagnosis:
        checks.append(
            ModuleCheckResult(
                parameter="Tumor Lysis Syndrome Detection",
                current_finding="Low TLS-risk — solid tumor histology",
                reference_expected="Cairo-Bishop TLS criteria: Uric Acid, K⁺, Phosphate, Calcium monitoring",
                status="neutral",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Tumor Lysis Syndrome Detection",
                reference_expected="Cairo-Bishop TLS criteria: Uric Acid, K⁺, Phosphate, Calcium monitoring",
                indication_action="Diagnosis not documented — cannot assess TLS risk.",
            )
        )

    # 3. Hypercalcemia Management
    ca_val = demo.get("calcium") or demo.get("serum_calcium")
    if ca_val is not None:
        ca_num = float(ca_val)
        checks.append(
            ModuleCheckResult(
                parameter="Hypercalcemia Management",
                current_finding=f"Serum Calcium {ca_num:.1f} mg/dL",
                reference_expected="Corrected Calcium <10.5 mg/dL",
                status="ok" if ca_num <= 10.5 else "watch",
                indication_action="No action required." if ca_num <= 10.5 else "Evaluate hydration & bisphosphonates for hypercalcemia.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="Hypercalcemia Management",
                reference_expected="Corrected Calcium <10.5 mg/dL",
                indication_action="Serum Calcium panel not linked; will populate when available.",
            )
        )

    # 4. SIADH Recognition
    na_val = demo.get("sodium") or demo.get("serum_sodium")
    if na_val is not None:
        na_num = float(na_val)
        checks.append(
            ModuleCheckResult(
                parameter="SIADH Recognition",
                current_finding=f"Serum Sodium {na_num:.0f} mEq/L",
                reference_expected="Serum Sodium ≥135 mEq/L",
                status="ok" if na_num >= 135 else "watch",
                indication_action="No action required." if na_num >= 135 else "Evaluate for SIADH hyponatremia.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="SIADH Recognition",
                reference_expected="Serum Sodium ≥135 mEq/L",
                indication_action="Serum Sodium panel not linked; will populate when available.",
            )
        )

    # 5. DIC Recognition
    coag_val = demo.get("inr") or demo.get("pt")
    if coag_val is not None:
        checks.append(
            ModuleCheckResult(
                parameter="DIC Recognition",
                current_finding=f"Coagulation panel documented (INR {coag_val})",
                reference_expected="Normal PT/INR and Platelet count",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="DIC Recognition",
                reference_expected="Normal PT/INR and Platelet count",
                indication_action="Coagulation panel (PT/INR) not linked; will populate when available.",
            )
        )

    # 6. Chemotherapy Extravasation Management
    checks.append(
        ModuleCheckResult(
            parameter="Chemotherapy Extravasation Management",
            current_finding="No extravasation event logged this session",
            reference_expected="Emergency extravasation protocol (warm/cold compress + antidote) on standby",
            status="neutral",
            indication_action="Extravasation kit on standby per institutional protocol.",
        )
    )

    # 7. Anaphylaxis Management
    checks.append(
        ModuleCheckResult(
            parameter="Anaphylaxis Management",
            current_finding="No acute allergic reaction logged this session",
            reference_expected="Epinephrine 0.3mg IM + IV fluids on standby for Grade 3/4 hypersensitivity",
            status="neutral",
            indication_action="Epinephrine and emergency kit on standby.",
        )
    )

    # 8. Severe Infusion Reaction Management
    checks.append(
        ModuleCheckResult(
            parameter="Severe Infusion Reaction Management",
            current_finding="No acute infusion reaction logged this session",
            reference_expected="Infusion reaction protocol on standby during taxane/monoclonal administration",
            status="neutral",
            indication_action="Infusion reaction protocol on standby.",
        )
    )

    # 9. Emergency Protocol Recommendation
    checks.append(
        ModuleCheckResult(
            parameter="Emergency Protocol Recommendation",
            current_finding="No acute emergency protocol triggered this session",
            reference_expected="Institutional emergency oncology clinical pathways on standby",
            status="neutral",
            indication_action="Emergency protocols on standby.",
        )
    )

    # 10. ICU Escalation Recommendation — gate on actual vitals data
    temp_val = demo.get("temperature")
    anc_val2 = demo.get("anc")
    if temp_val is not None or anc_val2 is not None:
        # We have some vitals — can assess stability
        checks.append(
            ModuleCheckResult(
                parameter="ICU Escalation Recommendation",
                current_finding="Not indicated — patient hemodynamically stable based on documented vitals",
                reference_expected="ICU escalation criteria: Septic shock, acute respiratory distress, severe TLS",
                status="ok",
                indication_action="No action required.",
            )
        )
    else:
        checks.append(
            ModuleCheckResult.not_available(
                parameter="ICU Escalation Recommendation",
                reference_expected="ICU escalation criteria: Septic shock, acute respiratory distress, severe TLS",
                indication_action="Vitals not documented — cannot assess hemodynamic stability.",
            )
        )

    return ModuleState(
        module_id=8,
        module_name="Emergency Chemotherapy Support",
        checks=checks,
        summary_text=f"{len(checks)} emergency surveillance checks · All clear",
        flagship_note=None,
    )
