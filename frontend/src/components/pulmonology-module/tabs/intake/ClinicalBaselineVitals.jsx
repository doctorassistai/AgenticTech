import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";

// Stable keys separate from display labels. Labels can be reworded in the UI
// without breaking stored data, downstream queries, or Mongo migrations —
// the same reason nephrotoxin tracking moved off flat display strings.
const SYMPTOMS = [
  { key: "dyspnea_exertional", label: "Dyspnea (Exertional)" },
  { key: "dyspnea_rest", label: "Dyspnea (At Rest)" },
  { key: "chronic_cough", label: "Chronic Cough" },
  { key: "sputum_production", label: "Sputum Production" },
  { key: "wheezing", label: "Wheezing" },
  { key: "chest_tightness", label: "Chest Tightness" },
  { key: "hemoptysis", label: "Hemoptysis" },
  { key: "orthopnea", label: "Orthopnea" },
  { key: "pnd", label: "PND" },
  { key: "daytime_somnolence", label: "Daytime Somnolence" },
  { key: "snoring", label: "Snoring" },
  { key: "fatigue", label: "Fatigue" },
  { key: "weight_loss", label: "Weight Loss" },
];

const MEDS = [
  { key: "saba", label: "SABA (Albuterol)" },
  { key: "sama", label: "SAMA (Ipratropium)" },
  { key: "ics", label: "ICS (Fluticasone, etc.)" },
  { key: "laba", label: "LABA (Salmeterol, etc.)" },
  { key: "lama", label: "LAMA (Tiotropium, etc.)" },
  { key: "triple_therapy", label: "Triple Therapy (ICS/LAMA/LABA)" },
  { key: "oral_steroids", label: "Oral Corticosteroids" },
  { key: "biologics", label: "Biologics (Omalizumab, etc.)" },
  { key: "macrolides", label: "Macrolides (Azithromycin)" },
  { key: "pde4_inhibitor", label: "Phosphodiesterase-4 Inhibitor" },
  { key: "home_oxygen", label: "Home Oxygen" },
];

const BaselineTab = () => {
  const { formData, updateField, registerField } = usePulmonology();
  const selectedSymptoms = Array.isArray(formData.pulm_symptoms)
    ? formData.pulm_symptoms.reduce((acc, k) => ({ ...acc, [k]: true }), {})
    : (formData.pulm_symptoms || {});
  const selectedMeds = Array.isArray(formData.pulm_meds)
    ? formData.pulm_meds.reduce((acc, k) => ({ ...acc, [k]: true }), {})
    : (formData.pulm_meds || {});

  // Register non-FormField checklist groups with the dynamic dictation registry
  useEffect(() => {
    if (!registerField) return undefined;
    const unreg1 = registerField({
      k: "pulm_symptoms",
      name: "pulm_symptoms",
      label: "Active Respiratory Symptoms",
      type: "checks",
      options: SYMPTOMS.map((s) => s.label),
      hint: "All reported symptoms: Dyspnea (Exertional), Dyspnea (At Rest), Chronic Cough, Sputum Production, Wheezing, Chest Tightness, Hemoptysis, Orthopnea, PND, Daytime Somnolence, Snoring, Fatigue, Weight Loss",
    });
    const unreg2 = registerField({
      k: "pulm_meds",
      name: "pulm_meds",
      label: "Current Respiratory Medications & Inhalers",
      type: "checks",
      options: MEDS.map((m) => m.label),
      hint: "All active respiratory meds: SABA (Albuterol), SAMA (Ipratropium), ICS (Fluticasone, etc.), LABA (Salmeterol, etc.), LAMA (Tiotropium, etc.), Triple Therapy (ICS/LAMA/LABA), Oral Corticosteroids, Biologics (Omalizumab, etc.), Macrolides (Azithromycin), Phosphodiesterase-4 Inhibitor, Home Oxygen",
    });
    return () => {
      if (unreg1) unreg1();
      if (unreg2) unreg2();
    };
  }, [registerField]);

  const handleToggle = (group, key) => {
    const current = Array.isArray(formData[group])
      ? formData[group].reduce((acc, k) => ({ ...acc, [k]: true }), {})
      : (formData[group] || {});
    const updated = { ...current, [key]: !current[key] };
    updateField(group, updated);
  };

  // BMI is a fixed formula, not a judgment call — same category as GOLD
  // group in ScreeningAlertsTab. It also feeds the BODE Index there, so it
  // needs to actually be computed rather than sit as an empty "derived" field.
  useEffect(() => {
    const weightKg = parseFloat(formData.pulm_clinical_weight);
    const heightM = parseFloat(formData.pulm_clinical_height) / 100;
    if (weightKg > 0 && heightM > 0) {
      const bmi = (weightKg / (heightM * heightM)).toFixed(1);
      if (formData.pulm_clinical_bmi !== bmi) {
        updateField("pulm_clinical_bmi", bmi);
      }
    }
  }, [formData.pulm_clinical_weight, formData.pulm_clinical_height, formData.pulm_clinical_bmi, updateField]);

  // Rule-based Triage Engine logic
  useEffect(() => {
    let pathway = "";
    
    // Check Reason for Visit first (from OnboardingTab)
    if (formData.pulm_visit_reason === "COPD / Asthma Exacerbation") {
      pathway = "Acute Exacerbation Protocol";
    } else if (formData.pulm_visit_reason === "Sleep Apnea Evaluation") {
      pathway = "Sleep Study Protocol";
    } 
    // Fallback to Primary Diagnosis (from BaselineTab)
    else if (formData.pulm_primary_dx === "ILD / Fibrosis") {
      pathway = "ILD Workup";
    } else if (formData.pulm_primary_dx === "Asthma") {
      pathway = "Asthma Protocol";
    } else if (formData.pulm_primary_dx === "COPD") {
      pathway = "COPD Maintenance Pathway";
    }

    if (pathway && formData.pulm_auto_pathway !== pathway) {
      updateField("pulm_auto_pathway", pathway);
    }
  }, [formData.pulm_visit_reason, formData.pulm_primary_dx, formData.pulm_auto_pathway, updateField]);

  const toggleStyle = (isActive) => ({
    padding: "6px 12px",
    border: isActive ? "1px solid #000000" : "1px solid #cccccc",
    backgroundColor: isActive ? "#000000" : "#ffffff",
    color: isActive ? "#ffffff" : "#333333",
    fontSize: "11.5px",
    fontWeight: "500",
    cursor: "pointer",
    display: "inline-block",
    marginRight: "8px",
    marginBottom: "8px",
    borderRadius: "2px",
    transition: "all 0.15s ease",
  });

  // Step 3: Dynamic Etiology Dropdown Options
  let etiologyOptions = ["", "Unknown"];
  if (formData.pulm_primary_dx === "Asthma") {
    etiologyOptions = ["", "Eosinophilic", "Allergic", "Non-Type 2", "Occupational", "Unknown"];
  } else if (formData.pulm_primary_dx === "COPD") {
    etiologyOptions = ["", "Smoking-related", "Alpha-1 Antitrypsin Def", "Occupational/Biomass", "Unknown"];
  } else if (formData.pulm_primary_dx === "ILD / Fibrosis") {
    etiologyOptions = ["", "Idiopathic (IPF)", "Connective Tissue (CTD-ILD)", "Hypersensitivity (HP)", "Sarcoidosis", "Unknown"];
  } else {
    // Default fallback showing a mix
    etiologyOptions = ["", "Smoking-related", "Alpha-1 Antitrypsin Def", "Occupational/Biomass", "Eosinophilic", "Allergic", "Unknown"];
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Clinical Baseline & Vitals" />

      <Section id="sec_comorbidities" title="General Clinical Baseline & Comorbidities" note="NLP-powered history extraction can auto-populate these fields.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Date of Baseline Assessment" name="pulm_baseline_date" type="date" />
          <FormField label="Weight (kg)" name="pulm_clinical_weight" type="number" />
          <FormField label="Height (cm)" name="pulm_clinical_height" type="number" />
          <FormField label="BMI (Auto-Calculated)" name="pulm_clinical_bmi" type="derived" placeholder="Requires weight + height" />
          <FormField label="Baseline SpO2 (%) Room Air" name="pulm_baseline_spo2" type="number" />
          <FormField label="Respiratory Rate (breaths/min)" name="pulm_baseline_rr" type="number" />
          <FormField label="Baseline Heart Rate" name="pulm_baseline_hr" type="number" />
          <FormField label="Blood Pressure (Sys/Dia)" name="pulm_baseline_bp" placeholder="e.g., 120/80" />
        </div>
        <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>General Comorbidities</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
            <FormField label="Hypertension" name="hx_htn" type="select" options={["", "Yes", "No"]} />
            <FormField label="Heart Failure / Cor Pulmonale" name="hx_hf" type="select" options={["", "Yes", "No"]} />
            <FormField label="Coronary Artery Disease" name="hx_cad" type="select" options={["", "Yes", "No"]} />
            <FormField label="Atrial Fibrillation" name="hx_afib" type="select" options={["", "Yes", "No"]} />
            <FormField label="Diabetes" name="hx_diabetes" type="select" options={["", "Yes", "No"]} />
            <FormField label="Chronic Kidney Disease (CKD)" name="hx_ckd" type="select" options={["", "Yes", "No"]} />
            <FormField label="GERD" name="hx_gerd" type="select" options={["", "Yes", "No"]} />
            <FormField label="Obstructive Sleep Apnea" name="hx_osa" type="select" options={["", "Yes", "No"]} />
            <FormField label="Osteoporosis" name="hx_osteo" type="select" options={["", "Yes", "No"]} />
            <FormField label="Rheumatoid Arthritis / CTD" name="hx_ctd" type="select" options={["", "Yes", "No"]} />
            <FormField label="Immunocompromised" name="hx_immuno" type="select" options={["", "Yes", "No"]} />
            <FormField label="Lung Cancer" name="hx_cancer" type="select" options={["", "Yes", "No"]} />
          </div>
        </div>
      </Section>

      <Section id="sec_pulm_history" title="Structured Pulmonary Disease History" note="Granular details regarding the patient's respiratory background.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Primary Pulmonary Diagnosis" name="pulm_primary_dx" type="select" options={["", "COPD", "Asthma", "Asthma-COPD Overlap", "ILD / Fibrosis", "Bronchiectasis", "Pulmonary Hypertension"]} />
          <FormField label="Year of Initial Diagnosis" name="pulm_dx_year" type="number" />
          <FormField label="Etiology / Phenotype" name="pulm_etiology" type="select" options={etiologyOptions} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Lifetime Pneumonia Episodes" name="hx_pneumonia_count" type="number" />
          <FormField label="Prior TB Treatment?" name="hx_tb" type="select" options={["", "No", "Yes - Completed", "Yes - Incomplete"]} />
          {(formData.hx_tb === "Yes - Completed" || formData.hx_tb === "Yes - Incomplete") && (
            <FormField label="TB Treatment Year" name="hx_tb_year" type="number" placeholder="YYYY" />
          )}
          <FormField label="Prior Pulmonary Embolism?" name="hx_pe" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior Exacerbations (Past Yr)" name="hx_exac_count" type="number" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Prior ICU Admissions for Respiratory?" name="hx_icu_resp" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior Intubation / Mechanical Vent?" name="hx_intubation" type="select" options={["", "Yes", "No"]} />
          {(formData.hx_intubation === "Yes") && (
            <FormField label="Year of Last Intubation" name="hx_intubation_year" type="number" placeholder="YYYY" />
          )}
          <FormField label="Prior NIV (BiPAP/CPAP) Usage?" name="hx_niv" type="select" options={["", "Yes - Acute", "Yes - Chronic Home", "No"]} />
        </div>
        <FormField label="Additional Pulmonary History Notes" name="hx_pulm_notes" type="textarea" placeholder="Detailed history context..." />
      </Section>

      <Section id="sec_pft_status" title="Current Pulmonary Function & Functional Status" note="Most recent values — feeds automated scoring (GOLD stage, BODE, GAP Index) on the Screening & Alerts tab.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Current FEV1 (% Predicted)" name="pulm_current_fev1_pct" type="number" placeholder="e.g., 42" />
          <FormField label="Current FVC (% Predicted)" name="pulm_current_fvc_pct" type="number" placeholder="e.g., 58" />
          <FormField label="Current DLCO (% Predicted)" name="pulm_current_dlco_pct" type="number" placeholder="For ILD staging" />
          <FormField label="6-Minute Walk Distance (m)" name="pulm_current_6mwt_m" type="number" placeholder="e.g., 310" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="Baseline PaO2 (mmHg)" name="pulm_current_pao2" type="number" placeholder="e.g., 65" />
          <FormField label="Baseline PaCO2 (mmHg)" name="pulm_current_paco2" type="number" placeholder="e.g., 45" />
          <FormField label="Baseline pH" name="pulm_current_ph" type="number" placeholder="e.g., 7.4" />
          <FormField label="Baseline HCO3 (mEq/L)" name="pulm_current_hco3" type="number" placeholder="e.g., 24" />
        </div>
      </Section>

      <Section id="sec_imaging" title="Baseline Imaging (Radiology)" note="Most recent significant imaging findings.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Date of Last Chest X-Ray" name="img_cxr_date" type="date" />
          <FormField label="Date of Last Chest CT" name="img_ct_date" type="date" />
          <FormField label="Primary Radiographic Finding" name="img_primary_finding" type="select" options={["", "Normal / Clear", "Hyperinflation / Emphysema", "Fibrosis / Honeycombing", "Bronchiectasis", "Lung Nodule / Mass", "Pleural Effusion"]} />
        </div>
      </Section>

      <Section id="sec_vaccines" title="Vaccination & Allergy Screening" note="Respiratory infection prevention and trigger avoidance.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Influenza Vaccine" name="vac_flu" type="select" options={["", "Up to Date", "Overdue", "Declined"]} />
          <FormField label="Pneumococcal Vaccine" name="vac_pneumo" type="select" options={["", "Complete (PCV/PPSV)", "Partial", "Overdue", "Declined"]} />
          <FormField label="RSV Vaccine" name="vac_rsv" type="select" options={["", "Eligible - Received", "Eligible - Not Received", "Not Yet Eligible"]} />
          <FormField label="COVID-19 Vaccine" name="vac_covid" type="select" options={["", "Up to Date", "Overdue", "Declined"]} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <FormField label="Allergies (Medications)" name="alg_meds" type="textarea" placeholder="e.g., NKDA" />
          <FormField label="Environmental Triggers" name="alg_env" type="textarea" placeholder="e.g., Dust mites, Pollen, Mold" />
        </div>
      </Section>

      <Section id="sec_surgical" title="Surgical & Thoracic History" note="Prior procedures impacting current respiratory care.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Prior Lung Surgery (Lobectomy/etc)?" name="surg_lung" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior Lung Volume Reduction?" name="surg_lvrs" type="select" options={["", "Yes (Surgical)", "Yes (Endobronchial Valves)", "No"]} />
          <FormField label="Prior Lung Transplant?" name="surg_tx" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior Thoracentesis / Chest Tube?" name="surg_pleural" type="select" options={["", "Yes", "No"]} />
        </div>
        {(formData.surg_lung === "Yes" || formData.surg_lvrs?.startsWith("Yes") || formData.surg_tx === "Yes" || formData.surg_pleural === "Yes") && (
          <FormField label="Additional Thoracic Surgical Notes" name="surg_thoracic_notes" type="textarea" />
        )}
      </Section>

      <Section id="sec_family" title="Family History & Hereditary Conditions" note="Genetic tracking for respiratory diseases.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "20px" }}>
          <FormField label="Family Hx of Lung Disease?" name="fam_lung" type="select" options={["", "Yes", "No", "Unknown"]} />
          {formData.fam_lung === "Yes" && (
            <FormField label="Specific Hereditary Conditions (e.g., Alpha-1, Cystic Fibrosis, Asthma, Lung Cancer)" name="fam_lung_details" type="textarea" />
          )}
        </div>
      </Section>

      <Section id="sec_symptoms" title="Symptom Profile & Chief Complaint" note="Select the primary reason for visit and current symptoms.">
        <div style={{ marginBottom: "16px" }}>
          <FormField label="Chief Presenting Reason" name="chief_complaint" type="textarea" placeholder="e.g., Patient presents with worsening exertional dyspnea and increased sputum production over 3 weeks..." />
        </div>
        <div>
          {SYMPTOMS.map((sym) => {
            const isActive = selectedSymptoms[sym.key];
            return (
              <div key={sym.key} style={toggleStyle(isActive)} onClick={() => handleToggle("pulm_symptoms", sym.key)}>
                {isActive ? "[x] " : "[ ] "}{sym.label}
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="sec_meds" title="Respiratory Medication & Inhaler History" note="Current regimen tracking.">
        <div>
          {MEDS.map((med) => {
            const isActive = selectedMeds[med.key];
            return (
              <div key={med.key} style={toggleStyle(isActive)} onClick={() => handleToggle("pulm_meds", med.key)}>
                {isActive ? "[x] " : "[ ] "}{med.label}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Inhaler Technique / Adherence" name="med_adherence" type="select" options={["", "Good", "Fair/Inconsistent", "Poor Technique", "Poor Adherence"]} />
          {selectedMeds["home_oxygen"] && (
            <>
              <FormField label="Current Home O2 Flow (L/min)" name="med_o2_flow" type="number" />
              <FormField label="Current Home O2 Hours/Day" name="med_o2_hours" type="number" />
            </>
          )}
        </div>
      </Section>

      <Section id="sec_triage" title="RULE-BASED TRIAGE ENGINE" variant="dark" note="Automated pathway routing based on clinical rules.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "20px", marginBottom: "16px" }}>
          {/* Input Data Summary */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>
              Engine Inputs
            </h4>
            <ul style={{ fontSize: "11px", color: "#444", paddingLeft: "16px", margin: "0", lineHeight: "1.6" }}>
              <li><strong>Visit Reason:</strong> {formData.pulm_visit_reason || "Not set (See Onboarding Tab)"}</li>
              <li><strong>Primary DX:</strong> {formData.pulm_primary_dx || "Not set (See above)"}</li>
            </ul>
          </div>
          
          {/* Output Field */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>
              CARE PATHWAY AUTO-ASSIGNMENT
            </h4>
            <FormField 
              label="RECOMMENDED PATHWAY (DERIVED)" 
              name="pulm_auto_pathway" 
              type="text" 
              readOnly={true}
              placeholder="Awaiting sufficient data..." 
            />
            <div style={{ fontSize: "10px", color: "#888888", marginTop: "6px", fontStyle: "italic" }}>
              Recommendation derived automatically from inputs on the left.
            </div>
          </div>
        </div>
      </Section>

    </div>
  );
};

export default BaselineTab;
