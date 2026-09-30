import React, { useState, useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

// --- Shared Styles ---
const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: "12px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
  marginTop: "4px",
};

// --- Pure Helper: Tracheostomy Days & Weaning Calculator ---
export const calcTrachMetrics = ({ insertionDate, cuffTrial, valveTrial, cappingHours }) => {
  let daysSince = null;
  if (insertionDate) {
    const d = new Date(insertionDate);
    if (!isNaN(d.getTime())) {
      const diffTime = Math.abs(new Date() - d);
      daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }
  }

  const hours = parseFloat(cappingHours) || 0;
  const trialsPassed = Boolean(cuffTrial) && Boolean(valveTrial) && hours >= 48;

  let decannulationStatus = "Not yet ready";
  let message = "Complete cuff deflation trial, speaking valve assessment, and ≥48h continuous capping trial.";

  if (trialsPassed) {
    decannulationStatus = "Ready for Decannulation";
    message = "Patient has tolerated cuff deflation, speaking valve, and ≥48 hours of continuous capping. Meets safe decannulation protocol.";
  } else if (Boolean(cuffTrial) && Boolean(valveTrial)) {
    decannulationStatus = `Capping Trial in Progress (${hours}/48 hrs)`;
    message = `Cuff and valve trials passed. Capping trial ongoing: ${hours} of 48 hours completed without respiratory distress.`;
  }

  return { daysSince, decannulationReady: trialsPassed, decannulationStatus, message };
};

const EMPTY_CARE_ROW = { time: "", suction: true, secretions: "Clear / Mucoid", stoma_condition: "Clean / Intact", cuff_pressure: "22" };

export default function TracheostomyGuide() {
  const { formData, updateField } = usePulmonology();

  const careLog = formData.trach_care_log || [];
  const [newRow, setNewRow] = useState(EMPTY_CARE_ROW);

  // Derived Metrics & Weaning Assessment
  const metrics = useMemo(() => {
    return calcTrachMetrics({
      insertionDate: formData.trach_insertion_date,
      cuffTrial: formData.trach_cuff_deflation_trial,
      valveTrial: formData.trach_speaking_valve_trial,
      cappingHours: formData.trach_capping_duration,
    });
  }, [
    formData.trach_insertion_date,
    formData.trach_cuff_deflation_trial,
    formData.trach_speaking_valve_trial,
    formData.trach_capping_duration,
  ]);

  useEffect(() => {
    if (metrics.daysSince !== null && formData.trach_days_since_insertion !== String(metrics.daysSince)) {
      updateField("trach_days_since_insertion", String(metrics.daysSince));
    }
    if (formData.trach_decannulation_score !== metrics.decannulationStatus) {
      updateField("trach_decannulation_score", metrics.decannulationStatus);
    }
  }, [metrics, formData.trach_days_since_insertion, formData.trach_decannulation_score, updateField]);

  // Care Log Handlers
  const handleAddRow = () => {
    if (!newRow.time) return;
    updateField("trach_care_log", [
      ...careLog,
      { ...newRow, id: Date.now().toString() },
    ]);
    setNewRow(EMPTY_CARE_ROW);
  };

  const handleDeleteRow = (id) => {
    updateField(
      "trach_care_log",
      careLog.filter((r) => r.id !== id)
    );
  };

  const handleSignoff = () => {
    updateField("trach_signoff_timestamp", new Date().toISOString());
    updateField("trach_signoff_status", "Signed — complete");
  };

  return (
    <div>
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
          marginBottom: "16px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Tracheostomy Procedure &amp; Airway Care Management
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Percutaneous and surgical tracheostomy documentation, suction/cuff care logs, and structured decannulation weaning protocol.
        </p>
      </div>

      {/* Metrics & Decannulation Banner */}
      <div
        style={{
          border: `1px solid ${metrics.decannulationReady ? "#81c784" : "#e0e0e0"}`,
          backgroundColor: metrics.decannulationReady ? "#f0fdf4" : "#fafafa",
          padding: "12px 16px",
          marginBottom: "16px",
          borderRadius: "2px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              backgroundColor: metrics.decannulationReady ? "#2e7d32" : "#757575",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: "2px",
              marginRight: "8px",
            }}
          >
            {metrics.decannulationStatus}
          </span>
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#222" }}>
            {metrics.message}
          </span>
        </div>
        <div style={{ fontSize: "11.5px", color: "#666" }}>
          Days Since Insertion: <b>{metrics.daysSince !== null ? `${metrics.daysSince} days` : "Not set"}</b>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Indication & Consent */}
        <Section title="Indication, Technique & Consent">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
            <FormField
              label="PRIMARY INDICATION"
              name="trach_indication"
              type="select"
              options={[
                "Prolonged mechanical ventilation (>10–14 days in ICU)",
                "Upper airway obstruction (Malignancy / Laryngeal edema / Trauma)",
                "Severe bulbar dysfunction / aspiration risk (Airway protection)",
                "Failed extubation / excessive tracheobronchial secretions",
              ]}
            />
            <FormField
              label="TECHNIQUE PLANNED"
              name="trach_technique"
              type="select"
              options={[
                "Percutaneous dilatational tracheostomy — Ciaglia Blue Rhino",
                "Percutaneous dilatational tracheostomy — Griggs guidewire forceps",
                "Open surgical tracheostomy (ENT / General surgery)",
              ]}
            />
            <FormField label="INFORMED CONSENT OBTAINED?" name="trach_consent" type="checkbox" placeholder="Consent on file" />
            <FormField label="INSERTION DATE" name="trach_insertion_date" type="date" />
          </div>
        </Section>

        {/* Procedure Details */}
        <Section title="Tracheostomy Tube Specifications & Insertion Events">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="TUBE SIZE & BRAND" name="trach_tube_size" placeholder="e.g. Portex 8.0 mm ID (cuffed)" />
            <FormField
              label="CUFF TYPE"
              name="trach_cuffed"
              type="select"
              options={[
                "Cuffed with subglottic suction port (recommended)",
                "Cuffed standard low-pressure high-volume",
                "Uncuffed (for long-term weaning / pediatric)",
                "Fenestrated cuffed (for vocalization trials)",
              ]}
            />
            <FormField
              label="IMMEDIATE PROCEDURE COMPLICATIONS"
              name="trach_immediate_complications"
              type="select"
              options={[
                "None — successful procedure",
                "Minor stomal bleeding (controlled with packing / cautery)",
                "Subcutaneous emphysema",
                "Transient hypoxia during dilatation",
                "Tracheal posterior wall injury / false passage",
                "Pneumothorax",
              ]}
            />
            <FormField label="BRONCHOSCOPIC GUIDANCE USED?" name="trach_bronch_guided" type="checkbox" placeholder="Flexible bronchoscopy guidance" />
            <FormField label="PROCEDURALIST" name="trach_performed_by" placeholder="e.g. Attending / Fellow / Proceduralist" />
          </div>
        </Section>

        {/* Tube Care & Suction Log */}
        <Section title="Routine Tracheostomy Care, Cuff Pressure & Secretion Log" note="Record cuff pressure (target 20–30 cmH2O to prevent mucosal ischemia)">
          <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1.5fr 1.5fr 1fr 36px",
                gap: "8px",
                padding: "8px 12px",
                background: "#f5f5f5",
                borderBottom: "1px solid #e0e0e0",
              }}
            >
              {["Date/Time", "Suction Done", "Secretions", "Stoma Condition", "Cuff (cmH2O)", ""].map((h, i) => (
                <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                  {h}
                </span>
              ))}
            </div>

            {careLog.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
                No tube care entries logged yet. Record nursing / therapy checks below.
              </div>
            ) : (
              careLog.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1.5fr 1.5fr 1fr 36px",
                    gap: "8px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    borderBottom: "1px solid #f0f0f0",
                    alignItems: "center",
                  }}
                >
                  <span>{row.time}</span>
                  <span>{row.suction ? "Yes" : "No"}</span>
                  <span>{row.secretions}</span>
                  <span style={{ color: row.stoma_condition.includes("Erythema") || row.stoma_condition.includes("Discharge") ? "#b71c1c" : "#333" }}>
                    {row.stoma_condition}
                  </span>
                  <span style={{ fontWeight: 600, color: parseFloat(row.cuff_pressure) > 30 ? "#b71c1c" : "#2e7d32" }}>
                    {row.cuff_pressure} cmH2O
                  </span>
                  <button
                    onClick={() => handleDeleteRow(row.id)}
                    style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Staging Row */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#666", marginBottom: "8px" }}>
              + Add Trach Care Entry
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr 1.5fr 1fr", gap: "8px", alignItems: "center" }}>
              <input
                type="datetime-local"
                value={newRow.time}
                onChange={(e) => setNewRow({ ...newRow, time: e.target.value })}
                style={inputStyle}
              />
              <label style={{ fontSize: "11.5px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={newRow.suction}
                  onChange={(e) => setNewRow({ ...newRow, suction: e.target.checked })}
                  style={{ accentColor: "#000" }}
                />
                Suctioned?
              </label>
              <select
                value={newRow.secretions}
                onChange={(e) => setNewRow({ ...newRow, secretions: e.target.value })}
                style={inputStyle}
              >
                <option value="Clear / Mucoid">Clear / Mucoid</option>
                <option value="Thick / Tenacious">Thick / Tenacious</option>
                <option value="Purulent / Yellow-Green">Purulent / Yellow-Green</option>
                <option value="Blood-tinged">Blood-tinged</option>
              </select>
              <select
                value={newRow.stoma_condition}
                onChange={(e) => setNewRow({ ...newRow, stoma_condition: e.target.value })}
                style={inputStyle}
              >
                <option value="Clean / Intact">Clean / Intact</option>
                <option value="Erythema / Swelling">Erythema / Swelling</option>
                <option value="Purulent Discharge">Purulent Discharge</option>
                <option value="Granulation Tissue">Granulation Tissue</option>
              </select>
              <input
                type="number"
                placeholder="Cuff cmH2O (e.g. 24)"
                value={newRow.cuff_pressure}
                onChange={(e) => setNewRow({ ...newRow, cuff_pressure: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
              <button
                onClick={handleAddRow}
                style={{
                  padding: "6px 16px",
                  background: "#000",
                  color: "#fff",
                  border: "none",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add Care Checkpoint
              </button>
            </div>
          </div>
        </Section>

        {/* Weaning / Decannulation Plan */}
        <Section title="Progressive Weaning & Decannulation Checklist">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="1. CUFF DEFLATION TRIAL TOLERATED?" name="trach_cuff_deflation_trial" type="checkbox" placeholder="Deflation tolerated" />
            <FormField label="2. SPEAKING VALVE (PMV) TRIAL PASSED?" name="trach_speaking_valve_trial" type="checkbox" placeholder="Speaking valve passed" />
            <FormField label="3. CONTINUOUS CAPPING DURATION (HOURS)" name="trach_capping_duration" type="number" placeholder="e.g. 48" />
            <FormField label="DECANNULATION READINESS CRITERIA MET?" name="trach_decannulation_ready" type="checkbox" placeholder="Criteria verified" />
            <FormField label="DECANNULATION DATE" name="trach_decannulation_date" type="date" />
          </div>
        </Section>

        {/* Sign-off */}
        <Section title="Airway Team Sign-off & Electronic Review">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="ATTENDING PULMONOLOGIST / INTENSIVIST" name="trach_signoff_by" placeholder="e.g. Attending Pulmonologist / Intensivist" />
            <FormField
              label="SIGNOFF TIMESTAMP"
              name="trach_signoff_timestamp"
              type="derived"
              derivedValue={formData.trach_signoff_timestamp || "Pending Finalization"}
            />
            <FormField
              label="STATUS"
              name="trach_signoff_status"
              type="derived"
              derivedValue={formData.trach_signoff_status || "Active Tracheostomy"}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleSignoff}
              style={{
                padding: "8px 22px",
                backgroundColor: "#000000",
                color: "#ffffff",
                border: "none",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sign and Finalize Tracheostomy Note
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
