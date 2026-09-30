import React from "react";

const present = (value) => value !== undefined && value !== null && value !== "";
const field = (data, key) => present(data?.[key]) ? data[key] : "-";

const SECTIONS = {
  // Decision Tab
  decision_eligibility: {
    title: "Previous RRT Eligibility & Triggers",
    keys: ["v2_rrt_start_date", "v2_rrt_egfr_trigger"],
    columns: [
      ["Start Date", (data) => field(data, "v2_rrt_start_date")],
      ["eGFR Trigger", (data) => field(data, "v2_rrt_egfr_trigger")],
    ],
  },
  decision_shared: {
    title: "Previous Shared Decision-Making",
    keys: ["v2_rrt_ed_session", "v2_rrt_pref_survey", "v2_rrt_suitability", "v2_rrt_final_choice"],
    columns: [
      ["Education Session", (data) => field(data, "v2_rrt_ed_session")],
      ["Pref Survey", (data) => field(data, "v2_rrt_pref_survey")],
      ["Suitability", (data) => field(data, "v2_rrt_suitability")],
      ["Final Choice", (data) => field(data, "v2_rrt_final_choice")],
    ],
  },
  decision_transplant: {
    title: "Previous Transplant Evaluation",
    keys: ["v2_rrt_tx_referral", "v2_rrt_tx_check", "v2_rrt_tx_donor_ed", "v2_rrt_tx_waitlist"],
    columns: [
      ["Referral", (data) => field(data, "v2_rrt_tx_referral")],
      ["Pre-Eval Check", (data) => field(data, "v2_rrt_tx_check")],
      ["Donor Ed", (data) => field(data, "v2_rrt_tx_donor_ed")],
      ["Waitlist", (data) => field(data, "v2_rrt_tx_waitlist")],
    ],
  },

  // Access Tab
  access_planning: {
    title: "Previous Vascular Access Planning",
    keys: ["v2_access_egfr_trig", "v2_access_target", "v2_access_mapping"],
    columns: [
      ["eGFR Trigger", (data) => field(data, "v2_access_egfr_trig")],
      ["Target Status", (data) => field(data, "v2_access_target")],
      ["Mapping", (data) => field(data, "v2_access_mapping")],
    ],
  },
  access_surgical: {
    title: "Previous Surgical Referral & Creation",
    keys: ["v2_access_referral", "v2_access_type", "v2_access_date"],
    columns: [
      ["Referral", (data) => field(data, "v2_access_referral")],
      ["Access Type", (data) => field(data, "v2_access_type")],
      ["Date", (data) => field(data, "v2_access_date")],
    ],
  },
  access_monitoring: {
    title: "Previous Post-Operative & CVC Monitoring",
    keys: ["v2_access_pe", "v2_access_6wk_us", "v2_access_cvc", "v2_access_cvc_comp"],
    columns: [
      ["Exam", (data) => field(data, "v2_access_pe")],
      ["6-Wk US", (data) => field(data, "v2_access_6wk_us")],
      ["CVC Placed", (data) => field(data, "v2_access_cvc")],
      ["CVC Comp", (data) => field(data, "v2_access_cvc_comp")],
    ],
  },
  access_surveillance: {
    title: "Previous Access Surveillance",
    keys: ["v2_access_monthly_exam", "v2_access_qa_measure", "v2_access_recirc_measure"],
    columns: [
      ["Monthly Exam", (data) => field(data, "v2_access_monthly_exam")],
      ["Flow (Qa)", (data) => field(data, "v2_access_qa_measure")],
      ["Recirc %", (data) => field(data, "v2_access_recirc_measure")],
    ],
  },
  access_intervention: {
    title: "Previous Diagnostic & Intervention",
    keys: ["v2_access_doppler_surv", "v2_access_stenosis_diag", "v2_access_procedure_done"],
    columns: [
      ["Doppler", (data) => field(data, "v2_access_doppler_surv")],
      ["Stenosis Diag", (data) => field(data, "v2_access_stenosis_diag")],
      ["Procedure", (data) => field(data, "v2_access_procedure_done")],
    ],
  },

  // Delivery Tab
  delivery_prescription: {
    title: "Previous Dialysis Prescription",
    keys: ["v2_hd_qb", "v2_hd_qd", "v2_hd_duration", "v2_hd_freq"],
    columns: [
      ["Qb / Qd", (data) => `${field(data, "v2_hd_qb")} / ${field(data, "v2_hd_qd")}`],
      ["Duration / Freq", (data) => `${field(data, "v2_hd_duration")} hr / ${field(data, "v2_hd_freq")}`],
    ],
  },
  delivery_monitoring: {
    title: "Previous Intradialytic Monitoring",
    keys: ["v2_hd_active_alerts", "v2_hd_interventions"],
    columns: [
      ["Active Alerts", (data) => field(data, "v2_hd_active_alerts")],
      ["Intervention", (data) => field(data, "v2_hd_interventions")],
    ],
  },
  delivery_weight: {
    title: "Previous Dry Weight Management",
    keys: ["v2_hd_pre_weight", "v2_hd_dry_weight", "v2_hd_vol_exam"],
    columns: [
      ["Pre-HD Wt", (data) => field(data, "v2_hd_pre_weight")],
      ["Dry Wt", (data) => field(data, "v2_hd_dry_weight")],
      ["Vol Exam", (data) => field(data, "v2_hd_vol_exam")],
    ],
  },
  delivery_adequacy: {
    title: "Previous Adequacy Management",
    keys: ["v2_hd_ktv", "v2_hd_urr"],
    columns: [
      ["Kt/V", (data) => field(data, "v2_hd_ktv")],
      ["URR %", (data) => field(data, "v2_hd_urr")],
    ],
  },

  // PD & Home Tab
  pd_prescription: {
    title: "Previous PD Prescription",
    keys: ["v2_pd_modality", "v2_pd_exchanges", "v2_pd_volume", "v2_pd_dwell"],
    columns: [
      ["Modality", (data) => field(data, "v2_pd_modality")],
      ["Exchanges / Vol", (data) => `${field(data, "v2_pd_exchanges")} / ${field(data, "v2_pd_volume")}L`],
      ["Dwell Time", (data) => field(data, "v2_pd_dwell")],
    ],
  },
  pd_adequacy: {
    title: "Previous PD Adequacy Assessment",
    keys: ["v2_pd_ktv", "v2_pd_pet"],
    columns: [
      ["Weekly Kt/V", (data) => field(data, "v2_pd_ktv")],
      ["Membrane Transport", (data) => field(data, "v2_pd_pet")],
    ],
  },
  pd_peritonitis: {
    title: "Previous Peritonitis Surveillance",
    keys: ["v2_pd_peritonitis_symp", "v2_pd_wbc", "v2_pd_culture"],
    columns: [
      ["Symptoms", (data) => field(data, "v2_pd_peritonitis_symp")],
      ["Effluent WBC", (data) => field(data, "v2_pd_wbc")],
      ["Culture", (data) => field(data, "v2_pd_culture")],
    ],
  },
  pd_home_monitoring: {
    title: "Previous Home Dialysis Monitoring",
    keys: ["v2_home_rpm_sync", "v2_home_rpm_alerts", "v2_home_rpm_triage"],
    columns: [
      ["Sync Status", (data) => field(data, "v2_home_rpm_sync")],
      ["Alerts", (data) => field(data, "v2_home_rpm_alerts")],
      ["Triage Status", (data) => field(data, "v2_home_rpm_triage")],
    ],
  },

  // Adequacy Review Tab
  adequacy_clearance: {
    title: "Previous Clearance Benchmarks",
    keys: ["v2_rrt_ktv", "v2_rrt_urr", "v2_rrt_residual_vol", "v2_rrt_residual_clearance"],
    columns: [
      ["Monthly Kt/V", (data) => field(data, "v2_rrt_ktv")],
      ["URR %", (data) => field(data, "v2_rrt_urr")],
      ["Res Vol / Cl", (data) => `${field(data, "v2_rrt_residual_vol")} / ${field(data, "v2_rrt_residual_clearance")}`],
    ],
  },
  adequacy_fluid: {
    title: "Previous Fluid & Dry Weight Tracking",
    keys: ["v2_rrt_dry_weight", "v2_rrt_idwg", "v2_rrt_fluid_status", "v2_rrt_dry_weight_action"],
    columns: [
      ["Target Dry Wt", (data) => field(data, "v2_rrt_dry_weight")],
      ["Avg IDWG", (data) => field(data, "v2_rrt_idwg")],
      ["Fluid Status", (data) => field(data, "v2_rrt_fluid_status")],
      ["DW Action", (data) => field(data, "v2_rrt_dry_weight_action")],
    ],
  },
  adequacy_access: {
    title: "Previous Access Surveillance",
    keys: ["v2_rrt_access_dvp", "v2_rrt_access_qa", "v2_rrt_access_exam", "v2_rrt_access_action"],
    columns: [
      ["DVP", (data) => field(data, "v2_rrt_access_dvp")],
      ["Access Flow (Qa)", (data) => field(data, "v2_rrt_access_qa")],
      ["Exam / Action", (data) => `${field(data, "v2_rrt_access_exam")} / ${field(data, "v2_rrt_access_action")}`],
    ],
  },
  adequacy_complications: {
    title: "Previous Complications Summary",
    keys: ["v2_rrt_comp_hypotension", "v2_rrt_comp_cramps", "v2_rrt_comp_notes"],
    columns: [
      ["Hypotension", (data) => field(data, "v2_rrt_comp_hypotension")],
      ["Cramps", (data) => field(data, "v2_rrt_comp_cramps")],
      ["Notes", (data) => field(data, "v2_rrt_comp_notes")],
    ],
  },
};

const DialysisEncounterHistory = ({ sessions = [], currentSessionId = "", section = "", onOpenEncounter }) => {
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

export default DialysisEncounterHistory;
