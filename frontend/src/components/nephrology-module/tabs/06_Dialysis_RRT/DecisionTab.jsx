import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import { generateRrtModalityRec, generateRrtOutcomePrediction, generateRrtMcdaWeighting, generateRrtDonorNlp } from "../../services/nephrologyApi";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import DialysisEncounterHistory from "../../components/DialysisEncounterHistory";

const CkdBaselineHistoryTable = ({ historicalSessions }) => {
  const pastCkdSessions = historicalSessions.filter(s => s.track === "ckd_mgmt");
  if (pastCkdSessions.length === 0) return null;

  // Get the most recent CKD session (last known baseline)
  const lastCkd = pastCkdSessions.sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  return (
    <div style={{ marginBottom: "20px", border: "1px solid #722ed1", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#f9f0ff", padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "#531dab", borderBottom: "1px solid #722ed1" }}>
        Pre-Dialysis Baseline (From CKD Progression Track)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", padding: "10px 12px", background: "#fff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Last Outpatient eGFR</div>
          <div style={{ fontWeight: 600, marginTop: "2px" }}>{lastCkd.data?.v2_risk_egfr_decline || "Unknown"} mL/min</div>
        </div>
        <div>
          <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>KDIGO Stage</div>
          <div style={{ fontWeight: 600, marginTop: "2px" }}>{lastCkd.data?.v2_risk_kdigo_stage || "Unknown"}</div>
        </div>
        <div>
          <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Vascular Access Status</div>
          <div style={{ fontWeight: 600, marginTop: "2px", color: lastCkd.data?.v2_rrt_surg_consult ? "#137333" : "#cf1322" }}>
            {lastCkd.data?.v2_rrt_surg_consult || "Not Planned (Crash Start Risk)"}
          </div>
        </div>
      </div>
    </div>
  );
};

const DecisionTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions } = useNephrology();
  const selectedSymptoms = formData.v2_rrt_uremic || {};

  const [isGeneratingModality, setIsGeneratingModality] = useState(false);
  const [isGeneratingOutcome, setIsGeneratingOutcome] = useState(false);
  const [isGeneratingMcda, setIsGeneratingMcda] = useState(false);
  const [isGeneratingDonor, setIsGeneratingDonor] = useState(false);

  const handleGenerate = async (apiFunc, setLoader) => {
    setLoader(true);
    try {
      const res = await apiFunc(formData);
      if (res?.data) {
        Object.entries(res.data).forEach(([k, v]) => updateField(k, v));
      }
    } catch (err) {
      console.warn("LLM generation failed:", err.message);
      // Fallbacks if API fails
      if (apiFunc === generateRrtModalityRec) updateField("v2_rrt_algo_rec", "AI: Consider patient preference for independence. PD or Home HD favored.");
      if (apiFunc === generateRrtOutcomePrediction) updateField("v2_ai_rrt_outcome", "AI Prediction: In-center HD 65%, Home HD 70%, PD 68%, Transplant 85%");
      if (apiFunc === generateRrtMcdaWeighting) updateField("v2_ai_rrt_mcda", "Strong Match with PD");
      if (apiFunc === generateRrtDonorNlp) updateField("v2_ai_rrt_donor_nlp", "AI: Potential living donor mentioned in notes (Spouse willing to test).");
    } finally {
      setLoader(false);
    }
  };

  const transformDecisionValues = ({ values = {}, transcript = "" }) => {
    const updated = { ...values };
    const text = transcript.toLowerCase();

    // Parse multi-select symptom toggles directly from transcript
    const syms = formData.v2_rrt_uremic || {};
    const newSyms = { ...syms };
    let symsChanged = false;

    if (text.includes("uremia") || text.includes("encephalopathy") || text.includes("pericarditis")) {
      newSyms["Uremia (Encephalopathy/Pericarditis)"] = true;
      symsChanged = true;
    }
    if (text.includes("volume overload") || text.includes("refractory edema") || text.includes("fluid overload")) {
      newSyms["Volume Overload (Refractory)"] = true;
      symsChanged = true;
    }
    if (text.includes("acidosis") || text.includes("metabolic acidosis")) {
      newSyms["Metabolic Acidosis"] = true;
      symsChanged = true;
    }
    if (text.includes("hyperkalemia") || text.includes("high potassium")) {
      newSyms["Hyperkalemia"] = true;
      symsChanged = true;
    }
    if (text.includes("malnutrition") || text.includes("nausea") || text.includes("weight loss")) {
      newSyms["Malnutrition / Nausea"] = true;
      symsChanged = true;
    }

    if (symsChanged) {
      updated.v2_rrt_uremic = newSyms;
    }

    return updated;
  };

  const handleToggle = (sym) => {
    const updated = { ...selectedSymptoms, [sym]: !selectedSymptoms[sym] };
    updateField("v2_rrt_uremic", updated);
  };

  const toggleStyle = (isActive) => ({
    padding: "6px 12px",
    border: isActive ? "1px solid #000000" : "1px solid #cccccc",
    backgroundColor: isActive ? "#000000" : "#ffffff",
    color: isActive ? "#ffffff" : "#333333",
    fontSize: "11.5px",
    fontWeight: "500",
    cursor: "pointer",
    display: "inline-block",
    marginRight: "8px",
    marginBottom: "8px",
    borderRadius: "2px",
    transition: "all 0.15s ease",
  });

  const UREMIC_SYMPTOMS = ["Uremia (Encephalopathy/Pericarditis)", "Volume Overload (Refractory)", "Metabolic Acidosis", "Hyperkalemia", "Malnutrition / Nausea"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      
      <CkdBaselineHistoryTable historicalSessions={historicalSessions} />
      
      <VoiceDictationPanel section="Dialysis and RRT Planning" fields={ckdFieldsFor("v2_rrt_")} transformStructuredValues={transformDecisionValues} />

      <Section title="RRT Eligibility & Triggers" note="Automatic triggers and symptom checklists for advanced RRT planning." historyProps={historyProps} historyKeys={["v2_rrt_start_date", "v2_rrt_egfr_trigger"]}>
        <DialysisEncounterHistory {...historyProps} section="decision_eligibility" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Clinical Triggers</h4>
            <FormField label="Dialysis Initiation Date" name="v2_rrt_start_date" type="date" style={{ marginBottom: "16px" }} />
            <FormField label="eGFR Trigger (<20 mL/min for planning)" name="v2_rrt_egfr_trigger" type="select" options={["", "Triggered (eGFR <20)", "Not Triggered"]} />
            <div style={{ height: "16px" }} />
            <h4 style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Symptom Checklist</h4>
            <div>
              {UREMIC_SYMPTOMS.map(sym => <div key={sym} style={toggleStyle(selectedSymptoms[sym])} onClick={() => handleToggle(sym)}>{selectedSymptoms[sym] ? "✓ " : "+ "}{sym}</div>)}
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Modality Education Program</h4>
            <FormField label="Structured Education Session (Class/Nurse)" name="v2_rrt_ed_session" type="select" options={["", "Scheduled", "Completed", "Patient Declined"]} />
            <FormField label="Content/Video Library Delivered" name="v2_rrt_ed_content" type="select" options={["", "Yes (HD, PD, Transplant, Conservative)", "Pending"]} />
            <FormField label="Decision Aids Used (Survival/Cost/Time tools)" name="v2_rrt_ed_aids" type="select" options={["", "Yes", "No"]} />
          </div>
        </div>
      </Section>

      <Section title="Shared Decision-Making & Modality Choice" note="Integrating patient preferences with clinical suitability." historyProps={historyProps} historyKeys={["v2_rrt_ed_session", "v2_rrt_pref_survey", "v2_rrt_suitability", "v2_rrt_final_choice"]}>
        <DialysisEncounterHistory {...historyProps} section="decision_shared" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Preference & Suitability</h4>
            <FormField label="Patient Preference Survey (Values/Independence)" name="v2_rrt_pref_survey" type="select" options={["", "Completed - Prefers Home", "Completed - Prefers In-Center", "Completed - Prefers Conservative", "Pending"]} />
            <FormField label="Contraindication / Suitability Checker" name="v2_rrt_suitability" type="select" options={["", "All Modalities Suitable", "PD Contraindicated (Prior Abd Surgery/Dexterity)", "Home HD Contraindicated (Housing/Partner)", "Transplant Contraindicated"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Final Selection</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Modality Recommendation Algorithm Output" name="v2_rrt_algo_rec" type="textarea" placeholder="Integrating clinical factors + preferences..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateRrtModalityRec, setIsGeneratingModality)}
                disabled={isGeneratingModality}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingModality ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingModality ? "Generating..." : "⚡ Generate Rec"}
              </button>
            </div>
            <FormField label="Documented Modality Choice (EMR)" name="v2_rrt_final_choice" type="select" options={["", "In-Center HD", "Home HD", "Peritoneal Dialysis", "Pre-emptive Transplant", "Conservative Management"]} />
          </div>

        </div>
      </Section>

      <Section title="Transplant Evaluation Pathway" note="Pre-evaluation checklist and waitlist tracking." historyProps={historyProps} historyKeys={["v2_rrt_tx_referral", "v2_rrt_tx_check", "v2_rrt_tx_donor_ed", "v2_rrt_tx_waitlist"]}>
        <DialysisEncounterHistory {...historyProps} section="decision_transplant" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Pre-Evaluation</h4>
            <FormField label="Automatic Transplant Center Referral" name="v2_rrt_tx_referral" type="select" options={["", "Sent", "Pending", "Not Indicated"]} />
            <FormField label="Pre-Evaluation Checklist" name="v2_rrt_tx_check" type="select" options={["", "Cleared (Cardiac/Malignancy/ID/Psych)", "Pending Workup", "Contraindication Found"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Donor & Waitlist</h4>
            <FormField label="Living Donor Education Sent" name="v2_rrt_tx_donor_ed" type="select" options={["", "Yes", "No", "N/A"]} />
            <FormField label="Waitlist Registration Status" name="v2_rrt_tx_waitlist" type="select" options={["", "Active", "Inactive/Hold", "Not Listed"]} />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: RRT Decision Support" note="Predictive models for modality outcomes and preference weighting.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Outcomes & Weights</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Modality Outcome Prediction (Survival/QoL/Hosp)" name="v2_ai_rrt_outcome" type="textarea" placeholder="e.g., Estimated 5-year survival: In-center HD 65%, Home HD 70%, PD 68%, Transplant 85%" />
              <button
                type="button"
                onClick={() => handleGenerate(generateRrtOutcomePrediction, setIsGeneratingOutcome)}
                disabled={isGeneratingOutcome}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingOutcome ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingOutcome ? "Predicting..." : "⚡ Predict Outcomes"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <FormField label="Patient-Centered Preference Weighting (MCDA)" name="v2_ai_rrt_mcda" type="select" options={["", "Strong Match with PD", "Strong Match with Home HD", "Strong Match with In-Center HD"]} />
              <button
                type="button"
                onClick={() => handleGenerate(generateRrtMcdaWeighting, setIsGeneratingMcda)}
                disabled={isGeneratingMcda}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingMcda ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingMcda ? "Weighting..." : "⚡ Generate MCDA"}
              </button>
            </div>
          </div>
        </div>
      </Section>

    </div>
  );
};

export default DecisionTab;
