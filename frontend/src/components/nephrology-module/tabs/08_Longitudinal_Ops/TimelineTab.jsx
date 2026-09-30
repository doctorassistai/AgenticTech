import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import { generateOpsTimeline } from "../../services/nephrologyApi";

const TimelineTab = () => {
  const { formData, updateField, historicalSessions } = useNephrology();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // Send the entire chart to the newly rewritten deterministic Python backend endpoint
      const unifiedData = {};
      
      if (historicalSessions && Array.isArray(historicalSessions)) {
         historicalSessions.forEach(session => {
            if (session.data) {
               Object.assign(unifiedData, session.data);
            }
         });
      }
      Object.assign(unifiedData, formData);

      const res = await generateOpsTimeline(unifiedData);
      
      if (res?.data && res.data.v2_timeline_map) {
         updateField("v2_timeline_map", res.data.v2_timeline_map);
      } else {
         updateField("v2_timeline_map", "No significant history found in patient record.");
      }
    } catch (err) {
      console.warn("Timeline generation failed:", err.message);
    } finally {
      setIsGenerating(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Kidney Event Timeline" note="Visual sequence of historical events telling the patient's story at a glance.">
        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "16px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase", borderBottom: "1px solid #e0e0e0", paddingBottom: "8px" }}>
            Signature Timeline Generator
          </h4>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "16px" }}>
            The timeline aggregates discrete clinical events (diagnoses, hospitalizations, labs) into a cohesive narrative structure.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
            <FormField 
              label="Chronological Event Map (Auto-generated)" 
              name="v2_timeline_map" 
              type="textarea" 
              placeholder="e.g.,&#10;2019: Hypertension&#10;↓&#10;2021: Diabetes&#10;↓&#10;2024: CKD diagnosed (eGFR 48)&#10;↓&#10;Jan 2026: AKI Hospitalization&#10;↓&#10;May 2026: Proteinuria Increased" 
              inputStyle={{ minHeight: "400px", fontFamily: "monospace", fontSize: "14px" }} 
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{ background: "#000", color: "#fff", border: "none", padding: "10px 20px", fontSize: "13px", borderRadius: "4px", cursor: isGenerating ? "wait" : "pointer", fontWeight: "bold" }}>
              {isGenerating ? "Synthesizing Timeline..." : "Sync from EHR & Refresh Timeline"}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default TimelineTab;
