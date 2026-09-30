import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import { generateIntakeTriage } from "../../services/nephrologyApi";

const SYMPTOMS = [
  "Reduced urine",
  "Increased urine",
  "Blood in urine",
  "Foamy urine",
  "Swelling",
  "Breathlessness",
  "Fatigue",
  "Nausea",
  "Vomiting",
  "Flank pain",
  "Fever",
  "Rash",
  "Joint symptoms"
];

const MEDS = [
  "NSAIDs",
  "ACE inhibitors",
  "ARBs",
  "Diuretics",
  "SGLT2 inhibitors",
  "Antibiotics",
  "Contrast exposure",
  "Chemotherapy",
  "Immunosuppressants",
  "Steroids",
  "Nephrotoxic drugs"
];


const PROFILE_DICTATION_FIELDS = [
  { k: "v2_baseline_date", label: "Date of Baseline Assessment", type: "date" },
  { k: "v2_clinical_age", label: "Age", type: "number" },
  { k: "v2_clinical_sex", label: "Biological Sex", type: "select", options: ["Male", "Female", "Other"] },
  { k: "v2_clinical_weight", label: "Weight", type: "number", unit: "kg" },
  { k: "v2_clinical_height", label: "Height", type: "number", unit: "cm" },
  { k: "v2_clinical_bp", label: "Blood Pressure", type: "text" },
  { k: "v2_hx_diabetes", label: "Diabetes History", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_htn", label: "Hypertension History", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_hf", label: "Heart Failure History", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_liver", label: "Liver Disease History", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_cancer", label: "Cancer History", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_autoimmune", label: "Autoimmune Disease History", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_kidney_etiology", label: "Known Kidney Disease Etiology", type: "text" },
  { k: "v2_hx_kidney_year", label: "Year Kidney Disease Diagnosed", type: "number" },
  { k: "v2_hx_kidney_base_cr", label: "Previous Baseline Creatinine", type: "number", unit: "mg/dL" },
  { k: "v2_hx_kidney_bx", label: "Previous Native Kidney Biopsy", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_aki_count", label: "Previous AKI Episodes", type: "number" },
  { k: "v2_hx_dialysis_modality", label: "Previous Dialysis Experience", type: "select", options: ["None", "Hemodialysis (HD)", "Peritoneal Dialysis (PD)", "CRRT/SLED"] },
  { k: "v2_hx_kidney_notes", label: "Kidney History and Biopsy Notes", type: "textarea" },
  { k: "v2_hx_surg_tx", label: "Prior Kidney Transplant", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_surg_avf", label: "Prior AV Fistula or Graft", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_surg_pd", label: "Prior PD Catheter", type: "select", options: ["Yes", "No"] },
  { k: "v2_hx_surg_nephrectomy", label: "Prior Nephrectomy", type: "select", options: ["No", "Yes (Left)", "Yes (Right)", "Yes (Bilateral)"] },
  { k: "v2_hx_surg_notes", label: "Additional Surgical Notes", type: "textarea" },
  { k: "v2_hx_fam_ckd", label: "Family History of CKD or ESRD", type: "select", options: ["Yes", "No", "Unknown"] },
  { k: "v2_hx_fam_hereditary", label: "Hereditary Kidney Conditions", type: "textarea" },
  { k: "v2_chief_complaint", label: "Chief Presenting Reason", type: "textarea" },
  { k: "v2_allergies_doc", label: "Allergy Documentation", type: "textarea" },
  { k: "v2_allergies_severity", label: "Allergy Severity", type: "select", options: ["Mild (e.g., Local rash)", "Moderate (e.g., Systemic, Wheezing)", "Severe (Anaphylaxis)", "Unknown"] },
  { k: "v2_baseline_cr", label: "Previous Creatinine Trajectory", type: "text" },
  { k: "v2_baseline_egfr", label: "eGFR Trajectory", type: "text" },
  { k: "v2_baseline_protein", label: "Urine Protein Trajectory", type: "text" },
  { k: "v2_baseline_bp", label: "Blood Pressure Trajectory", type: "text" },
  { k: "v2_symptoms", label: "Symptoms", type: "multiselect", options: SYMPTOMS },
  { k: "v2_meds", label: "High Risk Medications", type: "multiselect", options: MEDS },
];

const ProfileBaselineTab = () => {
  const { formData, updateField } = useNephrology();
  const selectedSymptoms = formData.v2_symptoms || {};
  const selectedMeds = formData.v2_meds || {};
  const [isGeneratingTriage, setIsGeneratingTriage] = useState(false);

  const handleGenerateTriage = async () => {
    setIsGeneratingTriage(true);
    try {
      const result = await generateIntakeTriage(formData);
      const values = result?.data || {};
      if (values.v2_ai_pathway) updateField("v2_ai_pathway", values.v2_ai_pathway);
      if (values.v2_ai_risk_ckd) updateField("v2_ai_risk_ckd", values.v2_ai_risk_ckd);
      if (values.v2_ai_risk_cvd) updateField("v2_ai_risk_cvd", values.v2_ai_risk_cvd);
      if (values.v2_ai_risk_hosp) updateField("v2_ai_risk_hosp", values.v2_ai_risk_hosp);
    } catch (err) {
      console.error("Failed to generate triage:", err);
    } finally {
      setIsGeneratingTriage(false);
    }
  };

  const transformProfileValues = ({ values }) => {
    const transformed = { ...values };
    
    if (transformed.v2_symptoms) {
      const symArray = Array.isArray(transformed.v2_symptoms) 
        ? transformed.v2_symptoms 
        : String(transformed.v2_symptoms).split(',').map(s => s.trim());
      const newSym = { ...selectedSymptoms };
      symArray.forEach(sym => {
        if (SYMPTOMS.includes(sym)) newSym[sym] = true;
      });
      transformed.v2_symptoms = newSym;
    }

    if (transformed.v2_meds) {
      const medArray = Array.isArray(transformed.v2_meds) 
        ? transformed.v2_meds 
        : String(transformed.v2_meds).split(',').map(m => m.trim());
      const newMeds = { ...selectedMeds };
      medArray.forEach(med => {
        if (MEDS.includes(med)) newMeds[med] = true;
      });
      transformed.v2_meds = newMeds;
    }

    return transformed;
  };

  const handleToggle = (group, item) => {
    const current = formData[group] || {};
    const updated = { ...current, [item]: !current[item] };
    updateField(group, updated);
  };

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel 
        section="Nephrology Clinical Profile and Kidney Baseline" 
        fields={PROFILE_DICTATION_FIELDS} 
        transformStructuredValues={transformProfileValues}
      />
      <Section title="AI INTAKE & TRIAGE ENGINE" variant="dark" note="Automated analysis and pathway routing based on early intake data.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
          {/* NLP Extraction */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>
              NLP-POWERED HISTORY EXTRACTION
            </h4>
            <p style={{ fontSize: "11px", color: "#888888", margin: "0 0 12px 0" }}>
              Parse uploaded medical records, discharge summaries, and outside consultation notes to auto-populate history fields below.
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button style={{ background: "#000000", color: "#ffffff", border: "1px solid #000000", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: "pointer" }}>Upload Records</button>
              <button style={{ background: "#ffffff", color: "#000000", border: "1px solid #cccccc", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: "pointer" }}>Run NLP Extraction</button>
            </div>
          </div>

          {/* Care Pathway */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h4 style={{ margin: "0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>
                CARE PATHWAY AUTO-ASSIGNMENT
              </h4>
              <button 
                onClick={handleGenerateTriage}
                disabled={isGeneratingTriage}
                style={{ background: "#ffffff", color: "#000000", border: "1px solid #cccccc", padding: "4px 8px", fontSize: "10px", borderRadius: "3px", cursor: "pointer" }}
              >
                {isGeneratingTriage ? "Generating..." : "Generate AI Triage"}
              </button>
            </div>
            <FormField label="ML RECOMMENDED PATHWAY" name="v2_ai_pathway" type="select" options={["", "Conservative Management", "Transplant Evaluation", "Dialysis Preparation (Vascular)", "Urgent Inpatient Triage"]} />
            <div style={{ fontSize: "10px", color: "#888888", marginTop: "6px", fontStyle: "italic" }}>
              Recommendation based on eGFR trajectories, comorbidities, and patient preferences.
            </div>
          </div>
        </div>

        {/* Risk Stratification */}
        <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>RISK STRATIFICATION ON INTAKE</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="CKD Progression Risk (5-Year)" name="v2_ai_risk_ckd" type="select" options={["", "Low (<5%)", "Moderate (5-15%)", "High (>15%)"]} />
            <FormField label="Cardiovascular Risk (ASCVD)" name="v2_ai_risk_cvd" type="select" options={["", "Low", "Borderline", "Intermediate", "High"]} />
            <FormField label="Hospitalization Risk (30-Day)" name="v2_ai_risk_hosp" type="select" options={["", "Low", "Elevated", "Critical"]} />
          </div>
        </div>
      </Section>

      <Section title="General Clinical Baseline & Comorbidities" note="NLP-powered history extraction can auto-populate these fields.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Date of Baseline Assessment" name="v2_baseline_date" type="date" />
          <FormField label="Age" name="v2_clinical_age" type="number" />
          <FormField label="Sex" name="v2_clinical_sex" type="select" options={["", "Male", "Female", "Other"]} />
          <FormField label="Weight (kg)" name="v2_clinical_weight" type="number" />
          <FormField label="Height (cm)" name="v2_clinical_height" type="number" />
          <FormField label="Blood Pressure" name="v2_clinical_bp" />
        </div>
        <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>General Comorbidities</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="Diabetes" name="v2_hx_diabetes" type="select" options={["", "Yes", "No"]} />
            <FormField label="Hypertension" name="v2_hx_htn" type="select" options={["", "Yes", "No"]} />
            <FormField label="Heart Failure / CVD" name="v2_hx_hf" type="select" options={["", "Yes", "No"]} />
            <FormField label="Liver Disease" name="v2_hx_liver" type="select" options={["", "Yes", "No"]} />
            <FormField label="Cancer" name="v2_hx_cancer" type="select" options={["", "Yes", "No"]} />
            <FormField label="Autoimmune Disease" name="v2_hx_autoimmune" type="select" options={["", "Yes", "No"]} />
          </div>
        </div>
      </Section>

      <Section title="Structured Kidney Disease History" note="Granular details regarding the patient's nephrology background.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Known Kidney Disease Etiology" name="v2_hx_kidney_etiology" placeholder="e.g. IgA Nephropathy, Diabetic Nephropathy" />
          <FormField label="Year of Initial Diagnosis" name="v2_hx_kidney_year" type="number" />
          <FormField label="Historical Baseline Creatinine" name="v2_hx_kidney_base_cr" type="number" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Previous Native Kidney Biopsy?" name="v2_hx_kidney_bx" type="select" options={["", "Yes", "No"]} />
          <FormField label="Previous AKI Episodes (Count)" name="v2_hx_aki_count" type="number" />
          <FormField label="Previous Dialysis Experience" name="v2_hx_dialysis_modality" type="select" options={["", "None", "Hemodialysis (HD)", "Peritoneal Dialysis (PD)", "CRRT/SLED"]} />
        </div>
        <FormField label="Biopsy Results / Kidney History Notes" name="v2_hx_kidney_notes" type="textarea" placeholder="Detailed biopsy findings or additional historical context..." />
      </Section>

      <Section title="Surgical & Vascular Access History" note="Prior procedures impacting current nephrology care.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Prior Kidney Transplant?" name="v2_hx_surg_tx" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior AV Fistula / Graft?" name="v2_hx_surg_avf" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior PD Catheter?" name="v2_hx_surg_pd" type="select" options={["", "Yes", "No"]} />
          <FormField label="Prior Nephrectomy?" name="v2_hx_surg_nephrectomy" type="select" options={["", "No", "Yes (Left)", "Yes (Right)", "Yes (Bilateral)"]} />
        </div>
        <FormField label="Additional Surgical Notes (e.g., Transplant Year)" name="v2_hx_surg_notes" type="textarea" />
      </Section>

      <Section title="Family History & Hereditary Conditions" note="Genetic tracking for ESRD and CKD.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "20px" }}>
          <FormField label="Family Hx of CKD or ESRD?" name="v2_hx_fam_ckd" type="select" options={["", "Yes", "No", "Unknown"]} />
          <FormField label="Specific Hereditary Conditions (e.g., PKD, Alport, Fabry)" name="v2_hx_fam_hereditary" type="textarea" />
        </div>
      </Section>

      <Section title="Symptom Profile" note="Select the primary reason for visit and current symptoms.">
        <div style={{ marginBottom: "16px" }}>
          <FormField label="Chief Presenting Reason" name="v2_chief_complaint" type="textarea" placeholder="e.g., Patient presents with worsening lower extremity edema and shortness of breath..." />
        </div>
        <div>
          {SYMPTOMS.map((sym) => {
            const isActive = selectedSymptoms[sym];
            return (
              <div key={sym} style={toggleStyle(isActive)} onClick={() => handleToggle("v2_symptoms", sym)}>
                {isActive ? "✓ " : "+ "}{sym}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Medication History (High Risk)" note="NDC coded reconciliation, specifically tracking nephrotoxins.">
        <div>
          {MEDS.map((med) => {
            const isActive = selectedMeds[med];
            return (
              <div key={med} style={toggleStyle(isActive)} onClick={() => handleToggle("v2_meds", med)}>
                {isActive ? "✓ " : "+ "}{med}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
          <FormField label="Allergy Documentation (Substance & Reaction)" name="v2_allergies_doc" type="textarea" />
          <FormField label="Severity Rating" name="v2_allergies_severity" type="select" options={["", "Mild (e.g., Local rash)", "Moderate (e.g., Systemic, Wheezing)", "Severe (Anaphylaxis)", "Unknown"]} />
        </div>
      </Section>

      <Section title="The Kidney Baseline Layer" note="Instead of a single lab value, DoctorAssist tracks longitudinal trajectories to understand deterioration over time.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <FormField label="Previous Creatinine Trajectory (e.g., 1.0 → 1.1 → 1.2 → 1.8 → 2.4)" name="v2_baseline_cr" />
          <FormField label="eGFR Trajectory (e.g., 95 → 88 → 71 → 42 → 29)" name="v2_baseline_egfr" />
          <FormField label="Urine Protein Trajectory (e.g., Normal → mild → moderate → severe)" name="v2_baseline_protein" />
          <FormField label="Blood Pressure Trajectory (e.g., 130/80 → 145/90 → 165/100)" name="v2_baseline_bp" />
        </div>
      </Section>
    </div>
  );
};

export default ProfileBaselineTab;
