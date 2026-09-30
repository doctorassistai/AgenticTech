import React from "react";

const present = (value) => value !== undefined && value !== null && value !== "";
const field = (data, key) => present(data?.[key]) ? data[key] : "-";

const selectedCauses = (data) => {
  const causes = data?.v2_aki_causes;
  if (Array.isArray(causes)) return causes.join(", ") || "-";
  if (causes && typeof causes === "object") return Object.entries(causes).filter(([, selected]) => selected).map(([cause]) => cause).join(", ") || "-";
  return "-";
};

const medicationRows = (data) => {
  const rows = [
    ...(Array.isArray(data?.v2_aki_nephrotoxin_list) ? data.v2_aki_nephrotoxin_list : []),
    ...(Array.isArray(data?.v2_ckd_meds) ? data.v2_ckd_meds : []),
  ];
  if (!rows.length) return "-";
  return rows.map((row) => {
    const name = row.drugName || row.drug;
    if (!name) return null;
    const dose = row.currentDose || [row.dose, row.freq].filter(Boolean).join(" ");
    const adjustment = row.recommendedAdjustment || row.recAdjustment || row.alert;
    return [name, dose, adjustment].filter(Boolean).join(" | ");
  }).filter(Boolean).join("; ") || "-";
};

const medicationActions = (data) => {
  const rows = data?.v2_aki_nephrotoxin_list || [];
  const actions = data?.v2_aki_nephrotoxin_actions || {};
  const values = rows.map((row) => row.drugName && actions[row.id] ? `${row.drugName}: ${actions[row.id]}` : null).filter(Boolean);
  return values.join("; ") || field(data, "v2_aki_dose_adjustment");
};

const total = (data, keys) => {
  const supplied = keys.filter((key) => present(data?.[key]));
  return supplied.length ? supplied.reduce((sum, key) => sum + (Number(data[key]) || 0), 0) : "-";
};

const SECTIONS = {
  classification_trajectory: {
    title: "Previous Classification & Creatinine Trajectory",
    keys: ["v2_aki_class", "v2_aki_cr_6m", "v2_aki_cr_3m", "v2_aki_cr_1m", "v2_aki_cr_yest", "v2_aki_cr_today"],
    columns: [
      ["Classification", (data) => field(data, "v2_aki_class")],
      ["6m / 3m / 1m", (data) => `${field(data, "v2_aki_cr_6m")} / ${field(data, "v2_aki_cr_3m")} / ${field(data, "v2_aki_cr_1m")}`],
      ["Yesterday / Today", (data) => `${field(data, "v2_aki_cr_yest")} / ${field(data, "v2_aki_cr_today")}`],
    ],
  },
  classification_stage: {
    title: "Previous AKI Surveillance & KDIGO Staging",
    keys: ["v2_aki_baseline_cr", "v2_aki_current_cr", "v2_aki_kdigo", "v2_aki_uo_tracking"],
    columns: [
      ["Baseline Cr", (data) => field(data, "v2_aki_baseline_cr")],
      ["Current Cr", (data) => field(data, "v2_aki_current_cr")],
      ["KDIGO", (data) => field(data, "v2_aki_kdigo")],
      ["Urine Output", (data) => field(data, "v2_aki_uo_tracking")],
    ],
  },
  classification_alert: {
    title: "Previous AKI Alerts & Recommendations",
    keys: ["v2_aki_alert_status", "v2_aki_alert_actions"],
    columns: [["Alert", (data) => field(data, "v2_aki_alert_status")], ["Recommended Actions", (data) => field(data, "v2_aki_alert_actions")]],
  },
  cause_etiology: {
    title: "Previous AKI Etiology Assessments",
    keys: ["v2_aki_causes", "v2_aki_ai_cause", "v2_aki_ai_features"],
    columns: [["Selected Causes", selectedCauses], ["AI Etiology", (data) => field(data, "v2_aki_ai_cause")], ["Features", (data) => field(data, "v2_aki_ai_features")]],
  },
  cause_drugs: {
    title: "Previous Bundles & Drug Reviews",
    keys: ["v2_aki_bundle", "v2_aki_nephrotoxin_list", "v2_ckd_meds"],
    columns: [["Bundle", (data) => field(data, "v2_aki_bundle")], ["Drugs, Dose & Recommendation", medicationRows]],
  },
  management_interventions: {
    title: "Previous Acute Interventions",
    keys: ["v2_aki_bundle_ivf", "v2_aki_bundle_diuretic", "v2_aki_bundle_rrt"],
    columns: [["IV Fluid", (data) => field(data, "v2_aki_bundle_ivf")], ["Diuretic", (data) => field(data, "v2_aki_bundle_diuretic")], ["RRT Indication", (data) => field(data, "v2_aki_bundle_rrt")]],
  },
  management_response: {
    title: "Previous Intervention Responses",
    keys: ["v2_aki_response_uo", "v2_aki_response_cr", "v2_aki_response_notes"],
    columns: [["Urine Response", (data) => field(data, "v2_aki_response_uo")], ["Repeat Cr", (data) => field(data, "v2_aki_response_cr")], ["Clinical Response", (data) => field(data, "v2_aki_response_notes")]],
  },
  management_rrt: {
    title: "Previous RRT Initiation Details",
    keys: ["v2_aki_rrt_modality", "v2_aki_rrt_urgency", "v2_aki_rrt_access", "v2_aki_rrt_signoff", "v2_aki_rrt_notes"],
    columns: [["Modality", (data) => field(data, "v2_aki_rrt_modality")], ["Urgency", (data) => field(data, "v2_aki_rrt_urgency")], ["Access", (data) => field(data, "v2_aki_rrt_access")], ["Sign-off / Notes", (data) => `${field(data, "v2_aki_rrt_signoff")} | ${field(data, "v2_aki_rrt_notes")}`]],
  },
  management_medications: {
    title: "Previous AKI Medication Actions",
    keys: ["v2_aki_nephrotoxin_list", "v2_aki_nephrotoxin_actions", "v2_aki_dose_adjustment", "v2_aki_electrolyte_orders"],
    columns: [["Drug Actions", medicationActions], ["Dose Notes", (data) => field(data, "v2_aki_dose_adjustment")], ["Additional Orders", (data) => field(data, "v2_aki_electrolyte_orders")]],
  },
  inpatient_fluid: {
    title: "Previous Inpatient Fluid Balance",
    keys: ["v2_fluid_iv", "v2_fluid_oral", "v2_fluid_blood", "v2_fluid_meds", "v2_fluid_urine", "v2_fluid_drain", "v2_fluid_gi", "v2_fluid_uf", "v2_fluid_net"],
    columns: [["Input (mL)", (data) => total(data, ["v2_fluid_iv", "v2_fluid_oral", "v2_fluid_blood", "v2_fluid_meds"])], ["Output (mL)", (data) => total(data, ["v2_fluid_urine", "v2_fluid_drain", "v2_fluid_gi", "v2_fluid_uf"])], ["Net (mL)", (data) => field(data, "v2_fluid_net")]],
  },
  inpatient_monitoring: {
    title: "Previous Inpatient Monitoring",
    keys: ["v2_hosp_k", "v2_hosp_bicarb", "v2_hosp_bp", "v2_hosp_weight", "v2_hosp_o2", "v2_hosp_sepsis"],
    columns: [["K / HCO3", (data) => `${field(data, "v2_hosp_k")} / ${field(data, "v2_hosp_bicarb")}`], ["BP", (data) => field(data, "v2_hosp_bp")], ["Weight / O2", (data) => `${field(data, "v2_hosp_weight")} / ${field(data, "v2_hosp_o2")}`], ["Sepsis", (data) => field(data, "v2_hosp_sepsis")]],
  },
  inpatient_status: {
    title: "Previous Inpatient Kidney Status & AI Review",
    keys: ["v2_hosp_status", "v2_hosp_ai_recovery", "v2_hosp_ai_contrast", "v2_hosp_ai_prophylaxis"],
    columns: [["Kidney Status", (data) => field(data, "v2_hosp_status")], ["Recovery", (data) => field(data, "v2_hosp_ai_recovery")], ["Contrast Risk", (data) => field(data, "v2_hosp_ai_contrast")], ["Prophylaxis", (data) => field(data, "v2_hosp_ai_prophylaxis")]],
  },
};

const AkiEncounterHistory = ({ sessions = [], currentSessionId = "", section = "", onOpenEncounter }) => {
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

export default AkiEncounterHistory;
