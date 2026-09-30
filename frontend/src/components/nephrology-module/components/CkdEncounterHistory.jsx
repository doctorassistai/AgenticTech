import React from "react";

const present = (value) => value !== undefined && value !== null && value !== "";
const field = (data, key) => present(data?.[key]) ? data[key] : "-";

const medicationRows = (data) => {
  const rows = Array.isArray(data?.v2_ckd_meds) ? data.v2_ckd_meds : [];
  if (!rows.length) return "-";
  return rows.map((row) => {
    const name = row.drugName || row.drug;
    if (!name) return null;
    const dose = row.currentDose || [row.dose, row.freq].filter(Boolean).join(" ");
    const action = row.action || "Active";
    return [name, dose, action].filter(Boolean).join(" | ");
  }).filter(Boolean).join("; ") || "-";
};

const SECTIONS = {
  // Overview Tab
  overview_glance: {
    title: "Previous CKD Dashboard & Risk Stage",
    keys: ["v2_ckd_diag_date", "v2_risk_kdigo_stage", "v2_bp_alert", "v2_k_level", "v2_anemia_hb"],
    columns: [
      ["KDIGO Stage", (data) => field(data, "v2_risk_kdigo_stage")],
      ["BP Alert", (data) => field(data, "v2_bp_alert")],
      ["K+ Level", (data) => field(data, "v2_k_level")],
      ["Hgb Trend", (data) => field(data, "v2_anemia_hb")],
    ],
  },
  overview_vaccines: {
    title: "Previous Vaccination Records",
    keys: ["v2_ckd_vac_hepb", "v2_ckd_vac_pneumo", "v2_ckd_vac_flu", "v2_ckd_vac_covid"],
    columns: [
      ["Hep B", (data) => field(data, "v2_ckd_vac_hepb")],
      ["Pneumococcal", (data) => field(data, "v2_ckd_vac_pneumo")],
      ["Influenza", (data) => field(data, "v2_ckd_vac_flu")],
      ["COVID-19", (data) => field(data, "v2_ckd_vac_covid")],
    ],
  },
  
  // Progression Tab
  progression_kdigo: {
    title: "Previous KDIGO Staging",
    keys: ["v2_risk_kdigo_g", "v2_risk_kdigo_a", "v2_risk_kdigo_stage", "v2_risk_kdigo_risk_level"],
    columns: [
      ["GFR Category (G)", (data) => field(data, "v2_risk_kdigo_g")],
      ["Albuminuria (A)", (data) => field(data, "v2_risk_kdigo_a")],
      ["Stage / Risk", (data) => `${field(data, "v2_risk_kdigo_stage")} / ${field(data, "v2_risk_kdigo_risk_level")}`],
    ],
  },
  progression_risk: {
    title: "Previous Risk Model Predictions",
    keys: ["v2_risk_egfr_decline", "v2_risk_esrd", "v2_risk_cv", "v2_risk_category"],
    columns: [
      ["eGFR Decline Risk", (data) => present(data.v2_risk_egfr_decline) ? `${data.v2_risk_egfr_decline}%` : "-"],
      ["ESRD Risk (1/3/5 Yr)", (data) => field(data, "v2_risk_esrd")],
      ["CV Event Risk", (data) => field(data, "v2_risk_cv")],
      ["Risk Category", (data) => field(data, "v2_risk_category")],
    ],
  },
  progression_sim: {
    title: "Previous Trajectory Simulations",
    keys: ["v2_risk_sim_action", "v2_risk_sim_result"],
    columns: [
      ["Simulated Action", (data) => field(data, "v2_risk_sim_action")],
      ["Projected Impact", (data) => field(data, "v2_risk_sim_result")],
    ],
  },
  progression_care_plan: {
    title: "Previous Care Planning & Referrals",
    keys: ["v2_risk_care_visits", "v2_risk_care_labs", "v2_risk_care_referral_target", "v2_risk_care_referral_status"],
    columns: [
      ["Visit Frequency", (data) => field(data, "v2_risk_care_visits")],
      ["Lab Frequency", (data) => field(data, "v2_risk_care_labs")],
      ["Referral Target", (data) => field(data, "v2_risk_care_referral_target")],
      ["Referral Status", (data) => field(data, "v2_risk_care_referral_status")],
    ],
  },
  progression_rrt: {
    title: "Previous RRT Transition Planning",
    keys: ["v2_rrt_vein_mapping", "v2_rrt_surg_consult", "v2_rrt_education", "v2_rrt_tx_workup"],
    columns: [
      ["Vein Mapping", (data) => field(data, "v2_rrt_vein_mapping")],
      ["Surg Consult", (data) => field(data, "v2_rrt_surg_consult")],
      ["RRT Education", (data) => field(data, "v2_rrt_education")],
      ["Transplant Workup", (data) => field(data, "v2_rrt_tx_workup")],
    ],
  },
  progression_llm: {
    title: "Previous Clinical Trajectory Insights",
    keys: ["v2_risk_ai_accel", "v2_risk_ai_subgroup", "v2_risk_ai_shap"],
    columns: [
      ["Trajectory Alert", (data) => field(data, "v2_risk_ai_accel")],
      ["Key Risk Drivers", (data) => field(data, "v2_risk_ai_shap")],
    ],
  },

  // Medications Tab
  medication_reconciliation: {
    title: "Previous Medication Reconciliation",
    keys: ["v2_ckd_meds"],
    columns: [
      ["Drugs, Dose & Action", medicationRows],
    ],
  },

  // Complication Engine Tab
  complication_anemia: {
    title: "Previous Anemia Management",
    keys: ["v2_anemia_hb", "v2_anemia_ferritin", "v2_iron_crit", "v2_esa_ind", "v2_iron_order", "v2_esa_drug"],
    columns: [
      ["Hgb / Ferritin", (data) => `${field(data, "v2_anemia_hb")} / ${field(data, "v2_anemia_ferritin")}`],
      ["Iron Status", (data) => field(data, "v2_iron_crit")],
      ["Iron Order", (data) => field(data, "v2_iron_order")],
      ["ESA Selection", (data) => field(data, "v2_esa_drug")],
    ],
  },
  complication_mbd: {
    title: "Previous CKD-MBD Tracking",
    keys: ["v2_mbd_ca", "v2_mbd_po4", "v2_mbd_pth", "v2_mbd_binder_drug", "v2_mbd_active_vitd_drug"],
    columns: [
      ["Ca / PO4 / PTH", (data) => `${field(data, "v2_mbd_ca")} / ${field(data, "v2_mbd_po4")} / ${field(data, "v2_mbd_pth")}`],
      ["Phosphate Binder", (data) => field(data, "v2_mbd_binder_drug")],
      ["Active Vit D", (data) => field(data, "v2_mbd_active_vitd_drug")],
    ],
  },
  complication_fluid: {
    title: "Previous Fluid & Electrolyte Intel",
    keys: ["v2_elec_na", "v2_elec_k", "v2_elec_acidbase_interp", "v2_fluid_net", "v2_fluid_clinical"],
    columns: [
      ["Na+ / K+", (data) => `${field(data, "v2_elec_na")} / ${field(data, "v2_elec_k")}`],
      ["Acid-Base", (data) => field(data, "v2_elec_acidbase_interp")],
      ["Fluid Balance / Status", (data) => `${field(data, "v2_fluid_net")} / ${field(data, "v2_fluid_clinical")}`],
    ],
  },

  // HTN & Diabetes Tab
  htn_bp: {
    title: "Previous Blood Pressure Tracking",
    keys: ["v2_bp_office", "v2_bp_home", "v2_bp_target", "v2_bp_alert"],
    columns: [
      ["Office / Home BP", (data) => `${field(data, "v2_bp_office")} / ${field(data, "v2_bp_home")}`],
      ["Target", (data) => field(data, "v2_bp_target")],
      ["Alert Status", (data) => field(data, "v2_bp_alert")],
    ],
  },
  htn_raas: {
    title: "Previous RAASi Optimization",
    keys: ["v2_raas_indicated", "v2_raas_current_dose", "v2_raas_target_dose", "v2_raas_hold"],
    columns: [
      ["Indicated", (data) => field(data, "v2_raas_indicated")],
      ["Current / Target Dose", (data) => `${field(data, "v2_raas_current_dose")} / ${field(data, "v2_raas_target_dose")}`],
      ["Hold Triggered", (data) => field(data, "v2_raas_hold")],
    ],
  },
  htn_sglt2: {
    title: "Previous SGLT2i & nsMRA Interventions",
    keys: ["v2_sglt2_elig", "v2_sglt2_drug", "v2_mra_dose", "v2_k_level", "v2_k_binder"],
    columns: [
      ["SGLT2i", (data) => field(data, "v2_sglt2_drug")],
      ["nsMRA", (data) => field(data, "v2_mra_dose")],
      ["K+ Level", (data) => field(data, "v2_k_level")],
      ["K+ Binder", (data) => field(data, "v2_k_binder")],
    ],
  },
  htn_metabolic: {
    title: "Previous Metabolic & Lifestyle Risk",
    keys: ["v2_dm_hba1c", "v2_dm_glp1", "v2_lipid_ldl", "v2_lipid_statin", "v2_lifestyle_bmi", "v2_smoke_status"],
    columns: [
      ["HbA1c / GLP-1", (data) => `${field(data, "v2_dm_hba1c")} / ${field(data, "v2_dm_glp1")}`],
      ["LDL / Statin", (data) => `${field(data, "v2_lipid_ldl")} / ${field(data, "v2_lipid_statin")}`],
      ["BMI / Smoking", (data) => `${field(data, "v2_lifestyle_bmi")} / ${field(data, "v2_smoke_status")}`],
    ],
  },
};

const CkdEncounterHistory = ({ sessions = [], currentSessionId = "", section = "", onOpenEncounter }) => {
  const config = SECTIONS[section];
  if (!config) return null;
  const chronological = [...sessions].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || String(a.session_id || "").localeCompare(String(b.session_id || "")));
  const numbers = new Map(chronological.map((session, index) => [session.session_id, index + 1]));
  
  const currentIndex = currentSessionId ? chronological.findIndex(s => s.session_id === currentSessionId) : chronological.length;
  const eligibleSessions = currentIndex !== -1 ? chronological.slice(0, currentIndex) : chronological;

  const rows = eligibleSessions.filter((session) => config.keys.some((key) => present(session.data?.[key]))).reverse();
  if (!rows.length) return null;

  const cellStyle = { padding: "8px", borderBottom: "1px solid #e5e5e5", verticalAlign: "top", maxWidth: "320px", overflowWrap: "anywhere" };
  return (
    <div style={{ marginBottom: "12px", border: "1px solid #cfcfcf", borderRadius: "3px", overflowX: "auto", background: "#fff" }}>
      <div style={{ background: "#eeeeee", borderBottom: "1px solid #cfcfcf", padding: "8px 10px", fontSize: "11px", fontWeight: 600, color: "#333" }}>{config.title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px", fontSize: "11px" }}>
        <thead><tr style={{ background: "#f7f7f7", textAlign: "left" }}>{["Date", "Encounter", ...config.columns.map(([label]) => label), ""].map((label, index) => <th key={`${label}-${index}`} style={{ padding: "8px", borderBottom: "1px solid #d9d9d9", color: "#555", fontWeight: 600 }}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((session) => <tr key={session.session_id}>
          <td style={cellStyle}>{session.created_at ? new Date(session.created_at).toLocaleDateString() : "-"}</td>
          <td style={cellStyle}>#{numbers.get(session.session_id) || "-"}</td>
          {config.columns.map(([label, get]) => <td key={label} style={cellStyle}>{get(session.data || {})}</td>)}
          <td style={cellStyle}><button type="button" onClick={() => onOpenEncounter?.(session.session_id)} style={{ border: "1px solid #999", background: "#fff", color: "#222", padding: "4px 8px", fontSize: "11px", cursor: "pointer" }}>Open</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
};

export default CkdEncounterHistory;
