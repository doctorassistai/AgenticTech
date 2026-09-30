import { S } from '../store.js';
import { INR, L } from './helpers.js';
import { exposure, groupBy } from './engine.js';

export const QA=[
 {q:'Cases where policy breach is suspected',f:()=>S.cases.filter(c=>(c.coverage||[]).some(r=>r[3]==='bad'||r[3]==='warn')).map(c=>[c.id,c.victim.name,(c.coverage.filter(r=>r[3]!=='ok').map(r=>r[0]+': '+r[1]).join('; ')),L(exposure(c).v)]),cols:['Case','Victim','Breach indicator','Exposure']},
 {q:'Which districts carry the highest exposure?',f:()=>groupBy(c=>c.district+', '+c.state).map(g=>[g.k,g.n,L(g.claimed),L(g.exp)]),cols:['District','Cases','Claimed','Expected']},
 {q:'Which hospitals appear most often?',f:()=>{ const m={}; S.cases.forEach(c=>(m[c.hospital]=m[c.hospital]||[]).push(c.id)); return Object.entries(m).sort((a,b)=>b[1].length-a[1].length).map(([h,ids])=>[h,ids.length,ids.join(', '),'']); },cols:['Hospital','Cases','Case IDs','']},
 {q:'What share of cases have income disputes?',f:()=>{ const r=S.cases.filter(c=>c.income&&c.income.range&&c.income.claimed&&c.income.claimed>c.income.range[1]*1.08); return r.map(c=>[c.id,INR(c.income.claimed),INR(c.income.range[0])+'–'+INR(c.income.range[1]),Math.round((c.income.claimed/c.income.range[1]-1)*100)+'% above']).concat([['Share of portfolio',r.length+' of '+S.cases.length,'',Math.round(r.length/S.cases.length*100)+'%']]); },cols:['Case','Claimed','Evidence range','Gap']},
 {q:'Which advocates hold the largest pending exposure?',f:()=>groupBy(c=>c.advocate,open).map(g=>[g.k,g.n,L(g.exp),'']),cols:['Advocate','Open cases','Expected','']},
 {q:'Which accident categories cost the most?',f:()=>groupBy(c=>c.vehCat).map(g=>[g.k,g.n,L(g.claimed),L(g.exp)]),cols:['Vehicle category','Cases','Claimed','Expected'],tags:['vehicle','category','accident']}
];


// Free-text → question index. Scores word overlap with each question's text + optional tags. -1 = no match.
const STOP = new Set(['which','what','where','have','most','share','cases','case','often','that','with','from','hold','largest','highest','carry','pending','appear','costs','cost']);
const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
export function matchQuestion(text) {
  const t = words(text);
  let best = -1, bestScore = 0;
  QA.forEach((q, i) => {
    const kw = words(q.q + ' ' + (q.tags || []).join(' '));
    const score = t.filter((w) => kw.some((k) => same(w, k))).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}