// Lok Adalat masters & sample data — Legal Services Authorities Act 1987, ss.19–22. Replace with API later.
import { LAW } from "./masters.js";
import { TODAY } from "./rules.js";
import { D, days } from "../lib/helpers.js";

export const LA_STAGES = [
  { n: 'Identified', own: 'System · AI', sla: 'Weekly scan', exit: 'Fitness score ≥ 50 or officer override' },
  { n: 'Listed (s.20 reference)', own: 'Designated Officer', sla: 'Before cut-off of sitting', exit: 'Case on the sitting list (DLSA / SLSA referral or insurer application)' },
  { n: 'Pre-sitting counselling', own: 'Designated Officer · panel advocate', sla: 'Before sitting', exit: 'Claimant demand recorded; negotiation rounds logged' },
  { n: 'Mandate approved', own: 'Approver per delegation', sla: '3 days before sitting', exit: 'Settlement ceiling approved so the officer can settle on the day' },
  { n: 'Consent & joint memo', own: 'Officer · both advocates', sla: 'On or before sitting', exit: 'Joint compromise memo signed by all claimants' },
  { n: 'Award passed (s.21)', own: 'Lok Adalat bench', sla: 'Sitting day', exit: 'Award recorded — deemed decree, no appeal' },
  { n: 'Paid & disbursed', own: 'Finance (hub accounts)', sla: '30 days from award', exit: 'UTR recorded; minors’ share in fixed deposit' },
];

export const SITTINGS = [
  { id: 'NSK-2025-11-08', name: 'Nashik MACT Lok Adalat', type: 'District · MACT', date: '2025-11-08', auth: 'DLSA Nashik', agg: { listed: 46, settled: 29, claimed: 78000000, settledAmt: 31500000, est: 38800000 } },
  { id: 'NLA-2026-06-13', name: 'National Lok Adalat (2nd of 2026)', type: 'National', date: '2026-06-13', auth: 'NALSA through all SLSAs / DLSAs', agg: { listed: 1240, settled: 812, claimed: 2124000000, settledAmt: 968000000, est: 1185000000 } },
  { id: 'NLA-2026-09-12', name: 'National Lok Adalat (3rd of 2026)', type: 'National', date: '2026-09-12', auth: 'NALSA through all SLSAs / DLSAs', agg: { listed: 1410, settled: 968, claimed: 2510000000, settledAmt: 1136000000, est: 1392000000 } },
  { id: 'PUN-2026-10-17', name: 'Pune MACT Lok Adalat', type: 'District · MACT special', date: '2026-10-17', auth: 'DLSA Pune' },
  { id: 'BLR-2026-10-24', name: 'Bengaluru MACT special Lok Adalat', type: 'District · MACT special', date: '2026-10-24', auth: 'DLSA Bengaluru Urban' },
  { id: 'NAG-2026-10-31', name: 'Nagpur MACT Lok Adalat', type: 'District · MACT', date: '2026-10-31', auth: 'DLSA Nagpur' },
  { id: 'NLA-2026-12-12', name: 'National Lok Adalat (4th of 2026)', type: 'National', date: '2026-12-12', auth: 'NALSA through all SLSAs / DLSAs', tentative: true },
];

// Claimant-advocate settlement history (sample portfolio data)
export const ADV_SETTLE = {
  'Adv. R. Shaikh': .74, 'Adv. P. Manjunath': .61, 'Adv. R. Lekha': .68, 'Adv. N. Qureshi': .44, 'Adv. A. Khan': .52,
  'Adv. H. Prakash': .66, 'Adv. S. Hussain': .63, 'Adv. T. Das': .31, 'Adv. P. Wankhede': .8, 'Adv. S. Rizvi': .5,
};

export const LAW_LA = {
  ptthomas: { t: 'P.T. Thomas v. Thomas Job', c: '(2005) 6 SCC 478', ct: 'Supreme Court', h: 'A Lok Adalat award is final and binding, is deemed a decree, and no appeal lies against it.' },
  jalour: { t: 'State of Punjab v. Jalour Singh', c: '(2008) 2 SCC 660', ct: 'Supreme Court', h: 'A Lok Adalat has no adjudicatory role; it can pass an award only on a compromise, otherwise the case returns to court.' },
};
Object.assign(LAW, LAW_LA);

// Scoring thresholds / patterns (the weights themselves live in lib/lokadalat.js laScore)
export const LA_RULES = { listScore: 70, considerScore: 50, holdPattern: /incepted|recur/i };

// Seed state. offer: 'open' = Form XI figure, 'target' = band target, or a number. mandate.amt: 'ceiling' or a number.
export const LA_SEED = [
  { id: 'MACT-2025-0711', sitting: 'PUN-2026-10-17', stage: 2, ref: 'DLSA Pune referral list', settleStatus: 'Listed — Lok Adalat 17 Oct 2026',
    rounds: [['2026-09-10', 'Pre-sitting counselling', 2400000, 'open', 'Claimant relies on 40% disability certificate']] },
  { id: 'MACT-2026-0112', sitting: 'BLR-2026-10-24', stage: 1, ref: 'Application by insurer, s.20(1)' },
  { id: 'MACT-2026-0087', sitting: 'NLA-2026-12-12', stage: 2, ref: 'Consent of parties, s.20(1)',
    rounds: [['2026-09-02', 'Form XI offer', 6800000, 'open', 'Offer filed with reasons'], ['2026-09-22', 'Pre-sitting counselling', 5200000, 'target', 'Claimant open to Lok Adalat; insists on 22% disability']] },
  { id: 'MACT-2025-0934', sitting: 'NLA-2026-12-12', stage: 3, ref: 'Application by insurer, s.20(1)',
    rounds: [['2026-09-18', 'Pre-sitting counselling', 4200000, 'open', 'Father sole earner now; wants quick settlement'], ['2026-09-26', 'Pre-sitting counselling', 3100000, 'target', 'Advocate indicates ₹28–29 L acceptable']],
    mandate: { amt: 'ceiling', status: 'Approved', on: '2026-09-27' } },
  { id: 'MACT-2026-0126', sitting: 'NLA-2026-12-12', stage: 1, ref: 'DLSA Hyderabad referral list' },
  { id: 'MACT-2026-0119', sitting: 'NAG-2026-10-31', stage: 4, ref: 'Consent of parties, s.20(1)',
    rounds: [['2026-06-08', 'Form XI offer', 500000, 500000, 'Fixed s.164 amount'], ['2026-09-19', 'Pre-sitting counselling', 500000, 500000, 'Claimant consents; memo signed']],
    mandate: { amt: 500000, status: 'Approved', on: '2026-09-19' } },
  { id: 'MACT-2023-0219', sitting: 'NSK-2025-11-08', stage: 6, ref: 'DLSA Nashik referral list', outcome: { amt: 740000, date: '2025-11-08', award: 'LA/NSK/2025/0311' } },
  { id: 'MACT-2025-0455', sitting: 'NLA-2026-09-12', stage: 5, ref: 'TNSLSA referral list', outcome: { amt: 1150000, date: '2026-09-12', award: 'NLA/TN/2026-3/08812' } },
  { id: 'MACT-2025-0512', sitting: 'NLA-2026-06-13', stage: 6, ref: 'TSLSA referral list', outcome: { amt: 2350000, date: '2026-06-13', award: 'NLA/TS/2026-2/04417' } },
];

export const sitting = (id) => SITTINGS.find((s) => s.id === id);
export const upcomingSittings = () =>
  SITTINGS.filter((s) => days(TODAY, D(s.date)) >= 0).sort((a, b) => D(a.date) - D(b.date));