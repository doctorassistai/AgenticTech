import React, { useState, useEffect, useRef } from "react";
import { Users } from "lucide-react";
import logo from "../assets/lodo_only.png";
import AppointmentDashboard from "./AppointmentDashboard";
import DateWiseAppointmentDashboard from "./DateWiseAppointmentDashboard";
import DoctorLogBook from "./DoctorLogBook";
import {
  Home, LogOut, Calendar, Activity, FileText, Search, Bell,
  ChevronRight, Bed, UserPlus, Settings, Menu, X, MessageCircle, Notebook, Upload,
  Save, Check, AlertCircle,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import SurgicalOncologyDashboard from "./surgical-oncology/SurgicalOncologyDashboard";
import RadiationOncologyDashboard from "./radiation-oncology/RadiationOncologyDashboard";
import MedicalOncologyDashboard from "./medical-oncology/MedicalOncologyDashboard";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const SIDEBAR_WIDTH = "248px";

const SPECIALITY_DASHBOARDS = {
  "surgical oncology": { title: "Surgical Dashboard", Component: SurgicalOncologyDashboard },
  "medical oncology": { title: "Medical Oncology Dashboard", Component: MedicalOncologyDashboard },
  "radiation oncology": { title: "Radiation Oncology Dashboard", Component: RadiationOncologyDashboard },
};

/* ─── THEME TOKENS ─── */
import { THEMES } from "./themes";

const themeName = localStorage.getItem("theme") || "BlackWhite";
const theme = THEMES[themeName] || THEMES.BlackWhite;

const T = {
  bg: theme.bg,
  bgAlt: theme.bgAlt,
  bgTert: theme.bgTert,
  text: theme.text,
  sec: theme.sec,
  textSec: theme.textSec,
  textMuted: theme.textMuted,
  border: theme.border,
  borderStr: theme.borderStr,
  accent: theme.accent,
};

/* ─── AD DATA — one picked at random per page load ─── */
const ADS = [
 
  {
    brand: "Medtronic India",
    logo: "MT",
    logoColor: "#0057a8",
    tagline: "Advancing Healthcare Technology",
    body: "Discover the latest in cardiac devices, surgical robotics, and diabetes management solutions designed for your patients.",
    cta: "Explore Solutions",
  },
  {
    brand: "Practo Pro",
    logo: "PP",
    logoColor: "#5b8def",
    tagline: "Grow Your Practice Online",
    body: "Reach over 20 million patients. Manage appointments, records, and teleconsultations — all in one place.",
    cta: "Get Started Free",
  },
  {
    brand: "Sun Pharma",
    logo: "SP",
    logoColor: "#f47920",
    tagline: "Trusted Pharmaceutical Excellence",
    body: "Comprehensive drug portfolio across oncology, cardiology, neurology, and more. Stay updated with clinical resources.",
    cta: "View Products",
  },
  {
    brand: "Siemens Healthineers",
    logo: "SH",
    logoColor: "#009999",
    tagline: "Pioneering Healthcare",
    body: "From AI-powered imaging to lab diagnostics — empowering clinicians with the tools that matter most.",
    cta: "Discover More",
  },
  {
    brand: "Max Healthcare",
    logo: "MH",
    logoColor: "#e63946",
    tagline: "Redefining Excellence in Care",
    body: "Refer your patients to Max's super-specialty centres for advanced surgery, oncology, and critical care.",
    cta: "Refer a Patient",
  },
];

/* ─── PICK A RANDOM AD ONCE PER PAGE LOAD (outside component = stable) ─── */
const CURRENT_AD = ADS[Math.floor(Math.random() * ADS.length)];

/* ─── INLINE STYLES ─── */
const S = {
  layout: {
    display: "flex",
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },

  sidebar: {
    width: SIDEBAR_WIDTH,
    minHeight: "100vh",
    position: "fixed",
    left: 0, top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
    transition: "transform 0.3s ease",
  },
  sidebarHeader: {
    padding: "1.5rem 1.5rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "1.25rem",
  },
  brandName: {
  fontWeight: 400,
  fontSize: "0.9rem",
  letterSpacing: "-0.01em",
  color: T.text,
  margin: 0,
},
  sectionLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  doctorName: {
    fontSize: "0.9rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
  },
  doctorSpec: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
  },

  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },
  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.5rem 0.75rem 0.25rem",
    display: "block",
  },
  navBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "0.55rem 1.25rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    transition: "all 0.15s",
    fontFamily: "'Open Sans', sans-serif",
    borderLeft: "2px solid transparent",
  },
  navBtnActive: {
    background: T.bgAlt,
    color: T.text,
    fontWeight: 400,
    borderLeft: `2px solid ${T.accent}`,
  },

  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  logoutBtn: {
    width: "100%",
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.6rem 1rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.2s",
  },

  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 199,
  },

  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    transition: "margin-left 0.3s ease",
  },

  topBar: {
    position: "sticky",
    top: 0,
    background: T.sec,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
    gap: "12px",
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },
  hamburger: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: T.text,
    padding: "4px",
    display: "flex",
    alignItems: "center",
  },

  body: {
    padding: "2rem",
    flex: 1,
  },

  dashboardContent: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 300px",
    gap: "24px",
    alignItems: "start",
    width: "100%",
  },
  mainContent: {
    minWidth: 0,
    overflow: "hidden",
  },

  /* ── RIGHT SIDEBAR ── */
  rightSidebar: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    position: "sticky",
    top: "90px",
    minHeight: "400px",
  },

  newsHeader: {
    padding: "1.25rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    fontSize: "0.72rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
  },

  newsItem: {
    padding: "1.25rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    cursor: "pointer",
    transition: "background 0.15s",
  },

  newsTitle: {
    fontSize: "0.82rem",
    fontWeight: 400,
    marginBottom: "0.5rem",
    color: T.text,
    lineHeight: 1.45,
  },

  newsMeta: {
    fontSize: "0.68rem",
    color: T.textMuted,
    letterSpacing: "0.04em",
  },

  /* ── AD BOX ── */
  adWrapper: {
    borderTop: `2px solid ${T.border}`,
    background: T.bgAlt,
  },
  adTopBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.65rem 1.5rem 0",
  },
  adLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: T.textMuted,
  },
  adPromoted: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    border: `1px solid ${T.border}`,
    padding: "1px 6px",
  },
  adBody: {
    padding: "0.875rem 1.5rem 1.25rem",
  },
  adLogoRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "0.875rem",
  },
  adLogoCircle: {
    width: "42px",
    height: "42px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.68rem",
    fontWeight: 600,
    color: "#fff",
    flexShrink: 0,
    letterSpacing: "0.05em",
  },
  adBrandName: {
    fontSize: "0.84rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
    lineHeight: 1.2,
  },
  adTagline: {
    fontSize: "0.68rem",
    color: T.textMuted,
    margin: "3px 0 0",
    lineHeight: 1.35,
  },
  adBodyText: {
    fontSize: "0.76rem",
    fontWeight: 300,
    color: T.textSec,
    lineHeight: 1.6,
    marginBottom: "1rem",
  },
  adCta: {
    display: "block",
    width: "100%",
    padding: "0.55rem 1rem",
    background: "transparent",
    border: `1px solid ${T.border}`,
    color: T.text,
    fontSize: "0.72rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    textAlign: "center",
    letterSpacing: "0.04em",
    transition: "all 0.15s",
  },

  pageLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  pageTitle: {
    fontSize: "1.4rem",
    fontWeight: 300,
    letterSpacing: "-0.02em",
    color: T.text,
    marginBottom: "1.5rem",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1px",
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
    background: T.border,
  },
  statCell: {
    background: T.bg,
    padding: "1.25rem 1.5rem",
    cursor: "default",
    transition: "background 0.15s",
  },
  statCellReg: {
    background: T.bgAlt,
    padding: "1.25rem 1.5rem",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    transition: "background 0.15s",
    gridColumn: "span 2",
  },
  statNum: {
    fontSize: "1.8rem",
    fontWeight: 300,
    letterSpacing: "-0.04em",
    color: T.text,
    margin: 0,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    marginTop: "0.35rem",
    display: "block",
  },

  tableSection: {
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
  },
  tableHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableHeaderTitle: {
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: 0,
  },
  tableHeaderMeta: {
    fontSize: "0.65rem",
    color: T.textMuted,
  },
  tableWrap: {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    width: "100%",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "600px",
  },
  th: {
    textAlign: "left",
    padding: "0.65rem 1rem",
    fontSize: "0.62rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
    background: T.bgAlt,
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
  },
  tdLink: {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 400,
    color: T.text,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },

  badge: {
    padding: "0.2rem 0.5rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
  },

  actionBtn: {
    padding: "0.3rem 0.75rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.65rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
    letterSpacing: "0.05em",
  },
  outlineBtn: {
    padding: "0.3rem 0.75rem",
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    fontSize: "0.65rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
  },

  pagination: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "1rem 1.5rem",
    borderTop: `1px solid ${T.border}`,
  },
  pgBtn: {
    padding: "0.35rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.textSec,
    fontSize: "0.72rem",
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    transition: "all 0.15s",
  },
  pgBtnActive: {
    background: T.text,
    color: T.bg,
    borderColor: T.text,
  },
};

/* ─── BADGE HELPER ─── */
const badgeStyle = (type) => {
  const map = {
    green: { borderColor: "#000", color: "#000" },
    red: { borderColor: "#000", color: "#000" },
    blue: { borderColor: "#000", color: "#000" },
    gray: { borderColor: T.border, color: T.textMuted },
    purple: { borderColor: T.border, color: T.textSec },
  };
  return { ...S.badge, ...(map[type] || map.gray) };
};

/* ─── ADVERTISEMENT COMPONENT ─── */
function AdBox({ ad }) {
  return (
    <div style={S.adWrapper}>
      <div style={S.adTopBar}>
        <span style={S.adLabel}>Advertisement</span>
        <span style={S.adPromoted}>Promoted</span>
      </div>
      <div style={S.adBody}>
        <div style={S.adLogoRow}>
          <div style={{ ...S.adLogoCircle, background: ad.logoColor }}>
            {ad.logo}
          </div>
          <div>
            <p style={S.adBrandName}>{ad.brand}</p>
            <p style={S.adTagline}>{ad.tagline}</p>
          </div>
        </div>
        <p style={S.adBodyText}>{ad.body}</p>
        <button className="da-ad-cta" style={S.adCta}>
          {ad.cta} →
        </button>
      </div>
    </div>
  );
}

/* ─── UTILITIES ─── */
function to12h(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`;
}

/* ─── TOAST ─── */
function Toast({ message, type, onClose }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [message]);

  if (!message) return null;
  const isErr = type === "error";
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 1000,
      display: "flex", alignItems: "center", gap: "10px",
      background: T.bg, border: `1px solid ${T.borderStr}`,
      borderLeft: `2px solid ${T.borderStr}`,
      padding: "0.75rem 1rem",
      fontSize: "0.78rem", fontWeight: 300, color: T.text,
      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      maxWidth: 360,
      fontFamily: "'Open Sans', sans-serif",
    }}>
      {isErr ? <AlertCircle size={13} color={T.textMuted} /> : <Check size={13} color={T.text} />}
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
        <X size={12} />
      </button>
    </div>
  );
}

/* ─── REFERRAL → APPOINTMENT MODAL ─── */
function ReferralBookingModal({ referral, onSave, onClose }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [visitType, setVisitType] = useState("OP");
  const [admType, setAdmType] = useState("");
  const [admDetail, setAdmDetail] = useState("");
  const [complaint, setComplaint] = useState(referral?.reason || "");

  const admPlaceholder = {
    ICU: "ICU type (e.g., Medical ICU)",
    Ward: "Ward number (e.g., Ward A)",
    Room: "Room number (e.g., 101)",
  }[admType] || "";

  const fieldStyle = {
    width: "100%", height: 40, padding: "0 0.875rem",
    border: `1px solid ${T.border}`, background: T.bg,
    fontFamily: "'Open Sans', sans-serif", fontWeight: 300,
    fontSize: "0.78rem", color: T.text, outline: "none",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.bg, border: `1px solid ${T.borderStr}`,
          width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto",
          fontFamily: "'Open Sans', sans-serif", fontWeight: 300,
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "1.1rem 1.5rem", borderBottom: `1px solid ${T.border}`,
        }}>
          <div>
            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.18em", color: T.textMuted, display: "block", marginBottom: "0.2rem" }}>
              Schedule Appointment
            </span>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: 0 }}>
              {referral?.patient_name}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "4px" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem" }}>
          <div style={{
            border: `1px solid ${T.border}`, background: T.bgAlt,
            padding: "0.75rem 1rem", marginBottom: "1.25rem",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem",
          }}>
            <div>
              <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>Age</span>
              <p style={{ fontSize: "0.78rem", color: T.text, margin: "2px 0 0" }}>{referral?.patient_age ?? "—"}</p>
            </div>
            <div>
              <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>Referred By</span>
              <p style={{ fontSize: "0.78rem", color: T.text, margin: "2px 0 0" }}>{referral?.from_doctor_name || "—"}</p>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>Reason</span>
              <p style={{ fontSize: "0.78rem", color: T.textSec, margin: "2px 0 0" }}>{referral?.reason || "—"}</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.875rem", marginBottom: "0.875rem" }}>
            <div>
              <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Visit Type</label>
              <select
                value={visitType}
                onChange={e => { setVisitType(e.target.value); if (e.target.value !== "IP") { setAdmType(""); setAdmDetail(""); } }}
                style={{ ...fieldStyle, cursor: "pointer" }}
              >
                <option value="OP">OP — Outpatient</option>
                <option value="IP">IP — Inpatient</option>
                <option value="followup_visit">Follow-up Visit</option>
                <option value="Emergency">Emergency</option>
              </select>
            </div>
          </div>

          {visitType === "IP" && (
            <div style={{ display: "grid", gridTemplateColumns: admType ? "1fr 1.5fr" : "1fr", gap: "0.875rem", marginBottom: "0.875rem" }}>
              <div>
                <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Admission Type *</label>
                <select value={admType} onChange={e => { setAdmType(e.target.value); setAdmDetail(""); }} style={{ ...fieldStyle, cursor: "pointer" }}>
                  <option value="">Select admission type</option>
                  <option value="ICU">ICU</option>
                  <option value="Ward">Ward</option>
                  <option value="Room">Room</option>
                </select>
              </div>
              {admType && (
                <div>
                  <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>
                    {admType === "ICU" ? "ICU Type" : admType === "Room" ? "Room Number" : "Ward Number"} *
                  </label>
                  <input type="text" value={admDetail} onChange={e => setAdmDetail(e.target.value)} placeholder={admPlaceholder} style={fieldStyle} />
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Chief Complaint</label>
            <textarea
              rows={2} value={complaint} onChange={e => setComplaint(e.target.value)}
              placeholder="Describe the patient's chief complaint…"
              style={{ ...fieldStyle, height: "auto", padding: "0.6rem 0.875rem", resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{
              padding: "0.5rem 1rem", border: `1px solid ${T.border}`,
              background: T.bg, color: T.textSec, cursor: "pointer",
              fontSize: "0.72rem", fontWeight: 300,
              display: "flex", alignItems: "center", gap: "5px",
              fontFamily: "'Open Sans', sans-serif",
            }}>
              <X size={12} /> Cancel
            </button>
            <button
              onClick={() => onSave({ date, time, visitType, admType, admDetail, complaint })}
              style={{
                padding: "0.5rem 1.25rem", border: `1px solid ${T.borderStr}`,
                background: T.text, color: T.bg, cursor: "pointer",
                fontSize: "0.72rem", fontWeight: 400,
                display: "flex", alignItems: "center", gap: "5px",
                fontFamily: "'Open Sans', sans-serif",
              }}
            >
              <Save size={12} /> Take Appointment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
function DoctorDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 768
  );

  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [todayAppointments, setTodayAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [patients, setPatients] = useState([]);
  const [searching, setSearching] = useState(false);
  const [todayIPAppointments, setTodayIPAppointments] = useState([]);
  const [loadingIPAppointments, setLoadingIPAppointments] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [referrals, setReferrals] = useState([]);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [bookingReferral, setBookingReferral] = useState(null);
  const [toast, setToast] = useState({ message: "", type: "" });

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setPatients([]); setSearchTerm("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST", credentials: "include",
      });
    } finally { navigate("/login"); }
  };

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/doctors/verify`, { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (doctorId && doctorId !== data.doctor.sys_user_id) { navigate("/login"); return; }
      } catch { navigate("/login"); }
      finally { setAuthChecked(true); }
    };
    verifyAuth();
  }, [navigate, doctorId]);


    useEffect(() => {
        if (!doctorId) return;

        (async () => {
            try {
                setLoadingAppointments(true);

                const res = await fetch(
                    `${API_BASE_URL}hms/users/doctors/doctor_all_appointments/${doctorId}`
                );

                const data = await res.json();

                console.log("ALL APPOINTMENTS:", data);

                const appointments =
                    data.status === "success"
                        ? data.appointments || []
                        : [];

                // Latest appointment date/time first
                const sortedAppointments = [...appointments].sort((a, b) => {
                    const dateA = new Date(
                        `${a.date || ""} ${a.scheduled_time || ""}`
                    );

                    const dateB = new Date(
                        `${b.date || ""} ${b.scheduled_time || ""}`
                    );

                    return dateB - dateA;
                });

                setTodayAppointments(sortedAppointments);

            } catch (error) {
                console.error("Appointment fetch error:", error);
                setTodayAppointments([]);
            } finally {
                setLoadingAppointments(false);
            }
        })();
    }, [doctorId]);


  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doctor_id: doctorId }),
          }
        );
        const data = await res.json();
        if (data.status === "success") {
          setDoctorName(data.doctor_name);
          setDoctorSpeciality(data.doctor_speciality);
        }
      } catch { }
    })();
  }, [doctorId]);

  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      try {
        setLoadingIPAppointments(true);
        const res = await fetch(
          `${API_BASE_URL}hms/users/doctors/doctor_today_ip_appointments/${doctorId}`
        );
        const data = await res.json();
        setTodayIPAppointments(data.status === "success" ? data.appointments || [] : []);
      } catch { setTodayIPAppointments([]); }
      finally { setLoadingIPAppointments(false); }
    })();
  }, [doctorId]);

  const fetchReferrals = async () => {
    if (!doctorId) return;
    try {
      setLoadingReferrals(true);
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/nurse-referral-letters/doctor/${doctorId}`
      );
      const data = await res.json();
      setReferrals(data.status === "success" ? data.data || [] : []);
    } catch { setReferrals([]); }
    finally { setLoadingReferrals(false); }
  };

  useEffect(() => {
    fetchReferrals();
  }, [doctorId]);

  const handleReferralAppointmentSave = async ({ date, time, visitType, admType, admDetail, complaint }) => {
    if (!bookingReferral) return;
    if (!date) { setToast({ message: "Please select a date.", type: "error" }); return; }
    if (visitType === "IP") {
      if (!admType) { setToast({ message: "Please select an admission type for IP.", type: "error" }); return; }
      if (!admDetail) { setToast({ message: `Please enter ${admType === "ICU" ? "ICU type" : admType === "Room" ? "room number" : "ward number"}.`, type: "error" }); return; }
    }

    const payload = {
      doctor_id: doctorId,
      sys_user_id: bookingReferral.patient_id,
      date, scheduled_time: to12h(time),
      visit_type: visitType,
      chief_complaint: complaint || bookingReferral.reason,
      ...(visitType === "IP" && {
        admission_type: admType,
        ...(admType === "ICU"  && { icu_type:    admDetail }),
        ...(admType === "Ward" && { ward_number: admDetail }),
        ...(admType === "Room" && { room_number: admDetail }),
      }),
    };

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/doctors/take_appointment`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === "success") {
        const referralId = bookingReferral.referral_id || bookingReferral._id;

        // Mark the referral as complete now that the appointment is booked
        try {
          const completeRes = await fetch(
            `${API_BASE_URL}hms/users/data/context/nurse-referral-letters/${referralId}/complete`,
            { method: "PUT", credentials: "include" }
          );
          const completeData = await completeRes.json();
          if (completeData.status !== "success") {
            console.error("Failed to mark referral complete:", completeData);
          } else {
            await fetchReferrals();
          }
        } catch (err) {
          console.error("Referral complete call failed:", err);
        }

        setToast({ message: `Appointment scheduled for ${bookingReferral.patient_name}.`, type: "success" });
        setBookingReferral(null);
      } else {
        setToast({ message: data.message || "Failed to save appointment.", type: "error" });
      }
    } catch {
      setToast({ message: "Network error. Please try again.", type: "error" });
    }
  };

  const handleRegisterPatient = () => {
    if (!doctorId) return alert("Doctor ID missing");
    navigate(`/register-patient?doctor_id=${doctorId}`);
  };

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: () => setActiveView("dashboard"), key: "dashboard" },
        { label: "Appointment", icon: <Settings size={14} />, action: () => navigate(`/appointments?doctor_id=${doctorId}`) },
        { label: "Date-wise Appointments", icon: <Calendar size={14} />, action: () => navigate(`/date-wise-appointment-dashboard?doctor_id=${doctorId}`) },
        { label: "Patient Listing", icon: <Users size={14} />, action: () => navigate(`/patient-listing?doctor_id=${doctorId}`) },
        { label: "Clinical Chat", icon: <MessageCircle size={14} />, action: () => navigate(`/chat?doctor_id=${doctorId}`) },
        { 
          label: "Clinical knowledge hub", 
          icon: <MessageCircle size={14} />, 
          action: () => window.location.href = "/oncology-clinical-workstation.html"
        },
        ...(doctorSpeciality?.toLowerCase() === "surgical oncology"
          ? [{ label: "Log Book", icon: <Notebook size={14} />, action: () => setActiveView("logbook"), key: "logbook" }]
        : []),
      ],
    },
    {
      label: "Clinical",
      items: [
         {
    label: "Knowledge Graph Upload",
    icon: <Activity size={14} />,
    action: () => navigate(`/knowledge-graph?doctor_id=${doctorId}`),
    key: "knowledgeGraph"
  },
        {
          label: "Skill View",
          icon: <Notebook size={14} />,
          action: () => navigate(`/skills?doctor_id=${doctorId}`)
        },
        {
      label: "Evidence Network",          // 👈 add this item
      icon: <Activity size={14} />,
      action: () => navigate(`/ClinicalKnowledgeGraph?doctorId=${doctorId}`)
    },
    {
      label: "Phase Upload",          // 👈 add this item
      icon: <Activity size={14} />,
      action: () => navigate(`/Phase1Upload?doctor_id=${doctorId}`)
    },
    {
      label: "Knowledge Governance",
      icon: <Activity size={14} />,
      action: () => navigate(`/governance?doctor_id=${doctorId}`)
    },
    {
      label: "Doctor Soul",
      icon: <Activity size={14} />,
      action: () => navigate(`/doctor-soul?doctor_id=${doctorId}`)
    },
        { label: "Instruction Settings", icon: <FileText size={14} />, action: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`) },
        { label: "Clinical Engine Rule", icon: <Activity size={14} />, action: () => navigate(`/agentic-rule?doctor_id=${doctorId}`) },
        { label: "Node Settings", icon: <Settings size={14} />, action: () => (window.location.href = `/settings.html?doctor_id=${doctorId}`) },
        { label: "OPD Time Schedule", icon: <Calendar size={14} />, action: () => navigate(`/opd-time-schedule?doctor_id=${doctorId}`) },
        { label: "Upload Medication Master", icon: <Upload size={14} />, action: () => navigate(`/medication-master-upload?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Communication",
      items: [
        
        { label: "Communication View", icon: <MessageCircle size={14} />, action: () => navigate(`/appointment-dashboard1?doctor_id=${doctorId}`) },
        { label: "Communication Progression", icon: <Calendar size={14} />, action: () => navigate(`/doctor-communication-dashboard?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Other",
      items: [
        { label: "Patient Registration", icon: <UserPlus size={14} />, action: handleRegisterPatient },
      ],
    },
  ];

  const calcAge = (dob) => {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    if (
      now.getMonth() - d.getMonth() < 0 ||
      (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())
    ) age--;
    return age;
  };

  const ipLocation = (appt) => {
    if (appt.admission_type === "ICU") return appt.icu_type || "ICU";
    if (appt.admission_type === "Ward") return appt.ward_number ? `Ward ${appt.ward_number}` : "Ward";
    if (appt.admission_type === "Room") return appt.room_number ? `Room ${appt.room_number}` : "Room";
    return appt.admission_type || "N/A";
  };

  if (!authChecked) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.85rem",
        color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        Verifying session…
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-action-btn:hover { background: transparent !important; color: ${T.text} !important; }
        .da-outline-btn:hover { border-color: ${T.text} !important; }
        .da-stat-cell:hover { background: ${T.bgAlt} !important; }
        .da-reg-cell:hover { background: ${T.bgTert} !important; }
        .da-tbl-row:hover td { background: ${T.bgAlt} !important; }
        .da-pg-btn:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-search-item:hover { background: ${T.bgAlt} !important; }
        .da-news-item:hover { background: ${T.bgAlt} !important; }
        .da-ad-cta:hover { background: ${T.bgTert} !important; border-color: ${T.text} !important; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }

        @media (max-width: 767px) {
          .da-main { margin-left: 0 !important; }
          .da-desktop-only { display: none !important; }
          .da-hamburger { display: flex !important; }
          .da-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .da-body { padding: 1rem !important; }
          .da-top-bar { padding: 0.75rem 1rem !important; }
          .da-dashboard-grid { grid-template-columns: 1fr !important; }
        }
        @media (min-width: 768px) {
          .da-hamburger { display: none !important; }
          .da-stats-grid { grid-template-columns: repeat(4, 1fr) !important; }
        }
        @media (min-width: 1200px) {
          .da-stats-grid { grid-template-columns: repeat(7, 1fr) !important; }
        }
      `}</style>

      {isMobile && sidebarOpen && (
        <div style={S.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ═══════════════ SIDEBAR ═══════════════ */}
      <aside style={{
        ...S.sidebar,
        transform: isMobile && !sidebarOpen ? "translateX(-100%)" : "translateX(0)",
      }}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            
            
           <span style={S.brandName}>
      EMR
  <br />
  MODULE
</span>
            {/* <span style={S.brandName}>Econet Ai</span> */}
            {isMobile && (
              <button onClick={() => setSidebarOpen(false)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.text, padding: "2px" }}>
                <X size={16} />
              </button>
            )}
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorName}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const isActive = item.key && item.key === activeView;
                return (
                  <button
                    key={ii}
                    className="da-nav-btn"
                    style={{ ...S.navBtn, ...(isActive ? S.navBtnActive : {}) }}
                    onClick={() => { item.action(); if (isMobile) setSidebarOpen(false); }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div style={S.sidebarFooter}>
          <button className="da-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══════════════ MAIN ═══════════════ */}
      <main className="da-main" style={{ ...S.main, marginLeft: isMobile ? 0 : SIDEBAR_WIDTH }}>

        <div className="da-top-bar" style={S.topBar}>
          <div style={S.topBarLeft}>
            <button className="da-hamburger" style={S.hamburger} onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <span style={S.topBarTitle}>Dashboard</span>
          </div>
        </div>

        {activeView === "dateAppointments" ? (
          <DateWiseAppointmentDashboard doctorId={doctorId} />
        ) : activeView === "communication" ? (
          <AppointmentDashboard />
        ) : activeView === "logbook" ? (
          <DoctorLogBook doctorId={doctorId} />
        ) : (
          <div className="da-body" style={S.body}>
            <div className="da-dashboard-grid" style={S.dashboardContent}>

              {/* ── LEFT ── */}
              <div style={S.mainContent}>

                <span style={S.pageLabel}>Clinical Interface</span>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
                  <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>
                    {doctorName ? `Dr. ${doctorName}` : "Dashboard"}
                  </h1>
                  <button
                    onClick={handleRegisterPatient}
                    style={{ ...S.actionBtn, display: "flex", alignItems: "center", gap: "6px", fontSize: "0.72rem" }}
                    className="da-action-btn"
                  >
                    <UserPlus size={13} /> Register Patient
                  </button>
                </div>

                {/* STATS */}
                <div className="da-stats-grid" style={S.statsGrid}>
                  {[
                    { label: "OP Appointments", val: "0" },
                    { label: "IP Appointments", val: "0" },
                    { label: "Operations", val: "0" },
                    { label: "Ward Patients", val: "0" },
                    { label: "ICU Patients", val: "0" },
                    { label: "Discharge", val: "0" },
                    { label: "Room Patients", val: "0" },
                  ].map((c, i) => (
                    <div key={i} className="da-stat-cell" style={S.statCell}>
                      <span style={S.statLabel}>{c.label}</span>
                      <p style={S.statNum}>{c.val}</p>
                    </div>
                  ))}
                  <div className="da-reg-cell" style={S.statCellReg} onClick={handleRegisterPatient}>
                    <span style={S.statLabel}>Action</span>
                    <p style={{ ...S.statNum, fontSize: "0.95rem", fontWeight: 400 }}>Patient Registration →</p>
                    <span style={{ fontSize: "0.65rem", color: T.textMuted, marginTop: "0.25rem" }}>
                      Click to register a new patient
                    </span>
                  </div>
                </div>

                {/* TODAY'S APPOINTMENTS */}
                <div style={S.tableSection}>
                  <div style={S.tableHeader}>
                    <span style={S.tableHeaderTitle}>Today's Appointments</span>
                    <span style={S.tableHeaderMeta}>{todayAppointments.length} record{todayAppointments.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                            {[
                                "Patient Name",
                                "Mobile",
                                "Age",
                                "Appointment Date",
                                "Time",
                                "Status",
                                "Chief Complaint",
                                "Report/Upload",
                                "DICOM",
                                "Preventivescreening",
                                "Actions"
                            ].map(h => (
                                <th key={h} style={S.th}>{h}</th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {loadingAppointments ? (
                            <tr>
                                <td
                                    colSpan={11}
                                    style={{
                                        ...S.td,
                                        textAlign: "center",
                                        padding: "2rem",
                                        color: T.textMuted
                                    }}
                                >
                                    Loading appointments…
                                </td>
                            </tr>
                        ) : todayAppointments.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={11}
                                    style={{
                                        ...S.td,
                                        textAlign: "center",
                                        padding: "2rem",
                                        color: T.textMuted
                                    }}
                                >
                                    No appointments
                                </td>
                            </tr>
                        ) : (
                            todayAppointments.map((appt, i) => (
                                <tr key={i} className="da-tbl-row">

                                    <td
                                        style={S.tdLink}
                                        onClick={() =>
                                            doctorId &&
                                            navigate(
                                                `/dashboard?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`
                                            )
                                        }
                                    >
                                        {appt.patient_name}
                                    </td>

                                    <td style={S.td}>
                                        {appt.patient_phone}
                                    </td>

                                    <td style={S.td}>
                                        {calcAge(appt.patient_dob)}
                                    </td>

                                    {/* APPOINTMENT DATE */}
                                    <td style={S.td}>
                                        {appt.date || "—"}
                                    </td>

                                    {/* APPOINTMENT TIME */}
                                    <td style={S.td}>
                                        {appt.scheduled_time || "—"}
                                    </td>

                                    <td style={S.td}>
                                        <span
                                            style={{
                                                ...S.badge,
                                                borderColor: T.border,
                                                color: T.textSec
                                            }}
                                        >
                                            Scheduled
                                        </span>
                                    </td>

                                    <td style={S.td}>
                                        {appt.chief_complaint || "—"}
                                    </td>

                                    <td style={S.td}>
                                        <button
                                            className="da-outline-btn"
                                            style={S.outlineBtn}
                                            onClick={() =>
                                                doctorId &&
                                                navigate(
                                                    `/report-upload?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`
                                                )
                                            }
                                        >
                                            Upload
                                        </button>
                                    </td>

                                    <td style={S.td}>
                                        <a
                                            href={`/upload.html?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`}
                                            className="da-action-btn"
                                            style={S.actionBtn}
                                        >
                                            Upload
                                        </a>
                                    </td>

                                    <td style={S.td}>
                                        <button
                                            className="da-outline-btn"
                                            style={S.outlineBtn}
                                            onClick={() =>
                                                doctorId &&
                                                navigate(
                                                    `/Preventivescreening?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`
                                                )
                                            }
                                        >
                                            Preventivescreening
                                        </button>
                                    </td>

                                    <td style={S.td}>
                                        <a
                                            href={`/screen.html?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`}
                                            className="da-action-btn"
                                            style={S.actionBtn}
                                        >
                                            Start →
                                        </a>
                                    </td>

                                </tr>
                            ))
                        )}
                    </tbody>
                    </table>
                  </div>
                </div>

                {/* IPD PATIENT LISTING */}
                <div style={S.tableSection}>
                  <div style={S.tableHeader}>
                    <span style={S.tableHeaderTitle}>IPD Patient Listing</span>
                    <span style={S.tableHeaderMeta}>{todayIPAppointments.length} record{todayIPAppointments.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {["Patient Name", "Age", "Admission Type", "Location", "Admitted Date", "Time", "Chief Complaint", "Status", "Actions", "Screening"].map(h => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {loadingIPAppointments ? (
                          <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>Loading IPD patients…</td></tr>
                        ) : todayIPAppointments.length === 0 ? (
                          <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>No IPD patients found</td></tr>
                        ) : todayIPAppointments
                          .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                          .map((appt, i) => (
                            <tr key={i} className="da-tbl-row">
                              <td style={S.tdLink} onClick={() => doctorId && navigate(`/IPDashboard?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`)}>
                                {appt.patient_name}
                              </td>
                              <td style={S.td}>{calcAge(appt.patient_dob)}</td>
                              <td style={S.td}><span style={{ ...S.badge }}>{appt.admission_type || "N/A"}</span></td>
                              <td style={S.td}><span style={{ ...S.badge }}>{ipLocation(appt)}</span></td>
                              <td style={S.td}>{new Date(appt.date).toLocaleDateString()}</td>
                              <td style={S.td}>{appt.scheduled_time}</td>
                              <td style={S.td}>{appt.chief_complaint || "—"}</td>
                              <td style={S.td}><span style={{ ...S.badge }}>{appt.patient_status || "Admitted"}</span></td>
                              <td style={S.td}>
                                <button className="da-outline-btn" style={S.outlineBtn}
                                  onClick={() => doctorId && navigate(`/report-upload?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`)}>
                                  Upload
                                </button>
                              </td>
                              <td style={S.td}>
                                <a href={`/screen.html?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`} className="da-action-btn" style={S.actionBtn}>Start →</a>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {todayIPAppointments.length > itemsPerPage && (
                    <div style={S.pagination}>
                      <button className="da-pg-btn" style={S.pgBtn} disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>← Previous</button>
                      {Array.from({ length: Math.ceil(todayIPAppointments.length / itemsPerPage) }, (_, i) => (
                        <button key={i} className="da-pg-btn"
                          style={{ ...S.pgBtn, ...(currentPage === i + 1 ? S.pgBtnActive : {}) }}
                          onClick={() => setCurrentPage(i + 1)}>{i + 1}</button>
                      ))}
                      <button className="da-pg-btn" style={S.pgBtn}
                        disabled={currentPage === Math.ceil(todayIPAppointments.length / itemsPerPage)}
                        onClick={() => setCurrentPage((p) => Math.min(Math.ceil(todayIPAppointments.length / itemsPerPage), p + 1))}>Next →</button>
                      <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: T.textMuted }}>
                        {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, todayIPAppointments.length)} of {todayIPAppointments.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* REFERRAL LISTING */}
                <div style={{ ...S.tableSection}}>
                  <div style={S.tableHeader}>
                    <span style={S.tableHeaderTitle}>Referral Listing</span>
                    <span style={S.tableHeaderMeta}>{referrals.length} record{referrals.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {["Patient Name", "Age", "Referred By", "Reason", "Status", "Action"].map(h => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {loadingReferrals ? (
                          <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>Loading referrals…</td></tr>
                        ) : referrals.length === 0 ? (
                          <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>No referrals</td></tr>
                        ) : referrals.map((ref) => (
                          <tr key={ref._id} className="da-tbl-row">
                            <td style={S.td}>{ref.patient_name}</td>
                            <td style={S.td}>{ref.patient_age ?? "—"}</td>
                            <td style={S.td}>{ref.from_doctor_name || "—"}</td>
                            <td style={{ ...S.td, whiteSpace: "normal", maxWidth: 260 }}>{ref.reason || "—"}</td>
                            <td style={S.td}>
                              <span style={{ ...S.badge, borderColor: T.border, color: T.textSec, textTransform: "capitalize" }}>
                                {ref.status || "pending"}
                              </span>
                            </td>
                            <td style={S.td}>
                              <button className="da-action-btn" style={S.actionBtn} onClick={() => setBookingReferral(ref)}>
                                Take Appointment
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SPECIALITY DASHBOARD — gated by doctor speciality.
                  Others: add your speciality + component to SPECIALITY_DASHBOARDS. */}
                {(() => {
                  const spec = doctorSpeciality?.toLowerCase().trim();
                  const entry = SPECIALITY_DASHBOARDS[spec];
                  if (!entry) return null;
                  const { title, Component } = entry;
                  return (
                    <div style={{ ...S.tableSection, marginBottom: 0 }}>
                      <div style={S.tableHeader}>
                        <span style={S.tableHeaderTitle}>{title}</span>
                      </div>
                      <div style={{ padding: "0.5rem 1rem 1rem" }}>
                        <Component doctorId={doctorId} />
                      </div>
                    </div>
                  );
                })()}             

              </div>

              {/* ── RIGHT: Top Stories + Ad ── */}
              <div style={S.rightSidebar}>
                <div style={S.newsHeader}>Top Stories</div>

                {[
                  { title: "AI adoption increasing in hospitals", time: "14m ago" },
                  { title: "Healthcare startups raise new funding", time: "22m ago" },
                  { title: "Doctors using voice AI for consultations", time: "1h ago" },
                  { title: "New ICU monitoring systems launched", time: "2h ago" },
                  { title: "Medical imaging AI improves diagnostics", time: "3h ago" },
                  { title: "Wearable devices aid remote patient monitoring", time: "4h ago" },
                 
                ].map((news, i) => (
                  <div key={i} className="da-news-item" style={S.newsItem}>
                    <div style={S.newsTitle}>{news.title}</div>
                    <div style={S.newsMeta}>{news.time}</div>
                  </div>
                ))}

                {/* ── AD: one random ad per reload ── */}
                <AdBox ad={CURRENT_AD} />

              </div>

            </div>
          </div>
        )}
      </main>

      {bookingReferral && (
        <ReferralBookingModal
          referral={bookingReferral}
          onSave={handleReferralAppointmentSave}
          onClose={() => setBookingReferral(null)}
        />
      )}

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "" })} />
    </div>
  );
}

export default DoctorDashboard;