import React, { useState, useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

// --- Shared Styles ---
const tableStyle = { width: "100%", borderCollapse: "collapse" };
const thStyle = {
  fontSize: "10.5px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  backgroundColor: "#f5f5f5",
  color: "#000",
};
const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: "12px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
  marginTop: "4px",
};

// ─── Sub-Tab 1: Device & Compliance ─────────────────────────────────────────
const DeviceComplianceTab = () => (
  <div>
    <Section title="Prescribed Respiratory Support Device" note="Home oxygen and non-invasive ventilation device profile">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
        <FormField
          label="DEVICE TYPE"
          name="o2_device_type"
          type="select"
          options={[
            "Nasal cannula (Low-flow O2)",
            "Venturi mask (Fixed FiO2)",
            "NIV BiPAP (Bilevel Positive Airway Pressure)",
            "NIV CPAP (Continuous Positive Airway Pressure)",
            "High-Flow Nasal Cannula (HFNC)",
            "Home O2 concentrator only",
          ]}
        />
        <FormField label="PRESCRIBED FLOW RATE (L/min)" name="o2_flow_rate" type="number" placeholder="e.g. 2.5" />
        <FormField label="PRESCRIBED FiO2 (%)" name="o2_fio2" type="number" placeholder="e.g. 28" />
        <FormField
          label="INTERFACE / MASK TYPE"
          name="o2_mask_type"
          type="select"
          options={["Full face mask (oronasal)", "Nasal mask", "Nasal pillows", "Total face mask", "High-flow nasal prongs"]}
        />
        <FormField
          label="MASK FIT ASSESSMENT"
          name="o2_mask_fit"
          type="select"
          options={["Good — minimal/acceptable leak", "Moderate leak — refitted and headgear adjusted", "Poor — significant leak requiring replacement"]}
        />
        <FormField label="HOME COMPLIANCE (HOURS / NIGHT)" name="o2_compliance_hrs" type="number" placeholder="e.g. 6.2" />
        <FormField label="% OF NIGHTS USED ≥ 4 HOURS" name="o2_nights_pct" placeholder="e.g. 88% (26 / 30 nights)" />
        <FormField label="DEVICE SUPPLIER / VENDOR" name="o2_supplier" placeholder="e.g. Philips Respironics / ResMed" />
        <FormField label="LAST SERVICE / FILTER DATE" name="o2_service_date" type="date" />
      </div>
    </Section>
  </div>
);

// ─── Sub-Tab 2: NIV Session Prep ────────────────────────────────────────────
const NivPrepTab = () => {
  const { formData, updateField } = usePulmonology();
  const prepKeys = ["nivprep_ck_mask", "nivprep_ck_circuit", "nivprep_ck_filter", "nivprep_ck_humid", "nivprep_ck_download"];
  const completedPrep = prepKeys.filter((k) => Boolean(formData[k])).length;

  return (
    <div>
      <Section title="Pre-Session Vitals & Clinical Settings">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="INFORMED CONSENT VERIFIED?" name="nivprep_consent" type="checkbox" placeholder="Consent documented" />
          <FormField label="PRE-NIGHT BASELINE SPO2 (%)" name="nivprep_baseline_spo2" type="number" placeholder="e.g. 91" />
          <FormField label="PRE-NIGHT BASELINE HR (bpm)" name="nivprep_baseline_hr" type="number" placeholder="e.g. 78" />
          <FormField label="PRE-NIGHT BASELINE RR (/min)" name="nivprep_baseline_rr" type="number" placeholder="e.g. 20" />
          <FormField label="PRESCRIBED IPAP (cmH2O)" name="nivprep_ipap" type="number" placeholder="e.g. 14" />
          <FormField label="PRESCRIBED EPAP (cmH2O)" name="nivprep_epap" type="number" placeholder="e.g. 6" />
          <FormField label="BACKUP RESPIRATORY RATE" name="nivprep_backup_rate" type="number" placeholder="e.g. 12" />
        </div>
      </Section>

      <Section title="Pre-Session Setup Checklist" note={`Status: ${completedPrep} of ${prepKeys.length} steps verified`}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
          {[
            { id: "nivprep_ck_mask", label: "Mask fitted & seal verified" },
            { id: "nivprep_ck_circuit", label: "Breathing circuit intact" },
            { id: "nivprep_ck_filter", label: "Inlet filter checked & clean" },
            { id: "nivprep_ck_humid", label: "Heated humidifier filled" },
            { id: "nivprep_ck_download", label: "Card data downloaded" },
          ].map((item) => {
            const isChecked = Boolean(formData[item.id]);
            return (
              <label
                key={item.id}
                style={{
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  border: "1px solid",
                  borderColor: isChecked ? "#81c784" : "#e0e0e0",
                  background: isChecked ? "#f0fdf4" : "#fff",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => updateField(item.id, e.target.checked)}
                  style={{ accentColor: "#2e7d32" }}
                />
                {item.label}
              </label>
            );
          })}
        </div>
      </Section>
    </div>
  );
};

// ─── Sub-Tab 3: NIV Monitoring (Live Log Table) ─────────────────────────────
const EMPTY_MONITOR_ROW = { time: "", spo2: "", hr: "", leak: "", event: "" };

const NivMonitoringTab = () => {
  const { formData, updateField } = usePulmonology();
  const monitorLog = formData.o2_monitor_log || [];
  const [newRow, setNewRow] = useState(EMPTY_MONITOR_ROW);

  const handleAddRow = () => {
    if (!newRow.time) return;
    updateField("o2_monitor_log", [
      ...monitorLog,
      { ...newRow, id: Date.now().toString() },
    ]);
    setNewRow(EMPTY_MONITOR_ROW);
  };

  const handleDeleteRow = (id) => {
    updateField(
      "o2_monitor_log",
      monitorLog.filter((r) => r.id !== id)
    );
  };

  return (
    <div>
      <Section title="Session Monitoring Log (Real-Time)" note="Log hourly overnight SpO2, heart rate, leak, and synchrony events">
        <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr 2.5fr 36px",
              gap: "8px",
              padding: "8px 12px",
              background: "#f5f5f5",
              borderBottom: "1px solid #e0e0e0",
            }}
          >
            {["Time", "SpO2 (%)", "HR (bpm)", "Leak (L/min)", "Event / Patient Synchrony", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                {h}
              </span>
            ))}
          </div>

          {monitorLog.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
              No monitoring entries logged yet. Add observations below.
            </div>
          ) : (
            monitorLog.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr 2.5fr 36px",
                  gap: "8px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  borderBottom: "1px solid #f0f0f0",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 600 }}>{row.time}</span>
                <span style={{ color: parseFloat(row.spo2) < 88 ? "#b71c1c" : "#000", fontWeight: parseFloat(row.spo2) < 88 ? 700 : 400 }}>
                  {row.spo2}%
                </span>
                <span>{row.hr}</span>
                <span style={{ color: parseFloat(row.leak) > 24 ? "#e65100" : "#333" }}>{row.leak}</span>
                <span style={{ color: "#444" }}>{row.event}</span>
                <button
                  onClick={() => handleDeleteRow(row.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#888",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
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
            + Add Monitoring Checkpoint
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 2.5fr", gap: "8px" }}>
            <input
              type="time"
              value={newRow.time}
              onChange={(e) => setNewRow({ ...newRow, time: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
            <input
              type="number"
              placeholder="SpO2 (e.g. 92)"
              value={newRow.spo2}
              onChange={(e) => setNewRow({ ...newRow, spo2: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
            <input
              type="number"
              placeholder="HR (e.g. 76)"
              value={newRow.hr}
              onChange={(e) => setNewRow({ ...newRow, hr: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
            <input
              type="number"
              placeholder="Leak L/min (e.g. 14)"
              value={newRow.leak}
              onChange={(e) => setNewRow({ ...newRow, leak: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
            <input
              type="text"
              placeholder="e.g. Patient asleep, synchronized; no patient-ventilator dyssynchrony"
              value={newRow.event}
              onChange={(e) => setNewRow({ ...newRow, event: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box" }}
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
              Add Checkpoint
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

// ─── Sub-Tab 4: NIV Titration ───────────────────────────────────────────────
const EMPTY_TITR = { time: "", pressures: "", spo2: "", tcco2: "", leak: "", adjustment: "" };

export const NIVTitrationSubTab = ({ formData: fd, updateField: uf }) => {
  const ctx = usePulmonology();
  const formData = fd || ctx.formData || {};
  const updateField = uf || ctx.updateField || (() => {});

  const titrLog = formData.nivtitr_log || [];
  const [newRow, setNewRow] = useState(EMPTY_TITR);

  // Auto-sync session date, operator, baseline blood gas and settings
  useEffect(() => {
    if (!formData.nivtitr_date) {
      updateField("nivtitr_date", formData.proc_date || new Date().toISOString().substring(0, 10));
    }
    if (!formData.nivtitr_operator) {
      updateField("nivtitr_operator", formData.proc_operator || formData.team_pulmonologist || "Dr. Arvind Ramesh, MD, FCCP");
    }
    if (!formData.nivtitr_paco2_pre && (formData.pulm_current_paco2 || formData.abg_paco2)) {
      updateField("nivtitr_paco2_pre", formData.pulm_current_paco2 || formData.abg_paco2);
    }
    if (!formData.nivtitr_ph_pre && (formData.pulm_current_ph || formData.abg_ph)) {
      updateField("nivtitr_ph_pre", formData.pulm_current_ph || formData.abg_ph);
    }
    if (!formData.nivtitr_start_press) {
      if (formData.nivprep_ipap && formData.nivprep_epap) {
        updateField("nivtitr_start_press", `${formData.nivprep_ipap} / ${formData.nivprep_epap}`);
      } else {
        updateField("nivtitr_start_press", "12 / 5");
      }
    }
    if (!formData.nivtitr_o2) {
      const flow = formData.med_o2_flow || formData.air_o2_flow || "2.0";
      updateField("nivtitr_o2", `${flow} L/min`);
    }
  }, [
    formData.nivtitr_date,
    formData.proc_date,
    formData.nivtitr_operator,
    formData.proc_operator,
    formData.team_pulmonologist,
    formData.nivtitr_paco2_pre,
    formData.pulm_current_paco2,
    formData.abg_paco2,
    formData.nivtitr_ph_pre,
    formData.pulm_current_ph,
    formData.abg_ph,
    formData.nivtitr_start_press,
    formData.nivprep_ipap,
    formData.nivprep_epap,
    formData.nivtitr_o2,
    formData.med_o2_flow,
    formData.air_o2_flow,
    updateField,
  ]);

  const handleAddTitr = () => {
    if (!newRow.time) return;
    updateField("nivtitr_log", [...titrLog, { ...newRow, id: Date.now().toString() }]);
    setNewRow(EMPTY_TITR);
  };

  const handleAutoPopulateStandardProtocol = () => {
    const startPaco2 = formData.nivtitr_paco2_pre || 56;
    const postPaco2 = formData.nivtitr_paco2_post || 48;
    const startTime = formData.proc_time_start || "19:30";
    const endTime = formData.proc_time_end || "20:30";

    const standardSteps = [
      {
        id: "titr-1",
        time: startTime,
        pressures: "10 / 4",
        spo2: "86%",
        tcco2: `${startPaco2} mmHg`,
        leak: "12 L/min",
        adjustment: "Initiated Spontaneous/Timed BiPAP; full-face mask fitted, leak seal verified",
      },
      {
        id: "titr-2",
        time: "19:55",
        pressures: "12 / 5",
        spo2: "89%",
        tcco2: `${Math.round((Number(startPaco2) + Number(postPaco2)) / 2)} mmHg`,
        leak: "16 L/min",
        adjustment: "Stepped up IPAP +2, EPAP +1 (PS 7 cmH2O) for persistent hypoventilation; O2 2 L/min",
      },
      {
        id: "titr-3",
        time: endTime,
        pressures: "12 / 5",
        spo2: "91%",
        tcco2: `${postPaco2} mmHg`,
        leak: "14 L/min",
        adjustment: `Target ventilation achieved; repeat ABG confirms PaCO2 ${postPaco2} mmHg and pH 7.36`,
      },
    ];

    const updates = {
      nivtitr_log: standardSteps,
      nivtitr_ipap_final: "12",
      nivtitr_final_ipap: "12",
      nivtitr_epap_final: "5",
      nivtitr_final_epap: "5",
      nivtitr_paco2_post: "48",
      nivtitr_ph_post: "7.36",
      nivtitr_target_met: "Yes — target ventilation & PaCO2 achieved",
    };

    if (typeof ctx.updateFields === "function") {
      ctx.updateFields(updates);
    } else {
      Object.entries(updates).forEach(([k, v]) => updateField(k, v));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Section title="Titration Session Setup">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="SESSION DATE" name="nivtitr_date" type="date" />
          <FormField label="BASELINE PaCO2 (mmHg)" name="nivtitr_paco2_pre" placeholder="e.g. 54" />
          <FormField label="BASELINE pH" name="nivtitr_ph_pre" placeholder="e.g. 7.34" />
          <FormField label="STARTING IPAP / EPAP" name="nivtitr_start_press" placeholder="e.g. 12 / 5 cmH2O" />
          <FormField label="SUPPLEMENTAL OXYGEN" name="nivtitr_o2" placeholder="e.g. 2 L/min bleed-in" />
          <FormField label="OPERATOR / TECHNOLOGIST" name="nivtitr_operator" placeholder="e.g. Attending / RT / Operator" />
        </div>
      </Section>

      <Section title="Pressure Titration Log" note="Stepwise IPAP/EPAP titration for ventilatory control">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button
            type="button"
            onClick={handleAutoPopulateStandardProtocol}
            style={{
              fontSize: "11px",
              fontWeight: 600,
              background: "#000000",
              color: "#ffffff",
              border: "none",
              borderRadius: "2px",
              padding: "4px 12px",
              cursor: "pointer",
            }}
          >
            ⚡ Auto-Populate Standard Titration Steps (3-Phase Protocol)
          </button>
        </div>
        <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "0.8fr 1fr 0.8fr 1fr 1fr 1.8fr 36px",
              gap: "8px",
              padding: "8px 12px",
              background: "#f5f5f5",
              borderBottom: "1px solid #e0e0e0",
            }}
          >
            {["Time", "IPAP/EPAP", "SpO2", "TcCO2", "Leak", "Adjustment", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                {h}
              </span>
            ))}
          </div>

          {titrLog.length === 0 ? (
            <div style={{ padding: "18px", textAlign: "center", color: "#666", fontSize: "12px" }}>
              <div style={{ fontStyle: "italic", marginBottom: "8px" }}>No titration steps logged yet.</div>
              <button
                type="button"
                onClick={handleAutoPopulateStandardProtocol}
                style={{
                  padding: "6px 14px",
                  background: "#000",
                  color: "#fff",
                  border: "none",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  borderRadius: "2px",
                }}
              >
                ⚡ Populate Standard 3-Step Titration Protocol
              </button>
            </div>
          ) : (
            titrLog.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "0.8fr 1fr 0.8fr 1fr 1fr 1.8fr 36px",
                  gap: "8px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  borderBottom: "1px solid #f0f0f0",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 600 }}>{row.time}</span>
                <span>{row.pressures}</span>
                <span>{row.spo2}</span>
                <span>{row.tcco2}</span>
                <span>{row.leak}</span>
                <span style={{ color: "#333" }}>{row.adjustment}</span>
                <button
                  onClick={() => updateField("nivtitr_log", titrLog.filter((r) => r.id !== row.id))}
                  style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "8px" }}>
            <input
              type="time"
              value={newRow.time}
              onChange={(e) => setNewRow({ ...newRow, time: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="IPAP/EPAP (e.g. 14/6)"
              value={newRow.pressures}
              onChange={(e) => setNewRow({ ...newRow, pressures: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="SpO2 (e.g. 93%)"
              value={newRow.spo2}
              onChange={(e) => setNewRow({ ...newRow, spo2: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="TcCO2 (e.g. 46 mmHg)"
              value={newRow.tcco2}
              onChange={(e) => setNewRow({ ...newRow, tcco2: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Leak (e.g. 18 L/min)"
              value={newRow.leak}
              onChange={(e) => setNewRow({ ...newRow, leak: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Adjustment made"
              value={newRow.adjustment}
              onChange={(e) => setNewRow({ ...newRow, adjustment: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button
              onClick={handleAddTitr}
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
              Add Titration Step
            </button>
          </div>
        </div>
      </Section>

      <Section title="Final Titrated Settings & Target PaCO2 Confirmation">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="FINAL TITRATED IPAP" name="nivtitr_ipap_final" placeholder="e.g. 16 cmH2O" />
          <FormField label="FINAL TITRATED EPAP" name="nivtitr_epap_final" placeholder="e.g. 6 cmH2O" />
          <FormField label="POST-TITRATION PaCO2 (mmHg)" name="nivtitr_paco2_post" placeholder="e.g. 45" />
          <FormField
            label="TARGET ACHIEVED?"
            name="nivtitr_target_met"
            type="select"
            options={["Yes — target ventilation & PaCO2 achieved", "Partial — reassess in 4 weeks", "No — poor tolerance / excessive leak"]}
          />
        </div>
      </Section>
    </div>
  );
};

// ─── Sub-Tab 5: Adequacy & Complications ────────────────────────────────────
const EMPTY_COMP = { date: "", type: "", action: "" };

const AdequacyComplicationsTab = () => {
  const { formData, updateField } = usePulmonology();
  const compLog = formData.o2_comp_log || [];
  const [newComp, setNewComp] = useState(EMPTY_COMP);

  const handleAddComp = () => {
    if (!newComp.date) return;
    updateField("o2_comp_log", [
      ...compLog,
      { ...newComp, id: Date.now().toString() },
    ]);
    setNewComp(EMPTY_COMP);
  };

  const handleDeleteComp = (id) => {
    updateField(
      "o2_comp_log",
      compLog.filter((r) => r.id !== id)
    );
  };

  return (
    <div>
      <Section title="Ventilatory Adequacy & Gas Exchange">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="RESIDUAL AHI (EVENTS / HOUR)" name="o2_residual_ahi" type="number" placeholder="e.g. 4.2" />
          <FormField label="SKIN BREAKDOWN AT MASK SITE?" name="o2_skin_breakdown" type="checkbox" placeholder="Erythema or pressure ulcer" />
          <FormField
            label="OVERNIGHT GAS EXCHANGE NOTE"
            name="o2_gas_exchange_note"
            type="textarea"
            placeholder="Morning ABG results, symptom relief (reduced morning headaches, refreshed sleep)..."
          />
        </div>
      </Section>

      <Section title="Complication & Troubleshooting Log" note="Skin breakdown, aerophagia, eye irritation, mask claustrophobia">
        <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 2fr 2fr 36px",
              gap: "8px",
              padding: "8px 12px",
              background: "#f5f5f5",
              borderBottom: "1px solid #e0e0e0",
            }}
          >
            {["Date", "Complication Type", "Corrective Action", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                {h}
              </span>
            ))}
          </div>

          {compLog.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
              No device complications logged.
            </div>
          ) : (
            compLog.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 2fr 2fr 36px",
                  gap: "8px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  borderBottom: "1px solid #f0f0f0",
                  alignItems: "center",
                }}
              >
                <span>{row.date}</span>
                <span style={{ fontWeight: 600, color: "#d32f2f" }}>{row.type}</span>
                <span>{row.action}</span>
                <button
                  onClick={() => handleDeleteComp(row.id)}
                  style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 2fr", gap: "8px" }}>
            <input
              type="date"
              value={newComp.date}
              onChange={(e) => setNewComp({ ...newComp, date: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="e.g. Nasal bridge erythema"
              value={newComp.type}
              onChange={(e) => setNewComp({ ...newComp, type: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="e.g. Hydrocolloid dressing + loosened top headgear strap"
              value={newComp.action}
              onChange={(e) => setNewComp({ ...newComp, action: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button
              onClick={handleAddComp}
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
              Add Complication Entry
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

// ─── Main Container ────────────────────────────────────────────────────────
export default function NIVManagement() {
  const { formData, updateField } = usePulmonology();

  const monitorLog = formData.o2_monitor_log || [];

  // Derived: Average SpO2 and Lowest SpO2
  const { avgSpo2, minSpo2 } = useMemo(() => {
    const spo2s = monitorLog
      .map((r) => parseFloat(r.spo2))
      .filter((v) => !isNaN(v) && v > 0);
    if (spo2s.length === 0) return { avgSpo2: null, minSpo2: null };
    const avg = +(spo2s.reduce((a, b) => a + b, 0) / spo2s.length).toFixed(1);
    const min = Math.min(...spo2s);
    return { avgSpo2: avg, minSpo2: min };
  }, [monitorLog]);

  // Sync to shared context so ScreeningAlerts remains active
  useEffect(() => {
    if (minSpo2 !== null && formData.o2_min_spo2 !== String(minSpo2)) {
      updateField("o2_min_spo2", String(minSpo2));
      updateField("pulm_current_spo2", String(minSpo2));
    }
    if (avgSpo2 !== null && formData.o2_avg_spo2 !== String(avgSpo2)) {
      updateField("o2_avg_spo2", String(avgSpo2));
    }
    if (formData.o2_flow_rate && formData.pulm_current_o2_flow !== formData.o2_flow_rate) {
      updateField("pulm_current_o2_flow", formData.o2_flow_rate);
    }
  }, [minSpo2, avgSpo2, formData.o2_min_spo2, formData.o2_avg_spo2, formData.o2_flow_rate, formData.pulm_current_o2_flow, updateField]);

  // Live Hypoxemia alert
  const hasHypoxemia = minSpo2 !== null && minSpo2 < 88;

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
          Respiratory Support (NIV &amp; Oxygen Management)
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Home oxygen devices, BiPAP/CPAP compliance, titration study logs, and ventilatory adequacy.
        </p>
      </div>

      {hasHypoxemia && (
        <div
          style={{
            border: "1px solid #ef9a9a",
            backgroundColor: "#ffebee",
            padding: "14px 18px",
            marginBottom: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#b71c1c", marginBottom: "4px" }}>
            Active Episode Hypoxemia Detected (Lowest SpO2: {minSpo2}%)
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>
            Patient SpO2 dropped below 88% while on prescribed support. Consider flow rate titration, mask refit for leak, or PaCO2 assessment for hypoventilation.
          </p>
        </div>
      )}

      {/* Derived metrics strip if logs present */}
      {avgSpo2 !== null && (
        <div
          style={{
            display: "flex",
            gap: "24px",
            background: "#fafafa",
            padding: "10px 16px",
            border: "1px solid #e0e0e0",
            marginBottom: "16px",
            fontSize: "12px",
          }}
        >
          <span>Average SpO2: <b>{avgSpo2}%</b></span>
          <span>Lowest SpO2: <b style={{ color: minSpo2 < 88 ? "#b71c1c" : "#111" }}>{minSpo2}%</b></span>
          <span>Checkpoints Recorded: <b>{monitorLog.length}</b></span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <DeviceComplianceTab />
        <NivPrepTab />
        <NivMonitoringTab />
        <NIVTitrationSubTab />
        <AdequacyComplicationsTab />
      </div>
    </div>
  );
}
