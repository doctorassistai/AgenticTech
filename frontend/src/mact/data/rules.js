// Rules master (versioned). Extracted verbatim from the MACT console.
export const TODAY = new Date('2026-09-29T00:00:00');
export const MODEL = {extract:'mact-docai-v3.4', reason:'mact-reason-v2.1', rules:'CALC-2026.09', graph:'EG-schema-1.6'};

/* ---------- Rules master (deterministic engine, versioned) ---------- */
export const CONV = {'2023':{estate:18150,funeral:18150,consortium:48400,label:'2023 step (₹18,150 / ₹18,150 / ₹48,400)'},'2026':{estate:19965,funeral:19965,consortium:53240,label:'2026 step (₹19,965 / ₹19,965 / ₹53,240)'}};
export const R = {
  version:'CALC-2026.09', convStep:'2023', estate:18150, funeral:18150, consortium:48400, interest:7.5,
  convNote:'Pranay Sethi (2017) base ₹15,000 / ₹15,000 / ₹40,000, enhanced 10% every three years. Tribunals differ on applying the 2026 step — pending confirmation by New India legal.',
  mult:[[15,15],[20,18],[25,18],[30,17],[35,16],[40,15],[45,14],[50,13],[55,11],[60,9],[65,7],[200,5]],
  fp:{permanent:[[40,.5],[50,.3],[60,.15],[200,0]], fixed:[[40,.4],[50,.25],[60,.1],[200,0]], self:[[40,.4],[50,.25],[60,.1],[200,0]], notional:[[40,.4],[50,.25],[60,.1],[200,0]]},
  appealDays:90, doOfferDays:30, wsDays:30, surveyDays:20, settleDepositDays:30, awardDepositDays:30,
  lcFee:30000, nofault:{Death:500000,'Grievous hurt':250000}, limitationDefence:false
};
export function setConv(step){ const v=CONV[step]; if(!v) return; R.convStep=step; R.estate=v.estate; R.funeral=v.funeral; R.consortium=v.consortium; }
export const multiplier = a => R.mult.find(r=>a<=r[0])[1];
export const fpRate = (a,e) => (R.fp[e]||R.fp.fixed).find(r=>a<r[0])[1];
export const dedRate = (married,n) => !married ? .5 : n<=3 ? 1/3 : n<=6 ? 1/4 : 1/5;
export const fracStr = d => d===.5?'1/2':Math.abs(d-1/3)<1e-9?'1/3':d===.25?'1/4':'1/5';
export const isDeath = c => c.type==='Death'||(c.type==='No-fault'&&c.nfKind==='Death');