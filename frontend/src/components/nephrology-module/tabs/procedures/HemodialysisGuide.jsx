import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";

/**
 * HemodialysisGuide Component
 * Comprehensive procedural flowsheet and operative record for Hemodialysis, SLED,
 * and Continuous Renal Replacement Therapy (CRRT).
 */
const HemodialysisGuide = () => {
  const { formData, updateField } = useNephrology();
  const modality = formData["hd_modality_type"] || "hd_maintenance";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Modality Selector Header */}
      <div style={{ background: "#f8fafc", padding: "14px 20px", border: "1px solid #e2e8f0", borderRadius: "3px", display: "flex", alignItems: "center", gap: "20px" }}>
        <span style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#1e293b" }}>
          THERAPY MODALITY:
        </span>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {[
            { id: "hd_maintenance", label: "Chronic Maintenance HD" },
            { id: "hd_acute", label: "Acute Inpatient HD / SLED" },
            { id: "crrt", label: "Continuous RRT (CRRT)" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => updateField("hd_modality_type", m.id)}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "6px 16px",
                borderRadius: "2px",
                cursor: "pointer",
                border: "1px solid #000000",
                background: modality === m.id ? "#000000" : "#ffffff",
                color: modality === m.id ? "#ffffff" : "#000000",
                transition: "all 0.15s",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Pre-Procedure Parameters & Machine Setup */}
      <Section title="Pre-Dialysis Parameters & Circuit Configuration" note="Prescription verification prior to connection">
        {/* Row 1: Machine, Dialyzer, Surface Area (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Machine ID / Station #" name="hd_machine_id" placeholder="e.g. Station #03" />
          <FormField
            label="Dialyzer / Hemofilter Model"
            name="dialyzer_type"
            type="select"
            options={[
              "High-Flux Polysulfone (Optiflux F180 / FX80)",
              "High-Flux Polyflux 210H",
              "Low-Flux Cellulose Diacetate",
              "Hemodiafiltration Filter (CorDiax 800)",
              "CRRT Hemofilter AN69 (ST100 / ST150)",
              "CRRT Oxiris Filter (Endotoxin / Cytokine adsorber)",
            ]}
          />
          <FormField label="Membrane Surface Area (m²)" name="hd_membrane_area" placeholder="e.g. 1.8 m²" />
        </div>

        {/* Row 2: Access & Needle Gauge (2:1 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Vascular Access Used"
            name="hd_access_used"
            type="select"
            options={[
              "Native Radiocephalic AV Fistula (AVF)",
              "Native Brachiocephalic AV Fistula (AVF)",
              "Prosthetic PTFE AV Graft (AVG)",
              "Tunneled CVC (Permcath — Internal Jugular)",
              "Temporary Non-Tunneled CVC (Internal Jugular)",
              "Temporary Femoral Line (Bedside acute)",
            ]}
          />
          <FormField
            label="Needle Gauge / Lumen Size"
            name="hd_needle_gauge"
            type="select"
            options={[
              "15 Gauge (Qb >350 mL/min)",
              "16 Gauge (Qb 300-350 mL/min)",
              "17 Gauge (New fistula / Qb <250)",
              "Dual Lumen Catheter (12 Fr / 14 Fr)",
            ]}
          />
        </div>

        {/* Row 3: Priming & Duration (2:1 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "20px" }}>
          <FormField
            label="Priming Solution & Volume"
            name="hd_priming"
            type="select"
            options={[
              "Normal Saline 1000 mL with 5000 IU Heparin (Flushed)",
              "Normal Saline 1000 mL Heparin-Free (Rinsed)",
              "Albumin pre-coat for high-flux sensitivity",
            ]}
          />
          <FormField label="Session Duration (Hours)" name="hd_duration_hours" placeholder="e.g. 4.0h (HD) / 8.0h (SLED)" />
        </div>

        {/* Sub-Header: Weight & Flows */}
        <div style={{ padding: "10px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "3px", marginBottom: "16px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#475569" }}>
            Patient Weights, Ultrafiltration Goals & Flow Rates
          </span>
        </div>

        {/* Prescription Numbers: Weights & Ultrafiltration (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Pre-Session Weight (kg)" name="hd_pre_weight" placeholder="e.g. 72.4 kg" />
          <FormField label="Target Dry Weight (kg)" name="hd_dry_weight" placeholder="e.g. 69.5 kg" />
          <FormField label="Target Ultrafiltration (L)" name="hd_target_uf" placeholder="e.g. 2.9 L" />
        </div>

        {/* Prescription Numbers: Flow Rates (2 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          <FormField label="Prescribed Blood Flow (Qb)" name="hd_qb" placeholder="e.g. 350 mL/min" />
          <FormField label="Prescribed Dialysate Flow (Qd)" name="hd_qd" placeholder="e.g. 500 mL/min" />
        </div>
      </Section>

      {/* 2. Dialysate Bath & Anticoagulation */}
      <Section title="Dialysate Bath Composition & Anticoagulation" note="Individualized chemical and clotting management">
        {/* 3 columns on row 1, 3 columns on row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Potassium (K+) Bath"
            name="hd_k_bath"
            type="select"
            options={["2.0 mEq/L (Standard maintenance)", "1.0 mEq/L (Severe hyperkalemia)", "3.0 mEq/L (Hypokalemia prone / Digoxin)", "4.0 mEq/L"]}
          />
          <FormField
            label="Calcium (Ca2+) Bath"
            name="hd_ca_bath"
            type="select"
            options={["2.5 mEq/L (Standard 1.25 mmol/L)", "3.0 mEq/L (High calcium bath)", "2.0 mEq/L (Low calcium for hypercalcemia)"]}
          />
          <FormField
            label="Sodium (Na+) Profiling"
            name="hd_na_bath"
            type="select"
            options={["Constant 138 mEq/L", "Linear Step-Down 144 → 138 mEq/L (Cramp prevention)", "Constant 140 mEq/L", "Low Sodium 135 mEq/L (HTN control)"]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px" }}>
          <FormField
            label="Bicarbonate Buffer"
            name="hd_bicarb_bath"
            type="select"
            options={["35 mEq/L (Standard)", "32 mEq/L (Alkalosis prone)", "38 mEq/L (Severe metabolic acidosis)"]}
          />
          <FormField
            label="Anticoagulation Protocol"
            name="hd_heparin"
            type="select"
            options={[
              "Standard Heparin: 2000 IU bolus + 1000 IU/hr",
              "Low-Dose Heparin: 1000 IU bolus + 500 IU/hr",
              "Heparin-Free (NS Flush 100 mL q30m)",
              "LMWH: Enoxaparin 0.7 mg/kg single dose",
              "Regional Citrate Anticoagulation (RCA)",
            ]}
          />
          <FormField label="Dialysate Temperature (°C)" name="hd_temp" placeholder="e.g. 36.0°C (Isothermic / Cool)" />
        </div>

        {/* CRRT Specifics if CRRT selected */}
        {modality === "crrt" && (
          <div style={{ background: "#f8fafc", padding: "16px 20px", border: "1px solid #cbd5e1", borderRadius: "3px", marginTop: "20px" }}>
            <h4 style={{ margin: "0 0 14px 0", fontSize: "12px", fontWeight: 700, color: "#1e3a8a", textTransform: "uppercase" }}>
              CRRT Operational Settings & Regional Citrate Anticoagulation
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
              <FormField
                label="CRRT Mode"
                name="crrt_mode"
                type="select"
                options={[
                  "Continuous Veno-Venous Hemodiafiltration (CVVHDF)",
                  "Continuous Veno-Venous Hemofiltration (CVVH)",
                  "Continuous Veno-Venous Hemodialysis (CVVHD)",
                  "Slow Continuous Ultrafiltration (SCUF)",
                ]}
              />
              <FormField label="Effluent Dose Target (mL/kg/hr)" name="crrt_effluent_dose" placeholder="e.g. 25-30 mL/kg/hr (KDIGO)" />
              <FormField label="Pre-Filter Replacement (mL/hr)" name="crrt_pre_filter_rate" placeholder="e.g. 1000 mL/hr" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px" }}>
              <FormField label="Post-Filter Replacement (mL/hr)" name="crrt_post_filter_rate" placeholder="e.g. 500 mL/hr" />
              <FormField label="Citrate Infusion Rate (ACD-A mL/hr)" name="crrt_citrate_rate" placeholder="e.g. 150 mL/hr" />
              <FormField label="Calcium Chloride Infusion (mL/hr)" name="crrt_cacl2_rate" placeholder="e.g. 20 mL/hr" />
            </div>
          </div>
        )}
      </Section>

      {/* 3. Intra-Procedure Monitoring Flowsheet */}
      <Section title="Intra-Dialytic Hemodynamic & Pressure Run Log" note="Monitored hourly throughout procedure">
        {/* Row 1: Pressures & Vitals (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Pre-Dialysis Blood Pressure" name="hd_pre_bp" placeholder="e.g. 148/88 mmHg" />
          <FormField label="Pre-Dialysis Pulse & Temp" name="hd_pre_hr_temp" placeholder="e.g. 78 bpm, 36.6°C" />
          <FormField label="Arterial Access Pressure (mmHg)" name="hd_arterial_press" placeholder="e.g. -150 mmHg (Normal -100 to -200)" />
        </div>

        {/* Row 2: Venous, TMP, UF Rate (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "20px" }}>
          <FormField label="Venous Return Pressure (mmHg)" name="hd_venous_press" placeholder="e.g. +140 mmHg (Normal <+200)" />
          <FormField label="Transmembrane Pressure (TMP)" name="hd_tmp" placeholder="e.g. 110 mmHg" />
          <FormField label="Current UF Rate (L/hr)" name="hd_uf_rate" placeholder="e.g. 0.70 L/hr" />
        </div>

        {/* Row 3: Events & Interventions (2 columns balanced 50/50) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Intradialytic Adverse Events"
            name="hd_adverse_events"
            type="select"
            options={[
              "None — Smooth run without hemodynamic instability",
              "Intradialytic Hypotension (SBP drop >20 mmHg)",
              "Severe Muscle Cramping (Lower extremities)",
              "Chest Pain / Anginal Equivalent",
              "Nausea, Vomiting or Dialysis Disequilibrium",
              "Clotted Dialyzer / Circuit Clotting Event",
              "Blood Leak Alarm / Line Separation Alert",
            ]}
          />
          <FormField
            label="Nursing Interventions Administered"
            name="hd_nursing_interventions"
            type="select"
            options={[
              "None required",
              "Normal Saline Bolus 100-250 mL IV given",
              "UF rate reduced / UF turned to minimum",
              "Trendelenburg position applied",
              "Hypertonic Saline (3%) 10 mL IV given for cramps",
              "Midodrine 5mg administered orally",
              "20% Albumin 100 mL infused",
            ]}
          />
        </div>

        {/* Row 4: Run Notes */}
        <div>
          <FormField
            label="Intra-Procedure Clinical Run Notes"
            name="hd_complications_notes"
            type="textarea"
            placeholder="Document machine alarms, patient symptoms, blood flow adjustments, access recirculation checks, or medication administrations..."
          />
        </div>
      </Section>

      {/* 4. Post-Procedure Closeout & Dialysis Clearance */}
      <Section title="Post-Procedure Closeout & Dialytic Adequacy" note="Completed at disconnection">
        {/* Row 1: 4 balanced columns for final weights and pressures */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Post-Session Weight (kg)" name="hd_post_weight" placeholder="e.g. 69.6 kg" />
          <FormField label="Total UF Removed (L)" name="hd_total_uf_removed" placeholder="e.g. 2.85 L" />
          <FormField label="Post-Session BP (Sitting)" name="hd_post_bp" placeholder="e.g. 124/76 mmHg" />
          <FormField label="Post-Session BP (Standing)" name="hd_post_bp_standing" placeholder="e.g. 118/72 mmHg" />
        </div>

        {/* Row 2: 2 balanced columns for Access Hemostasis & Catheter Locking */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Access Hemostasis & Decannulation"
            name="hd_hemostasis"
            type="select"
            options={[
              "Hemostasis achieved in <15 mins with light pressure",
              "Prolonged bleeding (20-30 mins) — Hemostatic sponge applied",
              "Prolonged bleeding (>30 mins) — Heparin dose reduced for next run",
              "Catheter lumens locked with sterile technique",
            ]}
          />
          <FormField
            label="Catheter Locking Protocol (if CVC used)"
            name="hd_catheter_lock"
            type="select"
            options={[
              "N/A — AV Fistula / Graft used",
              "Standard Heparin Lock 5000 U/mL (Exact lumen volumes instill)",
              "Sodium Citrate 4% antimicrobial lock",
              "Tissue Plasminogen Activator (tPA) dwell for sluggish flow",
            ]}
          />
        </div>

        {/* Row 3: Clearance indices (2 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          <FormField label="Single-Pool Delivered Kt/V" name="hd_delivered_ktv" placeholder="e.g. 1.45 (Adequate >1.2)" />
          <FormField label="Urea Reduction Ratio (URR %)" name="hd_delivered_urr" placeholder="e.g. 71% (Adequate >65%)" />
        </div>
      </Section>
    </div>
  );
};

export default HemodialysisGuide;
