# Chemotherapy Workflow AI Agents Architecture Plan

## Overview
This package defines the 12 AI Agent Modules powering the Chemotherapy Intelligence Platform in DoctorAssist.AI.

## Directory Structure
```
Agentic/chemotherapy_workflow/
├── agents/                           # Individual Agent Module implementations
│   ├── __init__.py
│   ├── m01_readiness_agent.py        # Module 1: Patient Assessment & Readiness
│   ├── m02_dose_calculation_agent.py  # Module 2: Planning & Dose Calculation
│   ├── m03_order_verification_agent.py# Module 3: Order Verification
│   ├── m04_cycle_support_agent.py    # Module 4: Cycle Decision Support
│   ├── m05_toxicity_agent.py         # Module 5: Toxicity Intelligence
│   ├── m06_lifetime_safety_agent.py  # Module 6: Lifetime Exposure & Safety
│   ├── m07_response_rdi_agent.py     # Module 7: Treatment Performance & Response
│   ├── m08_emergency_support_agent.py # Module 8: Emergency Chemotherapy Support
│   ├── m09_monitoring_agent.py       # Module 9: Monitoring & Follow-up
│   ├── m10_pharmacy_admin_agent.py   # Module 10: Pharmacy & Administration
│   ├── m11_documentation_agent.py    # Module 11: Documentation & Clinical AI
│   └── m12_analytics_quality_agent.py# Module 12: Analytics & Quality Improvement
├── __init__.py
├── state.py                          # Shared workflow state dataclasses
├── data_sources.py                   # Data access interfaces for EMR & Protocols
├── workflow.py                       # Orchestration graph runner
├── api.py                            # FastAPI REST handlers
└── PLAN.md                           # This architecture plan
```

## 12 AI Agent Modules Summary
1. **m01_readiness_agent.py**: Pre-cycle eligibility, ECOG, organ function clearance.
2. **m02_dose_calculation_agent.py**: BSA Mosteller, Calvert AUC5 formula, renal/hepatic adjustments.
3. **m03_order_verification_agent.py**: Drug interaction, route, sequencing, premedication verification.
4. **m04_cycle_support_agent.py**: Nadir recovery checks, dose delay/reduction logic, NCCN citations.
5. **m05_toxicity_agent.py**: CTCAE v5.0 grading, toxicity prediction, trend tracking.
6. **m06_lifetime_safety_agent.py**: Cumulative exposure ledgers, cardiotoxicity / neurotoxicity limits, hard stop engine.
7. **m07_response_rdi_agent.py**: Relative Dose Intensity (RDI), ARDI, RECIST response tracking.
8. **m08_emergency_support_agent.py**: Neutropenic sepsis, TLS, extravasation, anaphylaxis surveillance.
9. **m09_monitoring_agent.py**: Lab, imaging, cardiac follow-up schedulers.
10. **m10_pharmacy_admin_agent.py**: Infusion chair timing, cold chain, 5-rights bedside verification.
11. **m11_documentation_agent.py**: Auto-drafting cycle notes, explainable AI recommendation logs.
12. **m12_analytics_quality_agent.py**: Cohort quality scores, guideline adherence, unit-wide KPI metrics.
