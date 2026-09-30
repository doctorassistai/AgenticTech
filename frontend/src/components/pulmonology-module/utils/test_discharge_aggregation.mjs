import { getDischargeReadiness, autoAggregateEncounterData } from "../tabs/discharge/dispositionHelpers.js";

console.log("==================================================================");
console.log("RUNNING DISCHARGE DATA AGGREGATION & READINESS TEST SUITE");
console.log("==================================================================");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// Scenario 0: Brand new patient with no data has blockers and is NOT Ready for Discharge
const newPatient = {};
const newPatientReadiness = getDischargeReadiness(newPatient);
assert(newPatientReadiness.isReady === false, "Brand new patient is NOT Ready for Discharge");
assert(newPatientReadiness.blockers.includes("Primary pulmonary diagnosis has not been established"), "Diagnosis blocker flagged for new patient");

// Scenario 1: Medical patient with ILD primary dx aggregates legitimate ICD-10, destination, follow-up, and rx without fake PACU data
const rawFormData = {
  pulm_primary_dx: "ILD / Fibrosis",
  pt_name: "John Doe",
  team_pulmonologist: "Dr. Arvind Ramesh, MD, FCCP",
};

const aggregated = autoAggregateEncounterData(rawFormData);
assert(aggregated.disp_destination === "Home (Self-Care)", "Auto-aggregates destination to Home (Self-Care)");
assert(aggregated.disp_transport_mode.includes("Self / Family Transport"), "Auto-aggregates transport mode");
assert(aggregated.disp_followup_pulm_date !== undefined, "Auto-schedules 2-week follow-up date");
assert(aggregated.disp_icd10_list.some((i) => i.code === "J84.112"), "Auto-maps ILD to J84.112 in ICD-10 table");
assert(aggregated.disp_rx_list.length >= 2, "Auto-creates legitimate take-home prescriptions for ILD");
assert(aggregated.mon_obs_aldrete === undefined, "Never fabricates mock PACU recovery Aldrete for medical non-procedure patient");

// Scenario 1b: Procedural patient aggregates actual snapshot PACU metrics
const procPatient = {
  pulm_primary_dx: "Pleural Effusion",
  last_completed_procedure: {
    proc_id: "thora",
    proc_name: "US-Guided Thoracentesis",
    monitoring_snapshot: {
      mon_obs_aldrete: "10 (Full Recovery)",
      mon_obs_spo2: "97",
    }
  }
};
const procAggregated = autoAggregateEncounterData(procPatient);
assert(procAggregated.mon_obs_aldrete === "10 (Full Recovery)", "Pulls actual snapshot Aldrete for procedure patient");

// Scenario 2: With aggregated clinical data and diagnosis, patient is Ready for Discharge (Green)
const fullForm = { ...rawFormData, ...aggregated };
const readiness = getDischargeReadiness(fullForm);
assert(readiness.isReady === true, "Patient with aggregated encounter data and established diagnosis is Ready for Discharge");
assert(readiness.flag === "Ready for Discharge", "Readiness flag is Ready for Discharge");
assert(readiness.blockers.length === 0, "No blockers remain after aggregation");

// Scenario 3: Routine outpatient missing diagnostics (PFT/6MWT/ABG) are non-blocking advisories, NOT hard stops
const formWithPendingDiag = {
  ...fullForm,
  diag_outstanding_flag: "Missing: Spirometry (FEV1%), Exercise Capacity (6MWT), Arterial Blood Gas (PaO2)",
};
const readinessPendingDiag = getDischargeReadiness(formWithPendingDiag);
assert(readinessPendingDiag.isReady === true, "Pending outpatient diagnostics do NOT block acute discharge");
assert(readinessPendingDiag.advisories.length > 0, "Pending diagnostics properly converted to non-blocking advisories");

// Scenario 4: Genuine PACU safety blocker (e.g. continuous air leak) DOES block discharge
const formWithActiveAirLeak = {
  ...fullForm,
  last_completed_procedure: { proc_id: "chest_tube", proc_name: "Chest Tube" },
  mon_nurs_air_leak: "Continuous during tidal breathing (Grade 3)",
};
const readinessAirLeak = getDischargeReadiness(formWithActiveAirLeak);
assert(readinessAirLeak.isReady === false, "Active Grade 3 air leak blocks discharge");
assert(readinessAirLeak.blockers.some((b) => b.includes("air leak")), "Air leak flagged in blockers list");

console.log("------------------------------------------------------------------");
console.log(`TEST RESULTS: ${passed} / ${total} PASSED`);
console.log("------------------------------------------------------------------");

if (passed !== total) process.exit(1);
