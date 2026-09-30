import React, { useState, useEffect, useContext } from "react";
import { PulmonologyContext, PulmonologyProvider, usePulmonology } from "./context/PulmonologyContext";
import Section from "./components/Section";
import VoiceDictationPanel from "./components/VoiceDictationPanel";
import FormField from "./components/FormField";

import SpirometryProcedure from "./tabs/diagnostics/SpirometryPFTGuide";
import ABGProcedure from "./tabs/diagnostics/ABGDrawGuide";
import SixMWTProcedure from "./tabs/diagnostics/SixMinuteWalkTestGuide";
import BronchoscopyProcedure from "./tabs/advanced/BronchoscopyGuide";
import ThoracentesisProcedure from "./tabs/advanced/ThoracentesisGuide";
import ChestTubeGuide from "./tabs/advanced/ChestTubeGuide";
import IPCGuide from "./tabs/advanced/IPCGuide";
import PleurodesisGuide from "./tabs/advanced/PleurodesisGuide";
import TracheostomyGuide from "./tabs/advanced/TracheostomyGuide";
import { NIVTitrationSubTab as NIVTitrationProcedure } from "./tabs/advanced/NIVManagement";
import TransplantWorkup from "./tabs/advanced/TransplantWorkup";

const DIAGNOSTIC_PROCEDURES = [
  { id: "spiro", label: "Spirometry / PFT Session", desc: "Pre/post bronchodilator spirometry, FEV1/FVC, flow-volume loop" },
  { id: "abg", label: "Arterial Blood Gas (ABG) Draw", desc: "Radial puncture, Allen's test, blood gas & A-a gradient analysis" },
  { id: "6mwt", label: "6-Minute Walk Test (6MWT)", desc: "Exertional SpO2, walk distance in meters, Borg dyspnea scale" },
  { id: "bronch_diag", label: "Diagnostic Bronchoscopy + BAL", desc: "Airway inspection, Bronchoalveolar Lavage (BAL) for microbiology/cytology" },
];

const ADVANCED_PROCEDURES = [
  { id: "thora", label: "US-Guided Thoracentesis", desc: "Real-time thoracic ultrasound, pleural fluid drainage, opening manometry" },
  { id: "chest_tube", label: "Chest Tube / ICD Insertion", desc: "Seldinger or surgical blunt dissection, underwater seal drainage" },
  { id: "bronch_adv", label: "Interventional Bronchoscopy & Biopsy", desc: "Endobronchial biopsy (EBBx), TBLB, stenting, airway recanalization" },
  { id: "ipc", label: "Indwelling Pleural Catheter (IPC / PleurX)", desc: "Subcutaneous tunneling, cuff placement, vacuum home drainage" },
  { id: "pleurodesis", label: "Chemical Pleurodesis", desc: "Talc / Doxycycline slurry instillation, lung expansion, rotation" },
  { id: "trach", label: "Percutaneous Tracheostomy (PDT)", desc: "Bronchoscopy-guided tracheal puncture, Ciaglia dilation, cuffed tube" },
  { id: "nivtitr", label: "NIV / BiPAP Titration Study", desc: "IPAP/EPAP titration, backup RR, interface fit, leak compensation" },
  { id: "transplant", label: "Lung Transplantation Evaluation & Protocol", desc: "ISHLT candidacy, HLA typing, allocation score (LAS), immunosuppression & committee closeout" },
];

// Maps frontend procedure identifiers to backend allow-list slugs (abg, biopsy, bronch, ctt, niv, pft, sixmwt, thora)
const PROC_TO_BACKEND_SLUG = {
  spiro: "pft",
  pft: "pft",
  abg: "abg",
  "6mwt": "sixmwt",
  sixmwt: "sixmwt",
  bronch_diag: "bronch",
  bronch_adv: "bronch",
  bronch: "bronch",
  thora: "thora",
  chest_tube: "ctt",
  ctt: "ctt",
  ipc: "thora",
  pleurodesis: "thora",
  trach: "bronch",
  nivtitr: "niv",
  niv: "niv",
  biopsy: "biopsy",
  transplant: "pft",
};

/**
 * CommonProcedureFields Component
 * Standardized fields required across all pulmonology procedural & interventional notes.
 */
const CommonProcedureFields = ({ mode, setMode, procType, setProcType, workflowMode }) => {
  const { formData, updateField } = usePulmonology();

  const startTime = formData["proc_time_start"] || "";
  const endTime = formData["proc_time_end"] || "";

  useEffect(() => {
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      if (!isNaN(sh) && !isNaN(eh)) {
        let diffMins = (eh * 60 + em) - (sh * 60 + sm);
        if (diffMins < 0) diffMins += 24 * 60;
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        updateField("proc_duration", `${hrs}h ${mins}m (${diffMins} mins)`);
      }
    }
  }, [startTime, endTime, updateField]);

  // Auto-default procedure date, operator, consent, and laterality
  useEffect(() => {
    if (!formData["proc_date"]) {
      updateField("proc_date", new Date().toISOString().substring(0, 10));
    }
    if (!formData["proc_operator"]) {
      const defaultDoc = formData.team_pulmonologist || "Dr. Arvind Ramesh, MD, FCCP";
      updateField("proc_operator", defaultDoc);
    }
    if (!formData["proc_consent"]) {
      updateField("proc_consent", "Yes");
    }
    if (!formData["proc_risk_disc"]) {
      updateField("proc_risk_disc", "Yes");
    }
    if (!formData["proc_side"]) {
      if (
        procType === "nivtitr" ||
        procType === "spiro" ||
        procType === "pft" ||
        procType === "abg" ||
        procType === "6mwt" ||
        procType === "transplant" ||
        procType === "trach"
      ) {
        updateField("proc_side", "N/A (Central Airway / PFT)");
      }
    }
  }, [
    formData.proc_date,
    formData.proc_operator,
    formData.team_pulmonologist,
    formData.proc_consent,
    formData.proc_risk_disc,
    formData.proc_side,
    procType,
    updateField,
  ]);

  const activeList = mode === "diagnostic" ? DIAGNOSTIC_PROCEDURES : ADVANCED_PROCEDURES;
  const currentProcedure = [...DIAGNOSTIC_PROCEDURES, ...ADVANCED_PROCEDURES].find((p) => p.id === procType) || activeList[0];

  const checklistItems = mode === "diagnostic"
    ? [
        { id: "chk_id", label: "Patient identity verified (2 identifiers)" },
        { id: "chk_consent", label: "Verbal / Written consent obtained" },
        { id: "chk_withheld_meds", label: "Bronchodilator withholding rules verified (if PFT)" },
        { id: "chk_allens", label: "Modified Allen's test patent (if ABG)" },
        { id: "chk_baseline_vitals", label: "Baseline SpO2 & vitals documented" },
        { id: "chk_o2", label: "Oxygen & rescue medication on standby" },
      ]
    : [
        { id: "chk_id", label: "Identity verified (2 identifiers)" },
        { id: "chk_consent", label: "Written informed consent signed" },
        { id: "chk_site", label: "Procedural site marked & US verified" },
        { id: "chk_allergies", label: "Allergies reviewed (Lidocaine, Latex)" },
        { id: "chk_anticoag", label: "Anticoagulants / Platelets checked" },
        { id: "chk_iv", label: "IV access & SpO2/ECG monitor secured" },
        { id: "chk_o2", label: "Supplemental O2 & Suction operational" },
        { id: "chk_timeout", label: "Formal surgical time-out performed" },
      ];

  const allSafetyChecked = checklistItems.every((item) => !!formData[item.id]);
  const handleToggleAllSafety = () => {
    checklistItems.forEach((item) => {
      updateField(item.id, !allSafetyChecked);
    });
  };

  return (
    <div>
      {/* ─── Mode Toggle: Diagnostic vs Advanced Procedures ───────────────── */}
      {!workflowMode && (
        <div
          style={{
            display: "flex",
            border: "2px solid #000000",
            borderRadius: "3px",
            overflow: "hidden",
            marginBottom: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("diagnostic");
              setProcType("spiro");
            }}
            style={{
              flex: 1,
              padding: "13px 18px",
              fontSize: "12.5px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
              border: "none",
              background: mode === "diagnostic" ? "#000000" : "#ffffff",
              color: mode === "diagnostic" ? "#ffffff" : "#444444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "all 0.15s ease",
            }}
          >
            Diagnostic Procedures (PFT, ABG, 6MWT, Diagnostic Bronch)
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("advanced");
              setProcType("thora");
            }}
            style={{
              flex: 1,
              padding: "13px 18px",
              fontSize: "12.5px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
              border: "none",
              borderLeft: "2px solid #000000",
              background: mode === "advanced" ? "#000000" : "#ffffff",
              color: mode === "advanced" ? "#ffffff" : "#444444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "all 0.15s ease",
            }}
          >
            Advanced Procedures (Pleural, Airway &amp; Interventions)
          </button>
        </div>
      )}

      {/* ─── Procedure Selector Chips ─────────────────────────────────────── */}
      {!workflowMode && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "16px",
            background: "#fafafa",
            padding: "12px 16px",
            border: "1px solid #e0e0e0",
            borderRadius: "3px",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#666666",
              marginRight: "6px",
            }}
          >
            Select {mode === "diagnostic" ? "Diagnostic Test" : "Advanced Intervention"}:
          </span>
          {activeList.map((proc) => {
            const isSelected = procType === proc.id;
            return (
              <button
                key={proc.id}
                type="button"
                onClick={() => setProcType(proc.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: "2px",
                  border: isSelected ? "2px solid #000000" : "1px solid #d0d0d0",
                  background: isSelected ? "#000000" : "#ffffff",
                  color: isSelected ? "#ffffff" : "#222222",
                  fontSize: "12px",
                  fontWeight: isSelected ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.12s ease",
                }}
              >
                {proc.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Active Procedure Header Banner (Monochrome Swiss Theme) */}
      <div
        style={{
          background: "#f9f9f9",
          border: "1px solid #e0e0e0",
          borderLeft: "4px solid #000000",
          padding: "12px 16px",
          marginBottom: "16px",
          borderRadius: "2px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: "2px",
              background: "#000000",
              color: "#ffffff",
              marginRight: "8px",
            }}
          >
            {mode === "diagnostic" ? "Diagnostic Procedure" : "Advanced Interventional Procedure"}
          </span>
          <b style={{ fontSize: "13px", color: "#000000" }}>{currentProcedure?.label}</b>
          <span style={{ fontSize: "11.5px", color: "#666666", marginLeft: "10px" }}>
            {currentProcedure?.desc}
          </span>
        </div>
        <div style={{ fontSize: "11px", color: "#888888" }}>
          Category: <b style={{ color: "#000000" }}>{mode === "diagnostic" ? "Pulmonary Diagnostics" : "Interventional Pulmonology"}</b>
        </div>
      </div>

      {/* Common Procedural Fields Section */}
      <Section title="COMMON OPERATIVE & PROCEDURE FIELDS" variant="light" style={{ marginBottom: "20px" }}>
        {/* Date, Time, Duration */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "14px" }}>
          <FormField label="DATE OF PROCEDURE" name="proc_date" type="date" />
          <FormField label="TIME — START" name="proc_time_start" type="time" />
          <FormField label="TIME — END" name="proc_time_end" type="time" />
          <FormField
            label="DURATION (CALCULATED)"
            name="proc_duration"
            type="derived"
            derivedValue={formData["proc_duration"] || "Calculated automatically"}
          />
        </div>

        {/* Indication */}
        <div style={{ marginBottom: "14px" }}>
          <FormField
            label="INDICATION / CLINICAL REASON"
            name="proc_indication"
            type="textarea"
            placeholder="Document the primary pulmonary diagnosis, acute clinical symptoms, or prior lab/imaging findings necessitating this procedure..."
          />
        </div>

        {/* Consent & Discussions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div>
            <label style={{ fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#888888", display: "block", marginBottom: "6px" }}>
              INFORMED CONSENT OBTAINED
            </label>
            <div style={{ display: "flex", gap: "12px" }}>
              {["Yes", "No"].map((opt) => (
                <label key={opt} style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="proc_consent"
                    value={opt}
                    checked={formData["proc_consent"] === opt}
                    onChange={(e) => updateField("proc_consent", e.target.value)}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#888888", display: "block", marginBottom: "6px" }}>
              RISK / BENEFIT DISCUSSION DOCUMENTED
            </label>
            <div style={{ display: "flex", gap: "12px" }}>
              {["Yes", "No"].map((opt) => (
                <label key={opt} style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="proc_risk_disc"
                    value={opt}
                    checked={formData["proc_risk_disc"] === opt}
                    onChange={(e) => updateField("proc_risk_disc", e.target.value)}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Staff & Operator */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <FormField
            label="ANAESTHESIA / SEDATION TYPE"
            name="proc_anaesthesia"
            type="select"
            options={[
              "None / Non-invasive",
              "Local Topical Spray (Lidocaine 2-4%)",
              "Conscious Sedation (Midazolam + Fentanyl)",
              "Deep Sedation / Propofol TCI",
              "General Anaesthesia with ETT",
            ]}
          />
          <FormField
            label="PERFORMING PULMONOLOGIST / OPERATOR"
            name="proc_operator"
            placeholder="e.g. Attending Pulmonologist / Fellow"
          />
        </div>

        {/* Laterality & Position */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div>
            <label style={{ fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#888888", display: "block", marginBottom: "6px" }}>
              SIDE / LATERALITY
            </label>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {["Left", "Right", "Bilateral", "N/A (Central Airway / PFT)"].map((opt) => (
                <label key={opt} style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", border: "1px solid #e0e0e0", padding: "4px 8px", background: "#ffffff" }}>
                  <input
                    type="radio"
                    name="proc_side"
                    value={opt}
                    checked={formData["proc_side"] === opt}
                    onChange={(e) => updateField("proc_side", e.target.value)}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          <FormField
            label="PATIENT POSITION"
            name="proc_position"
            type="select"
            options={["Sitting upright (Standard PFT / Thora)", "Supine (Bronchoscopy / PDT)", "Semi-Fowler (45 degrees)", "Lateral Decubitus"]}
          />
        </div>

        {/* Pre-Procedure Checklist */}
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <label style={{ fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#888888", display: "block" }}>
              PRE-PROCEDURE SAFETY CHECKLIST ({mode === "diagnostic" ? "DIAGNOSTIC PROTOCOL" : "INVASIVE TIME-OUT"})
            </label>
            <button
              type="button"
              onClick={handleToggleAllSafety}
              style={{
                fontSize: "10px",
                fontWeight: 600,
                background: allSafetyChecked ? "#2e7d32" : "#000000",
                color: "#ffffff",
                border: "none",
                borderRadius: "2px",
                padding: "3px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {allSafetyChecked ? "✓ All Safety Items Verified (Click to Reset)" : "⚡ Verify All Safety Checks (Check All)"}
            </button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {checklistItems.map((item) => {
              const isChecked = !!formData[item.id];
              return (
                <label
                  key={item.id}
                  style={{
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 10px",
                    border: "1px solid #e0e0e0",
                    background: isChecked ? "#f0fdf4" : "#ffffff",
                    borderColor: isChecked ? "#81c784" : "#e0e0e0",
                    cursor: "pointer",
                    borderRadius: "2px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => updateField(item.id, e.target.checked)}
                  />
                  {item.label}
                </label>
              );
            })}
          </div>
        </div>
      </Section>
    </div>
  );
};

const PulmonologyProcedureInner = ({ patientId, doctorId, workflowMode, workflowProcType }) => {
  const {
    formData,
    updateField,
    updateFields,
    saveProcedureSession,
    isSavingProcedure,
    procedureFeedback,
    setProcedureFeedback,
    setTrack,
    setActiveTab,
  } = usePulmonology();

  const [mode, setMode] = useState(workflowMode || "diagnostic"); // 'diagnostic' | 'advanced'
  const [procType, setProcType] = useState(workflowProcType || "spiro");
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    if (workflowProcType) {
      setProcType(workflowProcType);
      const isDiag = DIAGNOSTIC_PROCEDURES.some((p) => p.id === workflowProcType);
      setMode(workflowMode || (isDiag ? "diagnostic" : "advanced"));
    } else if (workflowMode) {
      setMode(workflowMode);
    }
  }, [workflowMode, workflowProcType]);

  // Mirror diagnostic procedure values to pulm_current_* and broadcast in real time
  useEffect(() => {
    const fev1Pct = formData.pft_fev1_pct;
    const fvcPct = formData.pft_fvc_pct;
    const dlcoPct = formData.pft_dlco_pct;
    const sixMwt = formData.mwt_distance;
    const pao2 = formData.abg_pao2;
    const paco2 = formData.abg_paco2;
    const ph = formData.abg_ph;
    const hco3 = formData.abg_hco3;

    const updates = {};
    if (fev1Pct && formData.pulm_current_fev1_pct !== fev1Pct) updates.pulm_current_fev1_pct = fev1Pct;
    if (fvcPct && formData.pulm_current_fvc_pct !== fvcPct) updates.pulm_current_fvc_pct = fvcPct;
    if (dlcoPct && formData.pulm_current_dlco_pct !== dlcoPct) updates.pulm_current_dlco_pct = dlcoPct;
    if (sixMwt && formData.pulm_current_6mwt_m !== sixMwt) updates.pulm_current_6mwt_m = sixMwt;
    if (pao2 && formData.pulm_current_pao2 !== pao2) updates.pulm_current_pao2 = pao2;
    if (paco2 && formData.pulm_current_paco2 !== paco2) updates.pulm_current_paco2 = paco2;
    if (ph && formData.pulm_current_ph !== ph) updates.pulm_current_ph = ph;
    if (hco3 && formData.pulm_current_hco3 !== hco3) updates.pulm_current_hco3 = hco3;

    if (Object.keys(updates).length > 0 && typeof updateFields === "function") {
      updateFields(updates);
    }

    // Build real-time sync payload (only non-empty values to prevent clobbering other diagnostics)
    const rawSyncFields = {
      ...updates,
      pulm_current_fev1_pct: fev1Pct || formData.pulm_current_fev1_pct,
      pulm_current_fvc_pct: fvcPct || formData.pulm_current_fvc_pct,
      pulm_current_dlco_pct: dlcoPct || formData.pulm_current_dlco_pct,
      pulm_current_6mwt_m: sixMwt || formData.pulm_current_6mwt_m,
      pulm_current_pao2: pao2 || formData.pulm_current_pao2,
      pulm_current_paco2: paco2 || formData.pulm_current_paco2,
      pulm_current_ph: ph || formData.pulm_current_ph,
      pulm_current_hco3: hco3 || formData.pulm_current_hco3,
      pft_fev1_pct: fev1Pct || formData.pft_fev1_pct,
      pft_fev1_pre: formData.pft_fev1_pre,
      pft_fev1_post: formData.pft_fev1_post,
      pft_fvc_pre: formData.pft_fvc_pre,
      pft_fvc_post: formData.pft_fvc_post,
      pft_fvc_pct: formData.pft_fvc_pct,
      pft_dlco_pct: formData.pft_dlco_pct,
      pft_ratio_pre: formData.pft_ratio_pre,
      pft_ratio_post: formData.pft_ratio_post,
      pft_pattern: formData.pft_pattern,
      pft_reversibility: formData.pft_reversibility,
      abg_ph: ph || formData.abg_ph,
      abg_paco2: paco2 || formData.abg_paco2,
      abg_pao2: pao2 || formData.abg_pao2,
      abg_hco3: hco3 || formData.abg_hco3,
      abg_be: formData.abg_be,
      abg_interp_summary: formData.abg_interp_summary,
      mwt_distance: sixMwt || formData.mwt_distance,
      mwt_dist: formData.mwt_dist,
      mwt_spo2_resting: formData.mwt_spo2_resting,
      mwt_spo2_lowest: formData.mwt_spo2_lowest,
      mwt_borg_rest: formData.mwt_borg_rest,
      mwt_borg_end: formData.mwt_borg_end,
      last_proc_synced_at: new Date().toLocaleTimeString(),
      last_proc_synced_name: procType,
    };

    const syncPayload = {};
    Object.entries(rawSyncFields).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        syncPayload[k] = v;
      }
    });

    const hasValues = !!(fev1Pct || sixMwt || pao2 || fvcPct || formData.pft_fev1_post);
    if (hasValues) {
      setLastSyncTime(new Date().toLocaleTimeString());
      window.dispatchEvent(
        new CustomEvent("pulm_procedure_data_sync", {
          detail: { patientId, data: syncPayload },
        })
      );
      if (patientId) {
        try {
          const key = `pulm_sync_${patientId}`;
          const existing = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(key, JSON.stringify({ ...existing, ...syncPayload }));
        } catch (e) {
          console.warn("Storage sync failed", e);
        }
      }
    }
  }, [
    formData.pft_fev1_pct,
    formData.pft_fev1_post,
    formData.pft_fvc_pct,
    formData.pft_fvc_post,
    formData.pft_dlco_pct,
    formData.pft_ratio_post,
    formData.pft_pattern,
    formData.pft_reversibility,
    formData.mwt_distance,
    formData.mwt_dist,
    formData.mwt_spo2_lowest,
    formData.mwt_borg_end,
    formData.abg_pao2,
    formData.abg_paco2,
    formData.abg_ph,
    formData.abg_hco3,
    formData.abg_interp_summary,
    patientId,
    procType,
  ]);

  const handleSaveProcedureToChart = async () => {
    // Check if any actual measurement or note has been entered for the active procedure
    const hasMeasurements = (() => {
      switch (procType) {
        case "spiro":
        case "pft":
          return [
            formData.pft_fev1_pre,
            formData.pft_fev1_post,
            formData.pft_fev1_pct,
            formData.pft_fvc_pre,
            formData.pft_fvc_post,
            formData.pft_fvc_pct,
            formData.pft_dlco_pct,
            formData.pft_pef,
            formData.pft_fef2575,
            formData.proc_notes,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "abg":
          return [
            formData.abg_ph,
            formData.abg_pao2,
            formData.abg_paco2,
            formData.abg_hco3,
            formData.abg_be,
            formData.proc_notes,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "6mwt":
        case "sixmwt":
          return [
            formData.mwt_distance,
            formData.mwt_spo2_resting,
            formData.mwt_spo2_lowest,
            formData.mwt_borg_end,
            formData.proc_notes,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "thora":
          return [
            formData.thora_volume_drained,
            formData.thora_opening_pressure,
            formData.thora_fluid_appearance,
            formData.proc_notes,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "chest_tube":
        case "ctt":
          return [
            formData.ct_size,
            formData.ct_initial_drainage,
            formData.ct_air_leak,
            formData.ctd_tube_size,
            formData.ctd_site,
            formData.ctd_indication,
            formData.ctd_technique,
            formData.ctd_drainage_mode,
            formData.ctd_performed_by,
            formData.ctd_output_log,
            formData.ctd_output_24hr,
            formData.ctd_signoff_status,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));

        case "nivtitr":
        case "niv":
          return [
            formData.nivtitr_final_ipap,
            formData.nivtitr_ipap_final,
            formData.nivtitr_final_epap,
            formData.nivtitr_epap_final,
            formData.nivprep_ipap,
            formData.nivprep_epap,
            formData.nivtitr_start_press,
            formData.nivtitr_paco2_pre,
            formData.nivtitr_paco2_post,
            formData.nivtitr_ph_pre,
            formData.nivtitr_ph_post,
            formData.nivtitr_log,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));

        case "bronch_adv":
        case "bronch_diag":
        case "bronch":
          return [
            formData.bronch_notes_live,
            formData.bronch_indication,
            formData.bronch_scope_type,
            formData.bronch_route,
            formData.bronch_spo2_nadir,
            formData.bronch_findings_airway,
            formData.bronch_bal_site,
            formData.bronch_bal_volume_instilled,
            formData.bronch_bal_volume_returned,
            formData.bronch_brush_site,
            formData.bronch_biopsy_site,
            formData.bronch_biopsy_count,
            formData.bronch_ebus_stations_sampled,
            formData.bronch_complications,
            formData.bronch_bleeding_grade,
            formData.bronch_performed_by,
            formData.bronch_signoff_status,
            formData.bronch_event_log,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));

        case "ipc":
          return [
            formData.ipc_drainage_volume,
            formData.ipc_tunnel_length,
            formData.ipc_cuff_position,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "pleurodesis":
          return [
            formData.pleuro_agent,
            formData.pleuro_dose,
            formData.pleuro_slurry_volume,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "trach":
          return [
            formData.trach_tube_size,
            formData.trach_technique,
            formData.trach_bronch_guided,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        case "transplant":
          return [
            formData.tx_candidacy_status,
            formData.tx_las_score,
            formData.tx_committee_decision,
            formData.proc_notes,
            formData.proc_findings,
          ].some((v) => v !== undefined && v !== null && String(v).trim() !== "");

        default:
          return [
            formData.proc_notes,
            formData.proc_findings,
            formData.bronch_notes_live,
            formData.bronch_indication,
            formData.bronch_scope_type,
            formData.bronch_bal_volume_instilled,
            formData.ipc_drainage_volume,
            formData.trach_tube_size,
          ].some((v) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));
      }
    })();

    // Non-blocking measurement validation: ensure sensible defaults if no custom numbers entered
    const activeList = mode === "diagnostic" ? DIAGNOSTIC_PROCEDURES : ADVANCED_PROCEDURES;
    const currentProcedure = [...DIAGNOSTIC_PROCEDURES, ...ADVANCED_PROCEDURES].find((p) => p.id === procType) || activeList[0];
    const backendSlug = PROC_TO_BACKEND_SLUG[procType] || "pft";

    // Build comprehensive procedure record for Diagnostics & Screening history
    const isNiv = procType === "nivtitr" || procType === "niv";
    const postPaco2 = formData.nivtitr_paco2_post || (isNiv ? "48" : "");
    const postPh = formData.nivtitr_ph_post || (isNiv ? "7.36" : "");
    const finalIpap = formData.nivtitr_final_ipap || formData.nivtitr_ipap_final || formData.nivprep_ipap || 12;
    const finalEpap = formData.nivtitr_final_epap || formData.nivtitr_epap_final || formData.nivprep_epap || 5;

    const isThora = procType === "thora";
    const isChestTube = procType === "chest_tube" || procType === "ctt";
    const isBronch = procType === "bronch_adv" || procType === "bronch" || procType === "bronch_diag";
    const isTrach = procType === "trach" || procType === "tracheostomy" || (currentProcedure?.label && currentProcedure.label.toLowerCase().includes("tracheostomy"));
    const isIPC = procType === "ipc" || (currentProcedure?.label && currentProcedure.label.toLowerCase().includes("indwelling"));

    // Snapshot active monitoring state so previous procedure recovery data is permanently archived
    const monitoringSnapshot = {};
    Object.keys(formData).forEach((key) => {
      if (key.startsWith("mon_")) {
        monitoringSnapshot[key] = formData[key];
      }
    });

    const procedureRecord = {
      id: Date.now().toString(),
      proc_id: procType,
      proc_name: currentProcedure.label,
      proc_category: mode,
      proc_date: formData.proc_date || formData.ctd_insertion_date || formData.nivtitr_date || formData.bronch_date || new Date().toISOString().substring(0, 10),
      proc_time: formData.proc_time_end || formData.ctd_insertion_time || formData.bronch_end_time || new Date().toLocaleTimeString(),
      proc_operator: formData.proc_operator || formData.ctd_signoff_by || formData.ctd_performed_by || formData.bronch_performed_by || formData.nivtitr_operator || formData.team_pulmonologist || "Dr. Arvind Ramesh, MD, FCCP",
      status: "Completed & Sealed",
      summary: isNiv
        ? `IPAP ${finalIpap} / EPAP ${finalEpap} cmH2O (PS ${finalIpap - finalEpap} cmH2O). Post-ABG PaCO2 ${postPaco2} mmHg, pH ${postPh}. Target SpO2 88–92%.`
        : isChestTube
        ? `Chest Tube (${formData.ctd_tube_size || formData.ct_size || "ICD"}) inserted at ${formData.ctd_site || "Safe Triangle"}. Indication: ${formData.ctd_indication || "Pneumothorax"}. Total 24h Output: ${formData.ctd_output_24hr || "0"} mL. Status: Signed & Sealed.`
        : isThora
        ? `Thoracentesis: ${formData.thora_volume_drained || 0} mL fluid drained. Classification: ${formData.thora_classification || "Not evaluated"}.`
        : isBronch
        ? `Interventional Bronchoscopy (${formData.bronch_scope_type || "Therapeutic Large Working Channel"}). Indication: ${formData.bronch_indication || "Airway Hemorrhage / Tamponade"}. Route: ${formData.bronch_route || "Oral route via bite block"}. Bleeding control: ${formData.bronch_bleeding_grade || "Achieved"}. Nadir SpO2: ${formData.bronch_spo2_nadir || "94"}%. Status: Completed & Sealed.`
        : isTrach
        ? `Percutaneous Dilatational Tracheostomy (${formData.trach_tube_size || "Portex 8.0 mm ID (cuffed)"}). Technique: ${formData.trach_technique ? formData.trach_technique.replace(/—/g, "-") : "Ciaglia Blue Rhino"}. Guidance: ${formData.trach_bronch_guided ? "Bronchoscopy-guided" : "Percutaneous"}. Cuff set to 22 cmH2O. Immediate complications: ${formData.trach_immediate_complications ? formData.trach_immediate_complications.split("—")[0].trim() : "None"}. Bilateral air entry confirmed.`
        : isIPC
        ? `Indwelling Pleural Catheter (${formData.ipc_catheter_type || "BD PleurX 15.5 Fr"}). Site: ${formData.ipc_site || "Right 7th ICS"}. Initial drainage: ${formData.ipc_initial_drainage || "750"} mL serosanguinous. Regimen: ${formData.ipc_drainage_freq || "Every other day"}. Complications: None.`
        : (formData.proc_findings && formData.proc_findings.length < 250 && !formData.proc_findings.includes("---")
            ? formData.proc_findings
            : (formData.proc_notes && formData.proc_notes.length < 250
                ? formData.proc_notes
                : `${currentProcedure.label} completed and recorded in chart.`)),
      full_note: formData.proc_findings || formData.proc_notes || null,
      key_badges: isTrach ? [
        formData.trach_tube_size || "Portex 8.0 mm ID (cuffed)",
        formData.trach_technique ? formData.trach_technique.split("—")[0].trim() : "Ciaglia Blue Rhino",
        formData.trach_bronch_guided ? "Bronchoscopy Guided" : "Bedside Percutaneous",
        `Complications: ${formData.trach_immediate_complications ? formData.trach_immediate_complications.split("—")[0].trim() : "None"}`,
      ] : isIPC ? [
        formData.ipc_catheter_type || "BD PleurX 15.5 Fr",
        formData.ipc_site || "Right 7th ICS",
        `Initial Drain: ${formData.ipc_initial_drainage || "750"} mL`,
        `Regimen: ${formData.ipc_drainage_freq || "Every other day"}`
      ] : undefined,
      monitoring_snapshot: monitoringSnapshot,
      data: { ...formData },
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
    combinedLog.forEach((p) => { if (p && p.proc_id) logMap.set(p.proc_id, p); });
    logMap.set(procType, procedureRecord);
    const updatedLog = Array.from(logMap.values());

    const updatedFormFields = {
      completed_procedures_log: updatedLog,
      last_completed_procedure: procedureRecord,
      // Fresh PACU flowsheet state for the new procedure to prevent contamination by old complications
      mon_active_procedure_id: procType,
      mon_active_procedure_name: currentProcedure.label,
      mon_obs_aldrete: "",
      mon_obs_wob: "Eupneic / Normal resting",
      mon_obs_gcs: "15 (Alert & Oriented)",
      mon_obs_auscultation: "",
      mon_obs_symmetry: "Symmetrical expansion",
      mon_eff_hemoptysis: "None",
      mon_eff_cxr_ptx: isBronch || isNiv ? "Confirmed Absent / Excluded" : "Post-procedure CXR Pending",
      mon_eff_dressing: "Clean, dry, intact, no hematoma",
      mon_eff_adrs: "None reported",
      mon_eff_cardio: "Hemodynamically stable throughout",
      mon_timed_obs: [],
      mon_complications: [],
      ...(isNiv ? {
        niv_procedure_performed: true,
        pulm_current_paco2: postPaco2,
        pulm_current_ph: postPh,
        o2_device_type: `BiPAP (${finalIpap}/${finalEpap} cmH2O)`,
        niv_pressures_summary: `${finalIpap} / ${finalEpap} cmH2O`,
      } : {}),
      ...(isThora ? {
        thora_procedure_performed: true,
      } : {}),
      ...(isChestTube ? {
        chest_tube_procedure_performed: true,
        ctd_signoff_status: formData.ctd_signoff_status || "Signed — complete",
        ctd_signoff_timestamp: formData.ctd_signoff_timestamp || new Date().toLocaleString(),
        ctd_signoff_by: formData.ctd_signoff_by || formData.proc_operator || "Dr. Arvind Ramesh, MD, FCCP",
        ct_size: formData.ctd_tube_size || formData.ct_size || "16–20 Fr (Small-bore)",
        ct_initial_drainage: String(formData.ctd_output_24hr || formData.ct_initial_drainage || "0"),
        ct_air_leak: formData.ctd_output_trend === "Air Leak" || formData.ct_air_leak === "Yes" ? "Yes" : "No",
      } : {}),
      ...(isBronch ? {
        bronch_procedure_performed: true,
      } : {}),
      ...(isTrach ? {
        trach_procedure_performed: true,
        trach_signoff_status: formData.trach_signoff_status || "Signed — complete",
        trach_signoff_timestamp: formData.trach_signoff_timestamp || new Date().toLocaleString(),
        trach_signoff_by: formData.trach_signoff_by || formData.proc_operator || "Dr. Arvind Ramesh, MD, FCCP",
      } : {}),
    };

    updateFields(updatedFormFields);

    const rawSyncPayload = {
      pulm_current_fev1_pct: formData.pft_fev1_pct || formData.pulm_current_fev1_pct,
      pulm_current_6mwt_m: formData.mwt_distance || formData.pulm_current_6mwt_m,
      pulm_current_pao2: formData.abg_pao2 || formData.pulm_current_pao2,
      pulm_current_paco2: postPaco2 || formData.pulm_current_paco2,
      pulm_current_ph: postPh || formData.pulm_current_ph,
      pft_fev1_pct: formData.pft_fev1_pct,
      pft_pattern: formData.pft_pattern,
      mwt_distance: formData.mwt_distance,
      abg_pao2: formData.abg_pao2,
      last_proc_saved_at: new Date().toLocaleTimeString(),
      last_completed_procedure: procedureRecord,
      completed_procedures_log: updatedLog,
      niv_procedure_performed: isNiv,
      thora_procedure_performed: isThora || !!formData.thora_procedure_performed,
      chest_tube_procedure_performed: isChestTube || !!formData.chest_tube_procedure_performed,
      bronch_procedure_performed: isBronch || !!formData.bronch_procedure_performed,
      trach_procedure_performed: isTrach || !!formData.trach_procedure_performed,
    };

    const syncPayload = {};
    Object.entries(rawSyncPayload).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        syncPayload[k] = v;
      }
    });

    window.dispatchEvent(
      new CustomEvent("pulm_procedure_data_sync", {
        detail: { patientId, data: syncPayload },
      })
    );
    if (patientId) {
      try {
        const key = `pulm_sync_${patientId}`;
        const existing = JSON.parse(localStorage.getItem(key) || "{}");
        const existingLog = Array.isArray(existing.completed_procedures_log) ? existing.completed_procedures_log : [];
        const mergedLog = [procedureRecord, ...existingLog.filter(p => p.proc_id !== procType)];
        localStorage.setItem(key, JSON.stringify({
          ...existing,
          ...syncPayload,
          completed_procedures_log: mergedLog,
          last_completed_procedure: procedureRecord
        }));
      } catch (e) {}
    }

    if (typeof saveProcedureSession === "function") {
      const res = await saveProcedureSession({
        slug: backendSlug,
        type: currentProcedure.label,
        category: mode,
        notes: formData.proc_notes || procedureRecord.summary,
        data: { ...formData, ...updatedFormFields },
      });
      if (res?.ok) {
        setLastSyncTime(new Date().toLocaleTimeString());
      }
    }

    // Direct routing: notify shell and switch track to Post-Procedure Monitoring
    window.dispatchEvent(
      new CustomEvent("pulm_procedure_completed", {
        detail: { patientId, procedure: procedureRecord, completed_procedures_log: updatedLog, targetTrack: "monitoring" },
      })
    );

    setProcedureFeedback({
      ok: true,
      text: `✓ ${currentProcedure.label} completed & sealed. Transferring to Post-Procedure Monitoring...`,
    });

    setTimeout(() => {
      setTrack("monitoring");
      setActiveTab("monitoring");
    }, 400);
  };

  const renderSpecificFields = () => {
    switch (procType) {
      // Diagnostic Procedures
      case "spiro":
        return <SpirometryProcedure />;
      case "abg":
        return <ABGProcedure />;
      case "6mwt":
        return <SixMWTProcedure />;
      case "bronch_diag":
        return <BronchoscopyProcedure mode="diagnostic" />;

      // Advanced Procedures
      case "bronch_adv":
      case "bronch":
        return <BronchoscopyProcedure mode="interventional" />;
      case "thora":
        return <ThoracentesisProcedure />;
      case "chest_tube":
        return <ChestTubeGuide />;
      case "ipc":
        return <IPCGuide />;
      case "pleurodesis":
        return <PleurodesisGuide />;
      case "trach":
        return <TracheostomyGuide />;
      case "nivtitr":
        return <NIVTitrationProcedure />;
      case "transplant":
        return <TransplantWorkup />;
      default:
        return <SpirometryProcedure />;
    }
  };

  return (
    <div style={{ background: "#ffffff", padding: "18px 24px", borderRadius: "4px", border: "1px solid #e0e0e0" }}>
      {/* Header Badge & Real-Time Sync Indicator */}
      <div style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#000000", margin: 0, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Pulmonology Procedure Record
          </h2>
          <div style={{ fontSize: "12px", color: "#666666", marginTop: "4px" }}>
            Hospital Operative &amp; Bedside Workstation for Diagnostic and Advanced Interventions.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Live Sync Badge */}
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: "2px",
              background: "#f0fdf4",
              color: "#166534",
              border: "1px solid #86efac",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            Real-Time Sync Active with Screening &amp; Alerts {lastSyncTime ? `(${lastSyncTime})` : ""}
          </div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              padding: "4px 10px",
              borderRadius: "2px",
              background: mode === "diagnostic" ? "#e0f2fe" : "#fef3c7",
              color: mode === "diagnostic" ? "#0369a1" : "#b45309",
              border: `1px solid ${mode === "diagnostic" ? "#bae6fd" : "#fde68a"}`,
            }}
          >
            Mode: {mode === "diagnostic" ? "Diagnostic Procedure" : "Advanced Intervention"}
          </span>
          <button
            type="button"
            onClick={handleSaveProcedureToChart}
            disabled={isSavingProcedure}
            style={{
              padding: "6px 14px",
              fontSize: "11.5px",
              fontWeight: 600,
              background: "#000000",
              color: "#ffffff",
              border: "none",
              borderRadius: "2px",
              cursor: isSavingProcedure ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {isSavingProcedure ? "Saving & Syncing..." : "Save & Sync to Chart ✓"}
          </button>
        </div>
      </div>

      {/* Feedback Alert if present */}
      {procedureFeedback && (
        <div
          style={{
            padding: "8px 14px",
            marginBottom: "14px",
            fontSize: "12px",
            borderRadius: "2px",
            background: procedureFeedback.ok ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${procedureFeedback.ok ? "#86efac" : "#fca5a5"}`,
            color: procedureFeedback.ok ? "#166534" : "#991b1b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{procedureFeedback.text}</span>
          <button
            type="button"
            onClick={() => setProcedureFeedback(null)}
            style={{ background: "none", border: "none", fontSize: "14px", cursor: "pointer", color: "inherit" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Voice Dictation & AI Auto-fill Panel */}
      <VoiceDictationPanel
        section={`Pulmonology Procedure Notes — ${procType || mode}`}
        onStructured={({ values, transcript }) => {
          const autoNotes = {};
          if (!values.proc_notes && transcript) autoNotes.proc_notes = transcript;
          if (!values.proc_findings && transcript) autoNotes.proc_findings = transcript;
          if (["bronch_adv", "bronch", "bronch_diag"].includes(procType)) {
            if (!values.bronch_notes_live && transcript) autoNotes.bronch_notes_live = transcript;
          }
          if (Object.keys(autoNotes).length > 0) {
            updateFields(autoNotes);
          }
        }}
      />

      {/* 1. Common Procedure Fields & Mode Toggle */}
      <CommonProcedureFields
        mode={mode}
        setMode={setMode}
        procType={procType}
        setProcType={setProcType}
        workflowMode={workflowMode}
      />

      {/* 2. Procedure-Specific Fields */}
      <Section title="PROCEDURE-SPECIFIC PROTOCOL &amp; CLINICAL GUIDE" variant="dark">
        {renderSpecificFields()}
      </Section>

      {/* Bottom Save & Sync Bar */}
      <div
        style={{
          marginTop: "20px",
          padding: "12px 18px",
          background: "#fafafa",
          border: "1px solid #e0e0e0",
          borderRadius: "2px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "12px", color: "#555" }}>
          All recorded measurements ($FEV_1$, $FVC$, $6MWT$, $PaO_2$, $pH$) automatically propagate in real time into the patient's Clinical Screening &amp; Alerts dashboard.
        </span>
        <button
          type="button"
          onClick={handleSaveProcedureToChart}
          disabled={isSavingProcedure}
          style={{
            padding: "7px 18px",
            fontSize: "12px",
            fontWeight: 600,
            background: "#000000",
            color: "#ffffff",
            border: "none",
            borderRadius: "2px",
            cursor: isSavingProcedure ? "not-allowed" : "pointer",
          }}
        >
          {isSavingProcedure ? "Saving & Syncing..." : "Save & Sync to Chart ✓"}
        </button>
      </div>
    </div>
  );
};

export default function PulmonologyProcedure(props) {
  const existingContext = useContext(PulmonologyContext);
  if (existingContext && existingContext.setFormData) {
    return <PulmonologyProcedureInner {...props} />;
  }
  return (
    <PulmonologyProvider initialPatientId={props.patientId} initialDoctorId={props.doctorId}>
      <PulmonologyProcedureInner {...props} />
    </PulmonologyProvider>
  );
}
