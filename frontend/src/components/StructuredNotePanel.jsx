import React, { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── SECTION ICON MAP ──────────────────────────────────────────────────── */
const SECTION_ICONS = {
  patient_demographics:        "👤",
  chief_complaint:             "🩺",
  presenting_complaints:       "🩺",
  history_of_present_illness:  "📖",
  past_medical_history:        "🗂️",
  past_surgical_history:       "🗂️",
  family_history:              "👪",
  social_history:              "🏠",
  allergies:                   "⚠️",
  triage_assessment:           "⚠️",
  primary_survey:              "🔍",
  airway:                      "💨",
  breathing:                   "🫁",
  circulation:                 "❤️",
  disability:                  "🧠",
  exposure:                    "🌡️",
  vital_signs:                 "📊",
  examination_findings:        "🩻",
  investigations:              "🔬",
  provisional_diagnosis:       "📋",
  diagnosis:                   "📋",
  assessment:                  "🧾",
  clinical_summary:            "📝",
  emergency_interventions:     "🚨",
  medications:                 "💊",
  treatment_plan:              "💊",
  treatment_plans:             "💊",
  proposed_treatment_plans:    "💊",
  treatment_goals:             "🎯",
  lifestyle_modifications:     "🥗",
  counselling_and_consent:     "🤝",
  follow_up_plan:              "📅",
  triage_category:             "🏷️",
};

const ICON_KEYWORDS = [
  [/treatment.*(plan|goal)/i, "💊"],
  [/goal/i,          "🎯"],
  [/procedure/i,     "🔪"],
  [/investigat/i,    "🔬"],
  [/medication/i,    "💊"],
  [/lifestyle/i,     "🥗"],
  [/follow.?up/i,    "📅"],
  [/allerg/i,        "⚠️"],
  [/vital/i,         "📊"],
  [/exam/i,          "🩻"],
  [/diagnos/i,       "📋"],
  [/assessment/i,    "🧾"],
  [/consent/i,       "🤝"],
  [/history/i,       "🗂️"],
  [/complaint/i,     "🩺"],
  [/triage/i,        "⚠️"],
  [/summary/i,       "📝"],
  [/intervention/i,  "🚨"],
];

function getSectionIcon(section) {
  if (SECTION_ICONS[section]) return SECTION_ICONS[section];
  for (const [pattern, icon] of ICON_KEYWORDS) {
    if (pattern.test(section)) return icon;
  }
  return "📄";
}

const isTreatmentPlanSection = (section) => /treatment.*plan/i.test(section);

/* Semantic triage colours — colour genuinely carries clinical meaning here,
   so unlike the rest of the palette this leans on real hue, not tint. */
const TRIAGE_COLORS = {
  green:  { bg: "#ECFDF5", text: "#065F46", border: "#10B981", dot: "#10B981" },
  yellow: { bg: "#FFFBEB", text: "#92400E", border: "#F59E0B", dot: "#F59E0B" },
  red:    { bg: "#FEF2F2", text: "#991B1B", border: "#EF4444", dot: "#EF4444" },
  blue:   { bg: "#EFF6FF", text: "#1E40AF", border: "#3B82F6", dot: "#3B82F6" },
};

/* ─── STYLES ──────────────────────────────────────────────────────────────── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

  .snp {
    --bg:        #F5F7F8;
    --surface:   #FFFFFF;
    --border:    #E3E7EB;
    --ink:       #171B21;
    --muted:     #6B7280;
    --faint:     #9CA3AF;
    --accent:    #0E7C66;
    --accent-ink:#065F46;
    --accent-soft:#E7F5F1;
    --amber:     #B45309;
    --amber-soft:#FEF3E2;
  }

  .snp * { box-sizing: border-box; margin: 0; padding: 0; }

  .snp {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    background: var(--bg);
    min-height: 100vh;
    padding: 32px 28px 60px;
    color: var(--ink);
  }

  /* ── TOP BAR ── */
  .snp-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 22px;
    flex-wrap: wrap;
    gap: 14px;
  }
  .snp-heading-block { display: flex; flex-direction: column; gap: 3px; }
  .snp-eyebrow {
    font-family: 'Inter', sans-serif;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .snp-heading {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 22px;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: -0.01em;
  }
  .snp-subline { font-size: 12px; color: var(--muted); margin-top: 1px; }

  .snp-topbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  /* ── BUTTONS ── */
  .snp-btn {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--ink); color: #ffffff;
    border: 1px solid var(--ink); border-radius: 9px;
    padding: 10px 18px;
    font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: transform 0.1s ease, background 0.15s ease;
  }
  .snp-btn:hover:not(:disabled) { background: #2A2F38; }
  .snp-btn:active:not(:disabled) { transform: translateY(1px); }
  .snp-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .snp-btn-outline {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--border); border-radius: 9px;
    padding: 10px 16px;
    font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease;
  }
  .snp-btn-outline:hover:not(:disabled) { border-color: var(--ink); background: #FAFAFA; }
  .snp-btn-outline:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ── DROPDOWN ── */
  .snp-dropdown-wrap { position: relative; }
  .snp-dropdown {
    position: absolute; top: calc(100% + 6px); right: 0;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    min-width: 230px; z-index: 100; overflow: hidden;
    box-shadow: 0 8px 24px rgba(20,20,20,0.10);
    animation: snp-dropdown-in 0.12s ease;
  }
  @keyframes snp-dropdown-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .snp-dropdown-item {
    display: flex; align-items: center; gap: 10px; width: 100%;
    background: none; border: none; padding: 11px 14px;
    font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; color: var(--ink);
    cursor: pointer; transition: background 0.1s; text-align: left;
  }
  .snp-dropdown-item:hover { background: #F5F7F8; }
  .snp-dropdown-divider { height: 1px; background: var(--border); }
  .snp-dropdown-note {
    padding: 9px 14px; font-size: 11px; color: var(--muted); background: #FAFBFC;
    border-top: 1px solid var(--border);
  }

  /* ── SPINNER ── */
  .snp-spinner {
    width: 13px; height: 13px; border: 1.5px solid rgba(255,255,255,0.3);
    border-top-color: #ffffff; border-radius: 50%; animation: snp-spin 0.65s linear infinite;
  }
  @keyframes snp-spin { to { transform: rotate(360deg); } }

  /* ── GRID ── */
  .snp-grid { display: flex; flex-direction: column; gap: 14px; }

  /* ── CARD ── */
  .snp-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    overflow: hidden; opacity: 0; animation: snp-up 0.3s ease forwards;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .snp-card:hover { box-shadow: 0 2px 10px rgba(20,20,20,0.04); }
  .snp-card.editing { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .snp-card.disabled { background: #FBFBFC; }
  .snp-card.disabled .snp-card-bd { opacity: 0.4; filter: grayscale(0.4); }

  .snp-card:nth-child(1)  { animation-delay: .03s }
  .snp-card:nth-child(2)  { animation-delay: .06s }
  .snp-card:nth-child(3)  { animation-delay: .09s }
  .snp-card:nth-child(4)  { animation-delay: .12s }
  .snp-card:nth-child(5)  { animation-delay: .15s }
  .snp-card:nth-child(6)  { animation-delay: .18s }
  .snp-card:nth-child(7)  { animation-delay: .21s }
  .snp-card:nth-child(8)  { animation-delay: .24s }
  .snp-card:nth-child(9)  { animation-delay: .27s }
  .snp-card:nth-child(10) { animation-delay: .30s }
  .snp-card:nth-child(11) { animation-delay: .33s }
  .snp-card:nth-child(12) { animation-delay: .36s }

  @keyframes snp-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  /* ── CARD HEADER ── */
  .snp-card-hd {
    display: flex; align-items: center; gap: 10px; padding: 13px 16px;
    background: #FAFBFC; border-bottom: 1px solid var(--border);
  }
  .snp-card-icon { font-size: 15px; line-height: 1; flex-shrink: 0; }
  .snp-card-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
    text-transform: capitalize; color: var(--ink); flex: 1;
  }
  .snp-excluded-tag {
    font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
    color: var(--faint); text-transform: uppercase;
    border: 1px solid var(--border); border-radius: 5px; padding: 2px 6px;
  }

  /* ── CARD ACTIONS ── */
  .snp-card-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .snp-icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 8px; border: 1px solid transparent;
    background: transparent; cursor: pointer; color: var(--muted); font-size: 12.5px;
    transition: all 0.12s ease; padding: 0;
  }
  .snp-icon-btn:hover        { border-color: var(--border); color: var(--ink); background: #F0F2F4; }
  .snp-icon-btn.save         { border-color: var(--accent); color: var(--accent-ink); background: var(--accent-soft); }
  .snp-icon-btn.save:hover   { background: #D9F0EA; }
  .snp-icon-btn.cancel       { color: var(--faint); }
  .snp-icon-btn.cancel:hover { border-color: var(--border); color: var(--ink); }

  /* ── ENABLE/DISABLE SWITCH ── */
  .snp-switch-wrap { display: inline-flex; align-items: center; gap: 6px; }
  .snp-switch-label { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--faint); }
  .snp-switch {
    position: relative; width: 32px; height: 18px; border-radius: 999px;
    background: #D7DBE0; border: none; cursor: pointer; flex-shrink: 0;
    transition: background 0.15s ease; padding: 0;
  }
  .snp-switch.on { background: var(--accent); }
  .snp-switch-knob {
    position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
    border-radius: 50%; background: #ffffff; transition: transform 0.15s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  }
  .snp-switch.on .snp-switch-knob { transform: translateX(14px); }

  /* ── CARD BODY ── */
  .snp-card-bd { padding: 16px; }

  /* ── PLAIN TEXT ── */
  .snp-text { font-size: 13.5px; font-weight: 400; color: var(--ink); line-height: 1.7; }

  /* ── SIMPLE BULLET LIST (primitives only) ── */
  .snp-bullets { display: flex; flex-direction: column; gap: 6px; }
  .snp-bullet { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; color: var(--ink); line-height: 1.6; }
  .snp-bullet-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0; margin-top: 8px; }

  /* ── KV TABLE (flat object, standalone) ── */
  .snp-kv-table { display: flex; flex-direction: column; }
  .snp-kv-row {
    display: grid; grid-template-columns: 36% 1fr; gap: 10px; align-items: start;
    padding: 8px 0; border-bottom: 1px solid #F0F1F3;
  }
  .snp-kv-row:last-child  { border-bottom: none; padding-bottom: 0; }
  .snp-kv-row:first-child { padding-top: 0; }
  .snp-kv-key {
    font-size: 11px; font-weight: 500; letter-spacing: 0.02em; text-transform: capitalize;
    color: var(--muted); padding-top: 1px; line-height: 1.5;
  }
  .snp-kv-val { font-size: 13px; font-weight: 500; color: var(--ink); line-height: 1.55; word-break: break-word; }

  /* ── VITAL CHIP ── */
  .snp-chip {
    display: inline-flex; align-items: center; background: var(--accent-soft);
    border: 1px solid #BFE3D8; border-radius: 6px; padding: 2px 8px;
    font-family: 'Inter', monospace; font-size: 12px; color: var(--accent-ink); font-weight: 600;
  }

  /* ── ITEM LIST (arrays of objects — e.g. medications, investigations) ──
     This is the fix for items running together: each object becomes its
     own bordered card with a clear header field and a metadata row. ── */
  .snp-itemlist { display: flex; flex-direction: column; gap: 10px; }
  .snp-item-card {
    border: 1px solid var(--border); border-left: 3px solid var(--accent);
    border-radius: 10px; padding: 11px 13px; background: #FCFDFD;
  }
  .snp-item-index {
    font-size: 10px; font-weight: 700; color: var(--faint); letter-spacing: 0.04em;
    margin-right: 7px;
  }
  .snp-item-title { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .snp-item-meta { display: flex; flex-wrap: wrap; column-gap: 16px; row-gap: 5px; margin-top: 6px; }
  .snp-item-meta-pair { font-size: 12px; color: var(--ink); display: inline-flex; align-items: center; gap: 4px; }
  .snp-item-meta-key { color: var(--faint); font-weight: 500; }
  .snp-item-meta-key::after { content: ':'; }
  .snp-item-meta-val { color: var(--ink); font-weight: 600; }
  .snp-item-meta-block { flex-basis: 100%; margin-top: 4px; }

  /* ── NESTED SECTION ── */
  .snp-nested { display: flex; flex-direction: column; gap: 13px; }
  .snp-nested-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid var(--border);
  }

  /* ── TRIAGE BADGE ── */
  .snp-triage {
    display: inline-flex; align-items: center; gap: 10px; border-radius: 999px;
    padding: 9px 18px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; border-width: 1.5px; border-style: solid;
  }
  .snp-triage-dot { width: 7px; height: 7px; border-radius: 50%; animation: snp-pulse 1.8s ease-in-out infinite; }
  @keyframes snp-pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }

  /* ── EDIT TEXTAREA ── */
  .snp-edit-textarea {
    width: 100%; min-height: 110px; font-family: 'Inter', monospace; font-size: 12.5px;
    color: var(--ink); background: #FAFBFC; border: 1px solid var(--border); border-radius: 9px;
    padding: 11px 13px; resize: vertical; outline: none; line-height: 1.65; transition: border-color 0.12s;
  }
  .snp-edit-textarea:focus { border-color: var(--accent); background: #ffffff; }
  .snp-edit-hint { font-size: 11px; color: var(--faint); margin-top: 7px; line-height: 1.5; }

  /* ── EDIT BANNER ── */
  .snp-edit-banner {
    display: flex; align-items: center; gap: 10px; background: var(--accent-soft);
    border: 1px solid #BFE3D8; border-radius: 10px; padding: 11px 16px; margin-bottom: 16px;
    font-size: 12.5px; color: var(--accent-ink);
  }

  /* ── TOAST ── */
  .snp-toast {
    position: fixed; bottom: 24px; right: 24px; background: var(--ink); color: #ffffff;
    border-radius: 10px; padding: 11px 18px; font-size: 13px; font-weight: 500;
    font-family: 'Inter', sans-serif; z-index: 999; display: flex; align-items: center; gap: 9px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18); animation: snp-toast-in 0.2s ease;
  }
  @keyframes snp-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  /* ── EMPTY STATE ── */
  .snp-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 72px 24px; gap: 12px; background: var(--surface); border: 1px dashed var(--border); border-radius: 14px;
  }
  .snp-empty-icon { font-size: 34px; }
  .snp-empty-text { font-size: 13px; color: var(--muted); }

  /* ── TREATMENT PLAN ── */
  .tp-plan + .tp-plan { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
  .tp-detail-list { display: flex; flex-direction: column; gap: 0; }
  .tp-detail-row { display: flex; gap: 14px; padding: 9px 0; border-bottom: 1px solid #F0F1F3; align-items: flex-start; }
  .tp-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
  .tp-detail-label {
    flex: 0 0 140px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em;
    text-transform: uppercase; color: var(--muted); padding-top: 2px;
  }
  .tp-detail-value { flex: 1; font-size: 13.5px; font-weight: 400; color: var(--ink); line-height: 1.6; }

  .tp-edit-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
  .tp-edit-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); margin-bottom: 5px; }
  .tp-edit-input {
    width: 100%; height: 34px; font-family: 'Inter', sans-serif; font-size: 13px;
    color: var(--ink); background: #FAFBFC; border: 1px solid var(--border); border-radius: 8px;
    padding: 0 11px; outline: none;
  }
  .tp-edit-input:focus { border-color: var(--accent); background: #ffffff; }

  .tp-edit-plan-wrap { margin-bottom: 14px; }
  .tp-edit-plan-textarea {
    width: 100%; resize: vertical; font-family: 'Inter', monospace; font-size: 12.5px;
    color: var(--ink); background: #FAFBFC; border: 1px solid var(--border); border-radius: 9px;
    padding: 9px 11px; outline: none; line-height: 1.55; box-sizing: border-box;
  }
  .tp-edit-plan-textarea:focus { border-color: var(--accent); background: #ffffff; }
`;

/* ─── HELPERS ─────────────────────────────────────────────────────────────── */
const isVitalKey = (k) =>
  /pulse|bp|rr|spo2|heart_rate|respiratory_rate|oxygen_saturation|blood_pressure|temperature/i.test(k);

const isFlatObject = (obj) =>
  obj !== null &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.values(obj).every(
    (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );

/* Which key in an item object best serves as its visible header — e.g. the
   drug name inside a medication, or the test name inside an investigation.
   Falls back to the first primitive-valued key if nothing matches. */
const HEADER_KEY_PATTERN = /^(name|title|test|drug|medication|investigation|procedure|item)(_name)?$/i;

function pickHeaderEntry(entries) {
  const preferred = entries.find(
    ([k, v]) => HEADER_KEY_PATTERN.test(k) && (typeof v === "string" || typeof v === "number")
  );
  if (preferred) return preferred;
  const firstPrimitive = entries.find(([, v]) => typeof v === "string" || typeof v === "number");
  return firstPrimitive || entries[0];
}

/* ─── DOWNLOAD HELPERS ────────────────────────────────────────────────────── */
function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function noteToPlainText(note) {
  const lines = ["CLINICAL STRUCTURED NOTE", "=".repeat(40), ""];

  const renderVal = (val, indent = "") => {
    if (val === null || val === undefined || val === "") return "";
    if (typeof val === "string" || typeof val === "number") return `${indent}${val}`;
    if (Array.isArray(val)) {
      return val
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map((item) => {
          if (typeof item === "object") {
            return Object.entries(item)
              .map(([k, v]) => `${indent}  • ${k.replace(/_/g, " ")}: ${renderVal(v)}`)
              .join("\n");
          }
          return `${indent}  • ${item}`;
        })
        .join("\n");
    }
    if (typeof val === "object") {
      return Object.entries(val)
        .map(([k, v]) => `${indent}  ${k.replace(/_/g, " ")}: ${renderVal(v)}`)
        .join("\n");
    }
    return "";
  };

  Object.entries(note).forEach(([section, value]) => {
    if (value === null || value === undefined || value === "") return;
    lines.push(section.replace(/_/g, " ").toUpperCase());
    lines.push("-".repeat(28));
    lines.push(renderVal(value));
    lines.push("");
  });

  return lines.join("\n");
}

/* ─── FLAT KV TABLE (standalone flat object section) ─────────────────────── */
function FlatKVTable({ data }) {
  const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!rows.length) return null;
  return (
    <div className="snp-kv-table">
      {rows.map(([k, v]) => (
        <div className="snp-kv-row" key={k}>
          <div className="snp-kv-key">{k.replace(/_/g, " ")}</div>
          <div className="snp-kv-val">
            {isVitalKey(k)
              ? <span className="snp-chip">{String(v)}</span>
              : <span>{String(v)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── ITEM CARD (single entry inside an array of objects) ────────────────── */
function ObjectItemCard({ item, index }) {
  const entries = Object.entries(item).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return null;

  const headerEntry = pickHeaderEntry(entries);
  const headerIsSimple = headerEntry && (typeof headerEntry[1] === "string" || typeof headerEntry[1] === "number");
  const restEntries = entries.filter((e) => e !== headerEntry);

  return (
    <div className="snp-item-card">
      <div>
        <span className="snp-item-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="snp-item-title">
          {headerIsSimple ? String(headerEntry[1]) : headerEntry[0].replace(/_/g, " ")}
        </span>
      </div>

      {restEntries.length > 0 && (
        <div className="snp-item-meta">
          {restEntries.map(([k, v]) => {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              return (
                <span className="snp-item-meta-pair" key={k}>
                  <span className="snp-item-meta-key">{k.replace(/_/g, " ")}</span>
                  {isVitalKey(k) ? (
                    <span className="snp-chip">{String(v)}</span>
                  ) : (
                    <span className="snp-item-meta-val">{String(v)}</span>
                  )}
                </span>
              );
            }
            return (
              <div className="snp-item-meta-block" key={k}>
                <div className="snp-nested-label">{k.replace(/_/g, " ")}</div>
                <RenderValue value={v} keyName={k} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ArrayOfObjectsList({ items }) {
  return (
    <div className="snp-itemlist">
      {items.map((item, i) => (
        <ObjectItemCard key={i} item={item} index={i} />
      ))}
    </div>
  );
}

/* ─── MAIN RECURSIVE RENDERER ─────────────────────────────────────────────── */
function RenderValue({ value, keyName = "" }) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string" || typeof value === "number") {
    if (isVitalKey(keyName)) return <span className="snp-chip">{String(value)}</span>;
    return <p className="snp-text">{String(value)}</p>;
  }

  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined && v !== "");
    if (!items.length) return null;

    const allObjects = items.every((it) => it && typeof it === "object" && !Array.isArray(it));
    if (allObjects) return <ArrayOfObjectsList items={items} />;

    return (
      <div className="snp-bullets">
        {items.map((item, i) =>
          typeof item === "object" ? (
            <div key={i}><RenderValue value={item} /></div>
          ) : (
            <div className="snp-bullet" key={i}>
              <span className="snp-bullet-dot" />
              <span className="snp-text">{String(item)}</span>
            </div>
          )
        )}
      </div>
    );
  }

  if (isFlatObject(value)) return <FlatKVTable data={value} />;

  if (typeof value === "object") {
    return (
      <div className="snp-nested">
        {Object.entries(value).map(([k, v]) => {
          if (v === null || v === undefined || v === "") return null;
          return (
            <div key={k}>
              <div className="snp-nested-label">{k.replace(/_/g, " ")}</div>
              <RenderValue value={v} keyName={k} />
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}

/* ─── ENABLE/DISABLE SWITCH ───────────────────────────────────────────────── */
function SectionSwitch({ enabled, onToggle }) {
  return (
    <span className="snp-switch-wrap" title={enabled ? "Included in patient copy" : "Excluded from patient copy"}>
      <button
        type="button"
        className={`snp-switch${enabled ? " on" : ""}`}
        onClick={onToggle}
        aria-pressed={enabled}
      >
        <span className="snp-switch-knob" />
      </button>
    </span>
  );
}

/* ─── SINGLE NOTE CARD ────────────────────────────────────────────────────── */
function NoteCard({ section, value, onSave, enabled, onToggle }) {
  const icon  = getSectionIcon(section);
  const title = section.replace(/_/g, " ");
  const [editing,    setEditing]    = useState(false);
  const [draftText,  setDraftText]  = useState("");
  const [parseError, setParseError] = useState("");

  const startEdit = () => {
    setDraftText(
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : JSON.stringify(value, null, 2)
    );
    setParseError("");
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setParseError(""); };

  const saveEdit = () => {
    const raw = draftText.trim();
    try {
      const parsed = JSON.parse(raw);
      onSave(section, parsed);
      setEditing(false); setParseError("");
    } catch {
      if (typeof value === "string" || typeof value === "number") {
        onSave(section, raw);
        setEditing(false); setParseError("");
      } else {
        setParseError("Invalid JSON. Fix the format or revert changes.");
      }
    }
  };

  const headerActions = (
    <div className="snp-card-actions">
      {!enabled && <span className="snp-excluded-tag">Excluded</span>}
      <SectionSwitch enabled={enabled} onToggle={onToggle} />
      {editing ? (
        <>
          <button className="snp-icon-btn save"   onClick={saveEdit}   title="Save">✓</button>
          <button className="snp-icon-btn cancel" onClick={cancelEdit} title="Cancel">✕</button>
        </>
      ) : (
        <button className="snp-icon-btn" onClick={startEdit} title="Edit">✎</button>
      )}
    </div>
  );

  if (section === "triage_category") {
    const key   = typeof value === "string" ? value.toLowerCase() : "";
    const color = TRIAGE_COLORS[key] || TRIAGE_COLORS.blue;
    return (
      <div className={`snp-card wide${editing ? " editing" : ""}${!enabled ? " disabled" : ""}`}>
        <div className="snp-card-hd">
          <span className="snp-card-icon">{icon}</span>
          <span className="snp-card-title">{title}</span>
          {headerActions}
        </div>
        <div className="snp-card-bd">
          {editing ? (
            <>
              <textarea
                className="snp-edit-textarea"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="e.g. Red"
              />
              {parseError && <p style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{parseError}</p>}
              <p className="snp-edit-hint">Enter a triage colour: Green · Yellow · Red · Blue</p>
            </>
          ) : (
            <span
              className="snp-triage"
              style={{ background: color.bg, color: color.text, borderColor: color.border }}
            >
              <span className="snp-triage-dot" style={{ background: color.dot }} />
              {typeof value === "string" ? value : <RenderValue value={value} />}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`snp-card${editing ? " editing" : ""}${!enabled ? " disabled" : ""}`}>
      <div className="snp-card-hd">
        <span className="snp-card-icon">{icon}</span>
        <span className="snp-card-title">{title}</span>
        {headerActions}
      </div>
      <div className="snp-card-bd">
        {editing ? (
          <>
            <textarea
              className="snp-edit-textarea"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Enter value or valid JSON…"
            />
            {parseError && <p style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{parseError}</p>}
            <p className="snp-edit-hint">
              Plain text for simple values · JSON object/array for structured data
            </p>
          </>
        ) : (
          <RenderValue value={value} keyName={section} />
        )}
      </div>
    </div>
  );
}

/* ─── TREATMENT PLAN CARD ─────────────────────────────────────────────────── */
function TreatmentPlanCard({ section, value, onSave, enabled, onToggle }) {
    const wasArray = Array.isArray(value);
    const plans = wasArray ? value : [value];

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState([]);
    const [parseErrors, setParseErrors] = useState({});

    const startEdit = () => {
        setDraft(
            plans.map((p) => {
                const { intent, modality, ...rest } = p || {};
                return {
                    intent: intent ?? "",
                    modality: Array.isArray(modality) ? modality.join(", ") : (modality ?? ""),
                    restText: JSON.stringify(rest, null, 2),
                };
            })
        );
        setParseErrors({});
        setEditing(true);
    };

    const cancelEdit = () => { setEditing(false); setParseErrors({}); };

    const setField = (pi, field, val) => {
        setDraft((prev) => {
            const next = [...prev];
            next[pi] = { ...next[pi], [field]: val };
            return next;
        });
    };

    const saveEdit = () => {
        const errors = {};
        const result = draft.map((d, pi) => {
            let rest = {};
            try {
                rest = d.restText.trim() ? JSON.parse(d.restText) : {};
            } catch {
                errors[pi] = "Invalid JSON in plan details — fix formatting or cancel to revert.";
            }
            const modalityVal = d.modality.includes(",")
                ? d.modality.split(",").map((m) => m.trim()).filter(Boolean)
                : d.modality;
            return { intent: d.intent, modality: modalityVal, ...rest };
        });

        if (Object.keys(errors).length) { setParseErrors(errors); return; }
        onSave(section, wasArray ? result : result[0]);
        setEditing(false);
        setParseErrors({});
    };

    return (
        <div className={`snp-card wide${editing ? " editing" : ""}${!enabled ? " disabled" : ""}`}>
            <div className="snp-card-hd">
                <span className="snp-card-icon">💊</span>
                <span className="snp-card-title">{section.replace(/_/g, " ")}</span>
                <div className="snp-card-actions">
                    {!enabled && <span className="snp-excluded-tag">Excluded</span>}
                    <SectionSwitch enabled={enabled} onToggle={onToggle} />
                    {editing ? (
                        <>
                            <button className="snp-icon-btn save" onClick={saveEdit} title="Save">✓</button>
                            <button className="snp-icon-btn cancel" onClick={cancelEdit} title="Cancel">✕</button>
                        </>
                    ) : (
                        <button className="snp-icon-btn" onClick={startEdit} title="Edit">✎</button>
                    )}
                </div>
            </div>

            <div className="snp-card-bd">
                {editing
                    ? draft.map((d, pi) => (
                        <div key={pi} className="tp-plan">
                            <div className="tp-edit-meta">
                                <div>
                                    <div className="tp-edit-label">Intent</div>
                                    <input
                                        className="tp-edit-input"
                                        value={d.intent}
                                        onChange={(e) => setField(pi, "intent", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <div className="tp-edit-label">Modality</div>
                                    <input
                                        className="tp-edit-input"
                                        value={d.modality}
                                        placeholder="e.g. surgery, chemotherapy"
                                        onChange={(e) => setField(pi, "modality", e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="tp-edit-plan-wrap">
                                <div className="tp-edit-label">Everything Else (JSON)</div>
                                <textarea
                                    className="tp-edit-plan-textarea"
                                    rows={8}
                                    value={d.restText}
                                    placeholder='{"plan_details": [...], "guideline": "...", ...}'
                                    onChange={(e) => setField(pi, "restText", e.target.value)}
                                />
                                {parseErrors[pi] && (
                                    <p style={{ color: "#B3261E", fontSize: 11, marginTop: 6 }}>{parseErrors[pi]}</p>
                                )}
                            </div>
                            <p className="snp-edit-hint">
                                Intent / Modality are plain text. Everything else the note captured for
                                this plan — plan details, guideline, supporting trial steps,
                                prerequisites, contraindications, complications, post-procedure care,
                                cardiac risk, etc. — is edited as JSON so no nested detail is lost.
                            </p>
                        </div>
                    ))
                    : plans.map((plan, pi) => {
                        const { intent, modality, ...rest } = plan || {};
                        const restEntries = Object.entries(rest).filter(
                            ([, v]) => v !== null && v !== undefined && v !== ""
                        );

                        return (
                            <div key={pi} className="tp-plan">
                                <div className="tp-detail-list">
                                    {intent && (
                                        <div className="tp-detail-row">
                                            <span className="tp-detail-label">Intent</span>
                                            <span className="tp-detail-value">{intent}</span>
                                        </div>
                                    )}
                                    {modality && (
                                        <div className="tp-detail-row">
                                            <span className="tp-detail-label">Modality</span>
                                            <span className="tp-detail-value">
                                                {Array.isArray(modality) ? modality.join(", ") : modality}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {restEntries.map(([k, v]) => (
                                    <div key={k} className="tp-detail-row">
                                        <span className="tp-detail-label">{k.replace(/_/g, " ")}</span>
                                        <span className="tp-detail-value"><RenderValue value={v} keyName={k} /></span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

/* ─── TOAST ───────────────────────────────────────────────────────────────── */
function Toast({ message, icon = "✓" }) {
  return (
    <div className="snp-toast">
      <span>{icon}</span>
      <span>{message}</span>
    </div>
  );
}

/* ─── MAIN COMPONENT ──────────────────────────────────────────────────────── */
export default function StructuredNotePanel({ doctorId, patientId, dictation }) {
    const [loading, setLoading] = useState(false);
    const [structuredNote, setStructuredNote] = useState(null);
    const [sectionEnabled, setSectionEnabled] = useState({});
    const [toast, setToast] = useState(null);
    const [showDownload, setShowDownload] = useState(false);
    const dropdownRef = useRef(null);
    const toastTimer = useRef(null);

    const showToast = (message, icon = "✓") => {
        setToast({ message, icon });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2800);
    };

    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target))
                setShowDownload(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const isSectionEnabled = (section) => sectionEnabled[section] !== false;

    const toggleSection = (section) => {
        setSectionEnabled((prev) => ({ ...prev, [section]: !isSectionEnabled(section) }));
    };

    const generateNote = async () => {
        if (!dictation) return;
        setLoading(true);
        try {
            const res = await fetch(
                `${API_BASE_URL}hms/users/orchestration/generate-structured-note`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation }),
                }
            );
            const json = await res.json();
            if (json.status === "success") {
                setStructuredNote(json.finaloutput);
                const initEnabled = {};
                Object.keys(json.finaloutput || {}).forEach((s) => { initEnabled[s] = true; });
                setSectionEnabled(initEnabled);
            }
        } catch (err) { console.error(err); }
        setLoading(false);
    };

    useEffect(() => { if (dictation) generateNote(); }, [dictation]);

    const handleCardSave = async (section, newValue) => {
        const updatedNote = { ...structuredNote, [section]: newValue };
        setStructuredNote(updatedNote);

        try {
            const res = await fetch(
                `${API_BASE_URL}hms/users/data/context/update-structured-note`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        doctor_id: doctorId,
                        patient_id: patientId,
                        structured_note: updatedNote,
                    }),
                }
            );
            const json = await res.json();
            if (json.status === "success") showToast("Section updated successfully");
        } catch (err) {
            console.error(err);
        }
    };

    const getExportableNote = () => {
        if (!structuredNote) return {};
        return Object.fromEntries(
            Object.entries(structuredNote).filter(([section]) => isSectionEnabled(section))
        );
    };

    const excludedCount = structuredNote
        ? Object.keys(structuredNote).filter((s) => !isSectionEnabled(s)).length
        : 0;

    /* ── DOWNLOADS ── */
    const downloadJSON = () => {
        if (!structuredNote) return;
        triggerDownload(JSON.stringify(getExportableNote(), null, 2), "structured-note.json", "application/json");
        setShowDownload(false);
        showToast("Downloaded as JSON", "⬇");
    };

    const downloadText = () => {
        if (!structuredNote) return;
        triggerDownload(noteToPlainText(getExportableNote()), "structured-note.txt", "text/plain");
        setShowDownload(false);
        showToast("Downloaded as text report", "⬇");
    };

    const downloadPDF = () => {
        if (!structuredNote) return;
        const exportNote = getExportableNote();

        const doc = new jsPDF({ unit: "pt", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M = 50;
        const usableW = pageW - M * 2;
        const HEADER_H = 58;
        const TOP_Y = HEADER_H + 34;
        const BOTTOM_LIMIT = pageH - 46;

        let y = TOP_Y;

        const ink  = (r, g, b) => doc.setTextColor(r, g, b);
        const rule = (r, g, b) => doc.setDrawColor(r, g, b);
        const fill = (r, g, b) => doc.setFillColor(r, g, b);
        const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };

        const ACCENT = [14, 124, 102];

        const drawHeader = () => {
            fill(23, 27, 33);
            doc.rect(0, 0, pageW, HEADER_H, "F");
            fill(...ACCENT);
            doc.rect(0, HEADER_H - 3, pageW, 3, "F");
            font("bold", 14); ink(255, 255, 255);
            doc.text("Clinical Structured Note", M, 36);
            font("normal", 8.5); ink(180, 186, 194);
            const dateStr = new Date().toLocaleDateString("en-US", {
                year: "numeric", month: "long", day: "numeric",
            });
            doc.text(dateStr, pageW - M, 36, { align: "right" });
        };

        const newPage = () => {
            doc.addPage();
            drawHeader();
            y = TOP_Y;
        };

        const checkPageBreak = (needed = 20) => {
            if (y + needed > BOTTOM_LIMIT) newPage();
        };

        drawHeader();

        const demo = exportNote.patient_demographics;
        if (demo && typeof demo === "object") {
            const entries = Object.entries(demo).filter(
                ([, v]) => v !== null && v !== undefined && v !== ""
            );
            if (entries.length) {
                const boxH = 38;
                fill(247, 250, 249);
                doc.roundedRect(M, y, usableW, boxH, 6, 6, "F");
                rule(210, 225, 220); doc.setLineWidth(0.75);
                doc.roundedRect(M, y, usableW, boxH, 6, 6, "S");
                const colW = usableW / entries.length;
                entries.forEach(([k, v], i) => {
                    const cx = M + i * colW + 14;
                    font("bold", 7.5); ink(110, 120, 118);
                    doc.text(k.replace(/_/g, " ").toUpperCase(), cx, y + 15);
                    font("normal", 11.5); ink(23, 27, 33);
                    doc.text(String(v), cx, y + 29);
                    if (i > 0) {
                        rule(215, 225, 222); doc.setLineWidth(0.5);
                        doc.line(M + i * colW, y + 7, M + i * colW, y + boxH - 7);
                    }
                });
                y += boxH + 22;
            }
        }

        const renderVal = (val, indentX = M) => {
            if (val === null || val === undefined || val === "") return;

            if (typeof val === "string" || typeof val === "number") {
                font("normal", 10); ink(35, 39, 45);
                const lines = doc.splitTextToSize(String(val), usableW - (indentX - M));
                lines.forEach((line) => {
                    checkPageBreak(16);
                    doc.text(line, indentX, y);
                    y += 15;
                });
                return;
            }

            if (Array.isArray(val)) {
                const items = val.filter(Boolean);
                const allObjects = items.every((it) => it && typeof it === "object" && !Array.isArray(it));

                if (allObjects) {
                    items.forEach((item, idx) => {
                        const entries = Object.entries(item).filter(
                            ([, v]) => v !== null && v !== undefined && v !== ""
                        );
                        if (!entries.length) return;
                        const headerEntry = pickHeaderEntry(entries);
                        const restEntries = entries.filter((e) => e !== headerEntry);

                        checkPageBreak(30);
                        const cardTop = y - 10;

                        font("bold", 10.5); ink(23, 27, 33);
                        const headerLabel = `${String(idx + 1).padStart(2, "0")}   ${
                            typeof headerEntry[1] === "string" || typeof headerEntry[1] === "number"
                                ? String(headerEntry[1])
                                : headerEntry[0].replace(/_/g, " ")
                        }`;
                        doc.text(headerLabel, indentX + 10, y);
                        y += 15;

                        restEntries.forEach(([k, v]) => {
                            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                                checkPageBreak(15);
                                font("bold", 8.5); ink(120, 128, 126);
                                const label = `${k.replace(/_/g, " ").toUpperCase()}  `;
                                doc.text(label, indentX + 10, y);
                                const labelW = doc.getTextWidth(label);
                                font("normal", 10); ink(35, 39, 45);
                                doc.text(String(v), indentX + 10 + labelW, y);
                                y += 14;
                            } else {
                                checkPageBreak(15);
                                font("bold", 8.5); ink(120, 128, 126);
                                doc.text(k.replace(/_/g, " ").toUpperCase(), indentX + 10, y);
                                y += 13;
                                renderVal(v, indentX + 18);
                            }
                        });

                        rule(...ACCENT); doc.setLineWidth(2);
                        doc.line(indentX, cardTop, indentX, y - 4);
                        rule(224, 228, 226); doc.setLineWidth(0.6);
                        doc.roundedRect(indentX, cardTop, usableW - (indentX - M) * 2, y - cardTop, 3, 3, "S");
                        y += 12;
                    });
                } else {
                    items.forEach((item) => {
                        checkPageBreak(16);
                        fill(...ACCENT);
                        doc.circle(indentX + 2.5, y - 3, 2, "F");
                        font("normal", 10); ink(35, 39, 45);
                        const lines = doc.splitTextToSize(String(item), usableW - (indentX - M) - 14);
                        lines.forEach((l, li) => {
                            checkPageBreak(16);
                            doc.text(l, indentX + 12, y);
                            if (li < lines.length - 1) y += 15;
                        });
                        y += 15;
                    });
                }
                return;
            }

            if (typeof val === "object") {
                Object.entries(val).forEach(([k, v]) => {
                    if (v === null || v === undefined || v === "") return;
                    checkPageBreak(20);
                    font("bold", 8.5); ink(95, 100, 98);
                    rule(...ACCENT); doc.setLineWidth(1.5);
                    doc.line(indentX, y - 8, indentX, y + 3);
                    doc.text(k.replace(/_/g, " ").toUpperCase(), indentX + 8, y);
                    y += 14;
                    renderVal(v, indentX + 14);
                });
            }
        };

        Object.entries(exportNote).forEach(([section, value]) => {
            if (section === "patient_demographics") return;
            if (value === null || value === undefined || value === "") return;

            checkPageBreak(46);

            fill(247, 250, 249);
            doc.rect(M, y - 15, usableW, 23, "F");
            fill(...ACCENT);
            doc.rect(M, y - 15, 3, 23, "F");

            font("bold", 10.5); ink(23, 27, 33);
            doc.text(section.replace(/_/g, " ").toUpperCase(), M + 13, y);

            y += 19;
            renderVal(value, M + 10);
            y += 12;

            checkPageBreak(10);
            rule(232, 235, 233); doc.setLineWidth(0.5);
            doc.line(M, y - 4, pageW - M, y - 4);
            y += 10;
        });

        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            fill(224, 228, 226); doc.rect(M, pageH - 34, usableW, 1, "F");
            font("normal", 8); ink(150, 155, 153);
            doc.text(`Page ${i} of ${totalPages}`, pageW - M, pageH - 20, { align: "right" });
            doc.text("Clinical Structured Note — Confidential", M, pageH - 20);
        }

        doc.save("structured-note.pdf");
        setShowDownload(false);
        showToast("Downloaded as PDF", "⬇");
    };

    return (
        <>
            <style>{styles}</style>
            <div className="snp">

                <div className="snp-topbar">
                    <div className="snp-heading-block">
                        <span className="snp-eyebrow">Encounter Note</span>
                        <p className="snp-heading">Clinical Structured Note</p>
                        {structuredNote && (
                            <span className="snp-subline">
                                {Object.keys(structuredNote).length} sections ·{" "}
                                {excludedCount > 0
                                    ? `${excludedCount} excluded from patient copy`
                                    : "all sections included in patient copy"}
                            </span>
                        )}
                    </div>
                    <div className="snp-topbar-actions">

                        {structuredNote && (
                            <div className="snp-dropdown-wrap" ref={dropdownRef}>
                                <button
                                    className="snp-btn-outline"
                                    onClick={() => setShowDownload((s) => !s)}
                                    title="Download note"
                                >
                                    <span>⬇</span> Download
                                </button>
                                {showDownload && (
                                    <div className="snp-dropdown">
                                        <button className="snp-dropdown-item" onClick={downloadJSON}>
                                            <span>{ }</span> JSON file
                                        </button>
                                        <div className="snp-dropdown-divider" />
                                        <button className="snp-dropdown-item" onClick={downloadText}>
                                            <span>📄</span> Text report
                                        </button>
                                        <div className="snp-dropdown-divider" />
                                        <button className="snp-dropdown-item" onClick={downloadPDF}>
                                            <span>📑</span> PDF report
                                        </button>
                                        <div className="snp-dropdown-note">
                                            {excludedCount > 0
                                                ? `${excludedCount} section${excludedCount > 1 ? "s" : ""} switched off will be left out of every download.`
                                                : "All sections are switched on and will be included."}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <button className="snp-btn" onClick={generateNote} disabled={loading}>
                            {loading
                                ? <><span className="snp-spinner" />Generating…</>
                                : <><span>✦</span>Generate Structured Note</>}
                        </button>
                    </div>
                </div>

                {structuredNote && (
                    <div className="snp-edit-banner">
                        <span>✎</span>
                        Use the switch on any card to include or exclude it from the patient copy, or
                        the <strong style={{ fontWeight: 700 }}>pencil</strong> to edit its content.
                    </div>
                )}

                {structuredNote ? (
                    <div className="snp-grid">
                        {Object.entries(structuredNote).map(([section, value]) => {
                            if (value === null || value === undefined || value === "") return null;
                            const enabled = isSectionEnabled(section);
                            const onToggle = () => toggleSection(section);

                            if (isTreatmentPlanSection(section)) {
                                return (
                                    <TreatmentPlanCard
                                        key={section}
                                        section={section}
                                        value={value}
                                        onSave={handleCardSave}
                                        enabled={enabled}
                                        onToggle={onToggle}
                                    />
                                );
                            }

                            return (
                                <NoteCard
                                    key={section}
                                    section={section}
                                    value={value}
                                    onSave={handleCardSave}
                                    enabled={enabled}
                                    onToggle={onToggle}
                                />
                            );
                        })}
                    </div>
                ) : (
                    !loading && (
                        <div className="snp-empty">
                            <div className="snp-empty-icon">🩺</div>
                            <p className="snp-empty-text">
                                Click "Generate Structured Note" to process the dictation.
                            </p>
                        </div>
                    )
                )}
            </div>

            {toast && <Toast message={toast.message} icon={toast.icon} />}
        </>
    );
}