import React, { useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";

// --- Pure Helper: Physiologic SpO2 Target Engine ---
export function suggestO2Target({ isCopdFamily, paco2 }) {
  const co2 = parseFloat(paco2);

  if (!isCopdFamily) {
    return {
      targetRange: "94–98%",
      phenotype: "Standard Gas Exchange (Non-Retainer)",
      rationale: "Target normoxemia (94–98%) for patients without chronic hypercapnic respiratory failure risk.",
      color: "#2e7d32",
      bg: "#f0fdf4",
      border: "#81c784",
    };
  }

  if (!isNaN(co2) && co2 > 45) {
    return {
      targetRange: "88–92% (CO2 Retainer Target)",
      phenotype: "Chronic CO2 Retainer (Hypercapnic)",
      rationale: `Arterial PaCO2 is ${co2} mmHg (>45 mmHg). Titrate supplemental oxygen strictly to 88–92% to prevent suppression of hypoxic respiratory drive, worsening hypercapnic acidosis, and V/Q mismatch.`,
      color: "#b71c1c",
      bg: "#ffebee",
      border: "#ef9a9a",
    };
  }

  return {
    targetRange: "90–94% (COPD Intermediate Target)",
    phenotype: "COPD / Obstructive (Non-Retainer / Pending ABG)",
    rationale: "Target 90–94% in confirmed COPD to maintain tissue oxygen delivery while preventing acute-on-chronic CO2 retention pending formal ABG confirmation.",
    color: "#e65100",
    bg: "#fff3e0",
    border: "#ffcc80",
  };
}

// --- Sub-Tab Definitions ---
const SUB_TABS = [
  { id: "oxygen", label: "Oxygen Prescription & Targets" },
  { id: "clearance", label: "Airway Clearance & Secretions" },
  { id: "vent_bridge", label: "NIV & Invasive Airway Status" },
];

export default function AirwaySupportTab() {
  const { formData, updateField, setTrack, setActiveTab } = usePulmonology();
  const activeSubTab = formData.subtab_airway_support || "oxygen";
  const setActiveSubTab = (id) => updateField("subtab_airway_support", id);

  // Derive COPD family classification
  const isCopdFamily = useMemo(() => {
    const dx = (formData.pulm_primary_dx || "").toLowerCase();
    return dx.includes("copd") || dx.includes("overlap") || dx.includes("emphysema");
  }, [formData.pulm_primary_dx]);

  // Derive Physiologic Target SpO2
  const o2Target = useMemo(() => {
    return suggestO2Target({
      isCopdFamily,
      paco2: formData.pulm_current_paco2,
    });
  }, [isCopdFamily, formData.pulm_current_paco2]);

  const isRoomAir = !formData.air_o2_device || formData.air_o2_device.toLowerCase().includes("none") || formData.air_o2_device.toLowerCase().includes("room air");

  useEffect(() => {
    if (formData.air_o2_target_spo2 !== o2Target.targetRange) {
      updateField("air_o2_target_spo2", o2Target.targetRange);
    }
    if (!formData.air_o2_device) {
      updateField("air_o2_device", "None — room air");
    }
    if (!formData.air_o2_prescriber && formData.team_pulmonologist) {
      updateField("air_o2_prescriber", formData.team_pulmonologist);
    }
    // Auto-populate 0 for room air so fields do not remain empty
    if (isRoomAir) {
      if (formData.med_o2_flow === undefined || formData.med_o2_flow === "") {
        updateField("med_o2_flow", 0);
      }
      if (formData.med_o2_hours === undefined || formData.med_o2_hours === "") {
        updateField("med_o2_hours", 0);
      }
      if (formData.air_o2_exertion_flow === undefined || formData.air_o2_exertion_flow === "") {
        updateField("air_o2_exertion_flow", 0);
      }
    }
  }, [o2Target.targetRange, formData.air_o2_target_spo2, formData.air_o2_device, formData.air_o2_prescriber, formData.team_pulmonologist, isRoomAir, formData.med_o2_flow, formData.med_o2_hours, formData.air_o2_exertion_flow, updateField]);

  // Hypoxemia Escalation Flag from ScreeningAlerts
  const hypoxemiaAlert = formData.alert_hypoxemia;
  const isHypoxemiaEscalated =
    hypoxemiaAlert &&
    (hypoxemiaAlert.includes("Active") || hypoxemiaAlert.includes("NOT Prescribed"));

  return (
    <div>
      {/* Header Banner */}
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
          Airway Support, Oxygen Delivery &amp; Clearance Modalities
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Physiologic oxygen target titration (preventing CO2 retention), active hypoxemia escalation, chest physiotherapy, and ventilatory status bridge.
        </p>
      </div>

      <VoiceDictationPanel section="Oxygen & Airway Support" />

      {/* Active Hypoxemia Escalation Banner */}
      {isHypoxemiaEscalated && (
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
            URGENT CLINICAL ESCALATION: Hypoxemia Criteria Met — Oxygen Prescription Required
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#333", lineHeight: "1.4" }}>
            Patient has active resting hypoxemia (SpO2 ≤ 88% or PaO2 ≤ 55 mmHg) identified in Screening &amp; Diagnostics, but is currently documented as <b>NOT on prescribed home oxygen</b>. Complete the prescription below or initiate urgent trial.
          </p>
        </div>
      )}

      {/* Target SpO2 Guidance Card */}
      <div
        style={{
          border: `1px solid ${o2Target.border}`,
          backgroundColor: o2Target.bg,
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
              backgroundColor: o2Target.color,
              color: "#fff",
              padding: "2px 8px",
              borderRadius: "2px",
              marginRight: "8px",
            }}
          >
            Prescribed Target: {o2Target.targetRange}
          </span>
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#222" }}>
            {o2Target.phenotype}
          </span>
          <p style={{ margin: "4px 0 0", fontSize: "11.5px", color: "#444" }}>
            {o2Target.rationale}
          </p>
        </div>
        <div style={{ fontSize: "11.5px", color: "#666", textAlign: "right" }}>
          Current PaCO2: <b>{formData.pulm_current_paco2 ? `${formData.pulm_current_paco2} mmHg` : "Not recorded"}</b>
        </div>
      </div>

      {/* ─── 1: Oxygen Prescription & Targets ─────────────────── */}
      <Section title="Supplemental Oxygen Delivery & Regimen">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField
              label="OXYGEN DELIVERY DEVICE"
              name="air_o2_device"
              type="select"
              options={[
                "None — room air",
                "Nasal Cannula (Low-flow 1–6 L/min)",
                "Venturi Mask (Controlled FiO2: 24%, 28%, 35%, 40%)",
                "Non-Rebreather Mask with reservoir bag (High-flow)",
                "High-Flow Nasal Cannula (HFNC with humidification)",
                "Home Oxygen Concentrator (Continuous / Nocturnal)",
                "Portable Ambulatory O2 Cylinder",
              ]}
            />
            <FormField
              label="PRESCRIBED RESTING FLOW RATE (L/min)"
              name="med_o2_flow"
              type="number"
              placeholder={isRoomAir ? "0 (N/A — Room Air)" : "e.g. 2.0 (synchronized with Baseline)"}
            />
            <FormField
              label="PRESCRIBED HOURS PER DAY"
              name="med_o2_hours"
              type="number"
              placeholder={isRoomAir ? "0 (N/A — Room Air)" : "e.g. 15 (≥15h/day for mortality benefit)"}
            />
            <FormField
              label="EXERTIONAL OXYGEN TITRATION"
              name="air_o2_exertion_flow"
              type="number"
              placeholder={isRoomAir ? "0 (N/A — Room Air)" : "e.g. 3.5 L/min during 6MWT / ambulation"}
            />
            <FormField
              label="TARGET SpO2 RANGE (AUTO-RECOMMENDED)"
              name="air_o2_target_spo2"
              type="derived"
              derivedValue={o2Target.targetRange}
            />
            <FormField
              label="PRESCRIBING CLINICIAN"
              name="air_o2_prescriber"
              placeholder="e.g. Attending / Prescribing Pulmonologist"
            />
          </div>
        </Section>

      {/* ─── 2: Airway Clearance & Secretions ─────────────────── */}
      <div>
        <Section title="Secretion Burden & Sputum Characterization" note="Key assessment in bronchiectasis, COPD exacerbators, and neuromuscular disease">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
              <FormField
                label="DAILY SECRETION VOLUME"
                name="air_secretion_volume"
                type="select"
                options={[
                  "Scant / Minimal (<10 mL / day)",
                  "Moderate (10–30 mL / day)",
                  "Copious / Excessive (>30 mL / day — pooling)",
                ]}
              />
              <FormField
                label="SECRETION CHARACTER"
                name="air_secretion_character"
                type="select"
                options={[
                  "Clear / Mucoid (Normal / Non-infected)",
                  "Tenacious / Thick viscid mucus plug",
                  "Purulent / Yellow-Green (Active bacterial infection)",
                  "Blood-tinged / Hemoptoic streaks",
                  "Frank hemoptysis (>50 mL — urgent review)",
                ]}
              />
              <FormField
                label="COUGH EFFECTIVENESS & PEAK EXPIRATORY FLOW"
                name="air_cough_strength"
                type="select"
                options={[
                  "Strong / Effective spontaneous cough clearance",
                  "Weak / Ineffective cough (Peak cough flow <160 L/min)",
                  "Absent spontaneous cough reflex",
                ]}
              />
            </div>
          </Section>

          <Section title="Active Airway Clearance Modalities Prescribed">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
              <FormField
                label="CHEST PHYSIOTHERAPY & POSTURAL DRAINAGE?"
                name="air_clearance_physio"
                type="checkbox"
                placeholder="Active cycle of breathing / autogenic drainage"
              />
              <FormField
                label="OSCILLATORY PEP DEVICE (ACAPELLA / FLUTTER)?"
                name="air_clearance_pep"
                type="checkbox"
                placeholder="Oscillatory positive expiratory pressure"
              />
              <FormField
                label="MECHANICAL COUGH ASSIST (INSUFFLATION-EXSUFFLATION)?"
                name="air_clearance_coughassist"
                type="checkbox"
                placeholder="CoughAssist prescribed for bulbar weakness"
              />
              <FormField
                label="INHALED HYPERTONIC SALINE (3% OR 7%)?"
                name="air_clearance_hypertonic"
                type="checkbox"
                placeholder="Osmotic mucus mobilizer"
              />
            </div>

            <div style={{ marginTop: "16px" }}>
              <FormField
                label="AIRWAY CLEARANCE PLAN & REGIMEN NOTES"
                name="air_clearance_notes"
                type="textarea"
                placeholder="e.g. Acapella choice 15 breaths x 3 sets twice daily; 4 mL 7% hypertonic saline neb 15 mins prior to clearance sessions..."
              />
            </div>
          </Section>
        </div>

      {/* ─── 3: Ventilatory Support Bridge (NIV & Trach) ───────── */}
      <div>
        <Section title="Non-Invasive Ventilation (NIV / BiPAP) Summary" note="Managed in detail under the Advanced Interventions Phase">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField
                label="CURRENT DEVICE TYPE"
                name="o2_device_type"
                type="derived"
                derivedValue={formData.o2_device_type || "No device configured"}
              />
              <FormField
                label="PRESCRIBED IPAP / EPAP"
                name="niv_pressures_summary"
                type="derived"
                derivedValue={
                  formData.nivprep_ipap && formData.nivprep_epap
                    ? `${formData.nivprep_ipap} / ${formData.nivprep_epap} cmH2O`
                    : "Not set"
                }
              />
              <FormField
                label="AVERAGE COMPLIANCE (HRS/NIGHT)"
                name="o2_compliance_hrs"
                type="derived"
                derivedValue={formData.o2_compliance_hrs ? `${formData.o2_compliance_hrs} hrs/night` : "Pending download"}
              />
            </div>
            <button
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("open_procedure_notes", { detail: { procedure: "Pulmonology Procedures", subProcedure: "niv" } })
                );
                alert("To document the NIV / BiPAP Titration Study, please open the 'Procedure Notes' workspace from the menu. Saved procedure records will automatically update Diagnostics & Screening and advance the encounter to Post-Procedure Monitoring.");
              }}
              style={{
                padding: "7px 16px",
                background: "#000",
                color: "#fff",
                border: "none",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Open Advanced Respiratory Support (NIV/O2) →
            </button>
          </Section>

          <Section title="Invasive Airway / Tracheostomy Status" note="Managed in detail under Tracheostomy Guide in Pulmonary Procedures">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
              <FormField
                label="TRACH TUBE IN SITU?"
                name="trach_status_summary"
                type="derived"
                derivedValue={formData.trach_tube_size ? `Yes (${formData.trach_tube_size})` : "No tracheostomy documented"}
              />
              <FormField
                label="WEANING READINESS"
                name="trach_weaning_summary"
                type="derived"
                derivedValue={formData.trach_decannulation_score || "Not assessed"}
              />
            </div>
            <button
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("open_procedure_notes", { detail: { procedure: "Pulmonology Procedures", subProcedure: "trach" } })
                );
                alert("To document the Tracheostomy procedure, please open the 'Procedure Notes' workspace from the menu.");
              }}
              style={{
                padding: "7px 16px",
                background: "#000",
                color: "#fff",
                border: "none",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Open Tracheostomy Guide →
            </button>
          </Section>
        </div>
    </div>
  );
}
