import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import AkiAiAssistButton from "../../components/AkiAiAssistButton";
import AkiDrugSuggestions from "../../components/AkiDrugSuggestions";
import AkiEncounterHistory from "../../components/AkiEncounterHistory";

const AKI_DRUG_OPTIONS = [
  "Ibuprofen",
  "Diclofenac",
  "Naproxen",
  "Ketorolac",
  "Meloxicam",
  "Celecoxib",
  "Vancomycin",
  "Gentamicin",
  "Amikacin",
  "Tobramycin",
  "Amphotericin B",
  "Acyclovir",
  "Tenofovir",
  "Cisplatin",
  "Methotrexate",
  "Tacrolimus",
  "Cyclosporine",
  "Lisinopril",
  "Enalapril",
  "Ramipril",
  "Losartan",
  "Telmisartan",
  "Valsartan",
  "Furosemide",
  "Spironolactone",
  "Metformin",
  "Iodinated contrast media",
];

const CauseEngineTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();
  const selectedCauses = formData.v2_aki_causes || {};
  const nephrotoxinRows = formData.v2_aki_nephrotoxin_list || [];

  const handleToggle = (cause) => {
    const updated = { ...selectedCauses, [cause]: !selectedCauses[cause] };
    updateField("v2_aki_causes", updated);
  };

  const addNephrotoxinRow = () => {
    const newRow = {
      id: `${Date.now()}`,
      drugName: "",
      currentDose: "",
      currentRenalFn: "",
      doseStatus: "",
      recommendedAdjustment: "",
    };
    updateField("v2_aki_nephrotoxin_list", [...nephrotoxinRows, newRow]);
  };

  const updateNephrotoxinRow = (id, field, value) => {
    const updated = nephrotoxinRows.map((row) =>
      row.id === id ? { ...row, [field]: value } : row
    );
    updateField("v2_aki_nephrotoxin_list", updated);
  };

  const removeNephrotoxinRow = (id) => {
    updateField("v2_aki_nephrotoxin_list", nephrotoxinRows.filter((row) => row.id !== id));
  };

  const rowInputStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: "12px",
    border: "1px solid #ccc",
    borderRadius: "2px",
    boxSizing: "border-box",
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

  const PRE_RENAL = ["Dehydration", "Blood loss", "Sepsis", "Low blood pressure", "Heart failure", "Reduced effective circulating volume"];
  const INTRINSIC = ["Acute tubular injury", "Glomerulonephritis", "Interstitial nephritis", "Vasculitis", "Thrombotic microangiopathy"];
  const POST_RENAL = ["Stone", "Prostate obstruction", "Tumor", "Hydronephrosis", "Urinary obstruction"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="AKI cause and nephrotoxin review" fields={[
        { k: "v2_aki_causes", label: "possible AKI causes", type: "checks", options: [...PRE_RENAL, ...INTRINSIC, ...POST_RENAL] },
        { k: "v2_aki_ai_cause", label: "predicted etiology", type: "select", options: ["Pre-renal (High Prob)", "Intrinsic: ATN (High Prob)", "Intrinsic: GN/AIN/Vascular", "Post-renal (High Prob)"] },
        { k: "v2_aki_ai_features", label: "key discriminating features", type: "textarea" },
        { k: "v2_aki_bundle", label: "activated order set bundle", type: "select", options: ["Pre-renal Bundle (IV fluids, hold diuretics/RAAS)", "ATN Bundle (Nephrotoxin review, fluid balance)", "GN Bundle (Urgent consult, serologies, biopsy)", "Post-renal Bundle (Foley, ultrasound, urology)"] },
        { k: "v2_aki_nephrotoxin_list", label: "nephrotoxin medication audit", type: "array", subFields: [
          { k: "drugName", l: "drug name", t: "text" },
          { k: "currentDose", l: "current dose", t: "text" },
          { k: "currentRenalFn", l: "current eGFR or creatinine clearance", t: "text" },
          { k: "doseStatus", l: "dose status", t: "text", o: ["Fixed", "Modified"] },
          { k: "recommendedAdjustment", l: "recommended adjustment", t: "text" },
        ] },
      ]} transformStructuredValues={({ values }) => {
        const next = { ...values };
        if (Array.isArray(next.v2_aki_causes)) {
          next.v2_aki_causes = Object.fromEntries(next.v2_aki_causes.map((cause) => [cause, true]));
        }
        if (Array.isArray(next.v2_aki_nephrotoxin_list)) {
          next.v2_aki_nephrotoxin_list = next.v2_aki_nephrotoxin_list.map((row, index) => ({
            id: `dictated-${Date.now()}-${index}`,
            drugName: row.drugName || "",
            currentDose: row.currentDose || "",
            currentRenalFn: row.currentRenalFn || "",
            doseStatus: row.doseStatus || "",
            recommendedAdjustment: row.recommendedAdjustment || "",
          }));
        }
        return next;
      }} />
      <Section title="Etiology Classification Tool" note="Instead of simply saying 'AKI present', organize possible causes.">
        <AkiEncounterHistory {...historyProps} section="cause_etiology" />
        
        <h4 style={{ marginBottom: "8px", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Pre-Renal (FENa &lt;1%, BUN/Cr &gt;20)</h4>
        <div style={{ marginBottom: "16px" }}>
          {PRE_RENAL.map(c => <div key={c} style={toggleStyle(selectedCauses[c])} onClick={() => handleToggle(c)}>{selectedCauses[c] ? "✓ " : "+ "}{c}</div>)}
        </div>

        <h4 style={{ marginBottom: "8px", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Intrinsic Renal (Muddy brown casts, WBC casts, meds)</h4>
        <div style={{ marginBottom: "16px" }}>
          {INTRINSIC.map(c => <div key={c} style={toggleStyle(selectedCauses[c])} onClick={() => handleToggle(c)}>{selectedCauses[c] ? "✓ " : "+ "}{c}</div>)}
        </div>

        <h4 style={{ marginBottom: "8px", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Post-Renal (Anuria, Bladder scan &gt;300 mL)</h4>
        <div style={{ marginBottom: "16px" }}>
          {POST_RENAL.map(c => <div key={c} style={toggleStyle(selectedCauses[c])} onClick={() => handleToggle(c)}>{selectedCauses[c] ? "✓ " : "+ "}{c}</div>)}
        </div>
        
        <div style={{ marginTop: "16px", padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Multimodal AI Etiology Classifier</h4>
              <p style={{ margin: "0", fontSize: "12px", color: "#666" }}>
                AI analyzes the nephrotoxin audit and selected causes to predict etiology and recommend an order set bundle.
              </p>
            </div>
            <AkiAiAssistButton section="cause" variant="inline" label="Run AI Etiology & Bundle Generator" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <FormField label="Predicted Etiology (Structured Data + NLP)" name="v2_aki_ai_cause" type="select" options={["", "Pre-renal (High Prob)", "Intrinsic: ATN (High Prob)", "Intrinsic: GN/AIN/Vascular", "Post-renal (High Prob)"]} />
            <FormField label="Key Discriminating Features" name="v2_aki_ai_features" type="textarea" placeholder="e.g., NLP flagged 'muddy brown casts' in recent note + FENa > 2%..." />
          </div>
        </div>
      </Section>

      <Section title="AKI Management Bundle & Nephrotoxin Audit" note="Automated order sets based on etiology and automated medication review.">
        <AkiEncounterHistory {...historyProps} section="cause_drugs" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <FormField label="Activated Order Set Bundle" name="v2_aki_bundle" type="select" options={[
            "", 
            "Pre-renal Bundle (IV fluids, hold diuretics/RAAS)", 
            "ATN Bundle (Nephrotoxin review, fluid balance)", 
            "GN Bundle (Urgent consult, serologies, biopsy)", 
            "Post-renal Bundle (Foley, ultrasound, urology)"
          ]} />
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Nephrotoxin Audit</h4>
            <p style={{ margin: "0 0 12px 0", fontSize: "11px", color: "#888", fontStyle: "italic" }}>
              Identify each drug and its recommended adjustment here. Whether it was actually held, continued, or dose-reduced is recorded in the AKI Management tab.
            </p>

            <button
              type="button"
              onClick={addNephrotoxinRow}
              style={{ marginBottom: "12px", padding: "6px 12px", fontSize: "11.5px", fontWeight: "500", border: "1px solid #000", background: "#fff", color: "#000", borderRadius: "2px", cursor: "pointer" }}
            >
              + Add Drug
            </button>
            <AkiDrugSuggestions />

            {nephrotoxinRows.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 0.9fr 1.2fr 1.6fr 32px", gap: "8px", marginBottom: "6px" }}>
                <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase" }}>Drug</span>
                <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase" }}>Current Dose</span>
                <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase" }}>eGFR / CrCl</span>
                <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase" }}>Dose Status</span>
                <span style={{ fontSize: "10px", color: "#888", textTransform: "uppercase" }}>Recommended Adjustment</span>
                <span />
              </div>
            )}

            {nephrotoxinRows.map((row) => {
              const isModified = row.doseStatus === "Modified";
              return (
                <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 0.9fr 1.2fr 1.6fr 32px", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                  <div>
                    <input
                      list={`drug-options-${row.id}`}
                      style={{ ...rowInputStyle, background: "#ffffff", border: "1px solid #777777", color: "#111111", fontWeight: 500 }}
                      placeholder="Type or select drug"
                      value={row.drugName}
                      onChange={(e) => updateNephrotoxinRow(row.id, "drugName", e.target.value)}
                    />
                    <datalist id={`drug-options-${row.id}`}>
                      {AKI_DRUG_OPTIONS.map((drug) => <option key={drug} value={drug} />)}
                    </datalist>
                  </div>
                  <input
                    style={rowInputStyle}
                    placeholder="e.g. 1g IV q12h"
                    value={row.currentDose}
                    onChange={(e) => updateNephrotoxinRow(row.id, "currentDose", e.target.value)}
                  />
                  <input
                    style={rowInputStyle}
                    placeholder="e.g. 22 mL/min"
                    value={row.currentRenalFn}
                    onChange={(e) => updateNephrotoxinRow(row.id, "currentRenalFn", e.target.value)}
                  />
                  <select
                    style={rowInputStyle}
                    value={row.doseStatus}
                    onChange={(e) => updateNephrotoxinRow(row.id, "doseStatus", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="Fixed">Fixed - No Adjustment Needed</option>
                    <option value="Modified">Modified - Adjustment Needed</option>
                  </select>
                  <input
                    style={{ ...rowInputStyle, opacity: isModified ? 1 : 0.5 }}
                    placeholder={isModified ? "e.g. 15-20 mcg/mL trough, extend interval to q24h" : "N/A"}
                    value={row.recommendedAdjustment}
                    disabled={!isModified}
                    onChange={(e) => updateNephrotoxinRow(row.id, "recommendedAdjustment", e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeNephrotoxinRow(row.id)}
                    style={{ border: "1px solid #ccc", background: "#fff", borderRadius: "2px", cursor: "pointer", fontSize: "12px", padding: "4px 0", color: "#888" }}
                    aria-label="Remove drug"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </Section>
    </div>
  );
};

export default CauseEngineTab;
