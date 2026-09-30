import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";

const WhatNextTab = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Guideline-Concordant Care Alerts" note="Automated checks against KDIGO guidelines and safety protocols.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>KDIGO & Best Practice Deviations</h4>
            <FormField label="KDIGO Guideline Checker" name="v2_ds_kdigo_check" type="textarea" placeholder="e.g., Flags missing RAAS inhibitor in albuminuric patient..." />
            <FormField label="Monitoring Reminders" name="v2_ds_monitor_alerts" type="textarea" placeholder="e.g., Overdue labs, missed visits..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Medication Safety</h4>
            <FormField label="Renal Dosing Alerts" name="v2_ds_med_renal_dose" type="textarea" placeholder="Flags inappropriately dosed renally cleared drugs..." />
            <FormField label="Contraindications & Interactions" name="v2_ds_med_interactions" type="textarea" placeholder="Flags dangerous interactions based on current eGFR..." />
          </div>
        </div>
      </Section>

      <Section title="Treatment Recommendation Engine" note="Personalized next-best-action logic and dynamic pathways.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Personalized Treatment Suggestions</h4>
            <FormField label="Ranked Treatment Options (AI Generated)" name="v2_ds_ranked_tx" type="textarea" placeholder="Options include expected benefit, predicted harms, cost, and evidence level..." />
            <FormField label="Order Set Activation" name="v2_ds_order_set" type="select" options={["", "Pending Review", "One-Click Activated"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Dynamic Care Pathways</h4>
            <FormField label="Assigned Care Pathway" name="v2_ds_care_pathway" type="select" options={["", "Conservative CKD Management", "Dialysis Preparation", "Transplant Recipient Follow-up", "Acute Intervention"]} />
            <FormField label="Pathway Adaptation Trigger" name="v2_ds_pathway_adapt" type="textarea" placeholder="e.g., eGFR declining faster than expected; escalating to preparation..." />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Decision Intelligence" note="Predictive models for personalized treatment selection.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Treatment Efficacy</h4>
            <FormField label="Causal Treatment Effect Estimation" name="v2_ai_ds_causal_effect" type="textarea" placeholder="Estimates Individualized Treatment Effect (ITE) using Meta-learners..." />
            <FormField label="Net Benefit Calculation" name="v2_ai_ds_net_benefit" type="textarea" placeholder="Ranks treatments integrating benefits, harms, utilities, and costs..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Safety & Explainability</h4>
            <FormField label="Explainable AI (XAI) Rationale" name="v2_ai_ds_xai_shap" type="textarea" placeholder="Provides SHAP values to explain which patient features drive recommendations..." />
            <FormField label="Contraindication & Safety Checker (Hybrid)" name="v2_ai_ds_safety_check" type="textarea" placeholder="Rule-based + ML hybrid flags interaction risks and adjusts suggestions..." />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default WhatNextTab;
