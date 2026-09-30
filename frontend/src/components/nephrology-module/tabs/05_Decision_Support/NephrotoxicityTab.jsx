import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";

const NephrotoxicityTab = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Progression & Deviation Monitoring" note="Continuously track disease progression and detect deviations.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>eGFR Slope & Classification</h4>
            <FormField label="Annualized eGFR Slope (mL/min/1.73m²/year)" name="v2_ds_egfr_slope" type="number" />
            <FormField label="Progression Classification" name="v2_ds_prog_class" type="select" options={["", "Stable (slope > -1)", "Slow Progression (-1 to -3)", "Moderate (-3 to -5)", "Rapid (< -5)"]} />
            <FormField label="Population Benchmarking (vs Matched Cohort)" name="v2_ds_pop_benchmark" type="select" options={["", "As Expected", "Better than Expected", "Worse than Expected (Outlier)"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Statistical Process Control (SPC)</h4>
            <FormField label="CUSUM Chart (Sustained Shifts)" name="v2_ds_spc_cusum" type="textarea" placeholder="e.g., Sudden increase in hyperkalemia post-protocol change..." />
            <FormField label="EWMA Chart (Gradual Drift)" name="v2_ds_spc_ewma" type="textarea" placeholder="e.g., Gradual drift in blood pressure averages..." />
            <FormField label="Deviation Alert Workflow" name="v2_ds_spc_alert" type="select" options={["", "Normal", "Alarm Triggered: Root Cause Analysis Initiated"]} />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Trajectory & Anomaly Intelligence" note="Advanced ML for forecasting and concept drift detection.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Forecasting & Anomalies</h4>
            <FormField label="Trajectory Forecasting (RNN/Transformer)" name="v2_ai_ds_trajectory" type="textarea" placeholder="Predicts future eGFR values and time to ESKD with confidence intervals..." />
            <FormField label="Anomaly Detection (Unsupervised ML)" name="v2_ai_ds_anomaly" type="textarea" placeholder="Isolation forests flag unusual patient patterns..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Drift & Root Cause AI</h4>
            <FormField label="Concept Drift Detection" name="v2_ai_ds_drift" type="textarea" placeholder="Monitors population input distributions to trigger model recalibration..." />
            <FormField label="Root Cause Analysis AI (NLP + Causal Inference)" name="v2_ai_ds_root_cause" type="textarea" placeholder="Identifies common themes in deviation cases..." />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default NephrotoxicityTab;
