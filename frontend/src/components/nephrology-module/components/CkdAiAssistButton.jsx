import React, { useState } from "react";
import { useNephrology } from "../context/NephrologyContext";
import { generateCkdAiAssist } from "../services/nephrologyApi";
const CkdAiAssistButton = () => {
  const { formData, setFormData, sessionStatus } = useNephrology(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const generate = async () => { setBusy(true); setMessage(""); try { const result = await generateCkdAiAssist(formData); const values = result?.data || {}; const applicable = Object.fromEntries(Object.entries(values).filter(([k]) => formData[k] === undefined || formData[k] === "")); setFormData(p => ({ ...p, ...applicable, v2_ckd_ai_model: result.model || "", v2_ckd_ai_generated_at: new Date().toISOString(), v2_ckd_ai_fields: Object.keys(applicable) })); setMessage(`${Object.keys(applicable).length} CKD AI suggestion${Object.keys(applicable).length === 1 ? "" : "s"} added. Verify before saving.`); } catch (e) { setMessage(e.message || "CKD AI suggestion generation failed."); } finally { setBusy(false); } };
  return <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid #d9d9d9", background: "#fafafa", marginBottom: 20 }}><button type="button" onClick={generate} disabled={sessionStatus === "completed" || busy} style={{ border: "1px solid #000", background: "#000", color: "#fff", padding: "7px 12px" }}>{busy ? "Generating..." : "Generate CKD AI Suggestions"}</button><span style={{ fontSize: 11, color: message.includes("failed") ? "#b42318" : "#386a20" }}>{message || "Uses documented CKD data; review before saving."}</span></div>;
};
export default CkdAiAssistButton;
