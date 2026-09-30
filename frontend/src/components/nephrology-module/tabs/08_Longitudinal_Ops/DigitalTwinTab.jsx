import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import { generateDigitalTwin } from "../../services/nephrologyApi";

const DigitalTwinTab = () => {
  const { formData, updateField } = useNephrology();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await generateDigitalTwin(formData);
      if (response?.data) {
        Object.entries(response.data).forEach(([key, value]) => {
          updateField(key, value);
        });
      }
    } catch (error) {
      console.error("Failed to generate digital twin:", error);
      alert("Failed to generate Command Center insights. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "20px", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#333", letterSpacing: "0.5px" }}>Nephrology Command Center</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#666" }}>AI-driven systemic synthesis and standard-of-care gap analysis.</p>
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
          {isGenerating ? "Analyzing Patient Data..." : "⚡ Run System Diagnostics"}
        </button>
      </div>

      <Section title="The Kidney Digital Twin" note="Dynamic computational representation of the patient's systemic state across 6 layers.">
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "20px", marginBottom: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <FormField label="Current Function & Injury (eGFR, Proteinuria)" name="v2_twin_function" type="textarea" inputStyle={{ height: "80px" }} />
            <FormField label="Underlying Disease & Risk (Etiology, CV Risk)" name="v2_twin_disease" type="textarea" inputStyle={{ height: "80px" }} />
            <FormField label="Metabolic & Hemodynamic State (BP, Vol, K+, Bone)" name="v2_twin_metabolic" type="textarea" inputStyle={{ height: "80px" }} />
            <FormField label="Treatment Exposure & Response (SGLT2i, RAASi)" name="v2_twin_tx" type="textarea" inputStyle={{ height: "80px" }} />
            <FormField label="Trajectories & Complications (Decline Rate)" name="v2_twin_traj" type="textarea" inputStyle={{ height: "80px" }} />
            <FormField label="Patient Phenotype & Adherence (Frailty, SDOH)" name="v2_twin_phenotype" type="textarea" inputStyle={{ height: "80px" }} />
          </div>
        </div>
      </Section>

      <Section title="Active Clinical Intelligence" note="Prioritized action items and standard-of-care gap identification.">
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", padding: "20px" }}>
            <h4 style={{ margin: "0 0 12px 0", color: "#991b1b", textTransform: "uppercase", fontSize: "12px", fontWeight: 700, letterSpacing: "0.5px" }}>
              🔴 Active Deterioration Alerts
            </h4>
            <FormField label="Immediate Life/Organ Threats" name="v2_cmd_alerts" type="textarea" inputStyle={{ height: "100px", background: "#fff", borderColor: "#fca5a5" }} />
          </div>

          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "6px", padding: "20px" }}>
            <h4 style={{ margin: "0 0 12px 0", color: "#b45309", textTransform: "uppercase", fontSize: "12px", fontWeight: 700, letterSpacing: "0.5px" }}>
              ⚠️ Standard of Care Gaps (KDIGO)
            </h4>
            <FormField label="Missing Referrals & Evidence-Based Therapies" name="v2_cmd_care_gaps" type="textarea" inputStyle={{ height: "120px", background: "#fff", borderColor: "#fcd34d" }} />
          </div>

          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "6px", padding: "20px" }}>
            <h4 style={{ margin: "0 0 12px 0", color: "#166534", textTransform: "uppercase", fontSize: "12px", fontWeight: 700, letterSpacing: "0.5px" }}>
              🎯 The Next Clinical Question
            </h4>
            <FormField label="Most Critical Decision Required Today" name="v2_cmd_next_q" type="textarea" inputStyle={{ height: "100px", background: "#fff", borderColor: "#86efac", fontSize: "15px", fontWeight: 500 }} />
          </div>

        </div>
      </Section>
    </div>
  );
};

export default DigitalTwinTab;
