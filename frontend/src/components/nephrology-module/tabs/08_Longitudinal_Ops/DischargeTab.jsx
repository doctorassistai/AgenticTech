import React, { useState, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import { generateDischargePlan, getDoctorDetails } from "../../services/nephrologyApi";

const DISCHARGE_DICTATION_FIELDS = [
  { k: "v2_dc_status_summary", label: "current kidney status summary", type: "select", options: ["", "Recovered to Baseline", "Partial Recovery", "New Baseline Established", "Dialysis Dependent"] },
  { k: "v2_dc_cr", label: "discharge creatinine", type: "number" },
  { k: "v2_dc_egfr", label: "discharge egfr", type: "number" },
  { k: "v2_dc_electrolytes", label: "electrolytes K HCO3", type: "text" },
  { k: "v2_dc_fluid", label: "fluid status target weight", type: "text" },
  { k: "v2_dc_med_changes", label: "key medication changes", type: "text" },
  { k: "v2_dc_med_avoid", label: "drugs to avoid nephrotoxins", type: "text" },
  { k: "v2_dc_pending_tests", label: "pending tests awaiting results", type: "text" },
  { k: "v2_dc_repeat_labs", label: "repeat laboratory tests needed", type: "text" },
  { k: "v2_dc_followup", label: "follow-up date provider", type: "text" },
  { k: "v2_dc_warnings", label: "warning symptoms return precautions", type: "text" },
];

const DischargeTab = () => {
  const { formData, updateField, updateFields, setSessionStatus, patientId, doctorId } = useNephrology();

  const isDcConsultantRawId = formData.v2_dc_consultant && formData.v2_dc_consultant.startsWith("DOC-");
  const initialName = (!formData.v2_dc_consultant || isDcConsultantRawId) 
    ? (formData.v2_team_neph || formData.v2_dc_consultant || doctorId || "")
    : formData.v2_dc_consultant;

  const [signedConsultant, setSignedConsultant] = useState(initialName);

  useEffect(() => {
    const resolvePhysicianName = async () => {
      const isDcConsultantRawIdEffect = formData.v2_dc_consultant && formData.v2_dc_consultant.startsWith("DOC-");
      let updatedName = (!formData.v2_dc_consultant || isDcConsultantRawIdEffect) 
        ? (formData.v2_team_neph || formData.v2_dc_consultant || doctorId || "")
        : formData.v2_dc_consultant;

      if (updatedName && updatedName.startsWith("DOC-")) {
        try {
          const docRes = await getDoctorDetails(updatedName);
          const profile = docRes?.doctor || docRes?.data || docRes || {};
          const realName = profile.doctor_name || profile.name || profile.full_name || (profile.first_name ? `${profile.first_name} ${profile.last_name}` : null);
          if (realName) {
            updatedName = realName;
          }
        } catch (err) {
          console.warn("Could not fetch doctor details for ID:", updatedName);
        }
      }

      if (updatedName) {
        setSignedConsultant(updatedName);
      }
    };
    resolvePhysicianName();
  }, [formData.v2_dc_consultant, formData.v2_team_neph, doctorId]);

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGeneratePlan = async () => {
    setIsGenerating(true);
    try {
      const response = await generateDischargePlan(formData);
      if (response.status === "success" && response.data) {
        updateFields(response.data);
      }
    } catch (err) {
      console.error("Discharge Plan Generator Failed:", err);
      alert("Failed to generate discharge plan.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDischargePatient = () => {
    if (!signedConsultant) {
      alert("Please provide the Consultant's name before discharging.");
      return;
    }
    setSessionStatus("completed");
    if (!formData.v2_dc_discharged_at) {
      updateField("v2_dc_discharged_at", new Date().toISOString());
    }
    updateField("v2_dc_consultant", signedConsultant);
    alert(`Patient ${patientId || ""} successfully DISCHARGED! Transition plan generated and record locked.`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Kidney Transition Plan Builder" note="Generate a structured, safe transition plan for the patient leaving the hospital.">
        
        <VoiceDictationPanel section="Hospital Discharge" fields={DISCHARGE_DICTATION_FIELDS} />

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
          <button
            onClick={handleGeneratePlan}
            disabled={isGenerating}
            style={{
              background: "#000",
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              fontSize: "12px",
              fontWeight: "bold",
              cursor: isGenerating ? "not-allowed" : "pointer",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            {isGenerating ? "Processing..." : "⚡ Auto-Draft Transition Plan"}
          </button>
        </div>

        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase", borderBottom: "1px solid #e0e0e0", paddingBottom: "8px" }}>
            1. Current Kidney & Fluid Status
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="Current Kidney Status (Summary)" name="v2_dc_status_summary" type="select" options={["", "Recovered to Baseline", "Partial Recovery", "New Baseline Established", "Dialysis Dependent"]} />
            <FormField label="Discharge Creatinine (mg/dL)" name="v2_dc_cr" type="number" />
            <FormField label="Discharge eGFR" name="v2_dc_egfr" type="number" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <FormField label="Electrolytes (K+, HCO3, etc.)" name="v2_dc_electrolytes" type="textarea" placeholder="e.g., K+ stable at 4.2..." />
            <FormField label="Fluid Status / Target Weight" name="v2_dc_fluid" type="textarea" placeholder="e.g., Euvolemic, target weight 72kg..." />
          </div>
        </div>

        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase", borderBottom: "1px solid #e0e0e0", paddingBottom: "8px" }}>
            2. Medication Intelligence
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <FormField label="Key Medication Changes" name="v2_dc_med_changes" type="textarea" placeholder="e.g., Diuretic dose reduced to 20mg daily..." />
            <FormField label="Drugs to Avoid / Review (Nephrotoxins)" name="v2_dc_med_avoid" type="textarea" placeholder="e.g., Avoid NSAIDs, hold ACEi for 1 week..." />
          </div>
        </div>

        <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase", borderBottom: "1px solid #e0e0e0", paddingBottom: "8px" }}>
            3. Follow-up & Diagnostics
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
            <FormField label="Pending Tests (Awaiting Results)" name="v2_dc_pending_tests" type="textarea" placeholder="e.g., Serology panel pending..." />
            <FormField label="Repeat Laboratory Tests Needed" name="v2_dc_repeat_labs" type="textarea" placeholder="e.g., BMP in 3 days..." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <FormField label="Follow-up Date / Provider" name="v2_dc_followup" type="text" placeholder="e.g., Dr. Smith on Aug 28..." />
            <FormField label="Warning Symptoms (Return Precautions)" name="v2_dc_warnings" type="textarea" placeholder="e.g., Return if anuric for 12 hours, severe shortness of breath..." />
          </div>
        </div>

        <div style={{ marginTop: "40px", border: "1px solid #e0e0e0", borderRadius: "4px", overflow: "hidden" }}>
          {/* Black Banner */}
          <div style={{ background: "#000", color: "#fff", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Approvals</span>
            <span style={{ fontSize: "12px", fontWeight: "bold" }}>E-Signature</span>
          </div>

          {/* E-Signature Body */}
          <div style={{ padding: "20px", background: "#fff" }}>
            
            {/* Physician Box */}
            <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "16px", marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", color: "#888", fontWeight: "bold", marginBottom: "8px", textTransform: "uppercase" }}>Physician</label>
              <input 
                type="text" 
                value={signedConsultant} 
                onChange={(e) => setSignedConsultant(e.target.value)} 
                style={{ width: "100%", padding: "10px", border: "1px solid #ddd", fontSize: "13px", marginBottom: "12px", backgroundColor: "#fff" }}
                placeholder="Enter Physician Name..."
              />
              
              <div 
                style={{ 
                  border: "1px dashed #ccc", 
                  padding: "16px", 
                  textAlign: "center", 
                  color: "#aaa", 
                  fontStyle: "italic", 
                  fontSize: "12px",
                  cursor: "pointer",
                  backgroundColor: "#fff"
                }}
                onClick={() => {
                  if(!signedConsultant) alert("Please enter your name first.");
                  else alert("Digital signature captured.");
                }}
              >
                Click to Sign
              </div>
            </div>

            {/* Signature Date */}
            <div style={{ display: "flex", alignItems: "center", marginBottom: "30px" }}>
              <label style={{ width: "150px", fontSize: "12px", fontWeight: "bold", color: "#333" }}>Signature Date</label>
              <input 
                type="date" 
                value={formData.v2_dc_discharged_at ? new Date(formData.v2_dc_discharged_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                onChange={(e) => updateField("v2_dc_discharged_at", new Date(e.target.value).toISOString())}
                style={{ flex: 1, padding: "8px 12px", border: "1px solid #ddd", fontSize: "13px" }}
              />
            </div>

            {/* Save Button */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button 
                onClick={handleDischargePatient}
                style={{ background: "#000", color: "#fff", border: "none", padding: "12px 24px", fontSize: "13px", fontWeight: "bold", cursor: "pointer", minWidth: "250px" }}>
                Save Final Discharge Summary
              </button>
            </div>

          </div>
        </div>

      </Section>
    </div>
  );
};

export default DischargeTab;
