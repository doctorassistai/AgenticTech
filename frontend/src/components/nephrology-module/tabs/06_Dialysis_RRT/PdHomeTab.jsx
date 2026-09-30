import React, { useState, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import {
  generatePdHomePeritonitis,
  generatePdHomeFluid,
  generatePdHomeAdequacy,
  generatePdHomeHdOpt,
  generatePdHomeAdherence,
  generatePdHomeTech,
} from "../../services/nephrologyApi";
import DialysisEncounterHistory from "../../components/DialysisEncounterHistory";

const RecentPdCatheterSummary = ({ historicalSessions, formData }) => {
  const activePdData =
    formData?.pd_proc_approach ||
    formData?.pd_exit_site ||
    formData?.pd_fluid_in ||
    formData?.pd_break_in ||
    formData?.proc_type === "pd_catheter"
      ? formData
      : null;

  const pdSessions = (historicalSessions || []).filter(
    (s) =>
      (s.track === "dialysis_rrt" || s.track === "procedures" || s.track === "intake_baseline") &&
      (s.data?.pd_proc_approach ||
        s.data?.pd_exit_site ||
        s.data?.pd_fluid_in ||
        s.data?.pd_break_in ||
        s.tab === "pd_catheter" ||
        s.data?.proc_type === "pd_catheter")
  );
  if (!activePdData && pdSessions.length === 0) return null;

  const latest = [...pdSessions].sort(
    (a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0)
  )[0];
  const d = activePdData || latest?.data || {};

  const procDate = d.proc_date || (latest?.created_at ? new Date(latest.created_at).toLocaleDateString() : (activePdData ? "Today (Active Record)" : ""));
  const approach = d.pd_proc_approach ? d.pd_proc_approach.split("(")[0] : "Laparoscopic Insertion";
  const cuff = d.pd_deep_cuff ? d.pd_deep_cuff.split("(")[0] : "Deep Rectus Sheath";
  const testFlow = d.pd_fluid_out ? `${d.pd_fluid_in || "1000"}mL in / ${d.pd_fluid_out}mL out` : "Clear rapid return";
  const breakin = d.pd_break_in || "2-week healing schedule";

  return (
    <div style={{ marginBottom: "18px", border: "1px solid #0284c7", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#f0f9ff", padding: "8px 14px", fontSize: "12px", fontWeight: 700, color: "#0369a1", borderBottom: "1px solid #e0f2fe", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>RECENT PD CATHETER SURGICAL OPERATIVE RECORD</span>
        {procDate && <span style={{ fontWeight: 500, fontSize: "11px", color: "#075985" }}>Insertion Date: {procDate}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", padding: "12px 14px", background: "#ffffff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Surgical Approach</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{approach}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Cuff Positioning</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{cuff}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>On-Table Fluid Trial</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#15803d" }}>{testFlow}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Break-in Schedule</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{breakin}</div>
        </div>
      </div>
    </div>
  );
};

const PdHomeTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions } = useNephrology();

  // Auto-sync PD catheter procedure data into home dialysis prescription fields
  useEffect(() => {
    const activePd =
      formData?.pd_proc_approach ||
      formData?.pd_exit_site ||
      formData?.pd_fluid_in ||
      formData?.pd_break_in ||
      formData?.proc_type === "pd_catheter"
        ? formData
        : null;
    const pdSessions = (historicalSessions || []).filter(
      (s) =>
        (s.track === "dialysis_rrt" || s.track === "procedures" || s.track === "intake_baseline") &&
        (s.data?.pd_proc_approach ||
          s.data?.pd_exit_site ||
          s.data?.pd_fluid_in ||
          s.data?.pd_break_in ||
          s.tab === "pd_catheter" ||
          s.data?.proc_type === "pd_catheter")
    );
    const latest = [...pdSessions].sort(
      (a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0)
    )[0];
    const src = activePd || latest?.data;
    if (!src) return;

    if (!formData["v2_pd_modality"]) {
      updateField("v2_pd_modality", "CAPD (Continuous Ambulatory)");
    }
    if (!formData["v2_pd_exchanges"] && src.pd_break_in) {
      updateField("v2_pd_exchanges", 4);
    }
    if (!formData["v2_pd_volume"] && src.pd_fluid_in) {
      const volNum = parseFloat(src.pd_fluid_in);
      if (!isNaN(volNum)) {
        updateField("v2_pd_volume", volNum >= 100 ? (volNum / 1000).toFixed(1) : volNum);
      }
    }
  }, [historicalSessions, formData?.pd_fluid_in, formData?.pd_break_in, formData?.proc_type]);

  const [isGeneratingPeritonitis, setIsGeneratingPeritonitis] = useState(false);
  const [isGeneratingFluid, setIsGeneratingFluid] = useState(false);
  const [isGeneratingAdequacy, setIsGeneratingAdequacy] = useState(false);
  const [isGeneratingHdOpt, setIsGeneratingHdOpt] = useState(false);
  const [isGeneratingAdherence, setIsGeneratingAdherence] = useState(false);
  const [isGeneratingTech, setIsGeneratingTech] = useState(false);

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
      <VoiceDictationPanel section="Peritoneal Dialysis & Home RPM" fields={ckdFieldsFor("v2_pd_", "v2_home_")} transformStructuredValues={({ values }) => values} />
      
      <Section title="Peritoneal Dialysis Prescription" note="Home therapy parameters (CAPD / APD)." historyProps={historyProps} historyKeys={["v2_pd_modality", "v2_pd_exchanges", "v2_pd_volume", "v2_pd_dwell"]}>
        <DialysisEncounterHistory {...historyProps} section="pd_prescription" />
        <RecentPdCatheterSummary historicalSessions={historicalSessions} formData={formData} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Modality & Dosing</h4>
            <FormField label="PD Modality" name="v2_pd_modality" type="select" options={["", "CAPD (Continuous Ambulatory)", "APD (Automated Cycler)"]} />
            <FormField label="Number of Exchanges per Day" name="v2_pd_exchanges" type="number" />
            <FormField label="Exchange Volume (Liters)" name="v2_pd_volume" type="number" />
            <FormField label="Dwell Time (Hours)" name="v2_pd_dwell" type="number" />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Fluid Removal (UF)</h4>
            <FormField label="Dialysate Glucose Concentration" name="v2_pd_dextrose" type="select" options={["", "1.5%", "2.5%", "4.25%", "Mixed/Icodextrin"]} />
            <FormField label="Daily UF Volume Tracking (mL)" name="v2_pd_home_uf" type="number" />
            <FormField label="UF Failure Detection" name="v2_pd_uf_fail" type="select" options={["", "Adequate UF", "Low UF (Membrane Failure)", "Low UF (Catheter Malposition)", "Low UF (Peritoneal Sclerosis)"]} />
          </div>
        </div>
      </Section>

      <Section title="PD Adequacy Assessment" note="Monitoring peritoneal clearance and membrane characteristics." historyProps={historyProps} historyKeys={["v2_pd_ktv", "v2_pd_pet"]}>
        <DialysisEncounterHistory {...historyProps} section="pd_adequacy" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clearance Metrics</h4>
            <FormField label="Weekly Kt/V (Target >1.7/week)" name="v2_pd_ktv" type="number" />
            <FormField label="Residual Renal Function Contribution" name="v2_pd_rrf" type="textarea" placeholder="e.g., Urine volume 500mL/day..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Peritoneal Equilibration Test (PET)</h4>
            <FormField label="Membrane Transport Type" name="v2_pd_pet" type="select" options={["", "High Transport", "High-Average Transport", "Low-Average Transport", "Low Transport"]} />
            <FormField label="Prescription Adjustment per PET" name="v2_pd_pet_adj" type="textarea" placeholder="e.g., Switch to APD for high transporters..." />
          </div>
        </div>
      </Section>

      <Section title="Peritonitis Surveillance & Management" note="Infection monitoring and protocol adherence." historyProps={historyProps} historyKeys={["v2_pd_peritonitis_symp", "v2_pd_wbc", "v2_pd_culture"]}>
        <DialysisEncounterHistory {...historyProps} section="pd_peritonitis" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Assessment</h4>
            <FormField label="Symptom Checklist" name="v2_pd_peritonitis_symp" type="select" options={["", "None", "Cloudy Effluent", "Abdominal Pain", "Fever", "Multiple Symptoms"]} />
            <FormField label="Effluent WBC (cells/µL)" name="v2_pd_wbc" type="number" />
            <FormField label="% PMNs (Target < 50%)" name="v2_pd_pmn" type="number" />
            <FormField label="Gram Stain & Culture Results" name="v2_pd_culture" type="textarea" placeholder="Organism identified..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Treatment & Recurrence</h4>
            <FormField label="Antibiotic Protocol" name="v2_pd_abx" type="select" options={["", "Empiric (Cefazolin + Ceftazidime IP)", "Targeted per Culture", "Completed Course"]} />
            <FormField label="Recurrence Tracking" name="v2_pd_recurrence" type="select" options={["", "First Episode", "Relapsing", "Recurrent", "Repeat"]} />
            <FormField label="Catheter Removal Indicated?" name="v2_pd_cath_remove" type="select" options={["", "No", "Yes (Refractory/Fungal/Relapsing)"]} />
          </div>
        </div>
      </Section>

      <Section title="Home Dialysis Remote Monitoring (8.3)" note="Continuous RPM and problem detection for Home HD and PD." historyProps={historyProps} historyKeys={["v2_home_rpm_sync", "v2_home_rpm_alerts", "v2_home_rpm_triage"]}>
        <DialysisEncounterHistory {...historyProps} section="pd_home_monitoring" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>RPM Platform (Devices & Cloud)</h4>
            <FormField label="Bluetooth Vitals Sync (BP, Weight, Temp, O2)" name="v2_home_rpm_sync" type="select" options={["", "Synced Today", "Sync Delayed", "Offline"]} />
            <FormField label="Machine Cloud Upload (Home HD / APD cycler)" name="v2_home_machine_sync" type="select" options={["", "Session Data Uploaded", "Pending Upload", "Error"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Alert & Triage System</h4>
            <FormField label="Rule-Based Alerts (Missed session, fever, weight)" name="v2_home_rpm_alerts" type="textarea" placeholder="e.g., BP Out of Range, Excessive weight gain..." />
            <FormField label="Triage Level Status" name="v2_home_rpm_triage" type="select" options={["", "Green (Routine Next Visit)", "Yellow (Nurse Call <24h)", "Red (Urgent Call/ED Referral)"]} />
          </div>
        </div>
      </Section>

      <Section title="Modality-Specific Remote Tracking" note="Home HD and PD specific daily metrics.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Home HD Monitoring</h4>
            <FormField label="Session Completion vs Scheduled" name="v2_home_hd_sessions" type="select" options={["", "100% Adherence", "Missed Session", "Shortened Session"]} />
            <FormField label="Machine Alarms & Adequacy" name="v2_home_hd_alarms" type="textarea" placeholder="Clotting, Air Detector, calculated Kt/V..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>PD Monitoring</h4>
            <FormField label="Patient Logged Daily UF & Symptoms" name="v2_home_pd_log" type="textarea" placeholder="Daily UF volume, Abdominal pain checklist..." />
            <FormField label="Photo Uploads (AI Analyzed Effluent / Exit Site)" name="v2_home_pd_photos" type="select" options={["", "Clear / Normal", "AI Flagged Turbidity/Redness", "Missing", "Not Required Today"]} />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Remote Monitoring & Optimization" note="Predictive intelligence for Home HD and PD.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Predictions</h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Peritonitis Early Detection (Image + NLP)" name="v2_ai_home_peritonitis" type="textarea" placeholder="Predicts risk 24-48h early via effluent image analysis and symptom NLP..." />
              <button
                type="button"
                onClick={() => handleGenerate(generatePdHomePeritonitis, setIsGeneratingPeritonitis)}
                disabled={isGeneratingPeritonitis}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingPeritonitis ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingPeritonitis ? "Predicting..." : "⚡ Predict Peritonitis Risk"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Fluid Overload Prediction" name="v2_ai_home_fluid" type="textarea" placeholder="Integrates weight, BP, UF to prevent volume overload admissions..." />
              <button
                type="button"
                onClick={() => handleGenerate(generatePdHomeFluid, setIsGeneratingFluid)}
                disabled={isGeneratingFluid}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingFluid ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingFluid ? "Predicting..." : "⚡ Predict Fluid Overload"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="PD Adequacy Optimization" name="v2_ai_pd_adequacy" type="textarea" placeholder="Suggests exchange volume/dwell time/glucose changes to achieve Kt/V..." />
              <button
                type="button"
                onClick={() => handleGenerate(generatePdHomeAdequacy, setIsGeneratingAdequacy)}
                disabled={isGeneratingAdequacy}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingAdequacy ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingAdequacy ? "Optimizing..." : "⚡ Optimize Adequacy"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Operational & Technical</h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Home HD Session Optimization" name="v2_ai_home_hd_opt" type="textarea" placeholder="Recommends personalized session duration and UF rate..." />
              <button
                type="button"
                onClick={() => handleGenerate(generatePdHomeHdOpt, setIsGeneratingHdOpt)}
                disabled={isGeneratingHdOpt}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingHdOpt ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingHdOpt ? "Optimizing..." : "⚡ Optimize Home HD"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Adherence Prediction & Intervention" name="v2_ai_home_adherence" type="textarea" placeholder="Predicts non-adherence via behavioral signals to trigger outreach..." />
              <button
                type="button"
                onClick={() => handleGenerate(generatePdHomeAdherence, setIsGeneratingAdherence)}
                disabled={isGeneratingAdherence}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingAdherence ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingAdherence ? "Predicting..." : "⚡ Predict Adherence"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Technical Issue Detection" name="v2_ai_home_tech" type="textarea" placeholder="Anomaly detection in machine logs predicts supply/maintenance needs..." />
              <button
                type="button"
                onClick={() => handleGenerate(generatePdHomeTech, setIsGeneratingTech)}
                disabled={isGeneratingTech}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingTech ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingTech ? "Detecting..." : "⚡ Detect Anomalies"}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default PdHomeTab;
