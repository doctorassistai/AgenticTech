import { R, MODEL } from './data/rules.js';

// Single shared mutable state, exactly as in the original console.
// docs: uploaded documents of real (database) cases, keyed by case id: S.docs[caseId] = [...]
export const S = {view:'dashboard',caseId:null,tab:'overview',report:'R1',stateFilter:'All',decisions:{},audit:{},edit:{},uploads:{},docs:{},activity:[],syncIdx:0,qa:null,offers:{},la:{},laTab:'overview',laSit:null};
export const persist = { get(k){try{return JSON.parse(localStorage.getItem('mact.'+k))}catch(e){return null}}, set(k,v){try{localStorage.setItem('mact.'+k,JSON.stringify(v))}catch(e){}} };
export const byId = id => S.cases.find(c=>c.id===id);
export const open = c => c.stage<16;
// Cases registered in the database carry is_sample === false. The 17 seeded samples (local demo data) do not.
export const isReal = c => !!c && c.is_sample === false;
export function log(caseId, action, detail, actor){ const e={at:new Date().toISOString().slice(0,16).replace('T',' '),actor:actor||'Admin (you)',action,detail,model:MODEL.reason,rule:R.version}; (S.audit[caseId]=S.audit[caseId]||[]).unshift(e); S.activity.unshift({at:e.at,caseId,text:action+' — '+detail}); }