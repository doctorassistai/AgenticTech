import React, { useState, useEffect, useRef, useCallback } from "react";
import jsPDF from "jspdf";

const API_BASE_URL =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BACKEND_URL
    ? import.meta.env.VITE_BACKEND_URL
    : "https://doctorassist.ai/api";

/* ─── SECTION CONFIG ─────────────────────────────────────────────────────── */
const SECTION_META = {
  patient_details:                     { icon: "👤",  label: "Patient Details",                    wide: false },
  scene_and_transport:                 { icon: "🚑",  label: "Scene & Transport",                  wide: false },
  presenting_complaints:               { icon: "🩺",  label: "Presenting Complaints",              wide: false },
  allergy_information:                 { icon: "⚠️",  label: "Allergy Information",               wide: false },
  triage_assessment:                   { icon: "🚨",  label: "Triage Assessment",                  wide: true  },
  primary_survey:                      { icon: "🔍",  label: "Primary Survey (ABCDE)",             wide: false },
  vital_signs:                         { icon: "📊",  label: "Vital Signs",                        wide: false },
  haemodynamic_status:                 { icon: "❤️",  label: "Haemodynamic Status",               wide: false },
  respiratory_status:                  { icon: "🫁",  label: "Respiratory Status",                 wide: false },
  neurological_assessment:             { icon: "🧠",  label: "Neurological Assessment",            wide: false },
  physical_examination:                { icon: "🔬",  label: "Physical Examination",               wide: false },
  pain_assessment:                     { icon: "💢",  label: "Pain Assessment",                    wide: false },
  emergency_interventions:             { icon: "💉",  label: "Emergency Interventions",            wide: false },
  fluid_balance:                       { icon: "💧",  label: "Fluid Balance",                      wide: false },
  investigations_ordered:              { icon: "🔬",  label: "Investigations Ordered",             wide: false },
  investigations_results:              { icon: "📋",  label: "Investigation Results",              wide: false },
  provisional_diagnosis:               { icon: "📋",  label: "Provisional Diagnosis",              wide: false },
  contraindications:                   { icon: "⛔",  label: "Contraindications",                  wide: true  },
  monitor_vs_clinical_discrepancies:   { icon: "📡",  label: "Monitor vs Clinical Discrepancies", wide: true  },
  vital_signs_history:                 { icon: "📈",  label: "Vital Signs History",               wide: true  },
  clinical_history_timeline:           { icon: "🕐",  label: "Clinical History Timeline",         wide: true  },
  treatment_provided:                  { icon: "💊",  label: "Treatment Provided",                 wide: false },
  disposition:                         { icon: "🏥",  label: "Disposition",                        wide: false },
  specialist_alerts:                   { icon: "🔔",  label: "Specialist Alerts",                  wide: false },
 clinical_summary:                    { icon: "📝",  label: "Clinical Summary",                   wide: true  },
};

/* ─── TRIAGE COLOURS ─────────────────────────────────────────────────────── */
const TRIAGE_COLORS = {
  green:     { bg: "#fafafa", text: "#000", border: "#000",  dot: "#000"  },
  yellow:    { bg: "#f0f0f0", text: "#000", border: "#444",  dot: "#444"  },
  red:       { bg: "#000000", text: "#fff", border: "#000",  dot: "#fff"  },
  blue:      { bg: "#e8e8e8", text: "#000", border: "#888",  dot: "#888"  },
  immediate: { bg: "#000000", text: "#fff", border: "#000",  dot: "#fff"  },
  urgent:    { bg: "#f0f0f0", text: "#000", border: "#444",  dot: "#444"  },
  delayed:   { bg: "#fafafa", text: "#000", border: "#000",  dot: "#000"  },
};

/* ─── STYLES ─────────────────────────────────────────────────────────────── */
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

  .snp-emergency * { box-sizing: border-box; margin: 0; padding: 0; }

  .snp-emergency {
    font-family: 'Open Sans', sans-serif;
    font-weight: 300;
    background: #fafafa;
    min-height: 100vh;
    padding: 28px 24px;
    color: #000;
  }

  .snp-topbar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #000;
    flex-wrap: wrap; gap: 12px;
  }
  .snp-heading { font-size: 17px; font-weight: 600; color: #000; letter-spacing: -0.3px; }
  .snp-heading span { font-weight: 300; color: #444; }
  .snp-topbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .snp-btn {
    display: inline-flex; align-items: center; gap: 7px;
    background: #000; color: #fff;
    border: 1px solid #000; border-radius: 0;
    padding: 9px 20px;
    font-family: 'Open Sans', sans-serif; font-size: 13px; font-weight: 400;
    letter-spacing: 0.02em; cursor: pointer; transition: background 0.15s ease;
  }
  .snp-btn:hover:not(:disabled) { background: #333; }
  .snp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .snp-btn-outline {
    display: inline-flex; align-items: center; gap: 7px;
    background: #fff; color: #000;
    border: 1px solid #000; border-radius: 0;
    padding: 9px 18px;
    font-family: 'Open Sans', sans-serif; font-size: 13px; font-weight: 400;
    letter-spacing: 0.02em; cursor: pointer; transition: background 0.15s ease;
  }
  .snp-btn-outline:hover:not(:disabled) { background: #f0f0f0; }
  .snp-btn-outline:disabled { opacity: 0.4; cursor: not-allowed; }

  .snp-spinner {
    width: 13px; height: 13px;
    border: 1.5px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: snp-spin 0.65s linear infinite;
  }
  .snp-spinner-dark {
    width: 13px; height: 13px;
    border: 1.5px solid rgba(0,0,0,0.15);
    border-top-color: #000;
    border-radius: 50%;
    animation: snp-spin 0.65s linear infinite;
  }
  @keyframes snp-spin { to { transform: rotate(360deg); } }

  .snp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
  }

  .snp-card {
    background: #fff; border: 1px solid #e0e0e0; border-radius: 0; overflow: hidden;
    opacity: 0; animation: snp-up 0.3s ease forwards;
    transition: border-color 0.15s ease;
  }
  .snp-card:hover { border-color: #000; }
  .snp-card.editing { border-color: #000; }
  .snp-card.wide { grid-column: 1 / -1; }

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
  .snp-card:nth-child(n+13) { animation-delay: .52s }

  @keyframes snp-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .snp-card-hd {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 16px; background: #fafafa; border-bottom: 1px solid #e0e0e0;
  }
  .snp-card-icon { font-size: 14px; line-height: 1; flex-shrink: 0; }
  .snp-card-title {
    font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
    text-transform: uppercase; color: #888; flex: 1;
  }
  .snp-card-actions { display: flex; align-items: center; gap: 3px; margin-left: auto; }
  .snp-icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 0; border: 1px solid transparent;
    background: transparent; cursor: pointer; color: #888; font-size: 12px;
    transition: all 0.12s ease; padding: 0;
  }
  .snp-icon-btn:hover        { border-color: #000; color: #000; background: #f5f5f5; }
  .snp-icon-btn.save         { border-color: #000; color: #000; background: #f5f5f5; }
  .snp-icon-btn.save:hover   { background: #e8e8e8; }
  .snp-icon-btn.cancel       { border-color: #888; color: #888; }
  .snp-icon-btn.cancel:hover { border-color: #000; color: #000; background: #f5f5f5; }

  .snp-card-bd { padding: 16px; }

  .snp-text { font-size: 13px; font-weight: 300; color: #000; line-height: 1.7; }

  .snp-bullets { display: flex; flex-direction: column; gap: 6px; }
  .snp-bullet {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 13px; font-weight: 300; color: #000; line-height: 1.65;
  }
  .snp-bullet-dot {
    width: 4px; height: 4px; border-radius: 0; background: #000;
    flex-shrink: 0; margin-top: 8px;
  }

  .snp-kv-table { display: flex; flex-direction: column; }
  .snp-kv-row {
    display: grid; grid-template-columns: 38% 1fr; gap: 8px;
    align-items: start; padding: 8px 0; border-bottom: 1px solid #f0f0f0;
  }
  .snp-kv-row:last-child  { border-bottom: none; padding-bottom: 0; }
  .snp-kv-row:first-child { padding-top: 0; }
  .snp-kv-key {
    font-size: 10.5px; font-weight: 400; letter-spacing: 0.06em;
    text-transform: capitalize; color: #888; padding-top: 2px; line-height: 1.5;
  }
  .snp-kv-val { font-size: 12.5px; font-weight: 400; color: #000; line-height: 1.55; word-break: break-word; }

  .snp-chip {
    display: inline-flex; align-items: center;
    background: #f5f5f5; border: 1px solid #000; border-radius: 0;
    padding: 2px 8px; font-family: 'Open Sans', monospace;
    font-size: 11.5px; color: #000; font-weight: 400; letter-spacing: 0.04em;
  }

  .snp-nested { display: flex; flex-direction: column; gap: 14px; }
  .snp-nested-label {
    font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em;
    text-transform: uppercase; color: #444; margin-bottom: 6px;
    padding-bottom: 4px; border-bottom: 1px solid #000;
  }

  .snp-triage {
    display: inline-flex; align-items: center; gap: 10px; border-radius: 0;
    padding: 10px 18px; font-size: 13px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase; border-width: 1px; border-style: solid;
  }
  .snp-triage-dot {
    width: 7px; height: 7px; border-radius: 0;
    animation: snp-pulse 1.8s ease-in-out infinite;
  }
  @keyframes snp-pulse { 0%,100%{opacity:1;}50%{opacity:0.3;} }

  .snp-table-wrap { overflow-x: auto; width: 100%; }
  .snp-table {
    width: 100%; border-collapse: collapse;
    font-size: 12px; font-weight: 300;
  }
  .snp-table th {
    font-size: 9.5px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: #888;
    padding: 6px 8px; border-bottom: 1px solid #000;
    text-align: left; white-space: nowrap;
  }
  .snp-table td {
    padding: 7px 8px; border-bottom: 1px solid #f0f0f0;
    color: #000; vertical-align: top; line-height: 1.5;
  }
  .snp-table tr:last-child td { border-bottom: none; }

  .snp-severity-badge {
    display: inline-block; padding: 2px 7px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; border-radius: 0;
  }
  .snp-severity-fatal    { background: #000; color: #fff; }
  .snp-severity-high     { background: #e0e0e0; color: #000; }
  .snp-severity-moderate { background: #f5f5f5; color: #444; }

  .snp-timeline { display: flex; flex-direction: column; gap: 0; }
  .snp-timeline-item {
    display: flex; gap: 14px; padding: 0 0 18px 0; position: relative;
  }
  .snp-timeline-item:not(:last-child)::before {
    content: ''; position: absolute; left: 14px; top: 28px;
    bottom: 0; width: 1px; background: #e0e0e0;
  }
  .snp-timeline-dot {
    width: 28px; height: 28px; border-radius: 0;
    background: #000; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 600; color: #fff;
    z-index: 1; position: relative;
  }
  .snp-timeline-content { flex: 1; }
  .snp-timeline-label {
    font-size: 10px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: #888; margin-bottom: 4px;
  }
  .snp-timeline-status {
    font-size: 12.5px; font-weight: 600; color: #000; margin-bottom: 6px;
  }

  .snp-edit-textarea {
    width: 100%; min-height: 120px;
    font-family: 'Open Sans', monospace; font-size: 12px; font-weight: 300;
    color: #000; background: #fafafa; border: 1px solid #000; border-radius: 0;
    padding: 10px 12px; resize: vertical; outline: none; line-height: 1.65;
  }
  .snp-edit-hint { font-size: 10.5px; font-weight: 300; color: #888; margin-top: 6px; }

  .snp-edit-banner {
    display: flex; align-items: center; gap: 10px;
    background: #fafafa; border: 1px solid #000; border-left: 3px solid #000;
    padding: 10px 16px; margin-bottom: 20px;
    font-size: 12.5px; font-weight: 300; color: #000;
  }

  .snp-toast {
    position: fixed; bottom: 24px; right: 24px;
    background: #000; color: #fff; border-radius: 0;
    padding: 10px 16px; font-size: 13px; font-weight: 300;
    font-family: 'Open Sans', sans-serif; z-index: 9999;
    display: flex; align-items: center; gap: 9px;
    animation: snp-toast-in 0.2s ease;
  }
  @keyframes snp-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .snp-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 72px 24px; gap: 12px; background: #fff;
    border: 1px solid #e0e0e0;
  }
  .snp-empty-icon { font-size: 36px; }
  .snp-empty-text { font-size: 13px; font-weight: 300; color: #888; letter-spacing: 0.02em; text-align: center; max-width: 400px; line-height: 1.6; }

  .snp-error-banner {
    display: flex; align-items: flex-start; gap: 10px;
    background: #fafafa; border: 1px solid #000; border-left: 3px solid #000;
    padding: 12px 16px; margin-bottom: 20px;
  }
  .snp-error-title { font-size: 12px; font-weight: 600; color: #000; margin-bottom: 4px; }
  .snp-error-text { font-size: 11.5px; font-weight: 300; color: #444; line-height: 1.5; }

  .snp-loading-overlay {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 80px 24px; gap: 16px;
  }
  .snp-loading-spinner {
    width: 32px; height: 32px;
    border: 2px solid #e0e0e0; border-top-color: #000;
    border-radius: 50%; animation: snp-spin 0.7s linear infinite;
  }
  .snp-loading-text { font-size: 13px; font-weight: 300; color: #888; }

  .snp-change-badge {
    display: inline-block; padding: 1px 6px;
    font-size: 10px; font-weight: 600; border-radius: 0;
  }
  .snp-change-improved { background: #f0f0f0; color: #000; }
  .snp-change-worsened { background: #000; color: #fff; }
  .snp-change-stable   { background: #e8e8e8; color: #444; }
`;

/* ─── NULL CHECK ──────────────────────────────────────────────────────────── */
const isNullish = (v) =>
  v === null || v === undefined || v === "" || v === "null" || v === "N/A" || v === "n/a";

const filterNulls = (val) => {
  if (isNullish(val)) return null;
  if (Array.isArray(val)) {
    const f = val
      .map((i) => (i && typeof i === "object" ? filterNulls(i) : isNullish(i) ? null : i))
      .filter((i) => i !== null && i !== undefined && i !== "");
    return f.length ? f : null;
  }
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const c = filterNulls(v);
      if (c !== null && c !== undefined && c !== "") out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  return val;
};

const isVitalKey = (k) =>
  /pulse|bp|rr|spo2|heart_rate|respiratory_rate|oxygen_saturation|blood_pressure|temperature|gcs|pain_score|blood_glucose/i.test(k);

const isFlatObj = (obj) =>
  obj !== null &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.values(obj).every(
    (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );

/* ─── PLAIN TEXT SERIALISER ───────────────────────────────────────────────── */
const toPlainText = (val, indent = "") => {
  if (isNullish(val)) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean")
    return String(val);
  if (Array.isArray(val))
    return val
      .filter((v) => !isNullish(v))
      .map((item) => {
        if (item && typeof item === "object")
          return Object.entries(item)
            .filter(([, v]) => !isNullish(v))
            .map(([k, v]) => `${indent}• ${k.replace(/_/g, " ")}: ${toPlainText(v, indent + "  ")}`)
            .join("\n");
        return `${indent}• ${item}`;
      })
      .join("\n");
  return Object.entries(val)
    .filter(([, v]) => !isNullish(v))
    .map(([k, v]) => {
      const nested = toPlainText(v, indent + "  ");
      return nested.includes("\n")
        ? `${indent}${k.replace(/_/g, " ")}:\n${nested}`
        : `${indent}${k.replace(/_/g, " ")}: ${nested}`;
    })
    .join("\n");
};

/* ─── FLAT KV TABLE ───────────────────────────────────────────────────────── */
function FlatKVTable({ data }) {
  const rows = Object.entries(data).filter(([, v]) => !isNullish(v));
  if (!rows.length) return null;
  return (
    <div className="snp-kv-table">
      {rows.map(([k, v]) => (
        <div className="snp-kv-row" key={k}>
          <div className="snp-kv-key">{k.replace(/_/g, " ")}</div>
          <div className="snp-kv-val">
            {isVitalKey(k) ? (
              <span className="snp-chip">{String(v)}</span>
            ) : typeof v === "boolean" ? (
              <span>{v ? "Yes" : "No"}</span>
            ) : (
              <span>{String(v)}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── GENERIC RECURSIVE RENDERER ─────────────────────────────────────────── */
function RenderValue({ value, keyName = "" }) {
  const cleaned = filterNulls(value);
  if (cleaned === null || cleaned === undefined || cleaned === "") return null;

  if (typeof cleaned === "boolean")
    return <p className="snp-text">{cleaned ? "Yes" : "No"}</p>;

  if (typeof cleaned === "string" || typeof cleaned === "number") {
    if (isVitalKey(keyName)) return <span className="snp-chip">{String(cleaned)}</span>;
    return <p className="snp-text">{String(cleaned)}</p>;
  }

  if (Array.isArray(cleaned)) {
    if (!cleaned.length) return null;
    return (
      <div className="snp-bullets">
        {cleaned.map((item, i) => {
          if (typeof item === "object" && item !== null) {
            return (
              <div key={i} style={{ width: "100%" }}>
                {isFlatObj(item) ? (
                  <FlatKVTable data={item} />
                ) : (
                  Object.entries(item)
                    .filter(([, v]) => !isNullish(v))
                    .map(([k, v]) => (
                      <div className="snp-bullet" key={k}>
                        <span className="snp-bullet-dot" />
                        <span>
                          <span style={{ color: "#888", fontSize: 11, marginRight: 5 }}>
                            {k.replace(/_/g, " ")}:
                          </span>
                          <RenderValue value={v} keyName={k} />
                        </span>
                      </div>
                    ))
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

  if (isFlatObj(cleaned)) return <FlatKVTable data={cleaned} />;

  return (
    <div className="snp-nested">
      {Object.entries(cleaned)
        .filter(([, v]) => !isNullish(v))
        .map(([k, v]) => (
          <div key={k}>
            <div className="snp-nested-label">{k.replace(/_/g, " ")}</div>
            <RenderValue value={v} keyName={k} />
          </div>
        ))}
    </div>
  );
}

/* ─── TRIAGE CARD ─────────────────────────────────────────────────────────── */
function TriageCard({ value, onEdit, editing, draftText, setDraftText, onSave, onCancel }) {
  const key = (value.triage_colour || "").toLowerCase();
  const color = TRIAGE_COLORS[key] || TRIAGE_COLORS.blue;

  return (
    <div className={`snp-card wide${editing ? " editing" : ""}`}>
      <div className="snp-card-hd">
        <span className="snp-card-icon">🚨</span>
        <span className="snp-card-title">Triage Assessment</span>
        <div className="snp-card-actions">
          {editing ? (
            <>
              <button className="snp-icon-btn save" onClick={onSave} title="Save">✓</button>
              <button className="snp-icon-btn cancel" onClick={onCancel} title="Cancel">✕</button>
            </>
          ) : (
            <button className="snp-icon-btn" onClick={onEdit} title="Edit">✎</button>
          )}
        </div>
      </div>
      <div className="snp-card-bd">
        {editing ? (
          <>
            <textarea className="snp-edit-textarea" value={draftText} onChange={(e) => setDraftText(e.target.value)} />
            <p className="snp-edit-hint">Edit in plain text. Save with ✓ or cancel with ✕.</p>
          </>
        ) : (
          <div>
            <span className="snp-triage" style={{ background: color.bg, color: color.text, borderColor: color.border }}>
              <span className="snp-triage-dot" style={{ background: color.dot }} />
              {value.triage_colour}
              {value.triage_category && ` · ${value.triage_category}`}
              {value.criticality_score != null && ` · Score: ${value.criticality_score}`}
              {value.risk_level && ` · ${value.risk_level}`}
            </span>
            {value.triage_rationale && (
              <p className="snp-text" style={{ marginTop: 12 }}>{value.triage_rationale}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── DISCREPANCY TABLE ───────────────────────────────────────────────────── */
function DiscrepancyTable({ rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="snp-table-wrap">
      <table className="snp-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Clinician Value</th>
            <th>Clinician Source</th>
            <th>Monitor Value</th>
            <th>Monitor Source</th>
            <th>Significance</th>
            <th>Recommended Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{r.vital_parameter || "—"}</td>
              <td><span className="snp-chip">{r.clinician_value ?? "—"}</span></td>
              <td style={{ color: "#888", fontSize: 11 }}>{r.clinician_source || "—"}</td>
              <td><span className="snp-chip">{r.monitor_value ?? "—"}</span></td>
              <td style={{ color: "#888", fontSize: 11 }}>{r.monitor_source || "—"}</td>
              <td style={{ fontSize: 11 }}>{r.clinical_significance || "—"}</td>
              <td style={{ fontSize: 11 }}>{r.recommended_action || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── VITAL SIGNS HISTORY TABLE ───────────────────────────────────────────── */
function VitalHistoryTable({ rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="snp-table-wrap">
      <table className="snp-table">
        <thead>
          <tr>
            <th>Entry</th>
            <th>Source</th>
            <th>HR</th>
            <th>BP</th>
            <th>RR</th>
            <th>SpO₂</th>
            <th>Temp</th>
            <th>GCS</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600, fontSize: 11 }}>{r.entry_label || `ENTRY-${i + 1}`}</td>
              <td style={{ color: "#888", fontSize: 11 }}>{r.source || "—"}</td>
              <td>{r.heart_rate_bpm != null ? <span className="snp-chip">{r.heart_rate_bpm}</span> : "—"}</td>
              <td>{r.blood_pressure_mmhg ? <span className="snp-chip">{r.blood_pressure_mmhg}</span> : "—"}</td>
              <td>{r.respiratory_rate_bpm != null ? <span className="snp-chip">{r.respiratory_rate_bpm}</span> : "—"}</td>
              <td>{r.spo2_percent != null ? <span className="snp-chip">{r.spo2_percent}%</span> : "—"}</td>
              <td>{r.temperature ? <span className="snp-chip">{r.temperature}</span> : "—"}</td>
              <td>{r.gcs_total != null ? <span className="snp-chip">{r.gcs_total}/15</span> : "—"}</td>
              <td style={{ fontSize: 11 }}>{r.clinical_status || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── CLINICAL TIMELINE ───────────────────────────────────────────────────── */
function ClinicalTimeline({ entries }) {
  if (!entries || !entries.length) return null;
  return (
    <div className="snp-timeline">
      {entries.map((e, i) => {
        const change = (e.change_from_previous || "").toLowerCase();
        return (
          <div className="snp-timeline-item" key={i}>
            <div className="snp-timeline-dot">{i + 1}</div>
            <div className="snp-timeline-content">
              <div className="snp-timeline-label">
                {e.entry_label || `Entry ${i + 1}`}
                {e.source && ` — ${e.source}`}
              </div>
              {e.status_at_this_time && (
                <div className="snp-timeline-status">{e.status_at_this_time}</div>
              )}
              {e.key_findings && e.key_findings.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  {e.key_findings.map((f, j) => (
                    <div className="snp-bullet" key={j}>
                      <span className="snp-bullet-dot" />
                      <span className="snp-text">{f}</span>
                    </div>
                  ))}
                </div>
              )}
              {e.interventions_at_time && e.interventions_at_time.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                    Interventions
                  </div>
                  {e.interventions_at_time.map((it, j) => (
                    <div className="snp-bullet" key={j}>
                      <span className="snp-bullet-dot" />
                      <span className="snp-text">{it}</span>
                    </div>
                  ))}
                </div>
              )}
              {e.change_from_previous && (
                <div style={{ marginTop: 6 }}>
                  <span className={`snp-change-badge ${change === "improved" ? "snp-change-improved" : change === "worsened" ? "snp-change-worsened" : "snp-change-stable"}`}>
                    {e.change_from_previous}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── CONTRAINDICATIONS TABLE ─────────────────────────────────────────────── */
function ContraindicationsTable({ rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r, i) => {
        const sev = (r.severity || "").toLowerCase();
        return (
          <div key={i} style={{ border: "1px solid #e0e0e0", padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>⛔</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{r.contraindicated_action || "—"}</span>
              {r.severity && (
                <span className={`snp-severity-badge ${sev.includes("fatal") ? "snp-severity-fatal" : sev.includes("high") ? "snp-severity-high" : "snp-severity-moderate"}`}>
                  {r.severity}
                </span>
              )}
            </div>
            {r.reason && (
              <div className="snp-kv-row">
                <div className="snp-kv-key">Reason</div>
                <div className="snp-kv-val">{r.reason}</div>
              </div>
            )}
            {r.based_on && (
              <div className="snp-kv-row">
                <div className="snp-kv-key">Based On</div>
                <div className="snp-kv-val">{r.based_on}</div>
              </div>
            )}
            {r.safe_alternative && (
              <div className="snp-kv-row" style={{ borderBottom: "none" }}>
                <div className="snp-kv-key">Safe Alternative</div>
                <div className="snp-kv-val" style={{ color: "#000", fontWeight: 400 }}>{r.safe_alternative}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── SPECIALIST ALERTS ───────────────────────────────────────────────────── */
function SpecialistAlerts({ alerts }) {
  if (!alerts || !alerts.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {alerts.map((a, i) => {
        const urgency = (a.urgency || "").toLowerCase();
        return (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: i < alerts.length - 1 ? "1px solid #f0f0f0" : "none" }}>
            <div style={{ width: 3, flexShrink: 0, alignSelf: "stretch", background: urgency === "immediate" ? "#000" : "#888" }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{a.specialty || "—"}</div>
              {a.reason && <div className="snp-text" style={{ fontSize: 12 }}>{a.reason}</div>}
              {a.urgency && (
                <div style={{ marginTop: 4 }}>
                  <span className={`snp-severity-badge ${urgency === "immediate" ? "snp-severity-fatal" : "snp-severity-moderate"}`}>
                    {a.urgency}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── INFUSION PUMPS ──────────────────────────────────────────────────────── */
function FluidBalanceCard({ data }) {
  if (!data) return null;
  const cleaned = filterNulls(data);
  if (!cleaned) return null;

  const topFields = ["iv_access", "total_fluid_in_ml", "urine_output_ml", "fluid_balance_notes"];
  const fluidsAdm = cleaned.fluids_administered;
  const pumps = cleaned.infusion_pumps;

  return (
    <div>
      <div className="snp-kv-table">
        {topFields.map((k) => {
          if (isNullish(cleaned[k])) return null;
          return (
            <div className="snp-kv-row" key={k}>
              <div className="snp-kv-key">{k.replace(/_/g, " ")}</div>
              <div className="snp-kv-val">
                {typeof cleaned[k] === "boolean" ? (cleaned[k] ? "Yes" : "No") : String(cleaned[k])}
              </div>
            </div>
          );
        })}
      </div>
      {fluidsAdm && fluidsAdm.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="snp-nested-label">Fluids Administered</div>
          <div className="snp-bullets">
            {fluidsAdm.map((f, i) => (
              <div className="snp-bullet" key={i}>
                <span className="snp-bullet-dot" />
                <span className="snp-text">{String(f)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {pumps && pumps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="snp-nested-label">Infusion Pumps</div>
          <div className="snp-table-wrap">
            <table className="snp-table">
              <thead>
                <tr>
                  <th>Pump</th>
                  <th>Flow Rate (ml/hr)</th>
                  <th>Infused (ml)</th>
                </tr>
              </thead>
              <tbody>
                {pumps.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.pump_id || `Pump ${i + 1}`}</td>
                    <td>{p.flow_rate_ml_per_hr != null ? <span className="snp-chip">{p.flow_rate_ml_per_hr}</span> : "—"}</td>
                    <td>{p.infused_ml != null ? <span className="snp-chip">{p.infused_ml}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── EMERGENCY INTERVENTIONS ─────────────────────────────────────────────── */
function EmergencyInterventions({ items }) {
  if (!items || !items.length) return null;
  const hasDetails = items.some((i) => i.medication || i.dosage || i.route || i.time_given);
  if (!hasDetails) {
    return (
      <div className="snp-bullets">
        {items.map((item, i) => (
          <div className="snp-bullet" key={i}>
            <span className="snp-bullet-dot" />
            <span className="snp-text">{item.intervention || String(item)}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="snp-table-wrap">
      <table className="snp-table">
        <thead>
          <tr>
            <th>Intervention</th>
            <th>Medication</th>
            <th>Dosage</th>
            <th>Route</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{r.intervention || "—"}</td>
              <td>{r.medication || "—"}</td>
              <td>{r.dosage || "—"}</td>
              <td>{r.route || "—"}</td>
              <td style={{ fontSize: 11, color: "#888" }}>{r.time_given || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── SECTION RENDERER (picks right component per section) ───────────────── */
function SectionBody({ section, value }) {
  const cleaned = filterNulls(value);
  if (cleaned === null || cleaned === undefined) return null;

  switch (section) {
    case "triage_assessment":
      return null; // handled by TriageCard above

    case "monitor_vs_clinical_discrepancies":
      return Array.isArray(cleaned) ? <DiscrepancyTable rows={cleaned} /> : <RenderValue value={cleaned} keyName={section} />;

    case "vital_signs_history":
      return Array.isArray(cleaned) ? <VitalHistoryTable rows={cleaned} /> : <RenderValue value={cleaned} keyName={section} />;

    case "clinical_history_timeline":
      return Array.isArray(cleaned) ? <ClinicalTimeline entries={cleaned} /> : <RenderValue value={cleaned} keyName={section} />;

    case "contraindications":
      return Array.isArray(cleaned) ? <ContraindicationsTable rows={cleaned} /> : <RenderValue value={cleaned} keyName={section} />;

    case "specialist_alerts":
      return Array.isArray(cleaned) ? <SpecialistAlerts alerts={cleaned} /> : <RenderValue value={cleaned} keyName={section} />;

    case "emergency_interventions":
      return Array.isArray(cleaned) ? <EmergencyInterventions items={cleaned} /> : <RenderValue value={cleaned} keyName={section} />;

    case "fluid_balance":
      return <FluidBalanceCard data={cleaned} />;

    default:
      return <RenderValue value={cleaned} keyName={section} />;
  }
}

/* ─── NOTE CARD ───────────────────────────────────────────────────────────── */
function NoteCard({ section, value, onSave }) {
  const meta = SECTION_META[section] || { icon: "📄", label: section.replace(/_/g, " "), wide: false };
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");

  const startEdit = () => { setDraftText(toPlainText(value)); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    const raw = draftText.trim();
    if (typeof value === "string" || typeof value === "number") {
      onSave(section, raw);
    } else {
      try { onSave(section, JSON.parse(raw)); } catch { onSave(section, raw); }
    }
    setEditing(false);
  };

  // Special triage card
  if (section === "triage_assessment" && value && value.triage_colour) {
    return (
      <TriageCard
        value={value}
        editing={editing}
        draftText={draftText}
        setDraftText={setDraftText}
        onEdit={startEdit}
        onSave={saveEdit}
        onCancel={cancelEdit}
      />
    );
  }

  const isWide = meta.wide;

  return (
    <div className={`snp-card${isWide ? " wide" : ""}${editing ? " editing" : ""}`}>
      <div className="snp-card-hd">
        <span className="snp-card-icon">{meta.icon}</span>
        <span className="snp-card-title">{meta.label}</span>
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
        {editing ? (
          <>
            <textarea className="snp-edit-textarea" value={draftText} onChange={(e) => setDraftText(e.target.value)} />
            <p className="snp-edit-hint">Edit in plain text. Save with ✓ or cancel with ✕.</p>
          </>
        ) : (
          <SectionBody section={section} value={value} />
        )}
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

/* ─── PDF DOWNLOAD ────────────────────────────────────────────────────────── */
/* ─── PDF DOWNLOAD ────────────────────────────────────────────────────────── */
function downloadPDF(structuredNote, showToast) {
  if (!structuredNote) return;

  // SECTIONS TO EXCLUDE FROM PDF
  const EXCLUDED_SECTIONS = ["documentation_confidence"];

  // Filter out excluded sections
  const filteredNote = {};
  Object.keys(structuredNote).forEach((key) => {
    if (!EXCLUDED_SECTIONS.includes(key)) {
      filteredNote[key] = structuredNote[key];
    }
  });

  const doc     = new jsPDF({ unit: "pt", format: "a4" });
  const pageW   = doc.internal.pageSize.getWidth();
  const pageH   = doc.internal.pageSize.getHeight();
  const M       = 48;
  const usableW = pageW - M * 2;
  let y = M;

  const checkBreak = (needed = 20) => {
    if (y + needed > pageH - M) { doc.addPage(); y = M; }
  };
  const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };

  // Header
  doc.setFillColor(0, 0, 0);
  doc.rect(M, y - 14, usableW, 22, "F");
  font("bold", 13);
  doc.setTextColor(255, 255, 255);
  doc.text("EMERGENCY DISCHARGE SUMMARY", M + 10, y);
  y += 8;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(M, y, pageW - M, y);
  y += 20;

  const renderVal = (val, indentX = M) => {
    const cleaned = filterNulls(val);
    if (cleaned === null || cleaned === undefined) return;
    if (typeof cleaned === "string" || typeof cleaned === "number" || typeof cleaned === "boolean") {
      font("normal", 10);
      doc.setTextColor(0, 0, 0);
      const lines = doc.splitTextToSize(String(cleaned), usableW - (indentX - M));
      lines.forEach((line) => { checkBreak(14); doc.text(line, indentX, y); y += 14; });
      return;
    }
    if (Array.isArray(cleaned)) {
      cleaned.filter(Boolean).forEach((item) => {
        if (typeof item === "object") {
          Object.entries(item).filter(([, v]) => !isNullish(v)).forEach(([k, v]) => {
            checkBreak(14);
            font("bold", 9); doc.setTextColor(136, 136, 136);
            const label = `${k.replace(/_/g, " ").toUpperCase()}: `;
            doc.text(label, indentX + 10, y);
            const lw = doc.getTextWidth(label);
            font("normal", 10); doc.setTextColor(0, 0, 0);
            const lines = doc.splitTextToSize(String(v), usableW - (indentX - M) - lw - 10);
            doc.text(lines[0] || "", indentX + 10 + lw, y); y += 14;
            lines.slice(1).forEach((l) => { checkBreak(14); doc.text(l, indentX + 20, y); y += 14; });
          });
        } else {
          checkBreak(14);
          doc.setFillColor(0, 0, 0); doc.rect(indentX + 4, y - 5, 3, 3, "F");
          font("normal", 10); doc.setTextColor(0, 0, 0);
          const lines = doc.splitTextToSize(String(item), usableW - (indentX - M) - 14);
          lines.forEach((l, li) => { checkBreak(14); doc.text(l, indentX + 14, y); if (li < lines.length - 1) y += 14; });
          y += 14;
        }
      });
      return;
    }
    Object.entries(cleaned).filter(([, v]) => !isNullish(v)).forEach(([k, v]) => {
      checkBreak(18);
      font("bold", 8.5); doc.setTextColor(68, 68, 68);
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.8);
      doc.line(indentX + 4, y - 8, indentX + 4, y + 4);
      doc.text(k.replace(/_/g, " ").toUpperCase(), indentX + 10, y);
      y += 13;
      renderVal(v, indentX + 14);
    });
  };

  // Use filteredNote instead of structuredNote
  Object.entries(filteredNote).forEach(([section, value], index) => {
    const cleaned = filterNulls(value);
    if (cleaned === null || cleaned === undefined) return;
    checkBreak(44);
    doc.setFillColor(245, 245, 245); doc.rect(M, y - 13, usableW, 20, "F");
    doc.setFillColor(0, 0, 0);       doc.rect(M, y - 13, 3, 20, "F");
    font("bold", 10); doc.setTextColor(0, 0, 0);
    doc.text(`${index + 1}. ${section.replace(/_/g, " ").toUpperCase()}`, M + 10, y);
    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.25);
    doc.line(M, y + 7, pageW - M, y + 7);
    y += 18;
    renderVal(cleaned, M + 8);
    y += 10;
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(0, 0, 0); doc.rect(M, pageH - 28, usableW, 1, "F");
    font("normal", 8); doc.setTextColor(136, 136, 136);
    doc.text(`Page ${i} of ${totalPages}`, pageW - M, pageH - 16, { align: "right" });
    doc.text("EMERGENCY DISCHARGE SUMMARY — Confidential", M, pageH - 16);
  }

  doc.save("emergency-structured-note.pdf");
  showToast("Downloaded as PDF", "⬇");
}

/* ─── SECTION ORDER ───────────────────────────────────────────────────────── */
const SECTION_ORDER = [
  "patient_details",
  "triage_assessment",
  "presenting_complaints",
  "scene_and_transport",
  "primary_survey",
  "vital_signs",
  "haemodynamic_status",
  "respiratory_status",
  "neurological_assessment",
  "physical_examination",
  "pain_assessment",
  "allergy_information",
  "emergency_interventions",
  "fluid_balance",
  "investigations_ordered",
  "investigations_results",
  "provisional_diagnosis",
  "treatment_provided",
  "specialist_alerts",
  "disposition",
  "contraindications",
  "monitor_vs_clinical_discrepancies",
  "vital_signs_history",
  "clinical_history_timeline",
"clinical_summary",
];

/* ─── MAIN COMPONENT ──────────────────────────────────────────────────────── */
function StructuredNoteEmergency({ doctorId, patientId, onRefresh, onLoadingChange }) {
  const [loading,        setLoading]        = useState(false);
  const [structuredNote, setStructuredNote] = useState(null);
  const [error,          setError]          = useState(null);
  const [toast,          setToast]          = useState(null);
 const [hasFetched, setHasFetched] = useState(true); // Set to true to prevent auto-generation on load
  const toastTimer = useRef(null);

  const showToast = useCallback((message, icon = "✓") => {
    setToast({ message, icon });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const generate = useCallback(async () => {
    if (!doctorId || !patientId) {
      setError("Doctor ID or Patient ID missing. Cannot generate note.");
      return;
    }
    setLoading(true);
    setError(null);
    if (onLoadingChange) onLoadingChange(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/users/ai-legacy/generate-emergency-structured-note`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
        }
      );
      const data = await response.json();
      if (data.status === "success") {
        const note = data.finaloutput || data.structured_note || data.data;
        setStructuredNote(note);
        setHasFetched(true);
        showToast("Discharge summary generated successfully");
        if (onRefresh) onRefresh(note);
      } else {
        const msg = data.detail || data.message || "Failed to generate note";
        setError(msg);
        showToast(msg, "⚠");
      }
    } catch (err) {
      console.error("Error generating Emergency Discharge Summary:", err);
      const msg = "Network error. Please try again.";
      setError(msg);
      showToast(msg, "⚠");
    }
    setLoading(false);
    if (onLoadingChange) onLoadingChange(false);
  }, [doctorId, patientId, onRefresh, onLoadingChange, showToast]);

  // NEW — load any previously generated note on mount. Previously
  // hasFetched was hardcoded true specifically to SKIP auto-generation on
  // load, but nothing ever replaced that skip with an actual fetch of the
  // note that's already saved in emergency_structured_notes — so every
  // remount looked like nothing had ever been generated.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/hms/users/ai-legacy/get-emergency-structured-note/${patientId}`
        );
        if (!res.ok) return; // 404 = nothing generated yet, stay empty
        const data = await res.json();
        if (!cancelled && data.status === "success" && data.data?.structured_note) {
          setStructuredNote(data.data.structured_note);
        }
      } catch (err) {
        console.error("Failed to load existing structured note:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  const handleCardSave = useCallback((section, newValue) => {
    setStructuredNote((prev) => ({ ...prev, [section]: newValue }));
    showToast("Section updated");
  }, [showToast]);

  // Build ordered section list from the note, preserving all non-null fields
 const buildSections = (note) => {
  if (!note) return [];
  
  // SECTIONS TO EXCLUDE FROM DISPLAY
  const EXCLUDED_SECTIONS = ["documentation_confidence"];
  
  const known = new Set(SECTION_ORDER);
  const extra = Object.keys(note).filter((k) => !known.has(k) && !EXCLUDED_SECTIONS.includes(k));
  const ordered = [...SECTION_ORDER, ...extra];
  return ordered
    .filter((section) => {
      // Skip excluded sections
      if (EXCLUDED_SECTIONS.includes(section)) return false;
      
      const cleaned = filterNulls(note[section]);
      if (cleaned === null || cleaned === undefined) return false;
      if (Array.isArray(cleaned) && cleaned.length === 0) return false;
      if (typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) return false;
      return true;
    })
    .map((section) => ({ section, value: note[section] }));
};
  const sections = buildSections(structuredNote);

  /* ── RENDER ── */
  return (
    <>
      <style>{styles}</style>
      <div className="snp-emergency">

        {/* TOP BAR */}
        <div className="snp-topbar">
          <p className="snp-heading">
            Emergency <span>Discharge Summary</span>
          </p>
          <div className="snp-topbar-actions">
            {structuredNote && (
              <button
                className="snp-btn-outline"
                onClick={() => downloadPDF(structuredNote, showToast)}
                title="Download as PDF"
              >
                <span>⬇</span> Download PDF
              </button>
            )}
            <button className="snp-btn" onClick={generate} disabled={loading}>
              {loading
                ? <><span className="snp-spinner" />Generating…</>
                : <><span>✦</span>Generate Discharge Summary</>}
            </button>
          </div>
        </div>

        {/* ERROR BANNER */}
        {error && !loading && (
          <div className="snp-error-banner">
            <span style={{ fontSize: 18 }}>⚠</span>
            <div>
              <div className="snp-error-title">Generation Failed</div>
              <div className="snp-error-text">{error}</div>
              <div className="snp-error-text" style={{ marginTop: 6 }}>
                Ensure clinical data exists for this patient in the system, then click "Generate Discharge Summary"..
              </div>
            </div>
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div className="snp-loading-overlay">
            <div className="snp-loading-spinner" />
            <p className="snp-loading-text">Processing patient data and generating structured note…</p>
          </div>
        )}

        {/* EDIT HINT */}
        {structuredNote && !loading && (
          <div className="snp-edit-banner">
            <span>✎</span>
            Click the <strong style={{ fontWeight: 600 }}>pencil icon</strong> on any card to edit that section.
            Save with ✓ or cancel with ✕.
          </div>
        )}

        {/* CARDS GRID */}
        {structuredNote && !loading ? (
          sections.length > 0 ? (
            <div className="snp-grid">
              {sections.map(({ section, value }) => (
                <NoteCard
                  key={section}
                  section={section}
                  value={value}
                  onSave={handleCardSave}
                />
              ))}
            </div>
          ) : (
            <div className="snp-empty">
              <div className="snp-empty-icon">📋</div>
              <p className="snp-empty-text">Discharge summary was generated but all fields are empty. The patient may have insufficient clinical data on record.</p>
            </div>
          )
        ) : (
          !loading && !error && (
            <div className="snp-empty">
              <div className="snp-empty-icon">🚑</div>
              <p className="snp-empty-text">
Loading the discharge summary for this patient. If nothing appears, click "Generate Discharge Summary".              </p>
            </div>
          )
        )}
      </div>

      {toast && <Toast message={toast.message} icon={toast.icon} />}
    </>
  );
}
export default React.memo(StructuredNoteEmergency);
