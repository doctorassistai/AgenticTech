import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { TX_DICTATION_FIELDS } from "../../components/txDictation";
import { generateTxReadiness } from "../../services/nephrologyApi";
import TransplantEncounterHistory from "../../components/TransplantEncounterHistory";

const TransplantVintageTable = ({ historicalSessions, formData }) => {
  let startDateRaw = formData?.v2_rrt_start_date;
  
  if (!startDateRaw) {
    const sessionWithDate = historicalSessions.find(s => s.data?.v2_rrt_start_date);
    if (sessionWithDate) startDateRaw = sessionWithDate.data.v2_rrt_start_date;
  }
  
  if (!startDateRaw) {
    const dialysisSessions = historicalSessions.filter(s => s.track === "dialysis_rrt");
    if (dialysisSessions.length > 0) {
      const earliestSession = dialysisSessions.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
      startDateRaw = earliestSession.date;
    }
  }

  if (!startDateRaw) return null;

  const startDate = new Date(startDateRaw);
  if (isNaN(startDate.getTime())) return null;

  const now = new Date();
  const diffTime = Math.abs(now - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const months = Math.floor(diffDays / 30);
  
  let vintageText = "";
  if (months < 1) vintageText = "< 1 Month";
  else if (months < 12) vintageText = `${months} Months`;
  else vintageText = `${Math.floor(months / 12)} Years, ${months % 12} Months`;

  return (
    <div style={{ marginBottom: "20px", border: "1px solid #fa8c16", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#fff7e6", padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "#d46b08", borderBottom: "1px solid #fa8c16" }}>
        Waitlist Priority: Dialysis Vintage
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", padding: "10px 12px", background: "#fff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Dialysis Initiation Date</div>
          <div style={{ fontWeight: 600, marginTop: "2px" }}>{startDate.toLocaleDateString()}</div>
        </div>
        <div>
          <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Calculated Vintage (Time on RRT)</div>
          <div style={{ fontWeight: 600, marginTop: "2px", color: "#d46b08" }}>{vintageText}</div>
        </div>
      </div>
    </div>
  );
};

const PreTxTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions } = useNephrology();
  
  const [isGeneratingReadiness, setIsGeneratingReadiness] = useState(false);

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
      <TransplantVintageTable historicalSessions={historicalSessions} formData={formData} />
      <VoiceDictationPanel section="Pre-Transplant & Workup" fields={TX_DICTATION_FIELDS} transformStructuredValues={({ values }) => values} />

      <Section title="Transplant Candidacy & Screening" note="Initial eligibility and contraindications." historyProps={historyProps} historyKeys={["v2_tx_eval_date", "v2_tx_med_fit", "v2_tx_psych_comp", "v2_tx_excl_malig"]}>
        <TransplantEncounterHistory {...historyProps} section="pre_candidacy" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Inclusion Criteria</h4>
            <FormField label="Transplant Evaluation Date" name="v2_tx_eval_date" type="date" />
            <FormField label="Medical Fitness & Age" name="v2_tx_med_fit" type="select" options={["", "Suitable", "Borderline/High Risk", "Contraindicated"]} />
            <FormField label="Psychosocial Stability / Compliance" name="v2_tx_psych_comp" type="select" options={["", "Cleared by Social Work", "Pending Evaluation", "Concerns Noted"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Exclusion Screening</h4>
            <FormField label="Active Malignancy or Infection" name="v2_tx_excl_malig" type="select" options={["", "None", "Active Issue Identified"]} />
            <FormField label="Severe Cardiac Disease / Substance Abuse" name="v2_tx_excl_cardiac" type="select" options={["", "None", "Active Issue Identified"]} />
          </div>
        </div>
      </Section>

      <Section title="Pre-Transplant Workup Tracker" note="Comprehensive clinical clearance tracking." historyProps={historyProps} historyKeys={["v2_tx_clear_cardio", "v2_tx_clear_id", "v2_tx_clear_malig", "v2_tx_clear_immuno"]}>
        <TransplantEncounterHistory {...historyProps} section="pre_workup" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Medical Clearance</h4>
            <FormField label="Cardiovascular (Stress, Echo, EKG)" name="v2_tx_clear_cardio" type="select" options={["", "Pending", "Cleared", "Needs Intervention"]} />
            <FormField label="Infectious Disease (HIV, HCV, CMV, TB)" name="v2_tx_clear_id" type="select" options={["", "Pending", "Cleared", "Treatment Required"]} />
            <FormField label="Malignancy Screening (Colon, Mammogram)" name="v2_tx_clear_malig" type="select" options={["", "Pending", "Cleared", "Follow-up Needed"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Ancillary Clearance</h4>
            <FormField label="Immunology (ABO, HLA, PRA)" name="v2_tx_clear_immuno" type="select" options={["", "Pending", "Completed"]} />
            <FormField label="Dental Clearance" name="v2_tx_clear_dental" type="select" options={["", "Pending", "Cleared", "Procedures Needed"]} />
            <FormField label="Overdue Tests / Reminders" name="v2_tx_overdue_tests" type="textarea" placeholder="List any overdue workup components..." />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Waitlist Readiness & Bottleneck Predictor" note="Predictive intelligence for waitlist activation timelines.">
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Readiness Predictor</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <FormField label="Bottlenecks & Activation Timeline" name="v2_ai_tx_readiness" type="textarea" placeholder="Analyzes clearance statuses to identify primary bottlenecks holding up the patient and predicts timeframe to waitlist activation..." />
            <button
              type="button"
              onClick={() => handleGenerate(generateTxReadiness, setIsGeneratingReadiness)}
              disabled={isGeneratingReadiness}
              style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingReadiness ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
            >
              {isGeneratingReadiness ? "Predicting..." : "⚡ Predict Readiness"}
            </button>
          </div>
        </div>
      </Section>

    </div>
  );
};

export default PreTxTab;
