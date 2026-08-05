import React, { useState, useRef, useEffect } from "react";
import {
  User, Calendar, Phone, Mail, MapPin, HeartPulse,
  GraduationCap, Briefcase, DollarSign, FileText,
  ChevronRight, ArrowLeft, Plus, UserCheck, AlertCircle,
  CheckCircle, Loader, Home, Activity,
  BriefcaseMedical, Clock, CalendarCheck, CalendarPlus, LogOut,
  Mic, MicOff, Send, X, ChevronDown, Stethoscope, ShieldAlert,
  Star, Award, BadgeCheck, QrCode, Upload, Smartphone,
  Check, RefreshCw, ScanLine,
} from "lucide-react";

const API_BASE_URL = window.PATIENT_WIDGET_API || "https://doctorassist.ai/api/";

const GENDERS        = ["Male", "Female", "Other"];
const MARITAL_STATUS = ["Single", "Married", "Divorced", "Widowed"];
const BLOOD_GROUPS   = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const getHospitalIdFromUrl = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('hospital_id');
};

const T = {
  bg:        "#ffffff",
  bgAlt:     "#fafafa",
  bgTert:    "#f5f5f5",
  text:      "#000000",
  textSec:   "#444444",
  textMuted: "#888888",
  border:    "#e0e0e0",
  borderStr: "#000000",
  font:      "'Open Sans', sans-serif",
};

const SEVERITY_CONFIG = {
  low:      { color: "#2d7a3a", bg: "#f0faf1", border: "#a8d5ae", label: "Low Priority" },
  moderate: { color: "#7a5c00", bg: "#fffbf0", border: "#f0d080", label: "Moderate" },
  high:     { color: "#c05000", bg: "#fff5f0", border: "#f0b090", label: "High Urgency" },
  critical: { color: "#cc0000", bg: "#fff0f0", border: "#f09090", label: "Critical" },
};

/* ── Default slots 9:30 AM – 7:30 PM, 30-min intervals ── */
function generateDefaultSlots() {
  const slots = [];
  let h = 9, m = 30;
  while (h < 19 || (h === 19 && m <= 30)) {
    const period = h < 12 ? "AM" : "PM";
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    slots.push(`${displayH}:${m === 0 ? "00" : m} ${period}`);
    m += 30;
    if (m >= 60) { m = 0; h++; }
  }
  return slots;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Simple placeholder QR SVG ── */
function PlaceholderQR({ size = 160 }) {
  const cells = [];
  // Generate a deterministic grid pattern for visual QR look
  const seed = [
    [1,1,1,1,1,1,1,0,1,0,1,0,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,1,0,0,1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,0,1,0,1,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,0,1,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1,0,1,1,1,1,1,1,1],
    [0,0,0,0,0,0,0,0,1,1,0,1,0,0,0,0,0,0,0],
    [1,0,1,1,0,1,1,1,0,1,1,0,1,1,0,1,1,0,1],
    [0,1,0,0,1,0,0,0,1,0,0,1,0,0,1,0,0,1,0],
    [1,1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1,1,1],
    [0,0,0,0,0,0,0,0,1,0,1,0,0,1,0,1,0,0,0],
    [1,1,1,1,1,1,1,0,0,1,1,0,1,0,1,0,1,1,0],
    [1,0,0,0,0,0,1,0,1,0,0,1,0,1,0,1,0,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,1,0,1,1,0,1,0],
    [1,0,1,1,1,0,1,0,1,0,0,1,0,1,0,0,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,1,1,0,1,0,1,0],
    [1,0,0,0,0,0,1,0,1,0,0,0,1,0,1,0,1,0,1],
    [1,1,1,1,1,1,1,0,0,1,1,0,0,1,0,1,0,1,0],
  ];
  const n = seed.length;
  const cellSize = size / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (seed[r][c]) {
        cells.push(
          <rect key={`${r}-${c}`} x={c * cellSize} y={r * cellSize}
            width={cellSize} height={cellSize} fill="#000" />
        );
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}>
      <rect width={size} height={size} fill="white" />
      {cells}
    </svg>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::selection { background: #000; color: #fff; }

  .pp-root {
    font-family: ${T.font};
    font-weight: 300;
    background: ${T.bg};
    color: ${T.text};
    min-height: 100vh;
    display: flex;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Sidebar ── */
  .pp-sidebar {
    width: 240px; min-height: 100vh;
    position: fixed; top: 0; left: 0;
    background: ${T.bg}; border-right: 1px solid ${T.border};
    display: flex; flex-direction: column; z-index: 100;
  }
  .pp-sidebar-header { padding: 1.5rem 1.5rem 1rem; border-bottom: 1px solid ${T.border}; }
  .pp-brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 1.25rem; }
  .pp-brand-name { font-size: 0.9rem; font-weight: 400; letter-spacing: -0.01em; color: ${T.text}; }
  .pp-sidebar-nav { flex: 1; padding: 0.75rem 0; }
  .pp-nav-group-label {
    font-size: 0.58rem; text-transform: uppercase;
    letter-spacing: 0.15em; color: ${T.textMuted};
    font-weight: 400; padding: 0.5rem 1.25rem 0.25rem; display: block;
  }
  .pp-nav-btn {
    width: 100%; background: transparent; border: none;
    text-align: left; padding: 0.55rem 1.25rem;
    font-size: 0.78rem; font-weight: 300; color: ${T.textSec};
    cursor: pointer; display: flex; align-items: center; gap: 10px;
    transition: all 0.15s; font-family: ${T.font};
    border-left: 2px solid transparent;
  }
  .pp-nav-btn:hover { background: ${T.bgAlt}; color: ${T.text}; }
  .pp-nav-btn.active { background: ${T.bgAlt}; color: ${T.text}; font-weight: 400; border-left-color: ${T.borderStr}; }

  .pp-step-track { padding: 1.25rem 1.5rem; border-top: 1px solid ${T.border}; }
  .pp-step-row { display: flex; align-items: center; gap: 0; margin-bottom: 0.5rem; }
  .pp-step-num {
    width: 28px; height: 28px; border: 1px solid ${T.border};
    display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem; font-weight: 400; flex-shrink: 0;
    color: ${T.textMuted}; background: ${T.bg}; transition: all 0.2s;
  }
  .pp-step-num.active { background: ${T.text}; color: ${T.bg}; border-color: ${T.text}; }
  .pp-step-num.done  { background: ${T.bgAlt}; color: ${T.text}; border-color: ${T.borderStr}; }
  .pp-step-line { flex: 1; height: 1px; background: ${T.border}; margin: 0 4px; }
  .pp-step-line.done { background: ${T.borderStr}; }
  .pp-step-label { font-size: 0.65rem; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 0.25rem; }
  .pp-step-label span { color: ${T.text}; font-weight: 400; }

  .pp-sidebar-footer { padding: 1rem 1.25rem; border-top: 1px solid ${T.border}; flex-shrink: 0; }
  .pp-logout-btn {
    width: 100%; background: transparent; border: 1px solid ${T.border};
    padding: 0.6rem 1rem; font-size: 0.75rem; font-weight: 400;
    color: ${T.textSec}; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-family: ${T.font}; transition: all 0.2s;
  }
  .pp-logout-btn:hover { border-color: ${T.borderStr}; color: ${T.text}; }

 .pp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  .pp-topbar {
    position: sticky; top: 0; z-index: 50;
    background: ${T.bg}; border-bottom: 1px solid ${T.border};
    padding: 0.875rem 2rem;
    display: flex; justify-content: space-between; align-items: center;
  }
  .pp-page-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.2em; color: ${T.textMuted}; font-weight: 400; display: block; margin-bottom: 0.15rem; }
  .pp-page-title { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; color: ${T.text}; margin: 0; }
  .pp-progress-pills { display: flex; gap: 1px; background: ${T.border}; }
  .pp-progress-pill { padding: 0.4rem 0.875rem; background: ${T.bg}; font-size: 0.65rem; font-weight: 300; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.1em; transition: all 0.15s; }
  .pp-progress-pill.active { background: ${T.text}; color: ${T.bg}; font-weight: 400; }
  .pp-progress-pill.done  { background: ${T.bgAlt}; color: ${T.text}; }

  .pp-body { padding: 2rem; flex: 1; }

  .pp-form-section { border: 1px solid ${T.border}; margin-bottom: 1.5rem; }
  .pp-form-section-header { padding: 0.875rem 1.25rem; background: ${T.bgAlt}; border-bottom: 1px solid ${T.border}; display: flex; align-items: center; gap: 8px; }
  .pp-form-section-title { font-size: 0.72rem; font-weight: 400; text-transform: uppercase; letter-spacing: 0.12em; color: ${T.text}; }
  .pp-form-section-body { padding: 1.5rem; display: grid; gap: 1.25rem; }

  .pp-field { display: flex; flex-direction: column; gap: 0.4rem; }
  .pp-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.15em; color: ${T.textMuted}; font-weight: 400; display: flex; align-items: center; gap: 5px; }
  .pp-label .req { color: ${T.text}; font-weight: 600; margin-left: 2px; }
  .pp-input {
    width: 100%; height: 42px; padding: 0 0.875rem;
    border: 1px solid ${T.border}; background: ${T.bg};
    font-family: ${T.font}; font-weight: 300;
    font-size: 0.82rem; color: ${T.text};
    outline: none; border-radius: 0; transition: border-color 0.15s; appearance: none;
  }
  .pp-input::placeholder { color: #bbbbbb; font-weight: 300; }
  .pp-input:focus { border-color: ${T.borderStr}; }
  .pp-input:hover { border-color: #c0c0c0; }
  textarea.pp-input { height: auto; padding: 0.65rem 0.875rem; resize: vertical; }
  select.pp-input { cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 2rem; }
  .pp-input-hint { font-size: 0.65rem; color: ${T.textMuted}; margin-top: 2px; }

  .pp-btn-row { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 0 0; border-top: 1px solid ${T.border}; gap: 0.75rem; }
  .pp-btn-primary { padding: 0.65rem 1.75rem; background: ${T.text}; color: ${T.bg}; border: 1px solid ${T.text}; font-family: ${T.font}; font-size: 0.78rem; font-weight: 400; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.04em; }
  .pp-btn-primary:hover { background: transparent; color: ${T.text}; }
  .pp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .pp-btn-outline { padding: 0.65rem 1.25rem; background: ${T.bg}; color: ${T.textSec}; border: 1px solid ${T.border}; font-family: ${T.font}; font-size: 0.78rem; font-weight: 300; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px; }
  .pp-btn-outline:hover { border-color: ${T.borderStr}; color: ${T.text}; }

  .pp-message { margin-top: 1rem; padding: 0.75rem 1rem; border-left: 2px solid ${T.borderStr}; font-size: 0.78rem; line-height: 1.6; background: ${T.bgAlt}; display: flex; align-items: flex-start; gap: 8px; }
  .pp-message.error { border-left-color: #cc0000; }
  .pp-message.success { border-left-color: #000; }

  .pp-profile-card { border: 1px solid ${T.border}; margin-bottom: 1.5rem; overflow: hidden; }
  .pp-profile-header { background: ${T.text}; color: ${T.bg}; padding: 1.5rem; display: flex; align-items: center; gap: 1.25rem; }
  .pp-avatar { width: 52px; height: 52px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .pp-patient-name { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; }
  .pp-patient-sub { font-size: 0.7rem; font-weight: 300; color: rgba(255,255,255,0.6); margin-top: 0.2rem; letter-spacing: 0.05em; text-transform: uppercase; }
  .pp-profile-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: none; }
  .pp-profile-cell { padding: 1rem 1.25rem; border-right: 1px solid ${T.border}; border-bottom: 1px solid ${T.border}; }
  .pp-profile-cell:nth-child(3n) { border-right: none; }
  .pp-profile-cell-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.15em; color: ${T.textMuted}; font-weight: 400; margin-bottom: 0.3rem; display: flex; align-items: center; gap: 5px; }
  .pp-profile-cell-value { font-size: 0.82rem; color: ${T.text}; font-weight: 300; }

  .pp-entry-wrap { max-width: 480px; margin: 4rem auto 0; }
  .pp-entry-title { font-size: 1rem; font-weight: 400; letter-spacing: -0.01em; margin-bottom: 0.25rem; }
  .pp-entry-sub { font-size: 0.75rem; color: ${T.textMuted}; font-weight: 300; margin-bottom: 2rem; line-height: 1.6; }
  .pp-divider { display: flex; align-items: center; gap: 0.75rem; margin: 1.5rem 0; color: ${T.textMuted}; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; }
  .pp-divider-line { flex: 1; height: 1px; background: ${T.border}; }
  .pp-register-link { width: 100%; padding: 0.65rem 1rem; background: ${T.bg}; border: 1px solid ${T.border}; font-family: ${T.font}; font-size: 0.78rem; font-weight: 300; color: ${T.textSec}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.08em; }
  .pp-register-link:hover { border-color: ${T.borderStr}; color: ${T.text}; }
  .pp-notice { padding: 0.6rem 0.875rem; background: ${T.bgTert}; border-left: 2px solid ${T.borderStr}; font-size: 0.67rem; color: ${T.textSec}; margin-bottom: 1rem; line-height: 1.5; }

  .pp-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .pp-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .pp-col-3  { grid-column: span 3; }
  .pp-col-2  { grid-column: span 2; }

  .pp-spinning { display: inline-block; animation: pp-spin 0.8s linear infinite; }
  @keyframes pp-spin { to { transform: rotate(360deg); } }

  /* ── Triage result summary card ── */
  .pp-triage-summary {
    border: 1px solid ${T.border};
    margin-bottom: 1.5rem;
    animation: pp-fade-in 0.4s ease;
  }
  @keyframes pp-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .pp-triage-summary-header {
    padding: 0.875rem 1.25rem;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid ${T.border};
  }
  .pp-triage-summary-title { font-size: 0.72rem; font-weight: 400; text-transform: uppercase; letter-spacing: 0.12em; display: flex; align-items: center; gap: 8px; }
  .pp-severity-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 0.25rem 0.65rem;
    font-size: 0.62rem; font-weight: 400;
    text-transform: uppercase; letter-spacing: 0.1em;
    border: 1px solid;
  }
  .pp-triage-summary-body { padding: 1.25rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .pp-triage-summary-body .pp-info-block { display: flex; flex-direction: column; gap: 0.3rem; }
  .pp-triage-summary-body .pp-info-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; color: ${T.textMuted}; }
  .pp-triage-summary-body .pp-info-value { font-size: 0.82rem; color: ${T.text}; font-weight: 300; line-height: 1.5; }

  /* ── Doctor selection cards ── */
  .pp-doctor-select-card {
    border: 1px solid ${T.border};
    padding: 1rem 1.25rem;
    cursor: pointer;
    transition: all 0.15s;
    display: flex; align-items: center; gap: 12px;
    background: ${T.bg};
  }
  .pp-doctor-select-card:hover { border-color: #c0c0c0; background: ${T.bgAlt}; }
  .pp-doctor-select-card.selected {
    border-color: ${T.borderStr};
    border-left: 3px solid ${T.borderStr};
    background: ${T.bgAlt};
  }
  .pp-doctor-rank-badge {
    width: 28px; height: 28px; background: ${T.text}; color: ${T.bg};
    display: flex; align-items: center; justify-content: center;
    font-size: 0.72rem; font-weight: 400; flex-shrink: 0;
  }
  .pp-doctor-rank-badge.rank2 { background: ${T.bgTert}; color: ${T.textSec}; border: 1px solid ${T.border}; }
  .pp-doctor-rank-badge.rank3 { background: ${T.bgTert}; color: ${T.textSec}; border: 1px solid ${T.border}; }

  /* ── Slot buttons ── */
  .pp-slot-btn {
    padding: 0.4rem 0.75rem;
    border: 1px solid ${T.border};
    background: ${T.bg};
    font-family: ${T.font}; font-size: 0.72rem; font-weight: 300;
    color: ${T.textSec}; cursor: pointer;
    transition: all 0.12s;
    white-space: nowrap;
  }
  .pp-slot-btn:hover:not(:disabled) { border-color: ${T.borderStr}; color: ${T.text}; }
  .pp-slot-btn.selected { background: ${T.text}; color: ${T.bg}; border-color: ${T.borderStr}; font-weight: 400; }
  .pp-slot-btn:disabled { background: ${T.bgTert}; color: #cccccc; cursor: not-allowed; opacity: 0.6; text-decoration: line-through; }

  /* ── QR section ── */
  .pp-qr-section { border: 2px dashed ${T.border}; padding: 2.5rem; text-align: center; margin-bottom: 1.5rem; }
  .pp-qr-open-btn {
    width: 100%; padding: 1.25rem 1.75rem;
    background: ${T.text}; color: ${T.bg};
    border: none; font-family: ${T.font};
    font-size: 1rem; font-weight: 400;
    cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    letter-spacing: 0.04em; margin-bottom: 1.5rem;
  }
  .pp-qr-open-btn:hover { background: transparent; color: ${T.text}; border: 1px solid ${T.borderStr}; }

  /* ── Confirm section ── */
  .pp-confirm-summary { border: 1px solid ${T.borderStr}; padding: 1.5rem; margin-bottom: 1.5rem; }
  .pp-confirm-row { display: flex; align-items: baseline; padding: 0.5rem 0; border-bottom: 1px solid ${T.border}; }
  .pp-confirm-row:last-child { border-bottom: none; }
  .pp-confirm-key { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.15em; color: ${T.textMuted}; width: 140px; flex-shrink: 0; }
  .pp-confirm-val { font-size: 0.82rem; color: ${T.text}; font-weight: 300; flex: 1; }

  /* ── Appointment booking section ── */
  .pp-appt-section {
    border: 1px solid ${T.border};
    margin-bottom: 1.5rem;
    animation: pp-fade-in 0.4s ease;
  }
  .pp-appt-section-header {
    padding: 0.875rem 1.25rem;
    background: ${T.bgAlt}; border-bottom: 1px solid ${T.border};
    display: flex; align-items: center; justify-content: space-between;
  }
  .pp-appt-section-title { font-size: 0.72rem; font-weight: 400; text-transform: uppercase; letter-spacing: 0.12em; display: flex; align-items: center; gap: 8px; }
  .pp-appt-section-body { padding: 1.5rem; }

  .pp-doctors-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0; border-top: 1px solid ${T.border}; }
  .pp-doctor-cell { padding: 1rem 1.25rem; border-right: 1px solid ${T.border}; }
  .pp-doctor-cell:last-child { border-right: none; }
  .pp-doctor-rank { font-size: 0.58rem; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.3rem; display: flex; align-items: center; gap: 5px; }
  .pp-doctor-name { font-size: 0.85rem; font-weight: 400; margin-bottom: 0.15rem; }
  .pp-doctor-spec { font-size: 0.7rem; color: ${T.textSec}; font-weight: 300; text-transform: capitalize; }
  .pp-doctor-qual { font-size: 0.65rem; color: ${T.textMuted}; margin-top: 0.15rem; }
  .pp-doctor-reason { font-size: 0.65rem; color: ${T.textSec}; margin-top: 0.4rem; line-height: 1.4; padding-top: 0.4rem; border-top: 1px solid ${T.border}; }

  /* ══════════════════════════════════════
     TRIAGE MODAL
  ══════════════════════════════════════ */
  .pp-modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
    animation: pp-overlay-in 0.25s ease;
  }
  @keyframes pp-overlay-in { from { opacity: 0; } to { opacity: 1; } }
  .pp-modal-overlay.closing { animation: pp-overlay-out 0.3s ease forwards; }
  @keyframes pp-overlay-out { from { opacity: 1; } to { opacity: 0; } }

  .pp-modal {
    background: ${T.bg};
    border: 1px solid ${T.borderStr};
    width: 100%; max-width: 640px;
    max-height: 88vh;
    display: flex; flex-direction: column;
    animation: pp-modal-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }
  @keyframes pp-modal-in { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .pp-modal.closing { animation: pp-modal-out 0.25s ease forwards; }
  @keyframes pp-modal-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(16px) scale(0.98); } }

  .pp-modal-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid ${T.border};
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0; background: ${T.bgAlt};
  }
  .pp-modal-title { font-size: 0.78rem; font-weight: 400; text-transform: uppercase; letter-spacing: 0.12em; display: flex; align-items: center; gap: 8px; }
  .pp-modal-close { background: transparent; border: 1px solid ${T.border}; width: 30px; height: 30px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: ${T.textMuted}; transition: all 0.15s; }
  .pp-modal-close:hover { border-color: ${T.borderStr}; color: ${T.text}; }

  .pp-modal-body { flex: 1; overflow-y: auto; padding: 1.5rem; }
  .pp-modal-footer { padding: 1rem 1.25rem; border-top: 1px solid ${T.border}; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; background: ${T.bgAlt}; }

  /* Progress bar in modal */
  .pp-triage-progress {
    margin-bottom: 1.25rem;
    display: flex; align-items: center; gap: 0.75rem;
  }
  .pp-triage-progress-bar {
    flex: 1; height: 2px; background: ${T.border};
    position: relative; overflow: hidden;
  }
  .pp-triage-progress-fill {
    height: 100%; background: ${T.text};
    transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .pp-triage-progress-label { font-size: 0.65rem; color: ${T.textMuted}; white-space: nowrap; }

  /* Question card */
  .pp-question-card { border: 1px solid ${T.border}; margin-bottom: 1.25rem; }
  .pp-question-header { padding: 0.75rem 1rem; background: ${T.bgAlt}; border-bottom: 1px solid ${T.border}; font-size: 0.6rem; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.12em; }
  .pp-question-text { padding: 1rem; font-size: 0.88rem; font-weight: 300; line-height: 1.6; color: ${T.text}; }
  .pp-answer-area { padding: 0 1rem 1rem; position: relative; }
  .pp-answer-textarea {
    width: 100%; border: 1px solid ${T.border}; background: ${T.bg};
    font-family: ${T.font}; font-size: 0.82rem; font-weight: 300;
    color: ${T.text}; padding: 0.65rem 2.75rem 0.65rem 0.875rem;
    outline: none; resize: none; min-height: 80px;
    transition: border-color 0.15s; border-radius: 0;
  }
  .pp-answer-textarea:focus { border-color: ${T.borderStr}; }
  .pp-answer-textarea::placeholder { color: #bbbbbb; }

  /* Voice button inside textarea */
  .pp-voice-btn {
    position: absolute; right: 1.5rem; bottom: 1.5rem;
    width: 30px; height: 30px;
    background: ${T.bg}; border: 1px solid ${T.border};
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.15s; color: ${T.textMuted};
  }
  .pp-voice-btn:hover { border-color: ${T.borderStr}; color: ${T.text}; }
  .pp-voice-btn.recording { background: #cc0000; border-color: #cc0000; color: white; animation: pp-pulse 1s infinite; }
  @keyframes pp-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(204,0,0,0.3); } 50% { box-shadow: 0 0 0 6px rgba(204,0,0,0); } }

  /* Assessment result in modal */
  .pp-result-section { margin-bottom: 1.25rem; }
  .pp-result-section-title { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.15em; color: ${T.textMuted}; font-weight: 400; margin-bottom: 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid ${T.border}; }
  .pp-severity-block { padding: 1rem; border: 1px solid; margin-bottom: 0.75rem; }
  .pp-reasoning-text { font-size: 0.78rem; color: ${T.textSec}; line-height: 1.6; font-weight: 300; }
  .pp-urgency-note { padding: 0.75rem 1rem; background: ${T.bgTert}; border-left: 2px solid ${T.borderStr}; font-size: 0.75rem; color: ${T.text}; line-height: 1.5; margin-top: 0.75rem; }

  .pp-doctor-result-card { border: 1px solid ${T.border}; margin-bottom: 0.75rem; padding: 1rem; display: grid; grid-template-columns: 28px 1fr; gap: 0.75rem; align-items: start; }
  .pp-doctor-result-rank { width: 28px; height: 28px; background: ${T.text}; color: ${T.bg}; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 400; flex-shrink: 0; }
  .pp-doctor-result-name { font-size: 0.88rem; font-weight: 400; margin-bottom: 0.15rem; }
  .pp-doctor-result-spec { font-size: 0.72rem; color: ${T.textSec}; text-transform: capitalize; }
  .pp-doctor-result-qual { font-size: 0.65rem; color: ${T.textMuted}; }
  .pp-doctor-result-reason { font-size: 0.68rem; color: ${T.textSec}; margin-top: 0.4rem; line-height: 1.4; padding-top: 0.4rem; border-top: 1px solid ${T.border}; }

  /* Loading state in modal */
  .pp-triage-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem 1rem; gap: 1rem; }
  .pp-triage-loading-text { font-size: 0.75rem; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.15em; }
  .pp-loading-dots { display: flex; gap: 6px; }
  .pp-loading-dot { width: 6px; height: 6px; background: ${T.text}; animation: pp-dot-bounce 1.2s infinite; }
  .pp-loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .pp-loading-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pp-dot-bounce { 0%,80%,100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }

  /* QR modal */
  .pp-qr-modal-box {
    background: ${T.bg}; border: 1px solid ${T.borderStr};
    width: 100%; max-width: 440px;
    padding: 2rem; display: flex; flex-direction: column; align-items: center; gap: 1.25rem;
    animation: pp-modal-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @media (max-width: 900px) {
    .pp-sidebar { display: none; }
    .pp-main    { margin-left: 0; }
    .pp-grid-3, .pp-profile-grid { grid-template-columns: 1fr 1fr; }
    .pp-col-3   { grid-column: span 2; }
    .pp-body    { padding: 1rem; }
    .pp-doctors-row { grid-template-columns: 1fr; }
    .pp-doctor-cell { border-right: none; border-bottom: 1px solid ${T.border}; }
    .pp-triage-summary-body { grid-template-columns: 1fr; }
  }
  @media (max-width: 540px) {
    .pp-grid-3, .pp-grid-2, .pp-profile-grid { grid-template-columns: 1fr; }
    .pp-col-3, .pp-col-2 { grid-column: span 1; }
    .pp-profile-cell { border-right: none; }
    .pp-modal { max-height: 95vh; }
  }
`;

function Field({ label, required, hint, icon, children }) {
  return (
    <div className="pp-field">
      <label className="pp-label">
        {icon && React.cloneElement(icon, { size: 11, style: { flexShrink: 0 } })}
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {hint && <span className="pp-input-hint">{hint}</span>}
    </div>
  );
}

function ProfileCell({ label, value, icon }) {
  return (
    <div className="pp-profile-cell">
      <div className="pp-profile-cell-label">
        {icon && React.cloneElement(icon, { size: 10 })}
        {label}
      </div>
      <div className="pp-profile-cell-value">{value || "—"}</div>
    </div>
  );
}

/* ─────────────────────────────────────────
   QR MODAL
───────────────────────────────────────── */
function QRModal({ onClose, patient, selectedDoctor }) {
  const [shortUrl, setShortUrl] = useState(null);
  const [urlError, setUrlError] = useState("");
  const [qrReady, setQrReady] = useState(false);
  const qrRef = useRef(null);

  // Dynamically load qrcode.js
  useEffect(() => {
    if (window.QRCode) { setQrReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload = () => setQrReady(true);
    script.onerror = () => setUrlError("Failed to load QR library.");
    document.head.appendChild(script);
  }, []);

  // Build URL and shorten
  useEffect(() => {
    if (!patient || !selectedDoctor) {
      setUrlError("Missing patient or doctor information.");
      return;
    }

    const fullUrl =
      `https://doctorassist.ai/report-upload` +
      `?doctor_id=${encodeURIComponent(selectedDoctor.sys_user_id)}` +
      `&patient_id=${encodeURIComponent(patient.sys_user_id || patient.id)}`;

    console.log("[QR Upload URL]", fullUrl);

    fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullUrl)}`)
      .then(r => r.text())
      .then(tiny => setShortUrl(tiny))
      .catch(() => {
        setShortUrl(fullUrl);
        setUrlError("Could not shorten URL — using full link.");
      });
  }, [patient, selectedDoctor]);

  // Render QR once both the library and the URL are ready
  useEffect(() => {
    if (!qrReady || !shortUrl || !qrRef.current) return;
    qrRef.current.innerHTML = "";
    new window.QRCode(qrRef.current, {
      text: shortUrl,
      width: 180,
      height: 180,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  }, [qrReady, shortUrl]);

  return (
    <div className="pp-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-qr-modal-box">

        {/* Header */}
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.12em", display: "flex", alignItems: "center", gap: 8 }}>
            <ScanLine size={14} /> Upload Reports
          </span>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted }}>
            <X size={13} />
          </button>
        </div>

        {/* QR Code */}
        <div style={{ padding: 12, border: `1px solid ${T.border}`, background: T.bgAlt, width: 204, height: 204, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {!shortUrl && !urlError && (
            <span style={{ fontSize: "0.72rem", color: T.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span className="pp-spinning"><Loader size={18} /></span>
              Generating QR…
            </span>
          )}
          {urlError && !shortUrl && (
            <span style={{ fontSize: "0.68rem", color: "#cc0000", textAlign: "center", lineHeight: 1.5 }}>
              <AlertCircle size={16} style={{ display: "block", margin: "0 auto 6px" }} />
              {urlError}
            </span>
          )}
          <div ref={qrRef} />
        </div>

        {/* Soft warning if TinyURL failed but QR still rendered with full URL */}
        {urlError && shortUrl && (
          <div style={{ fontSize: "0.65rem", color: T.textMuted, padding: "0.4rem 0.75rem", background: T.bgTert, borderLeft: `2px solid ${T.border}`, width: "100%", lineHeight: 1.5 }}>
            {urlError}
          </div>
        )}

        {/* Description */}
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 400, color: T.text, marginBottom: "0.4rem" }}>Scan with your phone</p>
          <p style={{ fontSize: "0.68rem", color: T.textMuted, lineHeight: 1.6 }}>
            Open the camera app on your mobile device and scan this QR code. The upload page will open in your browser — you can then select and upload your medical documents, reports, or prescriptions directly from your phone.
          </p>
        </div>

        {/* Instructions */}
        <div style={{ width: "100%", padding: "0.875rem 1rem", background: T.bgTert, borderLeft: `2px solid ${T.borderStr}`, fontSize: "0.68rem", color: T.textSec, lineHeight: 1.8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontWeight: 400, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>
            <Smartphone size={11} /> Instructions
          </div>
          1. Open your phone camera and point it at this QR code<br />
          2. Tap the notification that appears to open the link<br />
          3. Select your documents (PDF, JPG, PNG supported)<br />
          4. Tap upload — your files will be linked to this appointment
        </div>

        {/* Close */}
        <button className="pp-btn-outline" onClick={onClose} style={{ width: "100%" }}>
          Done
        </button>

      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   TRIAGE MODAL
───────────────────────────────────────── */
function TriageModal({ hmsId, reason, onClose, onComplete }) {
  const [phase, setPhase]               = useState("loading");
  const [sessionId, setSessionId]       = useState(null);
  const [questions, setQuestions]       = useState([]);
  const [currentIdx, setCurrentIdx]     = useState(0);
  const [answer, setAnswer]             = useState("");
  const [assessment, setAssessment]     = useState(null);
  const [doctors, setDoctors]           = useState([]);
  const [error, setError]               = useState("");
  const [closing, setClosing]           = useState(false);

  const [recording, setRecording]       = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorder                   = useRef(null);
  const audioChunks                     = useRef([]);

  useEffect(() => { startTriage(); }, []);

  const startTriage = async () => {
    setPhase("loading"); setError("");
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/orchestration/patient-triage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hms_id: hmsId, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start triage");
      setSessionId(data.session_id);
      setQuestions(data.first_question ? [data.first_question] : []);
      setCurrentIdx(0); setPhase("questioning");
    } catch (err) { setError(err.message); setPhase("questioning"); }
  };

  const submitAnswer = async () => {
    if (!answer.trim()) return;
    const currentQ = questions[currentIdx];
    if (!currentQ) return;
    setPhase("assessing"); setError("");
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/orchestration/patient-triage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hms_id: hmsId, session_id: sessionId, question: currentQ.question, answer: answer.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to submit answer");
      setAnswer("");
      if (data.phase === "answering" && data.next_question) {
        setQuestions(prev => {
          const alreadyHas = prev.find(q => q.question === data.next_question.question);
          return alreadyHas ? prev : [...prev, data.next_question];
        });
        setCurrentIdx(idx => idx + 1); setPhase("questioning");
      } else if (data.phase === "assessment") {
        setAssessment(data.assessment);
        setDoctors(data.recommended_doctors || []);
        setPhase("result");
      }
    } catch (err) { setError(err.message); setPhase("questioning"); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current   = [];
      mediaRecorder.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.start(); setRecording(true);
    } catch { alert("Microphone permission is required."); }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = processAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach(t => t.stop());
    setRecording(false);
  };

  const processAudio = async () => {
    if (!audioChunks.current.length) return;
    setTranscribing(true);
    try {
      const blob     = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob);
      const res  = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
      const data = await res.json();
      const text = data?.text || "";
      setAnswer(prev => prev.trim() ? `${prev} ${text}` : text);
    } catch { alert("Transcription failed"); }
    setTranscribing(false);
  };

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      if (phase === "result") onComplete({ assessment, doctors });
      onClose();
    }, 280);
  };

  const sev   = assessment ? SEVERITY_CONFIG[assessment.severity] || SEVERITY_CONFIG.moderate : null;
  const total = questions.length;

  return (
    <div className={`pp-modal-overlay${closing ? " closing" : ""}`} onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className={`pp-modal${closing ? " closing" : ""}`}>
        <div className="pp-modal-header">
          <span className="pp-modal-title"><Stethoscope size={14} />AI Triage Screening</span>
          <button className="pp-modal-close" onClick={handleClose}><X size={13} /></button>
        </div>
        <div className="pp-modal-body">
          {phase === "loading" && (
            <div className="pp-triage-loading">
              <div className="pp-loading-dots"><div className="pp-loading-dot" /><div className="pp-loading-dot" /><div className="pp-loading-dot" /></div>
              <span className="pp-triage-loading-text">Generating screening questions…</span>
            </div>
          )}
          {phase === "assessing" && (
            <div className="pp-triage-loading">
              <div className="pp-loading-dots"><div className="pp-loading-dot" /><div className="pp-loading-dot" /><div className="pp-loading-dot" /></div>
              <span className="pp-triage-loading-text">Analysing responses…</span>
            </div>
          )}
          {phase === "questioning" && questions.length > 0 && (
            <>
              <div className="pp-triage-progress">
                <div className="pp-triage-progress-bar">
                  <div className="pp-triage-progress-fill" style={{ width: `${(currentIdx / Math.max(total, 1)) * 100}%` }} />
                </div>
                <span className="pp-triage-progress-label">Q {currentIdx + 1}</span>
              </div>
              <div style={{ marginBottom: "1rem", padding: "0.65rem 0.875rem", background: T.bgTert, borderLeft: `2px solid ${T.borderStr}`, fontSize: "0.72rem", color: T.textSec, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "0.58rem", color: T.textMuted }}>Reason for Visit</span><br />{reason}
              </div>
              <div className="pp-question-card">
                <div className="pp-question-header">Question {currentIdx + 1}</div>
                <div className="pp-question-text">{questions[currentIdx]?.question}</div>
                <div className="pp-answer-area">
                  <textarea className="pp-answer-textarea" placeholder="Type your answer here, or use the mic…" value={answer} onChange={e => setAnswer(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitAnswer(); } }} />
                  <button className={`pp-voice-btn${recording ? " recording" : ""}`} onClick={recording ? stopRecording : startRecording} title={recording ? "Stop recording" : "Voice answer"}>
                    {transcribing ? <span className="pp-spinning"><Loader size={12} /></span> : recording ? <MicOff size={12} /> : <Mic size={12} />}
                  </button>
                </div>
              </div>
              {error && <div className="pp-message error" style={{ marginTop: 0 }}><AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />{error}</div>}
            </>
          )}
          {phase === "result" && assessment && (
            <>
              <div className="pp-result-section">
                <div className="pp-result-section-title">Triage Assessment</div>
                <div className="pp-severity-block" style={{ borderColor: sev.border, background: sev.bg }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.12em", color: sev.color, fontWeight: 400 }}>Severity</span>
                    <span className="pp-severity-badge" style={{ color: sev.color, borderColor: sev.border, background: T.bg }}><ShieldAlert size={10} />{sev.label}</span>
                  </div>
                  <p className="pp-reasoning-text">{assessment.severity_reasoning}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <div style={{ padding: "0.875rem", border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "0.3rem" }}>Primary Speciality</div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 400 }}>{assessment.recommended_speciality}</div>
                  </div>
                  {assessment.secondary_speciality && (
                    <div style={{ padding: "0.875rem", border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "0.3rem" }}>Secondary Speciality</div>
                      <div style={{ fontSize: "0.88rem", fontWeight: 300 }}>{assessment.secondary_speciality}</div>
                    </div>
                  )}
                </div>
                <p className="pp-reasoning-text" style={{ marginBottom: "0.5rem" }}>{assessment.speciality_reasoning}</p>
                {assessment.urgency_note && <div className="pp-urgency-note">{assessment.urgency_note}</div>}
              </div>
              {doctors.length > 0 && (
                <div className="pp-result-section">
                  <div className="pp-result-section-title">Recommended Doctors</div>
                  {doctors.map(doc => (
                    <div key={doc.sys_user_id} className="pp-doctor-result-card">
                      <div className="pp-doctor-result-rank">{doc.rank}</div>
                      <div>
                        <div className="pp-doctor-result-name">{doc.name}</div>
                        <div className="pp-doctor-result-spec">{doc.specialization}</div>
                        <div className="pp-doctor-result-qual">{doc.qualifications}</div>
                        {doc.match_reason && <div className="pp-doctor-result-reason">{doc.match_reason}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="pp-modal-footer">
          {phase === "questioning" && (
            <><span style={{ fontSize: "0.65rem", color: T.textMuted }}>Press Enter or click Submit</span>
            <button className="pp-btn-primary" onClick={submitAnswer} disabled={!answer.trim()}>Submit Answer <ChevronRight size={13} /></button></>
          )}
          {phase === "result" && (
            <><span style={{ fontSize: "0.65rem", color: T.textMuted }}>Screening complete</span>
            <button className="pp-btn-primary" onClick={handleClose}><CheckCircle size={13} /> Done</button></>
          )}
          {(phase === "loading" || phase === "assessing") && (
            <span style={{ fontSize: "0.65rem", color: T.textMuted, display: "flex", alignItems: "center", gap: "6px" }}>
              <span className="pp-spinning"><Loader size={12} /></span> Please wait…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   SLOT GRID
───────────────────────────────────────── */
function SlotGrid({ available, booked, selected, onSelect, loading }) {
  if (loading) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{ width: 90, height: 34, background: T.bgAlt, border: `1px solid ${T.border}` }} />
        ))}
      </div>
    );
  }
  const defaultSlots = generateDefaultSlots();
  const allAvail = (available && available.length > 0) ? available : defaultSlots;
  const allBooked = booked || [];
  const allSlots  = [...new Set([...allAvail, ...allBooked])].sort((a, b) => {
    const parse = s => {
      if (!s) return 0;
      const [time, meridiem] = s.split(" ");
      let [h, m] = (time || "0:0").split(":").map(Number);
      if (meridiem === "PM" && h !== 12) h += 12;
      if (meridiem === "AM" && h === 12) h = 0;
      return h * 60 + (m || 0);
    };
    return parse(a) - parse(b);
  });

  if (allSlots.length === 0) {
    return (
      <div style={{ padding: "1.5rem", border: `1px solid ${T.border}`, background: T.bgAlt, textAlign: "center", fontSize: "0.75rem", color: T.textMuted }}>
        No slots available for this date
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {allSlots.map(slot => {
        const isBooked   = allBooked.includes(slot);
        const isSelected = selected === slot;
        return (
          <button key={slot} className={`pp-slot-btn${isSelected ? " selected" : ""}`}
            disabled={isBooked} onClick={() => !isBooked && onSelect(slot)} title={isBooked ? "Already booked" : slot}>
            {slot}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
export default function PatientPortal({ hospitalId: propHospitalId, standalone = true }) {
  const hospitalId = propHospitalId || getHospitalIdFromUrl();
  const [flow,       setFlow]      = useState("hmsEntry");
  const [loading,    setLoading]   = useState(false);
  const [message,    setMessage]   = useState({ text: "", type: "" });

  const [hmsId,      setHmsId]     = useState("");
  const [dob,        setDob]       = useState("");
  const [patient,    setPatient]   = useState(null);
  const [complaint,  setComplaint] = useState("");
  const [visitType,  setVisitType] = useState("OPD");

  // Triage
  const [showTriageModal, setShowTriageModal] = useState(false);
  const [triageResult,    setTriageResult]    = useState(null);

  // Appointment booking
  const [selectedDoctor, setSelectedDoctor]   = useState(null);
  const [apptDate,       setApptDate]         = useState("");
  const [apptVisitType,  setApptVisitType]    = useState("OP");
  const [slots,          setSlots]            = useState(null);
  const [slotsLoading,   setSlotsLoading]     = useState(false);
  const [selectedSlot,   setSelectedSlot]     = useState("");

  // QR modal
  const [showQR, setShowQR] = useState(false);

  // Booking flow sub-step: "doctor" | "datetime" | "reports" | "confirm"
  const [bookingStep, setBookingStep] = useState("doctor");

  const [regForm, setRegForm] = useState({
    name: "", email: "", phone_number: "",
    date_of_birth: "", gender: "", blood_group: "",
    marital_status: "", address: "", education: "",
    occupation: "", annual_income: "", family_history: "",
    created_at: new Date().toISOString(),
  });
  const [regStep, setRegStep] = useState(1);

  const setMsg   = (text, type = "info") => setMessage({ text, type });
  const clearMsg = () => setMessage({ text: "", type: "" });

  /* ── When triage completes, auto-select rank 1 doctor ── */
  const handleTriageComplete = ({ assessment, doctors }) => {
    setTriageResult({ assessment, doctors });
    if (doctors && doctors.length > 0) {
      const top = doctors.find(d => d.rank === 1) || doctors[0];
      setSelectedDoctor(top);
    }
    setBookingStep("doctor");
  };

  /* ── Load slots when doctor + date chosen ── */
  useEffect(() => {
    if (!selectedDoctor || !apptDate) { setSlots(null); setSelectedSlot(""); return; }
    setSlotsLoading(true); setSlots(null); setSelectedSlot("");
    fetch(`${API_BASE_URL}hms/users/data/system/available-slots?doctor_id=${selectedDoctor.sys_user_id}&date=${apptDate}`)
      .then(r => r.json())
      .then(data => setSlots(data))
      .catch(() => setSlots({ available_slots: [], booked_slots: [] }))
      .finally(() => setSlotsLoading(false));
  }, [selectedDoctor, apptDate]);

  /* ── Final submit appointment ── */
  const handleSubmitVisit = async () => {
    if (!hospitalId) { setMsg("Hospital ID not found.", "error"); return; }
    if (!patient)    { setMsg("Patient information not found.", "error"); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/doctors/take_appointment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id:       selectedDoctor.sys_user_id,
          sys_user_id:     patient.sys_user_id || patient.id,
          date:            apptDate,
          scheduled_time:  selectedSlot,
          visit_type:      apptVisitType,
          chief_complaint: complaint,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to book appointment");
      setMsg(`Appointment confirmed! See you on ${apptDate} at ${selectedSlot}.`, "success");
      setTimeout(() => {
        setFlow("hmsEntry"); setPatient(null); setComplaint(""); setVisitType("OPD");
        setHmsId(""); setDob(""); setTriageResult(null);
        setSelectedDoctor(null); setApptDate(""); setSelectedSlot(""); setSlots(null);
        setBookingStep("doctor");
      }, 3500);
    } catch (err) {
      setMsg(err.message || "Failed to book appointment.", "error");
    } finally { setLoading(false); }
  };

  const handleDobChange = (e) => {
    let raw = e.target.value.replace(/\D/g, "").slice(0, 8);
    let formatted = raw;
    if (raw.length > 4) formatted = raw.slice(0, 2) + "-" + raw.slice(2, 4) + "-" + raw.slice(4);
    else if (raw.length > 2) formatted = raw.slice(0, 2) + "-" + raw.slice(2);
    setDob(formatted);
  };

  const handleCheckHmsId = async () => {
    if (!hmsId.trim()) { setMsg("Please enter your HMS ID.", "error"); return; }
    if (!hospitalId)   { setMsg("Hospital ID not found.", "error"); return; }
    clearMsg(); setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/data/check-patient-by-hms-id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hms_id: hmsId.trim(), hospital_id: hospitalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Request failed");
      if (data.found) setFlow("dobVerify");
      else setMsg("No patient found with this HMS ID.", "error");
    } catch (err) { setMsg(err.message || "Could not connect to server.", "error"); }
    finally { setLoading(false); }
  };

  const handleVerifyDob = async () => {
    if (dob.length !== 10) { setMsg("Please enter a valid date in DD-MM-YYYY format.", "error"); return; }
    if (!hospitalId)       { setMsg("Hospital ID not found.", "error"); return; }
    clearMsg(); setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/data/verify-patient`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hms_id: hmsId.trim(), date_of_birth: dob, hospital_id: hospitalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Verification failed");
      if (data.success) { setPatient(data.patient); setFlow("profile"); }
      else setMsg("Date of birth does not match our records.", "error");
    } catch (err) { setMsg(err.message || "Verification failed.", "error"); }
    finally { setLoading(false); }
  };

  const handleRegChange = (e) => {
    const { name, value } = e.target;
    if (name === "phone_number") setRegForm(p => ({ ...p, [name]: value.replace(/\D/g, "").slice(0, 15) }));
    else setRegForm(p => ({ ...p, [name]: value }));
  };

  const handleRegNext = () => {
    if (regStep === 1 && (!regForm.phone_number || !regForm.name || !regForm.date_of_birth || !regForm.gender)) {
      setMsg("Please fill all required fields.", "error"); return;
    }
    clearMsg(); setRegStep(s => s + 1);
  };

  const handleRegisterSubmit = async () => {
    if (!hospitalId) { setMsg("Hospital ID not found.", "error"); return; }
    setLoading(true); setMsg("Registering…");
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/patients/portal_patientadd`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...regForm, hospital_id: hospitalId }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.message || "Registration failed");
      const detRes  = await fetch(`${API_BASE_URL}hms/users/data/patient/details`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sys_user_id: data.sys_user_id, hospital_id: hospitalId }),
      });
      const detData = await detRes.json();
      if (!detRes.ok || !detData.success) throw new Error("Registered but could not load profile.");
      setPatient(detData.patient); clearMsg(); setFlow("profile");
    } catch (err) { setMsg(err.message || "Registration failed.", "error"); }
    finally { setLoading(false); }
  };

  const handleConfirmReason = () => {
    if (!complaint.trim()) { setMsg("Please enter the reason for your visit.", "error"); return; }
    clearMsg(); setTriageResult(null); setShowTriageModal(true);
  };

  const sidebarStep  = flow === "hmsEntry" ? 1 : flow === "dobVerify" ? 2 : flow === "register" ? (regStep === 1 ? 2 : 3) : 3;
  const totalSteps   = flow === "register" ? 4 : 3;
  const stepLabels   = flow === "register"
    ? ["Identification", "Personal Info", "Health Details", "Visit Details"]
    : ["Identification", "Verification", "Visit Details"];

  const sevConfig = triageResult ? SEVERITY_CONFIG[triageResult.assessment?.severity] || SEVERITY_CONFIG.moderate : null;

  /* ── Booking section steps ── */
  const canProceedToDatetime = !!selectedDoctor;
  const canProceedToReports  = canProceedToDatetime && !!apptDate && !!selectedSlot;
  const canProceedToConfirm  = canProceedToReports;

  const bookingStepOrder = ["doctor", "datetime", "reports", "confirm"];
  const bookingStepIdx   = bookingStepOrder.indexOf(bookingStep);

  const BookingStepHeader = ({ n, label, stepKey }) => {
    const idx   = bookingStepOrder.indexOf(stepKey);
    const isDone = bookingStepIdx > idx;
    const isActive = bookingStep === stepKey;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", paddingBottom: "0.875rem", borderBottom: `1px solid ${T.border}` }}>
        <div style={{
          width: 22, height: 22,
          border: `1px solid ${isDone ? T.borderStr : isActive ? T.borderStr : T.border}`,
          background: isDone ? T.text : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.6rem", fontWeight: 400,
          color: isDone ? T.bg : isActive ? T.text : T.textMuted,
          flexShrink: 0,
        }}>
          {isDone ? <Check size={11} /> : n}
        </div>
        <span style={{ fontSize: "0.75rem", fontWeight: isActive ? 400 : 300, color: isActive ? T.text : T.textMuted }}>{label}</span>
        {isDone && <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: T.textMuted, display: "flex", alignItems: "center", gap: 4 }}><CheckCircle size={11} /> Done</span>}
      </div>
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="pp-root">

        {showTriageModal && (
          <TriageModal hmsId={hmsId || patient?.hms_id} reason={complaint}
            onClose={() => setShowTriageModal(false)} onComplete={handleTriageComplete} />
        )}

        {showQR && (
          <QRModal
            onClose={() => setShowQR(false)}
            patient={patient}
            selectedDoctor={selectedDoctor}
          />
        )}

        {/* ══ SIDEBAR ══ */}
        {standalone && (
          <aside className="pp-sidebar">
            <div className="pp-sidebar-header">
              <div className="pp-brand-row"><span className="pp-brand-name">Doctorassist.AI</span></div>
              <span className="pp-page-label">Patient Portal</span>
            </div>
            <nav className="pp-sidebar-nav">
              <span className="pp-nav-group-label">Navigation</span>
              <button className="pp-nav-btn" onClick={() => { setFlow("hmsEntry"); setPatient(null); clearMsg(); }}><Home size={14} /> Home</button>
              <button className="pp-nav-btn active"><Activity size={14} /> Check-In</button>
              {flow === "register" && (
                <button className="pp-nav-btn" onClick={() => { setFlow("hmsEntry"); clearMsg(); }}><ArrowLeft size={14} /> Back to Login</button>
              )}
            </nav>
            <div className="pp-step-track">
              <span className="pp-nav-group-label" style={{ padding: 0, marginBottom: "0.75rem", display: "block" }}>Check-in Progress</span>
              <div className="pp-step-row">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n, i) => (
                  <React.Fragment key={n}>
                    <div className={`pp-step-num ${sidebarStep === n ? "active" : sidebarStep > n ? "done" : ""}`}>{n}</div>
                    {i < totalSteps - 1 && <div className={`pp-step-line ${sidebarStep > n ? "done" : ""}`} />}
                  </React.Fragment>
                ))}
              </div>
              <p className="pp-step-label" style={{ marginTop: "0.5rem" }}>Step {sidebarStep}: <span>{stepLabels[sidebarStep - 1]}</span></p>
            </div>
            <div className="pp-sidebar-footer">
              <button className="pp-logout-btn" onClick={() => window.location.href = "/"}><LogOut size={13} /> Exit Portal</button>
            </div>
          </aside>
        )}

        {/* ══ MAIN ══ */}
        <main className="pp-main" style={{ marginLeft: standalone ? "240px" : "0px" }}>
          <div className="pp-topbar">
            <div>
              <span className="pp-page-label">Patient Portal</span>
              <h1 className="pp-page-title">
                {flow === "hmsEntry"  && "Patient Check-In"}
                {flow === "dobVerify" && "Identity Verification"}
                {flow === "profile"   && "Visit Details"}
                {flow === "register"  && "New Patient Registration"}
              </h1>
            </div>
            <div className="pp-progress-pills">
              {stepLabels.map((label, i) => (
                <div key={i} className={`pp-progress-pill ${sidebarStep === i + 1 ? "active" : sidebarStep > i + 1 ? "done" : ""}`}>
                  {i + 1}. {label}
                </div>
              ))}
            </div>
          </div>

          <div className="pp-body">

            {/* ══ HMS ID ENTRY ══ */}
            {flow === "hmsEntry" && (
              <div className="pp-entry-wrap">
                <p className="pp-entry-title">Welcome</p>
                <p className="pp-entry-sub">Enter your HMS ID to check in. Your ID was provided at the time of registration.</p>
                <div className="pp-notice"><strong>Note:</strong> HMS ID is <strong>case-sensitive</strong>. Enter it exactly as shown on your registration card.</div>
                <div className="pp-form-section">
                  <div className="pp-form-section-header"><UserCheck size={13} color={T.textMuted} /><span className="pp-form-section-title">HMS Patient ID</span></div>
                  <div className="pp-form-section-body" style={{ gridTemplateColumns: "1fr" }}>
                    <Field label="HMS ID" required icon={<User />} >
                      <input className="pp-input" placeholder="HMS-PAT-XXXX" value={hmsId}
                        onChange={e => setHmsId(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleCheckHmsId()} />
                    </Field>
                  </div>
                </div>
                <div className="pp-btn-row" style={{ borderTop: "none", paddingTop: 0 }}>
                  <div />
                  <button className="pp-btn-primary" onClick={handleCheckHmsId} disabled={loading}>
                    {loading ? <><span className="pp-spinning"><Loader size={13} /></span> Checking…</> : <>Continue <ChevronRight size={13} /></>}
                  </button>
                </div>
                {message.text && (
                  <div className={`pp-message ${message.type}`}>
                    {message.type === "error" ? <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
                    {message.text}
                  </div>
                )}
                <div className="pp-divider"><div className="pp-divider-line" /><span>Don't have an HMS ID?</span><div className="pp-divider-line" /></div>
                <button className="pp-register-link" onClick={() => { clearMsg(); setRegStep(1); setFlow("register"); }}>
                  <Plus size={13} /> Register as a new patient
                </button>
              </div>
            )}

            {/* ══ DOB VERIFICATION ══ */}
            {flow === "dobVerify" && (
              <div className="pp-entry-wrap">
                <p className="pp-entry-title">Verify Identity</p>
                <p className="pp-entry-sub">HMS ID <strong>{hmsId}</strong> found. Enter your date of birth to confirm your identity.</p>
                <div className="pp-form-section">
                  <div className="pp-form-section-header"><Calendar size={13} color={T.textMuted} /><span className="pp-form-section-title">Date of Birth</span></div>
                  <div className="pp-form-section-body" style={{ gridTemplateColumns: "1fr" }}>
                    <Field label="Date of Birth" required icon={<Calendar />} hint="Format: DD-MM-YYYY">
                      <input className="pp-input" placeholder="DD-MM-YYYY" value={dob}
                        onChange={handleDobChange} maxLength={10}
                        onKeyDown={e => e.key === "Enter" && handleVerifyDob()} />
                    </Field>
                  </div>
                </div>
                <div className="pp-btn-row" style={{ borderTop: "none", paddingTop: 0 }}>
                  <button className="pp-btn-outline" onClick={() => { setFlow("hmsEntry"); clearMsg(); }}><ArrowLeft size={13} /> Back</button>
                  <button className="pp-btn-primary" onClick={handleVerifyDob} disabled={loading}>
                    {loading ? <><span className="pp-spinning"><Loader size={13} /></span> Verifying…</> : <>Verify <ChevronRight size={13} /></>}
                  </button>
                </div>
                {message.text && (
                  <div className={`pp-message ${message.type}`}>
                    {message.type === "error" ? <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
                    {message.text}
                  </div>
                )}
              </div>
            )}

            {/* ══ PROFILE + VISIT ══ */}
            {flow === "profile" && patient && (
              <>
                {/* Patient card */}
                <div className="pp-profile-card">
                  <div className="pp-profile-header">
                    <div className="pp-avatar"><User size={22} color="white" /></div>
                    <div>
                      <div className="pp-patient-name">{patient.name}</div>
                      <div className="pp-patient-sub">
                        {patient.hms_id} &nbsp;·&nbsp; {patient.gender} &nbsp;·&nbsp;
                        {patient.date_of_birth ? (() => {
                          const d = new Date(patient.date_of_birth);
                          const age = Math.floor((Date.now() - d) / 31557600000);
                          return `${age} yrs`;
                        })() : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="pp-profile-grid">
                    <ProfileCell label="Phone" value={patient.phone_number} icon={<Phone />} />
                    <ProfileCell label="Email" value={patient.email} icon={<Mail />} />
                    <ProfileCell label="Blood Group" value={patient.blood_group} icon={<HeartPulse />} />
                    <ProfileCell label="Marital Status" value={patient.marital_status} icon={<UserCheck />} />
                    <ProfileCell label="Occupation" value={patient.occupation} icon={<Briefcase />} />
                    <ProfileCell label="Education" value={patient.education} icon={<GraduationCap />} />
                    <ProfileCell label="Address" value={patient.address} icon={<MapPin />} />
                    <ProfileCell label="Annual Income" value={patient.annual_income ? `₹${Number(patient.annual_income).toLocaleString("en-IN")}` : null} icon={<DollarSign />} />
                    <ProfileCell label="Family History" value={patient.family_history} icon={<HeartPulse />} />
                  </div>
                </div>

                {/* Visit form */}
                <div className="pp-form-section">
                  <div className="pp-form-section-header"><Activity size={13} color={T.textMuted} /><span className="pp-form-section-title">Today's Visit</span></div>
                  <div className="pp-form-section-body pp-grid-2">
                    <Field label="Visit Type" required icon={<BriefcaseMedical />}>
                      <select className="pp-input" value={visitType} onChange={e => setVisitType(e.target.value)}>
                        <option value="OPD">Outpatient (OPD)</option>
                        <option value="Review">Review</option>
                        <option value="Consultation">Consultation</option>
                        <option value="Emergency">Emergency</option>
                      </select>
                    </Field>
                    <div />
                    <div className="pp-col-2">
                      <Field label="Reason for Visit / Chief Complaint" required icon={<FileText />}>
                        <textarea className="pp-input" rows={4}
                          placeholder="Describe your symptoms or reason for visiting today…"
                          value={complaint} onChange={e => { setComplaint(e.target.value); setTriageResult(null); setSelectedDoctor(null); setBookingStep("doctor"); }} />
                      </Field>
                    </div>
                  </div>
                </div>

                {/* Triage trigger */}
                {!triageResult && (
                  <div className="pp-btn-row">
                    <span style={{ fontSize: "0.65rem", color: T.textMuted, lineHeight: 1.5 }}>Enter your reason above, then start the AI screening.</span>
                    <button className="pp-btn-primary" onClick={handleConfirmReason} disabled={!complaint.trim()}>
                      <Stethoscope size={14} /> Start Triage Screening
                    </button>
                  </div>
                )}

                {/* ══ TRIAGE RESULT + APPOINTMENT BOOKING ══ */}
                {triageResult && (
                  <>
                    {/* Triage summary */}
                    <div className="pp-triage-summary">
                      <div className="pp-triage-summary-header">
                        <span className="pp-triage-summary-title"><CheckCircle size={13} />Triage Screening Complete</span>
                        <span className="pp-severity-badge" style={{ color: sevConfig.color, borderColor: sevConfig.border, background: sevConfig.bg }}>
                          <ShieldAlert size={10} />{sevConfig.label}
                        </span>
                      </div>
                      <div className="pp-triage-summary-body">
                        <div className="pp-info-block">
                          <span className="pp-info-label">Recommended Speciality</span>
                          <span className="pp-info-value" style={{ fontWeight: 400 }}>{triageResult.assessment.recommended_speciality}</span>
                        </div>
                        {triageResult.assessment.secondary_speciality && (
                          <div className="pp-info-block">
                            <span className="pp-info-label">Secondary Speciality</span>
                            <span className="pp-info-value">{triageResult.assessment.secondary_speciality}</span>
                          </div>
                        )}
                        <div className="pp-info-block" style={{ gridColumn: "span 2" }}>
                          <span className="pp-info-label">Urgency Note</span>
                          <span className="pp-info-value">{triageResult.assessment.urgency_note}</span>
                        </div>
                      </div>
                    </div>

                    {/* Re-screen link */}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
                      <button className="pp-btn-outline" style={{ fontSize: "0.72rem" }}
                        onClick={() => { setTriageResult(null); setSelectedDoctor(null); setBookingStep("doctor"); setShowTriageModal(true); }}>
                        <RefreshCw size={12} /> Re-screen
                      </button>
                    </div>

                    {/* ── STEP 1: Doctor selection ── */}
                    <div className="pp-appt-section">
                      <div className="pp-appt-section-header">
                        <span className="pp-appt-section-title"><UserCheck size={13} />Step 1 — Select Your Doctor</span>
                        {selectedDoctor && bookingStep !== "doctor" && (
                          <button className="pp-btn-outline" style={{ fontSize: "0.65rem", padding: "0.35rem 0.75rem" }}
                            onClick={() => { setBookingStep("doctor"); setSelectedSlot(""); setApptDate(""); }}>
                            Change
                          </button>
                        )}
                      </div>
                      <div className="pp-appt-section-body">
                        {bookingStep === "doctor" ? (
                          <>
                            <p style={{ fontSize: "0.72rem", color: T.textMuted, marginBottom: "1rem", lineHeight: 1.6 }}>
                              Based on your triage, we recommend the following doctor{triageResult.doctors.length > 1 ? "s" : ""}. The top match is pre-selected — you can change it.
                            </p>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.25rem" }}>
                              {triageResult.doctors.map(doc => {
                                const isSelected = selectedDoctor?.sys_user_id === doc.sys_user_id;
                                return (
                                  <div key={doc.sys_user_id}
                                    className={`pp-doctor-select-card${isSelected ? " selected" : ""}`}
                                    onClick={() => setSelectedDoctor(isSelected ? null : doc)}>
                                    <div className={`pp-doctor-rank-badge${doc.rank === 2 ? " rank2" : doc.rank === 3 ? " rank3" : ""}`}>
                                      {doc.rank}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: "0.88rem", fontWeight: 400, color: T.text }}>{doc.name}</div>
                                      <div style={{ fontSize: "0.7rem", color: T.textSec, textTransform: "capitalize" }}>{doc.specialization}</div>
                                      <div style={{ fontSize: "0.65rem", color: T.textMuted }}>{doc.qualifications}</div>
                                      {doc.match_reason && (
                                        <div style={{ fontSize: "0.65rem", color: T.textSec, marginTop: "0.3rem", lineHeight: 1.4, paddingTop: "0.3rem", borderTop: `1px solid ${T.border}` }}>
                                          {doc.match_reason}
                                        </div>
                                      )}
                                    </div>
                                    {isSelected && (
                                      <div style={{ width: 22, height: 22, background: T.text, color: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                        <Check size={12} />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button className="pp-btn-primary" disabled={!selectedDoctor}
                                onClick={() => setBookingStep("datetime")}>
                                Continue <ChevronRight size={13} />
                              </button>
                            </div>
                          </>
                        ) : (
                          /* Collapsed summary */
                          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.75rem", background: T.bgAlt, border: `1px solid ${T.border}` }}>
                            <div style={{ width: 28, height: 28, background: T.text, color: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", flexShrink: 0 }}>
                              {selectedDoctor?.rank || "1"}
                            </div>
                            <div>
                              <div style={{ fontSize: "0.85rem", fontWeight: 400 }}>{selectedDoctor?.name}</div>
                              <div style={{ fontSize: "0.7rem", color: T.textSec, textTransform: "capitalize" }}>{selectedDoctor?.specialization}</div>
                            </div>
                            <CheckCircle size={14} color={T.text} style={{ marginLeft: "auto" }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── STEP 2: Date, Visit Type & Slots ── */}
                    {(bookingStep === "datetime" || bookingStep === "reports" || bookingStep === "confirm") && (
                      <div className="pp-appt-section" style={{ opacity: bookingStep === "doctor" ? 0.45 : 1 }}>
                        <div className="pp-appt-section-header">
                          <span className="pp-appt-section-title"><Calendar size={13} />Step 2 — Date & Time Slot</span>
                          {(bookingStep === "reports" || bookingStep === "confirm") && (
                            <button className="pp-btn-outline" style={{ fontSize: "0.65rem", padding: "0.35rem 0.75rem" }}
                              onClick={() => { setBookingStep("datetime"); }}>
                              Change
                            </button>
                          )}
                        </div>
                        <div className="pp-appt-section-body">
                          {bookingStep === "datetime" ? (
                            <>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem", marginBottom: "1.25rem" }}>
                                <Field label="Appointment Date" required icon={<Calendar />}>
                                  <input type="date" className="pp-input" min={todayISO()} value={apptDate}
                                    onChange={e => setApptDate(e.target.value)} />
                                </Field>
                                <Field label="Visit Type" required icon={<BriefcaseMedical />}>
                                  <select className="pp-input" value={apptVisitType} onChange={e => setApptVisitType(e.target.value)}>
                                    <option value="OP">Outpatient (OP)</option>
                                    <option value="followup_visit">Follow-up Visit</option>
                                    <option value="Emergency">Emergency</option>
                                    <option value="Consultation">Consultation</option>
                                  </select>
                                </Field>
                              </div>

                              {apptDate && (
                                <>
                                  <div style={{ marginBottom: "0.75rem" }}>
                                    <label className="pp-label"><Clock size={11} />Available Time Slots</label>
                                    {!slotsLoading && slots && (
                                      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                          <div style={{ width: 10, height: 10, border: `1px solid ${T.border}` }} />
                                          <span style={{ fontSize: "0.62rem", color: T.textMuted }}>Available</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                          <div style={{ width: 10, height: 10, background: T.bgTert, border: `1px solid ${T.border}`, opacity: 0.6 }} />
                                          <span style={{ fontSize: "0.62rem", color: T.textMuted }}>Booked</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                          <div style={{ width: 10, height: 10, background: T.text }} />
                                          <span style={{ fontSize: "0.62rem", color: T.textMuted }}>Selected</span>
                                        </div>
                                        {(!slots?.available_slots || slots.available_slots.length === 0) && (
                                          <span style={{ fontSize: "0.62rem", color: T.textMuted, fontStyle: "italic" }}>Showing default schedule (9:30 AM – 7:30 PM)</span>
                                        )}
                                      </div>
                                    )}
                                    <SlotGrid
                                      available={slots?.available_slots}
                                      booked={slots?.booked_slots}
                                      selected={selectedSlot}
                                      onSelect={setSelectedSlot}
                                      loading={slotsLoading}
                                    />
                                  </div>
                                  {selectedSlot && (
                                    <div style={{ marginTop: "0.5rem", padding: "0.6rem 1rem", background: T.bgAlt, border: `1px solid ${T.border}`, fontSize: "0.75rem", color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                                      <Clock size={12} color={T.textMuted} />
                                      Selected: <strong style={{ fontWeight: 400 }}>{selectedSlot}</strong>
                                      <button onClick={() => setSelectedSlot("")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.textMuted, display: "flex" }}>
                                        <X size={11} />
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}

                              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: `1px solid ${T.border}` }}>
                                <button className="pp-btn-primary" disabled={!apptDate || !selectedSlot}
                                  onClick={() => setBookingStep("reports")}>
                                  Continue <ChevronRight size={13} />
                                </button>
                              </div>
                            </>
                          ) : (
                            /* Collapsed summary */
                            <div style={{ display: "flex", gap: "1.5rem", padding: "0.75rem", background: T.bgAlt, border: `1px solid ${T.border}`, flexWrap: "wrap" }}>
                              {[
                                { label: "Date", value: apptDate ? new Date(apptDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
                                { label: "Time", value: selectedSlot || "—" },
                                { label: "Type", value: apptVisitType },
                              ].map(({ label, value }) => (
                                <div key={label}>
                                  <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "0.2rem" }}>{label}</div>
                                  <div style={{ fontSize: "0.82rem", fontWeight: 400 }}>{value}</div>
                                </div>
                              ))}
                              <CheckCircle size={14} color={T.text} style={{ marginLeft: "auto", alignSelf: "center" }} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── STEP 3: Upload Reports via QR ── */}
                    {(bookingStep === "reports" || bookingStep === "confirm") && (
                      <div className="pp-appt-section">
                        <div className="pp-appt-section-header">
                          <span className="pp-appt-section-title"><Upload size={13} />Step 3 — Upload Reports</span>
                          <span style={{ fontSize: "0.65rem", color: T.textMuted }}>Optional</span>
                        </div>
                        <div className="pp-appt-section-body">
                          {bookingStep === "reports" ? (
                            <>
                              <p style={{ fontSize: "0.75rem", color: T.textSec, lineHeight: 1.6, marginBottom: "1.5rem" }}>
                                If you have any medical reports, prescriptions, or test results relevant to this visit, scan the QR code below from your phone to upload them. This step is <strong style={{ fontWeight: 400 }}>optional</strong> — you can skip and proceed.
                              </p>

                              {/* Big QR trigger button */}
                              <button className="pp-qr-open-btn" onClick={() => setShowQR(true)}>
                                <QrCode size={22} />
                                Scan QR Code to Upload Reports on Mobile
                              </button>

                              <div style={{ padding: "0.75rem 1rem", background: T.bgTert, borderLeft: `2px solid ${T.border}`, fontSize: "0.68rem", color: T.textSec, lineHeight: 1.6 }}>
                                <Smartphone size={11} style={{ marginRight: 5, verticalAlign: "middle" }} />
                                <strong style={{ fontWeight: 400 }}>How it works:</strong> Tap the button above to see the QR code → scan with your phone camera → upload your documents from your phone. Supported formats: PDF, JPG, PNG.
                              </div>

                              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: `1px solid ${T.border}` }}>
                                <button className="pp-btn-outline" onClick={() => setBookingStep("confirm")}>
                                  Skip &amp; Continue <ChevronRight size={13} />
                                </button>
                                <button className="pp-btn-primary" onClick={() => setBookingStep("confirm")}>
                                  Done, Continue <ChevronRight size={13} />
                                </button>
                              </div>
                            </>
                          ) : (
                            <div style={{ padding: "0.75rem", background: T.bgAlt, border: `1px solid ${T.border}`, fontSize: "0.75rem", color: T.textSec, display: "flex", alignItems: "center", gap: 8 }}>
                              <CheckCircle size={13} color={T.text} /> Reports section completed
                              <button className="pp-btn-outline" style={{ marginLeft: "auto", fontSize: "0.65rem", padding: "0.3rem 0.65rem" }}
                                onClick={() => setBookingStep("reports")}>
                                Review
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── STEP 4: Verify & Confirm ── */}
                    {bookingStep === "confirm" && (
                      <div className="pp-appt-section" style={{ borderColor: T.borderStr }}>
                        <div className="pp-appt-section-header" style={{ background: T.text }}>
                          <span className="pp-appt-section-title" style={{ color: T.bg }}><CalendarCheck size={13} />Step 4 — Verify &amp; Confirm Appointment</span>
                        </div>
                        <div className="pp-appt-section-body">
                          <p style={{ fontSize: "0.72rem", color: T.textMuted, marginBottom: "1.25rem", lineHeight: 1.6 }}>
                            Please review your appointment details below before confirming. Once confirmed, you will receive a booking reference.
                          </p>

                          <div className="pp-confirm-summary">
                            {[
                              { key: "Patient",         val: patient?.name },
                              { key: "HMS ID",          val: patient?.hms_id },
                              { key: "Doctor",          val: selectedDoctor?.name },
                              { key: "Specialisation",  val: selectedDoctor?.specialization },
                              { key: "Date",            val: apptDate ? new Date(apptDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "long" }) : "—" },
                              { key: "Time",            val: selectedSlot },
                              { key: "Visit Type",      val: apptVisitType },
                              { key: "Chief Complaint", val: complaint || "—" },
                            ].map(({ key, val }) => (
                              <div key={key} className="pp-confirm-row">
                                <span className="pp-confirm-key">{key}</span>
                                <span className="pp-confirm-val">{val || "—"}</span>
                              </div>
                            ))}
                          </div>

                          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between", paddingTop: "1.25rem", borderTop: `1px solid ${T.border}` }}>
                            <button className="pp-btn-outline" onClick={() => setBookingStep("reports")}>
                              <ArrowLeft size={13} /> Back
                            </button>
                            <button className="pp-btn-primary" onClick={handleSubmitVisit} disabled={loading}
                              style={{ padding: "0.75rem 2.5rem", fontSize: "0.85rem" }}>
                              {loading
                                ? <><span className="pp-spinning"><Loader size={14} /></span> Confirming…</>
                                : <><CalendarCheck size={15} /> Confirm &amp; Book Appointment</>
                              }
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {message.text && (
                      <div className={`pp-message ${message.type}`}>
                        {message.type === "error" ? <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
                        {message.text}
                      </div>
                    )}
                  </>
                )}

                {/* Non-triage messages */}
                {!triageResult && message.text && (
                  <div className={`pp-message ${message.type}`}>
                    {message.type === "error" ? <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
                    {message.text}
                  </div>
                )}
              </>
            )}

            {/* ══ REGISTRATION ══ */}
            {flow === "register" && (
              <form onSubmit={e => e.preventDefault()} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}>
                {regStep === 1 && (
                  <div className="pp-form-section">
                    <div className="pp-form-section-header"><UserCheck size={13} color={T.textMuted} /><span className="pp-form-section-title">Personal Information</span></div>
                    <div className="pp-form-section-body pp-grid-3">
                      <Field label="Full Name" required icon={<User />}>
                        <input className="pp-input" name="name" placeholder="Your legal name" value={regForm.name} onChange={handleRegChange} />
                      </Field>
                      <Field label="Phone Number" required icon={<Phone />} hint="Used as default password.">
                        <input className="pp-input" name="phone_number" type="tel" placeholder="10–15 digits" maxLength={15} value={regForm.phone_number} onChange={handleRegChange} />
                      </Field>
                      <Field label="Email" icon={<Mail />}>
                        <input className="pp-input" name="email" type="email" placeholder="your@email.com" value={regForm.email} onChange={handleRegChange} />
                      </Field>
                      <Field label="Date of Birth" required icon={<Calendar />}>
                        <input className="pp-input" name="date_of_birth" type="date" value={regForm.date_of_birth} onChange={handleRegChange} />
                      </Field>
                      <Field label="Gender" required icon={<User />}>
                        <select className="pp-input" name="gender" value={regForm.gender} onChange={handleRegChange}>
                          <option value="">Select gender</option>
                          {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </Field>
                    </div>
                  </div>
                )}
                {regStep === 2 && (
                  <div className="pp-form-section">
                    <div className="pp-form-section-header"><HeartPulse size={13} color={T.textMuted} /><span className="pp-form-section-title">Medical &amp; Socio-economic Details (Optional)</span></div>
                    <div className="pp-form-section-body pp-grid-3">
                      <Field label="Blood Group" icon={<HeartPulse />}>
                        <select className="pp-input" name="blood_group" value={regForm.blood_group} onChange={handleRegChange}>
                          <option value="">Select group</option>
                          {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
                        </select>
                      </Field>
                      <Field label="Marital Status" icon={<UserCheck />}>
                        <select className="pp-input" name="marital_status" value={regForm.marital_status} onChange={handleRegChange}>
                          <option value="">Select status</option>
                          {MARITAL_STATUS.map(ms => <option key={ms} value={ms}>{ms}</option>)}
                        </select>
                      </Field>
                      <Field label="Education" icon={<GraduationCap />}>
                        <input className="pp-input" name="education" placeholder="Highest level of education" value={regForm.education} onChange={handleRegChange} />
                      </Field>
                      <Field label="Occupation" icon={<Briefcase />}>
                        <input className="pp-input" name="occupation" placeholder="Current job / profession" value={regForm.occupation} onChange={handleRegChange} />
                      </Field>
                      <Field label="Annual Income" icon={<DollarSign />}>
                        <input className="pp-input" name="annual_income" type="number" placeholder="Income (optional)" value={regForm.annual_income} onChange={handleRegChange} />
                      </Field>
                      <div />
                      <div className="pp-col-3">
                        <Field label="Address" icon={<MapPin />}>
                          <textarea className="pp-input" name="address" rows={3} placeholder="Permanent address" value={regForm.address} onChange={handleRegChange} />
                        </Field>
                      </div>
                      <div className="pp-col-3">
                        <Field label="Family History" icon={<HeartPulse />}>
                          <textarea className="pp-input" name="family_history" rows={3} placeholder="Relevant family medical history" value={regForm.family_history} onChange={handleRegChange} />
                        </Field>
                      </div>
                    </div>
                  </div>
                )}
                <div className="pp-btn-row">
                  <div>
                    {regStep > 1
                      ? <button type="button" className="pp-btn-outline" onClick={() => { clearMsg(); setRegStep(s => s - 1); }}>← Back</button>
                      : <button type="button" className="pp-btn-outline" onClick={() => { setFlow("hmsEntry"); clearMsg(); }}>← Login Instead</button>
                    }
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    {regStep === 1 && <button type="button" className="pp-btn-primary" onClick={handleRegNext}>Next →</button>}
                    {regStep === 2 && (
                      <button type="button" className="pp-btn-primary" onClick={handleRegisterSubmit} disabled={loading}>
                        {loading ? <><span className="pp-spinning"><Loader size={13} /></span> Registering…</> : <><UserCheck size={14} /> Complete Registration</>}
                      </button>
                    )}
                  </div>
                </div>
                {message.text && (
                  <div className={`pp-message ${message.type}`}>
                    {message.type === "error" ? <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
                    {message.text}
                  </div>
                )}
              </form>
            )}

          </div>
        </main>
      </div>
    </>
  );
}