import { TODAY } from '../data/rules.js';
/* ---------- Helpers ---------- */
export const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const INR = n => n==null||isNaN(n)?'—':'₹'+Math.round(n).toLocaleString('en-IN');
export const L = n => { if(n==null||isNaN(n)) return '—'; const a=Math.abs(n), s=n<0?'−':''; if(a>=1e7) return s+'₹'+(a/1e7).toFixed(2)+' Cr'; if(a>=1e5) return s+'₹'+(a/1e5).toFixed(1)+' L'; return s+'₹'+Math.round(a).toLocaleString('en-IN'); };
export const D = s => s?new Date(s+'T00:00:00'):null;
export const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const fd = s => { const d=typeof s==='string'?D(s):s; return d?String(d.getDate()).padStart(2,'0')+' '+MON[d.getMonth()]+' '+d.getFullYear():'—'; };
export const days = (a,b) => Math.round(((b||TODAY)-(typeof a==='string'?D(a):a))/864e5);
export const addDays = (s,n) => { const d=D(s); d.setDate(d.getDate()+n); return d; };
export const pct = x => Math.round(x*100)+'%';
export const hash = s => { let h=0; for(const c of s) h=(h*31+c.charCodeAt(0))>>>0; return h; };