/**
 * pulmonology-module/tabs/discharge/dispositionHelpers.js
 * Shared helpers, calculation engines, and styling for Disposition & Discharge tabs.
 */

export const tableStyle = { width: "100%", borderCollapse: "collapse" };
export const thStyle = {
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  backgroundColor: "#f5f5f5",
  color: "#000",
};
export const tdStyle = {
  fontSize: "12.5px",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  verticalAlign: "top",
  color: "#000",
};
export const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: "12px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
  marginTop: "4px",
};

import { evaluatePostProcedureTriage } from "../../utils/clinicalPathwayEngine.js";

// --- Pure Helper 1: Automated Discharge Readiness Engine ---
export function getDischargeReadiness(formData = {}) {
  const blockers = [];
  const advisories = [];

  // 0. Primary Clinical Foundation
  if (!formData.pulm_primary_dx) {
    blockers.push("Primary pulmonary diagnosis has not been established");
  }

  // Determine if patient underwent procedural intervention or has post-procedure PACU monitoring
  const hasActualProcedure = Boolean(
    formData.last_completed_procedure ||
    (formData.completed_procedures_log && formData.completed_procedures_log.length > 0) ||
    formData.proc_id
  );

  const hasPostProcData = hasActualProcedure && Boolean(
    formData.mon_obs_aldrete ||
    formData.mon_eff_cxr_ptx ||
    formData.mon_nurs_air_leak ||
    (formData.mon_timed_obs && formData.mon_timed_obs.length > 0)
  );

  const postProcTriage = hasPostProcData ? evaluatePostProcedureTriage(formData) : null;
  const isPostProcCleared = Boolean(postProcTriage && postProcTriage.isDischargeReady);

  // 1. Diagnostics Review:
  // Outpatient diagnostics (PFT, 6MWT, ABG) are tracked as recommendations for post-discharge scheduling,
  // NOT as a hard stop blocking acute or post-procedure discharge.
  if (formData.diag_outstanding_flag && formData.diag_outstanding_flag !== "Complete") {
    advisories.push(`Pending Outpatient Diagnostics: ${formData.diag_outstanding_flag} (Schedule for outpatient clinic follow-up)`);
  }

  // If post-procedure patient has active PACU safety blockers (e.g. continuous air leak, Aldrete < 9, severe hemoptysis)
  if (hasPostProcData && postProcTriage && !postProcTriage.isDischargeReady && postProcTriage.status !== "INCOMPLETE_DATA") {
    postProcTriage.blockers.forEach((b) => {
      blockers.push(`[PACU Safety] ${b}`);
    });
  }

  // 2. From Screening & Alerts
  if (formData.alert_hypoxemia === "Active (Criteria Met, NOT Prescribed — Review)") {
    blockers.push("Severe hypoxemia criteria met but home oxygen not prescribed");
  }
  if (formData.alert_tx_triage && String(formData.alert_tx_triage).startsWith("Urgent")) {
    blockers.push(`Unresolved transplant triage priority: ${formData.alert_tx_triage}`);
  }

  // 3. From Airway Management
  if (formData.air_niv_mode && formData.air_niv_mode !== "None" && !formData.air_niv_compliance_hrs) {
    blockers.push("NIV therapy prescribed but mask compliance / tolerance not documented");
  }

  // 4. From Disposition itself
  if (!formData.disp_destination) {
    blockers.push("Discharge destination has not been selected");
  }
  const hasO2 = formData.air_o2_device && !formData.air_o2_device.toLowerCase().includes("none") && !formData.air_o2_device.toLowerCase().includes("room air");
  if (
    formData.disp_destination === "Home with Home Health" &&
    hasO2 &&
    (!formData.disp_dme_o2_concentrator || formData.disp_dme_o2_concentrator === "Not Needed")
  ) {
    blockers.push("Home O2 prescribed but concentrator DME order not placed");
  }
  if (!formData.disp_followup_pulm_date && !formData.disp_followup_pcp_date) {
    blockers.push("No post-discharge follow-up appointment scheduled");
  }

  const isReady = blockers.length === 0;
  return {
    isReady,
    flag: isReady ? "Ready for Discharge" : "Not Ready — Resolve Blockers",
    blockers,
    advisories,
    isPostProcCleared,
    postProcTriage,
  };
}

// --- Pure Helper 2: Default Return Precautions by Primary Diagnosis ---
const RETURN_PRECAUTIONS_BY_DX = {
  COPD: "Return immediately for: worsening shortness of breath at rest, fever, change in sputum color/amount, confusion, or SpO2 below your prescribed target (88–92%) on home monitoring.",
  Asthma: "Return immediately for: rescue inhaler not relieving symptoms, difficulty speaking in full sentences, blue lips/fingertips, or peak flow in red zone (<50%).",
  ILD: "Return immediately for: rapid worsening of breathlessness, new or worsening cough, or SpO2 drop with usual daily activity.",
  Bronchiectasis: "Return immediately for: fever, significant increase in sputum volume or new blood in sputum, or worsening breathlessness.",
  PAH: "Return immediately for: chest pain, fainting or near-fainting, rapid swelling of legs/abdomen, or worsening breathlessness at rest.",
};

export function getDefaultReturnPrecautions(primaryDx) {
  if (!primaryDx) return "Return immediately for worsening breathlessness, chest pain, fever, or confusion.";
  const match = Object.keys(RETURN_PRECAUTIONS_BY_DX).find((k) =>
    primaryDx.toLowerCase().includes(k.toLowerCase())
  );
  return match
    ? RETURN_PRECAUTIONS_BY_DX[match]
    : "Return immediately for worsening breathlessness, chest pain, fever, or confusion.";
}

// --- Pure Helper 3: Smart Auto-Aggregation of Recent Encounter & Post-Procedure Data ---
export function autoAggregateEncounterData(formData = {}) {
  const updates = {};
  
  // Intelligently resolve primary diagnosis:
  // 1. Explicit selection in formData.pulm_primary_dx
  // 2. Inferred from visit reason, active inhalers/meds, or lifestyle smoking history
  // 3. Fallback safely to "COPD" (the primary chronic airway disease archetype) rather than specialized "ILD / Fibrosis"
  let primaryDx = formData.pulm_primary_dx;
  if (!primaryDx) {
    const visitReason = String(formData.pulm_visit_reason || "").toLowerCase();
    const smokingPackYears = Number(formData.lifestyle_pack_years || formData.pulm_smoking_pack_years || 0);
    const hasSmoking = smokingPackYears > 10 || String(formData.lifestyle_smoking || "").toLowerCase().includes("smok");
    const hasCopdMeds = formData.pulm_meds?.triple_therapy || formData.pulm_meds?.lama || formData.pulm_meds?.home_oxygen;

    if (visitReason.includes("copd") || hasCopdMeds || (hasSmoking && visitReason.includes("dyspnea"))) {
      primaryDx = "COPD";
    } else if (visitReason.includes("asthma")) {
      primaryDx = "Asthma";
    } else if (visitReason.includes("sleep")) {
      primaryDx = "Sleep Apnea Evaluation";
    } else if (visitReason.includes("fibros") || visitReason.includes("ild")) {
      primaryDx = "ILD / Fibrosis";
    } else if (visitReason.includes("bronchiectasis")) {
      primaryDx = "Bronchiectasis";
    } else {
      primaryDx = "";
    }
  }
  const dxLower = (primaryDx || "").toLowerCase();

  // 1. Structured ICD-10 Classification
  const existingIcd = formData.disp_icd10_list || [];
  if (existingIcd.length === 0 && primaryDx) {
    const icds = [];
    if (dxLower.includes("ild") || dxLower.includes("fibros") || dxLower.includes("ipf")) {
      icds.push({ id: "icd-1", code: "J84.112", desc: "Idiopathic pulmonary fibrosis (IPF)", type: "Primary" });
    } else if (dxLower.includes("copd") || dxLower.includes("emphysema") || dxLower.includes("bronchitis")) {
      icds.push({ id: "icd-1", code: "J44.1", desc: "COPD with acute exacerbation", type: "Primary" });
    } else if (dxLower.includes("asthma")) {
      icds.push({ id: "icd-1", code: "J45.901", desc: "Unspecified asthma with acute exacerbation", type: "Primary" });
    } else if (dxLower.includes("bronchiectasis")) {
      icds.push({ id: "icd-1", code: "J47.9", desc: "Bronchiectasis, uncomplicated", type: "Primary" });
    } else if (dxLower.includes("pah") || dxLower.includes("hypertension")) {
      icds.push({ id: "icd-1", code: "I27.0", desc: "Primary pulmonary hypertension", type: "Primary" });
    } else {
      icds.push({ id: "icd-1", code: "J98.4", desc: "Other specified pulmonary disorder", type: "Primary" });
    }

    // Secondary condition mapping from recent encounter findings
    const hasO2Needs = formData.air_o2_device || formData.disp_dme_o2_ordered || (formData.pulm_baseline_spo2 && Number(formData.pulm_baseline_spo2) < 89);
    if (hasO2Needs) {
      icds.push({ id: "icd-2", code: "Z99.81", desc: "Dependence on supplemental oxygen", type: "Manifestation" });
    }
    if (formData.last_completed_procedure?.proc_id === "chest_tube" || formData.ct_air_leak || String(formData.img_cxr_pneumothorax || "").includes("pneumothorax")) {
      icds.push({ id: "icd-3", code: "J93.9", desc: "Pneumothorax, unspecified", type: "Secondary" });
    } else if (formData.last_completed_procedure?.proc_id === "thora" || formData.thora_volume_drained || String(formData.img_cxr_effusion || "").includes("effusion")) {
      icds.push({ id: "icd-3", code: "J90", desc: "Pleural effusion, not elsewhere classified", type: "Secondary" });
    }
    if (formData.air_niv_mode && formData.air_niv_mode !== "None") {
      icds.push({ id: "icd-4", code: "J96.22", desc: "Acute on chronic respiratory failure with hypercapnia", type: "Secondary" });
    }
    updates.disp_icd10_list = icds;
  }

  // Clinical Radiographic Alignment
  // Only suggest Fibrosis if diagnosis was explicitly confirmed as ILD/Fibrosis and no finding has been documented yet
  if (formData.pulm_primary_dx && (dxLower.includes("ild") || dxLower.includes("fibros") || dxLower.includes("ipf"))) {
    if (!formData.img_primary_finding) {
      updates.img_primary_finding = "Fibrosis / Honeycombing";
    }
  }

  // 2. Disposition Destination, Transport & Functional Baseline
  if (!formData.disp_destination) {
    const isHighCare = formData.disp_ref_palliative || (formData.air_niv_mode && formData.air_niv_mode !== "None" && !formData.air_niv_compliance_hrs);
    updates.disp_destination = isHighCare ? "Home with Home Health (Nursing / RT)" : "Home (Self-Care)";
  }
  if (!formData.disp_transport_mode) {
    updates.disp_transport_mode = "Self / Family Transport (Private Vehicle)";
  }
  if (!formData.disp_transport_o2) {
    const hasO2 = formData.air_o2_device && !formData.air_o2_device.toLowerCase().includes("none") && !formData.air_o2_device.toLowerCase().includes("room air");
    updates.disp_transport_o2 = hasO2 ? "Continuous O2 via portable tank" : "Room air — No O2 required";
  }
  if (!formData.disp_functional_status) {
    const sixMwt = Number(formData.pulm_current_6mwt_m || formData.mwt_distance);
    if (sixMwt && sixMwt < 200) {
      updates.disp_functional_status = "Needs Assistance (Cane/Walker)";
    } else {
      updates.disp_functional_status = "Independent / Community ambulator";
    }
  }
  if (!formData.disp_home_stairs) {
    updates.disp_home_stairs = "No stairs / Single level home";
  }

  // 3. Post-Discharge Scheduled Appointments
  if (!formData.disp_followup_pulm_date) {
    const d14 = new Date();
    d14.setDate(d14.getDate() + 14);
    updates.disp_followup_pulm_date = d14.toISOString().split("T")[0];
    updates.disp_followup_pulm_clinic = "Chest Outpatient Clinic (Room 402)";
  }
  if (!formData.disp_followup_pcp_date) {
    const d7 = new Date();
    d7.setDate(d7.getDate() + 7);
    updates.disp_followup_pcp_date = d7.toISOString().split("T")[0];
    updates.disp_followup_pcp_name = "Primary Care Physician Clinic";
  }

  // 4. DME Requisitions
  const hasO2 = (formData.air_o2_device && !formData.air_o2_device.toLowerCase().includes("none") && !formData.air_o2_device.toLowerCase().includes("room air")) || formData.disp_dme_o2_ordered;
  if (hasO2) {
    if (!formData.disp_dme_o2_concentrator || formData.disp_dme_o2_concentrator === "Not Needed") {
      updates.disp_dme_o2_concentrator = "Ordered — Stationary Concentrator (5L/min)";
    }
    if (!formData.disp_dme_o2_portable || formData.disp_dme_o2_portable === "Not Needed") {
      updates.disp_dme_o2_portable = "Portable Oxygen Concentrator (POC)";
    }
  }
  if (formData.air_niv_mode && formData.air_niv_mode !== "None") {
    if (!formData.disp_dme_niv_device || formData.disp_dme_niv_device === "Not Needed") {
      updates.disp_dme_niv_device = "Ordered — BiPAP S/T Home Machine";
    }
    if (!formData.disp_dme_niv_mask || formData.disp_dme_niv_mask === "Not Applicable") {
      updates.disp_dme_niv_mask = "Full Face Mask (Size M)";
    }
  }

  // 5. Structured Prescriptions (Take-Home Regimen)
  const existingRx = formData.disp_rx_list || [];
  if (existingRx.length === 0) {
    const rx = [];
    if (formData.med_inhaler_maintenance) {
      rx.push({
        id: "rx-" + Date.now(),
        drug: formData.med_inhaler_maintenance,
        dose: formData.med_controller_dose || "1 inhalation",
        freq: "OD",
        duration: "30 days (1 canister)",
        instructions: "Inhale once daily in morning; rinse mouth with water after use",
      });
    }
    if (formData.med_rescue_inhaler) {
      rx.push({
        id: "rx-" + (Date.now() + 1),
        drug: formData.med_rescue_inhaler,
        dose: "2 puffs (200 mcg)",
        freq: "PRN",
        duration: "30 days (1 canister)",
        instructions: "Inhale 2 puffs as needed for acute shortness of breath or wheeze",
      });
    }
    if (formData.med_steroid_regimen) {
      rx.push({
        id: "rx-" + (Date.now() + 2),
        drug: String(formData.med_steroid_regimen).includes("Pred") ? formData.med_steroid_regimen : `Prednisolone (${formData.med_steroid_regimen})`,
        dose: "30 mg",
        freq: "OD",
        duration: "5 days",
        instructions: "Take with morning meal; taper per written schedule",
      });
    }

    if (rx.length === 0 && primaryDx) {
      if (dxLower.includes("ild") || dxLower.includes("fibros")) {
        rx.push(
          { id: "rx-ild-1", drug: "Pirfenidone", dose: "267 mg", freq: "TDS", duration: "30 days", instructions: "Take with meals; avoid direct sunlight exposure / use SPF50" },
          { id: "rx-ild-2", drug: "Prednisolone Taper", dose: "20 mg", freq: "OD", duration: "14 days", instructions: "Take once daily in morning with food, taper by 5mg every 5 days" },
          { id: "rx-ild-3", drug: "Pantoprazole", dose: "40 mg", freq: "OD", duration: "30 days", instructions: "Take 30 minutes before morning meal for mucosal protection" },
          { id: "rx-ild-4", drug: "Albuterol (Salbutamol) MDI", dose: "2 puffs (200 mcg)", freq: "PRN", duration: "30 days", instructions: "Inhale 2 puffs every 4-6 hours as needed for dyspnea" }
        );
      } else if (dxLower.includes("copd")) {
        rx.push(
          { id: "rx-copd-1", drug: "Fluticasone / Umeclidinium / Vilanterol (Trelegy)", dose: "100/62.5/25 mcg", freq: "OD", duration: "30 days", instructions: "Inhale 1 puff daily; rinse mouth after inhalation" },
          { id: "rx-copd-2", drug: "Albuterol / Ipratropium (Combivent Respimat)", dose: "1 inhalation", freq: "PRN", duration: "30 days", instructions: "Inhale as needed for acute bronchospasm (max 6 doses/day)" },
          { id: "rx-copd-3", drug: "Prednisolone", dose: "40 mg", freq: "OD", duration: "5 days", instructions: "Short-course oral steroid burst; take with breakfast" }
        );
      }
    }
    if (rx.length > 0) {
      updates.disp_rx_list = rx;
    }
  }

  // 6. Post-Procedure Recovery & PACU Metrics Hand-Off
  // ONLY aggregate PACU metrics if an actual procedure was performed and has an archived snapshot or documented monitoring.
  // NEVER fabricate fake 10/10 Aldrete scores or fake CXR/drain findings for a patient who had no procedure!
  const hasCompletedProc = Boolean(
    formData.last_completed_procedure ||
    (formData.completed_procedures_log && formData.completed_procedures_log.length > 0) ||
    formData.proc_id
  );
  if (hasCompletedProc) {
    const snap = formData.last_completed_procedure?.monitoring_snapshot;
    if (snap) {
      if (!formData.mon_obs_aldrete && snap.mon_obs_aldrete) updates.mon_obs_aldrete = snap.mon_obs_aldrete;
      if (!formData.mon_obs_spo2 && snap.mon_obs_spo2) updates.mon_obs_spo2 = snap.mon_obs_spo2;
      if (!formData.mon_obs_o2_flow && snap.mon_obs_o2_flow) updates.mon_obs_o2_flow = snap.mon_obs_o2_flow;
      if (!formData.mon_eff_cxr_ptx && snap.mon_eff_cxr_ptx) updates.mon_eff_cxr_ptx = snap.mon_eff_cxr_ptx;
      if (!formData.mon_nurs_air_leak && snap.mon_nurs_air_leak) updates.mon_nurs_air_leak = snap.mon_nurs_air_leak;
      if (!formData.mon_eff_hemoptysis && snap.mon_eff_hemoptysis) updates.mon_eff_hemoptysis = snap.mon_eff_hemoptysis;
    }
  }

  // 7. Procedural & Interventional History (Aggregated from actual records)
  if (!formData.disp_summary_proc_history) {
    const completedProc = formData.last_completed_procedure;
    if (completedProc && (completedProc.proc_name || completedProc.proc_id)) {
      updates.disp_summary_proc_history = `Completed Procedure: ${completedProc.proc_name || completedProc.proc_id} performed on ${completedProc.proc_date || "Today"} by ${completedProc.proc_operator || "Attending Pulmonologist"}. Course: ${completedProc.summary || "Procedure completed smoothly without immediate complications."}`;
    } else if (formData.thora_volume_drained) {
      updates.disp_summary_proc_history = `Completed Procedure: US-Guided Thoracentesis. ${formData.thora_volume_drained} mL drained under real-time ultrasound guidance. Opening pressure: ${formData.thora_opening_pressure || "12 cmH2O"}.`;
    } else if (formData.ct_size) {
      updates.disp_summary_proc_history = `Completed Procedure: Chest Tube / ICD Insertion (${formData.ct_size} Fr) placed at 5th intercostal space. Connected to underwater seal drainage.`;
    } else if (formData.bronch_bal_volume) {
      updates.disp_summary_proc_history = `Completed Procedure: Diagnostic Bronchoscopy with BAL (${formData.bronch_bal_volume} mL instilled).`;
    }
  }

  // 8. Caregiver & Patient Education Defaults
  if (!formData.disp_caregiver_present && formData.pulm_primary_dx) {
    updates.disp_caregiver_present = "Yes — Primary Caregiver Present";
  }

  // 9. Attending Physician Default Name
  if (!formData.disp_sign_attending_name) {
    updates.disp_sign_attending_name = formData.team_pulmonologist || "Dr. Arvind Ramesh, MD, FCCP";
  }

  return updates;
}
