import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import AkiAiAssistButton from "../../components/AkiAiAssistButton";
import AkiEncounterHistory from "../../components/AkiEncounterHistory";

const DICTATION_FIELDS = [
  { k: "v2_aki_admission_date", label: "date of admission", type: "date" },
  { k: "v2_aki_class", label: "AKI classification", type: "select", options: ["AKI", "CKD", "AKI on CKD", "Rapidly progressive kidney disease", "Stable CKD"] },
  { k: "v2_aki_cr_6m", label: "creatinine six months ago", type: "number", unit: "mg/dL" },
  { k: "v2_aki_cr_3m", label: "creatinine three months ago", type: "number", unit: "mg/dL" },
  { k: "v2_aki_cr_1m", label: "creatinine one month ago", type: "number", unit: "mg/dL" },
  { k: "v2_aki_cr_yest", label: "creatinine yesterday", type: "number", unit: "mg/dL" },
  { k: "v2_aki_cr_today", label: "creatinine today", type: "number", unit: "mg/dL" },
  { k: "v2_aki_baseline_cr", label: "baseline creatinine", type: "number" },
  { k: "v2_aki_current_cr", label: "current creatinine", type: "number" },
  { k: "v2_aki_kdigo", label: "KDIGO AKI stage", type: "select", options: ["Stage 1 (1.5-1.9x baseline or ≥0.3 increase)", "Stage 2 (2-2.9x baseline)", "Stage 3 (≥3x or ≥4.0 or RRT)"] },
  { k: "v2_aki_uo_tracking", label: "urine output", type: "select", options: ["Normal", "Oliguric", "Anuric"] },
  { k: "v2_aki_alert_status", label: "alert status", type: "select", options: ["Stage 1: Notification to primary team", "Stage 2: Alert + recommended nephrology consult", "Stage 3: Urgent nephrology consult auto-triggered"], guide: "Map high-risk AKI alert to the option matching the dictated KDIGO stage. Stage one, two, or three must use the corresponding listed option." },
  { k: "v2_aki_alert_actions", label: "recommended actions", type: "textarea" },
];

const ClassificationTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="AKI classification and surveillance" fields={DICTATION_FIELDS} />
      <Section title="AKI vs CKD Classification Engine" note="Differentiates injury patterns by analyzing historical creatinine trajectories.">
        <AkiEncounterHistory {...historyProps} section="classification_trajectory" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px dashed #ccc", marginBottom: "16px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#666", fontStyle: "italic" }}>
            "The system looks backward... DoctorAssist identifies a rapidly evolving kidney injury pattern. Then investigate why."
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <FormField label="Date of Admission" name="v2_aki_admission_date" type="date" />
          <div style={{ background: "#f9f9f9", padding: "12px", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h4 style={{ margin: "0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>AI Classification Assessment</h4>
              <AkiAiAssistButton section="classification" variant="inline" label="Run AKI Stage & Alert Generation" />
            </div>
            <FormField label="Classification Assessment" name="v2_aki_class" type="select" options={["", "AKI", "CKD", "AKI on CKD", "Rapidly progressive kidney disease", "Stable CKD"]} />
          </div>
        </div>
        
        <h4 style={{ marginTop: "20px", marginBottom: "10px", fontSize: "13px", color: "#333" }}>Backward Trajectory Look (Creatinine)</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
          <FormField label="6 Months Ago" name="v2_aki_cr_6m" type="number" />
          <FormField label="3 Months Ago" name="v2_aki_cr_3m" type="number" />
          <FormField label="1 Month Ago" name="v2_aki_cr_1m" type="number" />
          <FormField label="Yesterday" name="v2_aki_cr_yest" type="number" />
          <FormField label="Today" name="v2_aki_cr_today" type="number" />
        </div>
      </Section>

      <Section title="Real-Time AKI Surveillance & KDIGO Staging" note="Continuous monitoring of serum creatinine for all hospitalized patients.">
        <AkiEncounterHistory {...historyProps} section="classification_stage" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <div style={{ gridColumn: "span 3" }}>
            <FormField label="Baseline Creatinine Determination (lowest in prior 7-365 days, or admission if no prior)" name="v2_aki_baseline_cr" type="number" />
          </div>
          <FormField label="Current Creatinine" name="v2_aki_current_cr" type="number" />
          <div style={{ gridColumn: "span 2" }}>
            <FormField label="KDIGO AKI Stage" name="v2_aki_kdigo" type="select" options={["", "Stage 1 (1.5-1.9x baseline or ≥0.3 increase)", "Stage 2 (2-2.9x baseline)", "Stage 3 (≥3x or ≥4.0 or RRT)"]} />
          </div>
        </div>
        <div style={{ marginTop: "20px" }}>
          <FormField label="Urine Output Tracking Integration (Oliguria <0.5 mL/kg/hr for 6+ hours)" name="v2_aki_uo_tracking" type="select" options={["", "Normal", "Oliguric", "Anuric"]} />
        </div>
      </Section>

      <Section title="AKI Alert System" note="Multi-tier alerts with recommended actions.">
        <AkiEncounterHistory {...historyProps} section="classification_alert" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <FormField label="Alert Status" name="v2_aki_alert_status" type="select" options={["", "Stage 1: Notification to primary team", "Stage 2: Alert + recommended nephrology consult", "Stage 3: Urgent nephrology consult auto-triggered"]} />
          <FormField label="Recommended Actions (AI Generated)" name="v2_aki_alert_actions" type="textarea" />
        </div>
      </Section>
    </div>
  );
};

export default ClassificationTab;
