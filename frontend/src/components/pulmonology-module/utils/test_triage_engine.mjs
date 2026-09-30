import { evaluatePostProcedureTriage, POST_PROCEDURE_TRIAGE_STATUS, evaluateClinicalPathway } from "./clinicalPathwayEngine.js";
import assert from "node:assert";

console.log("==================================================================");
console.log("RUNNING CDS POST-PROCEDURE TRIAGE RECOMMENDATION ENGINE TEST SUITE");
console.log("==================================================================\n");

let passedCount = 0;
let totalCount = 0;

function test(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------------------
// Scenario 1: Discharge Ready (Green)
// Full PACU recovery, Aldrete 10, normal vitals, no air leak, CXR cleared
// -------------------------------------------------------------------------
test("Scenario 1: Fully recovered patient is DISCHARGE_READY (Green)", () => {
  const formData = {
    mon_obs_aldrete: "10 (Full Recovery - Discharge Ready)",
    mon_obs_spo2: "96",
    mon_obs_o2_flow: "Room Air (21%)",
    mon_obs_rr: "16",
    mon_obs_hr: "74",
    mon_obs_bp: "120/80",
    mon_eff_cxr_ptx: "Confirmed Absent / Excluded",
    mon_nurs_air_leak: "Absent",
    mon_eff_hemoptysis: "None",
    mon_complications: [],
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "DISCHARGE_READY");
  assert.strictEqual(result.color, "#15803d");
  assert.strictEqual(result.isDischargeReady, true);
  assert.strictEqual(result.blockers.length, 0);
  assert.strictEqual(result.targetTrack, "discharge");
  assert.ok(result.clearedChecks.length >= 3, "Expected multiple cleared milestones");
});

// -------------------------------------------------------------------------
// Scenario 2: Continued Inpatient Monitoring - Aldrete < 9 (Yellow)
// Standard hospital practice: Aldrete 8 blocks direct discharge
// -------------------------------------------------------------------------
test("Scenario 2: Aldrete < 9 triggers WARD_MONITORING (Yellow)", () => {
  const formData = {
    mon_obs_aldrete: "8 (PACU Recovery Required)",
    mon_obs_spo2: "96",
    mon_obs_o2_flow: "Room Air (21%)",
    mon_eff_cxr_ptx: "Confirmed Absent / Excluded",
    mon_nurs_air_leak: "Absent",
    mon_eff_hemoptysis: "None",
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "WARD_MONITORING");
  assert.strictEqual(result.color, "#b45309");
  assert.strictEqual(result.isDischargeReady, false);
  assert.ok(result.blockers.some((b) => b.includes("Aldrete score is 8/10")));
});

// -------------------------------------------------------------------------
// Scenario 3: Continued Inpatient Monitoring - Grade 1 Air Leak (Yellow)
// Standard hospital practice: Grade 1 cough air leak blocks routine discharge
// -------------------------------------------------------------------------
test("Scenario 3: Grade 1 air leak on forced cough blocks discharge (Yellow)", () => {
  const formData = {
    mon_obs_aldrete: "10",
    mon_obs_spo2: "96",
    mon_eff_cxr_ptx: "Confirmed Absent / Excluded",
    mon_nurs_air_leak: "Present on forced cough only (Grade 1)",
    mon_eff_hemoptysis: "None",
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "WARD_MONITORING");
  assert.strictEqual(result.color, "#b45309");
  assert.strictEqual(result.isDischargeReady, false);
  assert.ok(result.blockers.some((b) => b.includes("Grade 1 air leak")));
});

// -------------------------------------------------------------------------
// Scenario 4: Continued Inpatient Monitoring - Continuous Tidal Air Leak (Yellow)
// -------------------------------------------------------------------------
test("Scenario 4: Continuous tidal air leak (Grade 3) requires WARD_MONITORING", () => {
  const formData = {
    mon_obs_aldrete: "10",
    mon_obs_spo2: "96",
    mon_nurs_air_leak: "Continuous during tidal breathing (Grade 3)",
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "WARD_MONITORING");
  assert.ok(result.blockers.some((b) => b.includes("Continuous tidal air leak (Grade 3)")));
});

// -------------------------------------------------------------------------
// Scenario 5: Urgent Escalation - Unresolved Complication Grade > 1 (Red)
// Active CTCAE Grade 2 / Clavien II complication with Outcome != Resolved
// -------------------------------------------------------------------------
test("Scenario 5: Active complication with Outcome not Resolved and Grade > 1 triggers URGENT_ESCALATION (Red)", () => {
  const formData = {
    mon_obs_aldrete: "10",
    mon_obs_spo2: "96",
    mon_complications: [
      {
        id: "comp-1",
        time: "15:30",
        desc: "Endobronchial mucosal laceration with brisk bleeding",
        ctcae: "Grade 2 (Moderate)",
        clavien: "II",
        outcome: "Persistent",
      },
    ],
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "URGENT_ESCALATION");
  assert.strictEqual(result.color, "#b71c1c");
  assert.strictEqual(result.isDischargeReady, false);
  assert.ok(result.blockers.some((b) => b.includes("Active adverse event (Grade > 1)")));
});

// -------------------------------------------------------------------------
// Scenario 6: Urgent Escalation - Moderate Hemoptysis (Red)
// Significant hemoptysis (>50 mL)
// -------------------------------------------------------------------------
test("Scenario 6: Significant hemoptysis triggers URGENT_ESCALATION (Red)", () => {
  const formData = {
    mon_obs_aldrete: "10",
    mon_obs_spo2: "96",
    mon_eff_hemoptysis: "Moderate hemoptysis (50-100 mL)",
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "URGENT_ESCALATION");
  assert.strictEqual(result.color, "#b71c1c");
  assert.ok(result.blockers.some((b) => b.includes("Significant hemoptysis documented")));
});

// -------------------------------------------------------------------------
// Scenario 7: Urgent Escalation - Tension Pneumothorax on CXR (Red)
// -------------------------------------------------------------------------
test("Scenario 7: Tension Pneumothorax triggers URGENT_ESCALATION (Red)", () => {
  const formData = {
    mon_obs_aldrete: "10",
    mon_obs_spo2: "94",
    mon_eff_cxr_ptx: "Tension / Large Pneumothorax (Chest tube required)",
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "URGENT_ESCALATION");
  assert.strictEqual(result.color, "#b71c1c");
  assert.ok(result.blockers.some((b) => b.includes("Tension / Large Pneumothorax")));
});

// -------------------------------------------------------------------------
// Scenario 8: Urgent Escalation - Severe Hypoxemia SpO2 < 88% (Red)
// -------------------------------------------------------------------------
test("Scenario 8: Severe Hypoxemia (SpO2 < 88%) triggers URGENT_ESCALATION (Red)", () => {
  const formData = {
    mon_obs_aldrete: "9",
    mon_obs_spo2: "85",
  };

  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "URGENT_ESCALATION");
  assert.strictEqual(result.color, "#b71c1c");
  assert.ok(result.blockers.some((b) => b.includes("Severe refractory hypoxemia (SpO2 85%)")));
});

// -------------------------------------------------------------------------
// Scenario 9: Incomplete Data (Neutral Slate)
// -------------------------------------------------------------------------
test("Scenario 9: Empty form returns INCOMPLETE_DATA", () => {
  const formData = {};
  const result = evaluatePostProcedureTriage(formData);
  assert.strictEqual(result.status, "INCOMPLETE_DATA");
  assert.strictEqual(result.isDischargeReady, false);
  assert.strictEqual(result.actionButtonText, "Awaiting Data");
});

// -------------------------------------------------------------------------
// Scenario 10: Dictation Simulation — Fully Recovered Patient
// Dictation: "Aldrete 10, no pneumothorax, clear lung"
// -------------------------------------------------------------------------
test("Scenario 10: Dictation simulation ('Aldrete 10, no pneumothorax, clear lung') produces DISCHARGE_READY", () => {
  // Simulate extraction as performed by handleProcessDictation
  const text = "Aldrete 10, no pneumothorax, clear lung".toLowerCase();
  const extracted = {};

  const aldreteMatch = text.match(/aldrete\s*(?:score)?\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
  if (aldreteMatch && aldreteMatch[1] === "10") {
    extracted.mon_obs_aldrete = "10 (Full Recovery - Discharge Ready)";
  }
  if (text.includes("no pneumothorax") || text.includes("clear lung")) {
    extracted.mon_eff_cxr_ptx = "Confirmed Absent / Excluded";
  }
  if (text.includes("clear") && text.includes("lung")) {
    extracted.mon_obs_auscultation = "Clear bilaterally";
  }

  const result = evaluatePostProcedureTriage(extracted);
  assert.strictEqual(result.status, "DISCHARGE_READY");
  assert.strictEqual(result.color, "#15803d");
  assert.strictEqual(result.isDischargeReady, true);
  assert.strictEqual(result.blockers.length, 0);
  assert.ok(result.clearedChecks.some((c) => c.includes("Modified Aldrete score: 10/10")));
  assert.ok(result.clearedChecks.some((c) => c.includes("Pneumothorax confirmed absent")));
});

// -------------------------------------------------------------------------
// Scenario 11: Dictation Simulation — Complication Encounter
// Dictation: "Continuous air leak, Aldrete 8"
// -------------------------------------------------------------------------
test("Scenario 11: Dictation simulation ('Continuous air leak, Aldrete 8') produces WARD_MONITORING with blockers", () => {
  const text = "Continuous air leak, Aldrete 8".toLowerCase();
  const extracted = {};

  const aldreteMatch = text.match(/aldrete\s*(?:score)?\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
  if (aldreteMatch && aldreteMatch[1] === "8") {
    extracted.mon_obs_aldrete = "8 (PACU Recovery Required)";
  }
  if (text.includes("continuous air leak")) {
    extracted.mon_nurs_air_leak = "Continuous during tidal breathing (Grade 3)";
  }

  const result = evaluatePostProcedureTriage(extracted);
  assert.strictEqual(result.status, "WARD_MONITORING");
  assert.strictEqual(result.color, "#b45309");
  assert.strictEqual(result.isDischargeReady, false);
  assert.strictEqual(result.blockers.length, 2);
  assert.ok(result.blockers.some((b) => b.includes("Aldrete score is 8/10")));
});

// -------------------------------------------------------------------------
// Scenario 12: Thoracentesis Completed -> Transitions to Post-Procedure Monitoring
// -------------------------------------------------------------------------
test("Scenario 12: Completed Thoracentesis transitions pathway to Post-Procedure Monitoring (Green)", () => {
  const formData = {
    img_cxr_effusion: "Moderate right-sided pleural effusion with blunting",
    img_primary_finding: "Pleural Effusion",
    thora_procedure_performed: true,
    thora_volume_drained: "1150",
    thora_fluid_appearance: "Straw-colored clear fluid",
    last_completed_procedure: { proc_id: "thora", summary: "1150 mL fluid evacuated" },
  };

  const result = evaluateClinicalPathway(formData);
  assert.strictEqual(result.suggestedTrack, "monitoring");
  assert.strictEqual(result.badge, "Monitoring In Progress");
  assert.ok(result.title.includes("THORACENTESIS COMPLETED"));
  assert.ok(result.recommendedAction.includes("Post-Procedure Monitoring"));
});

// -------------------------------------------------------------------------
// Scenario 13: Completed Chest Tube -> Transitions to Post-Procedure Monitoring
// -------------------------------------------------------------------------
test("Scenario 13: Completed Chest Tube transitions pathway to Post-Procedure Monitoring (Green)", () => {
  const formData = {
    img_cxr_pneumothorax: "Large right pneumothorax",
    chest_tube_procedure_performed: true,
    last_completed_procedure: { proc_id: "chest_tube", summary: "28 Fr ICD placed" },
  };

  const result = evaluateClinicalPathway(formData);
  assert.strictEqual(result.suggestedTrack, "monitoring");
  assert.strictEqual(result.badge, "Monitoring In Progress");
  assert.ok(result.title.includes("CHEST TUBE IN SITU"));
});

console.log("\n------------------------------------------------------------------");
console.log(`TEST RESULTS: ${passedCount} / ${totalCount} PASSED`);
console.log("------------------------------------------------------------------");
