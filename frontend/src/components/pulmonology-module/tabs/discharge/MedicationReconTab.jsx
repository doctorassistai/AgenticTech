import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";
import { tableStyle, thStyle, tdStyle, inputStyle } from "./dispositionHelpers";

export default function MedicationReconTab() {
  const { formData = {}, updateField } = usePulmonology();

  // Structured Discharge Prescriptions Builder
  const rxList = formData.disp_rx_list || [];
  const [newRx, setNewRx] = useState({ drug: "", dose: "", freq: "OD", duration: "7 days", instructions: "" });

  const handleAddRx = () => {
    if (!newRx.drug) return;
    const entry = { ...newRx, id: Date.now().toString() };
    updateField("disp_rx_list", [...rxList, entry]);
    setNewRx({ drug: "", dose: "", freq: "OD", duration: "7 days", instructions: "" });
  };

  const handleDeleteRx = (id) => {
    updateField("disp_rx_list", rxList.filter((item) => item.id !== id));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header Banner */}
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Medication Reconciliation &amp; Prescription Builder
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Itemized take-home prescriptions, steroid weaning schedules, inhaler technique verification, and transition summary.
        </p>
      </div>

      {/* Medication Changes & Transition Summary */}
      <Section title="Medication Changes & Transition Summary" note="Document acute-to-chronic therapy transitions">
        <FormField
          label="MEDICATION RECONCILIATION SUMMARY (Changes from Admission)"
          name="disp_med_changes_summary"
          type="textarea"
          placeholder="e.g. Switched IV hydrocortisone to oral Prednisolone 30mg daily x 5 days with scheduled taper. Added inhaled LABA/LAMA (Tiotropium-Olodaterol). Discontinued NSAIDs..."
        />
      </Section>

      {/* Structured Discharge Prescriptions Table */}
      <Section title="Structured Discharge Prescriptions (Take-Home Medications)" note="Itemized list with dosage, duration, and patient instructions">
        {/* Add New Prescription Row Builder */}
        <div style={{ background: "#f9f9f9", padding: "12px", border: "1px solid #e0e0e0", marginBottom: "14px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#333", marginBottom: "8px" }}>
            Add New Discharge Prescription
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr auto", gap: "10px", alignItems: "end" }}>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>DRUG NAME</label>
              <input
                style={inputStyle}
                value={newRx.drug}
                onChange={(e) => setNewRx({ ...newRx, drug: e.target.value })}
                placeholder="e.g. Prednisolone / Azithromycin"
              />
            </div>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>DOSE</label>
              <input
                style={inputStyle}
                value={newRx.dose}
                onChange={(e) => setNewRx({ ...newRx, dose: e.target.value })}
                placeholder="e.g. 40 mg"
              />
            </div>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>FREQUENCY</label>
              <select
                style={inputStyle}
                value={newRx.freq}
                onChange={(e) => setNewRx({ ...newRx, freq: e.target.value })}
              >
                <option value="OD">Once Daily (OD)</option>
                <option value="BD">Twice Daily (BD)</option>
                <option value="TDS">Three Times Daily (TDS)</option>
                <option value="PRN">As Needed (PRN)</option>
                <option value="QHS">At Bedtime (QHS)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>DURATION</label>
              <input
                style={inputStyle}
                value={newRx.duration}
                onChange={(e) => setNewRx({ ...newRx, duration: e.target.value })}
                placeholder="e.g. 5 days"
              />
            </div>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>SPECIAL INSTRUCTIONS</label>
              <input
                style={inputStyle}
                value={newRx.instructions}
                onChange={(e) => setNewRx({ ...newRx, instructions: e.target.value })}
                placeholder="e.g. Take with food in morning"
              />
            </div>
            <button
              type="button"
              onClick={handleAddRx}
              style={{
                padding: "7px 14px",
                background: "#000",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                height: "30px",
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Prescriptions Table */}
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Medication</th>
              <th style={thStyle}>Dose</th>
              <th style={thStyle}>Frequency</th>
              <th style={thStyle}>Duration</th>
              <th style={thStyle}>Instructions</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rxList.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                  No discharge prescriptions added yet. Use the builder above to itemize take-home medications.
                </td>
              </tr>
            ) : (
              rxList.map((rx) => (
                <tr key={rx.id}>
                  <td style={tdStyle}><b>{rx.drug}</b></td>
                  <td style={tdStyle}>{rx.dose}</td>
                  <td style={tdStyle}>{rx.freq}</td>
                  <td style={tdStyle}>{rx.duration}</td>
                  <td style={tdStyle}>{rx.instructions}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => handleDeleteRx(rx.id)}
                      style={{
                        padding: "2px 6px",
                        fontSize: "11px",
                        background: "#ffebee",
                        color: "#c62828",
                        border: "1px solid #ef9a9a",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Inhaler Technique Verification */}
        <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <FormField
            label="INHALER TECHNIQUE / SPACING DEVICE VERIFIED"
            name="disp_med_teaching_done"
            type="checkbox"
            inlineLabel="Inhaler technique, spacer use, and mouth rinsing verified with patient"
          />
          <FormField
            label="INHALER PROFICIENCY EVALUATION"
            name="disp_med_inhaler_proficiency"
            type="select"
            options={[
              "",
              "Demonstrated Adequate Inhalation Technique",
              "Needs Supervised Caregiver Assistance",
              "Transition to Compressor Nebulizer Preferred",
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
