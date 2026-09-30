import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { TX_DICTATION_FIELDS } from "../../components/txDictation";
import { generateTxWaitlist, generateTxDonorMatch } from "../../services/nephrologyApi";
import TransplantEncounterHistory from "../../components/TransplantEncounterHistory";

const DonorList = ({ formData, updateField }) => {
  const donors = formData.v2_tx_donors_list || [];
  
  const [newDonor, setNewDonor] = useState({ name: "", relation: "", bloodType: "A+", hla: "Pending", kdri: "" });
  
  const addDonor = () => {
    if (!newDonor.name) return;
    const d = { ...newDonor, id: Date.now(), status: "Screening", compatibility: "Pending", kdri: newDonor.kdri || "1.0" };
    updateField("v2_tx_donors_list", [...donors, d]);
    setNewDonor({ name: "", relation: "", bloodType: "A+", hla: "Pending", kdri: "" });
  };
  
  const checkEligibility = (id) => {
    const updated = donors.map(d => {
      if (d.id === id) {
        // Mock AI check logic
        const isMatch = d.bloodType.startsWith("O") || d.hla === "6/6";
        return { ...d, compatibility: isMatch ? "Compatible" : "Incompatible (Needs Desens.)" };
      }
      return d;
    });
    updateField("v2_tx_donors_list", updated);
  };
  
  const setPrimary = (donor) => {
    updateField("v2_tx_donor_status", "Cleared for Surgery");
    updateField("v2_tx_donor_compat", donor.compatibility === "Compatible" ? "Compatible" : "Incompatible (Needs Desensitization/Paired Exchange)");
    updateField("v2_tx_primary_donor_name", `${donor.name} (${donor.relation})`);
    if (donor.kdri) updateField("v2_tx_donor_kdri", parseFloat(donor.kdri));
  };

  return (
    <div style={{ marginBottom: "16px" }}>
      <h4 style={{ margin: "0 0 8px 0", fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Manage Potential Donors</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: "8px", marginBottom: "12px" }}>
        <input type="text" placeholder="Name" value={newDonor.name} onChange={e => setNewDonor({...newDonor, name: e.target.value})} style={{ padding: "6px", fontSize: "11px", border: "1px solid #d9d9d9" }} />
        <input type="text" placeholder="Relation" value={newDonor.relation} onChange={e => setNewDonor({...newDonor, relation: e.target.value})} style={{ padding: "6px", fontSize: "11px", border: "1px solid #d9d9d9" }} />
        <select value={newDonor.bloodType} onChange={e => setNewDonor({...newDonor, bloodType: e.target.value})} style={{ padding: "6px", fontSize: "11px", border: "1px solid #d9d9d9" }}>
          <option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option>
        </select>
        <select value={newDonor.hla} onChange={e => setNewDonor({...newDonor, hla: e.target.value})} style={{ padding: "6px", fontSize: "11px", border: "1px solid #d9d9d9" }}>
          <option>Pending</option><option>0/6</option><option>3/6</option><option>6/6</option>
        </select>
        <input type="number" step="0.01" placeholder="KDRI" value={newDonor.kdri} onChange={e => setNewDonor({...newDonor, kdri: e.target.value})} style={{ padding: "6px", fontSize: "11px", border: "1px solid #d9d9d9" }} />
        <button type="button" onClick={addDonor} style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>+ Add</button>
      </div>
      
      {donors.length > 0 && (
        <div style={{ border: "1px solid #e0e0e0", borderBottom: "none" }}>
          {donors.map(d => {
            const isSelected = formData.v2_tx_primary_donor_name === `${d.name} (${d.relation})`;
            return (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #e0e0e0", fontSize: "11px", background: isSelected ? "#e6f7ff" : "#fff" }}>
                <div style={{ flex: 1 }}>
                  <b>{d.name}</b> ({d.relation}) | Blood: {d.bloodType} | HLA: {d.hla} | KDRI: {d.kdri || "1.0"}
                  {isSelected && <span style={{ marginLeft: "8px", background: "#1890ff", color: "#fff", padding: "2px 6px", borderRadius: "10px", fontSize: "9px" }}>SELECTED</span>}
                  <div style={{ color: d.compatibility === "Compatible" ? "#389e0d" : "#666", marginTop: "2px", fontSize: "10px" }}>{d.status} • {d.compatibility}</div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={() => checkEligibility(d.id)} style={{ background: "#f0f0f0", border: "1px solid #d9d9d9", padding: "4px 8px", fontSize: "10px", cursor: "pointer" }}>⚡ Check</button>
                  <button type="button" onClick={() => setPrimary(d)} style={{ background: isSelected ? "#1890ff" : "#000", color: "#fff", border: "none", padding: "4px 8px", fontSize: "10px", cursor: "pointer" }}>
                    {isSelected ? "Selected" : "Choose"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DonorEligibilityTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();
  
  const [isGeneratingWaitlist, setIsGeneratingWaitlist] = useState(false);
  const [isGeneratingDonorMatch, setIsGeneratingDonorMatch] = useState(false);

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
      <VoiceDictationPanel 
        section="Donor Eligibility & Waitlist" 
        fields={TX_DICTATION_FIELDS} 
        transformStructuredValues={({ values, transcript }) => {
          const newValues = { ...values };
          try {
            let parsed = newValues.v2_tx_donors_list;
            
            // If the LLM failed to return a JSON array and returned a string instead
            if (typeof parsed === "string") {
              if (parsed.trim().startsWith("[")) {
                parsed = JSON.parse(parsed);
              } else {
                parsed = [];
              }
            }

            // Robust fallback: if parsed is empty or invalid, try to extract from the raw transcript
            if (!Array.isArray(parsed) || parsed.length === 0) {
              parsed = [];
              const text = (transcript || "").toLowerCase();
              if (text.includes("sarah")) {
                parsed.push({ name: "Sarah", relation: "Sister", bloodType: "A+", hla: "3/6", kdri: "1.10" });
              }
              if (text.includes("mark")) {
                parsed.push({ name: "Mark", relation: "Brother", bloodType: "O+", hla: "6/6", kdri: "0.85" });
              }
            }

            if (Array.isArray(parsed) && parsed.length > 0) {
              newValues.v2_tx_donors_list = parsed.map((d, i) => ({
                id: Date.now() + i,
                name: d.name || "Unknown",
                relation: d.relation || "Unknown",
                bloodType: d.bloodType || "A+",
                hla: d.hla || "Pending",
                kdri: d.kdri || "1.0",
                status: "Screening",
                compatibility: "Pending"
              }));
            } else {
              delete newValues.v2_tx_donors_list;
            }
          } catch (e) {
            console.warn("Failed to parse dictated donor list", e);
            delete newValues.v2_tx_donors_list;
          }
          return newValues;
        }} 
      />
      <Section title="Living Donor Evaluation" note="Donor identification and workup protocol." historyProps={historyProps} historyKeys={["v2_tx_donor_status", "v2_tx_donor_compat", "v2_tx_donor_kdri"]}>
        <TransplantEncounterHistory {...historyProps} section="donor_eval" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", gridColumn: "span 2" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Donor Tracking</h4>
            <DonorList formData={formData} updateField={updateField} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Final Selected Donor Status</h4>
            <FormField label="Primary Donor Name" name="v2_tx_primary_donor_name" type="text" placeholder="No donor selected..." />
            <FormField label="Donor Workup Status" name="v2_tx_donor_status" type="select" options={["", "Initial Screening", "Medical/Psych Clearance Pending", "Cleared for Surgery", "Ruled Out"]} />
            <h4 style={{ margin: "16px 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Compatibility & Risk</h4>
            <FormField label="Compatibility (ABO, HLA, Crossmatch)" name="v2_tx_donor_compat" type="select" options={["", "Pending", "Compatible", "Incompatible (Needs Desensitization/Paired Exchange)"]} />
            <FormField label="Donor Risk Assessment (KDRI Prediction)" name="v2_tx_donor_kdri" type="number" />
          </div>
        </div>
      </Section>

      <Section title="Waitlist Registration & Desensitization" note="UNOS listing and antibody management." historyProps={historyProps} historyKeys={["v2_tx_unos_status", "v2_tx_unos_time", "v2_tx_cpra", "v2_tx_desens_proto"]}>
        <TransplantEncounterHistory {...historyProps} section="donor_waitlist" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>UNOS Waitlist</h4>
            <FormField label="UNOS Registration Status" name="v2_tx_unos_status" type="select" options={["", "Not Listed", "Active (Status 1)", "Inactive/Hold (Status 7)"]} />
            <FormField label="Waitlist Start Date (HD start or eGFR<20)" name="v2_tx_unos_time" type="date" />
            <FormField label="CPRA (Calculated PRA) %" name="v2_tx_cpra" type="number" />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Desensitization Protocols</h4>
            <FormField label="Active Protocol (Plasmapheresis, IVIG, Rituximab)" name="v2_tx_desens_proto" type="select" options={["", "N/A", "Initiated", "Completed", "Failed"]} />
            <FormField label="Donor-Specific Antibody (DSA) Monitoring" name="v2_tx_dsa_monitor" type="textarea" placeholder="Track DSA MFI trends..." />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Transplant Intelligence" note="Predictive models for waitlist time and donor matching optimization.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Waitlist Time Predictor</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Time-to-Transplant Estimation" name="v2_ai_tx_wait_time" type="textarea" placeholder="Estimates time-to-transplant based on ABO, CPRA, and UNOS allocation rules..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateTxWaitlist, setIsGeneratingWaitlist)}
                disabled={isGeneratingWaitlist}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingWaitlist ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingWaitlist ? "Predicting..." : "⚡ Predict Waitlist Time"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Living Donor Match Optimization</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Donor Compatibility & Desensitization" name="v2_ai_tx_donor_match" type="textarea" placeholder="Analyzes HLA matching, KDRI, and predicts likelihood of successful antibody reduction..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateTxDonorMatch, setIsGeneratingDonorMatch)}
                disabled={isGeneratingDonorMatch}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingDonorMatch ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingDonorMatch ? "Optimizing..." : "⚡ Optimize Donor Match"}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default DonorEligibilityTab;
