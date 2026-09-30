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

// --- Pure Helper: IPC Metrics & Spontaneous Auto-Pleurodesis Detector ---
export const calcIpcMetrics = ({ insertionDate, drainageLog = [] }) => {
  let daysSince = null;
  if (insertionDate) {
    const d = new Date(insertionDate);
    if (!isNaN(d.getTime())) {
      daysSince = Math.floor(Math.abs(new Date() - d) / (1000 * 60 * 60 * 24));
    }
  }

  let trend = "Insufficient entries";
  let autoPleurodesisPossible = false;
  let reason = "Record serial home bottle drainages to evaluate output trends.";

  if (drainageLog.length >= 3) {
    const recent = drainageLog.slice(-3).map((r) => parseFloat(r.volume) || 0);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const isFalling = recent[2] <= recent[1] && recent[1] <= recent[0];

    if (isFalling && avgRecent < 50) {
      trend = "Falling steadily (<50 mL)";
      autoPleurodesisPossible = true;
      reason = `Average drainage across last 3 logs is ${Math.round(avgRecent)} mL (<50 mL). Spontaneous pleurodesis suspected. Consider imaging to assess for trial of IPC catheter removal.`;
    } else if (isFalling) {
      trend = "Decreasing volume";
      reason = "Drainage volume trending downwards towards potential spontaneous symphysis.";
    } else if (recent[2] > recent[1] && recent[1] > recent[0]) {
      trend = "Increasing volume";
      reason = "Drainage output is increasing. Ensure patient compliance with prescribed schedule.";
    } else {
      trend = "Stable / Fluctuating";
      reason = `Stable ambulatory drainage output maintained (recent avg ~${Math.round(avgRecent)} mL).`;
    }
  }

  return { daysSince, trend, autoPleurodesisPossible, reason };
};

const EMPTY_DRAINAGE_ROW = { date: "", volume: "", character: "Straw / Serous" };

export default function IPCGuide() {
  const { formData, updateField } = usePulmonology();

  const drainageLog = formData.ipc_drainage_log || [];
  const [newRow, setNewRow] = useState(EMPTY_DRAINAGE_ROW);

  // Derived Metrics & Auto-Pleurodesis Calculation
  const metrics = useMemo(() => {
    return calcIpcMetrics({
      insertionDate: formData.ipc_insertion_date,
      drainageLog,
    });
  }, [formData.ipc_insertion_date, drainageLog]);

  useEffect(() => {
    if (metrics.daysSince !== null && formData.ipc_days_since_insertion !== String(metrics.daysSince)) {
      updateField("ipc_days_since_insertion", String(metrics.daysSince));
    }
    if (formData.ipc_output_trend !== metrics.trend) {
      updateField("ipc_output_trend", metrics.trend);
    }
  }, [metrics, formData.ipc_days_since_insertion, formData.ipc_output_trend, updateField]);

  // Log Handlers
  const handleAddRow = () => {
    if (!newRow.date || !newRow.volume) return;
    updateField("ipc_drainage_log", [
      ...drainageLog,
      { ...newRow, id: Date.now().toString() },
    ]);
    setNewRow(EMPTY_DRAINAGE_ROW);
  };

  const handleDeleteRow = (id) => {
    updateField(
      "ipc_drainage_log",
      drainageLog.filter((r) => r.id !== id)
    );
  };

  const handleSignoff = () => {
    updateField("ipc_signoff_timestamp", new Date().toISOString());
    updateField("ipc_signoff_status", "Signed — complete");
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
          Indwelling Pleural Catheter (IPC / PleurX) Guide
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Tunneled pleural catheter placement, home bottle drainage regimen, and spontaneous auto-pleurodesis tracking.
        </p>
      </div>

      {/* Auto-Pleurodesis Suggestion Banner */}
      {metrics.autoPleurodesisPossible ? (
        <div
          style={{
            border: "1px solid #81c784",
            backgroundColor: "#f0fdf4",
            padding: "12px 16px",
            marginBottom: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                backgroundColor: "#2e7d32",
                color: "#fff",
                padding: "2px 6px",
                borderRadius: "2px",
              }}
            >
              Auto-Pleurodesis Suspected
            </span>
            <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#1b5e20" }}>
              Spontaneous Lung Symphysis — Consider Catheter Removal
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>{metrics.reason}</p>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            background: "#fafafa",
            padding: "10px 16px",
            border: "1px solid #e0e0e0",
            marginBottom: "16px",
            fontSize: "12px",
          }}
        >
          <span>Catheter In Situ: <b>{metrics.daysSince !== null ? `${metrics.daysSince} days` : "Date not set"}</b></span>
          <span>Output Trend: <b>{metrics.trend}</b></span>
          <span>Drainages Logged: <b>{drainageLog.length}</b></span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Indication, Patient Goals & Consent */}
        <Section title="Indication, Patient Goals & Consent">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField
              label="PRIMARY INDICATION"
              name="ipc_indication"
              type="select"
              options={[
                "Recurrent malignant pleural effusion (MPE) with trapped / non-expandable lung",
                "MPE — patient preference for outpatient home drainage over hospitalization",
                "Refractory non-malignant effusion (Heart failure / Chylothorax / Hepatic)",
                "Failed chemical talc pleurodesis",
              ]}
            />
            <FormField label="INFORMED CONSENT VERIFIED?" name="ipc_consent" type="checkbox" placeholder="Consent on file" />
            <FormField label="INSERTION DATE" name="ipc_insertion_date" type="date" />
          </div>
        </Section>

        {/* Insertion Details */}
        <Section title="Catheter Placement & Tunnel Details">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="INSERTION SITE & TUNNEL TRACT" name="ipc_site" placeholder="e.g. Right 7th ICS anterior to latissimus, 5cm tunnel" />
            <FormField label="CATHETER BRAND & SIZE" name="ipc_catheter_type" placeholder="e.g. BD PleurX 15.5 Fr Silicone Catheter" />
            <FormField label="INITIAL DRAINAGE AT INSERTION (mL)" name="ipc_initial_drainage" type="number" placeholder="e.g. 750" />
            <FormField label="CUFF IN TUNNEL POSITION CONFIRMED?" name="ipc_cuff_confirmed" type="checkbox" placeholder="Polyester cuff in subcutaneous tract" />
            <FormField label="INSERTING PHYSICIAN" name="ipc_performed_by" placeholder="e.g. Attending / Fellow / Operator" />
          </div>
        </Section>

        {/* Home Drainage Schedule & Log */}
        <Section title="Prescribed Regimen & Caregiver Education">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField
              label="DRAINAGE FREQUENCY PRESCRIBED"
              name="ipc_drainage_frequency"
              type="select"
              options={[
                "Daily (recommended for first 1–2 weeks to encourage symphysis)",
                "Every other day (Alternate days)",
                "2–3 times per week",
                "Symptom-guided / PRN for dyspnea only",
              ]}
            />
            <FormField label="PATIENT / CAREGIVER TRAINED?" name="ipc_caregiver_trained" type="checkbox" placeholder="Sterile technique verified" />
            <FormField label="VACUUM BOTTLE CAPACITY" name="ipc_bottle_capacity" placeholder="e.g. 1,000 mL vacuum bottles" />
          </div>
        </Section>

        <Section title="Home Bottle Drainage Log" note="Record serial dates, drained volume, and fluid characteristics">
          <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.2fr 2fr 36px",
                gap: "8px",
                padding: "8px 12px",
                background: "#f5f5f5",
                borderBottom: "1px solid #e0e0e0",
              }}
            >
              {["Date", "Volume Drained (mL)", "Fluid Appearance", ""].map((h, i) => (
                <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                  {h}
                </span>
              ))}
            </div>

            {drainageLog.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
                No home drainage records logged yet.
              </div>
            ) : (
              drainageLog.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1.2fr 2fr 36px",
                    gap: "8px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    borderBottom: "1px solid #f0f0f0",
                    alignItems: "center",
                  }}
                >
                  <span>{row.date}</span>
                  <span style={{ fontWeight: 600 }}>{row.volume} mL</span>
                  <span>{row.character}</span>
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

          {/* Add Row Staging */}
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#666", marginBottom: "8px" }}>
              + Add Home Drainage Entry
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 2fr", gap: "8px" }}>
              <input
                type="date"
                value={newRow.date}
                onChange={(e) => setNewRow({ ...newRow, date: e.target.value })}
                style={inputStyle}
              />
              <input
                type="number"
                placeholder="Volume (mL, e.g. 350)"
                value={newRow.volume}
                onChange={(e) => setNewRow({ ...newRow, volume: e.target.value })}
                style={inputStyle}
              />
              <select
                value={newRow.character}
                onChange={(e) => setNewRow({ ...newRow, character: e.target.value })}
                style={inputStyle}
              >
                <option value="Straw / Serous">Straw / Serous</option>
                <option value="Serosanguinous">Serosanguinous</option>
                <option value="Bloody">Bloody</option>
                <option value="Turbid / Cloudy">Turbid / Cloudy</option>
                <option value="Purulent / Pus">Purulent / Pus</option>
              </select>
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
                Add Drainage Log
              </button>
            </div>
          </div>
        </Section>

        {/* IPC Complications */}
        <Section title="IPC Complications & Catheter Troubleshooting">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <FormField
              label="COMPLICATION TYPE"
              name="ipc_complication"
              type="select"
              options={[
                "None — catheter patent and functioning well",
                "Exit site / tunnel cellulitis",
                "Pleural space infection / catheter-associated empyema",
                "Catheter blockage / fibrin occlusion (poor drainage)",
                "Septation / loculated effusion (incomplete drainage)",
                "Catheter fracture / valve malfunction",
                "Pain on drainage (re-expansion pain / vacuum too rapid)",
              ]}
            />
            <FormField
              label="CORRECTIVE ACTION TAKEN"
              name="ipc_complication_action"
              type="textarea"
              placeholder="Instillation of intrapleural tPA/alteplase for fibrin, oral/IV antibiotics, slowed drainage rate, valve repair..."
            />
          </div>
        </Section>

        {/* Sign-off */}
        <Section title="IPC Clinical Sign-off & Follow-up Verification">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="MANAGING PROCEDURALIST" name="ipc_signoff_by" placeholder="e.g. Attending Pulmonologist / Managing Proceduralist" />
            <FormField
              label="SIGNOFF TIMESTAMP"
              name="ipc_signoff_timestamp"
              type="derived"
              derivedValue={formData.ipc_signoff_timestamp || "Pending Finalization"}
            />
            <FormField
              label="STATUS"
              name="ipc_signoff_status"
              type="derived"
              derivedValue={formData.ipc_signoff_status || "Active Indwelling Catheter"}
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
              Sign and Finalize IPC Record
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
