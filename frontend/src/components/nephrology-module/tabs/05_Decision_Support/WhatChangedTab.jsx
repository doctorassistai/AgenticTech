import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";

const WhatChangedTab = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Treatment Response Tracker" note="Visualizes patient response to therapies over time.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px", marginBottom: "16px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Timeline & Overlays</h4>
            <FormField label="Medication Start/Stop Timeline" name="v2_ds_med_timeline" type="textarea" placeholder="Tracks initiation and discontinuation of interventions..." />
            <FormField label="Time-Series Labs Overlay (eGFR, UACR, BP, K+)" name="v2_ds_lab_overlay" type="textarea" placeholder="Visual correlation between medications and lab responses..." />
            <FormField label="Key Event Annotations" name="v2_ds_event_annotations" type="textarea" placeholder="AKI episodes, hospitalizations, surgeries mapped to timeline..." />
          </div>
        </div>
      </Section>

      <Section title="Responder Classification & AE Detection" note="Quantifies therapeutic efficacy and safety.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Efficacy & Responder Status</h4>
            <FormField label="Therapy Evaluated" name="v2_ds_eval_therapy" type="select" options={["", "SGLT2i", "RAAS Inhibitor", "nsMRA", "Immunosuppression"]} />
            <FormField label="Classification (e.g., ≥30% UACR reduction)" name="v2_ds_responder_class" type="select" options={["", "Responder", "Partial Responder", "Non-Responder"]} />
            <FormField label="Early Response Prediction (3-Month Data)" name="v2_ds_early_resp" type="textarea" placeholder="Predicts long-term response trajectory..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Adverse Event Detection</h4>
            <FormField label="Treatment-Emergent AEs" name="v2_ds_emergent_ae" type="textarea" placeholder="e.g., hyperkalemia after RAAS, UTI after SGLT2i..." />
            <FormField label="Severity & Causality Assessment" name="v2_ds_ae_severity" type="select" options={["", "Mild (Monitor)", "Moderate (Dose Adjust)", "Severe (Discontinue)"]} />
            <FormField label="Clinical Alert / Recommendation" name="v2_ds_ae_alert" type="textarea" placeholder="Alerts clinician to consider discontinuation or adjustment..." />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Response & Safety Prediction" note="Advanced ML for counterfactuals and AE forecasting.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Efficacy Modeling</h4>
            <FormField label="Counterfactual Prediction (Bayesian)" name="v2_ai_ds_counterfactual" type="textarea" placeholder="Estimates eGFR trajectory without treatment to determine individualized effect..." />
            <FormField label="Early Responder Prediction (ML Classifier)" name="v2_ai_ds_early_resp" type="textarea" placeholder="Uses short-term biomarkers to predict long-term clinical response..." />
            <FormField label="Sequential Bayesian Updating" name="v2_ai_ds_bayes_update" type="textarea" placeholder="Updates posterior distribution of treatment effect with each new lab result..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Safety Forecasting</h4>
            <FormField label="Adverse Event Prediction (30-90 Days)" name="v2_ai_ds_ae_predict" type="textarea" placeholder="Predicts probability of hyperkalemia, AKI, or infection to trigger prophylaxis..." />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default WhatChangedTab;
