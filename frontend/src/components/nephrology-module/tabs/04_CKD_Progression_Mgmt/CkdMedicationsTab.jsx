import React, { useState } from "react";
import Section from "../../components/Section";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import { generateCkdDrugReview } from "../../services/nephrologyApi";
import CkdEncounterHistory from "../../components/CkdEncounterHistory";

const HistoricallyDiscontinuedMedsTable = ({ historicalSessions = [] }) => {
  const discontinuedMeds = [];
  if (Array.isArray(historicalSessions)) {
    historicalSessions.forEach(session => {
      if (session && session.data?.v2_ckd_meds) {
        session.data.v2_ckd_meds.forEach(med => {
          if (med.action === "Discontinued" || med.action === "Held") {
            const rawDate = session.created_at || session.session_date || session.date;
            const dateStr = rawDate ? new Date(rawDate).toLocaleDateString() : "Prior Session";
            discontinuedMeds.push({
              ...med,
              sessionDate: dateStr,
              sessionTrack: (session.track || "ckd_mgmt").replace(/_/g, " ").toUpperCase()
            });
          }
        });
      }
    });
  }

  if (discontinuedMeds.length === 0) return null;

  return (
    <div style={{ marginBottom: "20px", border: "1px solid #cf1322", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#fff1f0", padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "#a8071a", borderBottom: "1px solid #cf1322" }}>
        ⚠️ Medications Discontinued in Prior Encounters
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.5fr", gap: "8px", padding: "10px 12px", background: "#fafafa", fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600, borderBottom: "1px solid #e0e0e0" }}>
        <span>Drug</span>
        <span>Stopped During</span>
        <span>Date Stopped</span>
        <span>Reason/Alert</span>
      </div>
      {discontinuedMeds.map((med, idx) => (
        <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.5fr", gap: "8px", padding: "8px 12px", background: "#fff", fontSize: "12px", borderBottom: "1px solid #f0f0f0", alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: "#cf1322" }}>{med.drug}</span>
          <span>{med.sessionTrack}</span>
          <span>{med.sessionDate}</span>
          <span style={{ fontStyle: "italic", color: "#666" }}>{med.alert || "Clinical Discontinuation"}</span>
        </div>
      ))}
    </div>
  );
};

const CkdMedicationsTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions } = useNephrology();
  
  // Use V2 formData key for persistence
  const ckdMeds = formData.v2_ckd_meds || [];

  // Local state for the "Add New Drug" form and AI Review
  const [newDrug, setNewDrug] = useState({ drug: "", dose: "", freq: "OD", purpose: "", egfrThreshold: "", recAdjustment: "", action: "Continue" });
  const [isReviewingMeds, setIsReviewingMeds] = useState(false);

  // Voice Dictation Transformer for Medication Reconciliation
  const transformMedicationValues = ({ values = {}, transcript = "" }) => {
    if (!values || typeof values !== "object") return values;
    const updated = { ...values };
    const text = (transcript || "").toLowerCase();

    let currentMeds = [...(formData.v2_ckd_meds || [])];

    // Known drug patterns to match from transcript text
    const drugPatterns = [
      { regex: /losartan\s*(\d+\s*mg)?/i, name: "Losartan", defaultDose: "50mg", freq: "OD", purpose: "Hypertension", egfr: "N/A", rec: "Continue with eGFR monitoring", action: "Continue" },
      { regex: /metformin\s*(\d+\s*mg)?/i, name: "Metformin", defaultDose: "1000mg", freq: "BD", purpose: "Type 2 Diabetes", egfr: "<45 mL/min", rec: "Cap dose at 1000mg/day (hold if eGFR <30)", action: "Dose-Adjusted" },
      { regex: /ibuprofen\s*(\d+\s*mg)?/i, name: "Ibuprofen", defaultDose: "400mg", freq: "BD", purpose: "Pain / Osteoarthritis", egfr: "Contraindicated", rec: "Discontinue immediately. NSAID nephrotoxic in CKD.", action: "Discontinued", alert: "NEPHROTOXIC: NSAID contraindicated in CKD." },
      { regex: /gabapentin\s*(\d+\s*mg)?/i, name: "Gabapentin", defaultDose: "300mg", freq: "TDS", purpose: "Neuropathic Pain", egfr: "<60 mL/min", rec: "Reduce dose by 50% for renal clearance", action: "Dose-Adjusted" },
      { regex: /allopurinol\s*(\d+\s*mg)?/i, name: "Allopurinol", defaultDose: "300mg", freq: "OD", purpose: "Gout / Hyperuricemia", egfr: "<30 mL/min", rec: "Cap at 100mg/day (prevent AHS syndrome)", action: "Dose-Adjusted" },
      { regex: /lisinopril\s*(\d+\s*mg)?/i, name: "Lisinopril", defaultDose: "10mg", freq: "OD", purpose: "Hypertension / Proteinuria", egfr: "N/A", rec: "Continue with Cr/K+ monitoring", action: "Continue" },
      { regex: /dapagliflozin\s*(\d+\s*mg)?/i, name: "Dapagliflozin", defaultDose: "10mg", freq: "OD", purpose: "CKD / Diabetes", egfr: "N/A", rec: "Continue for nephroprotection", action: "Continue" },
      { regex: /empagliflozin\s*(\d+\s*mg)?/i, name: "Empagliflozin", defaultDose: "10mg", freq: "OD", purpose: "CKD / Diabetes", egfr: "N/A", rec: "Continue for nephroprotection", action: "Continue" },
      { regex: /finerenone\s*(\d+\s*mg)?/i, name: "Finerenone", defaultDose: "20mg", freq: "OD", purpose: "CKD / Diabetic Kidney Disease", egfr: "N/A", rec: "Continue with K+ monitoring", action: "Continue" },
      { regex: /atorvastatin\s*(\d+\s*mg)?/i, name: "Atorvastatin", defaultDose: "20mg", freq: "OD", purpose: "Dyslipidemia", egfr: "N/A", rec: "Continue, monitor for muscle symptoms", action: "Continue" },
      { regex: /furosemide\s*(\d+\s*mg)?/i, name: "Furosemide", defaultDose: "40mg", freq: "OD", purpose: "Edema / Volume Control", egfr: "N/A", rec: "Titrate based on fluid status and K+", action: "Continue" }
    ];

    drugPatterns.forEach(pattern => {
      const match = text.match(pattern.regex);
      if (match) {
        let dose = match[1] ? match[1].trim() : pattern.defaultDose;
        if (!currentMeds.some(m => m.drug.toLowerCase() === pattern.name.toLowerCase())) {
          currentMeds.push({
            id: `${Date.now()}_${pattern.name}`,
            drug: pattern.name,
            dose: dose,
            freq: pattern.freq,
            purpose: pattern.purpose,
            egfrThreshold: pattern.egfr,
            recAdjustment: pattern.rec,
            action: pattern.action,
            alert: pattern.alert || null
          });
        }
      }
    });

    updated.v2_ckd_meds = currentMeds;
    return updated;
  };

  const handleActionChange = (id, newAction) => {
    const updated = ckdMeds.map((row) =>
      row.id === id ? { ...row, action: newAction } : row
    );
    updateField("v2_ckd_meds", updated);
  };

  const handleAddMed = () => {
    if (!newDrug.drug) return;
    
    // NSAID check
    const isNsaid = /ibuprofen|diclofenac|naproxen|ketorolac|meloxicam|nsaid/i.test(newDrug.drug);
    
    const newEntry = {
      id: `${Date.now()}`,
      ...newDrug,
      alert: isNsaid ? "NEPHROTOXIC: NSAID contraindicated in CKD." : null,
      action: isNsaid ? "Discontinued" : newDrug.action,
    };
    
    updateField("v2_ckd_meds", [...ckdMeds, newEntry]);
    
    // Reset form
    setNewDrug({ drug: "", dose: "", freq: "OD", purpose: "", egfrThreshold: "", recAdjustment: "", action: "Continue" });
  };

  const handleDeleteMed = (id) => {
    updateField("v2_ckd_meds", ckdMeds.filter((row) => row.id !== id));
  };

  const hasNsaidAlert = ckdMeds.some((m) => /ibuprofen|diclofenac|naproxen|ketorolac|meloxicam|nsaid/i.test(m.drug) && m.action !== "Discontinued");

  const getActionBadgeStyle = (action) => {
    switch (action) {
      case "Continue":
        return { background: "#000000", color: "#ffffff", border: "1px solid #000000" };
      case "Dose-Adjusted":
        return { background: "#f5f5f5", color: "#000000", border: "1px dashed #000000" };
      case "Discontinued":
        return { background: "#fff1f0", color: "#cf1322", border: "1px solid #cf1322" };
      default:
        return { background: "#ffffff", color: "#666666", border: "1px solid #cccccc" };
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: "12px",
    border: "1px solid #ccc",
    borderRadius: "2px",
    boxSizing: "border-box",
    marginTop: "4px"
  };

  const labelStyle = {
    fontSize: "10px", 
    fontWeight: 600, 
    textTransform: "uppercase", 
    color: "#888"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="CKD medication reconciliation and renal dosing" fields={ckdFieldsFor("v2_k_")} transformStructuredValues={transformMedicationValues} />
      
      {/* High-Risk Nephrotoxicity Alert Banner */}
      {hasNsaidAlert && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0", marginBottom: "20px" }}>
          <b>⚠ CRITICAL RENAL CONTRAINDICATION:</b> Active NSAID prescription detected! NSAIDs inhibit vasodilatory prostaglandins, worsening renal hypoperfusion and accelerating progression to dialysis. Please mark as <b>Discontinued</b>.
        </div>
      )}

      {/* <HistoricallyDiscontinuedMedsTable historicalSessions={historicalSessions} /> */}

      <Section title="Active Medication Reconciliation & Renal Dosing" note="Reconcile general home medications and check for renal safety." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.map(({ k }) => k)}>
        <CkdEncounterHistory {...historyProps} section="medication_reconciliation" />
        
        {/* The Dynamic Table */}
        <div style={{ border: "1px solid #e0e0e0", borderRadius: "4px", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 0.9fr 1.2fr 1.2fr 40px", gap: "8px", padding: "10px 12px", background: "#f9f9f9", borderBottom: "1px solid #e0e0e0" }}>
            <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Medication</span>
            <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Dose & Freq</span>
            <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Indication</span>
            <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>eGFR / CrCl</span>
            <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Rec. Adjustment</span>
            <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Action Taken</span>
            <span style={{ textAlign: "center", fontSize: "10px", color: "#666", textTransform: "uppercase", fontWeight: 600 }}>Del</span>
          </div>
          
          {ckdMeds.length > 0 ? (
            ckdMeds.map((row) => (
              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 0.9fr 1.2fr 1.2fr 40px", gap: "8px", padding: "10px 12px", fontSize: "12px", borderBottom: "1px solid #f0f0f0", alignItems: "center", background: row.action === "Discontinued" ? "#fafafa" : "#fff" }}>
                <span style={{ fontWeight: 600, color: row.action === "Discontinued" ? "#888" : "#000" }}>
                  {row.drug}
                  {row.alert && <div style={{ fontSize: "10px", color: "#cf1322", marginTop: "2px", fontWeight: 600 }}>{row.alert}</div>}
                </span>
                <span style={{ color: row.action === "Discontinued" ? "#888" : "#333" }}>{row.dose} {row.freq}</span>
                <span style={{ color: "#555" }}>{row.purpose}</span>
                <span style={{ color: "#555", fontStyle: !row.egfrThreshold ? "italic" : "normal" }}>{row.egfrThreshold || "N/A"}</span>
                <span style={{ color: "#555", fontStyle: !row.recAdjustment ? "italic" : "normal" }}>{row.recAdjustment || "N/A"}</span>
                <select
                  value={row.action}
                  onChange={(e) => handleActionChange(row.id, e.target.value)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    borderRadius: "2px",
                    ...getActionBadgeStyle(row.action),
                  }}
                >
                  <option value="Continue">Continue</option>
                  <option value="Dose-Adjusted">Dose-Adjusted (Renal Cap)</option>
                  <option value="Discontinued">Discontinued</option>
                </select>
                <button
                  onClick={() => handleDeleteMed(row.id)}
                  style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}
                  title="Remove medication"
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <div style={{ padding: "18px 12px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
              No medications recorded for this patient yet. Use the form below to add and reconcile active drugs.
            </div>
          )}
        </div>

        {/* Add New Prescription Form */}
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#666" }}>
            + Add New Drug / Prescription
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>Drug Name</label>
              <input type="text" value={newDrug.drug} onChange={(e) => setNewDrug({ ...newDrug, drug: e.target.value })} placeholder="e.g. Losartan" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Dose</label>
              <input type="text" value={newDrug.dose} onChange={(e) => setNewDrug({ ...newDrug, dose: e.target.value })} placeholder="e.g. 50 mg" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Frequency</label>
              <select value={newDrug.freq} onChange={(e) => setNewDrug({ ...newDrug, freq: e.target.value })} style={inputStyle}>
                <option value="OD">Once Daily (OD)</option>
                <option value="BD">Twice Daily (BD)</option>
                <option value="TDS">Thrice Daily (TDS)</option>
                <option value="HS">At Bedtime (HS)</option>
                <option value="PRN">As Needed (PRN)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Indication</label>
              <input type="text" value={newDrug.purpose} onChange={(e) => setNewDrug({ ...newDrug, purpose: e.target.value })} placeholder="e.g. HTN" style={inputStyle} />
            </div>
            <div style={{ marginTop: "4px" }}>
              <label style={labelStyle}>eGFR/CrCl Threshold</label>
              <input type="text" value={newDrug.egfrThreshold} onChange={(e) => setNewDrug({ ...newDrug, egfrThreshold: e.target.value })} placeholder="e.g. <30" style={inputStyle} />
            </div>
            <div style={{ gridColumn: "span 2", marginTop: "4px" }}>
              <label style={labelStyle}>Recommended Adjustment</label>
              <input type="text" value={newDrug.recAdjustment} onChange={(e) => setNewDrug({ ...newDrug, recAdjustment: e.target.value })} placeholder="e.g. Decrease dose by 50%" style={inputStyle} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
              <button
                onClick={handleAddMed}
                style={{ padding: "7px 16px", background: "#000", color: "#fff", border: "1px solid #000", fontSize: "12px", fontWeight: 600, cursor: "pointer", borderRadius: "2px", width: "100%" }}
              >
                Add Prescription
              </button>
            </div>
          </div>
        </div>

      </Section>
    </div>
  );
};

export default CkdMedicationsTab;
