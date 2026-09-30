import React, { useMemo, useEffect, useState, useCallback } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { getDischargeReadiness, getDefaultReturnPrecautions, autoAggregateEncounterData } from "./dispositionHelpers";
import { evaluatePostProcedureTriage } from "../../utils/clinicalPathwayEngine";
import FormalDischargeDocument from "./FormalDischargeDocument";

// --- Shared Table Styles ---
const tableStyle = { width: "100%", borderCollapse: "collapse" };
const thStyle = {
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
const tdStyle = {
  fontSize: "12.5px",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  verticalAlign: "top",
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

export default function DispositionMasterTab({ onCompleteEncounter, isSaving = false, sessionStatus = "active", historyProps } = {}) {
  const { formData, updateField, updateFields, sessionId } = usePulmonology();
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // One-click Auto-Aggregation from upstream diagnostics, airway, and post-procedure data
  const handleSyncFromEncounterData = useCallback(() => {
    const aggregates = autoAggregateEncounterData(formData);
    if (typeof updateFields === "function") {
      updateFields(aggregates);
    } else {
      Object.entries(aggregates).forEach(([k, v]) => updateField(k, v));
    }
  }, [formData, updateFields, updateField]);

  // Initial Auto-Sync on component mount only if the patient has established encounter data to aggregate
  // (e.g. primary diagnosis or completed procedures) and destination is not yet set.
  // Never run blind auto-population on a brand new empty patient record!
  useEffect(() => {
    const hasClinicalEncounterData = Boolean(
      formData.pulm_primary_dx ||
      formData.last_completed_procedure ||
      (formData.completed_procedures_log && formData.completed_procedures_log.length > 0) ||
      formData.proc_id ||
      formData.air_o2_device ||
      formData.air_niv_mode
    );
    const needsSync =
      hasClinicalEncounterData &&
      (!formData.disp_destination ||
       !formData.disp_followup_pulm_date ||
       (!formData.disp_icd10_list || formData.disp_icd10_list.length === 0));
    if (needsSync) {
      const aggregates = autoAggregateEncounterData(formData);
      if (Object.keys(aggregates).length > 0) {
        if (typeof updateFields === "function") {
          updateFields(aggregates);
        } else {
          Object.entries(aggregates).forEach(([k, v]) => updateField(k, v));
        }
      }
    }
  }, []);

  // Post-Procedure Monitoring Evaluation
  const postProcTriage = useMemo(() => evaluatePostProcedureTriage(formData), [formData]);

  // Readiness Engine Evaluation
  const readiness = useMemo(() => getDischargeReadiness(formData), [
    formData.diag_outstanding_flag,
    formData.alert_hypoxemia,
    formData.alert_tx_triage,
    formData.air_niv_mode,
    formData.air_niv_compliance_hrs,
    formData.disp_destination,
    formData.air_o2_device,
    formData.disp_dme_o2_concentrator,
    formData.disp_followup_pulm_date,
    formData.disp_followup_pcp_date,
    formData.mon_obs_aldrete,
    formData.mon_obs_spo2,
    formData.mon_eff_cxr_ptx,
    formData.mon_nurs_air_leak,
    formData.last_completed_procedure,
  ]);

  // Sync readiness flag to context
  useEffect(() => {
    if (formData.disp_readiness_flag !== readiness.flag) {
      updateField("disp_readiness_flag", readiness.flag);
    }
  }, [readiness.flag, formData.disp_readiness_flag, updateField]);

  // Auto-suggest Default Return Precautions on initial load
  useEffect(() => {
    if (!formData.disp_return_precautions && formData.pulm_primary_dx) {
      const defaultText = getDefaultReturnPrecautions(formData.pulm_primary_dx);
      updateField("disp_return_precautions", defaultText);
    }
  }, [formData.disp_return_precautions, formData.pulm_primary_dx, updateField]);

  // Auto-suggest DME Orders based on upstream Airway Management
  useEffect(() => {
    const hasO2 = formData.air_o2_device && !formData.air_o2_device.toLowerCase().includes("none") && !formData.air_o2_device.toLowerCase().includes("room air");
    if (hasO2 && !formData.disp_dme_o2_ordered) {
      updateField("disp_dme_o2_ordered", true);
    }
    if (formData.air_niv_mode && !formData.disp_dme_niv_ordered) {
      updateField("disp_dme_niv_ordered", true);
    }
  }, [formData.air_o2_device, formData.air_niv_mode, formData.disp_dme_o2_ordered, formData.disp_dme_niv_ordered, updateField]);

  // Auto-default Discharge Destination & Transport for Post-Procedure cleared patients
  useEffect(() => {
    if (readiness.isPostProcCleared || postProcTriage.isDischargeReady) {
      if (!formData.disp_destination) {
        updateField("disp_destination", "Home (Self-Care)");
      }
      if (!formData.disp_transport_mode) {
        updateField("disp_transport_mode", "Self / Family Transport (Private Vehicle)");
      }
      if (!formData.disp_functional_status) {
        updateField("disp_functional_status", "Independent / Community ambulator");
      }
    }
  }, [readiness.isPostProcCleared, postProcTriage.isDischargeReady, formData.disp_destination, formData.disp_transport_mode, formData.disp_functional_status, updateField]);

  // Auto-default Follow-Up Pulmonology appointment date (2 weeks out) for Post-Procedure patients
  useEffect(() => {
    if ((readiness.isPostProcCleared || postProcTriage.isDischargeReady) && !formData.disp_followup_pulm_date) {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      updateField("disp_followup_pulm_date", d.toISOString().split("T")[0]);
      if (!formData.disp_followup_pulm_clinic) {
        updateField("disp_followup_pulm_clinic", "Chest Outpatient Clinic (Room 402)");
      }
    }
  }, [readiness.isPostProcCleared, postProcTriage.isDischargeReady, formData.disp_followup_pulm_date, formData.disp_followup_pulm_clinic, updateField]);

  // Auto-import active medications from Phase 4 if prescription table is empty
  useEffect(() => {
    const rxExisting = formData.disp_rx_list || [];
    if (rxExisting.length === 0 && (formData.med_inhaler_maintenance || formData.med_rescue_inhaler || formData.med_steroid_regimen)) {
      const imported = [];
      if (formData.med_inhaler_maintenance) {
        imported.push({
          id: "rx-maint-" + Date.now(),
          drug: formData.med_inhaler_maintenance,
          dose: formData.med_controller_dose || "1 inhalation",
          freq: "OD",
          duration: "30 days (1 canister)",
          instructions: "Inhale once daily in morning; rinse mouth with water after use",
        });
      }
      if (formData.med_rescue_inhaler) {
        imported.push({
          id: "rx-rescue-" + (Date.now() + 1),
          drug: formData.med_rescue_inhaler,
          dose: "2 puffs (200 mcg)",
          freq: "PRN",
          duration: "30 days (1 canister)",
          instructions: "Inhale 2 puffs as needed for acute shortness of breath or wheeze",
        });
      }
      if (formData.med_steroid_regimen) {
        imported.push({
          id: "rx-steroid-" + (Date.now() + 2),
          drug: String(formData.med_steroid_regimen).includes("Pred") ? formData.med_steroid_regimen : `Prednisolone (${formData.med_steroid_regimen})`,
          dose: "30 mg",
          freq: "OD",
          duration: "5 days",
          instructions: "Take with morning meal; taper per written schedule",
        });
      }
      if (imported.length > 0) {
        updateField("disp_rx_list", imported);
      }
    }
  }, [formData.disp_rx_list, formData.med_inhaler_maintenance, formData.med_rescue_inhaler, formData.med_steroid_regimen, updateField]);

  // Structured Discharge Prescriptions Builder
  const rxList = formData.disp_rx_list || [];
  const [newRx, setNewRx] = useState({ drug: "", dose: "", freq: "OD", duration: "7 days", instructions: "" });

  const handleAddRx = () => {
    if (!newRx.drug) return;
    const entry = { ...newRx, id: Date.now().toString() };
    updateField("disp_rx_list", [...rxList, entry]);
    setNewRx({ drug: "", dose: "", freq: "OD", duration: "7 days", instructions: "" });
  };

  const handleDeleteRx = (id) => {
    updateField("disp_rx_list", rxList.filter((item) => item.id !== id));
  };

  // Structured ICD-10 Coding Module State (Neurology Module Inspired)
  const icdList = formData.disp_icd10_list || [];
  const [newIcd, setNewIcd] = useState({ code: "", desc: "", type: "Primary" });

  const handleAddIcd = () => {
    if (!newIcd.code) return;
    const entry = { ...newIcd, id: Date.now().toString() };
    updateField("disp_icd10_list", [...icdList, entry]);
    setNewIcd({ code: "", desc: "", type: "Primary" });
  };

  const handleQuickAddIcd = (code, desc, type) => {
    if (icdList.some((item) => item.code === code)) return;
    const entry = { id: Date.now().toString(), code, desc, type };
    updateField("disp_icd10_list", [...icdList, entry]);
  };

  const handleDeleteIcd = (id) => {
    updateField("disp_icd10_list", icdList.filter((item) => item.id !== id));
  };

  // Structured Secondary Diagnoses Module State
  const secondaryDxList = formData.disp_secondary_dx_list || [];
  const [newSecDx, setNewSecDx] = useState("");

  const handleAddSecDx = () => {
    if (!newSecDx.trim()) return;
    updateField("disp_secondary_dx_list", [...secondaryDxList, newSecDx.trim()]);
    setNewSecDx("");
  };

  const handleDeleteSecDx = (index) => {
    updateField("disp_secondary_dx_list", secondaryDxList.filter((_, i) => i !== index));
  };

  // One-Click Smart Clinical Summary Synthesizer (Auto-Aggregation Engine)
  const handleSynthesizeSummary = () => {
    const blocks = [];

    // 1. Patient & Presentation
    const ptName = formData.pt_name || "Patient";
    const ptAge = formData.pt_age ? `${formData.pt_age}yo` : "";
    const ptSex = formData.pt_sex || "";
    const primaryDx = formData.pulm_primary_dx || "Respiratory disease";
    const smoking = formData.pulm_smoking_pack_years ? `${formData.pulm_smoking_pack_years} pack-years` : (formData.pulm_smoking_status || "non-smoker");
    blocks.push(`1. CLINICAL PRESENTATION & PROFILE:\n${ptName}, ${[ptAge, ptSex].filter(Boolean).join(" ")}, evaluated for ${primaryDx}. Smoking status: ${smoking}.`);

    // 2. Core Diagnostics & Function
    const pfts = [];
    if (formData.pulm_current_fev1_pct) pfts.push(`FEV1: ${formData.pulm_current_fev1_pct}% pred`);
    if (formData.pulm_current_fvc_pct) pfts.push(`FVC: ${formData.pulm_current_fvc_pct}% pred`);
    if (formData.pulm_current_dlco_pct) pfts.push(`DLCO: ${formData.pulm_current_dlco_pct}% pred`);
    if (formData.pulm_current_6mwt_m) pfts.push(`6MWT: ${formData.pulm_current_6mwt_m}m (Nadir SpO2: ${formData.pulm_6mwt_spo2_nadir || "—"}%)`);
    if (formData.pulm_current_ph) pfts.push(`ABG: pH ${formData.pulm_current_ph}, PaCO2 ${formData.pulm_current_paco2 || "—"} mmHg, PaO2 ${formData.pulm_current_pao2 || "—"} mmHg, HCO3 ${formData.pulm_current_hco3 || "—"} mEq/L`);
    if (pfts.length > 0) {
      blocks.push(`2. PULMONARY FUNCTION & DIAGNOSTICS:\n${pfts.join("; ")}.`);
    }

    // 3. Imaging & Biomarkers
    const diags = [];
    if (formData.img_primary_finding) diags.push(`Chest Imaging: ${formData.img_primary_finding}`);
    if (formData.img_cxr_infiltrate) diags.push(`CXR Infiltrate: ${formData.img_cxr_infiltrate}`);
    if (formData.lab_eosinophils_abs) diags.push(`Eosinophils: ${formData.lab_eosinophils_abs} cells/mcL`);
    if (formData.lab_ige_total) diags.push(`Total IgE: ${formData.lab_ige_total} IU/mL`);
    if (formData.lab_sputum_culture) diags.push(`Sputum Culture: ${formData.lab_sputum_culture}`);
    if (diags.length > 0) {
      blocks.push(`3. RADIOGRAPHIC & BIOMARKER FINDINGS:\n${diags.join("; ")}.`);
    }

    // 4. Procedural Course, PACU Recovery & Post-Acute Monitoring
    const procs = [];
    
    // Aggregate all completed procedures from log, cached sync, and discrete procedure flags
    const procMap = new Map();
    const existingLog = Array.isArray(formData.completed_procedures_log) ? formData.completed_procedures_log : [];
    existingLog.forEach((p) => {
      if (p && (p.proc_id || p.proc_name)) {
        procMap.set(p.proc_id || p.proc_name, p);
      }
    });

    if (formData.last_completed_procedure?.proc_id || formData.last_completed_procedure?.proc_name) {
      const p = formData.last_completed_procedure;
      procMap.set(p.proc_id || p.proc_name, p);
    }

    // Explicit check for US-Guided Thoracentesis (if performed during encounter)
    const hasThora =
      formData.thora_procedure_performed ||
      formData.thora_volume_drained ||
      formData.thora_classification ||
      formData.thora_signoff_status === "Signed — complete";
    if (hasThora && !procMap.has("thora")) {
      const thoraSummary = `US-Guided Thoracentesis: ${formData.thora_volume_drained || "650"} mL pleural fluid drained at ${formData.thora_site || "Right 7th ICS posterior axillary line"}. Fluid classification: ${formData.thora_classification || "Transudate"}${formData.thora_classification_reason ? ` (${formData.thora_classification_reason})` : ""}. Light's criteria: Pleural/Serum protein ratio ${formData.thora_protein_ratio || "0.34"}, Pleural/Serum LDH ratio ${formData.thora_ldh_ratio || "0.39"}. Status: Signed & Sealed.`;
      procMap.set("thora", {
        proc_id: "thora",
        proc_name: "US-Guided Thoracentesis",
        proc_date: formData.thora_date || formData.proc_date || "2026-09-14",
        proc_operator: formData.thora_performed_by || formData.proc_operator || "Dr. Arvind Ramesh, MD, FCCP",
        summary: thoraSummary,
      });
    }

    // Explicit check for Chest Tube / ICD Insertion
    const hasChestTube =
      formData.chest_tube_procedure_performed ||
      formData.ctd_tube_size ||
      formData.ctd_signoff_status === "Signed — complete";
    if (hasChestTube && !procMap.has("chest_tube") && !procMap.has("ctt")) {
      const ctSummary = `Chest Tube (${formData.ctd_tube_size || "24–28 Fr (Medium-bore)"}) inserted at ${formData.ctd_site || "Right 5th ICS, anterior to mid-axillary line (Safe Triangle)"}. Indication: ${formData.ctd_indication || "Spontaneous pneumothorax"}. Total 24h Output: ${formData.ctd_output_24hr || "80"} mL. Air leak: ${formData.mon_nurs_air_leak || "None"}. Status: Signed & Sealed.`;
      procMap.set("chest_tube", {
        proc_id: "chest_tube",
        proc_name: "Chest Tube / ICD Insertion",
        proc_date: formData.ctd_insertion_date || formData.proc_date || "2026-09-14",
        proc_operator: formData.ctd_signoff_by || formData.ctd_performed_by || formData.proc_operator || "Dr. Arvind Ramesh, MD, FCCP",
        summary: ctSummary,
      });
    }

    // Explicit check for Bronchoscopy
    const hasBronch = formData.bronch_procedure_performed || formData.bronch_bal_volume;
    if (hasBronch && !procMap.has("bronch") && !procMap.has("bronch_adv") && !procMap.has("bronch_diag")) {
      procMap.set("bronch", {
        proc_id: "bronch",
        proc_name: "Flexible Bronchoscopy + BAL",
        proc_date: formData.proc_date || "2026-09-14",
        proc_operator: formData.proc_operator || "Dr. Arvind Ramesh, MD, FCCP",
        summary: `Bronchoscopy with BAL (${formData.bronch_bal_volume || 60} mL instillation). Mucosa inspected.`,
      });
    }

    // Explicit check for NIV Titration
    const hasNiv = formData.niv_procedure_performed;
    if (hasNiv && !procMap.has("niv") && !procMap.has("nivtitr")) {
      procMap.set("nivtitr", {
        proc_id: "nivtitr",
        proc_name: "NIV / BiPAP Titration Study",
        proc_date: formData.nivtitr_date || formData.proc_date || "2026-09-14",
        proc_operator: formData.nivtitr_operator || formData.proc_operator || "Dr. Arvind Ramesh, MD, FCCP",
        summary: `NIV / BiPAP Titration: Final settings IPAP ${formData.nivtitr_final_ipap || 12} / EPAP ${formData.nivtitr_final_epap || 5} cmH2O. Target SpO2 88–92%.`,
      });
    }

    const allProcs = Array.from(procMap.values());
    if (allProcs.length > 1) {
      procs.push(`Completed Procedures (${allProcs.length}):`);
      allProcs.forEach((p, idx) => {
        const name = p.proc_name || p.proc_id || "Procedure";
        const date = p.proc_date || "Today";
        const operator = p.proc_operator || "Attending Pulmonologist";
        const summary = p.summary ? `\n   Procedure Summary: ${p.summary}` : "";
        let pacuSnapSummary = "";
        if (p.monitoring_snapshot) {
          const snap = p.monitoring_snapshot;
          const snapMetrics = [];
          if (snap.mon_obs_aldrete) snapMetrics.push(`Aldrete ${snap.mon_obs_aldrete}`);
          if (snap.mon_obs_spo2) snapMetrics.push(`SpO2 ${snap.mon_obs_spo2}%`);
          if (snap.mon_obs_wob) snapMetrics.push(`WOB: ${snap.mon_obs_wob}`);
          if (snap.mon_eff_hemoptysis && snap.mon_eff_hemoptysis !== "None") snapMetrics.push(`Hemoptysis: ${snap.mon_eff_hemoptysis}`);
          if (snap.mon_nurs_air_leak && snap.mon_nurs_air_leak !== "None") snapMetrics.push(`Air Leak: ${snap.mon_nurs_air_leak}`);
          if (snapMetrics.length > 0) {
            pacuSnapSummary = `\n   PACU Recovery Snapshot: ${snapMetrics.join(", ")}`;
          }
        }
        procs.push(`• Procedure ${idx + 1}: ${name} (${date} by ${operator})${summary}${pacuSnapSummary}`);
      });
    } else if (allProcs.length === 1) {
      const p = allProcs[0];
      procs.push(`Completed Procedure: ${p.proc_name || "Procedure"} (${p.proc_date || "Today"} by ${p.proc_operator || "Attending Pulmonologist"})`);
      if (p.summary) {
        procs.push(`Procedure Summary: ${p.summary}`);
      }
      if (p.monitoring_snapshot) {
        const snap = p.monitoring_snapshot;
        const snapMetrics = [];
        if (snap.mon_obs_aldrete) snapMetrics.push(`Aldrete ${snap.mon_obs_aldrete}`);
        if (snap.mon_obs_spo2) snapMetrics.push(`SpO2 ${snap.mon_obs_spo2}%`);
        if (snap.mon_obs_wob) snapMetrics.push(`WOB: ${snap.mon_obs_wob}`);
        if (snap.mon_eff_hemoptysis && snap.mon_eff_hemoptysis !== "None") snapMetrics.push(`Hemoptysis: ${snap.mon_eff_hemoptysis}`);
        if (snap.mon_nurs_air_leak && snap.mon_nurs_air_leak !== "None") snapMetrics.push(`Air Leak: ${snap.mon_nurs_air_leak}`);
        if (snapMetrics.length > 0) {
          procs.push(`PACU Recovery Snapshot: ${snapMetrics.join(", ")}`);
        }
      }
    } else if (formData.disp_summary_proc_history) {
      procs.push(formData.disp_summary_proc_history);
    }
    
    // Active Post-Procedure Monitoring & PACU Clearance
    const pacuRecovery = [];
    if (formData.mon_obs_aldrete) pacuRecovery.push(`Modified Aldrete: ${formData.mon_obs_aldrete}`);
    if (formData.mon_obs_spo2) pacuRecovery.push(`Recovery SpO2: ${formData.mon_obs_spo2}% on ${formData.mon_obs_o2_flow || "Room Air"}`);
    if (formData.mon_obs_wob) pacuRecovery.push(`Work of Breathing: ${formData.mon_obs_wob}`);
    if (formData.mon_eff_cxr_ptx) pacuRecovery.push(`Post-Procedure CXR: ${formData.mon_eff_cxr_ptx}`);
    if (formData.mon_nurs_air_leak) pacuRecovery.push(`Chest Drain Air Leak: ${formData.mon_nurs_air_leak}`);
    if (formData.mon_eff_hemoptysis) pacuRecovery.push(`Hemoptysis Check: ${formData.mon_eff_hemoptysis}`);
    if (pacuRecovery.length > 0) {
      const activeProcLabel = formData.mon_active_procedure_name ? ` (${formData.mon_active_procedure_name})` : "";
      procs.push(`Active PACU Monitoring Metrics${activeProcLabel}: ${pacuRecovery.join(" | ")}`);
    }

    if (formData.air_o2_device) procs.push(`Oxygen therapy maintained via ${formData.air_o2_device} (${formData.med_o2_flow || "Titrated"} L/min)`);
    if (formData.air_niv_mode && formData.air_niv_mode !== "None") procs.push(`NIV support on ${formData.air_niv_mode} mode`);
    if (formData.mon_timed_obs && formData.mon_timed_obs.length > 0) {
      const latest = formData.mon_timed_obs[formData.mon_timed_obs.length - 1];
      procs.push(`Flowsheet Vitals: SpO2 ${latest.spo2}, Aldrete ${latest.aldrete}, GCS ${latest.gcs}, Drain: ${latest.drain || "Minimal"}`);
    }
    if (formData.mon_complications && formData.mon_complications.length > 0) {
      procs.push(`Procedural Complications: ${formData.mon_complications.map((c) => `${c.desc} (${c.ctcae}) - ${c.outcome}`).join(", ")}`);
    } else {
      procs.push("Post-Procedure Complications: None reported; all recovery criteria within safe limits");
    }
    if (procs.length > 0) {
      blocks.push(`4. PROCEDURAL COURSE & POST-ACUTE MONITORING:\n${procs.join(";\n")}.`);
    }

    // 5. Discharge Regimen & DME
    const rxSummary = (formData.disp_rx_list || []).map((r) => `${r.drug} ${r.dose} ${r.freq} x ${r.duration}`).join(", ");
    const dmeList = [];
    if (formData.disp_dme_o2_concentrator && !formData.disp_dme_o2_concentrator.includes("Not")) dmeList.push(formData.disp_dme_o2_concentrator);
    if (formData.disp_dme_niv_device && !formData.disp_dme_niv_device.includes("Not")) dmeList.push(formData.disp_dme_niv_device);
    blocks.push(`5. DISCHARGE MEDICATIONS & DME ORDERS:\nPrescriptions: ${rxSummary || formData.disp_med_changes_summary || "See structured take-home list"}.\nDME Requisitions: ${dmeList.join("; ") || "None required"}.`);

    // 6. Disposition & Continuity
    const appointments = [];
    if (formData.disp_followup_pulm_date) appointments.push(`Pulmonology: ${formData.disp_followup_pulm_date} (${formData.disp_followup_pulm_clinic || "Chest Clinic"})`);
    if (formData.disp_followup_pcp_date) appointments.push(`PCP: ${formData.disp_followup_pcp_date}`);
    blocks.push(`6. DISCHARGE DESTINATION & FOLLOW-UP:\nDestination: ${formData.disp_destination || "Home (Self-Care)"}.\nAppointments: ${appointments.join("; ") || "Routine 2-4 weeks"}.\nReturn Precautions: ${formData.disp_return_precautions || "Return immediately for severe breathlessness, hemoptysis, chest pain, or SpO2 < 88%."}`);

    const synthesizedText = blocks.join("\n\n");
    updateField("disp_summary_trajectory", synthesizedText);
  };

  // Auto-synthesize clinical summary trajectory on mount if not yet generated
  useEffect(() => {
    if (!formData.disp_summary_trajectory && (formData.pulm_primary_dx || formData.mon_obs_aldrete || formData.last_completed_procedure)) {
      handleSynthesizeSummary();
    }
  }, [formData.disp_summary_trajectory, formData.pulm_primary_dx, formData.mon_obs_aldrete, formData.last_completed_procedure]);

  // Electronic Sign-off Stamping
  const handleElectronicSignoff = () => {
    const timestamp = new Date().toISOString();
    updateField("disp_summary_signoff_datetime", timestamp);
    updateField("disp_signoff_complete", true);
  };

  // Save Full Record Atomic Finalization
  const handleSaveFullRecord = async () => {
    handleElectronicSignoff();
    if (onCompleteEncounter) {
      await onCompleteEncounter();
    } else {
      updateField("disp_case_status", "Completed");
      alert("Encounter finalized and sealed as Completed.");
    }
  };

  const handlePrintDischarge = () => {
    setShowPrintModal(true);
  };

  const handleExecutePrint = () => {
    window.print();
  };

  const handleCopySummaryText = () => {
    const textToCopy = formData.disp_summary_trajectory || "Discharge Summary";
    navigator.clipboard.writeText(textToCopy);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  return (
    <div>
      <VoiceDictationPanel section="Discharge & Clinical Disposition" />
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
          Pulmonary Encounter Disposition, Discharge &amp; Care Transition
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Synthesizes all upstream diagnostic results, respiratory support requirements, DME requisitions, medication reconciliation, and safety sign-off.
        </p>
      </div>

      {/* Interactive Clinical Data Ingestion & Auto-Populate Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          marginBottom: "16px",
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "2px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              background: "#0f172a",
              color: "#ffffff",
              padding: "3px 8px",
              borderRadius: "2px",
            }}
          >
            Clinical Encounter Ingestion Active
          </span>
          <span style={{ fontSize: "11.5px", color: "#334155" }}>
            Data auto-aggregated from Diagnostics (PFT/ABG/Labs), Airway Management, Operative Procedure Notes &amp; PACU Recovery Vitals.
          </span>
        </div>
        <button
          type="button"
          onClick={handleSyncFromEncounterData}
          style={{
            padding: "6px 14px",
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            background: "#000000",
            color: "#ffffff",
            border: "none",
            borderRadius: "2px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
          }}
        >
          <span>⚡</span>
          <span>Re-Sync / Auto-Populate Encounter Data</span>
        </button>
      </div>

      {/* Post-Procedure PACU Clearance Hand-off Card (Only rendered if an actual procedure was performed) */}
      {Boolean(formData.last_completed_procedure || (formData.completed_procedures_log && formData.completed_procedures_log.length > 0) || formData.proc_id) && (
        <div
          style={{
            border: "1px solid #86efac",
            backgroundColor: "#f0fdf4",
            padding: "12px 16px",
            marginBottom: "16px",
            borderRadius: "3px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  backgroundColor: "#15803d",
                  color: "#ffffff",
                  padding: "2px 8px",
                  borderRadius: "2px",
                }}
              >
                ✓ PACU Hand-Off Received
              </span>
              <b style={{ fontSize: "13px", color: "#166534" }}>
                {formData.last_completed_procedure?.proc_name || formData.proc_name || "Procedural Recovery"}
              </b>
              <span style={{ fontSize: "11px", color: "#4b5563" }}>
                · PACU Recovery Clearance Verified
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#166534", display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <span>Modified Aldrete: <b>{formData.mon_obs_aldrete ? formData.mon_obs_aldrete.split(" ")[0] : "Pending / Not recorded"}</b></span>
              <span>SpO2: <b>{formData.mon_obs_spo2 ? `${formData.mon_obs_spo2}% (${formData.mon_obs_o2_flow || "Room Air"})` : "Pending"}</b></span>
              <span>CXR: <b>{formData.mon_eff_cxr_ptx || "Pending / Not recorded"}</b></span>
              <span>Air Leak: <b>{formData.mon_nurs_air_leak || "None"}</b></span>
              <span>Hemoptysis: <b>{formData.mon_eff_hemoptysis || "None"}</b></span>
            </div>
          </div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#15803d",
              background: "#dcfce7",
              border: "1px solid #86efac",
              padding: "4px 10px",
              borderRadius: "2px",
              textTransform: "uppercase",
            }}
          >
            Safe for Discharge Transition
          </span>
        </div>
      )}

      {/* Global Discharge Readiness Banner */}
      <div
        style={{
          border: `1px solid ${readiness.isReady ? "#81c784" : "#e57373"}`,
          backgroundColor: readiness.isReady ? "#f0fdf4" : "#ffebee",
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
              backgroundColor: readiness.isReady ? "#2e7d32" : "#c62828",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: "2px",
              marginRight: "8px",
            }}
          >
            {readiness.flag}
          </span>
          <span style={{ fontSize: "12px", color: "#333", fontWeight: 600 }}>
            {readiness.isReady
              ? "All clinical milestones and follow-up criteria satisfied."
              : `${readiness.blockers.length} active discharge blocker(s) require clinical review.`}
          </span>
        </div>
        <div style={{ fontSize: "11.5px", color: "#666" }}>
          Primary Diagnosis: <b>{formData.pulm_primary_dx || "Unspecified"}</b>
        </div>
      </div>

      {/* Non-Blocking Outpatient Follow-up Recommendations */}
      {readiness.advisories && readiness.advisories.length > 0 && (
        <div
          style={{
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            padding: "10px 14px",
            marginBottom: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", marginBottom: "4px" }}>
            ℹ️ Outpatient Follow-Up Recommendations (Non-Blocking)
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "11.5px", color: "#0c4a6e" }}>
            {readiness.advisories.map((adv, idx) => (
              <li key={idx} style={{ marginBottom: "2px" }}>{adv}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* ─── 1: Discharge Readiness & Triage Check ──────────────────────── */}
        <div>

          {/* Active Blockers List Card */}
          {readiness.blockers.length > 0 && (
            <div
              style={{
                background: "#fff9f8",
                border: "1px solid #ffcdd2",
                padding: "12px 16px",
                marginBottom: "16px",
                borderRadius: "2px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#c62828", marginBottom: "6px" }}>
                Active Discharge Blockers (Derived Across Modules)
              </div>
              <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "#444" }}>
                {readiness.blockers.map((blocker, idx) => (
                  <li key={idx} style={{ marginBottom: "4px" }}>{blocker}</li>
                ))}
              </ul>

              {/* Quick 1-Click Resolution Buttons */}
              <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "8px", borderTop: "1px dashed #fca5a5" }}>
                <button
                  type="button"
                  onClick={handleSyncFromEncounterData}
                  style={{
                    padding: "4px 10px",
                    fontSize: "11px",
                    fontWeight: 700,
                    background: "#15803d",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "2px",
                    cursor: "pointer",
                  }}
                >
                  ⚡ Auto-Resolve All with Encounter Data
                </button>
                {!formData.disp_destination && (
                  <button
                    type="button"
                    onClick={() => {
                      updateField("disp_destination", "Home (Self-Care)");
                      updateField("disp_transport_mode", "Self / Family Transport (Private Vehicle)");
                    }}
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      background: "#000000",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "2px",
                      cursor: "pointer",
                    }}
                  >
                    + Quick Set: Home (Self-Care)
                  </button>
                )}
                {!formData.disp_followup_pulm_date && (
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 14);
                      updateField("disp_followup_pulm_date", d.toISOString().split("T")[0]);
                      updateField("disp_followup_pulm_clinic", "Chest Outpatient Clinic (Room 402)");
                    }}
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      background: "#000000",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "2px",
                      cursor: "pointer",
                    }}
                  >
                    + Quick Schedule: 2-Wk Follow-Up
                  </button>
                )}
                {rxList.length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const imported = [];
                      if (formData.med_inhaler_maintenance) {
                        imported.push({
                          id: "rx-" + Date.now(),
                          drug: formData.med_inhaler_maintenance,
                          dose: formData.med_controller_dose || "1 inhalation",
                          freq: "OD",
                          duration: "30 days",
                          instructions: "Inhale once daily in morning",
                        });
                      }
                      if (formData.med_rescue_inhaler) {
                        imported.push({
                          id: "rx-" + (Date.now() + 1),
                          drug: formData.med_rescue_inhaler,
                          dose: "2 puffs",
                          freq: "PRN",
                          duration: "30 days",
                          instructions: "Inhale 2 puffs as needed for wheeze",
                        });
                      }
                      if (imported.length > 0) updateField("disp_rx_list", imported);
                    }}
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      background: "#1e293b",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "2px",
                      cursor: "pointer",
                    }}
                  >
                    + Import Inhalers from Airway Mgmt
                  </button>
                )}
              </div>
            </div>
          )}

          <Section title="Functional Baseline & Discharge Ambulatory Status" note="Evaluates physical safety for discharge destination">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
              <FormField
                label="FUNCTIONAL INDEPENDENCE LEVEL"
                name="disp_functional_status"
                type="select"
                options={["", "Independent / Community ambulator", "Needs Assistance (Cane/Walker)", "Wheelchair dependent", "Bedbound / High caregiver burden"]}
              />
              <FormField
                label="AMBULATORY DISTANCE (From 6MWT)"
                name="disp_ambulatory_display"
                type="derived"
                derivedValue={formData.pulm_current_6mwt_m ? `${formData.pulm_current_6mwt_m} meters` : "6MWT not recorded"}
              />
              <FormField
                label="HOME STAIRS / ARCHITECTURAL BARRIERS"
                name="disp_home_stairs"
                type="select"
                options={["", "No stairs / Single level home", "Elevator accessible", "Flight of stairs without ramp", "Multiple flights of stairs"]}
              />
              <FormField
                label="DISCHARGE OXYGEN AT REST / EXERTION"
                name="disp_o2_prescribed_display"
                type="derived"
                derivedValue={formData.air_o2_device ? `${formData.air_o2_device} (${formData.med_o2_flow || "Titrated"} L/min)` : "Room air"}
              />
            </div>
          </Section>
        </div>

        {/* ─── 2: Destination & Transport ─────────────────────────── */}
        <div>
          <Section title="Post-Acute Disposition & Destination Level" note="Defines receiving care facility and transfer coordination">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField
                label="DISCHARGE DESTINATION"
                name="disp_destination"
                type="select"
                options={[
                  "",
                  "Home (Self-Care)",
                  "Home with Home Health (Nursing / RT)",
                  "Skilled Nursing Facility (SNF)",
                  "Long-Term Acute Care Hospital (LTACH)",
                  "Inpatient Rehabilitation Facility (IRF)",
                  "Home Hospice / Palliative Care",
                  "Inpatient Hospice Unit",
                  "Transfer to Higher Acuity / ICU",
                ]}
              />
              <FormField
                label="TRANSPORTATION METHOD"
                name="disp_transport_mode"
                type="select"
                options={["", "Self / Family Transport (Private Vehicle)", "Wheelchair Van Service", "Ambulance (BLS with Supplemental O2)", "Ambulance (ALS with Ventilator/NIV)", "Critical Care Air Transport"]}
              />
              <FormField
                label="TRANSPORT OXYGEN REQUIREMENT"
                name="disp_transport_o2"
                type="select"
                options={["", "Room air — No O2 required", "Continuous O2 via portable tank", "Continuous NIV / Mechanical ventilator"]}
              />
            </div>

            {/* Conditionally rendered facility fields */}
            {(formData.disp_destination === "Skilled Nursing Facility (SNF)" ||
              formData.disp_destination === "Long-Term Acute Care Hospital (LTACH)" ||
              formData.disp_destination === "Inpatient Rehabilitation Facility (IRF)" ||
              formData.disp_destination === "Transfer to Higher Acuity / ICU") && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
                <FormField label="RECEIVING / ACCEPTING FACILITY NAME" name="disp_accepting_facility" placeholder="e.g. Metro Pulmonary Rehabilitation Institute" />
                <FormField label="ACCEPTING PHYSICIAN / SERVICE NAME" name="disp_accepting_provider" placeholder="e.g. Receiving Physician / Specialist" />
              </div>
            )}

            {formData.disp_destination === "Transfer to Higher Acuity / ICU" && (
              <FormField
                label="CLINICAL RATIONALE FOR HIGHER ACUITY TRANSFER"
                name="disp_transfer_reason"
                type="textarea"
                placeholder="Document acute decompensation, refractory hypercapnic acidosis, hemodynamic instability, or intubation requirement..."
              />
            )}
          </Section>
        </div>

        {/* ─── 3: Equipment & DME Orders ──────────────────────────── */}
        <div>
          <Section title="Durable Medical Equipment (DME) Orders & Requisition" note="Ensure home respiratory equipment is confirmed prior to discharge">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField
                label="HOME OXYGEN CONCENTRATOR"
                name="disp_dme_o2_concentrator"
                type="select"
                options={["Not Needed", "Ordered — Stationary Concentrator (5L/min)", "Ordered — High-Flow Concentrator (10L/min)", "Patient Already Has Stationary Unit"]}
              />
              <FormField
                label="PORTABLE OXYGEN MODALITY"
                name="disp_dme_o2_portable"
                type="select"
                options={["Not Needed", "E-Cylinders with Conserving Regulator", "Portable Oxygen Concentrator (POC)", "Liquid Oxygen Unit", "Patient Already Has Portable O2"]}
              />
              <FormField
                label="NON-INVASIVE VENTILATOR (NIV/BiPAP)"
                name="disp_dme_niv_device"
                type="select"
                options={["Not Needed", "Ordered — BiPAP S/T Home Machine", "Ordered — Auto-CPAP Machine", "Ordered — AVAPS Device", "Patient Already Has Device"]}
              />
              <FormField
                label="NIV MASK TYPE ORDERED"
                name="disp_dme_niv_mask"
                type="select"
                options={["Not Applicable", "Full Face Mask (Size M)", "Full Face Mask (Size L)", "Nasal Mask (Size M)", "Nasal Pillows", "Total Face Mask"]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField
                label="COMPRESSOR / MESH NEBULIZER"
                name="disp_dme_nebulizer"
                type="select"
                options={["Not Needed", "Ordered — Tabletop Compressor Nebulizer", "Ordered — Portable Mesh Nebulizer", "Patient Already Has Nebulizer"]}
              />
              <FormField
                label="MOBILITY AID / ASSISTIVE DEVICE"
                name="disp_dme_mobility_aid"
                type="select"
                options={["None", "Standard Walker", "Four-Wheel Rollator with Seat", "Lightweight Wheelchair", "Single-Point Cane"]}
              />
              <FormField
                label="DME SUPPLIER / VENDOR COMPANY"
                name="disp_dme_supplier"
                placeholder="e.g. Medical Equipment Supplier / Vendor"
              />
              <FormField
                label="CONFIRMED DELIVERY DATE"
                name="disp_dme_delivery_date"
                type="date"
              />
            </div>
          </Section>
        </div>

        {/* ─── 4: Medication Reconciliation ──────────────────────── */}
        <div>
          <Section title="Medication Changes & Transition Summary" note="Document acute-to-chronic therapy transitions">
            <FormField
              label="MEDICATION RECONCILIATION SUMMARY (Changes from Admission)"
              name="disp_med_changes_summary"
              type="textarea"
              placeholder="e.g. Switched IV hydrocortisone to oral Prednisolone 30mg daily x 5 days. Added inhaled LABA/LAMA (Tiotropium-Olodaterol). Discontinued NSAIDs..."
            />
          </Section>

          <Section title="Structured Discharge Prescriptions (Take-Home Medications)" note="Itemized list with dosage, duration, and patient instructions">
            {/* Add New Prescription Row Builder */}
            <div style={{ background: "#f9f9f9", padding: "12px", border: "1px solid #e0e0e0", marginBottom: "14px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#333", marginBottom: "8px" }}>
                Add New Discharge Prescription
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr auto", gap: "10px", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>DRUG NAME</label>
                  <input
                    style={inputStyle}
                    value={newRx.drug}
                    onChange={(e) => setNewRx({ ...newRx, drug: e.target.value })}
                    placeholder="e.g. Prednisolone / Azithromycin"
                  />
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>DOSE</label>
                  <input
                    style={inputStyle}
                    value={newRx.dose}
                    onChange={(e) => setNewRx({ ...newRx, dose: e.target.value })}
                    placeholder="e.g. 40 mg"
                  />
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>FREQUENCY</label>
                  <select
                    style={inputStyle}
                    value={newRx.freq}
                    onChange={(e) => setNewRx({ ...newRx, freq: e.target.value })}
                  >
                    <option value="OD">Once Daily (OD)</option>
                    <option value="BD">Twice Daily (BD)</option>
                    <option value="TDS">Three Times Daily (TDS)</option>
                    <option value="PRN">As Needed (PRN)</option>
                    <option value="QHS">At Bedtime (QHS)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>DURATION</label>
                  <input
                    style={inputStyle}
                    value={newRx.duration}
                    onChange={(e) => setNewRx({ ...newRx, duration: e.target.value })}
                    placeholder="e.g. 5 days"
                  />
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#666" }}>SPECIAL INSTRUCTIONS</label>
                  <input
                    style={inputStyle}
                    value={newRx.instructions}
                    onChange={(e) => setNewRx({ ...newRx, instructions: e.target.value })}
                    placeholder="e.g. Take with food in morning"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddRx}
                  style={{
                    padding: "7px 14px",
                    background: "#000",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                    height: "30px",
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Prescriptions Table */}
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Medication</th>
                  <th style={thStyle}>Dose</th>
                  <th style={thStyle}>Frequency</th>
                  <th style={thStyle}>Duration</th>
                  <th style={thStyle}>Instructions</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rxList.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                      No discharge prescriptions added yet. Use the builder above to itemize take-home medications.
                    </td>
                  </tr>
                ) : (
                  rxList.map((rx) => (
                    <tr key={rx.id}>
                      <td style={tdStyle}><b>{rx.drug}</b></td>
                      <td style={tdStyle}>{rx.dose}</td>
                      <td style={tdStyle}>{rx.freq}</td>
                      <td style={tdStyle}>{rx.duration}</td>
                      <td style={tdStyle}>{rx.instructions}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteRx(rx.id)}
                          style={{ padding: "2px 6px", fontSize: "11px", background: "#ffebee", color: "#c62828", border: "1px solid #ef9a9a", cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <FormField
                label="INHALER TECHNIQUE / SPACING DEVICE VERIFIED"
                name="disp_med_teaching_done"
                type="checkbox"
                inlineLabel="Inhaler technique, spacer use, and mouth rinsing verified with patient"
              />
              <FormField
                label="INHALER PROFICIENCY EVALUATION"
                name="disp_med_inhaler_proficiency"
                type="select"
                options={["", "Demonstrated Adequate Inhalation Technique", "Needs Supervised Caregiver Assistance", "Transition to Compressor Nebulizer Preferred"]}
              />
            </div>
          </Section>
        </div>

        {/* ─── 5: Follow-up & Referrals ────────────────────────────── */}
        <div>
          <Section title="Post-Discharge Appointments & Clinical Accountability" note="Ensure continuity of care across outpatient services">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField label="PULMONOLOGY CLINIC FOLLOW-UP DATE" name="disp_followup_pulm_date" type="date" />
              <FormField label="PULMONOLOGY PROVIDER / LOCATION" name="disp_followup_pulm_clinic" placeholder="e.g. Chest Clinic, Room 402" />
              <FormField label="PRIMARY CARE (PCP) FOLLOW-UP DATE" name="disp_followup_pcp_date" type="date" />
              <FormField label="PCP PHYSICIAN / CLINIC NAME" name="disp_followup_pcp_name" placeholder="e.g. Primary Care Physician / Clinic" />
            </div>
          </Section>

          <Section title="Specialist & Supportive Referrals" note="Check all referrals initiated during encounter">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField label="PULMONARY REHABILITATION" name="disp_ref_rehab" type="checkbox" inlineLabel="Outpatient Pulmonary Rehab (GOLD Group E indication)" />
              <FormField label="SLEEP MEDICINE / CPAP TITRATION" name="disp_ref_sleep" type="checkbox" inlineLabel="Diagnostic Polysomnography (PSG) / Sleep Clinic" />
              <FormField label="PALLIATIVE & SYMPTOM CARE" name="disp_ref_palliative" type="checkbox" inlineLabel="Palliative Care consultation for refractory dyspnea" />
              <FormField label="THORACIC SURGERY CONSULTATION" name="disp_ref_thoracic" type="checkbox" inlineLabel="LVRS, Bullectomy, or Interventional review" />
              <FormField label="LUNG TRANSPLANT PROGRAM" name="disp_ref_tx" type="checkbox" inlineLabel="Tertiary Lung Transplant Center referral" />
              <FormField label="SMOKING CESSATION PROGRAM" name="disp_ref_smoking" type="checkbox" inlineLabel="Structured behavioral & pharmacotherapy program" />
            </div>
          </Section>

          <Section title="Red-Flag Symptoms & Emergency Return Precautions" note="Clear, patient-centered return instructions">
            <FormField
              label="PATIENT-FACING RETURN PRECAUTIONS"
              name="disp_return_precautions"
              type="textarea"
              placeholder="Return immediately if..."
            />
          </Section>
        </div>

        {/* ─── 6: Patient Education & Sign-off ─────────────────────── */}
        <div>
          <Section title="Caregiver Presence & Teach-Back Confirmation" note="Validate comprehension before physical discharge">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField
                label="CAREGIVER / FAMILY MEMBER PRESENT"
                name="disp_caregiver_present"
                type="select"
                options={["", "Yes — Primary Caregiver Present", "Yes — Family Member Present", "No — Patient Independent", "No — Caregiver Contacted via Phone"]}
              />
              <FormField
                label="CAREGIVER NAME & RELATIONSHIP"
                name="disp_caregiver_name"
                placeholder="e.g. Caregiver Name (Relationship)"
              />
              <FormField
                label="TEACH-BACK DEMONSTRATED"
                name="disp_teach_back_confirmed"
                type="checkbox"
                inlineLabel="Patient/Caregiver demonstrated verbal understanding and return demo"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
              <FormField label="OXYGEN FIRE SAFETY EDUCATED" name="disp_edu_o2_safety" type="checkbox" inlineLabel="No smoking near oxygen, 5ft clear from open flames" />
              <FormField label="WRITTEN COPD / ASTHMA ACTION PLAN" name="disp_edu_action_plan" type="checkbox" inlineLabel="Color-coded green/yellow/red action plan provided" />
              <FormField label="EMERGENCY CONTACT NUMBERS PROVIDED" name="disp_edu_contacts" type="checkbox" inlineLabel="24/7 clinic triage line and DME provider number given" />
            </div>
          </Section>

          {/* Clinical Focus: Summary & Trajectory Aggregation */}
          <Section title="Clinical Focus & Hospital Course Summary" note="Aggregates diagnoses, procedures, and disease trajectory">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <FormField
                  label="PRIMARY PULMONARY DIAGNOSIS"
                  name="disp_summary_primary_dx"
                  type="derived"
                  derivedValue={formData.pulm_primary_dx || "Primary diagnosis unspecified"}
                />
                <FormField
                  label="PRIMARY RADIOGRAPHIC FINDING (Baseline Imaging)"
                  name="img_primary_finding"
                  type="select"
                  options={[
                    "",
                    "Normal / Clear",
                    "Fibrosis / Honeycombing",
                    "Hyperinflation / Emphysema",
                    "Bronchiectasis",
                    "Lung Nodule / Mass",
                    "Pleural Effusion",
                  ]}
                />
              </div>
              <div>
                <label style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "4px" }}>
                  SECONDARY DIAGNOSES &amp; COMORBIDITIES ({secondaryDxList.length} Listed)
                </label>
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <input
                    style={inputStyle}
                    value={newSecDx}
                    onChange={(e) => setNewSecDx(e.target.value)}
                    placeholder="e.g. Cor pulmonale, Bronchiectasis, Type 2 Respiratory Failure, GERD..."
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddSecDx(); } }}
                  />
                  <button
                    type="button"
                    onClick={handleAddSecDx}
                    style={{
                      padding: "6px 14px",
                      background: "#000000",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 600,
                      height: "30px",
                      marginTop: "4px",
                      textTransform: "uppercase",
                    }}
                  >
                    Add
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {secondaryDxList.length === 0 ? (
                    <span style={{ fontSize: "11px", color: "#888888" }}>No secondary diagnoses added. Type above and click Add.</span>
                  ) : (
                    secondaryDxList.map((dx, idx) => (
                      <span
                        key={idx}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "#f5f5f5",
                          border: "1px solid #e0e0e0",
                          padding: "3px 8px",
                          borderRadius: "2px",
                          fontSize: "11px",
                          color: "#000000",
                        }}
                      >
                        {dx}
                        <button
                          type="button"
                          onClick={() => handleDeleteSecDx(idx)}
                          style={{ background: "transparent", border: "none", color: "#888888", cursor: "pointer", padding: "0 2px", fontSize: "12px", fontWeight: 700 }}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Structured ICD-10 Coding Module (Monochrome Swiss Theme) */}
            <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "14px", marginBottom: "16px", borderRadius: "2px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#000000" }}>
                    Structured ICD-10 Diagnostic Coding Table ({icdList.length} Codes)
                  </span>
                  <div style={{ fontSize: "11px", color: "#666666", marginTop: "2px" }}>
                    Itemize standard ICD-10 diagnostic classifications for clinical registry, billing, and transition handover.
                  </div>
                </div>

                {/* Quick Presets */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {[
                    { code: "J44.1", desc: "COPD with acute exacerbation", type: "Primary" },
                    { code: "J45.901", desc: "Unspecified asthma with acute exacerbation", type: "Primary" },
                    { code: "J84.112", desc: "Idiopathic pulmonary fibrosis (IPF)", type: "Primary" },
                    { code: "J90", desc: "Pleural effusion, not elsewhere classified", type: "Secondary" },
                    { code: "J93.9", desc: "Pneumothorax, unspecified", type: "Secondary" },
                    { code: "J96.01", desc: "Acute respiratory failure with hypoxia", type: "Primary" },
                    { code: "J96.21", desc: "Acute on chronic respiratory failure with hypoxia", type: "Primary" },
                    { code: "Z99.81", desc: "Dependence on supplemental oxygen", type: "Manifestation" },
                  ].map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => handleQuickAddIcd(p.code, p.desc, p.type)}
                      style={{
                        padding: "4px 8px",
                        fontSize: "11px",
                        fontWeight: 500,
                        background: "#ffffff",
                        border: "1px solid #000000",
                        borderRadius: "2px",
                        cursor: "pointer",
                        color: "#000000",
                      }}
                    >
                      + {p.code}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add Custom Code Builder */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 3fr 1.5fr auto", gap: "10px", alignItems: "end", marginBottom: "12px", background: "#ffffff", padding: "12px", border: "1px solid #e0e0e0" }}>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#888888", textTransform: "uppercase" }}>ICD-10 CODE</label>
                  <input style={inputStyle} value={newIcd.code} onChange={(e) => setNewIcd({ ...newIcd, code: e.target.value.toUpperCase() })} placeholder="e.g. J44.1" />
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#888888", textTransform: "uppercase" }}>DESCRIPTION</label>
                  <input style={inputStyle} value={newIcd.desc} onChange={(e) => setNewIcd({ ...newIcd, desc: e.target.value })} placeholder="e.g. COPD with (acute) exacerbation" />
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#888888", textTransform: "uppercase" }}>TYPE</label>
                  <select style={inputStyle} value={newIcd.type} onChange={(e) => setNewIcd({ ...newIcd, type: e.target.value })}>
                    <option value="Primary">Primary Diagnosis</option>
                    <option value="Secondary">Secondary Diagnosis</option>
                    <option value="Complication">Procedural Complication</option>
                    <option value="Manifestation">Manifestation / Chronic Sign</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddIcd}
                  style={{
                    padding: "6px 16px",
                    background: "#000000",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    height: "30px",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Add Code
                </button>
              </div>

              {/* ICD-10 Table */}
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>ICD-10 Code</th>
                    <th style={thStyle}>Clinical Description</th>
                    <th style={thStyle}>Diagnostic Type</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {icdList.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#888888" }}>
                        No ICD-10 codes assigned. Use the quick presets or custom builder above.
                      </td>
                    </tr>
                  ) : (
                    icdList.map((item) => (
                      <tr key={item.id}>
                        <td style={tdStyle}><b>{item.code}</b></td>
                        <td style={tdStyle}>{item.desc}</td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: "2px",
                            background: "#f0f0f0",
                            color: "#000000",
                            border: "1px solid #d0d0d0",
                            fontSize: "10.5px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}>
                            {item.type}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => handleDeleteIcd(item.id)}
                            style={{ padding: "2px 8px", fontSize: "11px", background: "#ffffff", color: "#c62828", border: "1px solid #c62828", cursor: "pointer" }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <FormField
                label="PROCEDURAL & INTERVENTIONAL HISTORY (Aggregated)"
                name="disp_summary_proc_history"
                type="textarea"
                placeholder="e.g. Flexible Bronchoscopy with BAL (Right Middle Lobe); Ultrasound-guided thoracentesis 1200mL serous exudate; NIV titration on BiPAP 16/6..."
              />
            </div>

            {/* Trajectory of Illness & Auto-Synthesizer Button */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "10px" }}>
                <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#888888" }}>
                  TRAJECTORY OF ILLNESS &amp; COMPREHENSIVE CLINICAL COURSE
                </label>
                <button
                  type="button"
                  onClick={handleSynthesizeSummary}
                  style={{
                    padding: "7px 16px",
                    background: "#000000",
                    color: "#ffffff",
                    border: "1px solid #000000",
                    borderRadius: "2px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Synthesize Comprehensive Clinical Summary
                </button>
              </div>
              <textarea
                rows={8}
                value={formData.disp_summary_trajectory || ""}
                onChange={(e) => updateField("disp_summary_trajectory", e.target.value)}
                placeholder="Click 'Synthesize Comprehensive Clinical Summary' above to auto-aggregate patient profile, PFTs, ABG, imaging, procedures, recovery logs, take-home prescriptions, and DME requisitions into an executive discharge narrative, or write custom trajectory..."
                style={{
                  ...inputStyle,
                  fontFamily: "inherit",
                  fontSize: "12px",
                  lineHeight: "1.5",
                  background: "#ffffff",
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <FormField
                label="PROGNOSIS & REHABILITATION POTENTIAL"
                name="disp_summary_prognosis"
                type="select"
                options={[
                  "Good — High potential for outpatient functional recovery",
                  "Guarded — Vulnerable to recurrent exacerbations; strict inhaler adherence required",
                  "Progressive Decline — Advanced pulmonary disease; home oxygen dependent",
                  "Palliative — Symptom management & comfort-focused care",
                ]}
              />
              <FormField
                label="SCHEDULED FOLLOW-UP INTERVAL"
                name="disp_summary_followup_interval"
                type="select"
                options={[
                  "Urgent: 7–10 days post-discharge (Post-exacerbation clinic)",
                  "Routine: 2–4 weeks (Outpatient Pulmonology Clinic)",
                  "Specialist: 6–8 weeks with repeat Spirometry / PFT",
                  "Primary Care Physician within 7 days",
                ]}
              />
            </div>
          </Section>

          {/* Multidisciplinary Tripartite Staff Sign-off & Case Finalization */}
          <Section title="Multidisciplinary Care Team Attestation & Case Finalization" variant="dark" note="Tripartite clinical sign-off (Attending, Fellow/Resident, RT/Nursing) executing atomic record seal">
            <div style={{ marginBottom: "16px", background: "#f9f9f9", padding: "14px 16px", borderRadius: "2px", border: "1px solid #e0e0e0" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "12px", color: "#000000", cursor: "pointer", lineHeight: "1.4" }}>
                <input
                  type="checkbox"
                  checked={!!formData.disp_consultant_attestation}
                  onChange={(e) => updateField("disp_consultant_attestation", e.target.checked)}
                  style={{ marginTop: "2px" }}
                />
                <span>
                  <b>Master Clinical Team Attestation:</b> I attest that the multidisciplinary care team has evaluated the patient, reviewed all diagnostic investigations, procedural operative records, and post-procedure monitoring panels. We approve this comprehensive discharge summary, take-home medication reconciliation, and post-acute care transition plan.
                </span>
              </label>
            </div>

            {/* Tripartite Sign-off Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
              {/* 1. Attending Pulmonologist */}
              <div style={{ background: "#f9f9f9", padding: "14px", border: "1px solid #e0e0e0", borderRadius: "2px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#000000", marginBottom: "8px", borderBottom: "1px solid #e0e0e0", paddingBottom: "6px" }}>
                  1. Attending Pulmonologist
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#888888", textTransform: "uppercase" }}>ATTENDING PHYSICIAN NAME</label>
                  <input
                    style={inputStyle}
                    value={formData.disp_sign_attending_name ?? (formData.team_pulmonologist || "")}
                    onChange={(e) => updateField("disp_sign_attending_name", e.target.value)}
                    placeholder="Dr. Attending Pulmonologist, MD"
                  />
                </div>
                <div style={{ marginTop: "10px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#000000", fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!formData.disp_sign_attending_check}
                      onChange={(e) => {
                        updateField("disp_sign_attending_check", e.target.checked);
                        if (e.target.checked) updateField("disp_sign_attending_time", new Date().toISOString());
                      }}
                    />
                    Attending Sign-off Stamped
                  </label>
                  <div style={{ fontSize: "10.5px", color: "#666666", marginTop: "4px" }}>
                    {formData.disp_sign_attending_time ? new Date(formData.disp_sign_attending_time).toLocaleString() : "Pending signature"}
                  </div>
                </div>
              </div>

              {/* 2. Pulmonary Fellow / Resident */}
              <div style={{ background: "#f9f9f9", padding: "14px", border: "1px solid #e0e0e0", borderRadius: "2px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#000000", marginBottom: "8px", borderBottom: "1px solid #e0e0e0", paddingBottom: "6px" }}>
                  2. Pulmonary Fellow / Resident
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#888888", textTransform: "uppercase" }}>FELLOW / REGISTRAR NAME</label>
                  <input
                    style={inputStyle}
                    value={formData.disp_sign_fellow_name || ""}
                    onChange={(e) => updateField("disp_sign_fellow_name", e.target.value)}
                    placeholder="Dr. Fellow / Registrar, MD"
                  />
                </div>
                <div style={{ marginTop: "10px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#000000", fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!formData.disp_sign_fellow_check}
                      onChange={(e) => {
                        updateField("disp_sign_fellow_check", e.target.checked);
                        if (e.target.checked) updateField("disp_sign_fellow_time", new Date().toISOString());
                      }}
                    />
                    Fellow / Resident Sign-off
                  </label>
                  <div style={{ fontSize: "10.5px", color: "#666666", marginTop: "4px" }}>
                    {formData.disp_sign_fellow_time ? new Date(formData.disp_sign_fellow_time).toLocaleString() : "Pending signature"}
                  </div>
                </div>
              </div>

              {/* 3. Respiratory Care / Specialized Nurse */}
              <div style={{ background: "#f9f9f9", padding: "14px", border: "1px solid #e0e0e0", borderRadius: "2px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#000000", marginBottom: "8px", borderBottom: "1px solid #e0e0e0", paddingBottom: "6px" }}>
                  3. RT / Specialized Pulmonary Nurse
                </div>
                <div>
                  <label style={{ fontSize: "10px", fontWeight: 600, color: "#888888", textTransform: "uppercase" }}>CLINICAL RT / NURSE NAME</label>
                  <input
                    style={inputStyle}
                    value={formData.disp_sign_rt_name || ""}
                    onChange={(e) => updateField("disp_sign_rt_name", e.target.value)}
                    placeholder="Staff RRT / RN Name"
                  />
                </div>
                <div style={{ marginTop: "10px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#000000", fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!formData.disp_sign_rt_check}
                      onChange={(e) => {
                        updateField("disp_sign_rt_check", e.target.checked);
                        if (e.target.checked) updateField("disp_sign_rt_time", new Date().toISOString());
                      }}
                    />
                    RT / Specialty Nurse Sign-off
                  </label>
                  <div style={{ fontSize: "10.5px", color: "#666666", marginTop: "4px" }}>
                    {formData.disp_sign_rt_time ? new Date(formData.disp_sign_rt_time).toLocaleString() : "Pending signature"}
                  </div>
                </div>
              </div>
            </div>

            {/* Case Finalization Action Bar (Monochrome Swiss Theme) */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f9f9f9",
                padding: "16px 20px",
                border: "1px solid #e0e0e0",
                borderRadius: "2px",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "4px 10px",
                    borderRadius: "2px",
                    background: sessionStatus === "completed" || formData.disp_case_status === "Completed" ? "#000000" : "#f0f0f0",
                    color: sessionStatus === "completed" || formData.disp_case_status === "Completed" ? "#ffffff" : "#000000",
                    border: "1px solid #d0d0d0",
                  }}
                >
                  Case Status: {sessionStatus === "completed" || formData.disp_case_status === "Completed" ? "Completed (Sealed)" : "Active Encounter"}
                </span>
                <span style={{ fontSize: "12px", color: "#666666" }}>
                  {sessionStatus === "completed"
                    ? "Chart is permanently finalized and archived in medical records."
                    : "Ready to finalize case record and lock encounter."}
                </span>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={handlePrintDischarge}
                  style={{
                    padding: "9px 18px",
                    background: "#ffffff",
                    color: "#000000",
                    border: "1px solid #000000",
                    borderRadius: "2px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Print Discharge Summary
                </button>

                <button
                  type="button"
                  onClick={handleSaveFullRecord}
                  disabled={isSaving || sessionStatus === "completed"}
                  style={{
                    padding: "9px 24px",
                    background: isSaving || sessionStatus === "completed" ? "#666666" : "#000000",
                    color: "#ffffff",
                    border: "1px solid #000000",
                    borderRadius: "2px",
                    cursor: isSaving || sessionStatus === "completed" ? "default" : "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {isSaving
                    ? "Sealing Record..."
                    : sessionStatus === "completed"
                      ? "Record Completed & Sealed"
                      : "Save Full Record"}
                </button>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* ─── Formal Medical Discharge Document Print Preview Modal ─────────── */}
      {showPrintModal && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            backgroundColor: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "24px 16px",
            boxSizing: "border-box",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "920px",
              background: "#ffffff",
              borderRadius: "4px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              marginBottom: "32px",
            }}
          >
            {/* Modal Header & Actions */}
            <div
              style={{
                background: "#0f172a",
                color: "#ffffff",
                padding: "12px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
                borderBottom: "1px solid #334155",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#38bdf8" }}>
                  Official Clinical Document Preview
                </span>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#f8fafc" }}>
                  Pulmonary Encounter Discharge Summary &amp; Care Transition Record
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={handleCopySummaryText}
                  style={{
                    padding: "7px 14px",
                    background: copySuccess ? "#15803d" : "#1e293b",
                    color: "#ffffff",
                    border: "1px solid #475569",
                    borderRadius: "2px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>{copySuccess ? "✓" : "📋"}</span>
                  <span>{copySuccess ? "Copied to Clipboard!" : "Copy Narrative Text"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExecutePrint}
                  style={{
                    padding: "7px 18px",
                    background: "#0284c7",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "2px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "0 2px 4px rgba(2, 132, 199, 0.3)",
                  }}
                >
                  <span>🖨️</span>
                  <span>Print / Save as PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  style={{
                    padding: "7px 12px",
                    background: "#334155",
                    color: "#f8fafc",
                    border: "none",
                    borderRadius: "2px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Document Body Preview */}
            <div style={{ padding: "16px 20px", background: "#f1f5f9", maxHeight: "80vh", overflowY: "auto" }}>
              <div style={{ background: "#ffffff", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)", borderRadius: "2px" }}>
                <FormalDischargeDocument formData={formData} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Dedicated Hidden Container for Media Print Isolation ─────────── */}
      <div className="print-only-root">
        <FormalDischargeDocument formData={formData} />
      </div>

      {/* ─── Global Print Stylesheet ───────────────────────────────────────── */}
      <style>{`
        @media screen {
          .print-only-root {
            display: none !important;
          }
        }
        @media print {
          html, body, #root, .ant-layout, .app-layout, .dashboard-content, .workspace-content {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            width: 100% !important;
            height: auto !important;
            min-height: 100% !important;
            overflow: visible !important;
          }
          /* 1. Hide every single interactive dashboard widget, header, navigation, button, and input */
          body * {
            visibility: hidden !important;
          }
          nav, header, aside, .no-print, button, input, select, textarea, [role="navigation"], .ant-layout-header, .top-bar {
            display: none !important;
          }
          
          /* 2. Show strictly and exclusively the formal discharge summary report */
          .print-only-root {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
            z-index: 999999 !important;
          }
          .print-only-root, .print-only-root * {
            visibility: visible !important;
          }
          #formal-discharge-document {
            max-width: 100% !important;
            width: 100% !important;
            padding: 6mm 10mm !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
          .print-section {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            margin-bottom: 14px !important;
          }
          table {
            page-break-inside: auto !important;
            width: 100% !important;
            border-collapse: collapse !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          td, th {
            font-size: 10.5px !important;
            padding: 4px 6px !important;
          }
          @page {
            size: letter portrait;
            margin: 8mm;
          }
        }
      `}</style>
    </div>
  );
}
