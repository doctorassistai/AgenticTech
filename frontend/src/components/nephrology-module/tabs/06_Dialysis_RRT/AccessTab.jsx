import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import { generateAccessMaturation, generateAccessTiming, generateAccessFailureRisk, generateAccessFlowTrajectory, generateAccessInterventionOpt } from "../../services/nephrologyApi";
import DialysisEncounterHistory from "../../components/DialysisEncounterHistory";

const RecentAccessProcedureSummary = ({ historicalSessions, formData }) => {
  const activeAccessData =
    formData?.avf_sub_procedure ||
    formData?.avf_anast_type ||
    formData?.avf_catheter_type ||
    formData?.avf_thrill_bruit ||
    formData?.proc_category === "access" ||
    formData?.proc_type?.startsWith("avf") ||
    formData?.proc_type?.startsWith("avg") ||
    formData?.proc_type === "permcath" ||
    formData?.proc_type === "temp_line"
      ? formData
      : null;

  const accessSessions = (historicalSessions || []).filter(
    (s) =>
      (s.track === "dialysis_rrt" || s.track === "procedures") &&
      (s.data?.avf_sub_procedure ||
        s.data?.avf_anast_type ||
        s.data?.avf_catheter_type ||
        s.data?.avf_thrill_bruit ||
        s.tab?.startsWith("avf") ||
        s.tab?.startsWith("avg") ||
        s.tab?.includes("cath") ||
        s.tab === "fistulogram")
  );

  const latestSession = accessSessions.length > 0
    ? [...accessSessions].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))[0]
    : null;

  const d = activeAccessData || latestSession?.data;
  if (!d) return null;

  const procDate = d.proc_date || (latestSession?.created_at ? new Date(latestSession.created_at).toLocaleDateString() : "");
  const procName = d.proc_type || d.avf_sub_procedure || "Vascular Access Procedure";
  const formattedName = procName.replace(/_/g, " ").toUpperCase();
  const operator = d.proc_operator || "Vascular Team";
  const thrill = d.avf_thrill_bruit || "Documented in operative note";
  const side = d.proc_side || d.avf_side || "";

  return (
    <div style={{ marginBottom: "18px", border: "1px solid #7c3aed", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#f5f3ff", padding: "8px 14px", fontSize: "12px", fontWeight: 700, color: "#6d28d9", borderBottom: "1px solid #ede9fe", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>RECENT VASCULAR ACCESS OPERATIVE RECORD</span>
        {procDate && <span style={{ fontWeight: 500, fontSize: "11px", color: "#5b21b6" }}>Procedure Date: {procDate}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", padding: "12px 14px", background: "#ffffff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Access Created / Placed</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{side ? `${side} ` : ""}{formattedName}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Performing Surgeon</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{operator}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>On-Table Thrill / Patency</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#15803d" }}>{thrill}</div>
        </div>
      </div>
    </div>
  );
};

const AccessTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions } = useNephrology();

  // Auto-sync access placement into AccessTab fields
  React.useEffect(() => {
    const pDate = formData.proc_date;
    if (pDate && !formData.v2_access_date) {
      updateField("v2_access_date", pDate);
    }
    const pType = formData.proc_type || formData.avf_sub_procedure;
    if (pType && !formData.v2_access_type) {
      if (pType.startsWith("avf")) updateField("v2_access_type", "AV Fistula (AVF)");
      else if (pType.startsWith("avg")) updateField("v2_access_type", "AV Graft (AVG)");
      else if (pType.includes("cath") || pType === "permcath") updateField("v2_access_type", "Tunneled CVC");
      else if (pType === "temp_line") updateField("v2_access_type", "Temporary CVC");
    }
    const pThrill = formData.avf_thrill_bruit;
    if (pThrill && !formData.v2_access_pe) {
      updateField("v2_access_pe", pThrill);
    }
  }, [formData.proc_date, formData.proc_type, formData.avf_sub_procedure, formData.avf_thrill_bruit, formData.v2_access_date, formData.v2_access_type, formData.v2_access_pe, updateField]);

  const [isGeneratingMaturation, setIsGeneratingMaturation] = useState(false);
  const [isGeneratingTiming, setIsGeneratingTiming] = useState(false);
  const [isGeneratingFailureRisk, setIsGeneratingFailureRisk] = useState(false);
  const [isGeneratingTraj, setIsGeneratingTraj] = useState(false);
  const [isGeneratingIntervention, setIsGeneratingIntervention] = useState(false);

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
      <VoiceDictationPanel section="Vascular Access Management" fields={ckdFieldsFor("v2_access_")} transformStructuredValues={({ values }) => values} />
      
      <Section title="Vascular Access Planning Timeline" note="Ensure timely creation and maturation of permanent access." historyProps={historyProps} historyKeys={["v2_access_egfr_trig", "v2_access_target", "v2_access_mapping"]}>
        <DialysisEncounterHistory {...historyProps} section="access_planning" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Triggers</h4>
            <FormField label="eGFR Trigger Check" name="v2_access_egfr_trig" type="select" options={["", "eGFR <20: Initiate Discussion", "eGFR <15: Surgical Referral", "Not Triggered"]} />
            <FormField label="Target Status" name="v2_access_target" type="select" options={["", "On Track (Access ready before HD)", "Delayed (At risk for CVC)"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Vascular Mapping Protocol</h4>
            <FormField label="Vein Mapping Ultrasound" name="v2_access_mapping" type="select" options={["", "Pending", "Scheduled", "Completed"]} />
            <FormField label="Arterial Doppler (if PAD suspected)" name="v2_access_doppler" type="select" options={["", "N/A", "Pending", "Completed"]} />
            <FormField label="Mapping Results & Recommendation" name="v2_access_map_result" type="textarea" placeholder="e.g., Suitable vessels found: Radiocephalic > Brachiocephalic..." />
          </div>
        </div>
      </Section>

      <Section title="Surgical Referral & Creation" note="Management of the vascular surgery pipeline." historyProps={historyProps} historyKeys={["v2_access_referral", "v2_access_type", "v2_access_date"]}>
        <DialysisEncounterHistory {...historyProps} section="access_surgical" />
        <RecentAccessProcedureSummary historicalSessions={historicalSessions} formData={formData} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Surgical Referral</h4>
            <FormField label="Auto-Referral to Vascular Surgery" name="v2_access_referral" type="select" options={["", "Generated", "Sent", "Pending"]} />
            <FormField label="Patient Preference / Notes" name="v2_access_pref" type="textarea" placeholder="e.g., Prefers non-dominant Left arm..." />
            <FormField label="Surgery Scheduling Coordinator" name="v2_access_coord" type="select" options={["", "Appointment Scheduled", "Waiting List", "Follow-up Needed"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Access Placement</h4>
            <FormField label="Current Access Type" name="v2_access_type" type="select" options={["", "None", "AV Fistula (AVF)", "AV Graft (AVG)", "Tunneled CVC", "Temporary CVC", "PD Catheter"]} />
            <FormField label="Placement Date" name="v2_access_date" type="date" />
          </div>
        </div>
      </Section>

      <Section title="Post-Operative Monitoring & Catheter Management" note="Maturation tracking and temporary access bridge." historyProps={historyProps} historyKeys={["v2_access_pe", "v2_access_6wk_us", "v2_access_cvc", "v2_access_cvc_comp"]}>
        <DialysisEncounterHistory {...historyProps} section="access_monitoring" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>AVF/AVG Maturation</h4>
            <FormField label="Physical Exam (Thrill, Bruit, Cannulation)" name="v2_access_pe" type="textarea" placeholder="e.g., Strong thrill, continuous bruit..." />
            <FormField label="6-Week Maturation Ultrasound" name="v2_access_6wk_us" type="select" options={["", "Pending", "Mature (Flow >500, Dia >4mm, Depth <6mm)", "Immature / Failed"]} />
            <FormField label="Readiness Status" name="v2_access_ready" type="select" options={["", "Not Ready", "Ready for Dialysis Initiation"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Catheter Management</h4>
            <FormField label="Tunneled CVC Placed?" name="v2_access_cvc" type="select" options={["", "Yes (Bridging to AVF/AVG)", "Yes (Permanent)", "No"]} />
            <FormField label="CVC Complication Tracking" name="v2_access_cvc_comp" type="select" options={["", "None", "Infection (CRBSI)", "Thrombosis", "Malfunction / Poor Flow"]} />
            <FormField label="CVC Removal Scheduled" name="v2_access_cvc_remove" type="select" options={["", "N/A", "Pending AVF Maturation", "Scheduled for Removal", "Removed"]} />
          </div>
        </div>
      </Section>

      <Section title="Routine Surveillance & Machine Monitoring (8.2)" note="Monthly physical exams and machine-based metrics for patency." historyProps={historyProps} historyKeys={["v2_access_monthly_exam", "v2_access_qa_measure", "v2_access_recirc_measure"]}>
        <DialysisEncounterHistory {...historyProps} section="access_surveillance" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Monthly Physical Exam</h4>
            <FormField label="Exam Findings (Thrill, Bruit, Cannulation)" name="v2_access_monthly_exam" type="select" options={["", "Normal", "Abnormal (Weak thrill / High-pitch bruit)", "Difficulty Cannulating", "Prolonged Bleeding", "Arm Swelling"]} />
            <FormField label="Signs of Infection / Aneurysm" name="v2_access_aneurysm_inf" type="textarea" placeholder="Document skin integrity, erythema, aneurysm size..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Dialysis Machine Monitoring</h4>
            <FormField label="Access Flow (Qa mL/min) [Target >500]" name="v2_access_qa_measure" type="number" />
            <FormField label="Recirculation % [Target <10%]" name="v2_access_recirc_measure" type="number" />
            <FormField label="Venous Pressures (SVP/DVP Ratio)" name="v2_access_vp_ratio" type="textarea" placeholder="Elevated trends suggest outflow stenosis..." />
          </div>
        </div>
      </Section>

      <Section title="Diagnostic Ultrasound & Intervention Pathway (8.2)" note="Detecting stenosis and managing access failure." historyProps={historyProps} historyKeys={["v2_access_doppler_surv", "v2_access_stenosis_diag", "v2_access_procedure_done"]}>
        <DialysisEncounterHistory {...historyProps} section="access_intervention" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Diagnostic Imaging</h4>
            <FormField label="Quarterly Doppler Ultrasound" name="v2_access_doppler_surv" type="select" options={["", "Normal", "Diagnostic for Stenosis"]} />
            <FormField label="Stenosis Criteria Met?" name="v2_access_stenosis_diag" type="select" options={["", "None", ">50% Diameter Reduction", "Peak Systolic Velocity >400 cm/s", "Flow <500 mL/min"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Intervention & Recovery</h4>
            <FormField label="IR / Vascular Referral" name="v2_access_ir_ref" type="select" options={["", "None", "Interventional Nephrology", "Vascular Surgery"]} />
            <FormField label="Procedure Performed" name="v2_access_procedure_done" type="select" options={["", "Angioplasty (Balloon +/- Stent)", "Surgical Revision", "Thrombectomy"]} />
            <FormField label="Post-Intervention Flow (1W / 1M)" name="v2_access_post_ir_flow" type="textarea" placeholder="Record restored Qa..." />
          </div>
        </div>
      </Section>

      <Section title="Advanced Catheter Management (8.2)" note="Protocols for patients dependent on CVCs.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Maintenance & Dysfunction</h4>
            <FormField label="Catheter Lock Protocol" name="v2_access_lock_proto" type="select" options={["", "Heparin Lock", "Citrate Lock"]} />
            <FormField label="Dysfunction / tPA Use" name="v2_access_tpa_use" type="select" options={["", "Normal Flow", "Poor Flow - tPA Administered"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Infection Surveillance</h4>
            <FormField label="Exit Site Care Documented" name="v2_access_exit_care" type="select" options={["", "Clean / Intact", "Erythema / Discharge"]} />
            <FormField label="CRBSI Surveillance" name="v2_access_crbsi_track" type="select" options={["", "No Infection", "Suspected", "Confirmed CRBSI"]} />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Access Intelligence" note="Predictive models for access creation, failure, and surveillance.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Creation & Maturation (7.2)</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Access Maturation Predictor (AVF vs AVG)" name="v2_ai_access_maturation" type="textarea" placeholder="Predicts AVF success probability based on mapping, age, diabetes, smoking..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAccessMaturation, setIsGeneratingMaturation)}
                disabled={isGeneratingMaturation}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingMaturation ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingMaturation ? "Predicting..." : "⚡ Predict Maturation"}
              </button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Optimal Surgery Timing" name="v2_ai_access_timing" type="textarea" placeholder="Recommends access creation timing based on eGFR trajectory to avoid CVC..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAccessTiming, setIsGeneratingTiming)}
                disabled={isGeneratingTiming}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingTiming ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingTiming ? "Optimizing..." : "⚡ Optimize Timing"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Early Access Failure Risk" name="v2_ai_access_failure" type="textarea" placeholder="Identifies high-risk patients for early failure to trigger frequent monitoring..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAccessFailureRisk, setIsGeneratingFailureRisk)}
                disabled={isGeneratingFailureRisk}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingFailureRisk ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingFailureRisk ? "Assessing..." : "⚡ Assess Failure Risk"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Surveillance & Intervention (8.2)</h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Access Flow Trajectory Prediction" name="v2_ai_access_traj" type="textarea" placeholder="Time-series prediction of future flow, flagging declining trends early..." />
              <FormField label="Thrombosis Risk Prediction (30-Day)" name="v2_ai_access_thromb_risk" type="textarea" placeholder="Predicts probability of thrombosis using flow, pressure, and coagulability data..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAccessFlowTrajectory, setIsGeneratingTraj)}
                disabled={isGeneratingTraj}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingTraj ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingTraj ? "Predicting..." : "⚡ Predict Trajectory & Risk"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Intervention Timing Optimization" name="v2_ai_access_interv_opt" type="textarea" placeholder="Predicts optimal timing for angioplasty to balance thrombosis risk vs unnecessary procedures..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateAccessInterventionOpt, setIsGeneratingIntervention)}
                disabled={isGeneratingIntervention}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingIntervention ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingIntervention ? "Optimizing..." : "⚡ Optimize Intervention"}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default AccessTab;
