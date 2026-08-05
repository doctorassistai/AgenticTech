import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search, Calendar, Save, Bell, Stethoscope,
  Home, Bed, Activity, LogOut, X, Check,
  AlertCircle, SlidersHorizontal, User, Plus,
} from "lucide-react";

/* ─────────────────────────────────────────
   THEME TOKENS
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

  @keyframes da-slideDown {
    from { opacity: 0; transform: translateY(-5px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes da-fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes da-pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes da-spin   { to { transform: rotate(360deg); } }

  .da-nav-btn { transition: background 0.15s, color 0.15s; }
  .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
  .da-nav-btn.active-nav { background: ${T.bgAlt} !important; color: ${T.text} !important; border-left-color: ${T.borderStr} !important; }

  .da-tbl-row { transition: background 0.12s; cursor: pointer; }
  .da-tbl-row:hover td { background: ${T.bgAlt} !important; }
  .da-tbl-row.da-selected td { background: ${T.bgAlt} !important; }

  .da-save-btn:hover { background: transparent !important; color: ${T.text} !important; }
  .da-outline-hover:hover { border-color: ${T.borderStr} !important; color: ${T.text} !important; }

  .da-input {
    width: 100%; height: 40px; padding: 0 0.875rem;
    border: 1px solid ${T.border}; background: ${T.bg};
    font-family: ${T.font}; font-weight: 300;
    font-size: 0.78rem; color: ${T.text};
    outline: none; border-radius: 0; appearance: none;
    transition: border-color 0.15s;
  }
  .da-input::placeholder { color: #bbbbbb; }
  .da-input:focus { border-color: ${T.borderStr}; }
  .da-input:hover { border-color: #c0c0c0; }
  textarea.da-input { height: auto; padding: 0.6rem 0.875rem; resize: vertical; }
  select.da-input {
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 1.75rem;
  }

  .da-slide-in { animation: da-slideDown 0.2s ease; }
`;

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */
const API_BASE_URL = typeof import.meta !== "undefined" && import.meta.env
  ? (import.meta.env.VITE_BACKEND_URL || "") : "";
const API = `${API_BASE_URL}hms/users/doctors`;

function to12h(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`;
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function initials(name) {
  return (name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

/* ─────────────────────────────────────────
   AVATAR  (initials square, not circle)
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
   BADGE  (flat, no rounded corners)
───────────────────────────────────────── */
function Badge({ type }) {
  return (
    <span style={{
      padding: "0.18rem 0.5rem",
      border: `1px solid ${T.border}`,
      fontSize: "0.6rem", fontWeight: 400,
      textTransform: "uppercase", letterSpacing: "0.1em",
      color: T.textMuted, whiteSpace: "nowrap",
    }}>
      {type || "OP"}
    </span>
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
      animation: "da-slideDown 0.2s ease",
      maxWidth: 360,
    }}>
      {isErr
        ? <AlertCircle size={13} color={T.textMuted} />
        : <Check size={13} color={T.text} />
      }
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
        <X size={12} />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────
   INLINE FORM  (expands below the row)
───────────────────────────────────────── */
function InlineForm({ patient, onSave, onCancel }) {
  const [date,      setDate]      = useState("");
  const [time,      setTime]      = useState("");
  const [visitType, setVisitType] = useState("OP");
  const [admType,   setAdmType]   = useState("");
  const [admDetail, setAdmDetail] = useState("");
  const [complaint, setComplaint] = useState("");

  const admPlaceholder = {
    ICU:  "ICU type (e.g., Medical ICU)",
    Ward: "Ward number (e.g., Ward A)",
    Room: "Room number (e.g., 101)",
  }[admType] || "";

  return (
    <tr className="da-slide-in">
      <td colSpan={7} style={{
        padding: 0,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{
          background: T.bgAlt,
          borderLeft: `2px solid ${T.borderStr}`,
          padding: "1.25rem 1.5rem 1.25rem 3.5rem",
        }}>

          {/* patient strip */}
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            marginBottom: "1rem", paddingBottom: "0.875rem",
            borderBottom: `1px solid ${T.border}`,
          }}>
            <Avatar name={patient.name} size={28} />
            <div>
              <span style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>{patient.name}</span>
              <span style={{ fontSize: "0.7rem", color: T.textMuted, marginLeft: "8px" }}>{patient.hms_id}</span>
            </div>
          </div>

          {/* row 1 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.875rem", marginBottom: "0.875rem" }}>
            <div>
              <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Date *</label>
              <input type="date" className="da-input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Time</label>
              <input type="time" className="da-input" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Visit Type</label>
              <select className="da-input" value={visitType}
                onChange={e => { setVisitType(e.target.value); if (e.target.value !== "IP") { setAdmType(""); setAdmDetail(""); } }}>
                <option value="OP">OP — Outpatient</option>
                <option value="IP">IP — Inpatient</option>
                   <option value="followup_visit">Follow-up Visit</option>
                <option value="Emergency">Emergency</option>
              </select>
            </div>
          </div>

          {/* IP fields */}
          {visitType === "IP" && (
            <div className="da-slide-in" style={{ display: "grid", gridTemplateColumns: admType ? "1fr 1.5fr" : "1fr", gap: "0.875rem", marginBottom: "0.875rem" }}>
              <div>
                <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Admission Type *</label>
                <select className="da-input" value={admType} onChange={e => { setAdmType(e.target.value); setAdmDetail(""); }}>
                  <option value="">Select admission type</option>
                  <option value="ICU">ICU</option>
                  <option value="Ward">Ward</option>
                  <option value="Room">Room</option>
                </select>
              </div>
              {admType && (
                <div className="da-slide-in">
                  <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>
                    {admType === "ICU" ? "ICU Type" : admType === "Room" ? "Room Number" : "Ward Number"} *
                  </label>
                  <input type="text" className="da-input" value={admDetail}
                    onChange={e => setAdmDetail(e.target.value)} placeholder={admPlaceholder} />
                </div>
              )}
            </div>
          )}

          {/* complaint */}
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", display: "block", marginBottom: "0.3rem" }}>Chief Complaint</label>
            <textarea className="da-input" rows={2} value={complaint}
              onChange={e => setComplaint(e.target.value)}
              placeholder="Describe the patient's chief complaint…" />
          </div>

          {/* actions */}
          <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end" }}>
            <button className="da-outline-hover" onClick={onCancel} style={{
              padding: "0.5rem 1rem", border: `1px solid ${T.border}`,
              background: T.bg, color: T.textSec, cursor: "pointer",
              fontSize: "0.72rem", fontWeight: 300,
              display: "flex", alignItems: "center", gap: "5px",
              transition: "all 0.15s",
            }}>
              <X size={12} /> Cancel
            </button>
            <button className="da-save-btn" onClick={() => onSave({ date, time, visitType, admType, admDetail, complaint })}
              style={{
                padding: "0.5rem 1.25rem", border: `1px solid ${T.borderStr}`,
                background: T.text, color: T.bg, cursor: "pointer",
                fontSize: "0.72rem", fontWeight: 400,
                display: "flex", alignItems: "center", gap: "5px",
                transition: "all 0.15s",
              }}>
              <Save size={12} /> Save Appointment
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
export default function Appointments() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const query     = new URLSearchParams(location.search);
  const doctorId  = query.get("doctor_id");

  const [doctorName,   setDoctorName]   = useState("");
  const [doctorSpec,   setDoctorSpec]   = useState("");
  const [allPatients,  setAllPatients]  = useState([]);
  const [patients,     setPatients]     = useState([]);
  const [term,         setTerm]         = useState("");
  const [sortBy,       setSortBy]       = useState("recent");
  const [selectedId,   setSelectedId]   = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState({ message: "", type: "" });
  const [lastVisitMap, setLastVisitMap] = useState({});

  /* fetch last appointment for a list of patients */
    const fetchLastVisits = async (patientList) => {
        if (!doctorId || !patientList.length) return;
        const results = await Promise.allSettled(
            patientList.map(p =>
                fetch(`${API_BASE_URL}hms/users/data/context/get-patient-last-appointment?patient_id=${p.sys_user_id}&doctor_id=${doctorId}`)
                    .then(r => r.json())
                    .then(d => ({ sys_user_id: p.sys_user_id, appt: d.last_appointment }))
            )
        );
        const map = {};
        results.forEach(r => {
            if (r.status === "fulfilled" && r.value?.appt) {
                map[r.value.sys_user_id] = r.value.appt;
            }
        });
        setLastVisitMap(prev => ({ ...prev, ...map }));
    };

  /* inject global CSS once */
  useEffect(() => {
    const id = "da-appt-css";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id; el.textContent = GLOBAL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  /* auth verify */
  useEffect(() => {
    const verify = async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}hms/users/doctors/verify`, { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!doctorId || doctorId !== data.doctor.sys_user_id) navigate("/login");
      } catch { navigate("/login"); }
    };
    verify();
  }, [doctorId, navigate]);

  /* doctor details */
  useEffect(() => {
    if (!doctorId) return;
    fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor_id: doctorId }),
    })
      .then(r => r.json())
      .then(d => { if (d.status === "success") { setDoctorName(d.doctor_name); setDoctorSpec(d.doctor_speciality); } })
      .catch(console.error);
  }, [doctorId]);

  /* load patients */
  useEffect(() => {
    if (!doctorId) return;
    fetch(`${API_BASE_URL}hms/users/patients/get_all_patients?doctor_id=${doctorId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
                if (d.status === "success") {
                    setAllPatients(d.patients);
                    setPatients(d.patients);
                    fetchLastVisits(d.patients);
                }
            })
      .catch(console.error);
  }, [doctorId]);

  /* search */
  const handleSearch = async (value) => {
    setTerm(value);
    if (value.length < 2) { setPatients(allPatients); return; }
    try {
      setLoading(true);
      const res  = await fetch(`${API}/search?term=${value}&doctor_id=${doctorId}`);
      const data = await res.json();
      if (data.status === "success") {
          setPatients(data.patients);
          fetchLastVisits(data.patients);
      }
    } catch { setPatients(allPatients); }
    finally   { setLoading(false); }
  };

  /* sort */
  const sorted = [...patients].sort((a, b) => {
    if (sortBy === "name_asc")  return a.name.localeCompare(b.name);
    if (sortBy === "name_desc") return b.name.localeCompare(a.name);
    if (sortBy === "hms")       return a.hms_id.localeCompare(b.hms_id);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  /* save appointment */
  const handleSave = async (patient, { date, time, visitType, admType, admDetail, complaint }) => {
    if (!date) { setToast({ message: "Please select a date.", type: "error" }); return; }
    if (visitType === "IP") {
      if (!admType)   { setToast({ message: "Please select an admission type for IP.", type: "error" }); return; }
      if (!admDetail) { setToast({ message: `Please enter ${admType === "ICU" ? "ICU type" : admType === "Room" ? "room number" : "ward number"}.`, type: "error" }); return; }
    }

    const payload = {
      doctor_id: doctorId, sys_user_id: patient.sys_user_id,
      date, scheduled_time: to12h(time),
      visit_type: visitType, chief_complaint: complaint,
      ...(visitType === "IP" && {
        admission_type: admType,
        ...(admType === "ICU"  && { icu_type:     admDetail }),
        ...(admType === "Ward" && { ward_number:  admDetail }),
        ...(admType === "Room" && { room_number:  admDetail }),
      }),
    };

    try {
      const res  = await fetch(`${API}/take_appointment`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === "success") {
        setToast({ message: `Appointment saved for ${patient.name}.`, type: "success" });
        setSelectedId(null);
      } else {
        setToast({ message: data.message || "Failed to save appointment.", type: "error" });
      }
    } catch {
      setToast({ message: "Network error. Please try again.", type: "error" });
    }
  };

  /* ── table cell styles ── */
  const TH = {
    padding: "0.625rem 1rem",
    fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.12em",
    color: T.textMuted, borderBottom: `1px solid ${T.border}`,
    textAlign: "left", whiteSpace: "nowrap",
    background: T.bgAlt,
  };
  const TD = {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem", fontWeight: 300,
    color: T.textSec, borderBottom: `1px solid ${T.border}`,
    verticalAlign: "middle",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, fontFamily: T.font, fontWeight: 300 }}>

      {/* ══════════ SIDEBAR ══════════ */}
      <aside style={{
        width: 240, minHeight: "100vh", flexShrink: 0,
        background: T.bg, borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
      }}>
        {/* brand */}
        <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" }}>
           
            <span style={{ fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text }}>Doctorassist.AI</span>
          </div>
          <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.18em", color: T.textMuted, display: "block", marginBottom: "0.2rem" }}>Physician</span>
          <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: 0 }}>{doctorName || "Loading…"}</p>
          <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "2px 0 0" }}>{doctorSpec || "—"}</p>
        </div>

        {/* nav */}
        <nav style={{ flex: 1, padding: "0.75rem 0" }}>
          <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, padding: "0.5rem 1.25rem", display: "block" }}>Navigation</span>
          {[
            { icon: <Home size={14} strokeWidth={1.5} />,     label: "Dashboard",    active: false, onClick: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`) },
            { icon: <Calendar size={14} strokeWidth={1.5} />, label: "Appointments", active: true  },
            { icon: <Bed size={14} strokeWidth={1.5} />,      label: "IPD / Ward",   active: false },
            { icon: <Activity size={14} strokeWidth={1.5} />, label: "Referrals",    active: false },
          ].map(item => (
            <button key={item.label} className={`da-nav-btn${item.active ? " active-nav" : ""}`}
              onClick={item.onClick}
              style={{
                width: "100%", background: "transparent", border: "none",
                textAlign: "left", padding: "0.55rem 1.25rem",
                fontSize: "0.78rem", fontWeight: item.active ? 400 : 300,
                color: item.active ? T.text : T.textSec,
                cursor: "pointer", display: "flex", alignItems: "center", gap: "10px",
                fontFamily: T.font, transition: "all 0.15s",
                borderLeft: item.active ? `2px solid ${T.borderStr}` : "2px solid transparent",
              }}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* logout */}
        <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}` }}>
          <button className="da-outline-hover" onClick={() => navigate("/login")}
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

      {/* ══════════ MAIN ══════════ */}
      <div style={{ flex: 1, marginLeft: 240, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* top bar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 50,
          background: T.bg, borderBottom: `1px solid ${T.border}`,
          padding: "0.875rem 2rem",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: T.textMuted, display: "block", marginBottom: "0.15rem" }}>Appointment Management</span>
            <h1 style={{ fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>
              Schedule Appointment
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.72rem", color: T.textMuted }}>
              {loading
                ? <span style={{ animation: "da-pulse 1.2s infinite", display: "inline-block" }}>Searching…</span>
                : `${sorted.length} patient${sorted.length !== 1 ? "s" : ""}${term.length >= 2 ? ` matching "${term}"` : ""}`
              }
            </span>
            <button className="da-outline-hover" style={{
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

        {/* body */}
        <div style={{ padding: "1.5rem 2rem", flex: 1, display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* toolbar */}
          <div style={{
            background: T.bg, border: `1px solid ${T.border}`,
            padding: "0.75rem 1rem",
            display: "flex", alignItems: "center", gap: "0.75rem",
          }}>
            {/* search */}
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              flex: 1, border: `1px solid ${T.border}`, background: T.bgAlt,
              padding: "0 0.875rem",
            }}>
              <Search size={13} color={T.textMuted} strokeWidth={1.5} style={{ flexShrink: 0 }} />
              <input
                type="text" value={term}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search by HMS ID, name, or phone number…"
                style={{
                  border: "none", background: "none", outline: "none",
                  flex: 1, fontSize: "0.78rem", fontWeight: 300, color: T.text,
                  padding: "0.55rem 0", fontFamily: T.font,
                }}
              />
              {term && (
                <button onClick={() => { setTerm(""); setPatients(allPatients); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, display: "flex", padding: "2px" }}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* sort */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <SlidersHorizontal size={12} color={T.textMuted} strokeWidth={1.5} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{
                  border: `1px solid ${T.border}`, background: T.bgAlt,
                  padding: "0.5rem 2rem 0.5rem 0.75rem",
                  fontSize: "0.75rem", fontWeight: 300, color: T.text,
                  outline: "none", cursor: "pointer", appearance: "none",
                  fontFamily: T.font,
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
                }}>
                <option value="recent">Newest first</option>
                <option value="name_asc">Name (A–Z)</option>
                <option value="name_desc">Name (Z–A)</option>
                <option value="hms">HMS ID</option>
              </select>
            </div>
          </div>

          {/* table */}
          <div style={{ border: `1px solid ${T.border}`, background: T.bg, flex: 1 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "12%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={TH}></th>
                    <th style={TH}>Patient</th>
                    <th style={TH}>Phone</th>
                    <th style={TH}>HMS ID</th>
                    <th style={TH}>Last Visit</th>
                    <th style={TH}>Type</th>
                    <th style={TH}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: "3.5rem 1.25rem", textAlign: "center" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                          <div style={{ width: 44, height: 44, border: `1px solid ${T.border}`, background: T.bgAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <User size={18} color={T.textMuted} strokeWidth={1.5} />
                          </div>
                          <span style={{ fontSize: "0.78rem", color: T.textMuted, fontWeight: 300 }}>
                            {term.length >= 2 ? `No patients matching "${term}"` : "No patients registered yet"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : sorted.map(patient => {
                    const isSelected = selectedId === patient.sys_user_id;
                    return (
                      <React.Fragment key={patient.sys_user_id}>
                        <tr
                          className={`da-tbl-row${isSelected ? " da-selected" : ""}`}
                          onClick={() => setSelectedId(isSelected ? null : patient.sys_user_id)}
                          style={{ borderLeft: isSelected ? `2px solid ${T.borderStr}` : "2px solid transparent" }}
                        >
                          <td style={{ ...TD, paddingLeft: isSelected ? "calc(1rem - 1px)" : "1rem", textAlign: "center" }}>
                            <Avatar name={patient.name} size={28} />
                          </td>
                          <td style={TD}>
                            <div style={{ fontWeight: 400, fontSize: "0.82rem", color: T.text }}>{patient.name}</div>
                            <div style={{ fontSize: "0.68rem", color: T.textMuted, marginTop: "2px" }}>{patient.hms_id}</div>
                          </td>
                          <td style={{ ...TD, color: T.textMuted }}>{patient.phone_number}</td>
                          <td style={{ ...TD, fontFamily: "monospace", fontSize: "0.72rem", color: T.textMuted }}>{patient.hms_id}</td>
                          <td style={{ ...TD, color: T.textMuted }}>{fmtDate(lastVisitMap[patient.sys_user_id]?.date || patient.created_at)}</td>
                          <td style={TD}><Badge type={lastVisitMap[patient.sys_user_id]?.visit_type || "OP"} /></td>
                          <td style={TD}>
                            <button
                              className="da-outline-hover"
                              onClick={e => { e.stopPropagation(); setSelectedId(isSelected ? null : patient.sys_user_id); }}
                              style={{
                                padding: "0.3rem 0.75rem",
                                border: `1px solid ${isSelected ? T.borderStr : T.border}`,
                                background: isSelected ? T.text : T.bg,
                                color: isSelected ? T.bg : T.textSec,
                                fontSize: "0.65rem", fontWeight: isSelected ? 400 : 300,
                                cursor: "pointer", transition: "all 0.15s",
                                display: "inline-flex", alignItems: "center", gap: "4px",
                                textTransform: "uppercase", letterSpacing: "0.06em",
                              }}>
                              {isSelected ? <X size={11} /> : <Plus size={11} />}
                              {isSelected ? "Cancel" : "Schedule"}
                            </button>
                          </td>
                        </tr>

                        {isSelected && (
                          <InlineForm
                            patient={patient}
                            onSave={fd => handleSave(patient, fd)}
                            onCancel={() => setSelectedId(null)}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* footer note */}
          <p style={{ fontSize: "0.65rem", color: T.textMuted, textAlign: "center", letterSpacing: "0.05em" }}>
            Click any row or "Schedule" to open the booking form inline
          </p>

        </div>
      </div>

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "" })} />
    </div>
  );
}