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

/* Triage: monochrome — all use black/white/gray instead of colour */
const TRIAGE_COLORS = {
  green:  { bg: "#fafafa", text: "#000000", border: "#000000", dot: "#000000" },
  yellow: { bg: "#f0f0f0", text: "#000000", border: "#444444", dot: "#444444" },
  red:    { bg: "#000000", text: "#ffffff", border: "#000000", dot: "#ffffff" },
  blue:   { bg: "#e8e8e8", text: "#000000", border: "#888888", dot: "#888888" },
};

/* ─── STYLES ──────────────────────────────────────────────────────────────── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

  .snp * { box-sizing: border-box; margin: 0; padding: 0; }

  .snp {
    font-family: 'Open Sans', sans-serif;
    font-weight: 300;
    background: #fafafa;
    min-height: 100vh;
    padding: 28px 24px;
    color: #000000;
  }

  /* ── HEADER BAR ── */
  .snp-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 2px solid #000000;
    flex-wrap: wrap;
    gap: 12px;
  }
  .snp-heading {
    font-size: 17px;
    font-weight: 600;
    color: #000000;
    letter-spacing: -0.3px;
  }
  .snp-heading span { font-weight: 300; color: #444444; }

  .snp-topbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ── BUTTONS ── */
  .snp-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: #000000;
    color: #ffffff;
    border: 1px solid #000000;
    border-radius: 0;
    padding: 9px 20px;
    font-family: 'Open Sans', sans-serif;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .snp-btn:hover:not(:disabled) { background: #333333; }
  .snp-btn:active:not(:disabled) { background: #111111; }
  .snp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .snp-btn-outline {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: #ffffff;
    color: #000000;
    border: 1px solid #000000;
    border-radius: 0;
    padding: 9px 18px;
    font-family: 'Open Sans', sans-serif;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .snp-btn-outline:hover:not(:disabled) { background: #f0f0f0; }
  .snp-btn-outline:active:not(:disabled) { background: #e8e8e8; }
  .snp-btn-outline:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── DROPDOWN ── */
  .snp-dropdown-wrap { position: relative; }
  .snp-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: #ffffff;
    border: 1px solid #000000;
    border-radius: 0;
    min-width: 160px;
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
    padding: 10px 14px;
    font-family: 'Open Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #000000;
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
  }
  .snp-dropdown-item:hover { background: #f5f5f5; }
  .snp-dropdown-divider { height: 1px; background: #e0e0e0; }

  /* ── SPINNER ── */
  .snp-spinner {
    width: 13px; height: 13px;
    border: 1.5px solid rgba(255,255,255,0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: snp-spin 0.65s linear infinite;
  }
  @keyframes snp-spin { to { transform: rotate(360deg); } }

  /* ── GRID (single-column row layout) ── */
  .snp-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── CARD ── */
  .snp-card {
    background: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 0;
    overflow: hidden;
    opacity: 0;
    animation: snp-up 0.3s ease forwards;
    transition: border-color 0.15s ease;
  }
  .snp-card:hover { border-color: #000000; }
  .snp-card.editing { border-color: #000000; }
  .snp-card.wide { /* all cards are full-width; kept for compat */ }

  .snp-card:nth-child(1)  { animation-delay: .04s }
  .snp-card:nth-child(2)  { animation-delay: .08s }
  .snp-card:nth-child(3)  { animation-delay: .12s }
  .snp-card:nth-child(4)  { animation-delay: .16s }
  .snp-card:nth-child(5)  { animation-delay: .20s }
  .snp-card:nth-child(6)  { animation-delay: .24s }
  .snp-card:nth-child(7)  { animation-delay: .28s }
  .snp-card:nth-child(8)  { animation-delay: .32s }
  .snp-card:nth-child(9)  { animation-delay: .36s }
  .snp-card:nth-child(10) { animation-delay: .40s }
  .snp-card:nth-child(11) { animation-delay: .44s }
  .snp-card:nth-child(12) { animation-delay: .48s }

  @keyframes snp-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── CARD HEADER ── */
  .snp-card-hd {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: #fafafa;
    border-bottom: 1px solid #e0e0e0;
  }
  .snp-card-icon { font-size: 13px; line-height: 1; flex-shrink: 0; }
  .snp-card-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #888888;
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
    border-radius: 0;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: #888888;
    font-size: 12px;
    transition: all 0.12s ease;
    padding: 0;
  }
  .snp-icon-btn:hover        { border-color: #000000; color: #000000; background: #f5f5f5; }
  .snp-icon-btn.active       { border-color: #000000; color: #000000; background: #f0f0f0; }
  .snp-icon-btn.save         { border-color: #000000; color: #000000; background: #f5f5f5; }
  .snp-icon-btn.save:hover   { background: #e8e8e8; }
  .snp-icon-btn.cancel       { border-color: #888888; color: #888888; background: transparent; }
  .snp-icon-btn.cancel:hover { border-color: #000000; color: #000000; background: #f5f5f5; }

  /* ── CARD BODY ── */
  .snp-card-bd { padding: 14px; }

  /* ── PLAIN TEXT ── */
  .snp-text { font-size: 13px; font-weight: 300; color: #000000; line-height: 1.7; }

  /* ── BULLET LIST ── */
  .snp-bullets { display: flex; flex-direction: column; gap: 5px; }
  .snp-bullet {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    font-weight: 300;
    color: #000000;
    line-height: 1.65;
  }
  .snp-bullet-dot {
    width: 4px; height: 4px;
    border-radius: 0;
    background: #000000;
    flex-shrink: 0;
    margin-top: 8px;
  }

  /* ── KV TABLE ── */
  .snp-kv-table { display: flex; flex-direction: column; }
  .snp-kv-row {
    display: grid;
    grid-template-columns: 38% 1fr;
    gap: 8px;
    align-items: start;
    padding: 7px 0;
    border-bottom: 1px solid #f0f0f0;
  }
  .snp-kv-row:last-child  { border-bottom: none; padding-bottom: 0; }
  .snp-kv-row:first-child { padding-top: 0; }
  .snp-kv-key {
    font-size: 10.5px;
    font-weight: 400;
    letter-spacing: 0.06em;
    text-transform: capitalize;
    color: #888888;
    padding-top: 2px;
    line-height: 1.5;
  }
  .snp-kv-val {
    font-size: 12.5px;
    font-weight: 400;
    color: #000000;
    line-height: 1.55;
    word-break: break-word;
  }

  /* ── VITAL CHIP ── */
  .snp-chip {
    display: inline-flex;
    align-items: center;
    background: #f5f5f5;
    border: 1px solid #000000;
    border-radius: 0;
    padding: 1px 7px;
    font-family: 'Open Sans', monospace;
    font-size: 11.5px;
    color: #000000;
    font-weight: 400;
    letter-spacing: 0.04em;
  }

  /* ── NESTED SECTION ── */
  .snp-nested { display: flex; flex-direction: column; gap: 12px; }
  .snp-nested-label {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #444444;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid #000000;
  }

  /* ── TRIAGE BADGE ── */
  .snp-triage {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border-radius: 0;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border-width: 1px;
    border-style: solid;
  }
  .snp-triage-dot {
    width: 7px; height: 7px;
    border-radius: 0;
    animation: snp-pulse 1.8s ease-in-out infinite;
  }
  @keyframes snp-pulse {
    0%,100% { opacity:1; }
    50%     { opacity:0.3; }
  }

  /* ── EDIT TEXTAREA ── */
  .snp-edit-textarea {
    width: 100%;
    min-height: 110px;
    font-family: 'Open Sans', monospace;
    font-size: 12px;
    font-weight: 300;
    color: #000000;
    background: #fafafa;
    border: 1px solid #000000;
    border-radius: 0;
    padding: 10px 12px;
    resize: vertical;
    outline: none;
    line-height: 1.65;
    transition: background 0.12s;
  }
  .snp-edit-textarea:focus {
    background: #ffffff;
    border-color: #000000;
  }
  .snp-edit-hint {
    font-size: 10.5px;
    font-weight: 300;
    color: #888888;
    margin-top: 6px;
    line-height: 1.5;
  }

  /* ── EDIT BANNER ── */
  .snp-edit-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #fafafa;
    border: 1px solid #000000;
    border-left: 3px solid #000000;
    border-radius: 0;
    padding: 10px 16px;
    margin-bottom: 16px;
    font-size: 12.5px;
    font-weight: 300;
    color: #000000;
  }

  /* ── TOAST ── */
  .snp-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #000000;
    color: #ffffff;
    border-radius: 0;
    border: 1px solid #000000;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 300;
    font-family: 'Open Sans', sans-serif;
    z-index: 999;
    display: flex;
    align-items: center;
    gap: 9px;
    animation: snp-toast-in 0.2s ease;
  }
  @keyframes snp-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── EMPTY STATE ── */
  .snp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 72px 24px;
    gap: 12px;
    background: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 0;
  }
  .snp-empty-icon { font-size: 36px; }
  .snp-empty-text {
    font-size: 13px;
    font-weight: 300;
    color: #888888;
    letter-spacing: 0.02em;
  }

  /* ── TREATMENT PLAN TABLE ── */
  .tp-plan + .tp-plan {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid #e0e0e0;
  }

  /* ── TREATMENT PLAN DETAIL LIST ── */
  .tp-detail-list { display: flex; flex-direction: column; gap: 0; }
  .tp-detail-row {
    display: flex; gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid #f0f0f0;
    align-items: flex-start;
  }
  .tp-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
  .tp-detail-label {
    flex: 0 0 130px;
    font-family: 'Open Sans', sans-serif;
    font-size: 9.5px; font-weight: 600;
    letter-spacing: 0.10em; text-transform: uppercase;
    color: #888888; padding-top: 2px;
  }
  .tp-detail-value {
    flex: 1;
    font-family: 'Open Sans', sans-serif;
    font-size: 13px; font-weight: 400;
    color: #000000; line-height: 1.55;
  }


  /* ── TREATMENT EDIT FORM ── */
  .tp-edit-meta {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 8px; margin-bottom: 14px;
  }
  .tp-edit-label {
    font-size: 9.5px; font-weight: 600;
    letter-spacing: 0.10em; text-transform: uppercase;
    color: #888888; margin-bottom: 4px;
  }
  .tp-edit-input {
    width: 100%; height: 32px;
    font-family: 'Open Sans', sans-serif;
    font-size: 12.5px; font-weight: 300;
    color: #000000; background: #fafafa;
    border: 1px solid #000000;
    padding: 0 10px; outline: none;
  }
  .tp-edit-input:focus { background: #ffffff; }

  /* ── TREATMENT PLAN TEXTAREA (edit mode) ── */
  .tp-edit-plan-wrap { margin-bottom: 14px; }
  .tp-edit-plan-textarea {
    width: 100%; resize: vertical;
    font-family: 'Open Sans', monospace;
    font-size: 12px; font-weight: 300;
    color: #000000; background: #fafafa;
    border: 1px solid #000000;
    padding: 8px 10px; outline: none;
    line-height: 1.55; box-sizing: border-box;
  }
  .tp-edit-plan-textarea:focus { background: #ffffff; }

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
    return (
      <div className="snp-bullets">
        {items.map((item, i) => {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            return (
              <div key={i} style={{ width: "100%" }}>
                {isFlatObject(item) ? (
                  <FlatKVTable data={item} />
                ) : (
                  Object.entries(item).map(([k, v]) => {
                    if (v === null || v === undefined || v === "") return null;
                    return (
                      <div className="snp-bullet" key={k}>
                        <span className="snp-bullet-dot" />
                        <span>
                          <span style={{ color: "#888888", fontSize: 11, marginRight: 5 }}>
                            {k.replace(/_/g, " ")}:
                          </span>
                          <RenderValue value={v} keyName={k} />
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            );
          }
          return (
            <div className="snp-bullet" key={i}>
              <span className="snp-bullet-dot" />
              <span className="snp-text">{String(item)}</span>
            </div>
          );
        })}
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
function NoteCard({ section, value, onSave }) {
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

  if (section === "triage_category") {
    const key   = typeof value === "string" ? value.toLowerCase() : "";
    const color = TRIAGE_COLORS[key] || TRIAGE_COLORS.blue;
    return (
      <div className={`snp-card wide${editing ? " editing" : ""}`}>
        <div className="snp-card-hd">
          <span className="snp-card-icon">{icon}</span>
          <span className="snp-card-title">{title}</span>
          <div className="snp-card-actions">
            {editing ? (
              <>
                <button className="snp-icon-btn save"   onClick={saveEdit}   title="Save">✓</button>
                <button className="snp-icon-btn cancel" onClick={cancelEdit} title="Cancel">✕</button>
              </>
            ) : (
              <button className="snp-icon-btn" onClick={startEdit} title="Edit">✎</button>
            )}
          </div>
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
              {parseError && <p style={{ color: "#000000", fontSize: 11, marginTop: 6 }}>{parseError}</p>}
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
    <div className={`snp-card${editing ? " editing" : ""}`}>
      <div className="snp-card-hd">
        <span className="snp-card-icon">{icon}</span>
        <span className="snp-card-title">{title}</span>
        <div className="snp-card-actions">
          {editing ? (
            <>
              <button className="snp-icon-btn save"   onClick={saveEdit}   title="Save">✓</button>
              <button className="snp-icon-btn cancel" onClick={cancelEdit} title="Cancel">✕</button>
            </>
          ) : (
            <button className="snp-icon-btn" onClick={startEdit} title="Edit">✎</button>
          )}
        </div>
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
            {parseError && <p style={{ color: "#000000", fontSize: 11, marginTop: 6 }}>{parseError}</p>}
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
   Rather than hardcoding a "plan_details is a string" assumption (which
   breaks the moment the doctor dictates a multi-procedure plan with nested
   trial/complication detail), this renders intent/modality specially and
   renders every other key generically & recursively via RenderValue, so
   nothing nested gets dropped or crashes the UI. ── */
function TreatmentPlanCard({ section, value, onSave }) {
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
        <div className={`snp-card wide${editing ? " editing" : ""}`}>
            <div className="snp-card-hd">
                <span className="snp-card-icon">💊</span>
                <span className="snp-card-title">{section.replace(/_/g, " ")}</span>
                <div className="snp-card-actions">
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
                                    <p style={{ color: "#000000", fontSize: 11, marginTop: 6 }}>{parseErrors[pi]}</p>
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

                                {/* Every other key attached to this plan — rendered generically &
                                    recursively, so nested detail (supporting trial steps,
                                    prerequisites, contraindications, complications, post-procedure
                                    care, cardiac risk, specialty compliance, or several nested
                                    procedures under plan_details) always shows up, however deep. */}
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
            if (json.status === "success") setStructuredNote(json.finaloutput);
        } catch (err) { console.error(err); }
        setLoading(false);
    };

    useEffect(() => { if (dictation) generateNote(); }, [dictation]);

    const handleCardSave = async (section, newValue) => {

    const updatedNote = {
        ...structuredNote,
        [section]: newValue
    };

    setStructuredNote(updatedNote);

    try {

        const res = await fetch(
            `${API_BASE_URL}hms/users/data/context/update-structured-note`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    doctor_id: doctorId,
                    patient_id: patientId,
                              // or note_index
                    structured_note: updatedNote
                })
            }
        );

        const json = await res.json();

        if (json.status === "success") {
            showToast("Section updated successfully");
        }

    } catch (err) {
        console.error(err);
    }
};

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

    /* ── PDF (company theme — monochrome, no emoji glyphs) ──────────────────
       jsPDF's built-in "helvetica" font has no emoji glyphs, so the old
       version rendered 🩺💊📊 as broken boxes. This version is purely
       typographic: a repeated header band, a patient-demographics strip
       pulled to the top, and bordered section cards with a black accent
       bar instead of icons. Page breaks redraw the header so no section
       title is ever left orphaned at the bottom of a page. ── */
    const downloadPDF = () => {
        if (!structuredNote) return;

        const doc = new jsPDF({ unit: "pt", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M = 50;
        const usableW = pageW - M * 2;
        const HEADER_H = 54;
        const TOP_Y = HEADER_H + 34;
        const BOTTOM_LIMIT = pageH - 46;

        let y = TOP_Y;

        const ink  = (r, g, b) => doc.setTextColor(r, g, b);
        const rule = (r, g, b) => doc.setDrawColor(r, g, b);
        const fill = (r, g, b) => doc.setFillColor(r, g, b);
        const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };

        const drawHeader = () => {
            fill(0, 0, 0);
            doc.rect(0, 0, pageW, HEADER_H, "F");
            font("bold", 13); ink(255, 255, 255);
            doc.text("CLINICAL STRUCTURED NOTE", M, 34);
            font("normal", 8); ink(210, 210, 210);
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

        // needed = vertical space required before the next page break check
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
                const boxH = 36;
                rule(0, 0, 0); doc.setLineWidth(0.75);
                doc.rect(M, y, usableW, boxH);
                const colW = usableW / entries.length;
                entries.forEach(([k, v], i) => {
                    const cx = M + i * colW + 12;
                    font("bold", 7.5); ink(120, 120, 120);
                    doc.text(k.replace(/_/g, " ").toUpperCase(), cx, y + 14);
                    font("normal", 11); ink(0, 0, 0);
                    doc.text(String(v), cx, y + 28);
                    if (i > 0) {
                        rule(220, 220, 220); doc.setLineWidth(0.5);
                        doc.line(M + i * colW, y + 6, M + i * colW, y + boxH - 6);
                    }
                });
                y += boxH + 22;
            }
        }

        // ── recursive value renderer — text-only, no emoji ──
        const renderVal = (val, indentX = M) => {
            if (val === null || val === undefined || val === "") return;

            if (typeof val === "string" || typeof val === "number") {
                font("normal", 10); ink(20, 20, 20);
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
                items.forEach((item, idx) => {
                    if (typeof item === "object" && item !== null) {
                        Object.entries(item).forEach(([k, v]) => {
                            if (v === null || v === undefined || v === "") return;
                            checkPageBreak(16);
                            font("bold", 8.5); ink(115, 115, 115);
                            const label = `${k.replace(/_/g, " ").toUpperCase()}  `;
                            doc.text(label, indentX + 12, y);
                            const labelW = doc.getTextWidth(label);
                            font("normal", 10); ink(20, 20, 20);
                            const lines = doc.splitTextToSize(
                                String(v),
                                usableW - (indentX - M) - labelW - 12
                            );
                            doc.text(lines[0] || "", indentX + 12 + labelW, y);
                            y += 15;
                            lines.slice(1).forEach((l) => {
                                checkPageBreak(16);
                                doc.text(l, indentX + 24, y);
                                y += 15;
                            });
                        });
                        if (idx < items.length - 1) {
                            checkPageBreak(10);
                            rule(235, 235, 235); doc.setLineWidth(0.5);
                            doc.line(indentX, y - 4, M + usableW, y - 4);
                            y += 6;
                        }
                    } else {
                        checkPageBreak(16);
                        // clean square bullet — no emoji/circle glyph reliance
                        fill(0, 0, 0);
                        doc.rect(indentX, y - 8, 3, 3, "F");
                        font("normal", 10); ink(20, 20, 20);
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
                    font("bold", 8.5); ink(95, 95, 95);
                    rule(0, 0, 0); doc.setLineWidth(1);
                    doc.line(indentX, y - 8, indentX, y + 3);
                    doc.text(k.replace(/_/g, " ").toUpperCase(), indentX + 8, y);
                    y += 14;
                    renderVal(v, indentX + 14);
                });
            }
        };

        // ── section rendering as bordered cards, text-only headers ──
        Object.entries(structuredNote).forEach(([section, value]) => {
            if (section === "patient_demographics") return; // already in the strip above
            if (value === null || value === undefined || value === "") return;

            checkPageBreak(46); // ensure header + a first line of content fit together

            fill(246, 246, 246);
            doc.rect(M, y - 14, usableW, 22, "F");
            fill(0, 0, 0);
            doc.rect(M, y - 14, 3, 22, "F");

            font("bold", 10); ink(0, 0, 0);
            doc.text(section.replace(/_/g, " ").toUpperCase(), M + 12, y);

            y += 18;
            renderVal(value, M + 10);
            y += 12;

            checkPageBreak(10);
            rule(228, 228, 228); doc.setLineWidth(0.5);
            doc.line(M, y - 4, pageW - M, y - 4);
            y += 10;
        });

        // ── footer on every page ──
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            fill(0, 0, 0); doc.rect(M, pageH - 34, usableW, 1, "F");
            font("normal", 8); ink(140, 140, 140);
            doc.text(`Page ${i} of ${totalPages}`, pageW - M, pageH - 20, { align: "right" });
            doc.text("Clinical Structured Note — Confidential", M, pageH - 20);
        }

        doc.save("structured-note.pdf");
        setShowDownload(false);
        showToast("Downloaded as PDF", "⬇");
    };

    /* ── RENDER ── */
    return (
        <>
            <style>{styles}</style>
            <div className="snp">

                {/* TOP BAR */}
                <div className="snp-topbar">
                    <p className="snp-heading">
                        Clinical <span>Structured Note</span>
                    </p>
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

                        {/* GENERATE */}
                        <button className="snp-btn" onClick={generateNote} disabled={loading}>
                            {loading
                                ? <><span className="snp-spinner" />Generating…</>
                                : <><span>✦</span>Generate Structured Note</>}
                        </button>
                    </div>
                </div>

                {/* EDIT HINT BANNER */}
                {structuredNote && (
                    <div className="snp-edit-banner">
                        <span>✎</span>
                        Click the <strong style={{ fontWeight: 600 }}>pencil icon</strong> on any card to edit that section.
                        Save with ✓ or cancel with ✕.
                    </div>
                )}

                {/* CARDS */}
                {structuredNote ? (
                    <div className="snp-grid">
                        {Object.entries(structuredNote).map(([section, value]) => {
                            if (value === null || value === undefined || value === "") return null;

                            // Any dynamically-named treatment-plan section (single object
                            // or list) gets the richer, nesting-aware card.
                            if (isTreatmentPlanSection(section)) {
                                return (
                                    <TreatmentPlanCard
                                        key={section}
                                        section={section}
                                        value={value}
                                        onSave={handleCardSave}
                                    />
                                );
                            }

                            return (
                                <NoteCard
                                    key={section}
                                    section={section}
                                    value={value}
                                    onSave={handleCardSave}
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

            {/* TOAST */}
            {toast && <Toast message={toast.message} icon={toast.icon} />}
        </>
    );
}