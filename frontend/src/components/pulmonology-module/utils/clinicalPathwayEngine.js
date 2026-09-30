// Clinical Pathway Decision & Escalation Engine
// Evaluates Diagnostics, Imaging, Physiology (ABG/PFT), and Disease Risk Scores
// to determine the optimal care pathway: Medical Airway Mgmt vs. Advanced Procedure vs. Transplant Eval.

export const PATHWAY_TYPES = {
  AIRWAY_MGMT: "AIRWAY_MGMT",
  ADVANCED_PROCEDURE: "ADVANCED_PROCEDURE",
  TRANSPLANT_EVAL: "TRANSPLANT_EVAL",
  OBSERVATION: "OBSERVATION",
};

export const URGENCY_LEVELS = {
  EMERGENCY: { level: "EMERGENCY", color: "#b71c1c", bg: "#ffebee", border: "#ef9a9a", label: "Emergency Intervention" },
  URGENT: { level: "URGENT", color: "#c62828", bg: "#fff5f5", border: "#ffcdd2", label: "Urgent Escalation" },
  PRIORITY: { level: "PRIORITY", color: "#e65100", bg: "#fff3e0", border: "#ffcc80", label: "Priority Clinical Action" },
  ROUTINE: { level: "ROUTINE", color: "#1565c0", bg: "#e3f2fd", border: "#90caf9", label: "Standard Management" },
  MAINTENANCE: { level: "MAINTENANCE", color: "#2e7d32", bg: "#f1f8e9", border: "#c8e6c9", label: "Maintenance Protocol" },
};

export function evaluateClinicalPathway(formData = {}) {
  const triggers = [];
  const interventions = [];

  // 1. Extract Anatomical / Mechanical Findings from Imaging (CXR & HRCT)
  const cxrEffusion = String(formData.img_cxr_effusion || "").toLowerCase();
  const cxrPneumo = String(formData.img_cxr_pneumothorax || "").toLowerCase();
  const ctMucus = String(formData.img_ct_mucus_plugging || "").toLowerCase();
  const primaryFinding = String(formData.img_primary_finding || "").toLowerCase();
  const ctFormal = String(formData.img_ct_formal_report || "").toLowerCase();

  // 2. Extract Physiological Data (ABG, PFT, SpO2)
  const ph = parseFloat(formData.pulm_current_ph);
  const paco2 = parseFloat(formData.pulm_current_paco2);
  const pao2 = parseFloat(formData.pulm_current_pao2);
  const spo2 = parseFloat(formData.pulm_baseline_spo2);
  const fev1Pct = parseFloat(formData.pulm_current_fev1_pct);
  const sixMwtM = parseFloat(formData.pulm_current_6mwt_m);

  // 3. Extract Scoring & Alerts Data
  const primaryDx = String(formData.pulm_primary_dx || "");
  const bodeScoreStr = String(formData.score_bode || "");
  const gapScoreStr = String(formData.score_gap || "");
  const goldGroup = String(formData.calc_gold_group || "");
  const goldStage = String(formData.calc_gold_stage || "");
  const actScore = parseInt(formData.score_act, 10);
  const txTriage = String(formData.alert_tx_triage || "");

  // =========================================================================
  // PRIORITY 0: COMPLETED INTERVENTIONAL PROCEDURES -> POST-PROCEDURE MONITORING
  // If an acute bedside or surgical intervention was already completed & sealed,
  // the clinical pathway shifts to Post-Procedure Monitoring & PACU Recovery.
  // =========================================================================
  const completedLog = Array.isArray(formData.completed_procedures_log) ? formData.completed_procedures_log : [];
  const lastProc = formData.last_completed_procedure || (completedLog.length > 0 ? completedLog[0] : null);

  const thoraCompleted =
    formData.thora_procedure_performed ||
    lastProc?.proc_id === "thora" ||
    completedLog.some((p) => p.proc_id === "thora") ||
    (formData.thora_volume_drained && String(formData.thora_volume_drained).trim() !== "");

  const chestTubeCompleted =
    formData.chest_tube_procedure_performed ||
    lastProc?.proc_id === "chest_tube" ||
    lastProc?.proc_id === "ctt" ||
    completedLog.some((p) => p.proc_id === "chest_tube" || p.proc_id === "ctt") ||
    formData.ctd_signoff_status === "Signed — complete" ||
    (formData.ctd_tube_size && String(formData.ctd_tube_size).trim() !== "") ||
    (formData.ct_size && String(formData.ct_size).trim() !== "");

  const bronchCompleted =
    formData.bronch_procedure_performed ||
    lastProc?.proc_id === "bronch_adv" ||
    lastProc?.proc_id === "bronch" ||
    lastProc?.proc_id === "bronch_diag" ||
    completedLog.some((p) => p.proc_id === "bronch_adv" || p.proc_id === "bronch" || p.proc_id === "bronch_diag");

  const nivCompleted =
    formData.niv_procedure_performed ||
    lastProc?.proc_id === "nivtitr" ||
    lastProc?.proc_id === "niv" ||
    completedLog.some((p) => p.proc_id === "nivtitr" || p.proc_id === "niv");

  if (thoraCompleted) {
    const vol = formData.thora_volume_drained ? `${formData.thora_volume_drained} mL` : "fluid";
    const fluidApp = formData.thora_fluid_appearance ? ` (${formData.thora_fluid_appearance})` : "";
    triggers.push({
      category: "Completed Interventional Procedure",
      severity: "STABILIZED",
      detail: `Ultrasound-Guided Thoracentesis completed: ${vol}${fluidApp} evacuated. Pleural decompression achieved.`,
    });

    interventions.push({
      name: "Post-Procedure Monitoring & Recovery",
      targetProcedure: "Post-Procedure Monitoring",
      mode: "monitoring",
      note: "Monitor lung expansion, post-procedure CXR/US pneumothorax exclusion, entry site dressing, and vitals surveillance.",
    });

    return {
      pathway: PATHWAY_TYPES.ADVANCED_PROCEDURE,
      urgency: {
        level: "STABILIZED",
        label: "Post-Procedure Surveillance",
        color: "#2e7d32",
        bg: "#f0fdf4",
        border: "#81c784",
      },
      title: "PATHWAY: POST-PROCEDURE MONITORING (THORACENTESIS COMPLETED)",
      badge: "Monitoring In Progress",
      primaryReason: `Patient has completed Ultrasound-Guided Thoracentesis (${vol} evacuated). Pleural decompression successful. Clinical priority is Post-Procedure Monitoring for pneumothorax exclusion and recovery.`,
      triggers,
      interventions,
      recommendedAction: "Proceed to Post-Procedure Monitoring to track recovery and CXR check",
      suggestedTrack: "monitoring",
      suggestedTab: "monitoring",
    };
  }

  if (chestTubeCompleted) {
    triggers.push({
      category: "Completed Interventional Procedure",
      severity: "STABILIZED",
      detail: `Chest Tube / Intercostal Drain (ICD) inserted. Underwater seal drainage active.`,
    });

    interventions.push({
      name: "Post-Procedure Monitoring & Inpatient Care",
      targetProcedure: "Post-Procedure Monitoring",
      mode: "monitoring",
      note: "Track 24h drain volume, fluid character, underwater air leak grading, and repeat CXR for tube positioning.",
    });

    return {
      pathway: PATHWAY_TYPES.ADVANCED_PROCEDURE,
      urgency: {
        level: "STABILIZED",
        label: "Post-Procedure Surveillance",
        color: "#2e7d32",
        bg: "#f0fdf4",
        border: "#81c784",
      },
      title: "PATHWAY: POST-PROCEDURE MONITORING (CHEST TUBE IN SITU)",
      badge: "Monitoring In Progress",
      primaryReason: "Intercostal drain active. Clinical priority is Post-Procedure Monitoring (drain output, air leak grading, and post-insertion CXR).",
      triggers,
      interventions,
      recommendedAction: "Proceed to Post-Procedure Monitoring to track drain output and air leaks",
      suggestedTrack: "monitoring",
      suggestedTab: "monitoring",
    };
  }

  if (bronchCompleted) {
    triggers.push({
      category: "Completed Interventional Procedure",
      severity: "STABILIZED",
      detail: `Bronchoscopy procedure completed. Airway inspection & sampling completed.`,
    });

    interventions.push({
      name: "Post-Procedure Monitoring & PACU Recovery",
      targetProcedure: "Post-Procedure Monitoring",
      mode: "monitoring",
      note: "Aldrete post-sedation recovery score, airway reflex return, hemoptysis surveillance, and post-biopsy CXR.",
    });

    return {
      pathway: PATHWAY_TYPES.ADVANCED_PROCEDURE,
      urgency: {
        level: "STABILIZED",
        label: "Post-Procedure Surveillance",
        color: "#2e7d32",
        bg: "#f0fdf4",
        border: "#81c784",
      },
      title: "PATHWAY: POST-PROCEDURE MONITORING (BRONCHOSCOPY COMPLETED)",
      badge: "Monitoring In Progress",
      primaryReason: "Patient has completed Bronchoscopy. Clinical priority is Post-Sedation PACU Monitoring, cough/gag reflex return, and post-biopsy safety checks.",
      triggers,
      interventions,
      recommendedAction: "Proceed to Post-Procedure Monitoring to track sedation recovery and airway reflexes",
      suggestedTrack: "monitoring",
      suggestedTab: "monitoring",
    };
  }

  if (nivCompleted) {
    triggers.push({
      category: "Completed Interventional Procedure",
      severity: "STABILIZED",
      detail: `NIV / BiPAP Titration Study completed (${formData.last_completed_procedure?.summary || "IPAP 12/EPAP 5 cmH2O"}). Hypercapnic respiratory failure stabilized.`,
    });

    interventions.push({
      name: "Post-Procedure Monitoring & Recovery",
      targetProcedure: "Post-Procedure Monitoring",
      mode: "monitoring",
      note: "Continuous cardiorespiratory monitoring, serial ABG at 2-4 hours, mask leak assessment, and sedation recovery.",
    });

    return {
      pathway: PATHWAY_TYPES.ADVANCED_PROCEDURE,
      urgency: {
        level: "STABILIZED",
        label: "Post-Procedure Surveillance",
        color: "#2e7d32",
        bg: "#f0fdf4",
        border: "#81c784",
      },
      title: "PATHWAY: POST-INTERVENTION MONITORING (NIV PERFORMED)",
      badge: "Monitoring In Progress",
      primaryReason: "Patient has completed the required NIV / BiPAP Titration Study. Acute ventilatory failure has been stabilized. Clinical priority is Post-Procedure Monitoring.",
      triggers,
      interventions,
      recommendedAction: "Proceed to Post-Procedure Monitoring to track recovery and serial ABGs",
      suggestedTrack: "monitoring",
      suggestedTab: "monitoring",
    };
  }

  // Acute Hypercapnic Respiratory Acidosis -> BiPAP / NIV Titration Study
  if (!isNaN(ph) && ph < 7.35 && !isNaN(paco2) && paco2 > 45) {
    triggers.push({
      category: "Blood Gas Physiology (ABG)",
      severity: "URGENT",
      detail: `Acute hypercapnic respiratory acidosis: pH ${ph.toFixed(2)}, PaCO2 ${paco2.toFixed(1)} mmHg`,
    });

    interventions.push({
      name: "NIV / BiPAP Titration Study",
      targetProcedure: "NIV / BiPAP Titration Study",
      mode: "advanced",
      note: "Initiate non-invasive positive pressure ventilation (IPAP/EPAP) to unload respiratory musculature and clear CO2.",
    });

    return {
      pathway: PATHWAY_TYPES.ADVANCED_PROCEDURE,
      urgency: URGENCY_LEVELS.URGENT,
      title: "PATHWAY: ADVANCED PROCEDURAL ESCALATION (ACUTE VENTILATORY FAILURE)",
      badge: "BiPAP Titration Required",
      primaryReason: `Decompensated respiratory acidosis (pH ${ph.toFixed(2)} with hypercapnia ${paco2.toFixed(1)} mmHg). Patient has ventilatory pump exhaustion.`,
      triggers,
      interventions,
      recommendedAction: "Initiate NIV / BiPAP Titration Study via Procedure Notes",
      suggestedTrack: "procedures",
      suggestedTab: "nivtitr",
    };
  }

  // =========================================================================
  // PRIORITY 3: END-STAGE DISEASE / TRANSPLANT EVALUATION
  // =========================================================================

  const bodePoints = parseInt(bodeScoreStr, 10);
  const isHighBode = !isNaN(bodePoints) && bodePoints >= 7;
  const isHighGap = gapScoreStr.includes("Stage III");
  const isTxUrgent = txTriage.includes("Urgent Referral") || isHighBode || isHighGap;

  if (isTxUrgent) {
    if (isHighBode) {
      triggers.push({
        category: "Prognostic Score (BODE)",
        severity: "PRIORITY",
        detail: `BODE Index is ${bodeScoreStr} (>= 7 points) indicating high 1-year mortality risk`,
      });
    }
    if (isHighGap) {
      triggers.push({
        category: "Prognostic Score (GAP)",
        severity: "PRIORITY",
        detail: `GAP Index is ${gapScoreStr} reflecting severe progressive interstitial lung disease`,
      });
    }
    if (!isNaN(sixMwtM) && sixMwtM > 0 && sixMwtM < 250) {
      triggers.push({
        category: "Exercise Physiology (6MWT)",
        severity: "PRIORITY",
        detail: `Severely reduced 6-minute walk distance: ${sixMwtM} m (< 250 m)`,
      });
    }

    interventions.push({
      name: "Comprehensive Lung Transplant Workup",
      targetTab: "transplant",
      mode: "screening",
      note: "Initiate ISHLT 2021 pre-transplant workup, HLA typing, multi-organ clearance, and multidisciplinary committee listing review.",
    });

    return {
      pathway: PATHWAY_TYPES.TRANSPLANT_EVAL,
      urgency: URGENCY_LEVELS.PRIORITY,
      title: "PATHWAY: TRANSPLANT MULTIDISCIPLINARY EVALUATION",
      badge: "Transplant Listing Zone",
      primaryReason: "Patient disease burden meets ISHLT consensus criteria for active lung transplant candidacy assessment.",
      triggers,
      interventions,
      recommendedAction: "Open Transplant Evaluation tab in Pulmonary Procedures",
      suggestedTrack: "procedures",
      suggestedTab: "transplant",
    };
  }

  // =========================================================================
  // PRIORITY 4: STANDARD MEDICAL AIRWAY MANAGEMENT (DEFAULT CONSERVATIVE ROUTE)
  // =========================================================================

  // Chronic obstructive or restrictive disease managed with inhalers and medical therapy
  if (primaryDx) {
    triggers.push({
      category: "Primary Diagnosis",
      severity: "ROUTINE",
      detail: `Confirmed primary pulmonary diagnosis: ${primaryDx}`,
    });
  }

  // Severe airflow limitation without acute collapse
  if (!isNaN(fev1Pct) && fev1Pct < 50) {
    triggers.push({
      category: "Spirometry (FEV1%)",
      severity: "PRIORITY",
      detail: `Severe airflow limitation: FEV1 ${fev1Pct.toFixed(1)}% predicted`,
    });
  }

  // GOLD Group E Exacerbator
  const exacCount = parseInt(formData.hx_exac_count, 10);
  const isGroupE = goldGroup.includes("Group E") || (!isNaN(exacCount) && exacCount >= 2);
  if (isGroupE) {
    triggers.push({
      category: "Exacerbation Risk (GOLD)",
      severity: "PRIORITY",
      detail: `Frequent exacerbator phenotype (GOLD Group E${!isNaN(exacCount) ? `: ${exacCount} exacerbations in past year` : ""}). Triple therapy indicated.`,
    });
    interventions.push({
      name: "Triple Inhalation Therapy Step-Up (LAMA + LABA + ICS)",
      targetTab: "meds",
      note: "Escalate to combination maintenance inhaler; review inhaler technique and adherence.",
    });
  } else {
    interventions.push({
      name: "Maintenance Bronchodilator & Inhaler Dosing",
      targetTab: "meds",
      note: "Optimize long-acting bronchodilator (LAMA/LABA) regimen according to disease severity.",
    });
  }

  // Uncontrolled Asthma
  if (!isNaN(actScore) && actScore <= 19) {
    triggers.push({
      category: "Asthma Control (ACT)",
      severity: "PRIORITY",
      detail: `Suboptimally controlled asthma: ACT score ${actScore} / 25`,
    });
    interventions.push({
      name: "GINA Step-Up Therapy & Biologic Evaluation",
      targetTab: "meds",
      note: "Assess adherence, allergen exposure, and check peripheral blood eosinophils for biologic consideration.",
    });
  }

  // Stable resting hypoxemia (SpO2 < 88% or PaO2 < 55) without acidosis
  if ((!isNaN(spo2) && spo2 < 88) || (!isNaN(pao2) && pao2 < 55)) {
    triggers.push({
      category: "Oxygenation (SpO2 / PaO2)",
      severity: "PRIORITY",
      detail: `Resting hypoxemia documented (${!isNaN(spo2) ? `SpO2 ${spo2}%` : `PaO2 ${pao2} mmHg`})`,
    });
    interventions.push({
      name: "Long-Term Oxygen Therapy (LTOT) Titration",
      targetTab: "airway_support",
      note: "Prescribe and titrate low-flow supplemental oxygen (1-4 L/min via nasal cannula) to target SpO2 88-92%.",
    });
  }

  interventions.push({
    name: "Comprehensive Care Plan & Action Protocol",
    targetTab: "plan",
    note: "Update written COPD/Asthma action plan, schedule pulmonary rehabilitation, and review vaccination status.",
  });

  return {
    pathway: PATHWAY_TYPES.AIRWAY_MGMT,
    urgency: triggers.some((t) => t.severity === "PRIORITY") ? URGENCY_LEVELS.PRIORITY : URGENCY_LEVELS.MAINTENANCE,
    title: "PATHWAY: MEDICAL AIRWAY MANAGEMENT (CONSERVATIVE ROUTE)",
    badge: "Medical Management Indicated",
    primaryReason: "Patient has chronic parenchymal/airway disease without mechanical collections or acute ventilatory collapse. Proceed with pharmacotherapy and supportive airway management.",
    triggers,
    interventions,
    recommendedAction: "Proceed to Phase 4: Airway Mgmt for medication titration and care planning",
    suggestedTrack: "airway",
    suggestedTab: "meds",
  };
}

// =========================================================================
// POST-PROCEDURE MONITORING CDS & TRIAGE RECOMMENDATION ENGINE
// Evaluates recovery vitals, Aldrete sedation scores, CXR pneumothorax checks,
// chest drain air leaks, and procedural complications against PACU standards.
// =========================================================================

export const POST_PROCEDURE_TRIAGE_STATUS = {
  URGENT_ESCALATION: {
    status: "URGENT_ESCALATION",
    title: "CRITICAL: URGENT ESCALATION REQUIRED",
    level: "EMERGENCY",
    color: "#b71c1c",
    bg: "#fef2f2",
    border: "#f87171",
    badge: "Urgent Action Required",
    icon: "🚨",
  },
  WARD_MONITORING: {
    status: "WARD_MONITORING",
    title: "INPATIENT / STEP-DOWN MONITORING REQUIRED",
    level: "MONITORING",
    color: "#b45309",
    bg: "#fffbeb",
    border: "#fcd34d",
    badge: "Inpatient Monitoring Required",
    icon: "⚠️",
  },
  DISCHARGE_READY: {
    status: "DISCHARGE_READY",
    title: "SAFE FOR DISCHARGE / STEP-DOWN TRANSITION",
    level: "DISCHARGE",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    badge: "Discharge Ready",
    icon: "✅",
  },
  INCOMPLETE_DATA: {
    status: "INCOMPLETE_DATA",
    title: "POST-PROCEDURE MONITORING IN PROGRESS",
    level: "INCOMPLETE",
    color: "#475569",
    bg: "#f8fafc",
    border: "#cbd5e1",
    badge: "Monitoring Incomplete",
    icon: "ℹ️",
  },
};

export function evaluatePostProcedureTriage(formData = {}) {
  const redFlags = [];
  const yellowFlags = [];
  const clearedChecks = [];

  // Extract timed observations (most recent first)
  const timedObs = Array.isArray(formData.mon_timed_obs) ? formData.mon_timed_obs : [];
  const latestObs = timedObs.length > 0 ? timedObs[timedObs.length - 1] : null;

  // 1. Aldrete Score (Standard PACU threshold: >= 9 for discharge)
  let rawAldrete = formData.mon_obs_aldrete;
  if (!rawAldrete && latestObs?.aldrete) {
    rawAldrete = latestObs.aldrete;
  }
  let aldreteScore = null;
  if (rawAldrete !== undefined && rawAldrete !== null && String(rawAldrete).trim() !== "") {
    const s = String(rawAldrete);
    if (s.includes("10")) aldreteScore = 10;
    else if (s.includes("9")) aldreteScore = 9;
    else if (s.includes("8") && !s.includes("<")) aldreteScore = 8;
    else if (s.includes("< 8") || s.includes("<8")) aldreteScore = 7;
    else {
      const match = s.match(/\d+/);
      if (match) aldreteScore = parseInt(match[0], 10);
    }
  }

  // 2. Oxygenation & Vitals
  let rawSpo2 = formData.mon_obs_spo2;
  if (!rawSpo2 && latestObs?.spo2) rawSpo2 = latestObs.spo2;
  const spo2 = parseFloat(rawSpo2);

  const o2Flow = String(formData.mon_obs_o2_flow || latestObs?.o2 || "");
  const rr = parseFloat(formData.mon_obs_rr || latestObs?.rr);
  const hr = parseFloat(formData.mon_obs_hr || latestObs?.hr);
  const bp = String(formData.mon_obs_bp || latestObs?.bp || "");
  const gcs = String(formData.mon_obs_gcs || latestObs?.gcs || "");
  const wob = String(formData.mon_obs_wob || "");
  const ausc = String(formData.mon_obs_auscultation || "");
  const symmetry = String(formData.mon_obs_symmetry || "");

  // 3. Chest Drain & Pleural Air Leak
  const airLeak = String(formData.mon_nurs_air_leak || "");
  const drainVol = parseFloat(formData.mon_nurs_drain_volume || latestObs?.drain);
  const drainColor = String(formData.mon_nurs_drain_color || "");

  // 4. Procedural Safety & Complications
  const cxrPtx = String(formData.mon_eff_cxr_ptx || "");
  const hemoptysis = String(formData.mon_eff_hemoptysis || "");
  const dressing = String(formData.mon_eff_dressing || "");
  const cardio = String(formData.mon_eff_cardio || "");
  const complications = Array.isArray(formData.mon_complications) ? formData.mon_complications : [];

  // Check if any monitoring data exists
  const hasAnyData =
    aldreteScore !== null ||
    !isNaN(spo2) ||
    !isNaN(rr) ||
    !isNaN(hr) ||
    Boolean(bp) ||
    Boolean(airLeak && airLeak !== "No active drain") ||
    Boolean(cxrPtx) ||
    Boolean(hemoptysis) ||
    complications.length > 0 ||
    timedObs.length > 0;

  if (!hasAnyData) {
    return {
      ...POST_PROCEDURE_TRIAGE_STATUS.INCOMPLETE_DATA,
      isDischargeReady: false,
      blockers: ["Post-procedure recovery vitals and Modified Aldrete score not yet documented."],
      clearedChecks: [],
      recommendedAction: "Complete the initial post-procedure flowsheet and Aldrete evaluation to determine discharge readiness.",
      actionButtonText: "Awaiting Data",
      targetTrack: "monitoring",
    };
  }

  // --- RED FLAG EVALUATION (Urgent Escalation) ---
  // A. Critical Pneumothorax
  if (
    cxrPtx.toLowerCase().includes("tension") ||
    cxrPtx.toLowerCase().includes("large pneumothorax") ||
    cxrPtx.toLowerCase().includes("chest tube required")
  ) {
    redFlags.push("Post-procedure CXR confirms Tension / Large Pneumothorax. Immediate tube thoracostomy required.");
  }

  // B. Significant Hemoptysis (Moderate / Severe / Tamponade)
  if (
    hemoptysis.toLowerCase().includes("severe") ||
    hemoptysis.toLowerCase().includes("moderate") ||
    hemoptysis.toLowerCase().includes("balloon tamponade") ||
    (hemoptysis && !hemoptysis.toLowerCase().includes("none") && !hemoptysis.toLowerCase().includes("scant") && !hemoptysis.toLowerCase().includes("mild"))
  ) {
    redFlags.push(`Significant hemoptysis documented (${hemoptysis}). Immediate airway isolation / intervention indicated.`);
  }

  // C. Active Bleeding from Site or Frankly Hemorrhagic Drain
  if (dressing.toLowerCase().includes("active bleeding")) {
    redFlags.push("Active bleeding observed at procedural puncture/incision site. Urgent manual pressure and surgical review required.");
  }
  if (drainColor.toLowerCase().includes("frankly hemorrhagic")) {
    redFlags.push("Frankly hemorrhagic chest drain output. Urgent thoracic surgical evaluation for intrathoracic hemorrhage.");
  }

  // D. Severe Hypoxemia or Upper Airway Obstruction
  if (!isNaN(spo2) && spo2 < 88) {
    redFlags.push(`Severe refractory hypoxemia (SpO2 ${spo2}%). Immediate high-flow oxygen, NIV, or airway escalation needed.`);
  }
  if (gcs.includes("< 10") || gcs.includes("Airway Alert")) {
    redFlags.push("Glasgow Coma Scale < 10 (Profound sedation / CNS depression). Airway protection protocol indicated.");
  }
  if (ausc.toLowerCase().includes("stridor") || ausc.toLowerCase().includes("airway compromise")) {
    redFlags.push("Laryngeal stridor / acute upper airway compromise on auscultation.");
  }
  if (wob.toLowerCase().includes("abdominal paradox") || wob.toLowerCase().includes("exhaustion")) {
    redFlags.push("Severe work of breathing with abdominal paradox / impending respiratory muscle exhaustion.");
  }
  if (cardio.toLowerCase().includes("arrhythmia") || cardio.toLowerCase().includes("atrial fibrillation")) {
    redFlags.push("New post-procedure cardiac arrhythmia / atrial fibrillation documented.");
  }

  // Hemodynamic Instability (Severe Tachycardia HR > 120 or Bradycardia HR < 45, or Hypotension SBP < 90)
  if (!isNaN(hr) && (hr > 120 || hr < 45)) {
    redFlags.push(`Severe hemodynamic instability: Heart rate ${hr} bpm (${hr > 120 ? "severe tachycardia" : "severe bradycardia"}).`);
  }
  if (bp) {
    const sbpMatch = bp.match(/^(\d{2,3})\s*\//);
    if (sbpMatch) {
      const sbp = parseInt(sbpMatch[1], 10);
      if (!isNaN(sbp) && sbp < 90) {
        redFlags.push(`Severe hemodynamic instability: SBP ${sbp} mmHg (Hypotensive shock criteria).`);
      }
    }
  }

  // E. Active Complications with Grade > 1 (CTCAE Grade 2–5 or Clavien II–V, Outcome != Resolved)
  const unresolvedGradeGt1Comps = complications.filter((c) => {
    const outcome = String(c.outcome || "").toLowerCase();
    const isUnresolved = outcome !== "resolved";
    const isGradeGt1 =
      String(c.ctcae || "").includes("Grade 2") ||
      String(c.ctcae || "").includes("Grade 3") ||
      String(c.ctcae || "").includes("Grade 4") ||
      String(c.ctcae || "").includes("Grade 5") ||
      ["II", "IIIa", "IIIb", "IVa", "IVb", "V"].includes(c.clavien);
    return isUnresolved && isGradeGt1;
  });
  if (unresolvedGradeGt1Comps.length > 0) {
    unresolvedGradeGt1Comps.forEach((c) => {
      redFlags.push(`Active adverse event (Grade > 1): ${c.desc} (${c.ctcae}, Clavien-Dindo ${c.clavien}). Outcome: ${c.outcome || "Active"}. Urgent escalation indicated.`);
    });
  }

  // --- YELLOW FLAG EVALUATION (Ward / Step-Down Monitoring Required) ---
  // A. Aldrete Score < 9 (Hospital standard practice)
  if (aldreteScore !== null && aldreteScore < 9) {
    yellowFlags.push(`Modified Aldrete score is ${aldreteScore}/10 (< 9 required for discharge). Patient has not fully recovered from sedation; PACU recovery required.`);
  } else if (aldreteScore === null) {
    yellowFlags.push("Modified Aldrete score not recorded. PACU recovery clearance requires verified score >= 9.");
  } else {
    clearedChecks.push(`Modified Aldrete score: ${aldreteScore}/10 (Full post-sedation recovery criteria met)`);
  }

  // B. Pleural Air Leak (Hospital standard: any active leak blocks routine outpatient discharge)
  if (airLeak.includes("Continuous during tidal breathing (Grade 3)")) {
    if (!redFlags.some((f) => f.includes("air leak"))) {
      yellowFlags.push("Continuous tidal air leak (Grade 3). Inpatient underwater seal monitoring and thoracic review required.");
    }
  } else if (airLeak.includes("Present on quiet expiration (Grade 2)")) {
    yellowFlags.push("Active expiratory air leak (Grade 2). Continued underwater seal chest drainage required.");
  } else if (airLeak.includes("Present on forced cough only (Grade 1)")) {
    yellowFlags.push("Active Grade 1 air leak (present on forced cough). Standard hospital practice requires continued inpatient observation or ambulatory Heimlich valve protocol prior to discharge.");
  } else if (airLeak.includes("Absent") || airLeak.includes("No active drain")) {
    clearedChecks.push(airLeak.includes("Absent") ? "Chest drain air leak: Absent (Underwater seal stable)" : "Chest drain: No active drain / not required");
  }

  // C. High Drain Volume
  if (!isNaN(drainVol) && drainVol > 150) {
    yellowFlags.push(`Active chest drain fluid output (${drainVol} mL / 24h). Exceeds safe drain removal threshold (<100–150 mL/24h).`);
  } else if (!isNaN(drainVol) && drainVol <= 150 && drainVol > 0) {
    clearedChecks.push(`Chest drain output minimal (${drainVol} mL / 24h)`);
  }

  // D. CXR Status
  if (cxrPtx.includes("Post-procedure CXR Pending")) {
    yellowFlags.push("Post-procedure CXR is pending to rule out iatrogenic pneumothorax.");
  } else if (cxrPtx.includes("Small Apical Pneumothorax (<2cm, Conservative)")) {
    yellowFlags.push("Small apical pneumothorax under conservative observation. Inpatient 4-6 hour interval CXR required before clearance.");
  } else if (cxrPtx.includes("Confirmed Absent") || cxrPtx.includes("Not indicated")) {
    clearedChecks.push(cxrPtx.includes("Confirmed Absent") ? "Post-procedure CXR: Pneumothorax confirmed absent / excluded" : "Post-procedure CXR: Not indicated for procedure");
  }

  // E. Mild Hemoptysis
  if (hemoptysis.includes("Mild hemoptysis (5-50 mL, cold saline flushed)")) {
    yellowFlags.push("Mild post-biopsy hemoptysis documented. Inpatient surveillance required until bleeding ceases.");
  } else if (hemoptysis.includes("None") || hemoptysis.includes("Scant blood streaks")) {
    clearedChecks.push(hemoptysis.includes("None") ? "Post-procedure hemoptysis: None" : "Post-procedure hemoptysis: Scant streaks (<5 mL, self-limiting)");
  }

  // F. Oxygenation & Hemodynamics
  if (!isNaN(spo2)) {
    if (spo2 >= 88 && spo2 < 92) {
      yellowFlags.push(`Borderline oxygen saturation (SpO2 ${spo2}%). Continued pulse oximetry monitoring required.`);
    } else if (spo2 >= 92) {
      clearedChecks.push(`Oxygen saturation stable at ${spo2}% (${o2Flow || "Room Air"})`);
    }
  }

  if (
    o2Flow.includes("Non-Rebreather") ||
    o2Flow.includes("High Flow Nasal Cannula") ||
    o2Flow.includes("NIV / BiPAP") ||
    o2Flow.includes("Venturi Mask 40-50%")
  ) {
    yellowFlags.push(`High supplemental oxygen dependency (${o2Flow}). Patient not yet weaned to room air or baseline.`);
  }

  if (!isNaN(rr) && (rr > 26 || rr < 10)) {
    yellowFlags.push(`Abnormal respiratory rate (${rr} bpm). Ongoing respiratory rate monitoring required.`);
  }

  if (symmetry.includes("Subcutaneous emphysema")) {
    yellowFlags.push("Subcutaneous emphysema palpated on chest wall. Continued clinical monitoring required.");
  }

  if (cardio.includes("Transient hypotension") || cardio.includes("Sinus tachycardia")) {
    yellowFlags.push(`Hemodynamic observation noted: ${cardio}. Continued blood pressure checks required.`);
  }

  // G. Active Grade 1 (Mild) Complications
  const unresolvedMildComps = complications.filter((c) => {
    const outcome = String(c.outcome || "").toLowerCase();
    const isUnresolved = outcome !== "resolved";
    const isGrade1 =
      String(c.ctcae || "").includes("Grade 1") ||
      c.clavien === "I";
    return isUnresolved && isGrade1;
  });
  if (unresolvedMildComps.length > 0) {
    unresolvedMildComps.forEach((c) => {
      yellowFlags.push(`Active adverse event (Grade 1 Mild): ${c.desc} (${c.ctcae}, Clavien-Dindo ${c.clavien}). Outcome: ${c.outcome || "Active"}.`);
    });
  }

  // --- DETERMINE FINAL DISPOSITION STATUS ---
  if (redFlags.length > 0) {
    return {
      ...POST_PROCEDURE_TRIAGE_STATUS.URGENT_ESCALATION,
      isDischargeReady: false,
      blockers: redFlags,
      clearedChecks,
      recommendedAction: "Trigger Rapid Response / Thoracic Surgical Escalation immediately. Prepare emergency bedside thoracostomy or airway intervention.",
      actionButtonText: "Review Urgent Complications",
      targetTrack: "monitoring",
    };
  }

  if (yellowFlags.length > 0) {
    return {
      ...POST_PROCEDURE_TRIAGE_STATUS.WARD_MONITORING,
      isDischargeReady: false,
      blockers: yellowFlags,
      clearedChecks,
      recommendedAction: "Transfer / Admit to Inpatient Pulmonology Step-Down Unit for continued vitals and chest drain surveillance.",
      actionButtonText: "Admit to Ward Monitoring",
      targetTrack: "monitoring",
    };
  }

  // If no red and no yellow flags, and minimum checks met:
  return {
    ...POST_PROCEDURE_TRIAGE_STATUS.DISCHARGE_READY,
    isDischargeReady: true,
    blockers: [],
    clearedChecks: clearedChecks.length > 0 ? clearedChecks : ["All post-procedure recovery parameters within safe limits"],
    recommendedAction: "Discharge criteria met. Patient is fully awake (Aldrete >= 9), hemodynamically stable, and free of acute complications. Proceed to Disposition & Discharge Summary.",
    actionButtonText: "Proceed to Disposition & Discharge Summary →",
    targetTrack: "discharge",
  };
}
