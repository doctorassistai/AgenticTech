import React, { useState } from "react";
import { useNephrology } from "../context/NephrologyContext";
import { generateAkiAiAssist } from "../services/nephrologyApi";

const AkiAiAssistButton = ({ section, variant = "banner", label }) => {
  const { formData, setFormData, sessionStatus } = useNephrology();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const readOnly = sessionStatus === "completed";

  const generate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await generateAkiAiAssist(section, formData);
      const values = result?.data || {};
      const applicable = Object.fromEntries(Object.entries(values).filter(([key]) => formData[key] === undefined || formData[key] === ""));
      setFormData((previous) => ({ ...previous, ...applicable }));
      const count = Object.keys(applicable).length;
      setMessage(count ? `${count} AI suggestion${count === 1 ? "" : "s"} added. Verify before saving.` : Object.keys(values).length ? "Suggestions were generated, but existing clinician-entered values were preserved." : "No supported suggestion could be generated from the current data.");
    } catch (error) {
      setMessage(error.message || "AI suggestion generation failed.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "inline") {
    return (
      <button 
        type="button" 
        onClick={generate} 
        disabled={readOnly || busy} 
        style={{ background: "#ffffff", color: "#000000", border: "1px solid #cccccc", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: readOnly || busy ? "not-allowed" : "pointer", whiteSpace: "nowrap", opacity: readOnly || busy ? 0.6 : 1 }}
      >
        {busy ? "Generating..." : label || "Run AI Extraction"}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", border: "1px solid #d9d9d9", background: "#fafafa", marginBottom: "20px" }}>
      <button type="button" onClick={generate} disabled={readOnly || busy} style={{ border: "1px solid #000", background: "#000", color: "#fff", padding: "7px 12px", cursor: readOnly || busy ? "not-allowed" : "pointer", opacity: readOnly || busy ? 0.6 : 1 }}>
        {busy ? "Generating..." : label || "Generate AI Suggestions"}
      </button>
      <span style={{ fontSize: "11px", color: message.includes("failed") ? "#b42318" : "#386a20" }}>{message || "Uses the current encounter data; review all suggestions before saving."}</span>
    </div>
  );
};

export default AkiAiAssistButton;
