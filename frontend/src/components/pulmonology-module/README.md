# Pulmonology Record Module (`pulmonology-module`)

A modular React architecture for Pulmonology clinical workflows and procedure notes.

---

## 📚 Documentation & Guides

- 📘 [**Pulmonology Concepts & Glossary**](file:///c:/drassist%20changes/05-08-2026/pulmonology-module/docs/pulmonology_concepts.md) — What is Pulmonology, ventilation vs gas exchange, obstructive vs restrictive patterns, and medical terms.
- 📙 [**Workflow & Medical Reference Guide**](file:///c:/drassist%20changes/05-08-2026/pulmonology-module/docs/pulmonology_workflow_guide.md) — How the software module works, track breakdowns, field definitions, PFT parameters, and procedure medical terms.

---

## 📁 Directory Structure

```text
pulmonology-module/
├── PulmonologyWorkflow.jsx        // Main Dashboard tab entry component
├── PulmonologyProcedure.jsx       // ProcedureNotes entry component
├── README.md                      // Module documentation
├── docs/
│   ├── pulmonology_concepts.md    // Core concepts & medical terminology
│   └── pulmonology_workflow_guide.md // Module workflow & field guide
├── context/
│   └── PulmonologyContext.jsx     // Shared state (track, activeTab, formData)
├── components/
│   ├── FormField.jsx              // Reusable inputs (text, select, date, derived)
│   ├── Section.jsx                // Styled section container
│   └── TrackSelector.jsx          // Toggle bar for Pulmonology clinical tracks
└── tabs/
    ├── asthma-copd/               // Obstructive Airway Disease Track
    │   ├── OverviewTab.jsx
    │   ├── SpirometryTab.jsx      // PFTs, FEV1, FVC, reversibility
    │   ├── MedicationsTab.jsx     // Inhalers, OCS, biologics
    │   ├── ExacerbationTab.jsx   // ER visits, ICU history, triggers
    │   └── CloseTab.jsx
    ├── ild/                       // Interstitial Lung Disease Track
    │   ├── OverviewTab.jsx
    │   ├── ImagingTab.jsx         // HRCT patterns & honeycombing
    │   ├── PhysiologyTab.jsx      // DLCO, 6-min walk test, antifibrotics
    │   └── CloseTab.jsx
    ├── sleep/                     // Sleep Medicine Track
    │   ├── OverviewTab.jsx
    │   ├── PolysomnographyTab.jsx // AHI, ESS score, desaturations
    │   ├── TherapyTab.jsx         // PAP pressure & compliance
    │   └── CloseTab.jsx
    └── procedures/                // Procedure Reference Guides
        ├── BronchoscopyGuide.jsx  // Flexible Bronchoscopy & EBUS
        ├── ThoracentesisGuide.jsx // Diagnostic & therapeutic pleural tap
        └── ChestTubeGuide.jsx     // Intercostal Drain (ICD) insertion
```

---

## ⚙️ Key Architecture

### 1. State Management (`PulmonologyContext.jsx`)
All state for form fields, active clinical tracks, and tabs is managed centrally via React Context:
- **`track`**: Tracks active pathway (`'asthma-copd'`, `'ild'`, `'sleep'`).
- **`activeTab`**: Tracks active tab under the current pathway.
- **`formData`**: Stores all patient input values across tabs without data loss when switching tabs.

### 2. Clinical Pathways Covered
1. **Asthma / COPD**:
   - Pack-years, smoking status, mMRC dyspnea grade, CAT score, ACT score.
   - Spirometry: FVC, FEV1, FEV1/FVC ratio, post-bronchodilator reversibility (+12% and +200mL).
   - Inhaler regimens (ICS/LABA/LAMA), technique compliance check, and OCS/biologics.
   - Exacerbation frequency, prior intubation, blood eosinophil counts.
2. **Interstitial Lung Disease (ILD)**:
   - ILD Subtypes (IPF, CTD-ILD, Chronic HP, Sarcoidosis).
   - HRCT patterns (Definite UIP, Probable UIP, subpleural honeycombing, traction bronchiectasis).
   - DLCO (% predicted), TLC, 6-Minute Walk Test (distance, nadir SpO2, Borg scale).
   - Antifibrotic therapy (Nintedanib, Pirfenidone) and immunosuppressants.
3. **Sleep Medicine**:
   - Sleepiness screeners: Epworth Sleepiness Scale (ESS), STOP-BANG score, Mallampati class.
   - Polysomnography (PSG): AHI, Obstructive vs Central Apnea index, Nadir SpO2, T90.
   - PAP Therapy: APAP/CPAP/BiPAP settings, mask type, compliance (>4 hrs/night), residual AHI.

### 3. Procedures Logged (`PulmonologyProcedure.jsx`)
- **Flexible Bronchoscopy & EBUS**: Airway inspection, BAL, biopsy passes, EBUS lymph node staging.
- **Thoracentesis**: Ultrasound-guided pleural tap, fluid appearance, Light's criteria (transudate vs exudate), volume limit safety check.
- **Chest Tube (ICD)**: Insertion site (Safe Triangle), tube Fr size, underwater seal status, air leak monitoring.
