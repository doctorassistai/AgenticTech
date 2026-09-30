# Pulmonology Module Workflow & Medical Reference Guide

This document details the software architecture, clinical workflow, track components, field definitions, and medical terminology used inside the `pulmonology-module`.

---

## 1. Module Workflow Architecture

```
                               ┌─────────────────────────────┐
                               │     PulmonologyContext      │
                               │  (track, activeTab, data)   │
                               └──────────────┬──────────────┘
                                              │
                   ┌──────────────────────────┼──────────────────────────┐
                   ▼                          ▼                          ▼
         ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
         │ Asthma/COPD Track │      │    ILD Track      │      │ Sleep Med Track   │
         └─────────┬─────────┘      └─────────┬─────────┘      └─────────┬─────────┘
                   │                          │                          │
        ┌──────────┴──────────┐    ┌──────────┴──────────┐    ┌──────────┴──────────┐
        │ 1. Overview         │    │ 1. Overview         │    │ 1. Overview         │
        │ 2. Spirometry/PFT   │    │ 2. HRCT Imaging     │    │ 2. Sleep Study(PSG) │
        │ 3. Inhalers & Meds  │    │ 3. DLCO & 6MWT      │    │ 3. PAP Therapy      │
        │ 4. Exacerbations    │    │ 4. Close Visit      │    │ 4. Close Visit      │
        │ 5. Close Visit      │    └─────────────────────┘    └─────────────────────┘
        └─────────────────────┘
```

The module operates as a stateful single-page workflow. The **TrackSelector** switches between three pathways:
1. **Asthma / COPD** (Airway obstruction)
2. **ILD** (Restrictive parenchymal scarring)
3. **Sleep Medicine** (Sleep apnea & nocturnal hypoventilation)

---

## 2. Pathway Breakdown & Clinical Terms

### Pathway 1: Asthma / COPD Track

#### A. Key Fields & Clinical Terms
- **Pack-Years**: A metric measuring cumulative smoking exposure.
  $$\text{Pack-Years} = \frac{\text{Cigarettes smoked per day}}{20} \times \text{Years smoked}$$
- **mMRC Dyspnea Grade**: Modified Medical Research Council dyspnea scale (Grade 0 to 4) quantifying shortness of breath during daily physical activities.
- **CAT Score**: COPD Assessment Test ($0 - 40$ scale). Scores $>10$ indicate high symptom burden.
- **ACT Score**: Asthma Control Test ($5 - 25$ scale). Scores $<20$ signify uncontrolled asthma.

#### B. Spirometry / PFT Parameters
- **$\text{FVC}$ (Forced Vital Capacity)**: Total volume of air exhaled forcefully after a maximal inhalation.
- **$\text{FEV}_1$ (Forced Expiratory Volume in 1 second)**: Volume of air exhaled during the first second of maximal forced exhalation.
- **$\text{FEV}_1/\text{FVC}$ Ratio**: The fraction of air exhaled in the first second. A ratio $< 70\%$ confirms airway obstruction.
- **Reversibility Testing**: Spirometry repeated $15 - 30$ mins after inhaling a short-acting bronchodilator (Salbutamol 400 mcg).
  - *Positive Reversibility*: An increase in $\text{FEV}_1$ by **$>12\%$ AND $>200\text{ mL}$**, characteristic of Asthma.

#### C. Medications & Biologics
- **ICS / LABA / LAMA**:
  - *ICS*: Inhaled Corticosteroid (e.g., Budesonide, Fluticasone) reduces airway inflammation.
  - *LABA*: Long-Acting Beta2-Agonist (e.g., Formoterol, Salmeterol) relaxes bronchial smooth muscle.
  - *LAMA*: Long-Acting Muscarinic Antagonist (e.g., Tiotropium, Glycopyrronium) blocks acetylcholine-mediated bronchoconstriction.
- **Biologics**: Targeted monoclonal antibodies for severe eosinophilic or allergic asthma (e.g., Omalizumab anti-IgE, Dupilumab anti-IL4/13).

---

### Pathway 2: Interstitial Lung Disease (ILD) Track

#### A. Key Fields & Clinical Terms
- **HRCT Patterns**:
  - **UIP Pattern (Usual Interstitial Pneumonia)**: Hallmark of IPF showing subpleural, basal-predominant honeycombing and traction bronchiectasis.
  - **NSIP Pattern (Non-Specific Interstitial Pneumonia)**: Homogeneous ground-glass opacities with lower lobe volume loss.
  - **Honeycombing**: Clustered cystic airspaces (3-10 mm) representing destroyed alveolar architecture.
- **Physiology Parameters**:
  - **$\text{DLCO}$ (Diffusion Capacity of the Lung for Carbon Monoxide)**: Measures the lung's capacity to transfer gas across the alveolar-capillary membrane into red blood cells. Reduced in ILD ($\text{DLCO} < 70\%$).
  - **6MWT (6-Minute Walk Test)**: Standardized test measuring distance walked in 6 minutes, recording **Nadir $\text{SpO}_2$** (lowest oxygen level reached).
- **Antifibrotic Agents**: Medications like **Nintedanib** (tyrosine kinase inhibitor) or **Pirfenidone** that slow down the rate of pulmonary decline in fibrotic ILD.

---

### Pathway 3: Sleep Medicine Track

#### A. Key Fields & Clinical Terms
- **ESS (Epworth Sleepiness Scale)**: Questionnaire ($0 - 24$) measuring daytime sleepiness. Scores $>10$ indicate excessive daytime sleepiness.
- **STOP-BANG**: 8-item screening tool for Obstructive Sleep Apnea risk.
- **Polysomnography (PSG) Metrics**:
  - **AHI (Apnea-Hypopnea Index)**: Average number of apneas and hypopneas per hour of sleep.
    - *Mild OSA*: AHI $5 - 15$ events/hr
    - *Moderate OSA*: AHI $15 - 30$ events/hr
    - *Severe OSA*: AHI $>30$ events/hr
  - **Apnea**: Cessation of airflow lasting $\ge 10$ seconds.
  - **Hypopnea**: $\ge 30\%$ reduction in airflow lasting $\ge 10$ seconds with $\ge 3\%$ oxygen desaturation.
- **PAP Therapy (Positive Airway Pressure)**:
  - **CPAP**: Continuous Positive Airway Pressure delivering constant pneumatic splinting.
  - **APAP**: Auto-titrating CPAP adjusting pressure dynamically based on airway resistance.
  - **Compliance Metric**: Adherence standard defined as usage $\ge 4$ hours/night on $\ge 70\%$ of nights.

---

## 3. Pulmonary Procedure Notes Reference

### 1. Flexible Bronchoscopy & EBUS
- **Airway Inspection**: Visual evaluation of vocal cord mobility, tracheal patency, main carina sharp border, and segmental bronchi.
- **BAL (Bronchoalveolar Lavage)**: Instilling sterile saline into a lung segment and aspirating fluid for microbiology/cytology.
- **EBUS-TBNA (Endobronchial Ultrasound Transbronchial Needle Aspiration)**: Using real-time ultrasound guidance to biopsy mediastinal lymph nodes (e.g., Stations 4R, 7, 11R) for lung cancer staging.

### 2. Thoracentesis (Pleural Tap)
- **Light's Criteria**: Distinguishes **Exudative** (inflammatory/malignant) from **Transudation** (heart/liver failure) pleural effusion.
  - Pleural Protein / Serum Protein $> 0.5$
  - Pleural LDH / Serum LDH $> 0.6$
  - Pleural LDH $> 2/3$ upper limit of normal serum LDH
- **Safety Limit**: Maximum **$1.5\text{ Liters}$** removed per session to prevent Re-expansion Pulmonary Edema (REPE).

### 3. Chest Tube / Intercostal Drain (ICD)
- **Insertion Site**: The "Safe Triangle" bounded by the lateral edge of Pectoralis Major, anterior edge of Latissimus Dorsi, and line superior to the 5th intercostal space.
- **Underwater Seal System**: Tube connected to a water seal chamber to allow air/fluid to exit the pleural space while preventing air from returning.
