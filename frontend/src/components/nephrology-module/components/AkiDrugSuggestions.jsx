import React, { useState } from "react";
import { useNephrology } from "../context/NephrologyContext";
import { generateAkiDrugReview } from "../services/nephrologyApi";

const AkiDrugSuggestions = () => {
  const { formData, updateField, sessionStatus } = useNephrology();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const suggest = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await generateAkiDrugReview(formData);
      const suggestions = result?.data?.v2_aki_nephrotoxin_list || [];
      const existing = formData.v2_aki_nephrotoxin_list || [];
      const existingNames = new Set(existing.map((row) => String(row.drugName || "").trim().toLowerCase()).filter(Boolean));
      const additions = suggestions.filter((row) => !existingNames.has(String(row.drugName || "").trim().toLowerCase()));
      if (additions.length) updateField("v2_aki_nephrotoxin_list", [...existing, ...additions]);
      setMessage(additions.length ? `${additions.length} medication review suggestion${additions.length === 1 ? "" : "s"} added. Verify before saving.` : suggestions.length ? "Suggested medications are already listed." : "No documented medication exposure needs review.");
    } catch (error) {
      setMessage(error.message || "Drug suggestion generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = sessionStatus === "completed" || busy;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
      <button type="button" onClick={suggest} disabled={disabled} style={{ padding: "6px 12px", border: "1px solid #000", background: "#fff", color: "#000", fontSize: "11.5px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}>
        {busy ? "Reviewing..." : "Suggest Drugs to Review"}
      </button>
      <span style={{ fontSize: "11px", color: message.includes("failed") ? "#b42318" : "#386a20" }}>{message || "Uses documented medications and kidney data only."}</span>
    </div>
  );
};

export default AkiDrugSuggestions;
