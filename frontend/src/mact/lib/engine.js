import { TODAY, MODEL, CONV, R, setConv, multiplier, fpRate, dedRate, fracStr, isDeath } from '../data/rules.js';
import { HUBS, NODAL, SURVEYORS, DELEGATION, hubOf, approver, DOCS, STAGES } from '../data/masters.js';
import { CASES } from '../data/cases.js';
import { INR, L, D, fd, days, addDays, pct, hash } from './helpers.js';
import { S, persist, byId, open, log, isReal } from '../store.js';
import { sitting, upcomingSittings } from '../data/lokadalat.js';
import { laScore, seedLA } from './lokadalat.js';

export function surveyorOf(c){
  if(c.type==='No-fault') return {status:'Not required',note:'No-fault claim — no negligence enquiry'};
  if(!c.darOn) return {status:'Awaiting DAR',note:'Surveyor appointed on receipt of DAR'};
  const due=addDays(c.darOn,R.surveyDays), h=hash(c.id), name=SURVEYORS[h%SURVEYORS.length];
  if(c.stage>=5){ const on=addDays(c.darOn,4+h%15); return {status:'Report submitted',name,due,on,verdict:c.darDispute?'DAR disputed — surveyor report sent to DCP':'DAR accepted',note:c.darDispute||'Facts in DAR confirmed: vehicle, driver, policy, victim particulars'}; }
  return {status:days(TODAY,due)<0?'Overdue':'In progress',name,due,verdict:null,note:days(TODAY,due)<0?`Overdue by ${-days(TODAY,due)} days`:`${days(TODAY,due)} days left`};
}


/* ---------- Deterministic compensation engine ---------- */
export function quantum(c,o){
  if(c.type==='No-fault'){ const v=R.nofault[c.nfKind]||0; return {heads:[['Fixed compensation under s.164 ('+String(c.nfKind).toLowerCase()+')',v,'Statutory amount — no proof of fault or income']],gross:v,cut:0,net:v,f:0,mult:0,contrib:0,income:0}; }
  const q=c.q, age=c.victim.age, f=fpRate(age,q.emp), mult=multiplier(age), heads=[];
  const m=o.income||0;
  if(c.type==='Death'){
    const ded=dedRate(q.married,o.dep), annual=m*12, withFP=annual*(1+f), dep=withFP*(1-ded)*mult;
    heads.push(['Loss of dependency',dep,`${INR(m)} × 12 × (1 + ${pct(f)}) × (1 − ${fracStr(ded)}) × ${mult}`]);
    heads.push(['Loss of estate',R.estate,'Conventional head ('+R.version+')']);
    heads.push(['Funeral expenses',R.funeral,'Conventional head']);
    heads.push(['Consortium',R.consortium*o.cons,`${o.cons} × ${INR(R.consortium)} (spousal / parental / filial)`]);
    heads.push(['Medical expenses',o.med,'Verified bills']);
    var extra={ded};
  } else {
    heads.push(['Medical expenses',o.med,'Verified bills']);
    heads.push(['Loss of income during treatment',m*q.months*q.lossPct,`${INR(m)} × ${q.months} months × ${pct(q.lossPct)} loss`]);
    heads.push(['Future loss of earning capacity',m*12*(1+f)*mult*o.disab/100,`${INR(m)} × 12 × (1 + ${pct(f)}) × ${mult} × ${o.disab}% functional`]);
    heads.push(['Attendant charges',q.attendant,'Rules master / evidence']);
    heads.push(['Transport & special diet',q.transport,'Rules master']);
    heads.push(['Future medical / prosthesis',q.futureMed,'Treating doctor estimate']);
    heads.push(['Pain and suffering',q.pain,'Banded by injury severity']);
    heads.push(['Loss of amenities',q.amenities,'Banded by disability']);
    var extra={};
  }
  const gross=heads.reduce((s,h)=>s+h[1],0), cut=gross*(o.contrib||0)/100;
  return Object.assign({heads,gross,cut,net:gross-cut,f,mult,contrib:o.contrib||0,income:m},extra);
}
export function scenarios(c){
  if(!c.q||!c.income) return null;
  const q=c.q, r=c.income.range||[c.income.claimed||0,c.income.claimed||0], e=S.edit[c.id]||{};
  const claimedInc=c.income.claimed||r[1], mid=(r[0]+r[1])/2;
  const base=(x)=>Object.assign({dep:q.depClaim,cons:q.consClaim,med:q.medVer||q.medClaim,disab:q.disTrib,contrib:q.contribTrib},x);
  const out={
    claimant:quantum(c,base({income:claimedInc,med:q.medClaim,disab:q.disClaim,contrib:0})),
    insurer:quantum(c,base({income:r[0],dep:q.depIns,cons:q.consIns,disab:q.disIns,contrib:q.contribIns})),
    alternate:quantum(c,base({income:r[1],contrib:Math.round(((q.contribIns||0)+(q.contribTrib||0))/2)})),
    tribunal:quantum(c,base({income:e.income!=null?e.income:mid,disab:e.disab!=null?e.disab:q.disTrib,contrib:e.contrib!=null?e.contrib:q.contribTrib,dep:e.dep!=null?e.dep:q.depClaim,cons:e.cons!=null?e.cons:q.consClaim,med:e.med!=null?e.med:(q.medVer||q.medClaim)}))
  };
  out.band=c.type==='No-fault'?[out.tribunal.net,out.tribunal.net]:[out.tribunal.net*0.93,out.tribunal.net*1.07];
  return out;
}
export function awardTotal(c){ return c.award?c.award.heads.reduce((s,h)=>s+h[1],0):0; }
export function insurerAwardTotal(c){ return c.award?c.award.heads.reduce((s,h)=>s+h[2],0):0; }
export function interestTo(amount,from,to,rate){ return amount*(rate||R.interest)/100*Math.max(0,days(from,to))/365; }
export function exposure(c){ // expected liability (point) + basis
  if(c.stage===16) return {v:c.settle&&c.settle.settled||awardTotal(c)||0,basis:'Closed'};
  if(c.settle&&c.settle.settled&&c.stage>=14&&c.stage<16) return {v:c.settle.settled,basis:S.la&&S.la[c.id]?'Lok Adalat award':'Settlement'};
  if(c.award){ const t=awardTotal(c); const i=interestTo(t,c.filed,c.payment?D(c.payment.on):TODAY,c.award.interest); return {v:t+i,basis:'Award + interest'}; }
  const s=scenarios(c); if(!s||!c.income.range) return {v:c.reserve||0,basis:'Initial reserve (awaiting documents)'};
  return {v:s.tribunal.net,basis:'Tribunal-method estimate'};
}
export function paidAmount(c){ if(!c.payment) return 0; if(c.settle&&c.settle.settled) return c.settle.settled; const t=awardTotal(c); return t+interestTo(t,c.filed,D(c.payment.on),c.award.interest); }
export function recovered(c){ return c.recovery&&c.recovery.recovered?c.recovery.recovered.reduce((s,r)=>s+r[1],0):0; }
export function doOffer(c){ if(c.type==='No-fault') return R.nofault[c.nfKind]||0; const s=scenarios(c); if(!s) return null; return Math.round(s.insurer.net*1.05/1000)*1000; }

/* ---------- Documents (auto-collection status) ---------- */
/* ---------- Real (database-registered) cases: status comes only from files actually uploaded ---------- */
function realDocsFor(c){
  const files=(S.docs&&S.docs[c.id])||[];
  return DOCS.filter(d=>{ const k=d[4]; if(k==='commercial'&&!c.vehicle.commercial) return false; if(k==='death'&&!isDeath(c)) return false; if(k==='injury'&&isDeath(c)) return false; return true; }).map(d=>{
    const [name,src,,ph]=d;
    const mine=files.filter(f=>f.doc_name===name);
    let st;
    if(mine.length) st='Received';
    else if(ph==='ws') st=c.stage>=8?'Awaiting upload':'Not due';
    else if(ph==='evid') st=c.stage>=9?'Awaiting upload':'Not due';
    else if(ph==='award') st=c.award?'Awaiting upload':'Not due';
    else st='Awaiting upload';
    const pages=mine.reduce((s,f)=>s+(f.status==='parsed'?f.pages||0:0),0);
    const last=mine.map(f=>f.uploaded_at).sort().pop();
    return {name,src,ch:'Upload',st,pages,conf:null,recv:last?fd(new Date(last)):'—',fields:0,files:mine};
  });
}
export function docsFor(c){
  if(isReal(c)) return realDocsFor(c);
  const ups=S.uploads[c.id]||[];
  const rows=DOCS.filter(d=>{ const k=d[4]; if(k==='commercial'&&!c.vehicle.commercial) return false; if(k==='death'&&!isDeath(c)) return false; if(k==='injury'&&isDeath(c)) return false; return true; }).map(d=>{
    const [name,src,ch,ph]=d; let st;
    if(ph==='court') st='Received';
    else if(ph==='auto') st=c.stage>=2?'Received':c.stage===1?'Requested':'Queued';
    else if(ph==='claimant') st=c.stage>=3?'Received':c.stage===2?'Requested':'Queued';
    else if(ph==='ws') st=c.stage>=8?'Received':'Not due';
    else if(ph==='evid') st=c.stage>=9?'Received':'Not due';
    else if(ph==='award') st=c.award?'Received':'Not due';
    if(ph==='auto'&&name.startsWith('Detailed')&&!c.darOn) st=c.stage>=1?'Requested':'Queued';
    if(ph==='auto'&&name==='Charge sheet'&&c.stage<6&&c.stage>=2&&!(c.docState&&c.docState[name])) st=(hash(c.id)%2)?'Received':'Awaited';
    if(c.docState&&c.docState[name]) st=c.docState[name];
    const h=hash(c.id+name), pages=st==='Received'?2+h%38:0, conf=st==='Received'?(ch==='API'||ch==='Internal'?99:88+h%11):null;
    const recv=st==='Received'?fd(addDays(c.filed, ph==='court'?(c.noticeOn?days(c.filed,D(c.noticeOn)):5):Math.min(days(c.filed)-1, 6+h%30))):'—';
    return {name,src,ch,st,pages,conf,recv,fields:st==='Received'?4+h%18:0};
  });
  return rows.concat(ups);
}
export function docStats(c){ const d=docsFor(c).filter(x=>x.st!=='Not due'); const r=d.filter(x=>x.st==='Received').length; return {r,t:d.length,p:d.length?r/d.length:0}; }

/* ---------- AI findings ---------- */
export function findings(c){
  if(c._f) return c._f;
  const F=[]; let n=0; const add=o=>F.push(Object.assign({id:c.id+'-F'+(++n),law:[]},o));
  if(c.type==='No-fault') add({engine:'Liability Engine',sev:'low',title:'No-fault claim under s.164 — fixed compensation',detail:`Fixed ${INR(R.nofault[c.nfKind])} on ${String(c.nfKind).toLowerCase()}. No proof of income or negligence is required. Portfolio check found no parallel s.166 petition for this accident (CNR, vehicle and date match).`,evidence:['Claim petition under s.164','Policy in force on accident date','DAR and death certificate'],conf:'High',law:[],q:'Is the claim payable under s.164, and is there a parallel s.166 petition?'});
  if(c.darDispute) add({engine:'DAR Verification',sev:'high',title:'DAR disputed after surveyor verification',detail:c.darDispute,evidence:['DAR (Form VII)','Surveyor report','FIR narrative vs claim petition'],conf:'High',law:['gohar'],q:'Does the surveyor’s verification support the DAR?'});
  if(c.income&&c.income.range&&c.income.claimed){ const [lo,hi]=c.income.range, gap=c.income.claimed/hi-1;
    add({engine:'Income Intelligence',sev:gap>.35?'high':gap>.08?'med':'low',title:gap>.08?'Income claimed above document-supported range':'Claimed income consistent with documents',detail:`Claimed ${INR(c.income.claimed)}/month. Evidence supports ${INR(lo)}–${INR(hi)}/month${gap>.08?` (${Math.round(gap*100)}% above the upper bound)`:''}.`,evidence:c.income.sources.map(s=>s[0]+(s[1]?': '+INR(s[1]):'')+' · '+s[2]),conf:c.income.sources.length>=3?'High':'Medium',law:c.q&&c.q.emp==='notional'?['kirti','kishan','pranay']:['pranay','sarla'],q:'What monthly income does the evidence support?',impact:'income'}); }
  if(c.med&&c.type==='Injury'&&c.med.disClaim>c.med.disAI){ add({engine:'Medical Intelligence',sev:c.med.disClaim-c.med.disAI>=20?'high':'med',title:'Physical disability vs functional disability',detail:`Claimed ${c.med.disClaim}%${c.med.disCert?` (certificate ${c.med.disCert}%)`:' (no certificate yet)'}; functional loss of earning capacity assessed at ${c.med.disAI}% on the medical and employment record.`,evidence:c.med.notes.length?c.med.notes:['Discharge summary','Follow-up notes'],conf:'Medium',law:['rajkumar','sidram'],q:'What functional disability affects earning capacity?',impact:'disab'}); }
  if(c.med&&c.med.billsClaim>c.med.billsVer){ add({engine:'Medical Intelligence',sev:'low',title:'Medical bills partly unsupported',detail:`Claimed ${INR(c.med.billsClaim)}; verified against itemised bills ${INR(c.med.billsVer)} (difference ${INR(c.med.billsClaim-c.med.billsVer)}).`,evidence:['Hospital final bill','Pharmacy invoices','Duplicate/unsigned invoices excluded'],conf:'High',law:['sidram'],q:'Which medical expenses are proved?'}); }
  (c.coverage||[]).filter(r=>r[3]!=='ok').forEach(r=>add({engine:'Policy Intelligence',sev:r[3]==='bad'?'high':'med',title:'Coverage: '+r[0],detail:r[1],evidence:[r[2]],conf:'High',law:r[4]||['swaran'],q:r[0]+'?'}));
  (c.conflicts||[]).forEach(x=>add({engine:'Case Reconstruction',sev:x[2],title:'Evidence conflict',detail:x[0]+' — versus — '+x[1],evidence:[x[0],x[1]],conf:'High',law:['jhaveri'],q:'Which version do contemporaneous records support?'}));
  (c.deps||[]).filter(d=>d[2]==='?').forEach(d=>add({engine:'Claimant Intelligence',sev:'med',title:`Dependency not verified: ${d[0]} (${d[1]})`,detail:'Claimed as dependant; household or income records do not yet confirm dependency.',evidence:['Ration card / household record','Claim petition para 4'],conf:'Medium',law:['sarla'],q:'Is this person a dependant?',impact:'dep'}));
  if(c.liab&&c.liab.contrib&&(c.liab.contrib[0]||c.liab.contrib[1])) add({engine:'Negligence Engine',sev:'med',title:`Negligence split — insurer position ${c.liab.contrib[0]}%, probable ${c.liab.contrib[1]}%`,detail:(c.liab.disp||[]).join('; ')||'Disputed facts on negligence.',evidence:(c.liab.pro||[]).concat(c.liab.con||[]),conf:'Medium',law:c.accType==='Multi-vehicle'?['khenyei','jhaveri']:['jhaveri','siddique'],q:'Is there contributory or composite negligence?',impact:'contrib'});
  (c.flags||[]).forEach(f=>add({engine:'Claims Integrity',sev:f[0],title:f[1],detail:f[2],evidence:[f[2]],conf:'Medium',law:[],q:'Does this anomaly need verification before settlement?'}));
  c._f=F; return F;
}
export function pending(c){ return findings(c).filter(f=>!(S.decisions[f.id])).length; }

/* ---------- Seed decisions & audit for realistic state ---------- */
export function stageDate(c,i){ const span=Math.max(1,days(c.filed)-3); return addDays(c.filed, Math.round(span*i/Math.max(1,c.stage))); }
export function seed(){
  S.cases=CASES;
  S.cases.forEach(c=>{
    const F=findings(c);
    if(c.stage>=7) F.forEach((f,i)=>{ S.decisions[f.id]={d:f.engine==='Claims Integrity'&&f.sev==='high'?'modify':'accept',note:f.engine==='Claims Integrity'&&f.sev==='high'?'Verification ordered before any settlement':'',by:c.officer,at:fd(stageDate(c,5))}; });
    else if(c.stage===6) F.slice(0,Math.max(0,F.length-2)).forEach(f=>{ S.decisions[f.id]={d:'accept',note:'',by:c.officer,at:fd(stageDate(c,4))}; });
    else if(c.stage===5) F.slice(0,1).forEach(f=>{ S.decisions[f.id]={d:'accept',note:'',by:c.officer,at:fd(stageDate(c,4))}; });
    const A=[]; const ev=(i,actor,action,detail,model)=>A.unshift({at:fd(stageDate(c,i)),actor,action,detail,model:model||'—',rule:R.version});
    ev(0,'System · eCourts sync','Court intimation matched',`${c.mvc} listed; CNR ${c.cnr} matched to policy ${c.policy.no}`);
    if(c.stage>=1) ev(1,'System · assignment rules','Case assigned',`Officer ${c.officer}; panel advocate ${c.advocate}; initial reserve ${L(c.reserve)}`,'reserve-model-v1.3');
    if(c.stage>=2) ev(2,'System · connectors','Documents auto-collected',`${docStats(c).r} of ${docStats(c).t} documents received`);
    if(c.stage>=3) ev(3,'AI · document & reasoning engines','Evidence graph built',`${F.length} findings generated`,MODEL.extract+' / '+MODEL.reason);
    if(c.stage>=5) ev(4,c.surveyor?c.surveyor.name:'Surveyor','DAR verified by surveyor',c.surveyor?c.surveyor.verdict:'DAR accepted');
    if(c.stage>=5) ev(5,c.officer,'Coverage & liability reviewed','Findings accepted / modified');
    if(c.stage>=6) ev(6,'System · compensation engine','Quantum computed','Four scenarios computed',R.version);
    if(c.stage>=7) ev(7,c.officer,'Settlement decision',c.settle?`Form XI offer ${L(doOffer(c))} issued`:'Decision to contest recorded');
    if(c.stage>=8) ev(8,c.advocate,'Written statement filed','Draft generated by Litigation Intelligence; edited by advocate',MODEL.reason);
    if(c.award) ev(Math.min(c.stage,12),'System · eCourts sync','Award received',`Award dated ${fd(c.award.date)} — ${L(awardTotal(c))}`,MODEL.extract);
    if(c.payment) ev(Math.min(c.stage,14),'Finance','Deposit made',`${c.payment.utr}`);
    S.audit[c.id]=A;
  });
  S.activity=[
    {at:'2026-09-28 18:05',caseId:'MACT-2026-0112',src:'eCourts',text:'Order uploaded: PW1 examined; PW2 (employer) on 08-10-2026 — hearing date updated'},
    {at:'2026-09-27 16:40',caseId:'MACT-2026-0126',src:'Hospital',text:'Discharge summary received from Osmania General Hospital — extraction complete (14 fields)'},
    {at:'2026-09-26 11:20',caseId:'MACT-2026-0131',src:'eCourts',text:'New petition MACT 2214/2026 (Raipur) — insurer impleaded as R3; case auto-created; 17 documents requested'},
    {at:'2026-09-25 15:02',caseId:'MACT-2026-0133',src:'Police eDAR',text:'DAR received — Form XI offer clock started (30 days, due 25-10-2026)'},
    {at:'2026-09-24 09:12',caseId:'MACT-2026-0112',src:'Account aggregator',text:'12-month bank statement received — income range recomputed ₹26,500–₹29,000'},
    {at:'2026-09-22 12:31',caseId:'MACT-2025-0934',src:'Vehicle registry',text:'Permit history pulled for DL-1R-TA-7784 — permit expired 20-05-2025; coverage flag raised'},
    {at:'2026-09-18 17:48',caseId:'MACT-2024-0402',src:'eCourts',text:'Award pronounced — case moved to award analysis; appeal limitation 17-12-2026'}
  ];
  try{ const cv=persist.get('conv'); if(cv) setConv(cv); }catch(e){}
  try{ const d=persist.get('decisions'); if(d) Object.assign(S.decisions,d); const e=persist.get('edit'); if(e) S.edit=e; }catch(e){}
}


/* ---------- Simulated court / connector sync queue ---------- */
export const SYNCQ = [
  ()=>{ const c=byId('MACT-2026-0133'); if(!S.la[c.id]&&c.income&&c.income.range){ S.la[c.id]={caseId:c.id,sitting:'NLA-2026-12-12',stage:1,ref:'SLSA Karnataka referral list',rounds:[],mandate:null,outcome:null,returned:false}; c.courtStage='Referred to Lok Adalat — 12 Dec 2026'; } return {caseId:c.id,src:'SLSA',text:'Karnataka SLSA referral list for National Lok Adalat (12 Dec 2026, tentative) — MACT-2026-0133 referred under s.20; negotiation band prepared'}; },
 ()=>{ const c=byId('MACT-2026-0087'); c.settle.demand=4800000; c.settle.status='Counter received'; c.courtStage='Counter-proposal filed'; if(S.la[c.id]) S.la[c.id].rounds.push({date:'2026-09-29',where:'Counter-proposal filed in court',demand:4800000,offer:S.la[c.id].rounds[S.la[c.id].rounds.length-1].offer,note:'Via eCourts order sheet'}); return {caseId:c.id,src:'eCourts',text:'Claimant filed counter-proposal of ₹48 L against Form XI offer — Lok Adalat negotiation log updated'}; },,
 ()=>{ const n={id:'MACT-2026-0141',cnr:'MHTH0A0033712026',mvc:'MACP 3371/2026',court:'MACT, Thane',district:'Thane',state:'Maharashtra',type:'Injury',accident:'2026-07-29',place:'Ghodbunder Road, Kasarvadavali',filed:'2026-09-21',noticeOn:'2026-09-29',darOn:null,stage:0,courtStage:'Notice issued',priority:'Medium',officer:'Unassigned',advocate:'—',cAdv:'Adv. V. Pawar',hospital:'Jupiter Hospital, Thane',accType:'Side impact',vehCat:'Private car',victim:{name:'Nilesh Jadhav',age:39,sex:'M',occ:'Auto-rickshaw driver'},vehicle:{reg:'MH-04-KT-8830',cls:'Private car (LMV)',gvw:'1,420 kg',commercial:false},policy:{no:'PC-2602-MH-0133830',from:'2026-02-11',to:'2027-02-10',kind:'Private car package'},driver:{name:'—',dl:'—',cls:'—',valid:'—'},claimed:3200000,reserve:0,next:'2026-11-02',purpose:'Appearance & written statement',income:{claimed:22000,range:null,sources:[]},deps:[],q:{emp:'self',disClaim:30,disIns:10,disTrib:15,medClaim:0,medVer:0,months:3,lossPct:1,attendant:0,transport:0,futureMed:0,pain:0,amenities:0,contribIns:0,contribTrib:0},timeline:[['29 Jul 2026','Accident (as per petition)','Claim petition']],conflicts:[],coverage:[],liab:null,med:null,flags:[],law:[]};
    S.cases.unshift(n); log(n.id,'Case auto-created from court intimation','MACP 3371/2026, MACT Thane — policy PC-2602-MH-0133830 matched','System · eCourts sync'); S.activity.shift(); return {caseId:n.id,src:'eCourts',text:'New petition MACP 3371/2026 (Thane) — insurer impleaded as R2; case auto-created, documents requested'}; },
 ()=>{ const c=byId('MACT-2026-0131'); c.darOn='2026-09-29'; c.stage=1; c.officer='P. Verma'; c.advocate='Adv. R. Agrawal'; c.reserve=3400000; return {caseId:c.id,src:'Police eDAR',text:'DAR received — Raipur TP Hub assigned DO P. Verma / Adv. R. Agrawal; surveyor appointed (due in 20 days); Form XI clock started; initial reserve ₹34 L'}; },
 ()=>{ const c=byId('MACT-2026-0098'); c.courtStage='Issues framed'; return {caseId:c.id,src:'eCourts',text:'Order: issues framed including composite negligence; next date 21-10-2026'}; }
];


export function actionQueue(){
  const A=[];
  S.cases.filter(open).forEach(c=>{
    const ex=exposure(c).v;
    if(c.stage===0) A.push({c,act:'Confirm policy match & assign advocate',why:`Notice received ${fd(c.noticeOn)}; WS due ${fd(addDays(c.noticeOn,R.wsDays))}`,amt:c.claimed*.4,score:1e9-days(TODAY,addDays(c.noticeOn,R.wsDays))});
    if(c.darOn&&c.stage<=7&&c.stage>=2){ const due=addDays(c.darOn,R.doOfferDays), left=days(TODAY,due); A.push({c,act:c.stage>=7?'Follow up Form XI offer':'Approve quantum and issue Form XI offer',why:left>=0?`Form XI offer due ${fd(due)} (${left} days)`:`Form XI offer window passed ${-left} days ago`,amt:ex,score:ex*(left<10?3:1)}); }
    const sv=surveyorOf(c); if(sv.due&&!sv.verdict&&c.stage<=4){ const left=days(TODAY,sv.due); A.push({c,act:'Complete surveyor verification of DAR',why:left>=0?`Due ${fd(sv.due)} (${left} days) · ${sv.name}`:`Overdue ${-left} days — escalate to ${hubOf(c).nodal.split(',')[0]}`,amt:ex,score:ex*(left<7?3.2:1.2)}); }
    if(c.darOn&&c.stage<=6&&days(TODAY,addDays(c.darOn,R.doOfferDays))<=7) A.push({c,act:'Nodal Officer alert: Form XI window at risk',why:`Offer due ${fd(addDays(c.darOn,R.doOfferDays))}; ${hubOf(c).nodal}`,amt:ex,score:ex*2.5});
    if(c.settle&&c.settle.settledOn&&!c.payment){ const due=addDays(c.settle.settledOn,R.settleDepositDays), left=days(TODAY,due); A.push({c,act:'Deposit settled amount',why:`Record of settlement ${fd(c.settle.settledOn)} — deposit due ${fd(due)} (${left} days)`,amt:c.settle.settled,score:5e8-left}); }
        const la=S.la&&S.la[c.id]; if(la&&!la.outcome&&!la.returned){ const sd=D(sitting(la.sitting).date), left=days(TODAY,sd); if(left>=0&&left<=30&&(!la.mandate||la.mandate.status!=='Approved')) A.push({c,act:'Obtain Lok Adalat mandate',why:`${sitting(la.sitting).name} on ${fd(sd)} (${left} days) — no approved mandate`,amt:ex,score:ex*(left<=10?3.5:2)}); }
    if(S.la&&!la&&laScore(c).score>=70) A.push({c,act:'List for Lok Adalat',why:`Fitness score ${laScore(c).score}; next sitting ${upcomingSittings()[0]?fd(upcomingSittings()[0].date):'—'}`,amt:ex,score:ex*1.1});
    const p=pending(c); if(c.stage>=3&&c.stage<=6&&p) A.push({c,act:`Review ${p} pending AI finding${p>1?'s':''}`,why:'Stage cannot advance until findings are decided',amt:ex,score:ex*1.5});
    if(c.award&&!c.award.decided){ const lim=addDays(c.award.date,R.appealDays), left=days(TODAY,lim); A.push({c,act:'Decide appeal or compliance',why:`Limitation ${fd(lim)} (${left} days) · interest accrues daily`,amt:awardTotal(c),score:awardTotal(c)*(left<45?4:2)}); }
    if(c.next){ const left=days(TODAY,D(c.next)); if(left>=0&&left<=10) A.push({c,act:'Prepare for hearing: '+c.purpose,why:`Hearing ${fd(c.next)} (${left} days)`,amt:ex,score:ex*(2-left/10)}); }
    if((c.flags||[]).some(f=>f[0]==='high')&&c.stage<12) A.push({c,act:'Verify high-severity integrity flag',why:(c.flags.find(f=>f[0]==='high')||[])[1],amt:ex,score:ex*1.2});
    if(c.recovery&&c.recovery.recovered) A.push({c,act:'Recovery: '+c.recovery.next,why:`${L(paidAmount(c)-recovered(c))} outstanding`,amt:paidAmount(c)-recovered(c),score:(paidAmount(c)-recovered(c))});
  });
  return A.sort((a,b)=>b.score-a.score);
}


export function groupBy(key,filter){ const m={}; S.cases.filter(filter||(()=>true)).forEach(c=>{ const k=key(c); m[k]=m[k]||{k,n:0,claimed:0,exp:0}; m[k].n++; m[k].claimed+=c.claimed; m[k].exp+=exposure(c).v; }); return Object.values(m).sort((a,b)=>b.exp-a.exp); }

let seeded=false;
export function initMact(){ if(seeded) return; seeded=true; seed(); seedLA(); }