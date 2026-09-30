import {
  calcBode,
  calcGap,
  reconcilePatientTransplantData,
  getTransplantRecommendation,
} from "../tabs/advanced/transplantHelpers.js";

console.log("==================================================================");
console.log("RUNNING LUNG TRANSPLANT RECONCILIATION & ISHLT 2021 PROTOCOL TESTS");
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

// Scenario 1: Fresh encounter with empty form (reproducing screenshot)
const emptyForm = {};
const emptyReconciled = reconcilePatientTransplantData(emptyForm, "PT-101");
assert(emptyReconciled.primaryDx === "Not specified", "Empty form returns 'Not specified' diagnosis");
assert(emptyReconciled.fev1 === "Not recorded", "Empty form returns 'Not recorded' FEV1");
assert(isNaN(emptyReconciled.fev1Num), "fev1Num is NaN on unrecorded value (enabling Pending PFT status)");
assert(emptyReconciled.sixMwt === "Not recorded", "Empty form returns 'Not recorded' 6MWT");
assert(isNaN(emptyReconciled.sixMwtNum), "sixMwtNum is NaN on unrecorded value (enabling Pending 6MWT status)");
assert(emptyReconciled.pao2 === "Not recorded", "Empty form returns 'Not recorded' PaO2");
assert(emptyReconciled.paco2 === "Not recorded", "Empty form returns 'Not recorded' PaCO2");
assert(emptyReconciled.bode === "Not calculated", "BODE is 'Not calculated' without physiological variables");
assert(emptyReconciled.gap === "Not calculated", "GAP is 'Not calculated' without ILD PFT variables");

// Scenario 2: Severe COPD Patient evaluated from diagnostic procedure log
const copdProcPatient = {
  pulm_visit_reason: "Frequent severe COPD exacerbations, progressive dyspnea",
  pulm_clinical_bmi: "20.2", // <= 21 -> 1 point
  score_mmrc: "3", // 2 points
  completed_procedures_log: [
    {
      proc_id: "spiro",
      summary: "FEV1 22% predicted (Severe Obstructive Pattern). Post-bronchodilator assessment completed.",
      data: { pft_fev1_pct: "22", pft_fvc_pct: "45", pft_dlco_pct: "29" },
    },
    {
      proc_id: "6mwt",
      summary: "Distance 210m. Functional exercise capacity evaluated.",
      data: { mwt_distance: "210" },
    },
    {
      proc_id: "abg",
      summary: "pH 7.34, PaCO2 53 mmHg, PaO2 51 mmHg.",
      data: { abg_pao2: "51", abg_paco2: "53" },
    },
  ],
};

const copdReconciled = reconcilePatientTransplantData(copdProcPatient, "PT-COPD-09");
assert(copdReconciled.primaryDx === "COPD", "Infers COPD diagnosis from visit reason and procedure context");
assert(copdReconciled.fev1 === "22%", "Pulls FEV1 22% from completed spirometry procedure");
assert(copdReconciled.fev1Num === 22, "Parses numerical FEV1 as 22");
assert(copdReconciled.sixMwt === "210 m", "Pulls 6MWT 210m from completed 6MWT procedure");
assert(copdReconciled.sixMwtNum === 210, "Parses numerical 6MWT as 210");
assert(copdReconciled.pao2 === "51 mmHg", "Pulls PaO2 51 mmHg from completed ABG procedure");
assert(copdReconciled.paco2 === "53 mmHg", "Pulls PaCO2 53 mmHg from completed ABG procedure");
// BODE: BMI 20.2 (1 pt) + FEV1 22% (3 pts) + mMRC 3 (2 pts) + 6MWT 210m (2 pts) = 8 pts (Very High)
assert(copdReconciled.bode.includes("8 pts"), "Calculates BODE index of 8 points dynamically");
assert(copdReconciled.bode.includes("Very High"), "Assigns BODE Very High risk band");

// Test ISHLT Recommendation on COPD listing candidate
const copdRec = getTransplantRecommendation({
  primaryDx: copdReconciled.primaryDx,
  scoreBode: copdReconciled.bode,
  scoreGap: copdReconciled.gap,
  sixMwtM: copdReconciled.sixMwtNum,
  fev1Pct: copdReconciled.fev1Num,
  pao2: copdReconciled.pao2Num,
  paco2: copdReconciled.paco2Num,
  dlcoPct: copdReconciled.dlcoNum,
});
assert(copdRec !== null, "Generates transplant recommendation for severe COPD candidate");
assert(copdRec.level === "listing", "Flags patient as 'listing' level priority");
assert(copdRec.message.includes("BODE score of 8"), "Transplant recommendation message includes BODE 8");
assert(copdRec.message.includes("FEV1 of 22%"), "Transplant recommendation message includes FEV1 < 25%");
assert(copdRec.message.includes("PaO2 of 51"), "Transplant recommendation message includes PaO2 < 55 mmHg");

// Scenario 3: ILD Patient GAP Stage III Evaluation
const ildPatient = {
  pulm_primary_dx: "ILD / Fibrosis",
  pt_sex: "Male", // 1 pt
  pt_age: "67", // 2 pts (>65)
  pulm_current_fvc_pct: "46", // 2 pts (<50%)
  pulm_current_dlco_pct: "32", // 2 pts (<=35%)
  // Total GAP = 1 + 2 + 2 + 2 = 7 pts -> Stage III
};

const ildReconciled = reconcilePatientTransplantData(ildPatient, "PT-ILD-88");
assert(ildReconciled.gap.includes("7 pts"), "Calculates GAP score of 7 points for ILD candidate");
assert(ildReconciled.gap.includes("Stage III"), "Identifies GAP Stage III (High Risk)");

const ildRec = getTransplantRecommendation({
  primaryDx: ildReconciled.primaryDx,
  scoreBode: ildReconciled.bode,
  scoreGap: ildReconciled.gap,
  sixMwtM: ildReconciled.sixMwtNum,
  fev1Pct: ildReconciled.fev1Num,
  pao2: ildReconciled.pao2Num,
  paco2: ildReconciled.paco2Num,
  dlcoPct: ildReconciled.dlcoNum,
});
assert(ildRec.level === "listing", "Flags GAP Stage III ILD candidate as expedited listing");
assert(ildRec.message.includes("GAP Stage III"), "Recommendation cites GAP Stage III");

console.log("==================================================================");
console.log(`TOTAL: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
console.log("==================================================================");

if (passed !== total) {
  process.exit(1);
}
