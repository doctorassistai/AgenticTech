import { TODAY, MODEL, CONV, R, isDeath, fracStr, dedRate } from '../data/rules.js';
import { LAW, STAT, STAGES, CORPUS, HUBS, NODAL, DELEGATION, hubOf, approver, DOCS } from '../data/masters.js';
import { esc, INR, L, D, fd, days, addDays, pct, hash } from './helpers.js';
import { S, byId, open, log, persist } from '../store.js';
import { scenarios, findings, docsFor, docStats, exposure, paidAmount, recovered, doOffer, awardTotal, insurerAwardTotal, interestTo, surveyorOf, pending, quantum } from './engine.js';

export function graphSVG(c){
  const cov=k=>{ const r=(c.coverage||[]).find(r=>r[0].toLowerCase().includes(k)); return r?(r[3]==='ok'?'ok':'warn'):'none'; };
  const dst=n=>{ const x=docsFor(c).find(d=>d.name.startsWith(n)); return !x?'none':x.st==='Received'?'ok':'none'; };
  const inc=c.income&&c.income.range?(c.income.claimed>c.income.range[1]*1.08?'warn':'ok'):'none';
  const T0={l:'Accident · '+fd(c.accident),ch:[
    {l:'Vehicle '+c.vehicle.reg,ch:[{l:'RC',s:dst('Registration')},{l:'Policy '+c.policy.no,s:cov('policy in force')},...(c.vehicle.commercial?[{l:'Permit',s:cov('permit')==='none'?dst('Permit'):cov('permit')},{l:'Fitness',s:dst('Fitness')}]:[])]},
    {l:'Driver '+(c.driver.name||'—'),ch:[{l:'DL '+(c.driver.cls||''),s:cov('licence')}]},
    {l:'Victim '+c.victim.name.split(' (')[0],ch:[{l:'Age '+c.victim.age,s:'ok'},{l:'Income',s:inc},{l:c.type==='Death'?'Post-mortem':'Injuries',s:c.type==='Death'?dst('Post-mortem'):(c.med?(c.med.disClaim>c.med.disAI+10?'warn':'ok'):'none')},...(c.type==='Death'?[{l:'Dependants ('+(c.deps||[]).length+')',s:(c.deps||[]).some(d=>d[2]==='?')?'warn':(c.deps||[]).length?'ok':'none'}]:[])]},
    {l:'Evidence',ch:[{l:'FIR',s:(c.conflicts||[]).some(x=>x[0].startsWith('FIR'))?'warn':dst('FIR')},{l:'DAR',s:dst('Detailed')},{l:'MVI',s:dst('Mechanical')},{l:'Medical',s:dst('MLC')}]},
    {l:'Court '+c.mvc,ch:[{l:'Stage: '+c.courtStage,s:'ok'},{l:c.award?'Award '+L(awardTotal(c)):'Award pending',s:c.award?'ok':'none'}]}
  ]};
  const rowH=30, leaves=T0.ch.reduce((s,x)=>s+x.ch.length,0), H=leaves*rowH+30, W=820; let y=20, out='';
  const mark=(x,yy,s)=>s==='ok'?`<circle cx="${x}" cy="${yy}" r="5" fill="var(--ink)"/>`:s==='warn'?`<circle cx="${x}" cy="${yy}" r="5" fill="var(--bg)" stroke="var(--ink)"/><path d="M${x} ${yy-5} A5 5 0 0 1 ${x} ${yy+5} Z" fill="var(--ink)"/>`:`<circle cx="${x}" cy="${yy}" r="5" fill="var(--bg)" stroke="var(--ink)"/>`;
  const l1=[];
  T0.ch.forEach(n=>{ const ys=n.ch.map(()=>{const v=y; y+=rowH; return v;}); const my=(ys[0]+ys[ys.length-1])/2; l1.push(my);
    n.ch.forEach((k,i)=>{ out+=`<path d="M${420} ${my} H${470} V${ys[i]} H${520}" fill="none" stroke="var(--line2)"/>${mark(530,ys[i],k.s)}<text x="545" y="${ys[i]+4}" font-size="12.5">${esc(k.l)}</text>`; });
    out+=`<rect x="250" y="${my-13}" width="170" height="26" fill="var(--bg)" stroke="var(--ink)"/><text x="260" y="${my+4}" font-size="12">${esc(n.l.length>24?n.l.slice(0,23)+'…':n.l)}</text>`; });
  const ry=(l1[0]+l1[l1.length-1])/2;
  l1.forEach(v=>out=`<path d="M${196} ${ry} H${220} V${v} H${250}" fill="none" stroke="var(--line2)"/>`+out);
  out+=`<rect x="16" y="${ry-16}" width="180" height="32" fill="var(--ink)"/><text x="28" y="${ry+4}" font-size="12.5" style="fill:var(--bg)">${esc(T0.l)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Evidence graph">${out}</svg>`;
}


export function similar(c){ const inc=c.income&&c.income.range?(c.income.range[0]+c.income.range[1])/2:(c.income&&c.income.claimed)||20000;
 return CORPUS.map(x=>{ let s=100; if(x.type!==c.type) s-=45; s-=Math.min(25,Math.abs(x.age-c.victim.age)*1.5); if(x.st!==c.state) s-=12; s-=Math.min(20,Math.abs(x.inc-inc)/inc*30); if(c.victim.occ.toLowerCase().includes(x.occ)) s+=8; return Object.assign({score:Math.max(5,Math.min(99,Math.round(s)))},x); }).sort((a,b)=>b.score-a.score).slice(0,5); }


export function draft(c,k){
  const s=scenarios(c), F=findings(c), cite=k2=>LAW[k2]?`${LAW[k2].t}, ${LAW[k2].c}`:'';
  if(k==='ws'){ let p=1; const P=t=>`${p++}. ${t}\n\n`;
   if(c.type==='No-fault') return `BEFORE THE ${c.court.toUpperCase()}\n${c.mvc}\n\nREPLY ON BEHALF OF THE RESPONDENT INSURER (CLAIM UNDER SECTION 164)\n\n`+P(`The Respondent admits policy ${c.policy.no} for ${c.vehicle.reg}, in force on ${fd(c.accident)}.`)+P(`Liability under s.164 is limited to the fixed sum of ${INR(R.nofault[c.nfKind])} for ${String(c.nfKind).toLowerCase()}. The Respondent has offered this amount in Form XI.`)+P('The claimants are put to proof that no petition under s.166 is pending for the same accident.')+`\nAdvocate for Respondent insurer\n${c.advocate}`;
   return `BEFORE THE ${c.court.toUpperCase()}\n${c.mvc}\n\n${c.victim.name} & others … Petitioners\nversus\nOwner / Driver of ${c.vehicle.reg} & Insurer … Respondents\n\nWRITTEN STATEMENT ON BEHALF OF THE RESPONDENT INSURER\n\n`+
   P(`The Respondent insurer admits issuance of policy ${c.policy.no} for ${c.vehicle.reg} for the period ${fd(c.policy.from)} to ${fd(c.policy.to)}, subject to its terms, conditions and the limits under s.147 of the Motor Vehicles Act, 1988.`)+
   (c.coverage||[]).filter(r=>r[3]!=='ok').map(r=>P(`Without prejudice, the Respondent invokes its defence under s.149(2): ${r[0].toLowerCase()} — ${r[1]} (${r[2]}).${r[4]?' Reliance is placed on '+r[4].map(cite).join('; ')+'.':''}`)).join('')+
   (c.liab&&c.liab.disp.length?P(`The manner of the accident is disputed. ${c.liab.disp.join('; ')}. The Petitioners are put to strict proof. On contributory negligence, reliance is placed on ${cite('jhaveri')}.`):'')+
   (c.income&&c.income.range&&c.income.claimed?P(`The income of ${INR(c.income.claimed)} per month is denied. Documentary evidence (${c.income.sources.map(x=>x[0]).join('; ')}) supports ${INR(c.income.range[0])}–${INR(c.income.range[1])} per month.`):'')+
   (c.med&&c.med.disClaim>c.med.disAI?P(`The disability claimed (${c.med.disClaim}%) is denied. Functional disability must be assessed with reference to earning capacity: ${cite('rajkumar')}.`):'')+
   ((c.deps||[]).some(d=>d[2]==='?')?P(`Dependency of ${(c.deps||[]).filter(d=>d[2]==='?').map(d=>d[0].toLowerCase()).join(', ')} is denied for want of proof.`):'')+
   P(`Compensation, if any, must be computed under ${cite('sarla')} and ${cite('pranay')}${c.type==='Death'?`, with consortium under ${cite('magma')}`:''}. The claim of ${L(c.claimed)} is excessive.`)+
   P('The Respondent craves leave to file additional documents and to cross-examine the Petitioners’ witnesses.')+`\nPlace:\nDate:\n\nAdvocate for Respondent insurer\n${c.advocate}`; }
  if(k==='cross'){ const Q=[]; if(c.income&&c.income.range&&c.income.claimed&&c.income.claimed>c.income.range[1]) Q.push('INCOME',`You state the deceased/injured earned ${INR(c.income.claimed)} per month. Is it correct that ${c.income.sources.filter(s=>s[1]).map(s=>s[0]+' shows '+INR(s[1])).join('; ')}?`,'On what date was the employer certificate issued, and who asked for it?','Can you produce payslips for any month before the accident?');
   (c.conflicts||[]).forEach(x=>Q.push('CONTRADICTION',`${x[0]}. Is it correct that ${x[1].charAt(0).toLowerCase()+x[1].slice(1)}?`));
   if(c.med&&c.med.disClaim>c.med.disAI) Q.push('DISABILITY','Did you return to your work after the accident? On what date?','Is it correct that no doctor recorded this condition in the discharge summary?','When and at whose request was the disability certificate issued?');
   (c.deps||[]).filter(d=>d[2]==='?').forEach(d=>Q.push('DEPENDENCY',`Is it correct that the ${d[0].toLowerCase()} lived in a separate household or had independent income?`));
   (c.flags||[]).filter(f=>f[0]==='high').forEach(f=>Q.push('VERIFICATION',`Regarding: ${f[1]} — ${f[2]}. Can you explain?`));
   let out=`CROSS-EXAMINATION NOTES — ${c.mvc}\nWitness: PW1 (claimant) · Prepared from ${docStats(c).r} documents\n\n`, n=1; Q.forEach(x=>{ if(x===x.toUpperCase()) out+=`\n${x}\n`; else out+=`${n++}. ${x}\n`; }); return out+(n===1?'No material contradictions found.':''); }
  if(k==='req'){ const miss=docsFor(c).filter(d=>!['Received','Not due'].includes(d.st)); const lm=c.liab?c.liab.miss:[];
   return `DOCUMENT REQUISITION — ${c.mvc}\n\nDocuments to be called for / summoned:\n\n`+miss.map((d,i)=>`${i+1}. ${d.name} — from ${d.src} (status: ${d.st})`).join('\n')+(lm.length?`\n\nEvidence gaps identified by the Liability Engine:\n`+lm.map((m,i)=>`${i+1}. ${m}`).join('\n'):'')+(!miss.length&&!lm.length?'All documents received.':''); }
  if(k==='offer'){ const o=doOffer(c); if(!o||(c.type!=='No-fault'&&!(c.income&&c.income.range))) return 'Form XI cannot be drafted until income and medical evidence is extracted and quantum is computed.'; const sv=surveyorOf(c), h=hubOf(c), ins=s?s.insurer:null;
   const reasons=c.type==='No-fault'?[`Claim is under s.164 of the MV Act; compensation is the fixed statutory amount of ${INR(o)} for ${String(c.nfKind).toLowerCase()}.`,'No proof of negligence or income is required and none is disputed.','Policy was in force on the date of accident and the vehicle, driver and victim particulars in the DAR are verified.']:
    [`Income taken at ${INR(c.income.range[0])} per month, the lower bound supported by ${c.income.sources.filter(x=>x[1]).map(x=>x[0]).join('; ')||'documents on record'}.`,
     `Future prospects ${pct(ins.f)} and multiplier ${ins.mult} for age ${c.victim.age} under ${cite('pranay')} and ${cite('sarla')}.`,
     ...(isDeath(c)?[`Personal deduction ${fracStr(ins.ded)} for ${c.q.depIns} dependant(s); consortium for ${c.q.consIns} person(s) under ${cite('magma')}.`]:[`Functional disability ${c.q.disIns}% on the medical record, applying ${cite('rajkumar')}.`]),
     ...(ins.contrib?[`Contributory negligence of ${ins.contrib}% on the DAR, site plan and surveyor report.`]:[]),
     `Medical expenses allowed as verified: ${INR(c.q.medVer||c.q.medClaim)}.`,
     `An additional margin of 5% is included to allow early settlement.`];
   return `FORM XI\nOFFER OF SETTLEMENT BY THE DESIGNATED OFFICER OF THE INSURANCE COMPANY\n(Rule 23, Motor Vehicles (Amendment) Rules, 2022 · procedure under ${cite('gohar')})\n[Sample layout — align field order with the notified Form XI]\n\nTo\nThe Claims Tribunal, ${c.court}\n\nPART A — PARTICULARS\n1. Case / petition no.: ${c.mvc}  (CNR ${c.cnr})\n2. DAR received on: ${c.darOn?fd(c.darOn):'—'}\n3. Date and place of accident: ${fd(c.accident)}, ${c.place}\n4. Offending vehicle: ${c.vehicle.reg} (${c.vehicle.cls})\n5. Policy: ${c.policy.no}, valid ${fd(c.policy.from)} to ${fd(c.policy.to)}\n6. Driver: ${c.driver.name}, DL ${c.driver.dl} (${c.driver.cls})\n7. Victim: ${c.victim.name}, age ${c.victim.age}, ${c.victim.occ}\n8. Claimant(s): ${(c.deps||[]).filter(d=>d[2]!=='?').map(d=>d[0]+' ('+d[1]+')').join(', ')||'Injured claimant'}\n\nPART B — VERIFICATION OF DAR\n9. Surveyor: ${sv.name||'—'}; report dated ${sv.on?fd(sv.on):'—'}\n10. Outcome: ${sv.verdict||sv.status}\n\nPART C — COMPUTATION\n`+(ins?ins.heads.map((x,i)=>`${11+i}. ${x[0]}: ${INR(x[1])}  [${x[2]}]`).join('\n'):'')+(ins&&ins.contrib?`\n    Less contributory negligence ${ins.contrib}%: −${INR(ins.cut)}`:'')+`\n    Amount offered in full and final settlement: ${INR(o)}\n\nPART D — REASONS WHY THE OFFER IS JUST AND REASONABLE\n`+reasons.map((r,i)=>`(${String.fromCharCode(97+i)}) ${r}`).join('\n')+`\n\nPART E — UNDERTAKING\nOn acceptance, the amount will be deposited with the Tribunal within ${R.settleDepositDays} days of the record of settlement. If the offer is not accepted, the claimant may proceed; the inquiry will then be limited to enhancement of compensation.\n\nDesignated Officer: ${c.officer}\n${h.name} (${h.type})\nCopy to: ${h.nodal}\nDate: ${fd(TODAY)}`; }
}