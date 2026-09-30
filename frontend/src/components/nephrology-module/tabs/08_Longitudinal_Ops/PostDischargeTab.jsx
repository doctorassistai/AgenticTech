import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import { generatePostDischarge } from "../../services/nephrologyApi";

const PostDischargeTab = () => {
  const { formData, updateFields } = useNephrology();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await generatePostDischarge(formData);
      if (response?.data) {
        updateFields(response.data);
      }
    } catch (error) {
      console.error("Failed to generate Post-Discharge AI:", error);
      alert("Failed to run trajectory analysis. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Post-Discharge Recovery Tracking" note="Longitudinal intelligence tracking kidney recovery versus progressive decline.">
        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase", borderBottom: "1px solid #e0e0e0", paddingBottom: "8px" }}>
            Sequential Data Ingestion
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
            <FormField label="Day 0 (Discharge) Creatinine" name="v2_pd_cr_0" type="number" />
            <FormField label="Day 7 Creatinine" name="v2_pd_cr_7" type="number" />
            <FormField label="Day 30 Creatinine" name="v2_pd_cr_30" type="number" />
            <FormField label="Day 90 Creatinine" name="v2_pd_cr_90" type="number" />
          </div>
        </div>

        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "20px", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#333", letterSpacing: "0.5px" }}>AI Trajectory Recognition</h2>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#666" }}>Automatically diagnose recovery vs progressive decline.</p>
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
            {isGenerating ? "Analyzing..." : "⚡ Run Trajectory Analysis"}
          </button>
        </div>

        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
            <FormField label="System Diagnosis of Trajectory" name="v2_pd_ai_diagnosis" type="select" options={["", "Kidney Recovery (Post-AKI)", "Progressive Decline", "Stable CKD", "Rapid Progression"]} />
            <FormField label="AI Clinical Interpretation" name="v2_pd_ai_interp" type="textarea" placeholder="e.g., The system recognizes kidney recovery after AKI..." />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default PostDischargeTab;
