import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import { generateVbcAnalytics, syncVbcHistoricalData } from "../../services/nephrologyApi";

const AnalyticsTab = () => {
  const { formData, updateField, updateFields, patientId } = useNephrology();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncHistorical = async () => {
    if (!patientId) {
      alert("No patient ID available.");
      return;
    }
    setIsSyncing(true);
    try {
      const response = await syncVbcHistoricalData(patientId);
      if (response?.data) {
        updateFields(response.data);
      }
    } catch (error) {
      console.error("Failed to sync historical VBC data:", error);
      alert("Failed to sync historical data. Please try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await generateVbcAnalytics(formData);
      if (response?.data) {
        Object.entries(response.data).forEach(([key, value]) => {
          updateField(key, value);
        });
      }
    } catch (error) {
      console.error("Failed to generate VBC analytics:", error);
      alert("Failed to generate VBC insights. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "16px 20px", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#333" }}>Claims & Encounter History</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#666" }}>Aggregate historical utilization and outcome data from the patient record.</p>
        </div>
        <button
          type="button"
          onClick={handleSyncHistorical}
          disabled={isSyncing}
          style={{
            background: isSyncing ? "#ccc" : "#f1f5f9",
            color: "#334155",
            border: "1px solid #cbd5e1",
            padding: "8px 14px",
            borderRadius: "4px",
            fontWeight: 600,
            cursor: isSyncing ? "wait" : "pointer",
            transition: "all 0.2s"
          }}
        >
          {isSyncing ? "Syncing Data..." : "🔄 Sync Historical Data"}
        </button>
      </div>

      <Section title="Value-Based Care & Outcomes" note="Track clinical, utilization, and cost metrics for VBC contracts.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Outcome Metrics</h4>
            <FormField label="CKD Progression (e.g., % with 40% decline, ESKD inc.)" name="v2_vbc_clin_ckd" type="textarea" placeholder="Record progression metrics..." />
            <FormField label="Dialysis Outcomes (Adequacy %, Access type %)" name="v2_vbc_clin_dialysis" type="textarea" placeholder="Kt/V >= 1.4, AVF/AVG vs Catheter..." />
            <FormField label="Transplant & Complications (Graft survival, AKI, CV)" name="v2_vbc_clin_tx_comp" type="textarea" placeholder="1yr/5yr graft survival, AKI episodes, hyperkalemia..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Utilization Metrics</h4>
            <FormField label="Hospitalizations & ED Visits (per pt-yr, 30-day readmit)" name="v2_vbc_util_hosp" type="textarea" placeholder="All-cause and CKD-related admissions..." />
            <FormField label="Unplanned Dialysis Starts" name="v2_vbc_util_unplanned" type="textarea" placeholder="% starting with catheter, % <6 months neph care..." />
            <FormField label="Office Visit Adherence" name="v2_vbc_util_office" type="select" options={["", "Adherent", "Non-Adherent"]} />
          </div>
        </div>
      </Section>

      <Section title="Cost, PROs, and Risk Adjustment" note="Financial impact and patient experience.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Cost Metrics</h4>
            <FormField label="Total Cost of Care (TCOC) per patient-year" name="v2_vbc_cost_tcoc" type="number" />
            <FormField label="Cost per Avoided ESKD / QALY Gained" name="v2_vbc_cost_qaly" type="textarea" placeholder="Track intervention efficiency..." />
            <FormField label="Budget Impact (Net savings)" name="v2_vbc_cost_budget" type="number" />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>PROs & Attribution</h4>
            <FormField label="Patient-Reported Outcomes (KDQOL-36, Symptoms)" name="v2_vbc_pros" type="textarea" placeholder="Fatigue, pain, nausea, treatment satisfaction..." />
            <FormField label="Attribution & Risk Adjustment (HCC Scores)" name="v2_vbc_risk_adj" type="textarea" placeholder="Assign patients based on plurality, adjust for complexity..." />
            <FormField label="Observed vs Expected Outcomes" name="v2_vbc_obs_exp" type="textarea" placeholder="Compare against patient mix..." />
          </div>
        </div>
      </Section>

      <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "20px", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#333", letterSpacing: "0.5px" }}>Financial & Risk Intelligence</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#666" }}>Advanced ML models for cost forecasting and value calculations.</p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          style={{
            background: isGenerating ? "#666" : "#000",
            color: "#fff",
            border: "none",
            padding: "10px 16px",
            borderRadius: "4px",
            fontWeight: 600,
            cursor: isGenerating ? "wait" : "pointer",
            transition: "background 0.2s"
          }}
        >
          {isGenerating ? "Analyzing..." : "⚡ Generate VBC Analytics"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Risk & Forecasting</h4>
          <FormField label="Predictive Risk Adjustment" name="v2_ai_vbc_risk_adj" type="textarea" placeholder="ML predicts expected cost and outcomes to enable fair comparison..." />
          <FormField label="Cost Forecasting (TCOC)" name="v2_ai_vbc_cost_forecast" type="textarea" placeholder="Predicts future TCOC and identifies high-cost patients..." />
        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Value Analytics</h4>
          <FormField label="QALY Estimation" name="v2_ai_vbc_qaly_est" type="textarea" placeholder="Maps KDQOL to utility scores to calculate QALYs gained..." />
          <FormField label="Value Calculator (ICER)" name="v2_ai_vbc_icer" type="textarea" placeholder="Computes incremental cost-effectiveness ratio to prioritize interventions..." />
        </div>
      </div>
    </div>
  );
};

export default AnalyticsTab;
