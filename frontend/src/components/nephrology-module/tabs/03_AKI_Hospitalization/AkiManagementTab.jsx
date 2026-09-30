import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import AkiAiAssistButton from "../../components/AkiAiAssistButton";
import AkiEncounterHistory from "../../components/AkiEncounterHistory";

const AkiManagementTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();

  const activeBundle = formData.v2_aki_bundle || "Not yet determined";
  const kdigoStage = formData.v2_aki_kdigo || "Not yet staged";
  const nephrotoxinRows = formData.v2_aki_nephrotoxin_list || [];
  const nephrotoxinActions = formData.v2_aki_nephrotoxin_actions || {};
  const rrtIndication = formData.v2_aki_bundle_rrt || "";
  const rrtFlagged = rrtIndication && rrtIndication !== "None";

  const setDrugAction = (id, value) => {
    updateField("v2_aki_nephrotoxin_actions", { ...nephrotoxinActions, [id]: value });
  };

  const actionSelectStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: "12px",
    border: "1px solid #ccc",
    borderRadius: "2px",
    boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="AKI management and intervention response" fields={[
        { k: "v2_aki_bundle_ivf", label: "IV fluid resuscitation", type: "select", options: ["Hold", "Isotonic Saline", "Lactated Ringers", "Plasmalyte", "Albumin"] },
        { k: "v2_aki_bundle_diuretic", label: "diuretic trial", type: "select", options: ["Hold", "Furosemide IV Push", "Furosemide Drip", "Bumetanide IV"] },
        { k: "v2_aki_bundle_rrt", label: "RRT indication", type: "select", options: ["None", "Acidosis", "Electrolyte (K+)", "Ingestion", "Overload (Fluid)", "Uremia"] },
        { k: "v2_aki_response_uo", label: "urine output response", type: "select", options: ["Improved", "Unchanged", "Worsened"] },
        { k: "v2_aki_response_cr", label: "repeat creatinine", type: "number" },
        { k: "v2_aki_response_notes", label: "clinical response notes", type: "textarea" },
        { k: "v2_aki_rrt_modality", label: "RRT modality", type: "select", options: ["Intermittent Hemodialysis (iHD)", "Continuous RRT (CRRT)", "Peritoneal Dialysis", "SLED"] },
        { k: "v2_aki_rrt_urgency", label: "RRT urgency", type: "select", options: ["Emergent (life-threatening)", "Urgent (within 24h)", "Elective"] },
        { k: "v2_aki_rrt_access", label: "RRT access type", type: "select", options: ["Temporary Dialysis Catheter", "Existing Fistula/Graft", "PD Catheter"] },
        { k: "v2_aki_rrt_signoff", label: "nephrology RRT sign-off", type: "select", options: ["Pending", "Approved", "Deferred - Continue Medical Management"] },
        { k: "v2_aki_rrt_notes", label: "RRT notes", type: "textarea" },
        { k: "v2_aki_dose_adjustment", label: "renal dose adjustment notes", type: "textarea" },
        { k: "v2_aki_electrolyte_orders", label: "electrolyte binders or additional orders", type: "textarea" },
      ]} />
      <div style={{ padding: "14px 16px", background: "#f4f4f4", border: "1px solid #ddd", borderRadius: "4px", fontSize: "12px", color: "#444" }}>
        <strong>Context from Classification / Cause Engine:</strong> KDIGO Stage — {kdigoStage} &nbsp;|&nbsp; Active Bundle — {activeBundle}
      </div>

      <Section title="Acute Interventions & Fluids" note="Guideline-directed medical management of AKI.">
        <AkiEncounterHistory {...historyProps} section="management_interventions" />
        <div style={{ marginBottom: "16px", display: "flex", justifyContent: "flex-end" }}>
          <AkiAiAssistButton section="management_interventions" variant="inline" label="Generate Interventions" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px" }}>
          <FormField
            label="IV Fluid Resuscitation"
            name="v2_aki_bundle_ivf"
            type="select"
            options={["", "Hold", "Isotonic Saline", "Lactated Ringers", "Plasmalyte", "Albumin"]}
          />
          <FormField
            label="Diuretic Trial"
            name="v2_aki_bundle_diuretic"
            type="select"
            options={["", "Hold", "Furosemide IV Push", "Furosemide Drip", "Bumetanide IV"]}
          />
          <FormField
            label="RRT Indication Check (AEIOU)"
            name="v2_aki_bundle_rrt"
            type="select"
            options={["", "None", "Acidosis", "Electrolyte (K+)", "Ingestion", "Overload (Fluid)", "Uremia"]}
          />
        </div>
      </Section>

      <Section title="Response to Intervention" note="Record the outcome of the fluid/diuretic trial and any repeat labs.">
        <AkiEncounterHistory {...historyProps} section="management_response" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px" }}>
          <FormField
            label="Urine Output Response"
            name="v2_aki_response_uo"
            type="select"
            options={["", "Improved", "Unchanged", "Worsened"]}
          />
          <FormField label="Repeat Creatinine (post-intervention)" name="v2_aki_response_cr" type="number" />
          <div style={{ gridColumn: "span 2" }}>
            <FormField
              label="Clinical Response Notes"
              name="v2_aki_response_notes"
              type="textarea"
              placeholder="e.g. Urine output rose to 40 mL/hr within 6h of fluid bolus; diuretic trial failed, escalating to RRT workup..."
            />
          </div>
        </div>
      </Section>

      {rrtFlagged && (
        <Section title="RRT Initiation Details" note="Complete when an AEIOU indication is present.">
          <AkiEncounterHistory {...historyProps} section="management_rrt" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px" }}>
            <FormField
              label="Modality"
              name="v2_aki_rrt_modality"
              type="select"
              options={["", "Intermittent Hemodialysis (iHD)", "Continuous RRT (CRRT)", "Peritoneal Dialysis", "SLED"]}
            />
            <FormField
              label="Urgency"
              name="v2_aki_rrt_urgency"
              type="select"
              options={["", "Emergent (life-threatening)", "Urgent (within 24h)", "Elective"]}
            />
            <FormField
              label="Access Type"
              name="v2_aki_rrt_access"
              type="select"
              options={["", "Temporary Dialysis Catheter", "Existing Fistula/Graft", "PD Catheter"]}
            />
            <FormField
              label="Nephrology Sign-off"
              name="v2_aki_rrt_signoff"
              type="select"
              options={["", "Pending", "Approved", "Deferred - Continue Medical Management"]}
            />
            <div style={{ gridColumn: "span 2" }}>
              <FormField
                label="RRT Notes"
                name="v2_aki_rrt_notes"
                type="textarea"
                placeholder="e.g. K+ 6.8 refractory to medical therapy, emergent iHD initiated via temp catheter..."
              />
            </div>
          </div>
        </Section>
      )}

      <Section title="Medication Management" note="Actions taken on medications identified during etiology workup.">
        <AkiEncounterHistory {...historyProps} section="management_medications" />
        <div style={{ marginBottom: "16px", display: "flex", justifyContent: "flex-end" }}>
          <AkiAiAssistButton section="management_meds" variant="inline" label="Generate Dose Adjustments & Electrolytes" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          {nephrotoxinRows.length > 0 ? (
            <div style={{ border: "1px solid #e0e0e0", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 0.9fr 1.2fr 1.6fr 1.4fr", gap: "8px", padding: "10px 12px", background: "#f9f9f9", borderBottom: "1px solid #e0e0e0" }}>
                <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Drug</span>
                <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Current Dose</span>
                <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>eGFR / CrCl</span>
                <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Dose Status</span>
                <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Recommended Adjustment</span>
                <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase" }}>Action Taken</span>
              </div>
              {nephrotoxinRows.map((row) => (
                <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 0.9fr 1.2fr 1.6fr 1.4fr", gap: "8px", padding: "10px 12px", fontSize: "12px", borderBottom: "1px solid #f0f0f0", alignItems: "center" }}>
                  <span>{row.drugName || "—"}</span>
                  <span>{row.currentDose || "—"}</span>
                  <span>{row.currentRenalFn || "—"}</span>
                  <span>{row.doseStatus === "Fixed" ? "Fixed" : row.doseStatus === "Modified" ? "Modified" : "—"}</span>
                  <span>{row.doseStatus === "Fixed" ? "N/A" : (row.recommendedAdjustment || "—")}</span>
                  <select
                    style={actionSelectStyle}
                    value={nephrotoxinActions[row.id] || ""}
                    onChange={(e) => setDrugAction(row.id, e.target.value)}
                  >
                    <option value="">Pending Review</option>
                    <option value="Held">Held</option>
                    <option value="Continued - Risk/Benefit Discussed">Continued - Risk/Benefit Discussed</option>
                    <option value="Dose Adjusted Per Recommendation">Dose Adjusted Per Recommendation</option>
                    <option value="Adjusted - Clinician Override">Adjusted - Clinician Override</option>
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "12px", background: "#f9f9f9", border: "1px dashed #ccc", borderRadius: "4px", fontSize: "12px", color: "#888", fontStyle: "italic" }}>
              No nephrotoxins flagged yet in the Cause Engine tab.
            </div>
          )}
          <FormField
            label="Renal Dose Adjustment Notes"
            name="v2_aki_dose_adjustment"
            type="textarea"
            placeholder="e.g. Vancomycin dosed by trough per pharmacy protocol; ACE inhibitor held pending recovery..."
          />
          <FormField
            label="Electrolyte Binders / Additional Orders"
            name="v2_aki_electrolyte_orders"
            type="textarea"
            placeholder="e.g. Sodium zirconium cyclosilicate for hyperkalemia, sevelamer for phosphate..."
          />
        </div>
      </Section>
    </div>
  );
};

export default AkiManagementTab;
