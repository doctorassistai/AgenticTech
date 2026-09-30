import assert from "assert";

// Simulation of the snapshot extraction and reset logic implemented in PulmonologyProcedure and Advanced Guides

function extractMonitoringSnapshot(formData, procId, procName) {
  const snapshot = {
    timestamp: new Date().toISOString(),
    procedure_id: procId,
    procedure_name: procName,
  };
  Object.keys(formData).forEach((key) => {
    if (key.startsWith("mon_") && !key.startsWith("mon_active_")) {
      snapshot[key] = formData[key];
    }
  });
  return snapshot;
}

function resetAcuteMonitoringState(existingFormData, newProcId, newProcName) {
  return {
    ...existingFormData,
    mon_active_procedure_id: newProcId,
    mon_active_procedure_name: newProcName,
    mon_obs_aldrete: "",
    mon_obs_aldrete_detail: "",
    mon_obs_wob: "Eupneic / Normal resting",
    mon_obs_spo2: "",
    mon_obs_o2_flow: "",
    mon_eff_cxr_ptx: "Not performed / Pending",
    mon_eff_cxr_subq: "No",
    mon_eff_cxr_effusion: "Not re-accumulated",
    mon_eff_hemoptysis: "None",
    mon_eff_pain: "Mild (1–3/10)",
    mon_eff_vasovagal: "No / Resolved",
    mon_nurs_air_leak: "None",
    mon_nurs_fluid_vol: "",
    mon_nurs_fluid_app: "Serous / Clear",
    mon_nurs_dress_site: "Clean, dry, intact",
    mon_timed_obs: [],
    mon_complications: [],
  };
}

function synthesizeSection4(completedProcedures, activeFormData) {
  const procs = [];
  if (completedProcedures.length > 1) {
    procs.push(`Completed Procedures (${completedProcedures.length}):`);
    completedProcedures.forEach((p, idx) => {
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
  }

  const pacuRecovery = [];
  if (activeFormData.mon_obs_aldrete) pacuRecovery.push(`Modified Aldrete: ${activeFormData.mon_obs_aldrete}`);
  if (activeFormData.mon_obs_spo2) pacuRecovery.push(`Recovery SpO2: ${activeFormData.mon_obs_spo2}% on ${activeFormData.mon_obs_o2_flow || "Room Air"}`);
  if (activeFormData.mon_obs_wob) pacuRecovery.push(`Work of Breathing: ${activeFormData.mon_obs_wob}`);
  if (activeFormData.mon_eff_hemoptysis) pacuRecovery.push(`Hemoptysis Check: ${activeFormData.mon_eff_hemoptysis}`);
  if (pacuRecovery.length > 0) {
    const activeProcLabel = activeFormData.mon_active_procedure_name ? ` (${activeFormData.mon_active_procedure_name})` : "";
    procs.push(`Active PACU Monitoring Metrics${activeProcLabel}: ${pacuRecovery.join(" | ")}`);
  }

  return `4. PROCEDURAL COURSE & POST-ACUTE MONITORING:\n${procs.join(";\n")}.`;
}

console.log("==================================================================");
console.log("RUNNING PROCEDURE-SCOPED POST-PROCEDURE MONITORING TEST SUITE");
console.log("==================================================================");

// --- TEST 1: Initial state after Procedure 1 (Thoracentesis) with Hemoptysis complication ---
let patientFormData = {
  // Chronic baseline prophylaxis
  mon_proph_dvt: "Enoxaparin 40 mg SC daily",
  mon_proph_gi: "Pantoprazole 40 mg IV daily",
  mon_orders_nutrition: "NPO until alert, then diabetic diet",
  mon_orders_rt: "Incentive spirometry q2h while awake",
  
  // Acute monitoring during/after Procedure 1
  mon_obs_aldrete: "< 8",
  mon_obs_wob: "Severe abdominal paradox / exhaustion",
  mon_obs_spo2: "84",
  mon_obs_o2_flow: "15 L NRB",
  mon_eff_hemoptysis: "Severe (>100 mL)",
  mon_timed_obs: [
    { time: "10:00", aldrete: "< 8", spo2: "84", hr: "125", bp: "88/55", wob: "Severe" }
  ],
  mon_complications: [
    { desc: "Acute post-procedure massive hemoptysis", ctcae: "Grade 3", outcome: "Intervention required" }
  ]
};

// Snapshot Procedure 1
const proc1Snapshot = extractMonitoringSnapshot(patientFormData, "thoracentesis", "Ultrasound-Guided Thoracentesis");
assert.strictEqual(proc1Snapshot.mon_eff_hemoptysis, "Severe (>100 mL)");
assert.strictEqual(proc1Snapshot.mon_obs_wob, "Severe abdominal paradox / exhaustion");
assert.strictEqual(proc1Snapshot.mon_obs_aldrete, "< 8");
console.log("  ✓ PASS: Step 1 - Procedure 1 monitoring snapshot captured acute complication accurately.");

const completedProcedures = [
  {
    proc_id: "thoracentesis",
    proc_name: "Ultrasound-Guided Thoracentesis",
    proc_date: "2026-09-14",
    proc_operator: "Dr. Arvind Ramesh",
    summary: "1200 mL serosanguinous pleural fluid evacuated. Complicated by acute hemoptysis.",
    monitoring_snapshot: proc1Snapshot
  }
];

// --- TEST 2: Starting and signing off Procedure 2 (Interventional Bronchoscopy) ---
// When Procedure 2 is signed off, acute fields reset to clean slate
patientFormData = resetAcuteMonitoringState(patientFormData, "bronchoscopy", "Therapeutic Bronchoscopy with Balloon Blocker");

// Verify clean slate
assert.strictEqual(patientFormData.mon_active_procedure_id, "bronchoscopy");
assert.strictEqual(patientFormData.mon_active_procedure_name, "Therapeutic Bronchoscopy with Balloon Blocker");
assert.strictEqual(patientFormData.mon_eff_hemoptysis, "None", "Hemoptysis should be reset to None for new procedure");
assert.strictEqual(patientFormData.mon_obs_wob, "Eupneic / Normal resting", "WOB should be reset to normal");
assert.strictEqual(patientFormData.mon_obs_aldrete, "", "Aldrete should be cleared for fresh assessment");
assert.strictEqual(patientFormData.mon_timed_obs.length, 0, "Timed flowsheet reset");
assert.strictEqual(patientFormData.mon_complications.length, 0, "Complications reset");

// Verify chronic orders are preserved
assert.strictEqual(patientFormData.mon_proph_dvt, "Enoxaparin 40 mg SC daily", "DVT prophylaxis preserved");
assert.strictEqual(patientFormData.mon_proph_gi, "Pantoprazole 40 mg IV daily", "GI prophylaxis preserved");
assert.strictEqual(patientFormData.mon_orders_nutrition, "NPO until alert, then diabetic diet", "Nutrition orders preserved");
console.log("  ✓ PASS: Step 2 - Acute monitoring reset to clean slate while baseline orders preserved.");

// --- TEST 3: Fresh PACU charting for Procedure 2 ---
patientFormData.mon_obs_aldrete = "10 (Full PACU discharge readiness)";
patientFormData.mon_obs_spo2 = "98";
patientFormData.mon_obs_o2_flow = "2 L/min nasal cannula";
patientFormData.mon_obs_wob = "Eupneic / Normal resting";
patientFormData.mon_eff_hemoptysis = "None";

const proc2Snapshot = extractMonitoringSnapshot(patientFormData, "bronchoscopy", "Therapeutic Bronchoscopy with Balloon Blocker");
assert.strictEqual(proc2Snapshot.mon_obs_aldrete, "10 (Full PACU discharge readiness)");
assert.strictEqual(proc2Snapshot.mon_eff_hemoptysis, "None");

completedProcedures.push({
  proc_id: "bronchoscopy",
  proc_name: "Therapeutic Bronchoscopy with Balloon Blocker",
  proc_date: "2026-09-15",
  proc_operator: "Dr. Arvind Ramesh",
  summary: "Endobronchial balloon blocker placed in RB8 segment. Immediate and complete hemostasis achieved.",
  monitoring_snapshot: proc2Snapshot
});

console.log("  ✓ PASS: Step 3 - Procedure 2 fresh PACU flowsheet captured with hemostasis and Aldrete 10.");

// --- TEST 4: Synthesis of Discharge Summary contains both procedure snapshots and active PACU state ---
const synthesizedDischarge = synthesizeSection4(completedProcedures, patientFormData);

assert(synthesizedDischarge.includes("Ultrasound-Guided Thoracentesis"), "Includes Proc 1 name");
assert(synthesizedDischarge.includes("Hemoptysis: Severe (>100 mL)"), "Includes Proc 1 PACU snapshot hemoptysis");
assert(synthesizedDischarge.includes("Therapeutic Bronchoscopy with Balloon Blocker"), "Includes Proc 2 name");
assert(synthesizedDischarge.includes("Aldrete 10 (Full PACU discharge readiness)"), "Includes Proc 2 PACU snapshot Aldrete 10");
assert(synthesizedDischarge.includes("Active PACU Monitoring Metrics (Therapeutic Bronchoscopy with Balloon Blocker)"), "Includes active PACU section with active procedure tag");

console.log("  ✓ PASS: Step 4 - Disposition master successfully synthesized multi-procedure PACU history.");
console.log("\nSynthesized Section 4 Output Preview:\n" + synthesizedDischarge);

console.log("------------------------------------------------------------------");
console.log("ALL PROCEDURE-SCOPED MONITORING TESTS PASSED (4/4)");
console.log("------------------------------------------------------------------");
