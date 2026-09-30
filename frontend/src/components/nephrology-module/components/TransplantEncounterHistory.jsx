import React from "react";

const present = (value) => value !== undefined && value !== null && value !== "";
const field = (data, key) => present(data?.[key]) ? data[key] : "-";

const SECTIONS = {
  // PreTxTab
  pre_candidacy: {
    title: "Previous Candidacy & Screening",
    keys: ["v2_tx_eval_date", "v2_tx_med_fit", "v2_tx_psych_comp", "v2_tx_excl_malig"],
    columns: [
      ["Eval Date", (data) => field(data, "v2_tx_eval_date")],
      ["Med Fit", (data) => field(data, "v2_tx_med_fit")],
      ["Psych / SW", (data) => field(data, "v2_tx_psych_comp")],
      ["Malignancy", (data) => field(data, "v2_tx_excl_malig")],
    ],
  },
  pre_workup: {
    title: "Previous Workup Clearances",
    keys: ["v2_tx_clear_cardio", "v2_tx_clear_id", "v2_tx_clear_malig", "v2_tx_clear_immuno"],
    columns: [
      ["Cardio", (data) => field(data, "v2_tx_clear_cardio")],
      ["ID", (data) => field(data, "v2_tx_clear_id")],
      ["Malignancy", (data) => field(data, "v2_tx_clear_malig")],
      ["Immuno", (data) => field(data, "v2_tx_clear_immuno")],
    ],
  },

  // DonorEligibilityTab
  donor_eval: {
    title: "Previous Donor Evaluation",
    keys: ["v2_tx_donor_status", "v2_tx_donor_compat", "v2_tx_donor_kdri"],
    columns: [
      ["Status", (data) => field(data, "v2_tx_donor_status")],
      ["Compatibility", (data) => field(data, "v2_tx_donor_compat")],
      ["KDRI", (data) => field(data, "v2_tx_donor_kdri")],
    ],
  },
  donor_waitlist: {
    title: "Previous Waitlist & Desensitization",
    keys: ["v2_tx_unos_status", "v2_tx_unos_time", "v2_tx_cpra", "v2_tx_desens_proto"],
    columns: [
      ["UNOS Status", (data) => field(data, "v2_tx_unos_status")],
      ["Waitlist Start", (data) => field(data, "v2_tx_unos_time")],
      ["CPRA %", (data) => field(data, "v2_tx_cpra")],
      ["Desensitization", (data) => field(data, "v2_tx_desens_proto")],
    ],
  },

  // ImmunoTab
  immuno_levels: {
    title: "Previous Trough Levels & Dosing",
    keys: ["v2_tx_induction", "v2_tx_tac_trough", "v2_tx_cyclo_trough", "v2_tx_dose_ai"],
    columns: [
      ["Induction", (data) => field(data, "v2_tx_induction")],
      ["Tacrolimus", (data) => field(data, "v2_tx_tac_trough")],
      ["Cyclosporine", (data) => field(data, "v2_tx_cyclo_trough")],
      ["Dose Adjust", (data) => field(data, "v2_tx_dose_ai")],
    ],
  },
  immuno_toxicity: {
    title: "Previous Toxicity Monitoring",
    keys: ["v2_tx_tox_cni", "v2_tx_tox_nodat", "v2_tx_tox_myelo"],
    columns: [
      ["CNI Tox", (data) => field(data, "v2_tx_tox_cni")],
      ["NODAT", (data) => field(data, "v2_tx_tox_nodat")],
      ["Myelosuppression", (data) => field(data, "v2_tx_tox_myelo")],
    ],
  },

  // PostTxTab
  post_graft: {
    title: "Previous Graft Function",
    keys: ["v2_post_cr", "v2_post_egfr", "v2_post_dgf", "v2_post_proto_bx"],
    columns: [
      ["Creatinine", (data) => field(data, "v2_post_cr")],
      ["eGFR", (data) => field(data, "v2_post_egfr")],
      ["DGF Status", (data) => field(data, "v2_post_dgf")],
      ["Protocol Biopsy", (data) => field(data, "v2_post_proto_bx")],
    ],
  },
  post_immuno: {
    title: "Previous Maintenance & Levels",
    keys: ["v2_post_cni", "v2_post_cni_level", "v2_post_antimetab", "v2_post_steroid"],
    columns: [
      ["CNI / Level", (data) => `${field(data, "v2_post_cni")} (${field(data, "v2_post_cni_level")})`],
      ["Antimetabolite", (data) => field(data, "v2_post_antimetab")],
      ["Steroid", (data) => field(data, "v2_post_steroid")],
    ],
  },
  post_infection: {
    title: "Previous Infection & Prophylaxis",
    keys: ["v2_post_inf_cmv", "v2_post_inf_bkv", "v2_post_inf_proph"],
    columns: [
      ["CMV PCR", (data) => field(data, "v2_post_inf_cmv")],
      ["BKV PCR", (data) => field(data, "v2_post_inf_bkv")],
      ["Prophylaxis", (data) => field(data, "v2_post_inf_proph")],
    ],
  },
  post_rejection: {
    title: "Previous Rejection Events",
    keys: ["v2_post_rej_suspicion", "v2_post_rej_bx", "v2_post_rej_class", "v2_post_rej_tx"],
    columns: [
      ["Suspicion", (data) => field(data, "v2_post_rej_suspicion")],
      ["Biopsy", (data) => field(data, "v2_post_rej_bx")],
      ["Classification", (data) => field(data, "v2_post_rej_class")],
      ["Treatment", (data) => field(data, "v2_post_rej_tx")],
    ],
  },
};

const TransplantEncounterHistory = ({ sessions = [], currentSessionId = "", section = "", onOpenEncounter }) => {
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

export default TransplantEncounterHistory;
