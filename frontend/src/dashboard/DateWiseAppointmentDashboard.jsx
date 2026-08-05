import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Calendar,
  FileText,
  Home,
  LogOut,
  MessageCircle,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── BRAND TOKENS ─────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';

const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
};

const SIDEBAR_WIDTH = "248px";

const C = {
  black:        "#000000",
  white:        "#ffffff",
  bgPrimary:    "#ffffff",
  bgSecondary:  "#fafafa",
  bgTertiary:   "#f5f5f5",
  textPrimary:  "#000000",
  textSecond:   "#444444",
  textMuted:    "#888888",
  border:       "#e0e0e0",
  borderStrong: "#000000",
  completed: { bg: "#f5fff8", border: "#b8e8c8", dot: "#27ae60", text: "#27ae60" },
  cancelled:  { bg: "#fff5f5", border: "#f5c6c6", dot: "#c0392b", text: "#c0392b" },
  pending:    { bg: "#fffbf0", border: "#f5dfa0", dot: "#b8860b", text: "#b8860b" },
  neutral:    { bg: "#f5f5f5", border: "#e0e0e0", dot: "#888888", text: "#888888" },
};

const labelStyle = {
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: C.textMuted,
  fontFamily: FONT,
  fontWeight: 400,
};

// ─── SIDEBAR STYLES (exact from DoctorCommunicationDashboard) ───
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
    padding: "0.5rem 1.25rem 0.25rem",
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
};

// ─── STATUS HELPERS ───────────────────────────────────────────────────────────
const getStatusTone = (status) => {
  switch (status?.toLowerCase()) {
    case "completed": return C.completed;
    case "cancelled":  return C.cancelled;
    case "pending":    return C.pending;
    default:           return C.neutral;
  }
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
const DateWiseAppointmentDashboard = ({ doctorId: doctorIdProp }) => {
  const navigate = useNavigate();

  const getDoctorIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("doctor_id");
  };

  // Accept doctorId as prop (when rendered inline) or from URL (when standalone)
  const doctorId = doctorIdProp || getDoctorIdFromUrl();

  const today = new Date().toISOString().split("T")[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [appointments, setAppointments] = useState([]);
  const [summary, setSummary]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [doctorInfo, setDoctorInfo]     = useState(null);
  const [doctorName, setDoctorName]     = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");

  // ── Fetch doctor name/speciality (for sidebar) ──
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
      } catch {}
    })();
  }, [doctorId]);

  // ── Fetch Appointments ──
  const fetchAppointments = useCallback(async (date) => {
    try {
      setLoading(true);
      const res  = await fetch(`${API_BASE_URL}hms/users/doctors/doctor_status_appointments/${doctorId}?date=${date}`);
      const data = await res.json();
      if (data.status === "success") {
        setAppointments(data.appointments || []);
        setSummary(data.summary || null);
      }
    } catch (err) { console.error("Error fetching appointments:", err); }
    finally { setLoading(false); }
  }, [doctorId]);

  useEffect(() => { fetchAppointments(selectedDate); }, [selectedDate, fetchAppointments]);

  // ── Fetch Doctor Info ──
  const fetchDoctorInfo = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor_speciality/${doctorId}`);
      const data = await res.json();
      if (data.status === "success") setDoctorInfo(data);
    } catch (err) { console.error("Error fetching doctor info:", err); }
  }, [doctorId]);

  useEffect(() => { fetchDoctorInfo(); }, [fetchDoctorInfo]);

  // ── Filtered + sorted list ──
  const filteredAppointments = useMemo(() => {
    let list = [...appointments].sort(
      (a, b) => new Date(`1970/01/01 ${a.scheduled_time}`) - new Date(`1970/01/01 ${b.scheduled_time}`)
    );
    if (activeFilter === "ALL") return list;
    if (activeFilter === "New" || activeFilter === "Follow-up")
      return list.filter(a => a.visit_type?.toLowerCase() === activeFilter.toLowerCase());
    return list.filter(a => a.status?.toLowerCase() === activeFilter.toLowerCase());
  }, [appointments, activeFilter]);

  const SUMMARY_ITEMS = summary ? [
    { label: "Total",     value: summary.total,          key: "ALL" },
    { label: "New",       value: summary.new_count,      key: "New" },
    { label: "Follow-up", value: summary.followup_count, key: "Follow-up" },
    { label: "Completed", value: summary.completed,      key: "Completed" },
    { label: "Cancelled", value: summary.cancelled,      key: "Cancelled" },
    { label: "Pending",   value: summary.pending,        key: "Pending" },
  ] : [];

  // ── Logout ──
  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      navigate("/login");
    }
  };

  // ── Nav sections (exact from DoctorCommunicationDashboard) ──
  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard",               icon: <Home size={14} />,        action: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`),                          key: "dashboard" },
        { label: "Appointment",             icon: <Settings size={14} />,    action: () => navigate(`/appointments?doctor_id=${doctorId}`) },
        { label: "Date-wise Appointments",  icon: <Calendar size={14} />,    action: () => navigate(`/date-appointments?doctor_id=${doctorId}`),                         key: "dateAppointments", active: true },
        { label: "Patient Listing",         icon: <Users size={14} />,       action: () => navigate(`/patient-listing?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Clinical",
      items: [
        { label: "Skills Settings", icon: <FileText size={14} />,  action: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`) },
        { label: "Node Settings",   icon: <Settings size={14} />,  action: () => (window.location.href = `/settings.html?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Communication",
      items: [
        { label: "Communication View",        icon: <MessageCircle size={14} />, action: () => navigate(`/appointment-dashboard1?doctor_id=${doctorId}`) },
        { label: "Communication Progression", icon: <Calendar size={14} />,      action: () => navigate(`/doctor-communication-dashboard?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Other",
      items: [
        { label: "Patient Registration", icon: <UserPlus size={14} />, action: () => navigate(`/register-patient?doctor_id=${doctorId}`) },
      ],
    },
  ];

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ═══════════════ SIDEBAR ═══════════════ */}
      <aside style={S.sidebar}>
        {/* brand */}
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <span style={S.brandName}>DoctorAssist.AI</span>
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorName}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        {/* nav */}
        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const isActive = item.active === true;
                return (
                  <button
                    key={ii}
                    className="da-nav-btn"
                    style={{ ...S.navBtn, ...(isActive ? S.navBtnActive : {}) }}
                    onClick={item.action}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* logout */}
        <div style={S.sidebarFooter}>
          <button className="da-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div style={{ flex: 1, marginLeft: SIDEBAR_WIDTH, minWidth: 0 }}>

        {/* ── Page header ── */}
        <div style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          flexWrap: "wrap", gap: "12px",
          padding: "20px 24px",
          background: C.bgSecondary,
          borderBottom: `1px solid ${C.borderStrong}`,
        }}>
          <div>
            <div style={labelStyle}>Appointments</div>
            <div style={{ fontSize: "20px", fontWeight: 300, letterSpacing: "-0.02em", marginTop: "2px" }}>
              Date-wise Schedule
            </div>
            {doctorInfo && (
              <div style={{ fontSize: "12px", color: C.textMuted, marginTop: "4px" }}>
                Dr. {doctorInfo.doctor_name} · {doctorInfo.specialization}
              </div>
            )}
          </div>

          {/* Date picker */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={labelStyle}>Select Date</div>
            <input
              type="date"
              value={selectedDate}
              onChange={e => { setActiveFilter("ALL"); setSelectedDate(e.target.value); }}
              style={{
                fontFamily: FONT, fontWeight: 300, fontSize: "13px",
                color: C.textPrimary, background: C.bgPrimary,
                border: `1px solid ${C.border}`, borderRadius: 0,
                padding: "7px 12px", outline: "none", cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onFocus={e => { e.target.style.borderColor = C.black; }}
              onBlur={e  => { e.target.style.borderColor = C.border; }}
            />
          </div>
        </div>

        <div style={{ padding: "24px" }}>

          {/* ── Summary cards ── */}
          {summary && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: "0",
              marginBottom: "28px",
              border: `1px solid ${C.borderStrong}`,
            }}>
              {SUMMARY_ITEMS.map((item, idx) => {
                const isActive = activeFilter === item.key;
                return (
                  <div
                    key={item.key}
                    onClick={() => setActiveFilter(item.key)}
                    style={{
                      padding: "16px",
                      background: isActive ? C.black : C.bgPrimary,
                      color:      isActive ? C.white : C.textPrimary,
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.14s",
                      borderRight: idx < SUMMARY_ITEMS.length - 1 ? `1px solid ${C.border}` : "none",
                      userSelect: "none",
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.bgSecondary; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = C.bgPrimary; }}
                  >
                    <div style={{ ...labelStyle, color: isActive ? "rgba(255,255,255,0.6)" : C.textMuted, marginBottom: "6px" }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: 300, letterSpacing: "-0.03em", lineHeight: 1 }}>
                      {item.value ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Active filter indicator ── */}
          {activeFilter !== "ALL" && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: "16px",
              padding: "8px 14px",
              border: `1px solid ${C.border}`,
              background: C.bgSecondary,
            }}>
              <div style={{ ...labelStyle }}>
                Filtering by: <span style={{ color: C.textPrimary, fontWeight: 400 }}>{activeFilter}</span>
                {" "}· {filteredAppointments.length} result{filteredAppointments.length !== 1 ? "s" : ""}
              </div>
              <button
                onClick={() => setActiveFilter("ALL")}
                style={{
                  fontFamily: FONT, fontSize: "11px", fontWeight: 300,
                  color: C.textMuted, background: "transparent",
                  border: `1px solid ${C.border}`, borderRadius: 0,
                  padding: "3px 10px", cursor: "pointer",
                  transition: "all 0.14s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.black; e.currentTarget.style.color = C.black; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
              >
                Clear
              </button>
            </div>
          )}

          {/* ── Appointment list ── */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: C.textMuted, fontSize: "13px" }}>
              <div style={{ fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase" }}>Loading appointments...</div>
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "48px 0",
              border: `1px solid ${C.border}`,
              background: C.bgSecondary,
            }}>
              <div style={{ ...labelStyle, display: "block", marginBottom: "6px" }}>No Results</div>
              <div style={{ fontSize: "13px", color: C.textMuted, fontWeight: 300 }}>
                No appointments found for this date{activeFilter !== "ALL" ? ` and filter "${activeFilter}"` : ""}.
              </div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${C.border}` }}>
              {/* Table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 110px 100px 110px 1fr",
                gap: 0,
                padding: "10px 16px",
                background: C.bgSecondary,
                borderBottom: `1px solid ${C.border}`,
              }}>
                {["Patient", "Time", "Type", "Status", "Chief Complaint"].map((h, i) => (
                  <div key={h} style={{ ...labelStyle, borderRight: i < 4 ? `1px solid ${C.border}` : "none", paddingRight: "12px" }}>
                    {h}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {filteredAppointments.map((apt, idx) => {
                const tone = getStatusTone(apt.status);
                return (
                  <div
                    key={apt.appointment_id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 110px 100px 110px 1fr",
                      gap: 0,
                      padding: "12px 16px",
                      background: C.bgPrimary,
                      borderBottom: idx < filteredAppointments.length - 1 ? `1px solid ${C.border}` : "none",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.bgSecondary; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.bgPrimary; }}
                  >
                    {/* Patient name */}
                    <div style={{ paddingRight: "12px", borderRight: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: "13px", fontWeight: 400, color: C.textPrimary }}>
                        {apt.patient_name || "—"}
                      </div>
                    </div>

                    {/* Time */}
                    <div style={{ paddingLeft: "12px", paddingRight: "12px", borderRight: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: "12px", fontWeight: 300, color: C.textSecond, fontVariantNumeric: "tabular-nums" }}>
                        {apt.scheduled_time || "—"}
                      </div>
                    </div>

                    {/* Visit type */}
                    <div style={{ paddingLeft: "12px", paddingRight: "12px", borderRight: `1px solid ${C.border}` }}>
                      <div style={{
                        display: "inline-block",
                        fontSize: "10px", fontWeight: 400,
                        textTransform: "uppercase", letterSpacing: "0.1em",
                        color: C.textMuted,
                        padding: "2px 6px",
                        border: `1px solid ${C.border}`,
                        background: C.bgSecondary,
                      }}>
                        {apt.visit_type || "—"}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div style={{ paddingLeft: "12px", paddingRight: "12px", borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center" }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: "5px",
                        padding: "2px 8px",
                        background: tone.bg,
                        border: `1px solid ${tone.border}`,
                      }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: tone.dot, flexShrink: 0 }} />
                        <span style={{ fontSize: "10px", fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.08em", color: tone.text }}>
                          {apt.status || "N/A"}
                        </span>
                      </div>
                    </div>

                    {/* Chief complaint */}
                    <div style={{ paddingLeft: "12px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 300, color: C.textMuted, lineHeight: 1.5 }}>
                        {apt.chief_complaint || "—"}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Footer count */}
              <div style={{
                padding: "8px 16px",
                background: C.bgSecondary,
                borderTop: `1px solid ${C.border}`,
                display: "flex", justifyContent: "flex-end",
              }}>
                <div style={labelStyle}>
                  {filteredAppointments.length} {filteredAppointments.length === 1 ? "appointment" : "appointments"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DateWiseAppointmentDashboard;