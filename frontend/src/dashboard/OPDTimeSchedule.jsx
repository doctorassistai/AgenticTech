import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/lodo_only.png";
import {
  Home, LogOut, Calendar, Activity, FileText,
  ChevronRight, UserPlus, Settings, Menu, X, MessageCircle, Notebook, Users
} from "lucide-react";

// ─── THEME TOKENS (matching DoctorDashboard exactly) ───
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
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const DAYS = [
  { id: "monday",    label: "Monday",    short: "Mon" },
  { id: "tuesday",   label: "Tuesday",   short: "Tue" },
  { id: "wednesday", label: "Wednesday", short: "Wed" },
  { id: "thursday",  label: "Thursday",  short: "Thu" },
  { id: "friday",    label: "Friday",    short: "Fri" },
  { id: "saturday",  label: "Saturday",  short: "Sat" },
  { id: "sunday",    label: "Sunday",    short: "Sun" },
];

const TIME_INTERVALS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

const TIME_OPTIONS = [
  "6:00 AM","6:30 AM","7:00 AM","7:30 AM","8:00 AM","8:30 AM","9:00 AM","9:30 AM",
  "10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","1:00 PM","1:30 PM",
  "2:00 PM","2:30 PM","3:00 PM","3:30 PM","4:00 PM","4:30 PM","5:00 PM","5:30 PM",
  "6:00 PM","6:30 PM","7:00 PM","7:30 PM","8:00 PM","8:30 PM","9:00 PM","9:30 PM","10:00 PM",
];

/* ─── STYLES (copied 1:1 from DoctorDashboard where shared) ─── */
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

  // ── Sidebar (exact copy from DoctorDashboard) ──
  sidebar: {
    width: SIDEBAR_WIDTH,
    minHeight: "100vh",
    position: "fixed",
    left: 0,
    top: 0,
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
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 199,
  },

  // ── Main ──
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
    background: T.bg,
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
  topBarMeta: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "0.72rem",
    color: T.textMuted,
  },

  body: {
    padding: "2rem",
    flex: 1,
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
    margin: 0,
  },

  scheduleGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "1px",
    background: T.border,
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
  },
  dayCard: {
    background: T.bg,
    padding: "1.25rem 1.5rem",
    transition: "background 0.15s",
  },
  dayCardActive: {
    background: T.bgAlt,
  },
  dayHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1rem",
    paddingBottom: "0.75rem",
    borderBottom: `1px solid ${T.border}`,
  },
  dayLabel: {
    fontSize: "0.78rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  toggle: {
    width: "36px",
    height: "18px",
    borderRadius: "9px",
    position: "relative",
    padding: "2px",
    border: "none",
    cursor: "pointer",
    transition: "background 0.2s",
    flexShrink: 0,
  },
  toggleKnob: {
    display: "block",
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    background: "white",
    transition: "transform 0.2s ease",
  },
  fieldGroup: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  fieldLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.35rem",
  },
  select: {
    width: "100%",
    background: T.bg,
    border: `1px solid ${T.border}`,
    padding: "0.45rem 0.6rem",
    fontSize: "0.75rem",
    fontWeight: 300,
    color: T.text,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    appearance: "none",
    outline: "none",
    transition: "border-color 0.15s",
  },
  intervalRow: {
    display: "flex",
    gap: "4px",
  },
  intervalBtn: {
    flex: 1,
    padding: "0.4rem 0",
    background: T.bg,
    border: `1px solid ${T.border}`,
    fontSize: "0.65rem",
    fontWeight: 300,
    color: T.textSec,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    textAlign: "center",
    letterSpacing: "0.04em",
  },
  intervalBtnActive: {
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontWeight: 400,
  },
  disabledOverlay: {
    opacity: 0.4,
    pointerEvents: "none",
    transition: "opacity 0.2s",
  },
  summarySection: {
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
  },
  summaryHeader: {
    padding: "0.875rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    fontSize: "0.72rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
  },
  summaryBody: {
    padding: "1.25rem 1.5rem",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    minHeight: "60px",
    alignItems: "center",
  },
  summaryTag: {
    padding: "0.3rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    fontSize: "0.7rem",
    fontWeight: 400,
    color: T.textSec,
    letterSpacing: "0.04em",
  },
  summaryEmpty: {
    fontSize: "0.75rem",
    color: T.textMuted,
    fontWeight: 300,
  },
  saveRow: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "12px",
    paddingTop: "0.5rem",
  },
  saveBtn: {
    padding: "0.65rem 2rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.75rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    transition: "all 0.15s",
  },
  saveBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
};

/* ─── MAIN COMPONENT ─── */
const OPDTimePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // ── Mobile sidebar state (exact from DoctorDashboard) ──
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 768
  );

  const [schedule, setSchedule] = useState(() => {
    const initial = {};
    DAYS.forEach((day) => {
      initial[day.id] = { enabled: false, fromTime: "9:00 AM", toTime: "5:00 PM", interval: 30 };
    });
    return initial;
  });

  // Resize listener (exact from DoctorDashboard)
  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Auth check (exact from DoctorDashboard)
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/doctors/verify`, { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (doctorId && doctorId !== data.doctor.sys_user_id) {
          navigate("/login");
          return;
        }
      } catch {
        navigate("/login");
      } finally {
        setAuthChecked(true);
      }
    };
    verifyAuth();
  }, [navigate, doctorId]);

  const fetchDoctorSchedule = async () => {
    if (!doctorId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}hms/users/data/whatsapp/get-opd_timings/${doctorId}`,
        { method: "GET", headers: { "Content-Type": "application/json" } }
      );
      const data = await response.json();
      if (data.status === "success" && data.timings) {
        const newSchedule = {};
        DAYS.forEach(day => {
          newSchedule[day.id] = { enabled: false, fromTime: "9:00 AM", toTime: "5:00 PM", interval: 30 };
        });
        data.timings.forEach(timing => {
          const dayId = DAYS.find(d => d.label.toLowerCase() === timing.day.toLowerCase())?.id;
          if (dayId) {
            newSchedule[dayId] = {
              enabled: true,
              fromTime: timing.from_time,
              toTime: timing.to_time,
              interval: parseInt(timing.interval) || 30,
            };
          }
        });
        setSchedule(newSchedule);
      }
    } catch (error) {
      console.error("Error fetching schedule:", error);
    }
  };

  useEffect(() => {
    const loadAllData = async () => {
      if (!doctorId) { setLoading(false); return; }
      setLoading(true);
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
        if (data.status === "success" && data.doctor_name) {
          setDoctorName(data.doctor_name);
          setDoctorSpeciality(data.doctor_speciality || "");
        } else {
          setDoctorName("Doctor Not Found");
        }
      } catch {
        setDoctorName("Error Loading Doctor");
      }
      await fetchDoctorSchedule();
      setLoading(false);
    };
    loadAllData();
  }, [doctorId]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      navigate("/login");
    }
  };

  const toggleDay = (dayId) => {
    setSchedule(prev => ({ ...prev, [dayId]: { ...prev[dayId], enabled: !prev[dayId].enabled } }));
  };

  const updateSchedule = (dayId, field, value) => {
    setSchedule(prev => ({ ...prev, [dayId]: { ...prev[dayId], [field]: value } }));
  };

  const handleSave = async () => {
    if (!doctorId) { alert("No doctor ID found in URL"); return; }
    try {
      const timingsArray = DAYS
        .filter(day => schedule[day.id].enabled)
        .map(day => ({
          day: day.label,
          from_time: schedule[day.id].fromTime,
          to_time: schedule[day.id].toTime,
          interval: schedule[day.id].interval.toString(),
        }));
      const response = await fetch(`${API_BASE_URL}hms/users/data/whatsapp/save-opd_timings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, timings: timingsArray }),
      });
      const result = await response.json();
      if (result.status === "success") {
        alert(`Schedule ${result.action} successfully!`);
        await fetchDoctorSchedule();
      } else {
        alert(`Error: ${result.message}`);
      }
    } catch {
      alert("Failed to save schedule");
    }
  };

  // ── Nav sections (exact copy from DoctorDashboard, with OPD Schedule marked active) ──
  const navSections = [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          icon: <Home size={14} />,
          action: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`),
        },
        {
          label: "Appointment",
          icon: <Settings size={14} />,
          action: () => navigate(`/appointments?doctor_id=${doctorId}`),
        },
        {
          label: "Date-wise Appointments",
          icon: <Calendar size={14} />,
          action: () => navigate(`/date-wise-appointment-dashboard?doctor_id=${doctorId}`),
        },
        {
          label: "Patient Listing",
          icon: <Users size={14} />,
          action: () => navigate(`/patient-listing?doctor_id=${doctorId}`),
        },
      ],
    },
    {
      label: "Clinical",
      items: [
        {
          label: "Knowledge Graph Upload",
          icon: <Activity size={14} />,
          action: () => navigate(`/knowledge-graph?doctor_id=${doctorId}`),
        },
        {
          label: "Skill View",
          icon: <Notebook size={14} />,
          action: () => navigate(`/skills?doctor_id=${doctorId}`),
        },
        {
          label: "Evidence Network",
          icon: <Activity size={14} />,
          action: () => navigate(`/ClinicalKnowledgeGraph?doctorId=${doctorId}`),
        },
        {
          label: "Instruction Settings",
          icon: <FileText size={14} />,
          action: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`),
        },
        {
          label: "Clinical Engine Rule",
          icon: <Activity size={14} />,
          action: () => navigate(`/agentic-rule?doctor_id=${doctorId}`),
        },
        {
          label: "Node Settings",
          icon: <Settings size={14} />,
          action: () => (window.location.href = `/settings.html?doctor_id=${doctorId}`),
        },
        {
          label: "OPD Time Schedule",
          icon: <Calendar size={14} />,
          action: null,   // current page — no navigation
          active: true,
        },
      ],
    },
    {
      label: "Communication",
      items: [
        {
          label: "Communication View",
          icon: <MessageCircle size={14} />,
          action: () => navigate(`/appointment-dashboard1?doctor_id=${doctorId}`),
        },
        {
          label: "Communication Progression",
          icon: <Calendar size={14} />,
          action: () => navigate(`/doctor-communication-dashboard?doctor_id=${doctorId}`),
        },
      ],
    },
    {
      label: "Other",
      items: [
        {
          label: "Patient Registration",
          icon: <UserPlus size={14} />,
          action: () => {
            if (!doctorId) return alert("Doctor ID missing");
            navigate(`/register-patient?doctor_id=${doctorId}`);
          },
        },
      ],
    },
  ];

  // ── Auth loading ──
  if (!authChecked) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.75rem",
        color: T.textMuted, letterSpacing: "0.15em", textTransform: "uppercase",
      }}>
        Verifying session…
      </div>
    );
  }

  // ── No doctor ID ──
  if (!doctorId) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: T.bg, fontFamily: "'Open Sans', sans-serif",
      }}>
        <div style={{ border: `1px solid ${T.border}`, padding: "2.5rem", maxWidth: "400px", textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, marginBottom: "0.5rem" }}>
            No Doctor ID Provided
          </p>
          <p style={{ fontSize: "0.72rem", color: T.textMuted, fontWeight: 300 }}>
            Please provide a <code>doctor_id</code> in the URL query parameters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }

        /* Sidebar hover states — identical class names to DoctorDashboard */
        .da-nav-btn:hover  { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-logout:hover   { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }

        /* OPD-specific */
        .opd-select:focus   { border-color: ${T.text} !important; }
        .opd-select:hover   { border-color: ${T.textSec} !important; }
        .opd-int-btn:hover  { border-color: ${T.text} !important; color: ${T.text} !important; }
        .opd-save-btn:hover { background: transparent !important; color: ${T.text} !important; }
        .opd-day-card:hover { background: ${T.bgAlt} !important; }

        @media (max-width: 767px) {
          .da-main { margin-left: 0 !important; }
          .da-hamburger { display: flex !important; }
          .da-body { padding: 1rem !important; }
          .da-top-bar { padding: 0.75rem 1rem !important; }
          .opd-grid { grid-template-columns: 1fr !important; }
        }
        @media (min-width: 768px) {
          .da-hamburger { display: none !important; }
        }
      `}</style>

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div style={S.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ═══════════════ SIDEBAR (exact DoctorDashboard structure) ═══════════════ */}
      <aside style={{
        ...S.sidebar,
        transform: isMobile && !sidebarOpen ? "translateX(-100%)" : "translateX(0)",
      }}>
        {/* Header */}
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <span style={S.brandName}>DoctorAssist.AI</span>
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(false)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.text, padding: "2px" }}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorName}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        {/* Scrollable nav */}
        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => (
                <button
                  key={ii}
                  className="da-nav-btn"
                  style={{
                    ...S.navBtn,
                    ...(item.active ? S.navBtnActive : {}),
                  }}
                  onClick={() => {
                    if (item.action) {
                      item.action();
                      if (isMobile) setSidebarOpen(false);
                    }
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Footer / Logout */}
        <div style={S.sidebarFooter}>
          <button className="da-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══════════════ MAIN ═══════════════ */}
      <main
        className="da-main"
        style={{ ...S.main, marginLeft: isMobile ? 0 : SIDEBAR_WIDTH }}
      >
        {/* Top bar */}
        <div className="da-top-bar" style={S.topBar}>
          <div style={S.topBarLeft}>
            <button
              className="da-hamburger"
              style={S.hamburger}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span style={S.topBarTitle}>OPD Time Schedule</span>
          </div>
          <div style={S.topBarMeta}>
            <Calendar size={13} />
            <span>Manage clinic hours</span>
          </div>
        </div>

        {/* Body */}
        <div className="da-body" style={S.body}>

          {/* Page heading */}
          <span style={S.pageLabel}>Schedule</span>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.75rem" }}>
            <h1 style={S.pageTitle}>Weekly Schedule</h1>
            <span style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.08em" }}>
              {DAYS.filter(d => schedule[d.id].enabled).length} of {DAYS.length} days active
            </span>
          </div>

          {/* Schedule Grid */}
          <div
            className="opd-grid"
            style={S.scheduleGrid}
          >
            {DAYS.map((day) => {
              const ds = schedule[day.id];
              return (
                <div
                  key={day.id}
                  className="opd-day-card"
                  style={{ ...S.dayCard, ...(ds.enabled ? S.dayCardActive : {}) }}
                >
                  {/* Day row */}
                  <div style={S.dayHeader}>
                    <span style={S.dayLabel}>{day.label}</span>
                    <button
                      onClick={() => toggleDay(day.id)}
                      style={{
                        ...S.toggle,
                        background: ds.enabled ? T.text : T.border,
                      }}
                      aria-label={`Toggle ${day.label}`}
                    >
                      <span
                        style={{
                          ...S.toggleKnob,
                          transform: ds.enabled ? "translateX(18px)" : "translateX(0)",
                        }}
                      />
                    </button>
                  </div>

                  {/* Controls */}
                  <div style={ds.enabled ? {} : S.disabledOverlay}>
                    <div style={S.fieldGroup}>
                      <div>
                        <label style={S.fieldLabel}>Start</label>
                        <select
                          value={ds.fromTime}
                          onChange={e => updateSchedule(day.id, "fromTime", e.target.value)}
                          className="opd-select"
                          style={S.select}
                        >
                          {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={S.fieldLabel}>End</label>
                        <select
                          value={ds.toTime}
                          onChange={e => updateSchedule(day.id, "toTime", e.target.value)}
                          className="opd-select"
                          style={S.select}
                        >
                          {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label style={S.fieldLabel}>Slot Duration</label>
                      <div style={S.intervalRow}>
                        {TIME_INTERVALS.map(interval => (
                          <button
                            key={interval.value}
                            className="opd-int-btn"
                            onClick={() => updateSchedule(day.id, "interval", interval.value)}
                            style={{
                              ...S.intervalBtn,
                              ...(ds.interval === interval.value ? S.intervalBtnActive : {}),
                            }}
                          >
                            {interval.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div style={S.summarySection}>
            <div style={S.summaryHeader}>Summary</div>
            <div style={S.summaryBody}>
              {DAYS.filter(d => schedule[d.id].enabled).length === 0 ? (
                <span style={S.summaryEmpty}>No days selected yet</span>
              ) : (
                DAYS.filter(d => schedule[d.id].enabled).map(day => {
                  const s = schedule[day.id];
                  return (
                    <span key={day.id} style={S.summaryTag}>
                      {day.short} · {s.fromTime} – {s.toTime} · {s.interval}min
                    </span>
                  );
                })
              )}
            </div>
          </div>

          {/* Save */}
          <div style={S.saveRow}>
            <button
              onClick={handleSave}
              disabled={loading}
              className="opd-save-btn"
              style={{ ...S.saveBtn, ...(loading ? S.saveBtnDisabled : {}) }}
            >
              {loading ? "Loading Data…" : "Save Schedule"}
            </button>
          </div>

        </div>
      </main>
    </div>
  );
};

export default OPDTimePage;