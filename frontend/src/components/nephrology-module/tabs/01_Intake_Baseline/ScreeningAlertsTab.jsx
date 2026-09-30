import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";

const ScreeningAlertsTab = () => {
  const { formData, updateField } = useNephrology();

  // Watch for changes to calculate eGFR
  const scr = parseFloat(formData.v2_screen_cr);
  const age = parseFloat(formData.v2_clinical_age);
  const sex = formData.v2_clinical_sex; // "Male" or "Female"
  const calcMethod = formData.v2_screen_alt_egfr || "CKD-EPI";
  const assayMethod = formData.v2_screen_assay;

  useEffect(() => {
    if (!isNaN(scr) && scr > 0 && !isNaN(age) && age > 0 && (sex === "Male" || sex === "Female")) {
      let egfr = 0;
      if (calcMethod === "MDRD") {
        // Simplified MDRD Equation
        egfr = 175 * Math.pow(scr, -1.154) * Math.pow(age, -0.203);
        if (sex === "Female") egfr *= 0.742;
      } else {
        // CKD-EPI 2021 Race-free Equation
        const k = sex === "Female" ? 0.7 : 0.9;
        const a = sex === "Female" ? -0.241 : -0.302;
        const minVal = Math.min(scr / k, 1);
        const maxVal = Math.max(scr / k, 1);
        egfr = 142 * Math.pow(minVal, a) * Math.pow(maxVal, -1.2) * Math.pow(0.9938, age);
        if (sex === "Female") egfr *= 1.012;
      }
      
      const roundedEgfr = Math.round(egfr);
      if (formData.v2_screen_egfr != roundedEgfr) {
        updateField("v2_screen_egfr", roundedEgfr);
      }
    }
  }, [scr, age, sex, calcMethod]);

  const uacr = parseFloat(formData.v2_screen_uacr);
  const egfr = parseFloat(formData.v2_screen_egfr);

  let gStage = "";
  if (!isNaN(egfr)) {
    if (egfr >= 90) gStage = "G1";
    else if (egfr >= 60) gStage = "G2";
    else if (egfr >= 45) gStage = "G3a";
    else if (egfr >= 30) gStage = "G3b";
    else if (egfr >= 15) gStage = "G4";
    else gStage = "G5";
  }

  let aStage = "";
  if (!isNaN(uacr)) {
    if (uacr < 30) aStage = "A1";
    else if (uacr <= 300) aStage = "A2";
    else aStage = "A3";
  }

  const getHeatMapColor = (g, a) => {
    if ((g === "G1" || g === "G2") && a === "A1") return "#4ade80"; // Green
    if ((g === "G1" || g === "G2") && a === "A2") return "#facc15"; // Yellow
    if (g === "G3a" && a === "A1") return "#facc15"; // Yellow
    if ((g === "G1" || g === "G2") && a === "A3") return "#fb923c"; // Orange
    if (g === "G3a" && a === "A2") return "#fb923c"; // Orange
    if (g === "G3b" && a === "A1") return "#fb923c"; // Orange
    return "#ef4444"; // Red
  };

  const currentStageString = gStage && aStage ? `${gStage}${aStage}` : "N/A";

  // Auto-update stage
  useEffect(() => {
    if (currentStageString !== "N/A" && formData.v2_pop_stage !== currentStageString) {
      updateField("v2_pop_stage", currentStageString);
    }
  }, [currentStageString]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Historical Lab Trends" note="Longitudinal flowsheet and visual trajectory of key renal metrics.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {/* Historical Table */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Lab Flowsheet</h4>
            <table style={{ width: "100%", fontSize: "11px", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ccc" }}>
                  <th style={{ padding: "4px" }}>Date</th>
                  <th style={{ padding: "4px" }}>SCr</th>
                  <th style={{ padding: "4px" }}>eGFR</th>
                  <th style={{ padding: "4px" }}>UACR</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid #eee", color: "#666" }}>
                  <td style={{ padding: "4px" }}>Oct 2025</td>
                  <td style={{ padding: "4px" }}>1.2</td>
                  <td style={{ padding: "4px" }}>68</td>
                  <td style={{ padding: "4px" }}>45</td>
                </tr>
                <tr style={{ borderBottom: "1px solid #eee", color: "#666" }}>
                  <td style={{ padding: "4px" }}>Feb 2026</td>
                  <td style={{ padding: "4px" }}>1.4</td>
                  <td style={{ padding: "4px" }}>55</td>
                  <td style={{ padding: "4px" }}>120</td>
                </tr>
                <tr style={{ fontWeight: "500", color: "#d97706" }}>
                  <td style={{ padding: "4px" }}>Jul 2026</td>
                  <td style={{ padding: "4px" }}>1.8</td>
                  <td style={{ padding: "4px" }}>39</td>
                  <td style={{ padding: "4px" }}>210</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Graph Placeholder */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", display: "flex", flexDirection: "column" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>eGFR Trajectory Graph</h4>
            <div style={{ flex: 1, minHeight: "120px", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff", border: "1px dashed #ccc", color: "#999", fontSize: "11px", textAlign: "center" }}>
              📈 [Line Chart Visualization]<br/>eGFR Decline Over Time
            </div>
          </div>
        </div>
      </Section>

      <Section title="Automated Lab Monitoring" note="Real-time ingestion of lab results from primary care/hospital labs.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Serum Creatinine" name="v2_screen_cr" type="number" placeholder="Enter SCr to calculate eGFR" />
          <FormField label="eGFR (Auto-Calculated)" name="v2_screen_egfr" type="derived" placeholder="Requires SCr, Age, & Sex" />
          <FormField label="Urine Albumin-to-Creatinine Ratio (UACR)" name="v2_screen_uacr" type="number" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "20px" }}>
          <div>
            <FormField label="Lab Assay Method Tracking" name="v2_screen_assay" type="select" options={["", "Jaffe", "Enzymatic", "Other"]} />
            {assayMethod === "Jaffe" && (
              <div style={{ marginTop: "6px", fontSize: "10px", color: "#b45309", background: "#fef3c7", padding: "6px 8px", borderRadius: "3px", border: "1px solid #fde68a", display: "inline-block" }}>
                ⚠️ <strong>Jaffe Method Detected:</strong> Susceptible to non-creatinine chromogen interference. eGFR may be underestimated. IDMS-traceable Enzymatic assay preferred.
              </div>
            )}
            {assayMethod === "Other" && (
              <div style={{ marginTop: "6px", fontSize: "10px", color: "#333333", background: "#f1f5f9", padding: "6px 8px", borderRadius: "3px", border: "1px solid #cbd5e1", display: "inline-block" }}>
                ℹ️ <strong>Non-Standard Assay:</strong> Ensure the assay is IDMS-traceable. Uncalibrated assays may yield inaccurate eGFR calculations.
              </div>
            )}
          </div>
          <div>
            <FormField label="Alternative eGFR Calc Available?" name="v2_screen_alt_egfr" type="select" options={["", "CKD-EPI", "MDRD", "Cystatin C-based"]} />
            {calcMethod === "Cystatin C-based" && (
              <div style={{ marginTop: "6px", fontSize: "10px", color: "#1e3a8a", background: "#dbeafe", padding: "6px 8px", borderRadius: "3px", border: "1px solid #bfdbfe", display: "inline-block" }}>
                ℹ️ <strong>Cystatin C Required:</strong> The CKD-EPI Cystatin C equation requires serum Cystatin C (mg/L). Currently awaiting integration with the lab feed.
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Alert Generation System" note="Multi-level priority routing (routine, urgent, critical).">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>ABNORMAL THRESHOLD ALERTS TRIGGERED</h4>
            <FormField label="eGFR < 60 Alert" name="v2_alert_egfr_low" type="select" options={["", "Active", "Inactive"]} />
            <FormField label="Rapid eGFR Decline (>5 mL/min/year)" name="v2_alert_egfr_rapid" type="select" options={["", "Active", "Inactive"]} />
            <FormField label="New-onset Albuminuria (UACR >30 mg/g)" name="v2_alert_uacr" type="select" options={["", "Active", "Inactive"]} />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>ROUTING & TRIAGE</h4>
            <FormField label="Alert Priority" name="v2_alert_priority" type="select" options={["", "Routine", "Urgent", "Critical"]} />
            <FormField label="Routing Action" name="v2_alert_routing" type="select" options={["", "Send to PCP with nephrology referral suggestion", "Direct to nephrology", "Patient outreach"]} />
          </div>
        </div>
      </Section>

      <Section title="EARLY DETECTION AI ENGINE" note="Predictive modeling, NLP scanning, and triage intelligence.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {/* Predictive Modeling */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>FORECASTING & PREDICTION</h4>
            <FormField label="Predictive CKD Risk Score (3-5 Year Risk)" name="v2_ai_risk_score" />
            <FormField label="eGFR Trajectory Prediction (Time to next stage)" name="v2_ai_trajectory" type="select" options={["", "Stable (>36 months)", "Slow Decline (12-36 months)", "Rapid Decline (<12 months)"]} />
          </div>

          {/* Clinical Intelligence */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>CLINICAL INTELLIGENCE & TRIAGE</h4>
            <FormField label="Smart Referral Triage (AI Rank)" name="v2_alert_triage" type="select" options={["", "Rank 1 (Highest)", "Rank 2", "Rank 3", "Rank 4"]} />
            <FormField label="Lab Assay Drift Detection" name="v2_ai_drift" type="select" options={["", "Normal", "Drift Detected - Recalibration Required"]} />
          </div>
        </div>
        <div style={{ marginTop: "16px", padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>NLP MISSED DIAGNOSES</h4>
          <p style={{ fontSize: "11px", color: "#888888", margin: "0 0 10px 0" }}>Scans clinical notes/radiology for un-coded proteinuria, UTIs, stones.</p>
          <FormField label="" name="v2_ai_missed_dx" type="textarea" />
        </div>
      </Section>

      <Section title="KDIGO CKD Classification & Heat Map" note="Automatically stages patient risk based on eGFR and UACR.">
        <div style={{ display: "flex", gap: "30px", alignItems: "center" }}>
          {/* Stage Result */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", color: "#888", fontWeight: "bold", textTransform: "uppercase" }}>Calculated KDIGO Stage</div>
            <div style={{ fontSize: "42px", fontWeight: "bold", color: "#000", marginTop: "10px" }}>{currentStageString}</div>
            <div style={{ fontSize: "12px", color: "#666", marginTop: "10px" }}>
              <strong>G-Stage (eGFR):</strong> {gStage || "Awaiting eGFR"}<br />
              <strong>A-Stage (Albuminuria):</strong> {aStage || "Awaiting UACR"}
            </div>
          </div>
          
          {/* Heat Map Grid */}
          <div style={{ flex: 2, display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", gap: "2px", fontSize: "10px", textAlign: "center" }}>
            <div />
            <div style={{ padding: "4px", fontWeight: "bold", color: "#666" }}>A1 (&lt;30)</div>
            <div style={{ padding: "4px", fontWeight: "bold", color: "#666" }}>A2 (30-300)</div>
            <div style={{ padding: "4px", fontWeight: "bold", color: "#666" }}>A3 (&gt;300)</div>

            {["G1", "G2", "G3a", "G3b", "G4", "G5"].map(g => (
              <React.Fragment key={g}>
                <div style={{ padding: "8px 4px", fontWeight: "bold", color: "#666", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{g}</div>
                {["A1", "A2", "A3"].map(a => {
                  const isMatch = g === gStage && a === aStage;
                  return (
                    <div key={a} style={{
                      background: getHeatMapColor(g, a),
                      padding: "8px",
                      border: isMatch ? "3px solid #000" : "1px solid rgba(0,0,0,0.1)",
                      opacity: (gStage && aStage && !isMatch) ? 0.3 : 1,
                      transform: isMatch ? "scale(1.05)" : "scale(1)",
                      boxShadow: isMatch ? "0 4px 12px rgba(0,0,0,0.3)" : "none",
                      zIndex: isMatch ? 10 : 1,
                      transition: "all 0.2s ease"
                    }}>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Population Health Dashboard (Overview)" note="Filters by stage, comorbidity, time since last visit.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="CKD Stage (Derived from KDIGO)" name="v2_pop_stage" type="derived" />
          <FormField label="Outreach Campaign Status" name="v2_pop_outreach" type="select" options={["", "Pending Recall", "Contacted", "Scheduled"]} />
          <FormField label="Time Since Last Nephrology Visit" name="v2_pop_last_visit" type="date" />
        </div>
      </Section>
    </div>
  );
};

export default ScreeningAlertsTab;
