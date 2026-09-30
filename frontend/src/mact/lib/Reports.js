import { TODAY, MODEL, CONV, R, isDeath, fracStr, dedRate } from '../data/rules.js';
import { LAW, STAT, STAGES, CORPUS, HUBS, NODAL, DELEGATION, hubOf, approver, DOCS } from '../data/masters.js';
import { esc, INR, L, D, fd, days, addDays, pct, hash } from './helpers.js';
import { S, byId, open, log, persist } from '../store.js';
import { scenarios, findings, docsFor, docStats, exposure, paidAmount, recovered, doOffer, awardTotal, insurerAwardTotal, interestTo, surveyorOf, pending, quantum } from './engine.js';
import { SITTINGS, sitting } from '../data/lokadalat.js';
import { laScore, laBand, laApportion, sitStats } from './lokadalat.js';

export const REPORTS = {
 R1:['Portfolio exposure summary',()=>{ const g=[['Pre-award (00–11)',c=>c.stage<=11],['Award stage (12–13)',c=>c.stage>=12&&c.stage<=13],['Paid / deposited (14)',c=>c.stage===14],['Recovery (15)',c=>c.stage===15],['Closed (16)',c=>c.stage===16]]; return {cols:['Segment','Cases','Claimed','Reserve','Expected / actual','Paid'],rows:g.map(([n,f])=>{const L2=fc().filter(f); return [n,L2.length,L2.reduce((s,c)=>s+c.claimed,0),L2.reduce((s,c)=>s+c.reserve,0),L2.reduce((s,c)=>s+exposure(c).v,0),L2.reduce((s,c)=>s+paidAmount(c),0)];}),money:[2,3,4,5],chart:4}; }],
 R2:['Pendency ageing',()=>{ const b=[['0–6 months',0,183],['6–12 months',183,365],['1–2 years',365,730],['2–3 years',730,1095],['3+ years',1095,1e9]]; return {cols:['Age from petition','Open cases','Claimed','Expected','Interest accrued'],rows:b.map(([n,a,z])=>{const L2=fc().filter(c=>open(c)&&days(c.filed)>=a&&days(c.filed)<z); return [n,L2.length,L2.reduce((s,c)=>s+c.claimed,0),L2.reduce((s,c)=>s+exposure(c).v,0),L2.reduce((s,c)=>s+(c.payment?0:interestTo(exposure(c).v,c.filed)),0)];}),money:[2,3,4],chart:1}; }],
 R3:['Stage-wise pipeline',()=>({cols:['Stage','Owner','SLA','Cases','Expected'],rows:STAGES.map((s,i)=>{const L2=fc().filter(c=>c.stage===i); return [String(i).padStart(2,'0')+' · '+s.n,s.own,s.sla,L2.length,L2.reduce((a,c)=>a+exposure(c).v,0)];}),money:[4],chart:3})],
 R4:['State & district exposure',()=>({cols:['District','State','Cases','Claimed','Expected','Expected / claimed'],rows:Object.values(fc().reduce((m,c)=>{const k=c.district;m[k]=m[k]||[k,c.state,0,0,0,''];m[k][2]++;m[k][3]+=c.claimed;m[k][4]+=exposure(c).v;return m;},{})).map(r=>(r[5]=Math.round(r[4]/r[3]*100)+'%',r)).sort((a,b)=>b[4]-a[4]),money:[3,4],chart:4})],
 R5:['SLA compliance',()=>({cols:['Case','WS due','WS status','DAR received','Form XI offer due','Form XI offer status','Docs collected'],rows:fc().filter(open).map(c=>{const ws=c.noticeOn?addDays(c.noticeOn,R.wsDays):null, dd=c.darOn?addDays(c.darOn,R.doOfferDays):null; return [c.id,ws?fd(ws):'—',c.stage>=8?'Filed':ws&&days(TODAY,ws)<0?'Overdue':'Open',c.darOn?fd(c.darOn):'—',dd?fd(dd):'—',c.stage>=7||c.settle?'Made':dd&&days(TODAY,dd)<0?'Missed':dd?'Open':'—',Math.round(docStats(c).p*100)+'%'];})})],
 R6:['Document collection by source',()=>{ const m={}; fc().forEach(c=>docsFor(c).filter(d=>d.st!=='Not due').forEach(d=>{m[d.src]=m[d.src]||[d.src,d.ch,0,0,0];m[d.src][2]++; if(d.st==='Received')m[d.src][3]++; else m[d.src][4]++;})); return {cols:['Source','Channel','Documents','Received','Pending','Auto-collection rate'],rows:Object.values(m).map(r=>r.concat([Math.round(r[3]/r[2]*100)+'%'])).sort((a,b)=>b[2]-a[2]),chart:3}; }],
 R7:['Reserve adequacy',()=>({cols:['Case','Stage','Reserve','Expected','Variance','Recommendation'],rows:fc().filter(c=>open(c)&&c.stage<14).map(c=>{const e=exposure(c).v, v=c.reserve?(c.reserve-e)/e:null; return [c.id,STAGES[c.stage].n,c.reserve,e,v==null?'—':(v>0?'+':'')+Math.round(v*100)+'%',!c.reserve?'Set initial reserve':v<-.1?'Increase reserve':v>.2?'Release excess':'Hold'];}),money:[2,3]})],
 R8:['Settlement & Lok Adalat performance',()=>({cols:['Case','Status','Claimed','Form XI offer','Demand','Settled','Settled / claimed'],rows:fc().filter(c=>c.settle).map(c=>[c.id,c.settle.status,c.claimed,c.settle.offer||doOffer(c),c.settle.demand||'—',c.settle.settled||'—',c.settle.settled?Math.round(c.settle.settled/c.claimed*100)+'%':'—']),money:[2,3,4,5]})],
 R9:['Award vs insurer vs AI estimate',()=>({cols:['Case','Award','Insurer position','Difference','Award / claimed','Interest rate'],rows:fc().filter(c=>c.award).map(c=>[c.id,awardTotal(c),insurerAwardTotal(c),awardTotal(c)-insurerAwardTotal(c),Math.round(awardTotal(c)/c.claimed*100)+'%',c.award.interest+'%']),money:[1,2,3],chart:1})],
 R10:['Appeal register',()=>({cols:['Case','Award date','Limitation','Days left','Issues (strong)','Proposal','Status'],rows:fc().filter(c=>c.award).map(c=>{const lim=addDays(c.award.date,R.appealDays); return [c.id,fd(c.award.date),fd(lim),Math.max(0,days(TODAY,lim)),c.award.issues.length+' ('+c.award.issues.filter(x=>x.s==='Strong').length+')',c.award.decision,c.award.decided?'Decided':'Pending'];})})],
 R11:['Recovery register',()=>({cols:['Case','Basis','Against','Paid','Recovered','Outstanding'],rows:fc().filter(c=>c.recovery).map(c=>[c.id,c.recovery.basis,c.recovery.against,c.recovery.recovered?paidAmount(c):0,recovered(c),c.recovery.recovered?paidAmount(c)-recovered(c):0]),money:[3,4,5]})],
 R12:['Interest accrual',()=>({cols:['Case','Filed','Expected principal','Accrued to date','Accrual per month','Rate'],rows:fc().filter(c=>open(c)&&!c.payment).map(c=>{const e=c.award?awardTotal(c):exposure(c).v, r=c.award?c.award.interest:R.interest; return [c.id,fd(c.filed),e,interestTo(e,c.filed,TODAY,r),e*r/100/12,r+'%'];}).sort((a,b)=>b[3]-a[3]),money:[2,3,4],chart:3})],
 R13:['Advocate performance',()=>({cols:['Advocate','Cases','Open','Expected exposure','Hearings · 30 days','Avg age (months)'],rows:Object.values(fc().reduce((m,c)=>{const k=c.advocate;m[k]=m[k]||{k,n:0,o:0,e:0,h:0,a:0};m[k].n++; if(open(c)){m[k].o++;m[k].e+=exposure(c).v;m[k].a+=days(c.filed);} if(c.next&&days(TODAY,D(c.next))>=0&&days(TODAY,D(c.next))<=30)m[k].h++; return m;},{})).map(x=>[x.k,x.n,x.o,x.e,x.h,x.o?Math.round(x.a/x.o/30.4):'—']).sort((a,b)=>b[3]-a[3]),money:[3],chart:3})],
 R14:['Integrity flags',()=>({cols:['Case','Severity','Flag','Evidence','Stage'],rows:fc().flatMap(c=>(c.flags||[]).map(f=>[c.id,f[0]==='high'?'High':f[0]==='med'?'Medium':'Low',f[1],f[2],STAGES[c.stage].n]))})],
 R15:['AI governance',()=>{ const m={}; fc().forEach(c=>findings(c).forEach(f=>{m[f.engine]=m[f.engine]||[f.engine,0,0,0,0,0];m[f.engine][1]++;const d=S.decisions[f.id]; if(!d)m[f.engine][5]++; else if(d.d==='accept')m[f.engine][2]++; else if(d.d==='modify')m[f.engine][3]++; else m[f.engine][4]++;})); return {cols:['Engine','Findings','Accepted','Modified','Rejected','Pending','Acceptance rate'],rows:Object.values(m).map(r=>r.concat([r[1]-r[5]?Math.round(r[2]/(r[1]-r[5])*100)+'%':'—'])),chart:1}; }],
 R16:['Vehicle & accident type',()=>({cols:['Vehicle category','Accident type','Cases','Claimed','Expected'],rows:Object.values(fc().reduce((m,c)=>{const k=c.vehCat+'|'+c.accType;m[k]=m[k]||[c.vehCat,c.accType,0,0,0];m[k][2]++;m[k][3]+=c.claimed;m[k][4]+=exposure(c).v;return m;},{})).sort((a,b)=>b[4]-a[4]),money:[3,4],chart:4})],
 R18:['TP hub pendency',()=>({cols:['TP hub','Type','Region','Cases','Open','Expected','Form XI due · 30 days','Hearings · 30 days'],rows:Object.values(fc().reduce((m,c)=>{const h=hubOf(c);m[h.name]=m[h.name]||[h.name,h.type,h.region,0,0,0,0,0];const r=m[h.name];r[3]++; if(open(c)){r[4]++;r[5]+=exposure(c).v;} if(c.darOn&&c.stage<=7&&!c.settle){const l=days(TODAY,addDays(c.darOn,R.doOfferDays)); if(l>=0&&l<=30) r[6]++;} if(c.next&&days(TODAY,D(c.next))>=0&&days(TODAY,D(c.next))<=30) r[7]++; return m;},{})).sort((a,b)=>b[5]-a[5]),money:[5],chart:5})],
 R19:['DAR, surveyor & Form XI compliance',()=>({cols:['Case','TP hub','DAR received','Surveyor due','Surveyor outcome','Form XI due','Form XI filed','Deposit after settlement'],rows:fc().filter(c=>c.darOn||c.settle).map(c=>{const sv=surveyorOf(c), due=c.darOn?addDays(c.darOn,R.doOfferDays):null, fx=c.settle&&c.settle.offerOn; return [c.id,hubOf(c).name,c.darOn?fd(c.darOn):'—',sv.due?fd(sv.due):'—',sv.verdict||sv.status,due?fd(due):'—',fx?fd(fx)+(due&&D(fx)<=due?' · on time':' · late'):(due&&days(TODAY,due)<0?'Missed':'Open'),c.settle&&c.settle.settledOn?(c.payment?'Deposited '+fd(c.payment.on):'Due '+fd(addDays(c.settle.settledOn,R.settleDepositDays))):'—'];})})],
 R17:['Hearing diary · 30 days',()=>({cols:['Date','Case','Tribunal','Purpose','Advocate'],rows:fc().filter(c=>c.next&&days(TODAY,D(c.next))>=0&&days(TODAY,D(c.next))<=30).sort((a,b)=>D(a.next)-D(b.next)).map(c=>[fd(c.next),c.id,c.court,c.purpose,c.advocate])})]
};
export const fc = () => S.cases.filter(c=>S.stateFilter==='All'||c.state===S.stateFilter);

REPORTS.R20 = ['Lok Adalat sitting performance', () => ({
  cols: ['Sitting', 'Date', 'Type', 'Listed', 'Settled', 'Settlement rate', 'Claimed (settled)', 'Settled amount', 'Settled / claimed', 'Saved vs defending'],
  rows: SITTINGS.slice().sort((a, b) => D(a.date) - D(b.date)).map((st) => {
    if (st.agg) {
      const a = st.agg;
      return [st.name + ' (all hubs, sample)', fd(st.date), st.type, a.listed, a.settled, Math.round(a.settled / a.listed * 100) + '%', a.claimed, a.settledAmt, Math.round(a.settledAmt / a.claimed * 100) + '%', a.est - a.settledAmt];
    }
    const t = sitStats(st);
    return [st.name, fd(st.date) + (st.tentative ? ' (tentative)' : ''), st.type, t.listed, t.settled, t.listed ? Math.round(t.settled / t.listed * 100) + '%' : '—', t.claimedSet, t.setAmt, t.claimedSet ? Math.round(t.setAmt / t.claimedSet * 100) + '%' : '—', t.sav];
  }),
  money: [6, 7, 9],
})];

REPORTS.R21 = ['Lok Adalat pipeline by TP hub', () => ({
  cols: ['TP hub', 'Fit, not listed', 'Listed', 'In negotiation', 'Mandate approved', 'Settled', 'Returned', 'Target value (open)', 'Saving at target'],
  rows: Object.values(fc().reduce((m, c) => {
    const h = hubOf(c).name, la = S.la[c.id], sc = laScore(c), b = laBand(c);
    m[h] = m[h] || [h, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = m[h];
    if (!la && sc.score >= 70) r[1]++;
    if (la) {
      if (la.outcome) r[5]++;
      else if (la.returned) r[6]++;
      else {
        r[2]++;
        if (la.rounds.length) r[3]++;
        if (la.mandate && la.mandate.status === 'Approved') r[4]++;
        if (b) { r[7] += b.target; r[8] += b.defend - b.target; }
      }
    }
    return m;
  }, {})).filter((r) => r.slice(1, 7).some((v) => v)).sort((a, b) => b[7] - a[7]),
  money: [7, 8], chart: 7,
})];

REPORTS.R22 = ['Lok Adalat award payment compliance', () => ({
  cols: ['Case', 'Sitting', 'Award no.', 'Amount', 'Due', 'Paid on', 'UTR', 'Minors’ FD', 'Status'],
  rows: fc().filter((c) => S.la[c.id] && S.la[c.id].outcome).map((c) => {
    const x = S.la[c.id], due = addDays(x.outcome.date, R.settleDepositDays);
    return [c.id, sitting(x.sitting).name, x.outcome.award, x.outcome.amt, fd(due), c.payment ? fd(c.payment.on) : '—', c.payment ? c.payment.utr : '—',
      laApportion(c, x.outcome.amt).filter((r) => /Fixed deposit/.test(r[2])).reduce((a, r) => a + r[1], 0),
      c.payment ? (D(c.payment.on) <= due ? 'On time' : 'Late') : days(TODAY, due) < 0 ? 'Overdue' : 'Open'];
  }),
  money: [3, 7],
})];