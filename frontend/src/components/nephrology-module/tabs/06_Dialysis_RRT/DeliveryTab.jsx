import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import { generateHdIdh, generateHdDryWeight, generateHdAdequacy, generateHdElectrolytes } from "../../services/nephrologyApi";
import DialysisEncounterHistory from "../../components/DialysisEncounterHistory";

const DialysisHistoryTable = ({ historicalSessions, formData }) => {
  const activeHdData =
    formData?.hd_delivered_ktv ||
    formData?.hd_dry_weight ||
    formData?.hd_total_uf_removed ||
    formData?.hd_access_used ||
    formData?.proc_category === "hd" ||
    formData?.proc_type?.startsWith("hd") ||
    formData?.proc_type === "crrt"
      ? formData
      : null;

  const pastDialysisSessions = (historicalSessions || []).filter(
    (s) =>
      (s.track === "dialysis_rrt" || s.track === "procedures") &&
      (s.data?.hd_delivered_ktv ||
        s.data?.hd_dry_weight ||
        s.data?.v2_hd_dry_weight ||
        s.data?.hd_total_uf_removed ||
        s.tab?.startsWith("hd") ||
        s.tab === "crrt")
  );

  const lastSession = pastDialysisSessions.length > 0
    ? [...pastDialysisSessions].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))[0]
    : null;

  const d = activeHdData || lastSession?.data;
  if (!d) return null;

  const sessionDate = d.proc_date || d.v2_hd_date || (lastSession?.created_at ? new Date(lastSession.created_at).toLocaleDateString() : "");
  const dryWeight = d.hd_dry_weight || d.v2_hd_dry_weight || d.v2_dialysis_target_weight || "—";
  const ufRemoved = d.hd_total_uf_removed ? `${d.hd_total_uf_removed} L` : (d.hd_target_uf ? `${d.hd_target_uf} L (target)` : (d.v2_hd_uf_rate ? `${d.v2_hd_uf_rate} mL/hr` : "—"));
  const ktvVal = d.hd_delivered_ktv || d.v2_hd_ktv || d.v2_dialysis_ktv;
  const urrVal = d.hd_delivered_urr;
  const accessUsed = d.hd_access_used || d.v2_hd_access || "—";
  const qbVal = d.hd_qb ? `${d.hd_qb} mL/min` : null;

  const isKtvAdequate = ktvVal && !isNaN(parseFloat(ktvVal)) ? parseFloat(ktvVal) >= 1.2 : null;

  return (
    <div style={{ marginBottom: "20px", border: "1px solid #0891b2", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#ecfeff", padding: "8px 14px", fontSize: "12px", fontWeight: 700, color: "#0e7490", borderBottom: "1px solid #cffafe", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>PREVIOUS DIALYSIS RUN FLOWSHEET</span>
        {sessionDate && <span style={{ fontWeight: 500, fontSize: "11px", color: "#155e75" }}>Date: {sessionDate}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", padding: "12px 14px", background: "#ffffff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Target Dry Weight</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{dryWeight} {dryWeight !== "—" && !String(dryWeight).includes("kg") ? "kg" : ""}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Achieved UF Removed</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{ufRemoved}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Adequacy (Kt/V & URR)</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: isKtvAdequate === true ? "#15803d" : isKtvAdequate === false ? "#b91c1c" : "#0f172a" }}>
            {ktvVal || "—"} {isKtvAdequate === true ? "✓ (Adequate)" : isKtvAdequate === false ? "⚠ (<1.2)" : ""}
            {urrVal ? <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "6px" }}>URR: {urrVal}</span> : null}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Access Used & Flow</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>
            {accessUsed} {qbVal ? <span style={{ fontSize: "11px", color: "#64748b" }}>({qbVal})</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
};

const DeliveryTab = ({ historyProps }) => {
  const { historicalSessions, formData, updateField } = useNephrology();

  // Auto-sync procedure dialysis parameters into DeliveryTab fields
  React.useEffect(() => {
    const pastDialysisSessions = (historicalSessions || []).filter(
      (s) =>
        (s.track === "dialysis_rrt" || s.track === "procedures") &&
        (s.data?.hd_delivered_ktv ||
          s.data?.hd_dry_weight ||
          s.data?.v2_hd_dry_weight ||
          s.data?.hd_total_uf_removed ||
          s.tab?.startsWith("hd") ||
          s.tab === "crrt")
    );
    const lastSession = pastDialysisSessions.length > 0
      ? [...pastDialysisSessions].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))[0]
      : null;
    const src = (formData.hd_qb || formData.hd_dry_weight || formData.hd_total_uf_removed) ? formData : lastSession?.data;
    if (!src) return;

    if (src.hd_qb && !formData.v2_hd_qb) {
      updateField("v2_hd_qb", src.hd_qb);
    }
    if (src.hd_qd && !formData.v2_hd_qd) {
      updateField("v2_hd_qd", src.hd_qd);
    }
    if (src.hd_duration_hours && !formData.v2_hd_duration) {
      updateField("v2_hd_duration", src.hd_duration_hours);
    }
    if (src.hd_dry_weight && !formData.v2_hd_dry_weight) {
      updateField("v2_hd_dry_weight", src.hd_dry_weight);
    }
    if ((src.hd_target_uf || src.hd_total_uf_removed) && !formData.v2_hd_uf_goal) {
      updateField("v2_hd_uf_goal", src.hd_target_uf || src.hd_total_uf_removed);
    }
    if (src.hd_delivered_ktv && !formData.v2_hd_ktv) {
      updateField("v2_hd_ktv", src.hd_delivered_ktv);
    }
  }, [historicalSessions, formData.hd_qb, formData.hd_qd, formData.hd_duration_hours, formData.hd_dry_weight, formData.hd_target_uf, formData.hd_total_uf_removed, formData.v2_hd_qb, formData.v2_hd_qd, formData.v2_hd_duration, formData.v2_hd_dry_weight, formData.v2_hd_uf_goal, updateField]);

  const [isGeneratingIdh, setIsGeneratingIdh] = useState(false);
  const [isGeneratingDryWeight, setIsGeneratingDryWeight] = useState(false);
  const [isGeneratingAdequacy, setIsGeneratingAdequacy] = useState(false);
  const [isGeneratingElectrolytes, setIsGeneratingElectrolytes] = useState(false);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Dialysis Delivery & Optimization" fields={ckdFieldsFor("v2_hd_")} transformStructuredValues={({ values }) => values} />
      
      <Section title="Dialysis Prescription Builder" note="Individualized settings for safe and effective treatments." historyProps={historyProps} historyKeys={["v2_hd_qb", "v2_hd_qd", "v2_hd_duration", "v2_hd_freq"]}>
        <DialysisEncounterHistory {...historyProps} section="delivery_prescription" />
        <DialysisHistoryTable historicalSessions={historicalSessions} formData={formData} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Machine Parameters</h4>
            <FormField label="Blood Flow Rate (QB mL/min)" name="v2_hd_qb" type="number" />
            <FormField label="Dialysate Flow Rate (QD mL/min)" name="v2_hd_qd" type="number" />
            <FormField label="Dialyzer (Membrane / Surface Area)" name="v2_hd_dialyzer" type="select" options={["", "Standard High-Flux", "Large High-Flux", "Medium High-Flux"]} />
            <FormField label="Session Duration (Hours)" name="v2_hd_duration" type="number" />
            <FormField label="Frequency" name="v2_hd_freq" type="select" options={["", "3x per week", "2x per week", "4x per week", "Daily"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Fluid & Ultrafiltration (UF)</h4>
            <FormField label="Pre-Dialysis Weight (kg)" name="v2_hd_pre_weight" type="number" />
            <FormField label="Target Dry Weight (kg)" name="v2_hd_dry_weight" type="number" />
            <FormField label="Calculated UF Goal (Liters)" name="v2_hd_uf_goal" type="number" />
            <FormField label="Calculated UF Rate (mL/kg/hr) - Flag if >13" name="v2_hd_uf_rate" type="number" />
          </div>
        </div>
      </Section>

      <Section title="Intradialytic Monitoring Dashboard" note="Real-time data feed and intervention tracking." historyProps={historyProps} historyKeys={["v2_hd_active_alerts", "v2_hd_interventions"]}>
        <DialysisEncounterHistory {...historyProps} section="delivery_monitoring" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Real-Time Feed & Alerts</h4>
            <FormField label="Vital Signs (BP, HR, Pressures)" name="v2_hd_vitals_feed" type="textarea" placeholder="Real-time data ingestion..." />
            <FormField label="Active Alerts (Hypotension, Alarms)" name="v2_hd_active_alerts" type="select" options={["", "None", "Hypotension", "Tachycardia", "Machine Alarm (Air/Leak)"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Nurse Interventions</h4>
            <FormField label="Intervention Log" name="v2_hd_interventions" type="select" options={["", "None", "Saline Bolus Given", "UF Rate Adjusted/Paused", "Trendelenburg Position", "Oxygen Administered"]} />
          </div>
        </div>
      </Section>

      <Section title="Dry Weight Management" note="Clinical assessment and bioimpedance spectroscopy (BIS)." historyProps={historyProps} historyKeys={["v2_hd_pre_weight", "v2_hd_dry_weight", "v2_hd_vol_exam"]}>
        <DialysisEncounterHistory {...historyProps} section="delivery_weight" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Assessment</h4>
            <FormField label="Euvolemia Exam (Edema, Ortho, JVP, Lungs)" name="v2_hd_vol_exam" type="select" options={["", "Euvolemic", "Overloaded", "Depleted"]} />
            <FormField label="Dry Weight Adjustment Protocol" name="v2_hd_dw_adj" type="select" options={["", "No Change", "Decrease by 0.2-0.5 kg", "Increase by 0.2-0.5 kg"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Objective Measures</h4>
            <FormField label="Bioimpedance Spectroscopy (BIS) Overload" name="v2_hd_bis" type="textarea" placeholder="Total body water / fluid overload measure..." />
            <FormField label="IVC Diameter Imaging" name="v2_hd_ivc" type="select" options={["", "Not Done", "Plethoric", "Collapsible"]} />
          </div>
        </div>
      </Section>

      <Section title="Adequacy & Electrolyte Management" note="Monitoring clearance and individualizing the dialysate bath." historyProps={historyProps} historyKeys={["v2_hd_ktv", "v2_hd_urr"]}>
        <DialysisEncounterHistory {...historyProps} section="delivery_adequacy" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Dialysis Adequacy</h4>
            <FormField label="Kt/V (Target > 1.4)" name="v2_hd_ktv" type="number" />
            <FormField label="Urea Reduction Ratio (URR % Target > 65)" name="v2_hd_urr" type="number" />
            <FormField label="Adjustment Strategy (If Inadequate)" name="v2_hd_adequacy_adj" type="select" options={["", "N/A - Adequate", "Increase QB", "Increase QD", "Increase Time", "Larger Dialyzer"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Dialysate Electrolyte Modeling</h4>
            <FormField label="Dialysate Sodium (mEq/L)" name="v2_hd_bath_na" type="number" />
            <FormField label="Dialysate Potassium (mEq/L)" name="v2_hd_bath_k" type="select" options={["", "1K", "2K", "3K", "4K"]} />
            <FormField label="Dialysate Calcium (mEq/L)" name="v2_hd_bath_ca" type="select" options={["", "2.0", "2.25", "2.5", "3.0"]} />
            <FormField label="Bicarbonate Supplementation" name="v2_hd_bath_bicarb" type="number" />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: HD Optimization" note="Machine learning models for safety and adequacy.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Hemodynamic Stability</h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Intradialytic Hypotension (IDH) Prediction" name="v2_ai_hd_idh" type="textarea" placeholder="Real-time ML predicts BP crash 30-60m in advance..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateHdIdh, setIsGeneratingIdh)}
                disabled={isGeneratingIdh}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingIdh ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingIdh ? "Predicting..." : "⚡ Predict IDH Risk"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Optimal Dry Weight Estimation" name="v2_ai_hd_dry_weight" type="textarea" placeholder="Integrates BIS, NT-proBNP, and BP patterns to suggest target..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateHdDryWeight, setIsGeneratingDryWeight)}
                disabled={isGeneratingDryWeight}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingDryWeight ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingDryWeight ? "Estimating..." : "⚡ Estimate Dry Weight"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Adequacy & Electrolytes</h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Dialysis Adequacy Prediction" name="v2_ai_hd_adequacy" type="textarea" placeholder="Predicts post-dialysis BUN and Kt/V before session ends..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateHdAdequacy, setIsGeneratingAdequacy)}
                disabled={isGeneratingAdequacy}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingAdequacy ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingAdequacy ? "Predicting..." : "⚡ Predict Adequacy"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Electrolyte Shift Prediction" name="v2_ai_hd_electrolytes" type="textarea" placeholder="Predicts post-dialysis K+ shifts to avoid dangerous swings..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateHdElectrolytes, setIsGeneratingElectrolytes)}
                disabled={isGeneratingElectrolytes}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingElectrolytes ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingElectrolytes ? "Predicting..." : "⚡ Predict Electrolyte Shifts"}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default DeliveryTab;
