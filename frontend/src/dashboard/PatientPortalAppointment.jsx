import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search, Calendar, Save, Bell, Stethoscope,
  Home, LogOut, X, Check, AlertCircle,
  SlidersHorizontal, User, Clock, ChevronRight,
  Activity, FileText,
} from "lucide-react";

/* ─────────────────────────────────────────
   THEME TOKENS (same as doctor page)
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

  @keyframes pp-slideDown {
    from { opacity: 0; transform: translateY(-5px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pp-pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes pp-spin   { to { transform: rotate(360deg); } }
  @keyframes pp-shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position: 400px 0; }
  }

  .pp-nav-btn { transition: background 0.15s, color 0.15s; }
  .pp-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
  .pp-nav-btn.pp-active-nav { background: ${T.bgAlt} !important; color: ${T.text} !important; border-left-color: ${T.borderStr} !important; }

  .pp-save-btn:hover { background: transparent !important; color: ${T.text} !important; }
  .pp-outline-hover:hover { border-color: ${T.borderStr} !important; color: ${T.text} !important; }

  .pp-input {
    width: 100%; height: 40px; padding: 0 0.875rem;
    border: 1px solid ${T.border}; background: ${T.bg};
    font-family: ${T.font}; font-weight: 300;
    font-size: 0.78rem; color: ${T.text};
    outline: none; border-radius: 0; appearance: none;
    transition: border-color 0.15s;
  }
  .pp-input::placeholder { color: #bbbbbb; }
  .pp-input:focus { border-color: ${T.borderStr}; }
  .pp-input:hover { border-color: #c0c0c0; }
  textarea.pp-input { height: auto; padding: 0.6rem 0.875rem; resize: vertical; }
  select.pp-input {
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 1.75rem;
  }

  .pp-slot-btn {
    padding: 0.45rem 0.625rem;
    border: 1px solid ${T.border};
    background: ${T.bg};
    font-family: ${T.font}; font-size: 0.7rem; font-weight: 300;
    color: ${T.textSec}; cursor: pointer;
    transition: all 0.12s;
    white-space: nowrap;
  }
  .pp-slot-btn:hover:not(:disabled) {
    border-color: ${T.borderStr};
    color: ${T.text};
  }
  .pp-slot-btn.pp-slot-selected {
    background: ${T.text};
    color: ${T.bg};
    border-color: ${T.borderStr};
    font-weight: 400;
  }
  .pp-slot-btn:disabled {
    background: ${T.bgTert};
    color: #cccccc;
    cursor: not-allowed;
    border-color: ${T.border};
    text-decoration: line-through;
    opacity: 0.6;
  }

  .pp-doctor-card {
    border: 1px solid ${T.border};
    padding: 0.875rem 1rem;
    cursor: pointer;
    transition: all 0.12s;
    background: ${T.bg};
  }
  .pp-doctor-card:hover { border-color: #c0c0c0; background: ${T.bgAlt}; }
  .pp-doctor-card.pp-doctor-selected {
    border-color: ${T.borderStr};
    border-left: 2px solid ${T.borderStr};
    background: ${T.bgAlt};
  }

  .pp-shimmer {
    background: linear-gradient(90deg, ${T.bgAlt} 25%, ${T.bgTert} 50%, ${T.bgAlt} 75%);
    background-size: 400px 100%;
    animation: pp-shimmer 1.4s infinite linear;
  }

  .pp-slide-in { animation: pp-slideDown 0.2s ease; }
  .pp-fade-in  { animation: pp-fadeIn 0.25s ease; }
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
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
   TOAST
───────────────────────────────────────── */
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
      animation: "pp-slideDown 0.2s ease",
      maxWidth: 360,
    }}>
      {isErr
        ? <AlertCircle size={13} color={T.textMuted} />
        : <Check size={13} color={T.text} />}
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
        <X size={12} />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────
   LABEL
───────────────────────────────────────── */
function Label({ children }) {
  return (
    <label style={{
      fontSize: "0.58rem", color: T.textMuted,
      textTransform: "uppercase", letterSpacing: "0.12em",
      display: "block", marginBottom: "0.3rem",
    }}>
      {children}
    </label>
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
          <div key={i} className="pp-shimmer" style={{ width: 90, height: 32 }} />
        ))}
      </div>
    );
  }

  const allSlots = [...(available || []), ...(booked || [])].sort((a, b) => {
    const parse = s => {
      const [time, meridiem] = s.split(" ");
      let [h, m] = time.split(":").map(Number);
      if (meridiem === "PM" && h !== 12) h += 12;
      if (meridiem === "AM" && h === 12) h = 0;
      return h * 60 + m;
    };
    return parse(a) - parse(b);
  });

  if (allSlots.length === 0) {
    return (
      <div style={{
        padding: "1.5rem", border: `1px solid ${T.border}`, background: T.bgAlt,
        textAlign: "center", fontSize: "0.75rem", color: T.textMuted,
      }}>
        No slots available for this date
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {allSlots.map(slot => {
        const isBooked = (booked || []).includes(slot);
        const isSelected = selected === slot;
        return (
          <button
            key={slot}
            className={`pp-slot-btn${isSelected ? " pp-slot-selected" : ""}`}
            disabled={isBooked}
            onClick={() => !isBooked && onSelect(slot)}
            title={isBooked ? "Already booked" : slot}
          >
            {slot}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   DOCTOR PICKER
───────────────────────────────────────── */
function DoctorPicker({ doctors, selected, onSelect, loading }) {
  const [search, setSearch] = useState("");
  const [specFilter, setSpecFilter] = useState("");

  const specialities = [...new Set((doctors || []).map(d => d.speciality).filter(Boolean))];

  const filtered = (doctors || []).filter(d => {
    const matchSearch = !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.speciality || "").toLowerCase().includes(search.toLowerCase());
    const matchSpec = !specFilter || d.speciality === specFilter;
    return matchSearch && matchSpec;
  });

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="pp-shimmer" style={{ height: 60 }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* filters */}
      <div style={{ display: "flex", gap: "0.625rem", marginBottom: "0.75rem" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "8px", flex: 1,
          border: `1px solid ${T.border}`, background: T.bgAlt, padding: "0 0.875rem",
        }}>
          <Search size={12} color={T.textMuted} strokeWidth={1.5} />
          <input
            type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search doctor or speciality…"
            style={{
              border: "none", background: "none", outline: "none",
              flex: 1, fontSize: "0.75rem", fontWeight: 300, color: T.text,
              padding: "0.5rem 0", fontFamily: T.font,
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, display: "flex" }}>
              <X size={11} />
            </button>
          )}
        </div>
        {specialities.length > 1 && (
          <select className="pp-input" value={specFilter} onChange={e => setSpecFilter(e.target.value)}
            style={{ width: "auto", minWidth: 140 }}>
            <option value="">All specialities</option>
            {specialities.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", maxHeight: 260, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "1.5rem", textAlign: "center", fontSize: "0.75rem", color: T.textMuted, border: `1px solid ${T.border}` }}>
            No doctors found
          </div>
        ) : filtered.map(doc => {
          const isSelected = selected?.sys_user_id === doc.sys_user_id;
          return (
            <div
              key={doc.sys_user_id}
              className={`pp-doctor-card${isSelected ? " pp-doctor-selected" : ""}`}
              onClick={() => onSelect(isSelected ? null : doc)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Avatar name={doc.name} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>{doc.name}</div>
                  <div style={{ fontSize: "0.68rem", color: T.textMuted, marginTop: "2px" }}>{doc.speciality || "General"}</div>
                </div>
                {isSelected && <Check size={14} color={T.text} strokeWidth={2} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN PAGE - extracts patient_id from URL query parameter
   URL format: /patient-portal-appointments?patient_id=PAT-6a056b7e7a812891660f81bf
───────────────────────────────────────── */
export default function PatientPortalAppointments() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Extract patient_id from URL query parameter (after ?)
  const queryParams = new URLSearchParams(location.search);
  const patientId = queryParams.get("patient_id");
  const hospitalId = queryParams.get("hospital_id") || "HSP-f2e6baa3-26ee-4c2e-97da-65a54296125e";

  /* ── state ── */
  const [patientName,   setPatientName]   = useState("");
  const [doctors,       setDoctors]       = useState([]);
  const [doctorsLoading,setDoctorsLoading]= useState(false);
  const [selectedDoctor,setSelectedDoctor]= useState(null);
  const [date,          setDate]          = useState("");
  const [slots,         setSlots]         = useState(null);
  const [slotsLoading,  setSlotsLoading]  = useState(false);
  const [selectedSlot,  setSelectedSlot]  = useState("");
  const [complaint,     setComplaint]     = useState("");
  const [visitType,     setVisitType]     = useState("OP");
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState({ message: "", type: "" });

  /* ── step tracking ── */
  const step = !selectedDoctor ? 1 : !date ? 2 : !selectedSlot ? 3 : 4;

  /* inject CSS */
  useEffect(() => {
    const id = "pp-appt-css";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id; el.textContent = GLOBAL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  // Validate patient_id on page load
  useEffect(() => {
    if (!patientId) {
      setToast({ 
        message: "Missing patient_id in URL. Please use: ?patient_id=YOUR_PATIENT_ID", 
        type: "error" 
      });
    } else {
      // Fetch patient details using the patient_id from URL
      fetch(`${API_BASE_URL}hms/users/patient/${patientId}`)
        .then(r => r.json())
        .then(data => {
          if (data.name) setPatientName(data.name);
        })
        .catch(console.error);
    }
  }, [patientId]);

  /* load doctors */
  useEffect(() => {
    setDoctorsLoading(true);
    fetch(`${API_BASE_URL}hms/users/data/system//doctors_by_hospital/${hospitalId}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setDoctors(data); })
      .catch(console.error)
      .finally(() => setDoctorsLoading(false));
  }, [hospitalId]);

  /* load slots when doctor + date chosen */
  useEffect(() => {
    if (!selectedDoctor || !date) { setSlots(null); setSelectedSlot(""); return; }
    setSlotsLoading(true);
    setSlots(null);
    setSelectedSlot("");
    fetch(`${API_BASE_URL}hms/users/data/system/available-slots?doctor_id=${selectedDoctor.sys_user_id}&date=${date}`)
      .then(r => r.json())
      .then(data => setSlots(data))
      .catch(() => setToast({ message: "Could not load slots. Please try again.", type: "error" }))
      .finally(() => setSlotsLoading(false));
  }, [selectedDoctor, date]);

  /* save appointment - uses patientId from URL query parameter */
  const handleSave = async () => {
    if (!selectedDoctor) { setToast({ message: "Please select a doctor.", type: "error" }); return; }
    if (!date)           { setToast({ message: "Please select a date.", type: "error" }); return; }
    if (!selectedSlot)   { setToast({ message: "Please select a time slot.", type: "error" }); return; }
    if (!patientId)      { setToast({ message: "Patient ID missing from URL.", type: "error" }); return; }

    setSaving(true);
    const payload = {
      doctor_id:        selectedDoctor.sys_user_id,
      sys_user_id:      patientId,      // patient ID taken from URL query parameter
      date,
      scheduled_time:   selectedSlot,
      visit_type:       visitType,
      chief_complaint:  complaint,
    };

    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/doctors/take_appointment`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === "success") {
        setToast({ message: "Appointment booked successfully!", type: "success" });
        // Reset form after successful booking
        setSelectedSlot("");
        setDate("");
        setComplaint("");
        setSlots(null);
        setSelectedDoctor(null);
      } else {
        setToast({ message: data.message || "Failed to book appointment.", type: "error" });
      }
    } catch {
      setToast({ message: "Network error. Please try again.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  /* ── cell style helpers ── */
  const sectionCard = {
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "1.25rem 1.5rem",
    marginBottom: "1rem",
  };

  const stepLabel = (n, label) => (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      marginBottom: "1rem", paddingBottom: "0.875rem",
      borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{
        width: 22, height: 22,
        border: `1px solid ${step > n ? T.text : step === n ? T.borderStr : T.border}`,
        background: step > n ? T.text : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.6rem", fontWeight: 400,
        color: step > n ? T.bg : step === n ? T.text : T.textMuted,
        flexShrink: 0,
      }}>
        {step > n ? <Check size={11} strokeWidth={2.5} /> : n}
      </div>
      <span style={{ fontSize: "0.75rem", fontWeight: step === n ? 400 : 300, color: step === n ? T.text : T.textMuted }}>
        {label}
      </span>
    </div>
  );

  // Show loading or error if no patient ID
  if (!patientId) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: T.bg, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "2rem", border: `1px solid ${T.border}` }}>
          <AlertCircle size={32} color={T.textMuted} />
          <h2 style={{ marginTop: "1rem", fontSize: "1rem", fontWeight: 400 }}>Missing Patient ID</h2>
          <p style={{ color: T.textMuted, fontSize: "0.75rem", marginTop: "0.5rem" }}>
            Please use the correct format:<br />
            /patient-portal-appointments?patient_id=YOUR_PATIENT_ID
          </p>
          <p style={{ color: T.textMuted, fontSize: "0.7rem", marginTop: "1rem" }}>
            Example: /patient-portal-appointments?patient_id=PAT-6a056b7e7a812891660f81bf
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
            <span style={{ fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text }}>Doctorassist.AI</span>
          </div>
          <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.18em", color: T.textMuted, display: "block", marginBottom: "0.2rem" }}>Patient</span>
          <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: 0 }}>{patientName || "Loading..."}</p>
          {patientId && <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "2px 0 0", wordBreak: "break-all" }}>ID: {patientId}</p>}
        </div>

        {/* nav */}
        <nav style={{ flex: 1, padding: "0.75rem 0" }}>
          <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, padding: "0.5rem 1.25rem", display: "block" }}>Navigation</span>
          {[
            { icon: <Home size={14} strokeWidth={1.5} />,         label: "Dashboard",    active: false },
            { icon: <Calendar size={14} strokeWidth={1.5} />,     label: "Book Appointment", active: true },
            { icon: <FileText size={14} strokeWidth={1.5} />,     label: "My Appointments",  active: false },
            { icon: <Activity size={14} strokeWidth={1.5} />,     label: "Health Records",   active: false },
          ].map(item => (
            <button key={item.label} className={`pp-nav-btn${item.active ? " pp-active-nav" : ""}`}
              style={{
                width: "100%", background: "transparent", border: "none",
                textAlign: "left", padding: "0.55rem 1.25rem",
                fontSize: "0.78rem", fontWeight: item.active ? 400 : 300,
                color: item.active ? T.text : T.textSec,
                cursor: "pointer", display: "flex", alignItems: "center", gap: "10px",
                fontFamily: T.font, transition: "all 0.15s",
                borderLeft: item.active ? `2px solid ${T.borderStr}` : "2px solid transparent",
              }}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>

        {/* logout */}
        <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}` }}>
          <button className="pp-outline-hover" onClick={() => navigate("/login")}
            style={{
              width: "100%", background: T.bg, border: `1px solid ${T.border}`,
              padding: "0.6rem 1rem", fontSize: "0.75rem", fontWeight: 400,
              color: T.textSec, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontFamily: T.font, transition: "all 0.2s",
            }}>
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ══════════ MAIN CONTENT - FULL SCREEN DOCTOR SELECTION ══════════ */}
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
              Book an Appointment
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.72rem", color: T.textMuted }}>
              {doctors.length > 0 ? `${doctors.length} doctor${doctors.length !== 1 ? "s" : ""} available` : ""}
            </span>
            <button className="pp-outline-hover" style={{
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

        {/* body - full width doctor selection, centered with max width */}
        <div style={{ padding: "2rem", flex: 1, maxWidth: "1200px", margin: "0 auto", width: "100%" }}>

          {/* ── STEP 1: Doctor selection (full prominence) ── */}
          <div style={{ ...sectionCard, marginBottom: "1.5rem" }}>
            {stepLabel(1, "Select your preferred doctor")}
            <DoctorPicker
              doctors={doctors}
              selected={selectedDoctor}
              onSelect={doc => {
                setSelectedDoctor(doc);
                setDate("");
                setSlots(null);
                setSelectedSlot("");
              }}
              loading={doctorsLoading}
            />
          </div>

          {/* ── STEP 2: Date + Visit type ── */}
          <div style={{ ...sectionCard, opacity: !selectedDoctor ? 0.45 : 1, pointerEvents: !selectedDoctor ? "none" : "auto", marginBottom: "1.5rem" }}>
            {stepLabel(2, "Choose a date & visit type")}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
              <div>
                <Label>Appointment Date *</Label>
                <input type="date" className="pp-input"
                  min={todayISO()}
                  value={date}
                  onChange={e => setDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Visit Type</Label>
                <select className="pp-input" value={visitType} onChange={e => setVisitType(e.target.value)}>
                  <option value="OP">OP — Outpatient</option>
                  <option value="followup_visit">Follow-up Visit</option>
                  <option value="Emergency">Emergency</option>
                </select>
              </div>
            </div>

            {/* doctor summary when selected + date chosen */}
            {selectedDoctor && date && (
              <div className="pp-slide-in" style={{
                marginTop: "1rem", padding: "0.75rem 1rem",
                background: T.bgAlt, border: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: "10px",
              }}>
                <Avatar name={selectedDoctor.name} size={28} />
                <div>
                  <span style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text }}>{selectedDoctor.name}</span>
                  <span style={{ fontSize: "0.68rem", color: T.textMuted, marginLeft: "8px" }}>{selectedDoctor.speciality}</span>
                </div>
                <ChevronRight size={12} color={T.textMuted} style={{ marginLeft: "auto" }} />
                <span style={{ fontSize: "0.72rem", color: T.textMuted }}>
                  {new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
            )}
          </div>

          {/* ── STEP 3: Time slots ── */}
          <div style={{ ...sectionCard, opacity: !(selectedDoctor && date) ? 0.45 : 1, pointerEvents: !(selectedDoctor && date) ? "none" : "auto", marginBottom: "1.5rem" }}>
            {stepLabel(3, "Pick a time slot")}

            {selectedDoctor && date ? (
              <>
                {slots && (
                  <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "0.875rem", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: 10, height: 10, border: `1px solid ${T.border}`, background: T.bg }} />
                      <span style={{ fontSize: "0.65rem", color: T.textMuted }}>Available</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: 10, height: 10, border: `1px solid ${T.border}`, background: T.bgTert, opacity: 0.6 }} />
                      <span style={{ fontSize: "0.65rem", color: T.textMuted }}>Booked</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: 10, height: 10, background: T.text }} />
                      <span style={{ fontSize: "0.65rem", color: T.textMuted }}>Selected</span>
                    </div>
                    {slots.timings && (
                      <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: T.textMuted }}>
                        <Clock size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        {slots.timings.start_time} – {slots.timings.end_time} · {slots.timings.slot_duration}min slots
                      </span>
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

                {selectedSlot && (
                  <div className="pp-slide-in" style={{
                    marginTop: "0.875rem", padding: "0.6rem 1rem",
                    background: T.bgAlt, border: `1px solid ${T.border}`,
                    fontSize: "0.75rem", color: T.text,
                    display: "flex", alignItems: "center", gap: "8px",
                  }}>
                    <Clock size={12} color={T.textMuted} />
                    Selected: <strong style={{ fontWeight: 400 }}>{selectedSlot}</strong>
                    <button onClick={() => setSelectedSlot("")}
                      style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.textMuted, display: "flex" }}>
                      <X size={11} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "1.25rem", textAlign: "center", fontSize: "0.75rem", color: T.textMuted, background: T.bgAlt, border: `1px dashed ${T.border}` }}>
                Select a doctor and date to see available time slots
              </div>
            )}
          </div>

          {/* ── STEP 4: Chief complaint + confirm ── */}
          <div style={{ ...sectionCard, opacity: !selectedSlot ? 0.45 : 1, pointerEvents: !selectedSlot ? "none" : "auto", marginBottom: "1.5rem" }}>
            {stepLabel(4, "Describe your concern & confirm")}

            <div style={{ marginBottom: "1rem" }}>
              <Label>Chief Complaint</Label>
              <textarea className="pp-input" rows={3} value={complaint}
                onChange={e => setComplaint(e.target.value)}
                placeholder="Describe your chief complaint or reason for visit…" />
            </div>

            {/* summary strip */}
            {selectedSlot && selectedDoctor && date && (
              <div className="pp-slide-in" style={{
                marginBottom: "1rem", padding: "0.875rem 1rem",
                background: T.bgAlt, border: `1px solid ${T.border}`,
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem",
              }}>
                {[
                  { label: "Doctor",    value: selectedDoctor.name },
                  { label: "Date",      value: new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
                  { label: "Time",      value: selectedSlot },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "0.2rem" }}>{label}</div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text }}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end" }}>
              <button
                className="pp-outline-hover"
                onClick={() => { setSelectedSlot(""); setComplaint(""); }}
                style={{
                  padding: "0.5rem 1rem", border: `1px solid ${T.border}`,
                  background: T.bg, color: T.textSec, cursor: "pointer",
                  fontSize: "0.72rem", fontWeight: 300,
                  display: "flex", alignItems: "center", gap: "5px",
                  transition: "all 0.15s",
                }}>
                <X size={12} /> Clear
              </button>
              <button
                className="pp-save-btn"
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "0.5rem 1.5rem",
                  border: `1px solid ${T.borderStr}`,
                  background: saving ? T.bgAlt : T.text,
                  color: saving ? T.textMuted : T.bg,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontSize: "0.72rem", fontWeight: 400,
                  display: "flex", alignItems: "center", gap: "5px",
                  transition: "all 0.15s",
                }}>
                {saving
                  ? <span style={{ animation: "pp-pulse 1.2s infinite", display: "inline-flex", alignItems: "center", gap: "5px" }}><Save size={12} /> Booking…</span>
                  : <><Save size={12} /> Confirm Appointment</>
                }
              </button>
            </div>
          </div>

        </div>
      </div>

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "" })} />
    </div>
  );
}