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

// --- Pure Helper: Chest Tube Drainage Analytics & Removal Readiness ---
export const calcCtdMetrics = (outputLog = []) => {
  if (!outputLog || outputLog.length === 0) {
    return {
      total24h: 0,
      trend: "No entries",
      removalReady: false,
      reason: "No drainage output recorded yet.",
      hasAirLeak: false,
    };
  }

  const totalVolume = outputLog.reduce((acc, row) => acc + (parseFloat(row.volume) || 0), 0);

  let trend = "Stable";
  if (outputLog.length >= 3) {
    const last3 = outputLog.slice(-3).map((r) => parseFloat(r.volume) || 0);
    if (last3[2] > last3[1] && last3[1] > last3[0]) trend = "Rising";
    else if (last3[2] < last3[1] && last3[1] < last3[0]) trend = "Falling";
    else trend = "Stable / Fluctuating";
  } else if (outputLog.length === 2) {
    const v0 = parseFloat(outputLog[0].volume) || 0;
    const v1 = parseFloat(outputLog[1].volume) || 0;
    trend = v1 < v0 ? "Falling" : v1 > v0 ? "Rising" : "Stable";
  }

  const latestEntry = outputLog[outputLog.length - 1];
  const hasAirLeak = Boolean(latestEntry.air_leak);
  const isVolumeLow = totalVolume < 150;
  const removalReady = isVolumeLow && !hasAirLeak;

  let reason = "";
  if (removalReady) {
    reason = `Output is ${totalVolume} mL (<150 mL) and no air leak detected. Meets removal readiness criteria.`;
  } else if (hasAirLeak) {
    reason = "Active air leak noted on latest check. Tube removal is contraindicated.";
  } else {
    reason = `Drainage volume is ${totalVolume} mL (exceeds <150 mL removal threshold). Continue drainage.`;
  }

  return { total24h: totalVolume, trend, removalReady, reason, hasAirLeak };
};

const EMPTY_OUTPUT_ROW = { time: "", volume: "", character: "Serous", air_leak: false, swing: true };

export default function ChestTubeGuide() {
  const {
    formData,
    updateField,
    updateFields,
    saveProcedureSession,
    isSavingProcedure,
    procedureFeedback,
    patientId,
  } = usePulmonology();

  const outputLog = formData.ctd_output_log || [];
  const [newRow, setNewRow] = useState(EMPTY_OUTPUT_ROW);
  const [isSaving, setIsSaving] = useState(false);
  const [localFeedback, setLocalFeedback] = useState(null);

  // Derived Metrics & Auto-Calculation
  const metrics = useMemo(() => calcCtdMetrics(outputLog), [outputLog]);

  useEffect(() => {
    if (outputLog.length > 0) {
      if (formData.ctd_output_24hr !== String(metrics.total24h)) {
        updateField("ctd_output_24hr", String(metrics.total24h));
      }
      if (formData.ctd_output_trend !== metrics.trend) {
        updateField("ctd_output_trend", metrics.trend);
      }
      if (formData.ctd_removal_readiness !== (metrics.removalReady ? "Ready for removal trial" : "Not ready")) {
        updateField("ctd_removal_readiness", metrics.removalReady ? "Ready for removal trial" : "Not ready");
      }
    }
  }, [metrics, outputLog.length, formData.ctd_output_24hr, formData.ctd_output_trend, formData.ctd_removal_readiness, updateField]);

  // Log Handlers
  const handleAddRow = () => {
    if (!newRow.time || !newRow.volume) return;
    updateField("ctd_output_log", [
      ...outputLog,
      { ...newRow, id: Date.now().toString() },
    ]);
    setNewRow(EMPTY_OUTPUT_ROW);
  };

  const handleDeleteRow = (id) => {
    updateField(
      "ctd_output_log",
      outputLog.filter((r) => r.id !== id)
    );
  };

  const handleSignoff = async () => {
    setIsSaving(true);
    setLocalFeedback(null);
    try {
      const operator =
        formData.ctd_signoff_by ||
        formData.ctd_performed_by ||
        formData.proc_operator ||
        formData.team_pulmonologist ||
        "Dr. Arvind Ramesh, MD, FCCP";

      const now = new Date();
      const timestamp = now.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const summaryText = `Chest Tube (${formData.ctd_tube_size || "ICD"}) inserted at ${
        formData.ctd_site || "Safe Triangle"
      }. Indication: ${formData.ctd_indication || "Pneumothorax"}. Total 24h Output: ${
        metrics.total24h
      } mL. Air leak: ${metrics.hasAirLeak ? "Yes" : "None"}. Status: Signed & Sealed.`;

      // Snapshot active monitoring state so previous procedure recovery data is permanently archived
      const monitoringSnapshot = {};
      Object.keys(formData).forEach((key) => {
        if (key.startsWith("mon_")) {
          monitoringSnapshot[key] = formData[key];
        }
      });

      const procedureRecord = {
        id: Date.now().toString(),
        proc_id: "chest_tube",
        proc_name: "Chest Tube / ICD Insertion",
        proc_category: "advanced",
        proc_date: formData.ctd_insertion_date || formData.proc_date || now.toISOString().substring(0, 10),
        proc_time: formData.ctd_insertion_time || formData.proc_time_end || now.toLocaleTimeString(),
        proc_operator: operator,
        status: "Completed & Sealed",
        summary: summaryText,
        monitoring_snapshot: monitoringSnapshot,
        data: {
          ...formData,
          ctd_signoff_by: operator,
          ctd_signoff_timestamp: timestamp,
          ctd_signoff_status: "Signed — complete",
          chest_tube_procedure_performed: true,
        },
      };

      const existingLog = Array.isArray(formData.completed_procedures_log) ? formData.completed_procedures_log : [];
      let cachedLog = [];
      if (patientId) {
        try {
          const cached = JSON.parse(localStorage.getItem(`pulm_sync_${patientId}`) || "{}");
          if (Array.isArray(cached.completed_procedures_log)) cachedLog = cached.completed_procedures_log;
        } catch (e) {}
      }
      const combinedLog = [...existingLog, ...cachedLog];
      const logMap = new Map();
      combinedLog.forEach((p) => {
        if (p && p.proc_id) logMap.set(p.proc_id, p);
      });
      logMap.set("chest_tube", procedureRecord);
      const updatedLog = Array.from(logMap.values());

      const updates = {
        ctd_signoff_by: operator,
        ctd_signoff_timestamp: timestamp,
        ctd_signoff_status: "Signed — complete",
        chest_tube_procedure_performed: true,
        ct_size: formData.ctd_tube_size || formData.ct_size || "16–20 Fr (Small-bore)",
        ct_initial_drainage: String(metrics.total24h || "0"),
        ct_air_leak: metrics.hasAirLeak ? "Yes" : "No",
        completed_procedures_log: updatedLog,
        last_completed_procedure: procedureRecord,
        // Establish new procedure as active monitoring subject and reset acute PACU state
        mon_active_procedure_id: "chest_tube",
        mon_active_procedure_name: "Chest Tube / ICD Insertion",
        mon_obs_aldrete: "",
        mon_obs_wob: "Eupneic / Normal resting",
        mon_obs_gcs: "15 (Alert & Oriented)",
        mon_obs_auscultation: "",
        mon_obs_symmetry: "Symmetrical expansion",
        mon_eff_hemoptysis: "None",
        mon_eff_cxr_ptx: "Confirmed Absent / Excluded",
        mon_eff_dressing: "Clean, dry, intact, no hematoma",
        mon_eff_adrs: "None reported",
        mon_eff_cardio: "Hemodynamically stable throughout",
        mon_timed_obs: [],
        mon_complications: [],
      };

      if (typeof updateFields === "function") {
        updateFields(updates);
      } else {
        Object.entries(updates).forEach(([k, v]) => updateField(k, v));
      }

      if (patientId) {
        try {
          const key = `pulm_sync_${patientId}`;
          const existing = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(
            key,
            JSON.stringify({
              ...existing,
              chest_tube_procedure_performed: true,
              ctd_signoff_status: "Signed — complete",
              ctd_signoff_timestamp: timestamp,
              ctd_signoff_by: operator,
              completed_procedures_log: updatedLog,
              last_completed_procedure: procedureRecord,
            })
          );
        } catch (e) {}
      }

      window.dispatchEvent(
        new CustomEvent("pulm_procedure_data_sync", {
          detail: {
            patientId,
            data: {
              chest_tube_procedure_performed: true,
              ctd_signoff_status: "Signed — complete",
              ctd_signoff_timestamp: timestamp,
              ctd_signoff_by: operator,
              completed_procedures_log: updatedLog,
              last_completed_procedure: procedureRecord,
            },
          },
        })
      );

      window.dispatchEvent(
        new CustomEvent("pulm_procedure_completed", {
          detail: {
            patientId,
            procedure: procedureRecord,
            completed_procedures_log: updatedLog,
            targetTrack: "monitoring",
          },
        })
      );

      if (typeof saveProcedureSession === "function") {
        await saveProcedureSession({
          slug: "ctt",
          type: "Chest Tube / ICD Insertion",
          category: "Advanced Intervention",
          notes: summaryText,
          data: {
            ...formData,
            ...updates,
          },
        });
      }

      setLocalFeedback({
        ok: true,
        text: `✓ Chest Tube record signed and completed successfully by ${operator}. Saved to chart.`,
      });
    } catch (err) {
      console.error("Failed to sign off chest tube record:", err);
      setLocalFeedback({
        ok: false,
        text: `Failed to sign off: ${err.message || err}`,
      });
    } finally {
      setIsSaving(false);
    }
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
          Intercostal Drain / Chest Tube Management (ICD)
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Insertion protocol, serial output logging, air leak tracking, and automated removal readiness assessment.
        </p>
      </div>

      {/* Removal Readiness Banner */}
      {outputLog.length > 0 && (
        <div
          style={{
            border: `1px solid ${metrics.removalReady ? "#81c784" : "#e0e0e0"}`,
            backgroundColor: metrics.removalReady ? "#f0fdf4" : "#fafafa",
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
                backgroundColor: metrics.removalReady ? "#2e7d32" : "#757575",
                color: "#fff",
                padding: "2px 6px",
                borderRadius: "2px",
                marginRight: "8px",
              }}
            >
              {metrics.removalReady ? "Removal Ready" : "Continued Drainage"}
            </span>
            <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#222" }}>
              {metrics.reason}
            </span>
          </div>
          <div style={{ fontSize: "11.5px", color: "#666" }}>
            Total Output: <b>{metrics.total24h} mL</b> &nbsp;|&nbsp; Trend: <b>{metrics.trend}</b>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Indication & Consent */}
        <Section title="Indication, Consent & Pre-Insertion Check">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
            <FormField
              label="PRIMARY INDICATION"
              name="ctd_indication"
              type="select"
              options={[
                "Spontaneous pneumothorax (Primary / Secondary)",
                "Tension pneumothorax (post-needle decompression)",
                "Hemothorax (Trauma / Post-procedural)",
                "Empyema / Complicated parapneumonic effusion",
                "Malignant pleural effusion",
                "Post-thoracic surgical drainage",
              ]}
            />
            <FormField label="INFORMED CONSENT SIGNED?" name="ctd_consent" type="checkbox" placeholder="Consent verified" />
            <FormField label="PRE-INSERTION IMAGING VERIFIED?" name="ctd_imaging_confirmed" type="checkbox" placeholder="CXR / CT reviewed" />
            <FormField label="PROCEDURE DATE" name="ctd_insertion_date" type="date" />
          </div>
        </Section>

        {/* Insertion Details */}
        <Section title="Tube Placement & Circuit Specifications">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="INSERTION SITE / ANATOMY" name="ctd_site" placeholder="e.g. Right 5th ICS, anterior to mid-axillary line (Safe Triangle)" />
            <FormField
              label="TUBE SIZE (FRENCH)"
              name="ctd_tube_size"
              type="select"
              options={["8–14 Fr (Pigtail catheter)", "16–20 Fr (Small-bore)", "24–28 Fr (Medium-bore)", "32–36 Fr (Large-bore for hemothorax/empyema)"]}
            />
            <FormField
              label="INSERTION TECHNIQUE"
              name="ctd_technique"
              type="select"
              options={[
                "Seldinger guide-wire technique (Pigtail)",
                "Blunt surgical dissection with clamp (Standard)",
                "Thoracoscopic / VATS insertion",
              ]}
            />
            <FormField
              label="DRAINAGE MODE"
              name="ctd_drainage_mode"
              type="select"
              options={[
                "Underwater seal (passive drainage)",
                "Low-pressure suction (-10 cmH2O)",
                "Standard suction (-20 cmH2O)",
                "Heimlich flutter valve (ambulatory)",
              ]}
            />
            <FormField label="INSERTION TIME" name="ctd_insertion_time" type="time" />
            <FormField label="INSERTING PHYSICIAN" name="ctd_performed_by" placeholder="e.g. Attending / Fellow / Operator" />
          </div>
        </Section>

        {/* Drainage & Output Log */}
        <Section title="Serial Output, Air Leak & Swing Log" note="Record hourly or shift-wise volume, color, and air leak status">
          <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1.5fr 1fr 1fr 36px",
                gap: "8px",
                padding: "8px 12px",
                background: "#f5f5f5",
                borderBottom: "1px solid #e0e0e0",
              }}
            >
              {["Date/Time", "Volume (mL)", "Character", "Air Leak", "Respiratory Swing", ""].map((h, i) => (
                <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                  {h}
                </span>
              ))}
            </div>

            {outputLog.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
                No drainage entries logged yet. Record output checks below.
              </div>
            ) : (
              outputLog.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1.5fr 1fr 1fr 36px",
                    gap: "8px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    borderBottom: "1px solid #f0f0f0",
                    alignItems: "center",
                  }}
                >
                  <span>{row.time}</span>
                  <span style={{ fontWeight: 600 }}>{row.volume} mL</span>
                  <span>{row.character}</span>
                  <span style={{ color: row.air_leak ? "#b71c1c" : "#2e7d32", fontWeight: 600 }}>
                    {row.air_leak ? "Yes (Leak)" : "None"}
                  </span>
                  <span>{row.swing ? "Yes (Patent)" : "No (Blocked / Expanded)"}</span>
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
              + Add Output Checkpoint
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.5fr 1fr 1fr", gap: "8px", alignItems: "center" }}>
              <input
                type="datetime-local"
                value={newRow.time}
                onChange={(e) => setNewRow({ ...newRow, time: e.target.value })}
                style={inputStyle}
              />
              <input
                type="number"
                placeholder="Volume mL (e.g. 50)"
                value={newRow.volume}
                onChange={(e) => setNewRow({ ...newRow, volume: e.target.value })}
                style={inputStyle}
              />
              <select
                value={newRow.character}
                onChange={(e) => setNewRow({ ...newRow, character: e.target.value })}
                style={inputStyle}
              >
                <option value="Serous / Straw">Serous / Straw</option>
                <option value="Serosanguinous">Serosanguinous</option>
                <option value="Bloody / Frank Blood">Bloody / Frank Blood</option>
                <option value="Purulent / Pus">Purulent / Pus</option>
                <option value="Chylous">Chylous</option>
              </select>
              <label style={{ fontSize: "11.5px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={newRow.air_leak}
                  onChange={(e) => setNewRow({ ...newRow, air_leak: e.target.checked })}
                  style={{ accentColor: "#b71c1c" }}
                />
                Air Leak?
              </label>
              <label style={{ fontSize: "11.5px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={newRow.swing}
                  onChange={(e) => setNewRow({ ...newRow, swing: e.target.checked })}
                  style={{ accentColor: "#000" }}
                />
                Fluid Swing?
              </label>
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
                Add Output Entry
              </button>
            </div>
          </div>
        </Section>

        {/* Complications */}
        <Section title="Adverse Events & Tube Troubleshooting">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <FormField
              label="COMPLICATION IDENTIFIED"
              name="ctd_complication"
              type="select"
              options={[
                "None — functioning normally",
                "Blocked / kinked tube (cessation of swing/drainage)",
                "Subcutaneous emphysema at site or chest wall",
                "Exit site infection / cellulitis",
                "Accidental tube dislodgement",
                "Re-expansion pulmonary edema",
                "Bleeding from intercostal vessel",
              ]}
            />
            <FormField
              label="CORRECTIVE ACTION TAKEN"
              name="ctd_complication_action"
              type="textarea"
              placeholder="Milking/stripping tube, flushing with sterile saline, repositioning, antibiotic initiation..."
            />
          </div>
        </Section>

        {/* Removal & Sign-off */}
        <Section title="Removal Readiness Checklist & Protocol">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="REMOVAL CRITERIA MET (NO LEAK, <150mL/24h)?" name="ctd_removal_criteria_met" type="checkbox" placeholder="Confirmed" />
            <FormField label="REMOVAL DATE & TIME" name="ctd_removal_time" type="datetime-local" />
            <FormField label="POST-REMOVAL CXR COMPLETED (NO PNEUMOTHORAX)?" name="ctd_post_removal_cxr" type="checkbox" placeholder="CXR clear" />
          </div>
        </Section>

        <Section title="Procedure Finalization & Electronic Verification">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="REMOVING / REVIEWING OPERATOR" name="ctd_signoff_by" placeholder="e.g. Attending / Fellow / Operator" />
            <FormField
              label="SIGNOFF TIMESTAMP"
              name="ctd_signoff_timestamp"
              type="derived"
              derivedValue={formData.ctd_signoff_timestamp || "Not finalized"}
            />
            <FormField
              label="STATUS"
              name="ctd_signoff_status"
              type="derived"
              derivedValue={formData.ctd_signoff_status || "In progress"}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
            {(localFeedback || procedureFeedback) && (
              <div
                style={{
                  padding: "8px 14px",
                  fontSize: "12px",
                  borderRadius: "2px",
                  backgroundColor: (localFeedback || procedureFeedback).ok ? "#f0fdf4" : "#fef2f2",
                  border: `1px solid ${(localFeedback || procedureFeedback).ok ? "#86efac" : "#fca5a5"}`,
                  color: (localFeedback || procedureFeedback).ok ? "#166534" : "#991b1b",
                  fontWeight: 500,
                }}
              >
                {(localFeedback || procedureFeedback).text}
              </div>
            )}
            <button
              type="button"
              onClick={handleSignoff}
              disabled={isSaving || isSavingProcedure}
              style={{
                padding: "8px 22px",
                backgroundColor: isSaving || isSavingProcedure ? "#666666" : "#000000",
                color: "#ffffff",
                border: "none",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: isSaving || isSavingProcedure ? "not-allowed" : "pointer",
                borderRadius: "2px",
              }}
            >
              {isSaving || isSavingProcedure ? "Saving to Patient Chart..." : "Sign & Complete Chest Tube Record"}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
