import React, { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/lodo_only.png";
import {
  Home, Settings, Bed, MessageCircle, Calendar,
  Activity, LogOut, Search, UserPlus, FileText,
  ArrowLeft, Phone, Hash, Clock, ChevronDown, ChevronUp, Stethoscope, Users,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

import AppointmentDashboard from "./AppointmentDashboard";
import DateWiseAppointmentDashboard from "./DateWiseAppointmentDashboard";

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

const SIDEBAR_W = "240px";

/* ─────────────────────────────────────────
   GLOBAL CSS
───────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::selection { background: #000; color: #fff; }
  body, html { font-family: ${T.font}; font-weight: 300; background: ${T.bg}; color: ${T.text}; -webkit-font-smoothing: antialiased; }

  .da-nav-btn { transition: background 0.15s, color 0.15s; }
  .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
  .da-nav-btn.da-active { background: ${T.bgAlt}; color: ${T.text}; font-weight: 400 !important; border-left-color: ${T.borderStr} !important; }

  .da-tbl-row:hover td { background: ${T.bgAlt} !important; }
  .da-th-sort:hover { color: ${T.text} !important; cursor: pointer; }

  .da-btn-primary:hover { background: transparent !important; color: ${T.text} !important; }
  .da-btn-outline:hover { border-color: ${T.borderStr} !important; color: ${T.text} !important; }

  .da-visit-row:hover { background: ${T.bgAlt} !important; }

  .da-sidebar-scroll::-webkit-scrollbar { display: none; }
  .da-sidebar-scroll { -ms-overflow-style: none; scrollbar-width: none; }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: ${T.bgAlt}; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; }
`;

/* ─────────────────────────────────────────
   SHARED STYLE OBJECTS
───────────────────────────────────────── */
const S = {
  /* table */
  th: {
    padding: "0.625rem 1rem",
    fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.12em",
    color: T.textMuted, borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt, textAlign: "left", whiteSpace: "nowrap",
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem", fontWeight: 300,
    color: T.textSec, borderBottom: `1px solid ${T.border}`,
    verticalAlign: "middle",
  },
  /* badge */
  badge: {
    padding: "0.18rem 0.5rem",
    border: `1px solid ${T.border}`,
    fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.08em",
    color: T.textMuted, display: "inline-block",
  },
  /* buttons */
  btnPrimary: {
    padding: "0.4rem 0.875rem",
    background: T.text, color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.68rem", fontWeight: 400,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "5px",
    letterSpacing: "0.04em",
  },
  btnOutline: {
    padding: "0.5rem 1rem",
    background: T.bg, color: T.textSec,
    border: `1px solid ${T.border}`,
    fontSize: "0.75rem", fontWeight: 300,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "6px",
  },
  /* section label */
  secLabel: {
    fontSize: "0.6rem", textTransform: "uppercase",
    letterSpacing: "0.18em", color: T.textMuted,
    fontWeight: 400, display: "block", marginBottom: "0.25rem",
  },
  /* info card cell */
  infoCell: {
    background: T.bgAlt, border: `1px solid ${T.border}`,
    padding: "1rem 1.25rem",
  },
  infoCellLabel: {
    fontSize: "0.58rem", textTransform: "uppercase",
    letterSpacing: "0.12em", color: T.textMuted,
    display: "block", marginBottom: "0.25rem",
  },
  infoCellValue: {
    fontSize: "0.9rem", fontWeight: 400, color: T.text,
  },
};

/* ─────────────────────────────────────────
   PATIENT LIST
───────────────────────────────────────── */
const PatientList = ({ doctorId, hospitalId, onViewProfile }) => {
  const [patients,   setPatients]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [activeView, setActiveView] = useState("patientListing");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "name", direction: "asc" });

  useEffect(() => {
    if (!doctorId || !hospitalId) return;
    const fetch_ = async () => {
      try {
        setLoading(true);
        const [pRes, aRes] = await Promise.all([
          fetch(`${API_BASE_URL}hms/users/patients/get_all_patients?doctor_id=${doctorId}`),
          fetch(`${API_BASE_URL}hms/users/patients/hospital/${hospitalId}/appointments`),
        ]);
        const [pData, aData] = await Promise.all([pRes.json(), aRes.json()]);
        if (pData.status !== "success") { setPatients([]); return; }

        const appointments = aData.appointments || [];
        const map = {};
        appointments.forEach(a => {
          const pid = String(a.patient_id);
          if (!map[pid]) map[pid] = [];
          map[pid].push({ date: a.date, doctor: a.doctor_name || "N/A", department: a.department || "General", type: a.visit_type || "Follow-up" });
        });

        setPatients(pData.patients.map(p => {
          const pid   = String(p.patient_id);
          const visits = (map[pid] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
          return { id: pid, name: p.name || "Unknown", registrationNumber: p.hms_id || "", phoneNumber: p.phone_number || "", visitCount: visits.length, lastVisitDate: visits[0]?.date || null, visits };
        }));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetch_();
  }, [doctorId, hospitalId]);

  const sorted = useMemo(() => {
    return [...patients].sort((a, b) => {
      let av = sortConfig.key === "visitCount" ? a.visitCount : sortConfig.key === "lastVisitDate" ? (a.lastVisitDate || "") : a.name;
      let bv = sortConfig.key === "visitCount" ? b.visitCount : sortConfig.key === "lastVisitDate" ? (b.lastVisitDate || "") : b.name;
      if (av < bv) return sortConfig.direction === "asc" ? -1 : 1;
      if (av > bv) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [patients, sortConfig]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return sorted;
    return sorted.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.registrationNumber || "").toLowerCase().includes(q) ||
      (p.phoneNumber || "").includes(searchTerm) ||
      (p.lastVisitDate || "").includes(q) ||
      String(p.visitCount) === q
    );
  }, [sorted, searchTerm]);

  const toggleSort = (key) => {
    setSortConfig(s => ({ key, direction: s.key === key && s.direction === "asc" ? "desc" : "asc" }));
  };
  const sortArrow = (key) => sortConfig.key === key ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : "";

  if (loading) return (
    <div style={{ padding: "3rem", textAlign: "center", fontSize: "0.78rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      Loading patients…
    </div>
  );

  return (
    <div>
      {/* search */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", border: `1px solid ${T.border}`, background: T.bgAlt, padding: "0 0.875rem", marginBottom: "1.25rem" }}>
        <Search size={13} color={T.textMuted} strokeWidth={1.5} style={{ flexShrink: 0 }} />
        <input
          type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name, registration number, or phone…"
          style={{ border: "none", background: "none", outline: "none", flex: 1, fontSize: "0.78rem", fontWeight: 300, color: T.text, padding: "0.65rem 0", fontFamily: T.font }}
        />
      </div>

      {/* table */}
      <div style={{ border: `1px solid ${T.border}`, background: T.bg, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
          <thead>
            <tr>
              {[
                { label: "Patient Name",  key: "name",          sortable: true  },
                { label: "Registration #", key: null,           sortable: false },
                { label: "Phone",          key: null,           sortable: false },
                { label: "Total Visits",  key: "visitCount",    sortable: true  },
                { label: "Last Visit",    key: "lastVisitDate", sortable: true  },
                { label: "",              key: null,            sortable: false },
              ].map((col, i) => (
                <th key={i}
                  className={col.sortable ? "da-th-sort" : ""}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  style={{ ...S.th, color: col.sortable ? T.textSec : T.textMuted }}>
                  {col.label}{col.sortable && sortArrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", fontSize: "0.78rem", color: T.textMuted }}>
                  No patients found{searchTerm ? ` matching "${searchTerm}"` : ""}.
                </td>
              </tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="da-tbl-row">
                <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{p.name}</td>
                <td style={S.td}>{p.registrationNumber}</td>
                <td style={S.td}>{p.phoneNumber}</td>
                <td style={S.td}>{p.visitCount}</td>
                <td style={S.td}>{p.lastVisitDate || "No visits"}</td>
                <td style={S.td}>
                  <button className="da-btn-primary" style={S.btnPrimary} onClick={() => onViewProfile(p)}>
                    View Profile →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   PATIENT PROFILE
───────────────────────────────────────── */
const PatientProfile = ({ patient, onBack }) => {
  const [showAll, setShowAll] = useState(false);

  const sortedVisits = [...patient.visits].sort((a, b) => new Date(b.date) - new Date(a.date));
  const visible      = showAll ? sortedVisits : sortedVisits.slice(0, 5);

  return (
    <div>
      {/* back */}
      <button className="da-btn-outline" style={{ ...S.btnOutline, marginBottom: "1.5rem" }} onClick={onBack}>
        <ArrowLeft size={13} /> Back to Patient List
      </button>

      {/* header */}
      <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: "1rem", marginBottom: "1.5rem" }}>
        <span style={S.secLabel}>Patient Profile</span>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 300, letterSpacing: "-0.02em", color: T.text, margin: 0 }}>
          {patient.name}
        </h2>
      </div>

      {/* info grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1px", background: T.border, marginBottom: "2rem" }}>
        {[
          { icon: <Hash size={13} />,      label: "Registration Number", val: patient.registrationNumber },
          { icon: <Phone size={13} />,     label: "Phone Number",        val: patient.phoneNumber       },
          { icon: <Calendar size={13} />,  label: "Total Visits",        val: patient.visits.length     },
          { icon: <Clock size={13} />,     label: "Last Visit",          val: patient.lastVisitDate || "No visits" },
        ].map(({ icon, label, val }) => (
          <div key={label} style={S.infoCell}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "0.4rem" }}>
              <span style={{ color: T.textMuted }}>{icon}</span>
              <span style={S.infoCellLabel}>{label}</span>
            </div>
            <span style={S.infoCellValue}>{val}</span>
          </div>
        ))}
      </div>

      {/* visit history */}
      <div>
        <div style={{ marginBottom: "1rem" }}>
          <span style={S.secLabel}>Visit History</span>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: 0 }}>
            {patient.visits.length} recorded visit{patient.visits.length !== 1 ? "s" : ""}
          </h3>
        </div>

        {/* table */}
        <div style={{ border: `1px solid ${T.border}`, background: T.bg, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr>
                {["Visit Date", "Consulting Doctor", "Speciality / Dept", "Visit Type"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center", fontSize: "0.78rem", color: T.textMuted }}>No visits recorded.</td></tr>
              ) : visible.map((v, i) => (
                <tr key={i} className="da-visit-row">
                  <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{v.date}</td>
                  <td style={S.td}>{v.doctor}</td>
                  <td style={S.td}>{v.department}</td>
                  <td style={S.td}><span style={S.badge}>{v.type}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedVisits.length > 5 && (
          <div style={{ paddingTop: "0.875rem", borderTop: `1px solid ${T.border}`, marginTop: "0", textAlign: "center" }}>
            <button className="da-btn-outline" style={S.btnOutline} onClick={() => setShowAll(s => !s)}>
              {showAll ? <><ChevronUp size={13} /> Show Less</> : <><ChevronDown size={13} /> View More ({sortedVisits.length - 5} remaining)</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   MAIN / PAGE SHELL
───────────────────────────────────────── */
const PatientListingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const query    = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [selectedPatient,   setSelectedPatient]   = useState(null);
  const [doctorName,        setDoctorName]        = useState("");
  const [doctorSpeciality,  setDoctorSpeciality]  = useState("");
  const [hospitalId,        setHospitalId]        = useState("");

  useEffect(() => {
    if (!doctorId) return;
    fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor_id: doctorId }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.status === "success") {
          const info = d.data || d;
          setDoctorName(info.doctor_name);
          setDoctorSpeciality(info.doctor_speciality);
          setHospitalId(info.hospital_id);
        }
      })
      .catch(console.error);
  }, [doctorId]);

  const handleLogout = async () => {
    try { await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: "POST", credentials: "include" }); }
    finally { navigate("/login"); }
  };

  const navSections = [
  {
    label: "Overview",
    items: [
      { 
        label: "Dashboard", 
        icon: <Home size={14} />, 
        action: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`), 
        key: "dashboard" 
      },
      { 
        label: "Appointment", 
        icon: <Settings size={14} />, 
        action: () => navigate(`/appointments?doctor_id=${doctorId}`), 
        key: "appointment" 
      },
      { 
        label: "Date-wise Appointments", 
        icon: <Calendar size={14} />, 
        action: () => navigate(`/date-wise-appointment-dashboard?doctor_id=${doctorId}`),  // Changed to setActiveView
        key: "dateAppointments" 
      },
      { 
        label: "Patient Listing", 
        icon: <Users size={14} />, 
        action: () => navigate(`/patient-listing?doctor_id=${doctorId}`),  // Changed to setActiveView
        key: "patientListing", 
        active: true 
      },
    ],
  },
  {
    label: "Clinical",
    items: [
      { 
        label: "Skills Settings", 
        icon: <FileText size={14} />, 
        action: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`), 
        key: "skillsSettings" 
      },
      { 
        label: "Node Settings", 
        icon: <Settings size={14} />, 
        action: () => (window.location.href = `/settings.html?doctor_id=${doctorId}`), 
        key: "nodeSettings" 
      },
    ],
  },
  {
    label: "Communication",
    items: [
      { 
        label: "Communication View", 
        icon: <MessageCircle size={14} />, 
        action: () => navigate(`/appointment-dashboard1?doctor_id=${doctorId}`),   // Changed to setActiveView
        key: "communication" 
      },
      { 
        label: "Communication Progression", 
        icon: <Calendar size={14} />, 
        action: () => navigate(`/doctor-communication-dashboard?doctor_id=${doctorId}`), 
        key: "communicationProgression" 
      },
    ],
  },
  {
    label: "Other",
    items: [
      { 
        label: "Patient Registration", 
        icon: <UserPlus size={14} />, 
        action: () => navigate(`/register-patient?doctor_id=${doctorId}`), 
        key: "patientRegistration" 
      },
    ],
  },
];

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: T.bg, fontFamily: T.font, fontWeight: 300, color: T.text }}>

        {/* ══════════ SIDEBAR ══════════ */}
        <aside style={{
          width: SIDEBAR_W, minHeight: "100vh",
          position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
          background: T.bg, borderRight: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column",
        }}>
          {/* brand */}
          <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text }}>Doctorassist.AI</span>
            </div>
            <span style={S.secLabel}>Physician</span>
            <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: 0 }}>{doctorName || "Loading…"}</p>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, marginTop: "2px" }}>{doctorSpeciality || "—"}</p>
          </div>

          {/* nav */}
          <nav className="da-sidebar-scroll" style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0" }}>
          {navSections.map((section, idx) => (
            <div key={idx}>
              <span style={{ 
                fontSize: "0.58rem", 
                textTransform: "uppercase", 
                letterSpacing: "0.15em", 
                color: T.textMuted, 
                padding: "0.5rem 1.25rem 0.25rem", 
                display: "block",
                marginTop: idx > 0 ? "0.5rem" : 0
              }}>
                {section.label}
              </span>
              {section.items.map((item, i) => (
                <button key={i}
                  className={`da-nav-btn${item.active ? " da-active" : ""}`}
                  onClick={item.action}
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
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

          {/* logout */}
          <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button className="da-btn-outline" style={{ ...S.btnOutline, width: "100%", justifyContent: "center" }} onClick={handleLogout}>
              <LogOut size={13} /> Logout
            </button>
          </div>
        </aside>

        {/* ══════════ MAIN ══════════ */}
        <main style={{ marginLeft: SIDEBAR_W, flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* top bar */}
          <div style={{
            position: "sticky", top: 0, zIndex: 50,
            background: T.bg, borderBottom: `1px solid ${T.border}`,
            padding: "0.875rem 2rem",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <span style={S.secLabel}>Patient Management</span>
              <h1 style={{ fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>
                {selectedPatient ? selectedPatient.name : "Patient Listing"}
              </h1>
            </div>
            {!selectedPatient && (
              <button className="da-btn-primary" style={S.btnPrimary}
                onClick={() => navigate(`/register-patient?doctor_id=${doctorId}`)}>
                <UserPlus size={13} /> Register Patient →
              </button>
            )}
          </div>

          {/* body */}
          <div style={{ padding: "1.5rem 2rem", flex: 1 }}>
            <div style={{ border: `1px solid ${T.border}`, background: T.bg, padding: "1.5rem" }}>
              {selectedPatient ? (
                <PatientProfile patient={selectedPatient} onBack={() => setSelectedPatient(null)} />
              ) : (
                <PatientList
                  doctorId={doctorId}
                  hospitalId={hospitalId}
                  onViewProfile={setSelectedPatient}
                />
              )}
            </div>
          </div>

        </main>
      </div>
    </>
  );
};

export default PatientListingPage;