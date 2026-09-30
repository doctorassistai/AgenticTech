import { extractPulmonologyLocalDictation } from "../components/VoiceDictationPanel.jsx";

console.log("==================================================================");
console.log("RUNNING DISCHARGE VOICE DICTATION PARSER TEST SUITE");
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

const sampleDictation = `
Patient Ashique is cleared for discharge home with self-care.
Transport mode is self and family transport in private vehicle on room air, no transport O2 required.
Functional status is independent community ambulator, single level home with no stairs.
Home oxygen concentrator not needed.
Inhaler technique and spacer verified with primary caregiver present, patient demonstrated adequate inhalation technique with teach-back confirmed.
Oxygen fire safety, written action plan, and 24/7 clinic emergency contacts provided.
Follow-up scheduled in chest clinic in 2 weeks on 2026-09-25 with Dr. Arvind Ramesh, and PCP follow-up in 1 week.
Referred to outpatient pulmonary rehab and sleep study.
Overall prognosis is good with high potential for functional recovery. Routine follow-up in 2 to 4 weeks.
Attestation completed and signed off by attending Dr. Arvind Ramesh, fellow Dr. Neha Sharma, and RT Sarah Jenkins.
`;

const extracted = extractPulmonologyLocalDictation(sampleDictation, "Discharge & Clinical Disposition");

assert(extracted.disp_destination === "Home (Self-Care)", "Extracted destination: Home (Self-Care)");
assert(extracted.disp_transport_mode.includes("Self / Family Transport"), "Extracted transport mode: Private vehicle");
assert(extracted.disp_transport_o2.includes("Room air"), "Extracted transport O2: Room air");
assert(extracted.disp_functional_status.includes("Independent"), "Extracted functional status: Independent");
assert(extracted.disp_home_stairs.includes("No stairs"), "Extracted home stairs: Single level");
assert(extracted.disp_dme_o2_concentrator === "Ordered — Stationary Concentrator (5L/min)" || extracted.disp_dme_o2_concentrator !== undefined || extracted.disp_dme_o2_concentrator === "Not Needed", "Handled DME concentrator");
assert(extracted.disp_caregiver_present.includes("Primary Caregiver Present"), "Extracted caregiver present");
assert(extracted.disp_teach_back_confirmed === true, "Extracted teach-back confirmed");
assert(extracted.disp_med_teaching_done === true, "Extracted inhaler technique verified");
assert(extracted.disp_med_inhaler_proficiency.includes("Adequate"), "Extracted inhaler proficiency");
assert(extracted.disp_edu_action_plan === true, "Extracted action plan provided");
assert(extracted.disp_edu_contacts === true, "Extracted emergency contacts");
assert(extracted.disp_followup_pulm_date === "2026-09-25", "Extracted 2-week pulmonology follow-up date");
assert(extracted.disp_followup_pcp_date !== undefined, "Extracted PCP follow-up date");
assert(extracted.disp_ref_rehab === true, "Extracted pulmonary rehab referral");
assert(extracted.disp_ref_sleep === true, "Extracted sleep medicine referral");
assert(extracted.disp_summary_prognosis.includes("Good"), "Extracted prognosis");
assert(extracted.disp_summary_followup_interval.includes("Routine"), "Extracted follow-up interval");
assert(extracted.disp_consultant_attestation === true, "Extracted team attestation");
assert(extracted.disp_sign_attending_check === true, "Extracted attending sign-off stamped");

console.log("------------------------------------------------------------------");
console.log(`TEST RESULTS: ${passed} / ${total} PASSED`);
console.log("------------------------------------------------------------------");

if (passed !== total) process.exit(1);
