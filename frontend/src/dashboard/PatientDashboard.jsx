import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Home, Calendar, FileText, Activity, LogOut,
  Clock, ChevronRight, Bell, AlertCircle,
  CheckCircle, XCircle, Loader, User,
  Stethoscope, TrendingUp, Plus,
} from "lucide-react";

/* ─────────────────────────────────────────
   THEME TOKENS (matches appointment page)
───────────────────────────────────────── */
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

/* ─────────────────────────────────────────
   GLOBAL CSS
───────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::selection { background: #000; color: #fff; }

  body, html {
    font-family: ${T.font};
    font-weight: 300;
    background: ${T.bg};
    color: ${T.text};
    -webkit-font-smoothing: antialiased;
  }
  input, select, textarea, button { font-family: ${T.font}; font-weight: 300; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: ${T.bgAlt}; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; }

  @keyframes pd-slideDown {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pd-fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pd-pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes pd-shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position: 400px 0; }
  }

  .pd-nav-btn { transition: background 0.15s, color 0.15s; }
  .pd-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
  .pd-nav-btn.pd-active-nav {
    background: ${T.bgAlt} !important;
    color: ${T.text} !important;
    border-left-color: ${T.borderStr} !important;
  }

  .pd-outline-hover:hover { border-color: ${T.borderStr} !important; color: ${T.text} !important; }

  .pd-card {
    border: 1px solid ${T.border};
    background: ${T.bg};
    transition: border-color 0.15s;
  }
  .pd-card:hover { border-color: #c8c8c8; }

  .pd-shimmer {
    background: linear-gradient(90deg, ${T.bgAlt} 25%, ${T.bgTert} 50%, ${T.bgAlt} 75%);
    background-size: 400px 100%;
    animation: pd-shimmer 1.4s infinite linear;
    border-radius: 0;
  }

  .pd-appt-row {
    border-bottom: 1px solid ${T.border};
    transition: background 0.12s;
    cursor: default;
  }
  .pd-appt-row:last-child { border-bottom: none; }
  .pd-appt-row:hover { background: ${T.bgAlt}; }

  .pd-book-btn {
    background: ${T.text};
    color: ${T.bg};
    border: 1px solid ${T.borderStr};
    transition: background 0.15s, color 0.15s;
  }
  .pd-book-btn:hover {
    background: transparent !important;
    color: ${T.text} !important;
  }

  .pd-slide-in { animation: pd-slideDown 0.22s ease; }
  .pd-fade-in  { animation: pd-fadeIn 0.25s ease; }
`;

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */
const API_BASE_URL =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_BACKEND_URL || ""
    : "";

function initials(name) {
  return (name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtDateFull(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
}

/* ─────────────────────────────────────────
   AVATAR
───────────────────────────────────────── */
function Avatar({ name, size = 32 }) {
  return (
    <div style={{
      width: size, height: size,
      background: T.bgAlt, border: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.32, fontWeight: 400, color: T.textMuted,
      flexShrink: 0, letterSpacing: "0.04em",
    }}>
      {initials(name)}
    </div>
  );
}

/* ─────────────────────────────────────────
   STATUS BADGE
───────────────────────────────────────── */
function StatusBadge({ status }) {
  const map = {
    scheduled:  { label: "Scheduled",  color: T.text,     bg: T.bgTert,  border: T.border },
    confirmed:  { label: "Confirmed",  color: "#1a6b1a",  bg: "#f0f9f0",  border: "#b8ddb8" },
    completed:  { label: "Completed",  color: T.textMuted, bg: T.bgAlt,   border: T.border },
    cancelled:  { label: "Cancelled",  color: "#8b1a1a",  bg: "#fdf0f0",  border: "#e0b8b8" },
    pending:    { label: "Pending",    color: "#6b4c00",  bg: "#fdf8ee",  border: "#e0d0a0" },
    no_show:    { label: "No Show",    color: T.textMuted, bg: T.bgTert,   border: T.border },
  };
  const s = map[status?.toLowerCase()] || map["scheduled"];
  return (
    <span style={{
      fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase",
      fontWeight: 400, padding: "0.2rem 0.55rem",
      border: `1px solid ${s.border}`,
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

/* ─────────────────────────────────────────
   STAT CARD
───────────────────────────────────────── */
function StatCard({ label, value, sub, icon, loading }) {
  return (
    <div className="pd-card" style={{ padding: "1.25rem 1.5rem", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted }}>{label}</span>
        <span style={{ color: T.textMuted }}>{icon}</span>
      </div>
      {loading ? (
        <div className="pd-shimmer" style={{ height: 28, width: "60%", marginBottom: "0.4rem" }} />
      ) : (
        <div style={{ fontSize: "1.75rem", fontWeight: 300, color: T.text, lineHeight: 1, marginBottom: "0.25rem" }}>
          {value ?? "—"}
        </div>
      )}
      {loading ? (
        <div className="pd-shimmer" style={{ height: 14, width: "80%" }} />
      ) : (
        <div style={{ fontSize: "0.65rem", color: T.textMuted }}>{sub}</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   SHIMMER ROW
───────────────────────────────────────── */
function ShimmerRows({ count = 3 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}`, display: "flex", gap: "0.875rem", alignItems: "center" }}>
      <div className="pd-shimmer" style={{ width: 36, height: 36, flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <div className="pd-shimmer" style={{ height: 13, width: "55%" }} />
        <div className="pd-shimmer" style={{ height: 11, width: "35%" }} />
      </div>
      <div className="pd-shimmer" style={{ height: 20, width: 70 }} />
    </div>
  ));
}

/* ─────────────────────────────────────────
   MAIN DASHBOARD
───────────────────────────────────────── */
export default function PatientDashboard() {
  const location  = useLocation();
  const navigate  = useNavigate();

  const queryParams = new URLSearchParams(location.search);
  const patientId   = queryParams.get("patient_id");
  const hospitalId  = queryParams.get("hospital_id") || "HSP-f2e6baa3-26ee-4c2e-97da-65a54296125e";

  /* ── state ── */
  const [patient,        setPatient]        = useState(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [appointments,   setAppointments]   = useState([]);
  const [apptLoading,    setApptLoading]    = useState(true);
  const [activeTab,      setActiveTab]      = useState("upcoming"); // upcoming | past
  const [error,          setError]          = useState("");

  /* inject CSS */
  useEffect(() => {
    const id = "pd-dash-css";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id; el.textContent = GLOBAL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  /* fetch patient info */
  useEffect(() => {
    if (!patientId) { setPatientLoading(false); return; }
    setPatientLoading(true);
    fetch(`${API_BASE_URL}hms/users/patient/${patientId}`)
      .then(r => r.json())
      .then(data => setPatient(data))
      .catch(() => setError("Could not load patient details."))
      .finally(() => setPatientLoading(false));
  }, [patientId]);

  /* fetch appointments */
  useEffect(() => {
    if (!patientId) { setApptLoading(false); return; }
    setApptLoading(true);
    fetch(`${API_BASE_URL}hms/users/patient/${patientId}/appointments`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setAppointments(data);
        else if (data.appointments) setAppointments(data.appointments);
      })
      .catch(() => setError("Could not load appointments."))
      .finally(() => setApptLoading(false));
  }, [patientId]);

  /* ── derived stats ── */
  const today      = new Date().toISOString().slice(0, 10);
  const upcoming   = appointments.filter(a => a.date >= today && a.status?.toLowerCase() !== "cancelled" && a.status?.toLowerCase() !== "completed");
  const past       = appointments.filter(a => a.date < today  || a.status?.toLowerCase() === "completed");
  const nextAppt   = upcoming.sort((a, b) => a.date > b.date ? 1 : -1)[0];
  const displayList = activeTab === "upcoming" ? upcoming : past;

  /* ── nav to book appointment ── */
  const goToBook = () => {
    const params = new URLSearchParams();
    if (patientId)  params.set("patient_id", patientId);
    if (hospitalId) params.set("hospital_id", hospitalId);
    navigate(`/patient-portal-appointments?${params.toString()}`);
  };

  /* ── missing patient ID ── */
  if (!patientId) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: T.bg, alignItems: "center", justifyContent: "center", fontFamily: T.font }}>
        <div style={{ textAlign: "center", padding: "2.5rem", border: `1px solid ${T.border}`, maxWidth: 400 }}>
          <AlertCircle size={32} color={T.textMuted} />
          <h2 style={{ marginTop: "1rem", fontSize: "1rem", fontWeight: 400 }}>Missing Patient ID</h2>
          <p style={{ color: T.textMuted, fontSize: "0.75rem", marginTop: "0.5rem", lineHeight: 1.6 }}>
            Please use the correct format:<br />
            /patient-dashboard?patient_id=YOUR_PATIENT_ID
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, fontFamily: T.font, fontWeight: 300 }}>

      {/* ══════════ SIDEBAR ══════════ */}
      <aside style={{
        width: 240, minHeight: "100vh", flexShrink: 0,
        background: T.bg, borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
      }}>
        {/* brand + patient */}
        <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text }}>DoctorAssist.AI</span>
          </div>
          <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.18em", color: T.textMuted, display: "block", marginBottom: "0.2rem" }}>Patient</span>
          {patientLoading ? (
            <div className="pd-shimmer" style={{ height: 14, width: "80%", marginBottom: 4 }} />
          ) : (
            <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: 0 }}>
              {patient?.name || "Unknown Patient"}
            </p>
          )}
          {patientId && (
            <p style={{ fontSize: "0.66rem", color: T.textMuted, margin: "3px 0 0", wordBreak: "break-all" }}>
            </p>
          )}
        </div>

        {/* nav */}
        <nav style={{ flex: 1, padding: "0.75rem 0" }}>
          <span style={{
            fontSize: "0.58rem", textTransform: "uppercase",
            letterSpacing: "0.15em", color: T.textMuted,
            padding: "0.5rem 1.25rem", display: "block",
          }}>Navigation</span>

          {[
            { icon: <Home size={14} strokeWidth={1.5} />,     label: "Dashboard",        active: true,  onClick: () => {} },
            { icon: <Calendar size={14} strokeWidth={1.5} />, label: "Book Appointment",  active: false, onClick: goToBook },
            { icon: <FileText size={14} strokeWidth={1.5} />, label: "My Appointments",  active: false, onClick: () => {} },
            { icon: <Activity size={14} strokeWidth={1.5} />, label: "Health Records",   active: false, onClick: () => {} },
          ].map(item => (
            <button
              key={item.label}
              className={`pd-nav-btn${item.active ? " pd-active-nav" : ""}`}
              onClick={item.onClick}
              style={{
                width: "100%", background: "transparent", border: "none",
                textAlign: "left", padding: "0.55rem 1.25rem",
                fontSize: "0.78rem", fontWeight: item.active ? 400 : 300,
                color: item.active ? T.text : T.textSec,
                cursor: "pointer", display: "flex", alignItems: "center", gap: "10px",
                fontFamily: T.font, transition: "all 0.15s",
                borderLeft: item.active ? `2px solid ${T.borderStr}` : "2px solid transparent",
              }}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </nav>

        {/* logout */}
        <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}` }}>
          <button
            className="pd-outline-hover"
            onClick={() => navigate("/login")}
            style={{
              width: "100%", background: T.bg, border: `1px solid ${T.border}`,
              padding: "0.6rem 1rem", fontSize: "0.75rem", fontWeight: 400,
              color: T.textSec, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontFamily: T.font, transition: "all 0.2s",
            }}
          >
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ══════════ MAIN CONTENT ══════════ */}
      <div style={{ flex: 1, marginLeft: 240, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* top bar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 50,
          background: T.bg, borderBottom: `1px solid ${T.border}`,
          padding: "0.875rem 2rem",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: T.textMuted, display: "block", marginBottom: "0.15rem" }}>Patient Portal</span>
            <h1 style={{ fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>
              {patientLoading ? "Loading…" : `Welcome back${patient?.name ? `, ${patient.name.split(" ")[0]}` : ""}`}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              className="pd-book-btn"
              onClick={goToBook}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "0.5rem 1rem", cursor: "pointer",
                fontSize: "0.72rem", fontWeight: 400,
              }}
            >
              <Plus size={12} strokeWidth={2} /> Book Appointment
            </button>
            <button className="pd-outline-hover" style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "0.45rem 0.875rem",
              border: `1px solid ${T.border}`, background: T.bg,
              fontSize: "0.72rem", fontWeight: 300, color: T.textMuted, cursor: "pointer",
              transition: "all 0.15s",
            }}>
              <Bell size={13} strokeWidth={1.5} /> Notifications
            </button>
          </div>
        </div>

        {/* ══ BODY ══ */}
        <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto", width: "100%", flex: 1 }}>

          {/* ── Patient Profile Strip ── */}
          {!patientLoading && patient && (
            <div className="pd-card pd-slide-in" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1.25rem" }}>
              <Avatar name={patient.name} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "1rem", fontWeight: 400, color: T.text }}>{patient.name}</div>
                <div style={{ fontSize: "0.68rem", color: T.textMuted, marginTop: "3px", display: "flex", flexWrap: "wrap", gap: "0 1.25rem" }}>
                  {patient.age    && <span>Age {patient.age}</span>}
                  {patient.gender && <span style={{ textTransform: "capitalize" }}>{patient.gender}</span>}
                  {patient.phone  && <span>{patient.phone}</span>}
                  {patient.email  && <span>{patient.email}</span>}
                  {patient.blood_group && <span>Blood {patient.blood_group}</span>}
                </div>
              </div>
              {nextAppt && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "0.25rem" }}>Next Appointment</div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 400, color: T.text }}>{fmtDate(nextAppt.date)}</div>
                  <div style={{ fontSize: "0.68rem", color: T.textMuted }}>{nextAppt.scheduled_time} · Dr. {nextAppt.doctor_name || "—"}</div>
                </div>
              )}
            </div>
          )}

          {/* ── Stat Cards ── */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
            <StatCard
              label="Total Appointments"
              value={apptLoading ? null : appointments.length}
              sub="All time"
              icon={<Calendar size={14} strokeWidth={1.5} />}
              loading={apptLoading}
            />
            <StatCard
              label="Upcoming"
              value={apptLoading ? null : upcoming.length}
              sub="Scheduled ahead"
              icon={<Clock size={14} strokeWidth={1.5} />}
              loading={apptLoading}
            />
            <StatCard
              label="Completed"
              value={apptLoading ? null : past.filter(a => a.status?.toLowerCase() === "completed").length}
              sub="Past visits"
              icon={<CheckCircle size={14} strokeWidth={1.5} />}
              loading={apptLoading}
            />
            <StatCard
              label="Doctors Seen"
              value={apptLoading ? null : [...new Set(appointments.map(a => a.doctor_id).filter(Boolean))].length}
              sub="Unique doctors"
              icon={<Stethoscope size={14} strokeWidth={1.5} />}
              loading={apptLoading}
            />
          </div>

          {/* ── Next Appointment Highlight ── */}
          {!apptLoading && nextAppt && (
            <div className="pd-card pd-slide-in" style={{ marginBottom: "1.5rem", padding: "1.25rem 1.5rem" }}>
              <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, marginBottom: "1rem" }}>Your next visit</div>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{
                    width: 44, height: 44, background: T.bgAlt, border: `1px solid ${T.border}`,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "1.1rem", fontWeight: 300, lineHeight: 1, color: T.text }}>
                      {new Date(nextAppt.date + "T00:00:00").getDate()}
                    </span>
                    <span style={{ fontSize: "0.5rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>
                      {new Date(nextAppt.date + "T00:00:00").toLocaleDateString("en-IN", { month: "short" })}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>
                      Dr. {nextAppt.doctor_name || nextAppt.doctor_id || "—"}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: T.textMuted, marginTop: "2px" }}>
                      {nextAppt.speciality || nextAppt.visit_type || "Consultation"} · {nextAppt.scheduled_time}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  {nextAppt.chief_complaint && (
                    <span style={{ fontSize: "0.68rem", color: T.textMuted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      "{nextAppt.chief_complaint}"
                    </span>
                  )}
                  <StatusBadge status={nextAppt.status || "scheduled"} />
                </div>
              </div>
            </div>
          )}

          {/* ── Appointments List ── */}
          <div className="pd-card" style={{ marginBottom: "1.5rem" }}>
            {/* card header + tabs */}
            <div style={{
              padding: "1rem 1.5rem",
              borderBottom: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
            }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 400, color: T.text }}>Appointments</span>
              <div style={{ display: "flex", gap: "2px" }}>
                {["upcoming", "past"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "0.35rem 0.875rem",
                      border: `1px solid ${activeTab === tab ? T.borderStr : T.border}`,
                      background: activeTab === tab ? T.text : T.bg,
                      color: activeTab === tab ? T.bg : T.textSec,
                      fontSize: "0.68rem", fontWeight: 300, cursor: "pointer",
                      fontFamily: T.font,
                      textTransform: "capitalize",
                      transition: "all 0.12s",
                    }}
                  >
                    {tab} {!apptLoading && (
                      <span style={{ opacity: 0.7 }}>
                        ({tab === "upcoming" ? upcoming.length : past.length})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* list */}
            {apptLoading ? (
              <ShimmerRows count={4} />
            ) : displayList.length === 0 ? (
              <div style={{
                padding: "3rem 1.5rem", textAlign: "center",
                fontSize: "0.75rem", color: T.textMuted,
              }}>
                {activeTab === "upcoming"
                  ? "No upcoming appointments."
                  : "No past appointments yet."}
                {activeTab === "upcoming" && (
                  <div style={{ marginTop: "0.875rem" }}>
                    <button
                      onClick={goToBook}
                      className="pd-book-btn"
                      style={{
                        padding: "0.5rem 1.25rem", cursor: "pointer",
                        fontSize: "0.72rem", fontWeight: 400,
                        display: "inline-flex", alignItems: "center", gap: "6px",
                      }}
                    >
                      <Plus size={12} /> Book your first appointment
                    </button>
                  </div>
                )}
              </div>
            ) : (
              displayList
                .sort((a, b) => a.date > b.date ? (activeTab === "upcoming" ? 1 : -1) : (activeTab === "upcoming" ? -1 : 1))
                .map((appt, idx) => (
                  <div key={appt.appointment_id || idx} className="pd-appt-row" style={{ padding: "0.875rem 1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                    {/* date block */}
                    <div style={{
                      width: 40, height: 40, background: T.bgAlt, border: `1px solid ${T.border}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <span style={{ fontSize: "0.9rem", fontWeight: 300, lineHeight: 1, color: T.text }}>
                        {new Date(appt.date + "T00:00:00").getDate()}
                      </span>
                      <span style={{ fontSize: "0.44rem", textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted }}>
                        {new Date(appt.date + "T00:00:00").toLocaleDateString("en-IN", { month: "short" })}
                      </span>
                    </div>

                    {/* info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 400, color: T.text, marginBottom: "2px" }}>
                        Dr. {appt.doctor_name || appt.doctor_id || "—"}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: T.textMuted, display: "flex", flexWrap: "wrap", gap: "0 0.875rem" }}>
                        {appt.scheduled_time && <span><Clock size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />{appt.scheduled_time}</span>}
                        {appt.speciality     && <span>{appt.speciality}</span>}
                        {appt.visit_type     && <span style={{ textTransform: "capitalize" }}>{appt.visit_type.replace(/_/g, " ")}</span>}
                        {appt.chief_complaint && (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                            {appt.chief_complaint}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* status */}
                    <StatusBadge status={appt.status || "scheduled"} />
                  </div>
                ))
            )}
          </div>

          {/* ── Quick Actions ── */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <button
              className="pd-card"
              onClick={goToBook}
              style={{
                flex: 1, minWidth: 160, padding: "1.25rem 1.5rem",
                display: "flex", alignItems: "center", gap: "12px",
                cursor: "pointer", background: T.bg, border: `1px solid ${T.border}`,
                fontFamily: T.font, textAlign: "left",
                transition: "border-color 0.15s",
              }}
            >
              <Calendar size={18} strokeWidth={1.5} color={T.textMuted} />
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text, marginBottom: "2px" }}>Book Appointment</div>
                <div style={{ fontSize: "0.65rem", color: T.textMuted }}>Schedule a new visit</div>
              </div>
              <ChevronRight size={14} color={T.textMuted} style={{ marginLeft: "auto" }} />
            </button>

            <button
              className="pd-card"
              style={{
                flex: 1, minWidth: 160, padding: "1.25rem 1.5rem",
                display: "flex", alignItems: "center", gap: "12px",
                cursor: "pointer", background: T.bg, border: `1px solid ${T.border}`,
                fontFamily: T.font, textAlign: "left",
                transition: "border-color 0.15s",
              }}
            >
              <FileText size={18} strokeWidth={1.5} color={T.textMuted} />
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text, marginBottom: "2px" }}>Health Records</div>
                <div style={{ fontSize: "0.65rem", color: T.textMuted }}>View your medical history</div>
              </div>
              <ChevronRight size={14} color={T.textMuted} style={{ marginLeft: "auto" }} />
            </button>

            <button
              className="pd-card"
              style={{
                flex: 1, minWidth: 160, padding: "1.25rem 1.5rem",
                display: "flex", alignItems: "center", gap: "12px",
                cursor: "pointer", background: T.bg, border: `1px solid ${T.border}`,
                fontFamily: T.font, textAlign: "left",
                transition: "border-color 0.15s",
              }}
            >
              <User size={18} strokeWidth={1.5} color={T.textMuted} />
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text, marginBottom: "2px" }}>My Profile</div>
                <div style={{ fontSize: "0.65rem", color: T.textMuted }}>Update personal details</div>
              </div>
              <ChevronRight size={14} color={T.textMuted} style={{ marginLeft: "auto" }} />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}