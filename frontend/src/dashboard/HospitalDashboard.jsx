import React from "react";
import { THEMES } from "./themes";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Calendar,
  UserPlus,
  Users,
  FileText,
  Stethoscope,
  LogOut,
  Home,
  TrendingUp,
  Clock,
  CheckCircle,
  Settings,
  Bell,
  Search,
  ChevronRight,
  Building,
  User,
  Pill,
  Clipboard,
  HeartPulse,
  Thermometer,
  Eye,
  BarChart3,
  ChevronDown,
  Database,
  Dna,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching DoctorDashboard) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  accent: "#000000",
};

const SIDEBAR_WIDTH = "248px";

/* ─── STYLES ─── */
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
    left: 0,
    top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
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
    marginBottom: "0.5rem",
  },

  logoBox: {
    width: "32px",
    height: "32px",
    background: T.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },

  brandSub: {
    fontSize: "0.68rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
  },

  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.75rem 1.25rem 0.25rem",
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

  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },

  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: `1px solid ${T.border}`,
    flexShrink: 0,
  },

  profileRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "0.75rem",
    padding: "0.75rem",
    background: T.bgAlt,
    border: `1px solid ${T.border}`,
  },

  profileAvatar: {
    width: "32px",
    height: "32px",
    background: T.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  profileName: {
    fontWeight: 400,
    margin: 0,
    fontSize: "0.78rem",
    color: T.text,
  },

  profileId: {
    fontSize: "0.65rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
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

  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
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

  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },

  topBarSub: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
  },

  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0.45rem 0.875rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    maxWidth: "260px",
    flex: 1,
  },

  searchInput: {
    border: "none",
    background: "transparent",
    outline: "none",
    flex: 1,
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    minWidth: 0,
  },

  dateBadge: {
    fontSize: "0.72rem",
    color: T.textMuted,
    fontWeight: 300,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "0.45rem 0.75rem",
    border: `1px solid ${T.border}`,
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
    marginBottom: "1.5rem",
  },

  /* Stats grid — flat bordered cells */
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1px",
    border: `1px solid ${T.border}`,
    background: T.border,
    marginBottom: "2rem",
  },

  statCell: {
    background: T.bg,
    padding: "1.25rem 1.5rem",
    cursor: "default",
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
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    marginTop: "0.35rem",
    display: "block",
  },

  statChange: {
    fontSize: "0.62rem",
    color: T.textMuted,
    marginTop: "0.25rem",
    display: "block",
  },

  /* Charts */
  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1px",
    border: `1px solid ${T.border}`,
    background: T.border,
    marginBottom: "2rem",
  },

  chartCell: {
    background: T.bg,
    padding: "1.5rem",
  },

  chartHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "1.25rem",
  },

  chartTitle: {
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: 0,
  },

  chartSub: {
    fontSize: "0.65rem",
    color: T.textMuted,
    margin: "4px 0 0",
  },

  viewToggle: {
    display: "flex",
    gap: "1px",
    background: T.border,
    border: `1px solid ${T.border}`,
  },

  viewToggleBtn: {
    padding: "0.3rem 0.75rem",
    background: T.bg,
    border: "none",
    fontSize: "0.65rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    letterSpacing: "0.05em",
    transition: "all 0.15s",
  },

  viewToggleBtnActive: {
    background: T.text,
    color: T.bg,
  },

  /* Tables */
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
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "500px",
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

  badge: {
    padding: "0.2rem 0.5rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
    color: T.textSec,
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
    width: "100%",
    marginBottom: "0.5rem",
  },

  loadingBox: {
    padding: "3rem",
    textAlign: "center",
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
    background: T.bgAlt,
    color: T.textMuted,
    fontSize: "0.78rem",
    fontWeight: 300,
  },
};

/* ─── CHART COMPONENT ─── */
const AppointmentChart = ({ title, data, viewType, setViewType }) => {
  const [visibleLines, setVisibleLines] = useState({
    total: true, completed: true, pending: true, cancelled: true,
  });
  const [progress, setProgress] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredLine, setHoveredLine] = useState(null);
  const svgRef = useRef(null);
  const [svgWidth, setSvgWidth] = useState(500);

  useEffect(() => {
    const update = () => {
      if (svgRef.current) setSvgWidth(svgRef.current.getBoundingClientRect().width);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    setProgress(0);
    const raf = requestAnimationFrame(() => {
      const start = performance.now();
      const duration = 900;
      const animate = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 4);
        setProgress(ease);
        if (t < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(raf);
  }, [data, viewType]);

  if (!data?.dates?.length) {
    return (
      <div style={S.chartCell}>
        <div style={S.chartHeader}>
          <span style={S.chartTitle}>{title}</span>
        </div>
        <p style={{ color: T.textMuted, fontSize: "0.78rem", fontWeight: 300 }}>No data available</p>
      </div>
    );
  }

  const COLORS = {
    total: "#000000",
    completed: "#444444",
    pending: "#888888",
    cancelled: "#cccccc",
  };

  const PAD = { top: 20, right: 20, bottom: 40, left: 36 };
  const H = 200;
  const W = svgWidth;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = data.dates.length;

  const lineConfigs = [
    { key: "total", label: "Total", data: data.total },
    { key: "completed", label: "Completed", data: data.completed },
    { key: "pending", label: "Pending", data: data.pending },
    { key: "cancelled", label: "Cancelled", data: data.cancelled },
  ].filter((l) => l.data?.length);

  const allValues = lineConfigs
    .filter((l) => visibleLines[l.key])
    .flatMap((l) => l.data);
  const maxVal = Math.max(...allValues, 1) * 1.15;

  const px = (i) => PAD.left + (i / Math.max(n - 1, 1)) * innerW;
  const py = (v) => PAD.top + innerH - (v / maxVal) * innerH * progress;

  const curvePath = (pts) => {
    if (pts.length < 2) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const cp1x = pts[i].x + (pts[i + 1].x - pts[i].x) * 0.4;
      const cp2x = pts[i + 1].x - (pts[i + 1].x - pts[i].x) * 0.4;
      d += ` C${cp1x},${pts[i].y} ${cp2x},${pts[i + 1].y} ${pts[i + 1].x},${pts[i + 1].y}`;
    }
    return d;
  };

  const formatDate = (d) => {
    if (typeof d !== "string") return String(d);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: PAD.top + innerH * (1 - t),
    val: Math.round(maxVal * t),
  }));

  return (
    <div style={S.chartCell}>
      <div style={S.chartHeader}>
        <div>
          <span style={S.chartTitle}>{title}</span>
          <p style={S.chartSub}>
            {viewType === "week" ? "Daily trends this month" : "Weekly aggregated trends"}
          </p>
        </div>
        <div style={S.viewToggle}>
          {["week", "month"].map((v) => (
            <button
              key={v}
              onClick={() => setViewType(v)}
              style={{
                ...S.viewToggleBtn,
                ...(viewType === v ? S.viewToggleBtnActive : {}),
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", marginBottom: "8px" }}>
        <svg
          ref={svgRef}
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ overflow: "visible", display: "block" }}
        >
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PAD.left} y1={tick.y}
                x2={W - PAD.right} y2={tick.y}
                stroke="#e0e0e0" strokeWidth="1" strokeDasharray="4,4"
              />
              <text
                x={PAD.left - 6} y={tick.y}
                textAnchor="end" dominantBaseline="middle"
                fontSize="10" fill={T.textMuted} fontFamily="Open Sans, sans-serif"
              >
                {tick.val}
              </text>
            </g>
          ))}

          {data.dates.map((d, i) => (
            <text
              key={i} x={px(i)} y={H - 6}
              textAnchor="middle" fontSize="10"
              fill={T.textMuted} fontFamily="Open Sans, sans-serif"
            >
              {formatDate(d)}
            </text>
          ))}

          {lineConfigs.filter((l) => visibleLines[l.key]).map((l) => {
            const pts = l.data.map((v, i) => ({ x: px(i), y: py(v), v }));
            const linePath = curvePath(pts);
            const isHovered = hoveredLine === l.key;

            return (
              <g key={l.key}>
                <path
                  d={linePath}
                  fill="none"
                  stroke={COLORS[l.key]}
                  strokeWidth={isHovered ? 2 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={l.key === "cancelled" ? "4,3" : l.key === "pending" ? "2,2" : "none"}
                />
                {pts.map((pt, i) => (
                  <circle
                    key={i}
                    cx={pt.x} cy={pt.y}
                    r={isHovered ? 4 : 3}
                    fill={T.bg}
                    stroke={COLORS[l.key]}
                    strokeWidth="1.5"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => {
                      setHoveredLine(l.key);
                      setTooltip({ x: pt.x, y: pt.y, value: pt.v, label: l.label, date: data.dates[i] });
                    }}
                    onMouseLeave={() => { setHoveredLine(null); setTooltip(null); }}
                  />
                ))}
              </g>
            );
          })}

          {tooltip && (() => {
            const tw = 80, th = 40;
            const tx = Math.min(Math.max(tooltip.x - tw / 2, PAD.left), W - PAD.right - tw);
            const ty = tooltip.y - th - 10;
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={tx} y={ty} width={tw} height={th} fill={T.text} />
                <text x={tx + tw / 2} y={ty + 14} textAnchor="middle" fill={T.bg} fontSize="10" fontFamily="Open Sans, sans-serif">
                  {tooltip.label}
                </text>
                <text x={tx + tw / 2} y={ty + 29} textAnchor="middle" fontSize="14" fill={T.bg} fontFamily="Open Sans, sans-serif">
                  {tooltip.value}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "8px" }}>
        {lineConfigs.map((l) => {
          const active = visibleLines[l.key];
          const total = l.data.reduce((a, b) => a + b, 0);
          return (
            <button
              key={l.key}
              onClick={() => setVisibleLines((p) => ({ ...p, [l.key]: !p[l.key] }))}
              onMouseEnter={() => setHoveredLine(l.key)}
              onMouseLeave={() => setHoveredLine(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "0.25rem 0.5rem",
                border: `1px solid ${active ? COLORS[l.key] : T.border}`,
                background: T.bg,
                cursor: "pointer",
                opacity: active ? 1 : 0.4,
                fontFamily: "'Open Sans', sans-serif",
                fontSize: "0.65rem",
                color: active ? COLORS[l.key] : T.textMuted,
                fontWeight: 400,
                letterSpacing: "0.05em",
                transition: "all 0.15s",
              }}
            >
              <span style={{
                width: "16px",
                height: "1.5px",
                background: active ? COLORS[l.key] : T.border,
                display: "inline-block",
              }} />
              {l.label.toUpperCase()}
              <span style={{ color: T.textMuted, fontWeight: 300 }}>{total}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ─── MAIN COMPONENT ─── */
function HospitalDashboard() {
  const location = useLocation();
  const navigate = useNavigate();

  const queryParams = new URLSearchParams(location.search);
  const hospitalId = queryParams.get("hospital_id");

  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  const [opView, setOpView] = useState("week");
  const [ipView, setIpView] = useState("week");
  const [appointmentData, setAppointmentData] = useState(null);
  const [dashboardStats, setDashboardStats] = useState({
    totalAppointments: 0,
    pendingAppointments: 0,
    completedToday: 0,
    totalPatients: 0,
  });
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [hospitalUserType, setHospitalUserType] = useState(null);
  const [selectedTheme, setSelectedTheme] = useState("BlackWhite");

const themeNames = Object.keys(THEMES);
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/hospitals/verify`, { credentials: "include" });
        if (!res.ok) throw new Error("Not authenticated");
        const data = await res.json();
        const verifiedHospitalId = data.hospital.sys_user_id;
        if (hospitalId && hospitalId !== verifiedHospitalId) { navigate("/login"); return; }
        setAuthenticated(true);
        fetchDoctors();
        fetchHospitalUserData(hospitalId);
      } catch { navigate("/login"); }
      finally { setAuthChecked(true); }
    };
    if (hospitalId) verifyAuth(); else navigate("/login");
  }, [hospitalId, navigate]);
  const fetchHospitalUserData = async (hospitalId) => {
  try {
    const response = await fetch(
      `${API_BASE_URL}hms/users/data/system/get_hospital_user/${hospitalId}`,
      { credentials: "include" }
    );
    
    if (response.ok) {
      const data = await response.json();
      console.log("Fetched hospital user data:", data); // Log the parsed data, not the response
      
      // Check the structure of your response
      // If it's an array:
      if (Array.isArray(data) && data.length > 0) {
        const currentHospital = data.find(h => h.sys_user_id === hospitalId) || data[0];
        setHospitalUserType(currentHospital.hospital_user_type);
        console.log("Hospital user type:", currentHospital.hospital_user_type);
      } 
      // If it's a single object:
      else if (data && typeof data === 'object' && !Array.isArray(data)) {
        setHospitalUserType(data.hospital_user_type);
        console.log("Hospital user type:", data.hospital_user_type);
      }
    } else {
      console.error("Failed to fetch hospital user data, status:", response.status);
    }
  } catch (error) {
    console.error("Error fetching hospital user data:", error);
  }
};

  const fetchDoctors = async () => {
    try {
      setLoadingDoctors(true);
      const response = await fetch(
        `${API_BASE_URL}hms/users/doctors/hospital/${hospitalId}/doctors`,
        { credentials: "include", headers: { "Content-Type": "application/json" } }
      );
      if (!response.ok) { if (response.status === 401) { navigate("/login"); return; } throw new Error(); }
      const data = await response.json();
      setDoctors(data.doctors || []);
      if (data.doctors?.length > 0) setSelectedDoctor(data.doctors[0]);
    } catch {
      setDoctors([{ doctor_id: "DOC-e766c8ed-d6d4-481f-8ef9-8a63d4bd92e1", doctor_name: "Dr. Sample" }]);
      setSelectedDoctor({ doctor_id: "DOC-e766c8ed-d6d4-481f-8ef9-8a63d4bd92e1", doctor_name: "Dr. Sample" });
    } finally { setLoadingDoctors(false); }
  };

  useEffect(() => {
    if (hospitalId) {
      fetchHospitalAppointments(hospitalId);
      fetchHospitalPatients(hospitalId);
    }
  }, [hospitalId]);
useEffect(() => {
  const loadTheme = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/hospital/theme/${hospitalId}`,
        {
          credentials: "include",
        }
      );

      if (res.ok) {
        const data = await res.json();
        setSelectedTheme(data.theme_name || "BlackWhite");
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (hospitalId) {
    loadTheme();
  }
}, [hospitalId]);
  const fetchHospitalAppointments = async (hospitalId) => {
    try {
      setLoadingData(true);
      const response = await fetch(
        `${API_BASE_URL}hms/users/doctors/status-appointments/${hospitalId}`,
        { credentials: "include" }
      );
      let allAppointments = [], pendingCount = 0, completedCount = 0, totalAppointments = 0;
      if (response.ok) {
        const responseData = await response.json();
        if (responseData.success && responseData.data) {
          allAppointments = Array.isArray(responseData.data) ? responseData.data : [];
        } else if (Array.isArray(responseData)) {
          allAppointments = responseData;
        }
        pendingCount = allAppointments.filter((a) => a.status === "Pending").length;
        completedCount = allAppointments.filter((a) => a.status === "Completed").length;
        totalAppointments = allAppointments.length;
      }
      setAppointmentData(processAppointmentData(allAppointments));
      setDashboardStats((prev) => ({ ...prev, totalAppointments, pendingAppointments: pendingCount, completedToday: completedCount }));
    } catch {
      setAppointmentData(generateFallbackData());
    } finally { setLoadingData(false); }
  };

  const fetchHospitalPatients = async (hospitalId) => {
    try {
      setLoadingPatients(true);
      const response = await fetch(
        `${API_BASE_URL}hms/users/doctors/patients_by_hospital/${hospitalId}`,
        { credentials: "include" }
      );
      if (response.ok) {
        const responseData = await response.json();
        const arr = responseData.success && responseData.data
          ? (Array.isArray(responseData.data) ? responseData.data : [])
          : Array.isArray(responseData) ? responseData : [];
        setPatients(arr);
        setDashboardStats((prev) => ({ ...prev, totalPatients: arr.length }));
      }
    } catch { setPatients([]); }
    finally { setLoadingPatients(false); }
  };

  const processAppointmentData = (appointments) => {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth + 1, 0);
    const toDateStr = (d) => d.toISOString().split("T")[0];
    const monthStartStr = toDateStr(monthStart);
    const monthEndStr = toDateStr(monthEnd);

    const weekDates = [];
    const cursor = new Date(currentYear, currentMonth, 1);
    const todayStr = toDateStr(today);
    while (toDateStr(cursor) <= todayStr) {
      weekDates.push(toDateStr(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const totalDays = monthEnd.getDate();
    const chunkSize = Math.ceil(totalDays / 4);
    const weekRanges = [];
    const monthName = today.toLocaleString("default", { month: "short" });
    for (let i = 0; i < 4; i++) {
      const startDay = i * chunkSize + 1;
      const endDay = Math.min((i + 1) * chunkSize, totalDays);
      weekRanges.push({
        label: `${monthName} ${startDay}–${endDay}`,
        start: toDateStr(new Date(currentYear, currentMonth, startDay)),
        end: toDateStr(new Date(currentYear, currentMonth, endDay)),
      });
    }

    const makeData = (dates) => ({
      dates: [...dates],
      total: new Array(dates.length).fill(0),
      completed: new Array(dates.length).fill(0),
      pending: new Array(dates.length).fill(0),
      cancelled: new Array(dates.length).fill(0),
    });

    const opWeekData = makeData(weekDates);
    const ipWeekData = makeData(weekDates);
    const opMonthData = makeData(weekRanges.map((w) => w.label));
    const ipMonthData = makeData(weekRanges.map((w) => w.label));

    appointments.forEach((apt) => {
      try {
        const aptDate = (apt.date || apt.appointment_date || "").split("T")[0];
        const visitType = (apt.visit_type || "").toUpperCase().trim();
        const status = (apt.status || "").toLowerCase().trim();
        const isOP = visitType === "OP";
        const isIP = visitType === "IP";
        if (aptDate < monthStartStr || aptDate > monthEndStr) return;

        const bump = (dataset, index) => {
          if (index >= 0 && index < dataset.total.length) {
            dataset.total[index]++;
            if (status === "completed") dataset.completed[index]++;
            else if (status === "pending") dataset.pending[index]++;
            else if (status === "cancelled") dataset.cancelled[index]++;
          }
        };

        const weekIdx = weekDates.indexOf(aptDate);
        if (weekIdx !== -1) {
          if (isOP) bump(opWeekData, weekIdx);
          if (isIP) bump(ipWeekData, weekIdx);
        }
        for (let i = 0; i < weekRanges.length; i++) {
          if (aptDate >= weekRanges[i].start && aptDate <= weekRanges[i].end) {
            if (isOP) bump(opMonthData, i);
            if (isIP) bump(ipMonthData, i);
            break;
          }
        }
      } catch { }
    });

    return { opWeekData, opMonthData, ipWeekData, ipMonthData };
  };

  const generateFallbackData = () => {
    const today = new Date();
    const weekDates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      weekDates.push(d.toISOString().split("T")[0]);
    }
    return {
      opWeekData: { dates: weekDates, total: [12,15,18,14,20,22,16], completed: [8,10,12,9,15,16,11], pending: [3,4,4,4,4,5,4], cancelled: [1,1,2,1,1,1,1] },
      opMonthData: { dates: ["Apr 1–8","Apr 9–16","Apr 17–24","Apr 25–30"], total: [88,95,82,55], completed: [60,70,55,38], pending: [22,18,21,14], cancelled: [6,7,6,3] },
      ipWeekData: { dates: weekDates, total: [5,7,6,8,9,7,6], completed: [3,5,4,5,7,5,4], pending: [1,1,1,2,1,1,1], cancelled: [1,1,1,1,1,1,1] },
      ipMonthData: { dates: ["Apr 1–8","Apr 9–16","Apr 17–24","Apr 25–30"], total: [40,48,38,22], completed: [28,35,26,15], pending: [8,9,8,5], cancelled: [4,4,4,2] },
    };
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      });
      if (response.ok) { localStorage.clear(); window.location.href = "/login"; }
    } catch { }
  };
const saveTheme = async (themeName) => {
  try {
    const response = await fetch(`${API_BASE_URL}hms/users/data/context/hospital/theme`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hospital_id: hospitalId,
        theme_name: themeName,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to save theme");
    }

    setSelectedTheme(themeName);
  } catch (err) {
    console.error(err);
    alert("Unable to save theme");
  }
};
  const handleAddDoctor = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/register-doctor?hospital_id=${hospitalId}`); };
  const handleAddNurse = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/nurse-register?hospital_id=${hospitalId}`); };
  const handleHospitalStaff = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/hospital-admin-staff?hospital_id=${hospitalId}`); };
  // const handleReportRuleSettings = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/report-rule-settings?hospital_id=${hospitalId}`); };
  const handleAddExcel = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/upload-excel?hospital_id=${hospitalId}`); };

  if (!authChecked || loadingDoctors) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.78rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Loading…
      </div>
    );
  }

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, active: true },
        // { label: "Patients", icon: <Users size={14} />, action: () => {} },
        // { label: "Appointments", icon: <Calendar size={14} />, action: () => {} },
        // { label: "Reports & Analytics", icon: <BarChart3 size={14} />, action: () => {} },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, action: handleAddDoctor },
        { label: "Add Nurse", icon: <UserPlus size={14} />, action: handleAddNurse },
        { label: "Manage Staff", icon: <UserPlus size={14} />, action: handleHospitalStaff },
        // { label: "Departments", icon: <Building size={14} />, action: () => {} },
        // { label: "Add Doctor via Excel", icon: <FileText size={14} />, action: handleAddExcel },
        ...(hospitalUserType === "hms_integration" ? [
        { label: "Add Doctor via Excel", icon: <FileText size={14} />, action: handleAddExcel },
        { label: "Integration Settings", icon: <Database size={14} />, action: () => {
          if (!hospitalId) return alert("Hospital ID missing");
          navigate(`/integration-settings?hospital_id=${hospitalId}`);
        } },
        { label: "Doctor Upload with Timings", icon: <Database size={14} />, action: () => {
          if (!hospitalId) return alert("Hospital ID missing");
          navigate(`/doctor-upload-with-timings?hospital_id=${hospitalId}`);
        } },
        {
        label: "Patient Portal",
        icon: <Database size={14} />,
        action: () => {
          if (!hospitalId) return alert("Hospital ID missing");
          window.open(`/patient-portal?hospital_id=${hospitalId}`, "_blank");
        }
      }
      ] : []),
      ],
    },
    {
      label: "Specialty",
      items: [
        {
          label: "Oncology Monitoring Dashboard",
          icon: <Dna size={14} />,
          action: () => {
            if (!hospitalId) {
              alert("Hospital ID missing");
              return;
            }
            navigate(`/onco-dashboard?hospital_id=${hospitalId}`);
          }
        },
      ],
    },
    // {
    //   label: "Settings",
    //   items: [
    //     { label: "Report Rule Settings", icon: <Clipboard size={14} />, action: handleReportRuleSettings },
    //     // { label: "Settings", icon: <Settings size={14} />, action: () => {} },
    //   ],
    // },
  ];

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .h-stat:hover { background: ${T.bgAlt} !important; }
        .h-patient-row:hover { background: ${T.bgAlt} !important; }
        .h-action-btn:hover { background: transparent !important; color: ${T.text} !important; }
        .h-outline-btn:hover { border-color: ${T.text} !important; }
        .h-menu-scroll::-webkit-scrollbar { display: none; }
        .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ═══ SIDEBAR ═══ */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <div>
              <p style={S.brandName}>EMR Module</p>
              <p style={S.brandSub}>Hospital Admin</p>
            </div>
          </div>
        </div>

        <div className="h-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => (
                <button
                  key={ii}
                  className="h-nav-btn"
                  style={{ ...S.navBtn, ...(item.active ? S.navBtnActive : {}) }}
                  onClick={item.action}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div style={S.sidebarFooter}>
          <button className="h-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══ MAIN ═══ */}
      <main style={S.main}>

        {/* Top bar */}
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>Hospital Dashboard</p>
            <p style={S.topBarSub}>Welcome back. Here's what's happening today.</p>
          </div>
          <div style={S.dateBadge}>
              <Calendar size={12} color={T.textMuted} />
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
        </div>

        {/* Body */}
        <div style={S.body}>
          <span style={S.pageLabel}>Clinical Overview</span>
          <h1 style={S.pageTitle}>Dashboard</h1>

          {/* Stats */}
          <div style={S.statsGrid}>
            {[
              { label: "Total Appointments", value: dashboardStats.totalAppointments, change: "+12%" },
              { label: "Pending", value: dashboardStats.pendingAppointments, change: "−3%" },
              { label: "Completed", value: dashboardStats.completedToday, change: "+8%" },
              { label: "Total Patients", value: dashboardStats.totalPatients, change: "+15%" },
            ].map((stat, i) => (
              <div key={i} className="h-stat" style={S.statCell}>
                <span style={S.statLabel}>{stat.label}</span>
                <p style={S.statNum}>{stat.value}</p>
                <span style={S.statChange}>{stat.change} this month</span>
              </div>
            ))}
          </div>

          {/* Charts */}
          {loadingData ? (
            <div style={S.loadingBox}>Loading appointment data…</div>
          ) : appointmentData ? (
            <div style={S.chartsGrid}>
              <AppointmentChart
                title="OP Appointments"
                data={opView === "week" ? appointmentData.opWeekData : appointmentData.opMonthData}
                viewType={opView}
                setViewType={setOpView}
              />
              <AppointmentChart
                title="IP Appointments"
                data={ipView === "week" ? appointmentData.ipWeekData : appointmentData.ipMonthData}
                viewType={ipView}
                setViewType={setIpView}
              />
            </div>
          ) : (
            <div style={S.loadingBox}>No appointment data available</div>
          )}

          {/* Patient list + Quick actions */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1px", border: `1px solid ${T.border}`, background: T.border, marginBottom: "2rem" }}>

            {/* Patient list */}
            <div style={{ background: T.bg }}>
              <div style={S.tableHeader}>
                <span style={S.tableHeaderTitle}>Patient List</span>
                <span style={S.tableHeaderMeta}>{patients.length} registered</span>
              </div>
              {loadingPatients ? (
                <div style={{ padding: "2rem", textAlign: "center", color: T.textMuted, fontSize: "0.78rem", fontWeight: 300 }}>
                  Loading patients…
                </div>
              ) : patients.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: T.textMuted, fontSize: "0.78rem", fontWeight: 300 }}>
                  No patients found
                </div>
              ) : (
                <div style={{ height: "320px", overflowY: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {["Name", "Gender", "Blood Group", "Phone"].map((h) => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {patients.map((patient, index) => (
                        <tr key={patient._id || patient.patient_id || index} className="h-patient-row">
                          <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{patient.name || "Unknown"}</td>
                          <td style={S.td}>{patient.gender || "—"}</td>
                          <td style={S.td}>{patient.blood_group || "—"}</td>
                          <td style={S.td}>{patient.phone_number || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div style={{ background: T.bgAlt, padding: "1.5rem" }}>
              <div style={S.tableHeader}>
                <span style={S.tableHeaderTitle}>Quick Actions</span>
              </div>
              <div style={{ padding: "1rem 0" }}>
                {[
                  { label: "Add New Doctor →", action: handleAddDoctor, primary: true },
                  { label: "Add New Nurse →", action: handleAddNurse, primary: true },
                  { label: "Manage Staff →", action: handleHospitalStaff, primary: true },
                  { label: "Schedule", action: () => {}, primary: false },
                  { label: "Generate Report", action: () => {}, primary: false },
                ].map((btn, i) => (
                  <button
                    key={i}
                    className={btn.primary ? "h-action-btn" : "h-outline-btn"}
                    style={btn.primary ? { ...S.actionBtn, width: "100%", marginBottom: "0.5rem", display: "block", padding: "0.55rem 1rem" }
                      : { ...S.outlineBtn }}
                    onClick={btn.action}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>
      <div style={{ marginTop: "20px" }}>
  <div
    style={{
      fontSize: "12px",
      fontWeight: 600,
      marginBottom: "8px",
      color: T.text,
    }}
  >
    Theme
  </div>

  <select
    value={selectedTheme}
    onChange={(e) => saveTheme(e.target.value)}
    style={{
      width: "100%",
      padding: "10px 12px",
      border: `1px solid ${T.border}`,
      borderRadius: "8px",
      background: T.bg,
      color: T.text,
      fontSize: "14px",
      outline: "none",
      cursor: "pointer",
    }}
  >
    {themeNames.map((theme) => (
      <option key={theme} value={theme}>
        {theme}
      </option>
    ))}
  </select>
</div>
    </div>
  );
}

export default HospitalDashboard;