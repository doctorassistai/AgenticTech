import React, { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── SECTION ICON MAP ──────────────────────────────────────────────────── */
/* The backend no longer commits to a fixed schema (see prompt RULE 3) — it
   picks section names dynamically based on what's in the dictation. This
   map still covers the common/expected names for a fast exact-match lookup,
   but anything it misses now falls through to getSectionIcon()'s keyword
   heuristics below instead of going straight to the generic "📄". */
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

/* Keyword fallback — used when the model names a section something the map
   above doesn't have an exact entry for (e.g. "recommended_procedures",
   "required_investigations", "primary_goals"). Checked in order, first
   match wins. */
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

/* Any section whose name is about a treatment plan — "treatment_plan",
   "treatment_plans", "proposed_treatment_plans", etc. — gets the richer
   TreatmentPlanCard instead of the generic NoteCard, regardless of exactly
   which of those names the model picked for this note. */
const isTreatmentPlanSection = (section) => /treatment.*plan/i.test(section);

/* Triage — semantic colour is restored here on purpose. In a real chart,
   green/amber/red/blue is load-bearing information a clinician reads at a
   glance; collapsing it to monochrome (as the previous version did) throws
   away the fastest signal on the page. */
const TRIAGE_COLORS = {
  green:  { bg: "#E9F8F0", text: "#0F7A4E", border: "#0F7A4E", dot: "#1E9E6B" },
  yellow: { bg: "#FDF3E0", text: "#8A5A05", border: "#C97A0A", dot: "#C97A0A" },
  red:    { bg: "#FCEAEA", text: "#A02F31", border: "#D8484A", dot: "#D8484A" },
  blue:   { bg: "#EAF0FE", text: "#2A4EA8", border: "#3E6FD9", dot: "#3E6FD9" },
};

/* PDF uses solid fills (needs plain RGB, not CSS) — kept in sync with the
   palette above so the download matches what's on screen. */
const TRIAGE_PDF = {
  green:  { fill: [30, 158, 107],  text: [255, 255, 255] },
  yellow: { fill: [201, 122, 10],  text: [255, 255, 255] },
  red:    { fill: [216, 72, 74],   text: [255, 255, 255] },
  blue:   { fill: [62, 111, 217],  text: [255, 255, 255] },
};

/* ─── STYLES ──────────────────────────────────────────────────────────────── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

  .snp * { box-sizing: border-box; margin: 0; padding: 0; }

  .snp {
    --snp-bg: #F6F8FA;
    --snp-surface: #FFFFFF;
    --snp-border: #E3E8EF;
    --snp-border-strong: #CBD5E1;
    --snp-ink: #101828;
    --snp-ink-soft: #4B5566;
    --snp-muted: #8A94A6;
    --snp-primary: #0E7C86;
    --snp-primary-dark: #075E66;
    --snp-primary-soft: #E4F4F5;
    --snp-primary-softer: #F1FAFA;
    --snp-green: #1E9E6B;   --snp-green-soft: #E9F8F0;
    --snp-amber: #C97A0A;   --snp-amber-soft: #FDF3E0;
    --snp-red: #D8484A;     --snp-red-soft: #FCEAEA;
    --snp-blue: #3E6FD9;    --snp-blue-soft: #EAF0FE;
    --font-display: 'Fraunces', serif;
    --font-body: 'Inter', sans-serif;
    --font-mono: 'IBM Plex Mono', monospace;

    font-family: var(--font-body);
    background: var(--snp-bg);
    min-height: 100vh;
    padding: 32px 24px 56px;
    color: var(--snp-ink);
  }

  /* ── HEADER / MASTHEAD ── */
  .snp-topbar {
    max-width: 880px;
    margin: 0 auto 24px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--snp-border-strong);
    box-shadow: 0 1.5px 0 0 var(--snp-primary);
    flex-wrap: wrap;
    gap: 12px;
  }
  .snp-heading-block { display: flex; flex-direction: column; gap: 3px; }
  .snp-eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--snp-primary);
  }
  .snp-heading {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 600;
    color: var(--snp-ink);
    letter-spacing: -0.2px;
  }

  .snp-topbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-bottom: 3px;
  }

  /* ── BUTTONS ── */
  .snp-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--snp-primary);
    color: #ffffff;
    border: 1px solid var(--snp-primary);
    border-radius: 8px;
    padding: 9px 18px;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
  }
  .snp-btn:hover:not(:disabled) { background: var(--snp-primary-dark); }
  .snp-btn:active:not(:disabled) { transform: translateY(1px); }
  .snp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .snp-btn-outline {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--snp-surface);
    color: var(--snp-primary-dark);
    border: 1px solid var(--snp-border-strong);
    border-radius: 8px;
    padding: 9px 16px;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .snp-btn-outline:hover:not(:disabled) { background: var(--snp-primary-softer); border-color: var(--snp-primary); }
  .snp-btn-outline:active:not(:disabled) { background: var(--snp-primary-soft); }
  .snp-btn-outline:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── DROPDOWN ── */
  .snp-dropdown-wrap { position: relative; }
  .snp-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: #ffffff;
    border: 1px solid var(--snp-border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(16,24,40,0.10), 0 2px 6px rgba(16,24,40,0.06);
    min-width: 180px;
    z-index: 100;
    overflow: hidden;
    animation: snp-dropdown-in 0.12s ease;
  }
  @keyframes snp-dropdown-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .snp-dropdown-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    background: none;
    border: none;
    padding: 11px 14px;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 400;
    color: var(--snp-ink);
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
  }
  .snp-dropdown-item:hover { background: var(--snp-primary-softer); }
  .snp-dropdown-divider { height: 1px; background: var(--snp-border); }

  /* ── SPINNER ── */
  .snp-spinner {
    width: 13px; height: 13px;
    border: 1.5px solid rgba(255,255,255,0.35);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: snp-spin 0.65s linear infinite;
  }
  @keyframes snp-spin { to { transform: rotate(360deg); } }

  /* ── GRID ── */
  .snp-grid {
    max-width: 880px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* ── PATIENT BAND (letterhead-style ID strip) ── */
  .snp-patient-band {
    display: flex;
    flex-wrap: wrap;
    background: var(--snp-primary-softer);
    border: 1px solid var(--snp-primary-soft);
    border-left: 4px solid var(--snp-primary);
    border-radius: 12px;
    overflow: hidden;
    opacity: 0;
    animation: snp-up 0.3s ease forwards;
  }
  .snp-patient-cell {
    flex: 1 1 120px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 14px 18px;
    border-right: 1px solid var(--snp-primary-soft);
  }
  .snp-patient-cell:last-child { border-right: none; }
  .snp-patient-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--snp-primary-dark);
    opacity: 0.75;
  }
  .snp-patient-value {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--snp-ink);
  }

  /* ── CARD ── */
  .snp-card {
    background: var(--snp-surface);
    border: 1px solid var(--snp-border);
    border-radius: 12px;
    overflow: hidden;
    opacity: 0;
    animation: snp-up 0.3s ease forwards;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .snp-card:hover { border-color: var(--snp-border-strong); box-shadow: 0 2px 10px rgba(16,24,40,0.05); }
  .snp-card.editing { border-color: var(--snp-primary); }

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

  @keyframes snp-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── CARD HEADER ── */
  .snp-card-hd {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--snp-surface);
    border-bottom: 1px solid var(--snp-border);
  }
  .snp-card-icon-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px; height: 26px;
    border-radius: 7px;
    background: var(--snp-primary-soft);
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }
  .snp-card-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--snp-ink-soft);
    flex: 1;
  }

  /* ── CARD ACTIONS ── */
  .snp-card-actions { display: flex; align-items: center; gap: 3px; margin-left: auto; }
  .snp-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: var(--snp-muted);
    font-size: 12px;
    transition: all 0.12s ease;
    padding: 0;
  }
  .snp-icon-btn:hover        { border-color: var(--snp-border-strong); color: var(--snp-ink); background: var(--snp-bg); }
  .snp-icon-btn.active       { border-color: var(--snp-primary); color: var(--snp-primary-dark); background: var(--snp-primary-soft); }
  .snp-icon-btn.save         { border-color: var(--snp-primary); color: var(--snp-primary-dark); background: var(--snp-primary-soft); }
  .snp-icon-btn.save:hover   { background: var(--snp-primary-soft); }
  .snp-icon-btn.cancel       { border-color: var(--snp-border-strong); color: var(--snp-muted); background: transparent; }
  .snp-icon-btn.cancel:hover { border-color: var(--snp-red); color: var(--snp-red); background: var(--snp-red-soft); }

  /* ── CARD BODY ── */
  .snp-card-bd { padding: 16px; }

  /* ── PLAIN TEXT ── */
  .snp-text { font-size: 13.5px; font-weight: 400; color: var(--snp-ink); line-height: 1.7; }

  /* ── BULLET LIST (plain string/number arrays) ── */
  .snp-bullets { display: flex; flex-direction: column; gap: 7px; }
  .snp-bullet {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13.5px;
    font-weight: 400;
    color: var(--snp-ink);
    line-height: 1.6;
  }
  .snp-bullet-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--snp-primary);
    flex-shrink: 0;
    margin-top: 7px;
  }

  /* ── ENTRY LIST (arrays of objects — medications, investigations, etc.) ──
     Each item gets its own bordered sub-card so N similar records read as
     N distinct things, not one table with repeating headers. ── */
  .snp-entry-list { display: flex; flex-direction: column; gap: 8px; }
  .snp-entry-card {
    border: 1px solid var(--snp-border);
    border-radius: 9px;
    padding: 10px 13px;
    background: var(--snp-bg);
  }
  .snp-entry-card-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--snp-ink);
    line-height: 1.4;
  }
  .snp-entry-card-meta {
    margin-top: 6px;
    padding-top: 7px;
    border-top: 1px dashed var(--snp-border-strong);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .snp-entry-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12.5px;
    line-height: 1.55;
  }
  .snp-entry-meta-key {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--snp-muted);
    flex-shrink: 0;
  }
  .snp-entry-meta-val { color: var(--snp-ink-soft); font-weight: 400; }

  /* single-field entries (e.g. { name: "HIV" }) render as a plain checklist
     row instead of a title-only card, so a list of ten of these doesn't
     turn into ten near-empty boxes */
  .snp-entry-simple {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 13.5px;
    color: var(--snp-ink);
    padding: 2px 0;
  }
  .snp-entry-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--snp-primary);
    flex-shrink: 0;
  }

  /* ── TAG LIST (nested primitive arrays, e.g. body areas scanned) ── */
  .snp-tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
  .snp-tag {
    display: inline-flex;
    align-items: center;
    background: var(--snp-primary-soft);
    color: var(--snp-primary-dark);
    border-radius: 5px;
    padding: 2px 8px;
    font-size: 11.5px;
    font-weight: 500;
  }

  /* ── KV TABLE (flat nested objects) ── */
  .snp-kv-table { display: flex; flex-direction: column; }
  .snp-kv-row {
    display: grid;
    grid-template-columns: 36% 1fr;
    gap: 10px;
    align-items: start;
    padding: 8px 0;
    border-bottom: 1px solid var(--snp-border);
  }
  .snp-kv-row:last-child  { border-bottom: none; padding-bottom: 0; }
  .snp-kv-row:first-child { padding-top: 0; }
  .snp-kv-key {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--snp-muted);
    padding-top: 2px;
    line-height: 1.5;
  }
  .snp-kv-val {
    font-size: 13px;
    font-weight: 500;
    color: var(--snp-ink);
    line-height: 1.55;
    word-break: break-word;
  }

  /* ── VITAL CHIP ── */
  .snp-chip {
    display: inline-flex;
    align-items: center;
    background: var(--snp-blue-soft);
    border: 1px solid var(--snp-blue);
    border-radius: 6px;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: #24408F;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  /* ── NESTED SECTION ── */
  .snp-nested { display: flex; flex-direction: column; gap: 14px; }
  .snp-nested-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--snp-primary-dark);
    margin-bottom: 7px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--snp-primary-soft);
  }

  /* ── TRIAGE BADGE ── */
  .snp-triage {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border-radius: 999px;
    padding: 9px 20px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-width: 1.5px;
    border-style: solid;
  }
  .snp-triage-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    animation: snp-pulse 1.8s ease-in-out infinite;
  }
  @keyframes snp-pulse {
    0%,100% { opacity:1; }
    50%     { opacity:0.35; }
  }

  /* ── EDIT TEXTAREA ── */
  .snp-edit-textarea {
    width: 100%;
    min-height: 110px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 400;
    color: var(--snp-ink);
    background: var(--snp-bg);
    border: 1.5px solid var(--snp-primary);
    border-radius: 8px;
    padding: 10px 12px;
    resize: vertical;
    outline: none;
    line-height: 1.65;
    transition: background 0.12s;
  }
  .snp-edit-textarea:focus { background: #ffffff; }
  .snp-edit-hint {
    font-size: 10.5px;
    font-weight: 400;
    color: var(--snp-muted);
    margin-top: 6px;
    line-height: 1.5;
  }

  /* ── EDIT BANNER ── */
  .snp-edit-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--snp-primary-softer);
    border: 1px solid var(--snp-primary-soft);
    border-left: 3px solid var(--snp-primary);
    border-radius: 8px;
    padding: 10px 16px;
    margin-bottom: 16px;
    font-size: 12.5px;
    font-weight: 400;
    color: var(--snp-ink);
  }

  /* ── TOAST ── */
  .snp-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--snp-ink);
    color: #ffffff;
    border-radius: 10px;
    padding: 11px 18px;
    font-size: 13px;
    font-weight: 500;
    font-family: var(--font-body);
    z-index: 999;
    display: flex;
    align-items: center;
    gap: 9px;
    box-shadow: 0 8px 24px rgba(16,24,40,0.25);
    animation: snp-toast-in 0.2s ease;
  }
  @keyframes snp-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── EMPTY STATE ── */
  .snp-empty {
    max-width: 880px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 72px 24px;
    gap: 12px;
    background: var(--snp-surface);
    border: 1px dashed var(--snp-border-strong);
    border-radius: 14px;
  }
  .snp-empty-icon {
    font-size: 30px;
    width: 60px; height: 60px;
    border-radius: 50%;
    background: var(--snp-primary-soft);
    display: flex; align-items: center; justify-content: center;
  }
  .snp-empty-text {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--snp-ink-soft);
    letter-spacing: 0.01em;
  }

  /* ── TREATMENT PLAN ── */
  .tp-plan + .tp-plan {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px dashed var(--snp-border-strong);
  }
  .tp-intent-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .tp-badge {
    display: inline-flex;
    align-items: center;
    background: var(--snp-primary-soft);
    color: var(--snp-primary-dark);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .tp-badge.modality { background: var(--snp-blue-soft); color: #24408F; }

  .tp-detail-list { display: flex; flex-direction: column; gap: 0; }
  .tp-detail-row {
    display: flex; gap: 14px;
    padding: 9px 0;
    border-bottom: 1px solid var(--snp-border);
    align-items: flex-start;
  }
  .tp-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
  .tp-detail-label {
    flex: 0 0 130px;
    font-family: var(--font-mono);
    font-size: 10px; font-weight: 500;
    letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--snp-muted); padding-top: 2px;
  }
  .tp-detail-value {
    flex: 1;
    font-size: 13.5px; font-weight: 400;
    color: var(--snp-ink); line-height: 1.6;
  }
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

const isPrimitiveArray = (arr) =>
  Array.isArray(arr) && arr.every((v) => typeof v !== "object" || v === null);

/* Preferred key to use as an entry-card's title when rendering an array of
   objects (medications, investigations, procedures, ...). Falls back to
   the first available key if none of these match. */
const TITLE_KEY_PATTERN = /^(name|drug|test|procedure|title|label|item)$/i;

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

/* ─── PATIENT BAND ────────────────────────────────────────────────────────── */
function PatientBand({ data }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return null;
  return (
    <div className="snp-patient-band">
      {entries.map(([k, v]) => (
        <div className="snp-patient-cell" key={k}>
          <span className="snp-patient-label">{k.replace(/_/g, " ")}</span>
          <span className="snp-patient-value">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── FLAT KV TABLE ───────────────────────────────────────────────────────── */
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

/* ─── ENTRY CARD ──────────────────────────────────────────────────────────── */
/* Renders a single item from an array of objects — a medication, a test, a
   procedure. Picks a sensible title field, then lists whatever else the
   item carries as compact label:value rows underneath. Nested primitive
   arrays (e.g. "areas": ["thorax","abdomen"]) render as tag pills, not a
   bulleted sub-list, so entries stay scannable. Items with only one field
   collapse into a plain checklist row instead of a title-only box. */
function EntryCard({ item }) {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return (
      <div className="snp-entry-simple">
        <span className="snp-entry-dot" />
        <span>{String(item)}</span>
      </div>
    );
  }

  const entries = Object.entries(item).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (!entries.length) return null;

  const titleEntry = entries.find(([k]) => TITLE_KEY_PATTERN.test(k)) || entries[0];
  const [titleKey, titleVal] = titleEntry;
  const rest = entries.filter(([k]) => k !== titleKey);
  const titleText =
    typeof titleVal === "string" || typeof titleVal === "number"
      ? String(titleVal)
      : titleKey.replace(/_/g, " ");

  if (!rest.length) {
    return (
      <div className="snp-entry-simple">
        <span className="snp-entry-dot" />
        <span>{titleText}</span>
      </div>
    );
  }

  return (
    <div className="snp-entry-card">
      <div className="snp-entry-card-title">{titleText}</div>
      <div className="snp-entry-card-meta">
        {rest.map(([k, v]) => (
          <div className="snp-entry-meta-row" key={k}>
            <span className="snp-entry-meta-key">{k.replace(/_/g, " ")}</span>
            {isPrimitiveArray(v) ? (
              <span className="snp-tag-list">
                {v.map((t, ti) => (
                  <span className="snp-tag" key={ti}>{String(t)}</span>
                ))}
              </span>
            ) : isVitalKey(k) && (typeof v === "string" || typeof v === "number") ? (
              <span className="snp-chip">{String(v)}</span>
            ) : (
              <span className="snp-entry-meta-val"><RenderValue value={v} keyName={k} /></span>
            )}
          </div>
        ))}
      </div>
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

    const hasObjectItems = items.some(
      (i) => typeof i === "object" && i !== null && !Array.isArray(i)
    );

    if (hasObjectItems) {
      return (
        <div className="snp-entry-list">
          {items.map((item, i) => (
            <EntryCard item={item} key={i} />
          ))}
        </div>
      );
    }

    return (
      <div className="snp-bullets">
        {items.map((item, i) => (
          <div className="snp-bullet" key={i}>
            <span className="snp-bullet-dot" />
            <span className="snp-text">{String(item)}</span>
          </div>
        ))}
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

/* ─── SINGLE NOTE CARD ────────────────────────────────────────────────────── */
function NoteCard({ section, value }) {
  const icon  = getSectionIcon(section);
  const title = section.replace(/_/g, " ");

  if (section === "triage_category") {
    const key   = typeof value === "string" ? value.toLowerCase() : "";
    const color = TRIAGE_COLORS[key] || TRIAGE_COLORS.blue;
    return (
      <div className="snp-card">
        <div className="snp-card-hd">
          <span className="snp-card-icon-badge">{icon}</span>
          <span className="snp-card-title">{title}</span>
        </div>
        <div className="snp-card-bd">
          <span
            className="snp-triage"
            style={{ background: color.bg, color: color.text, borderColor: color.border }}
          >
            <span className="snp-triage-dot" style={{ background: color.dot }} />
            {typeof value === "string" ? value : <RenderValue value={value} />}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="snp-card">
      <div className="snp-card-hd">
        <span className="snp-card-icon-badge">{icon}</span>
        <span className="snp-card-title">{title}</span>
      </div>
      <div className="snp-card-bd">
        <RenderValue value={value} keyName={section} />
      </div>
    </div>
  );
}

/* ─── TREATMENT PLAN CARD ────────────────────────────────────────────────────
   Handles any section matched by isTreatmentPlanSection(). The backend's
   dynamic structuring means this can arrive in more than one shape:
     - value may be a SINGLE plan object, or a LIST of plan objects
     - beyond intent/modality, everything else (plan_details, guideline,
       patient_specific, supporting_trial with nested steps/prerequisites/
       contraindications/complications/post_procedure_care, cardiac_risk,
       specialty_scope_compliant, etc.) is whatever the model named it, and
       plan_details itself may be plain text OR a list of nested procedure
       objects (per the zero-omission prompt rule).
   Intent/modality are pulled out as small badges up top; everything else
   renders generically & recursively via RenderValue, so nothing nested
   gets dropped or crashes the UI. ── */
function TreatmentPlanCard({ section, value }) {
  const wasArray = Array.isArray(value);
  const plans = wasArray ? value : [value];

  return (
    <div className="snp-card">
      <div className="snp-card-hd">
        <span className="snp-card-icon-badge">💊</span>
        <span className="snp-card-title">{section.replace(/_/g, " ")}</span>
      </div>

      <div className="snp-card-bd">
        {plans.map((plan, pi) => {
          const { intent, modality, ...rest } = plan || {};
          const restEntries = Object.entries(rest).filter(
            ([, v]) => v !== null && v !== undefined && v !== ""
          );

          return (
            <div key={pi} className="tp-plan">
              {(intent || modality) && (
                <div className="tp-intent-row">
                  {intent && <span className="tp-badge">{intent}</span>}
                  {modality && (
                    <span className="tp-badge modality">
                      {Array.isArray(modality) ? modality.join(", ") : modality}
                    </span>
                  )}
                </div>
              )}

              {/* Every other key attached to this plan — rendered generically &
                  recursively, so nested detail (supporting trial steps,
                  prerequisites, contraindications, complications, post-procedure
                  care, cardiac risk, specialty compliance, or several nested
                  procedures under plan_details) always shows up, however deep. */}
              <div className="tp-detail-list">
                {restEntries.map(([k, v]) => (
                  <div key={k} className="tp-detail-row">
                    <span className="tp-detail-label">{k.replace(/_/g, " ")}</span>
                    <span className="tp-detail-value"><RenderValue value={v} keyName={k} /></span>
                  </div>
                ))}
              </div>
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
export default function StructuredNotePanel({ doctorId, patientId }) {
    const [loading, setLoading] = useState(false);
    const [structuredNote, setStructuredNote] = useState(null);
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

    const getLatestStructuredNote = async () => {
        try {
            const res = await fetch(
                `${API_BASE_URL}hms/users/data/context/get-latest-structured-note`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        doctor_id: doctorId,
                        patient_id: patientId
                    })
                }
            );

            const json = await res.json();

            if (json.status === "success" && json.finaloutput) {
                setStructuredNote(json.finaloutput);
                return true;
            }

            return false;
        } catch (err) {
            console.error(err);
            return false;
        }
    };

    const generateNote = async (dictation) => {
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
            if (json.status === "success") setStructuredNote(json.finaloutput);
        } catch (err) { console.error(err); }
        setLoading(false);
    };

    useEffect(() => {
        const load = async () => {
            await getLatestStructuredNote();
        };

        load();
    }, [patientId, doctorId]);

    /* ── DOWNLOADS ── */
    const downloadJSON = () => {
        if (!structuredNote) return;
        triggerDownload(JSON.stringify(structuredNote, null, 2), "structured-note.json", "application/json");
        setShowDownload(false);
        showToast("Downloaded as JSON", "⬇");
    };

    const downloadText = () => {
        if (!structuredNote) return;
        triggerDownload(noteToPlainText(structuredNote), "structured-note.txt", "text/plain");
        setShowDownload(false);
        showToast("Downloaded as text report", "⬇");
    };

    /* ── PDF (letterhead theme, colour restored for clinical legibility) ──
       Teal masthead band, a light-teal patient ID strip pulled to the top,
       section headers with a teal accent rail, entry-style records for
       arrays of objects (each record gets its own bold title + indented
       detail, matching the on-screen entry cards instead of a dense table),
       and a colour-coded triage pill instead of a plain text row. Page
       breaks redraw the header so no section title is ever orphaned at the
       bottom of a page. ── */
    const downloadPDF = () => {
        if (!structuredNote) return;

        const doc = new jsPDF({ unit: "pt", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M = 50;
        const usableW = pageW - M * 2;
        const HEADER_H = 58;
        const TOP_Y = HEADER_H + 36;
        const BOTTOM_LIMIT = pageH - 46;

        const PRIMARY = [14, 124, 134];
        const PRIMARY_DARK = [7, 94, 102];
        const PRIMARY_SOFT = [228, 244, 245];
        const INK = [16, 24, 40];
        const INK_SOFT = [75, 85, 102];
        const MUTED = [138, 148, 166];
        const BORDER = [227, 232, 239];

        let y = TOP_Y;

        const ink  = (rgb) => doc.setTextColor(...rgb);
        const rule = (rgb) => doc.setDrawColor(...rgb);
        const fill = (rgb) => doc.setFillColor(...rgb);
        const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };

        const drawHeader = () => {
            fill(PRIMARY);
            doc.rect(0, 0, pageW, HEADER_H, "F");
            font("bold", 15); ink([255, 255, 255]);
            doc.text("Clinical Structured Note", M, 30);
            font("normal", 8.5); ink([214, 238, 239]);
            doc.text("Patient Summary — Confidential", M, 44);
            font("normal", 8.5); ink([214, 238, 239]);
            const dateStr = new Date().toLocaleDateString("en-US", {
                year: "numeric", month: "long", day: "numeric",
            });
            doc.text(dateStr, pageW - M, 34, { align: "right" });
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

        // ── patient demographics strip ──
        const demo = structuredNote.patient_demographics;
        if (demo && typeof demo === "object") {
            const entries = Object.entries(demo).filter(
                ([, v]) => v !== null && v !== undefined && v !== ""
            );
            if (entries.length) {
                const boxH = 40;
                fill(PRIMARY_SOFT);
                doc.roundedRect(M, y, usableW, boxH, 5, 5, "F");
                fill(PRIMARY);
                doc.rect(M, y, 3.5, boxH, "F");
                const colW = usableW / entries.length;
                entries.forEach(([k, v], i) => {
                    const cx = M + i * colW + 14;
                    font("bold", 7.5); ink(PRIMARY_DARK);
                    doc.text(k.replace(/_/g, " ").toUpperCase(), cx, y + 15);
                    font("bold", 11.5); ink(INK);
                    doc.text(String(v), cx, y + 30);
                    if (i > 0) {
                        rule([196, 226, 227]); doc.setLineWidth(0.6);
                        doc.line(M + i * colW, y + 8, M + i * colW, y + boxH - 8);
                    }
                });
                y += boxH + 22;
            }
        }

        // ── triage pill (rendered specially, not as a generic section) ──
        const triageKey = Object.keys(structuredNote).find((k) => k === "triage_category");
        const drawTriagePill = (value) => {
            const key = typeof value === "string" ? value.toLowerCase() : "";
            const colors = TRIAGE_PDF[key] || TRIAGE_PDF.blue;
            checkPageBreak(40);
            font("bold", 11);
            const label = String(value).toUpperCase();
            const textW = doc.getTextWidth(label);
            const pillW = textW + 34;
            const pillH = 26;
            fill(colors.fill);
            doc.roundedRect(M, y, pillW, pillH, 13, 13, "F");
            ink(colors.text);
            doc.text(label, M + pillW / 2, y + 17, { align: "center" });
            y += pillH + 18;
        };

        // ── recursive value renderer — text-only, no emoji ──
        const renderVal = (val, indentX = M) => {
            if (val === null || val === undefined || val === "") return;

            if (typeof val === "string" || typeof val === "number") {
                font("normal", 10); ink(INK);
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
                const hasObjectItems = items.some((i) => typeof i === "object" && i !== null);

                items.forEach((item, idx) => {
                    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                        const entries = Object.entries(item).filter(
                            ([, v]) => v !== null && v !== undefined && v !== ""
                        );
                        if (!entries.length) return;

                        // pick a title field the same way the UI does
                        const titleEntry =
                            entries.find(([k]) => /^(name|drug|test|procedure|title|label|item)$/i.test(k)) ||
                            entries[0];
                        const [titleKey, titleVal] = titleEntry;
                        const rest = entries.filter(([k]) => k !== titleKey);
                        const titleText =
                            typeof titleVal === "string" || typeof titleVal === "number"
                                ? String(titleVal)
                                : titleKey.replace(/_/g, " ");

                        checkPageBreak(18);
                        fill(PRIMARY);
                        doc.circle(indentX + 2.5, y - 3.5, 2.2, "F");
                        font("bold", 10.5); ink(INK);
                        const titleLines = doc.splitTextToSize(titleText, usableW - (indentX - M) - 14);
                        doc.text(titleLines[0], indentX + 12, y);
                        y += 14;
                        titleLines.slice(1).forEach((l) => {
                            checkPageBreak(14);
                            doc.text(l, indentX + 12, y);
                            y += 14;
                        });

                        rest.forEach(([k, v]) => {
                            checkPageBreak(14);
                            font("bold", 8); ink(MUTED);
                            const label = `${k.replace(/_/g, " ").toUpperCase()}  `;
                            doc.text(label, indentX + 20, y);
                            const labelW = doc.getTextWidth(label);
                            font("normal", 9.5); ink(INK_SOFT);
                            const valText = Array.isArray(v) ? v.join(", ") : String(v);
                            const lines = doc.splitTextToSize(
                                valText,
                                usableW - (indentX - M) - labelW - 20
                            );
                            doc.text(lines[0] || "", indentX + 20 + labelW, y);
                            y += 13.5;
                            lines.slice(1).forEach((l) => {
                                checkPageBreak(13.5);
                                doc.text(l, indentX + 32, y);
                                y += 13.5;
                            });
                        });

                        if (idx < items.length - 1) {
                            checkPageBreak(10);
                            y += 3;
                            rule(BORDER); doc.setLineWidth(0.5);
                            doc.line(indentX, y, M + usableW, y);
                            y += 9;
                        }
                    } else {
                        checkPageBreak(16);
                        fill(PRIMARY);
                        doc.circle(indentX + 2, y - 3, 1.8, "F");
                        font("normal", 10); ink(INK);
                        const lines = doc.splitTextToSize(String(item), usableW - (indentX - M) - 14);
                        lines.forEach((l, li) => {
                            checkPageBreak(16);
                            doc.text(l, indentX + 12, y);
                            if (li < lines.length - 1) y += 15;
                        });
                        y += 15;
                    }
                });
                return;
            }

            if (typeof val === "object") {
                Object.entries(val).forEach(([k, v]) => {
                    if (v === null || v === undefined || v === "") return;
                    checkPageBreak(20);
                    font("bold", 8.5); ink(PRIMARY_DARK);
                    rule(PRIMARY); doc.setLineWidth(1.4);
                    doc.line(indentX, y - 8, indentX, y + 3);
                    doc.text(k.replace(/_/g, " ").toUpperCase(), indentX + 8, y);
                    y += 14;
                    renderVal(v, indentX + 14);
                });
            }
        };

        // ── section rendering as bordered cards, teal accent rail ──
        Object.entries(structuredNote).forEach(([section, value]) => {
            if (section === "patient_demographics") return; // already in the strip above
            if (value === null || value === undefined || value === "") return;

            if (section === "triage_category") {
                checkPageBreak(46);
                font("bold", 10); ink(INK);
                doc.text("TRIAGE CATEGORY", M, y);
                y += 14;
                drawTriagePill(value);
                return;
            }

            checkPageBreak(46);

            fill(PRIMARY_SOFT);
            doc.rect(M, y - 14, usableW, 22, "F");
            fill(PRIMARY);
            doc.rect(M, y - 14, 3, 22, "F");

            font("bold", 10); ink(PRIMARY_DARK);
            doc.text(section.replace(/_/g, " ").toUpperCase(), M + 12, y);

            y += 20;
            renderVal(value, M + 10);
            y += 10;

            checkPageBreak(10);
            rule(BORDER); doc.setLineWidth(0.5);
            doc.line(M, y - 4, pageW - M, y - 4);
            y += 10;
        });

        // ── footer on every page ──
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            fill(BORDER); doc.rect(M, pageH - 34, usableW, 1, "F");
            font("normal", 8); ink(MUTED);
            doc.text(`Page ${i} of ${totalPages}`, pageW - M, pageH - 20, { align: "right" });
            doc.text("Clinical Structured Note — Patient Copy", M, pageH - 20);
        }

        doc.save("structured-note.pdf");
        setShowDownload(false);
        showToast("Downloaded as PDF", "⬇");
    };

    const otherSections = structuredNote
        ? Object.entries(structuredNote).filter(([section]) => section !== "patient_demographics")
        : [];

    /* ── RENDER ── */
    return (
        <>
            <style>{styles}</style>
            <div className="snp">

                {/* TOP BAR */}
                <div className="snp-topbar">
                    <div className="snp-heading-block">
                        <span className="snp-eyebrow">Patient Chart</span>
                        <p className="snp-heading">Clinical Structured Note</p>
                    </div>
                    <div className="snp-topbar-actions">

                        {/* DOWNLOAD */}
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
                                    </div>
                                )}
                            </div>
                        )}

                        {loading && (
                            <button className="snp-btn" disabled>
                                <span className="snp-spinner" />
                                Generating…
                            </button>
                        )}
                    </div>
                </div>

                {/* CARDS */}
                {structuredNote ? (
                    <div className="snp-grid">
                        {structuredNote.patient_demographics &&
                            typeof structuredNote.patient_demographics === "object" && (
                                <PatientBand data={structuredNote.patient_demographics} />
                        )}

                        {otherSections.map(([section, value]) => {
                            if (value === null || value === undefined || value === "") return null;

                            // Any dynamically-named treatment-plan section (single object
                            // or list) gets the richer, nesting-aware card.
                            if (isTreatmentPlanSection(section)) {
                                return (
                                    <TreatmentPlanCard
                                        key={section}
                                        section={section}
                                        value={value}
                                    />
                                );
                            }

                            return (
                                <NoteCard
                                    key={section}
                                    section={section}
                                    value={value}
                                />
                            );
                        })}
                    </div>
                ) : (
                    !loading && (
                        <div className="snp-empty">
                            <div className="snp-empty-icon">🩺</div>
                            <p className="snp-empty-text">
                                No structured note yet for this patient
                            </p>
                        </div>
                    )
                )}
            </div>

            {/* TOAST */}
            {toast && <Toast message={toast.message} icon={toast.icon} />}
        </>
    );
}