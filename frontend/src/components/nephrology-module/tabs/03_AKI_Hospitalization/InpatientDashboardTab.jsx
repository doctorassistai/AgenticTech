import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import AkiAiAssistButton from "../../components/AkiAiAssistButton";
import AkiEncounterHistory from "../../components/AkiEncounterHistory";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";

const DICTATION_FIELDS = [
  { k: "v2_fluid_iv", label: "IV fluids", type: "number" },
  { k: "v2_fluid_oral", label: "oral fluids", type: "number" },
  { k: "v2_fluid_blood", label: "blood products", type: "number" },
  { k: "v2_fluid_meds", label: "medication fluid input", type: "number" },
  { k: "v2_fluid_urine", label: "urine output", type: "number" },
  { k: "v2_fluid_drain", label: "drain output", type: "number" },
  { k: "v2_fluid_gi", label: "vomiting or stool output", type: "number" },
  { k: "v2_fluid_uf", label: "dialysis ultrafiltration", type: "number" },
  { k: "v2_fluid_net", label: "net fluid balance", type: "number" },
  { k: "v2_hosp_k", label: "serum potassium", type: "number" },
  { k: "v2_hosp_bicarb", label: "serum bicarbonate", type: "number" },
  { k: "v2_hosp_bp", label: "blood pressure", type: "text" },
  { k: "v2_hosp_weight", label: "daily weight", type: "number", unit: "kg" },
  { k: "v2_hosp_o2", label: "oxygenation or supplemental oxygen", type: "text" },
  { k: "v2_hosp_status", label: "kidney status", type: "select", options: ["Stable", "Watch", "Deteriorating", "Critical"] },
  { k: "v2_hosp_sepsis", label: "infection or sepsis indicators", type: "text" },
  { k: "v2_hosp_ai_ews", label: "AKI early warning probability", type: "number", unit: "%" },
  { k: "v2_hosp_ai_prog", label: "AKI progression probability", type: "number", unit: "%" },
  { k: "v2_hosp_ai_recovery", label: "AKI recovery prediction", type: "textarea" },
  { k: "v2_hosp_ai_contrast", label: "contrast-induced AKI risk", type: "select", options: ["Low Risk", "High Risk"] },
  { k: "v2_hosp_ai_prophylaxis", label: "contrast AKI prophylaxis recommendation", type: "textarea" },
];

const InpatientDashboardTab = ({ historyProps }) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="inpatient AKI monitoring and fluid balance" fields={DICTATION_FIELDS} />
      <Section title="Fluid Balance Intelligence" note="Calculate fluid trajectory (Input vs Output).">
        <AkiEncounterHistory {...historyProps} section="inpatient_fluid" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px dashed #ccc", marginBottom: "16px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#666", fontStyle: "italic" }}>
            "DoctorAssist can flag patterns such as: Increasing positive fluid balance + falling urine output + worsening oxygenation. This creates a much richer clinical picture."
          </p>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>INPUT (24h)</h4>
            <FormField label="IV Fluids (mL)" name="v2_fluid_iv" type="number" />
            <div style={{ height: "8px" }} />
            <FormField label="Oral Fluids (mL)" name="v2_fluid_oral" type="number" />
            <div style={{ height: "8px" }} />
            <FormField label="Blood Products (mL)" name="v2_fluid_blood" type="number" />
            <div style={{ height: "8px" }} />
            <FormField label="Medications (mL)" name="v2_fluid_meds" type="number" />
          </div>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>OUTPUT (24h)</h4>
            <FormField label="Urine (mL)" name="v2_fluid_urine" type="number" />
            <div style={{ height: "8px" }} />
            <FormField label="Drain (mL)" name="v2_fluid_drain" type="number" />
            <div style={{ height: "8px" }} />
            <FormField label="Vomiting/Stool (mL)" name="v2_fluid_gi" type="number" />
            <div style={{ height: "8px" }} />
            <FormField label="Dialysis Ultrafiltration (mL)" name="v2_fluid_uf" type="number" />
          </div>
        </div>
        
        <div style={{ marginTop: "16px" }}>
          <FormField label="Calculated Net Fluid Balance (24h)" name="v2_fluid_net" type="number" />
        </div>
      </Section>

      <Section title="Continuous Inpatient Monitoring" note="Track continuously during hospitalization.">
        <AkiEncounterHistory {...historyProps} section="inpatient_monitoring" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Serum Potassium" name="v2_hosp_k" type="number" />
          <FormField label="Serum Bicarbonate" name="v2_hosp_bicarb" type="number" />
          <FormField label="Blood Pressure (Trending)" name="v2_hosp_bp" />
          <FormField label="Daily Weight (kg)" name="v2_hosp_weight" type="number" />
          <FormField label="Oxygenation (SpO2 / Supp O2)" name="v2_hosp_o2" />
          <FormField label="Infection / Sepsis Indicators" name="v2_hosp_sepsis" />
        </div>
      </Section>

      <Section title="Overall Kidney Status & Early Warning" note="Classify the patient's current inpatient trajectory.">
        <AkiEncounterHistory {...historyProps} section="inpatient_status" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <FormField label="Kidney Status" name="v2_hosp_status" type="select" options={[
            "",
            "Stable",
            "Watch",
            "Deteriorating",
            "Critical"
          ]} />
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <h4 style={{ margin: "0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>AI Early Warning & Prediction Engine</h4>
              <AkiAiAssistButton section="inpatient" variant="inline" label="Run Prediction Engine" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <FormField label="AKI Early Warning System (Predicts risk 6-48h prior)" name="v2_hosp_ai_ews" type="number" placeholder="Probability %" />
              <FormField label="AKI Progression Predictor (Stage 1 -> 2/3)" name="v2_hosp_ai_prog" type="number" placeholder="Probability %" />
              <FormField label="Recovery Predictor (Time to Cr recovery)" name="v2_hosp_ai_recovery" type="textarea" placeholder="Estimates time to recovery and CKD development risk..." />
              <FormField label="Contrast-Induced AKI Risk (integrates eGFR, vol, dose)" name="v2_hosp_ai_contrast" type="select" options={["", "Low Risk", "High Risk"]} />
              <div style={{ gridColumn: "span 2" }}>
                <FormField label="AI Prophylaxis Recommendation" name="v2_hosp_ai_prophylaxis" type="textarea" placeholder="e.g., Recommend IV hydration, N-acetylcysteine, minimize contrast volume..." />
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default InpatientDashboardTab;
