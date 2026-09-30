import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import { generateAdequacyPrognosis, generateAdequacyDryWeight } from "../../services/nephrologyApi";
import DialysisEncounterHistory from "../../components/DialysisEncounterHistory";

const AdequacyReviewTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();

  const [isGeneratingPrognosis, setIsGeneratingPrognosis] = useState(false);
  const [isGeneratingDryWeight, setIsGeneratingDryWeight] = useState(false);

  const handleGenerate = async (apiFunc, setLoader) => {
    setLoader(true);
    try {
      const res = await apiFunc(formData);
      if (res?.data) {
        Object.entries(res.data).forEach(([k, v]) => updateField(k, v));
      }
    } catch (err) {
      console.warn("LLM generation failed:", err.message);
    } finally {
      setLoader(false);
    }
  };

  // Safety checks based on adequacy metrics
  const monthlyKtv = parseFloat(formData.v2_rrt_ktv || 0);
  const isInadequate = monthlyKtv > 0 && monthlyKtv < 1.2;

  const avgIdwg = parseFloat(formData.v2_rrt_idwg || 0);
  const isHighFluidGain = avgIdwg >= 3.0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Monthly Adequacy & Surveillance" fields={ckdFieldsFor("v2_rrt_")} transformStructuredValues={({ values }) => values} />
      
      {/* Safety Alerts */}
      {isInadequate && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ INADEQUATE CLEARANCE:</b> Monthly Kt/V is below target (&lt;1.2). Consider increasing session duration, blood flow (QB), or evaluating access recirculation.
        </div>
      )}
      
      {isHighFluidGain && (
        <div style={{ padding: "12px 16px", background: "#fff7e6", borderLeft: "4px solid #fa8c16", fontSize: "12.5px", color: "#d46b08", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ HIGH IDWG:</b> Average interdialytic weight gain is ≥3.0 kg. High risk for intradialytic hypotension and left ventricular hypertrophy. Recommend dietary review (sodium/fluid restriction).
        </div>
      )}

      <Section title="Clearance & Adequacy Benchmarks" note="Review monthly kinetic modeling to ensure optimal small solute clearance." historyProps={historyProps} historyKeys={["v2_rrt_ktv", "v2_rrt_urr", "v2_rrt_residual_vol", "v2_rrt_residual_clearance"]}>
        <DialysisEncounterHistory {...historyProps} section="adequacy_clearance" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Urea Kinetic Modeling</h4>
            <FormField label="Monthly Single-Pool Kt/V" name="v2_rrt_ktv" type="number" placeholder="Target: ≥ 1.2" />
            <FormField label="Urea Reduction Ratio (URR %)" name="v2_rrt_urr" type="number" placeholder="Target: ≥ 65%" />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Residual Renal Function</h4>
            <FormField label="24h Urine Volume (mL)" name="v2_rrt_residual_vol" type="number" placeholder="e.g. 400" />
            <FormField label="Residual Urea/Cr Clearance" name="v2_rrt_residual_clearance" type="number" placeholder="mL/min" />
          </div>
        </div>
      </Section>

      <Section title="Fluid & Dry Weight Management" note="Evaluate fluid status and tolerance to ultrafiltration over the last 30 days." historyProps={historyProps} historyKeys={["v2_rrt_dry_weight", "v2_rrt_idwg", "v2_rrt_fluid_status", "v2_rrt_dry_weight_action"]}>
        <DialysisEncounterHistory {...historyProps} section="adequacy_fluid" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Weight Tracking</h4>
            <FormField label="Current Target Dry Weight (kg)" name="v2_rrt_dry_weight" type="number" />
            <FormField label="Avg Interdialytic Weight Gain (kg)" name="v2_rrt_idwg" type="number" placeholder="e.g. 2.5" />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Assessment</h4>
            <FormField label="Clinical Fluid Status" name="v2_rrt_fluid_status" type="select" options={["", "Euvolemic (At dry weight)", "Hypervolemic (Edema/SOB)", "Hypovolemic (Cramping/Hypotension)"]} />
            <FormField label="Dry Weight Action" name="v2_rrt_dry_weight_action" type="select" options={["", "Maintain current target", "Decrease target (Challenge)", "Increase target"]} />
          </div>
        </div>
      </Section>

      <Section title="Vascular Access Surveillance" note="Monthly monitoring for early detection of AVF/AVG stenosis or failure." historyProps={historyProps} historyKeys={["v2_rrt_access_dvp", "v2_rrt_access_qa", "v2_rrt_access_exam", "v2_rrt_access_action"]}>
        <DialysisEncounterHistory {...historyProps} section="adequacy_access" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Machine Pressures & Flow</h4>
              <FormField label="Dynamic Venous Pressure (mmHg)" name="v2_rrt_access_dvp" type="number" placeholder="e.g. >200 may indicate outflow stenosis" />
              <FormField label="Access Flow Rate (Qa mL/min)" name="v2_rrt_access_qa" type="number" placeholder="Ultrasound dilution method" />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Physical Exam & Action</h4>
              <FormField label="Physical Exam (Thrill / Bruit)" name="v2_rrt_access_exam" type="select" options={["", "Normal (Continuous thrill/bruit)", "Abnormal (Pulsatile thrill/high pitch bruit)", "Loss of thrill/bruit (Thrombosis)"]} />
              <FormField label="Intervention Recommended" name="v2_rrt_access_action" type="select" options={["", "None (Monitor)", "Refer for Fistulagram/Angioplasty", "Refer for Surgical Revision"]} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Intradialytic Complications Summary" note="Review adverse events occurring during treatments over the last 30 days." historyProps={historyProps} historyKeys={["v2_rrt_comp_hypotension", "v2_rrt_comp_cramps", "v2_rrt_comp_notes"]}>
        <DialysisEncounterHistory {...historyProps} section="adequacy_complications" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <FormField label="Recurrent Intradialytic Hypotension" name="v2_rrt_comp_hypotension" type="select" options={["", "None", "Rare (<10% of sessions)", "Frequent (>30% of sessions)"]} />
          <FormField label="Severe Cramping Events" name="v2_rrt_comp_cramps" type="select" options={["", "None", "Occasional", "Frequent/Severe"]} />
          <div style={{ gridColumn: "span 2" }}>
            <FormField label="Notes & Protocol Changes" name="v2_rrt_comp_notes" type="textarea" placeholder="e.g. Holding midodrine prior to dialysis, extending UF time..." />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Monthly Forecasting & Adjustment" note="Predictive intelligence for hospitalization risk and target titrations.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Complication & Hospitalization Forecaster</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="90-Day Prognosis & Interventions" name="v2_ai_monthly_prognosis" type="textarea" placeholder="Analyzes Kt/V, IDWG, and complications to predict hospitalization risk..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAdequacyPrognosis, setIsGeneratingPrognosis)}
                disabled={isGeneratingPrognosis}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingPrognosis ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingPrognosis ? "Forecasting..." : "⚡ Forecast Prognosis"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Dry Weight Auto-Titration</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Auto-Titration Recommendation" name="v2_ai_monthly_dw" type="textarea" placeholder="Suggests precise adjustment to target dry weight based on fluid status and cramping history..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAdequacyDryWeight, setIsGeneratingDryWeight)}
                disabled={isGeneratingDryWeight}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingDryWeight ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingDryWeight ? "Titrating..." : "⚡ Titrate Dry Weight"}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default AdequacyReviewTab;
