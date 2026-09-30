import React, { useEffect, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Zap,
  Users,
  Home,
  UserPlus,
  Settings,
  LogOut,
  Dna,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Printer,
  Clock,
  Layers,
  Hash,
  PhoneCall,
  AlertCircle,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching HospitalDashboard) ─── */
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

/* ─── helpers ─── */
const fmtNum = (n) => Math.round(n || 0).toLocaleString("en-US");

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

/* Strip the redundant "documentation_documentation-" style prefixes off a
   feature key and turn it into a clean, readable label.
     documentation_documentation-treatment-plan      -> "Treatment Plan"
     documentation_documentation-medication-analysis -> "Medication Analysis"
     treatment_plan_agent                             -> "Treatment Plan Agent" */
const cleanFeatureName = (feature = "") => {
  let f = feature;
  f = f.replace(/^documentation_/, "");
  f = f.replace(/^documentation-/, "");
  f = f.replace(/[_-]+/g, " ").trim();
  if (!f) return feature;
  return f.replace(/\b\w/g, (c) => c.toUpperCase());
};

/* short model label, e.g. "openai/gpt-oss-20b" -> "gpt-oss-20b" */
const shortModel = (model = "") => model.split("/").pop();

/* ─── animated count-up hook ─── */
const useCountUp = (target, duration = 700) => {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setValue(from + (to - from) * ease);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
};

/* ─── simple bordered bar chart (SVG, no dependencies) ─── */
const BarChart = ({ data, valueKey, labelKey, color = T.text, formatValue = fmtNum, height = 220 }) => {
  const [hovered, setHovered] = useState(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    setProgress(0);
    const start = performance.now();
    const duration = 800;
    cancelAnimationFrame(rafRef.current);
    const animate = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      setProgress(ease);
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [data, valueKey]);

  if (!data.length) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center", fontSize: "0.72rem", color: T.textMuted }}>
        No data to chart yet.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d[valueKey]), 1) * 1.15;
  const barGap = 14;
  const barWidth = data.length ? Math.max(28, Math.min(64, 560 / data.length - barGap)) : 40;
  const chartW = data.length * (barWidth + barGap) + barGap;
  const padTop = 16;
  const padBottom = 34;
  const innerH = height - padTop - padBottom;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={Math.max(chartW, 100)} height={height} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line
            key={i}
            x1={0}
            x2={chartW}
            y1={padTop + innerH * (1 - t)}
            y2={padTop + innerH * (1 - t)}
            stroke={T.border}
            strokeWidth="1"
            strokeDasharray="4,4"
          />
        ))}
        {data.map((d, i) => {
          const v = d[valueKey];
          const h = (v / max) * innerH * progress;
          const x = barGap + i * (barWidth + barGap);
          const y = padTop + innerH - h;
          const isHover = hovered === i;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(h, 1)}
                fill={isHover ? T.textSec : color}
                style={{ cursor: "pointer", transition: "fill 0.15s, y 0.1s, height 0.1s" }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
              {isHover && (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="'Open Sans', sans-serif"
                  fill={T.text}
                >
                  {formatValue(v)}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={height - padBottom + 16}
                textAnchor="middle"
                fontSize="10"
                fontFamily="'Open Sans', sans-serif"
                fill={T.textMuted}
              >
                {d[labelKey].length > 10 ? `${d[labelKey].slice(0, 9)}…` : d[labelKey]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ─── donut chart for feature-mix across the hospital (SVG, animated) ─── */
const DonutChart = ({ data, size = 200, stroke = 26 }) => {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    setProgress(0);
    const start = performance.now();
    const duration = 900;
    cancelAnimationFrame(rafRef.current);
    const animate = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setProgress(ease);
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [data]);

  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shades = ["#000000", "#3a3a3a", "#6b6b6b", "#9a9a9a", "#c2c2c2", "#dedede"];

  let offsetAcc = 0;
  const [hovered, setHovered] = useState(null);

  if (!data.length) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center", fontSize: "0.72rem", color: T.textMuted }}>
        No feature usage yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
      <svg width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          <circle r={r} fill="none" stroke={T.border} strokeWidth={stroke} />
          {data.map((d, i) => {
            const frac = d.value / total;
            const dash = frac * c * progress;
            const gap = c - dash;
            const rotation = (offsetAcc / total) * 360;
            offsetAcc += d.value;
            const isHover = hovered === i;
            return (
              <circle
                key={d.label}
                r={r}
                fill="none"
                stroke={shades[i % shades.length]}
                strokeWidth={isHover ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${gap}`}
                transform={`rotate(${rotation})`}
                style={{ cursor: "pointer", transition: "stroke-width 0.15s" }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" fontSize="18" fontFamily="'Open Sans', sans-serif" fill={T.text}>
          {fmtNum(total)}
        </text>
        <text x="50%" y="58%" textAnchor="middle" fontSize="9" letterSpacing="1" fontFamily="'Open Sans', sans-serif" fill={T.textMuted}>
          TOTAL TOKENS
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "160px" }}>
        {data.map((d, i) => (
          <div
            key={d.label}
            style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.72rem", color: hovered === i ? T.text : T.textSec, cursor: "pointer" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span style={{ width: "10px", height: "10px", background: shades[i % shades.length], display: "inline-block", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <span style={{ color: T.textMuted }}>{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

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
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    zIndex: 100,
  },
  topBarLeft: { display: "flex", alignItems: "center", gap: "12px" },
  backBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.4rem 0.75rem",
    fontSize: "0.72rem",
    color: T.textSec,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
  },
  topBarTitle: { fontSize: "1rem", fontWeight: 400, margin: 0, letterSpacing: "-0.01em" },
  topBarSub: { fontSize: "0.72rem", color: T.textMuted, margin: "2px 0 0", fontWeight: 300 },
  printBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "0.5rem 0.9rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.72rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    letterSpacing: "0.05em",
  },
  body: { padding: "2rem", width: "100%" },
  sectionTitle: {
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: "0 0 1rem",
    display: "flex",
    alignItems: "center",
  },
  card: { border: `1px solid ${T.border}`, marginBottom: "2rem", background: T.bg },
  cardHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "10px",
  },
  cardBody: { padding: "1.5rem" },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1px",
    border: `1px solid ${T.border}`,
    background: T.border,
    marginBottom: "2rem",
  },
  statCell: { background: T.bg, padding: "1.25rem 1.5rem" },
  statNum: {
    fontSize: "1.6rem",
    fontWeight: 300,
    letterSpacing: "-0.03em",
    margin: 0,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  statLabel: {
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    marginTop: "0.35rem",
    display: "block",
  },
  toolsRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "1.25rem",
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border: `1px solid ${T.border}`,
    padding: "0.45rem 0.75rem",
    flex: "1 1 240px",
    minWidth: "200px",
  },
  searchInput: {
    border: "none",
    outline: "none",
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    width: "100%",
    background: "transparent",
  },
  sortSelect: {
    border: `1px solid ${T.border}`,
    padding: "0.5rem 0.75rem",
    fontSize: "0.72rem",
    fontFamily: "'Open Sans', sans-serif",
    color: T.textSec,
    background: T.bg,
    cursor: "pointer",
  },
  tableRow: {
    opacity: 0,
    animation: "ss-row-in 0.4s ease forwards",
  },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "760px" },
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
  docRow: { cursor: "pointer", transition: "background 0.15s" },
  featurePanel: {
    background: T.bgAlt,
    borderBottom: `1px solid ${T.border}`,
  },
  featureTable: { width: "100%", borderCollapse: "collapse" },
  featureTh: {
    textAlign: "left",
    padding: "0.5rem 1rem",
    fontSize: "0.58rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    whiteSpace: "nowrap",
  },
  featureTd: {
    padding: "0.55rem 1rem",
    fontSize: "0.73rem",
    fontWeight: 300,
    color: T.textSec,
    whiteSpace: "nowrap",
  },
  featureTag: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: T.textMuted,
    border: `1px solid ${T.border}`,
    padding: "0.08rem 0.4rem",
    display: "inline-block",
  },
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "0.75rem 1rem",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    fontSize: "0.7rem",
    color: T.textSec,
    marginBottom: "1.5rem",
  },
};

function SystemSettings() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const hospitalId = queryParams.get("hospital_id");

  const [doctors, setDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);

  const [usage, setUsage] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [usageError, setUsageError] = useState("");

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("tokens_desc");
  const [expandedId, setExpandedId] = useState(null);

  const printRef = useRef(null);

  const handleAddDoctor = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/register-doctor?hospital_id=${hospitalId}`); };
  const handleAddNurse = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/nurse-register?hospital_id=${hospitalId}`); };
  const handleHospitalStaff = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/hospital-admin-staff?hospital_id=${hospitalId}`); };
  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      });
      if (response.ok) { localStorage.clear(); window.location.href = "/login"; }
    } catch { }
  };

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: () => navigate(`/hospital-dashboard?hospital_id=${hospitalId}`) },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, action: handleAddDoctor },
        { label: "Add Nurse", icon: <UserPlus size={14} />, action: handleAddNurse },
        { label: "Manage Staff", icon: <UserPlus size={14} />, action: handleHospitalStaff },
      ],
    },
    {
      label: "Specialty",
      items: [
        {
          label: "Oncology Monitoring Dashboard",
          icon: <Dna size={14} />,
          action: () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/onco-dashboard?hospital_id=${hospitalId}`); },
        },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "System Settings", icon: <Settings size={14} />, active: true },
      ],
    },
  ];

  useEffect(() => {
    if (!hospitalId) return;
    fetchDoctors();
    fetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId]);

  const fetchDoctors = async () => {
    try {
      setLoadingDoctors(true);
      const response = await fetch(
        `${API_BASE_URL}hms/users/doctors/hospital/${hospitalId}/doctors`,
        { credentials: "include", headers: { "Content-Type": "application/json" } }
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      setDoctors(data.doctors || []);
    } catch {
      setDoctors([]);
    } finally {
      setLoadingDoctors(false);
    }
  };

  const fetchUsage = async () => {
    try {
      setLoadingUsage(true);
      setUsageError("");
      const response = await fetch(
        `${API_BASE_URL}hms/users/data/whatsapp/llm-usage/${hospitalId}`,
        { credentials: "include", headers: { "Content-Type": "application/json" } }
      );
      if (!response.ok) throw new Error();
      const payload = await response.json();
      if (payload.status !== "success") throw new Error();
      // payload.data is legitimately null when nothing has been recorded yet —
      // that's a valid empty state, not a fetch failure, so no error banner.
      setUsage(payload.data || null);
    } catch {
      setUsageError("Live usage data isn't reachable right now.");
      setUsage(null);
    } finally {
      setLoadingUsage(false);
    }
  };

  /* sys_user_id -> name lookup. The usage endpoint's doctor.doctor_id value
     actually matches this doctor record's sys_user_id field (e.g.
     "DOC-d8a42d17-..."), NOT its own doctor_id field (e.g. "uAYoWIqb0W").
     Normalizing to strings avoids type-mismatch misses. */
  const nameById = useMemo(() => {
    const map = {};
    doctors.forEach((d) => {
      const name = d.name || d.doctor_name || null;
      if (!name) return;
      if (d.sys_user_id) map[String(d.sys_user_id).trim()] = name;
    });
    return map;
  }, [doctors]);

  /* merge usage doctors with names + cleaned feature labels.
     Falls back to "Unknown Doctor" instead of ever showing the raw id. */
  const doctorUsage = useMemo(() => {
    if (!usage) return [];
    return (usage.doctors || []).map((d) => {
      const key = String(d.doctor_id ?? "").trim();
      return {
        ...d,
        name: nameById[key] || "Unknown Doctor",
        features: (d.features || [])
          .map((f) => ({ ...f, label: cleanFeatureName(f.feature) }))
          .sort((a, b) => b.total_tokens - a.total_tokens),
      };
    });
  }, [usage, nameById]);

  const filteredSorted = useMemo(() => {
    let rows = doctorUsage;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) => d.name.toLowerCase().includes(q));
    }
    const sorted = [...rows];
    switch (sortBy) {
      case "name_asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "tokens_desc":
        sorted.sort((a, b) => b.total_tokens - a.total_tokens);
        break;
      case "calls_desc":
        sorted.sort((a, b) => b.total_calls - a.total_calls);
        break;
      case "recent":
        sorted.sort((a, b) => new Date(b.last_used || 0) - new Date(a.last_used || 0));
        break;
      default:
        break;
    }
    return sorted;
  }, [doctorUsage, search, sortBy]);

  /* hospital-wide feature mix, for the donut chart */
  const featureMix = useMemo(() => {
    const totals = {};
    doctorUsage.forEach((d) => {
      d.features.forEach((f) => {
        totals[f.label] = (totals[f.label] || 0) + f.total_tokens;
      });
    });
    return Object.entries(totals)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [doctorUsage]);

  const hasUsage = !!usage && (usage.doctors || []).length > 0;

  const hospitalTotals = {
    calls: usage?.total_calls || 0,
    inputTokens: usage?.total_input_tokens || 0,
    outputTokens: usage?.total_output_tokens || 0,
    tokens: usage?.total_tokens || 0,
  };

  const animTokens = useCountUp(hospitalTotals.tokens);
  const animCalls = useCountUp(hospitalTotals.calls);
  const animInput = useCountUp(hospitalTotals.inputTokens);
  const animOutput = useCountUp(hospitalTotals.outputTokens);

  const handlePrint = () => window.print();

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        .ss-back:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .ss-print:hover { background: ${T.textSec} !important; border-color: ${T.textSec} !important; }
        .ss-print:active { transform: scale(0.96); }
        .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .h-menu-scroll::-webkit-scrollbar { display: none; }
        .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .ss-doc-row:hover { background: ${T.bgAlt}; }
        @keyframes ss-row-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ss-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ss-fade-in { animation: ss-fade-in 0.35s ease forwards; }
        .ss-print-report { display: none; }
        @media print {
          body * { visibility: hidden; }
          .ss-print-report, .ss-print-report * { visibility: visible; }
          .ss-print-report {
            display: block !important;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            padding: 24px;
            color: #000;
          }
          .ss-no-print { display: none !important; }
        }
      `}</style>

      {/* ═══ SIDEBAR ═══ */}
      <aside style={S.sidebar} className="ss-no-print">
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
      <main style={S.main} className="ss-no-print">

      <div style={S.topBar}>
        <div style={S.topBarLeft}>
          <button
            className="ss-back"
            style={S.backBtn}
            onClick={() => navigate(`/hospital-dashboard?hospital_id=${hospitalId}`)}
          >
            <ArrowLeft size={13} />
            Dashboard
          </button>
          <div>
            <p style={S.topBarTitle}>System Settings</p>
            <p style={S.topBarSub}>AI usage &amp; analytics for {usage?.hospital_name || "this hospital"}</p>
          </div>
        </div>
        <button className="ss-print" style={S.printBtn} onClick={handlePrint}>
          <Printer size={13} />
          Export PDF
        </button>
      </div>

      <div style={S.body}>

        {usageError && (
          <div style={S.banner}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: "1px" }} />
            <span>{usageError}</span>
          </div>
        )}

        {loadingUsage ? (
          <div style={{ ...S.card, padding: "2rem", textAlign: "center", color: T.textMuted, fontSize: "0.78rem" }}>
            Loading usage data…
          </div>
        ) : !hasUsage ? (
          <div style={{ ...S.card, padding: "3rem 1.5rem", textAlign: "center" }}>
            <Zap size={20} color={T.textMuted} style={{ marginBottom: "0.75rem" }} />
            <p style={{ margin: 0, fontSize: "0.85rem", color: T.text, fontWeight: 400 }}>
              No AI usage recorded yet
            </p>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: T.textMuted }}>
              Usage stats will appear here once doctors start using AI features.
            </p>
          </div>
        ) : (
          <>
            {/* Hospital totals */}
            <div style={S.statsGrid}>
              <div style={S.statCell}>
                <span style={S.statLabel}>Total Requests</span>
                <p style={S.statNum}>{fmtNum(animCalls)}</p>
              </div>
              <div style={S.statCell}>
                <span style={S.statLabel}>Total Tokens</span>
                <p style={S.statNum}>{fmtNum(animTokens)}</p>
              </div>
              <div style={S.statCell}>
                <span style={S.statLabel}>Input Tokens</span>
                <p style={S.statNum}>{fmtNum(animInput)}</p>
              </div>
              <div style={S.statCell}>
                <span style={S.statLabel}>Output Tokens</span>
                <p style={S.statNum}>{fmtNum(animOutput)}</p>
              </div>
            </div>

            {/* Charts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: T.border, border: `1px solid ${T.border}`, marginBottom: "2rem" }}>
              <div style={{ background: T.bg, padding: "1.5rem" }}>
                <span style={S.sectionTitle}>
                  <Zap size={12} style={{ marginRight: "6px" }} />
                  Tokens Used Per Doctor
                </span>
                <BarChart data={doctorUsage} valueKey="total_tokens" labelKey="name" color={T.text} formatValue={fmtNum} />
              </div>
              <div style={{ background: T.bg, padding: "1.5rem" }}>
                <span style={S.sectionTitle}>
                  <PhoneCall size={12} style={{ marginRight: "6px" }} />
                  Requests Per Doctor
                </span>
                <BarChart data={doctorUsage} valueKey="total_calls" labelKey="name" color={T.textSec} formatValue={fmtNum} />
              </div>
            </div>

            {/* Feature mix donut */}
            <div style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.sectionTitle}>
                  <Layers size={12} style={{ marginRight: "6px" }} />
                  Usage By Feature (Hospital-Wide)
                </span>
              </div>
              <div style={S.cardBody}>
                <DonutChart data={featureMix} />
              </div>
            </div>

            {/* Doctor table */}
            <div style={S.card}>
          <div style={S.cardHeader}>
            <span style={S.sectionTitle}>
              <Users size={12} style={{ marginRight: "6px" }} />
              Doctor Usage Breakdown
            </span>
            <span style={{ fontSize: "0.65rem", color: T.textMuted }}>
              Updated {fmtDate(usage?.updated_at)}
            </span>
          </div>
          <div style={S.cardBody}>
            <div style={S.toolsRow}>
              <div style={S.searchWrap}>
                <Search size={13} color={T.textMuted} />
                <input
                  style={S.searchInput}
                  placeholder="Search by doctor name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <ArrowUpDown size={13} color={T.textMuted} />
                <select
                  style={S.sortSelect}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="tokens_desc">Sort: Most tokens</option>
                  <option value="calls_desc">Sort: Most requests</option>
                  <option value="name_asc">Sort: Name (A–Z)</option>
                  <option value="recent">Sort: Recently active</option>
                </select>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}></th>
                    <th style={S.th}>Doctor</th>
                    <th style={S.th}>Requests</th>
                    <th style={S.th}>Input Tokens</th>
                    <th style={S.th}>Output Tokens</th>
                    <th style={S.th}>Total Tokens</th>
                    <th style={S.th}>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((d, i) => {
                    const isOpen = expandedId === d.doctor_id;
                    return (
                      <React.Fragment key={d.doctor_id}>
                        <tr
                          className="ss-doc-row"
                          style={{ ...S.docRow, ...S.tableRow, animationDelay: `${i * 40}ms` }}
                          onClick={() => setExpandedId(isOpen ? null : d.doctor_id)}
                        >
                          <td style={{ ...S.td, width: "28px" }}>
                            {isOpen ? <ChevronUp size={14} color={T.textMuted} /> : <ChevronDown size={14} color={T.textMuted} />}
                          </td>
                          <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{d.name}</td>
                          <td style={S.td}>{fmtNum(d.total_calls)}</td>
                          <td style={S.td}>{fmtNum(d.total_input_tokens)}</td>
                          <td style={S.td}>{fmtNum(d.total_output_tokens)}</td>
                          <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{fmtNum(d.total_tokens)}</td>
                          <td style={S.td}>
                            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                              <Clock size={11} color={T.textMuted} />
                              {fmtDate(d.last_used)}
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr style={S.featurePanel}>
                            <td colSpan={7} style={{ padding: 0 }}>
                              <div className="ss-fade-in" style={{ padding: "0.5rem 1rem 1rem 2.75rem" }}>
                                <table style={S.featureTable}>
                                  <thead>
                                    <tr>
                                      <th style={S.featureTh}>Feature</th>
                                      <th style={S.featureTh}>Model</th>
                                      <th style={S.featureTh}>Requests</th>
                                      <th style={S.featureTh}>Input</th>
                                      <th style={S.featureTh}>Output</th>
                                      <th style={S.featureTh}>Total</th>
                                      <th style={S.featureTh}>Last Used</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {d.features.map((f, fi) => (
                                      <tr key={fi}>
                                        <td style={{ ...S.featureTd, fontWeight: 400, color: T.text }}>{f.label}</td>
                                        <td style={S.featureTd}>
                                          <span style={S.featureTag}>{shortModel(f.model)}</span>
                                        </td>
                                        <td style={S.featureTd}>{fmtNum(f.calls)}</td>
                                        <td style={S.featureTd}>{fmtNum(f.input_tokens)}</td>
                                        <td style={S.featureTd}>{fmtNum(f.output_tokens)}</td>
                                        <td style={S.featureTd}>{fmtNum(f.total_tokens)}</td>
                                        <td style={S.featureTd}>{fmtDate(f.last_used)}</td>
                                      </tr>
                                    ))}
                                    {d.features.length === 0 && (
                                      <tr>
                                        <td style={S.featureTd} colSpan={7}>No feature-level usage recorded.</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {filteredSorted.length === 0 && !loadingUsage && (
                    <tr>
                      <td style={S.td} colSpan={7}>No doctors match your search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
      </main>

      {/* ═══ PRINT-ONLY REPORT ═══ */}
      <div className="ss-print-report" ref={printRef}>
        <h1 style={{ fontSize: "20px", margin: "0 0 4px", fontFamily: "'Open Sans', sans-serif" }}>
          {usage?.hospital_name || "Hospital"} — AI Usage Report
        </h1>
        <p style={{ fontSize: "11px", color: "#555", margin: "0 0 20px" }}>
          Generated {new Date().toLocaleString("en-US")} · Data as of {fmtDate(usage?.updated_at)}
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px", fontSize: "12px" }}>
          <tbody>
            <tr>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>Total Requests</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>{fmtNum(hospitalTotals.calls)}</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>Total Tokens</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>{fmtNum(hospitalTotals.tokens)}</td>
            </tr>
            <tr>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>Input Tokens</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>{fmtNum(hospitalTotals.inputTokens)}</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>Output Tokens</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 10px" }}>{fmtNum(hospitalTotals.outputTokens)}</td>
            </tr>
          </tbody>
        </table>

        <h2 style={{ fontSize: "14px", margin: "0 0 8px" }}>Per-Doctor Breakdown</h2>
        {filteredSorted.map((d) => (
          <div key={d.doctor_id} style={{ marginBottom: "16px", pageBreakInside: "avoid" }}>
            <p style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 4px" }}>
              {d.name} — {fmtNum(d.total_tokens)} tokens · {fmtNum(d.total_calls)} requests · last active {fmtDate(d.last_used)}
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr>
                  {["Feature", "Model", "Requests", "Input", "Output", "Total", "Last Used"].map((h) => (
                    <th key={h} style={{ border: "1px solid #ccc", padding: "4px 8px", textAlign: "left", background: "#f2f2f2" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.features.map((f, fi) => (
                  <tr key={fi}>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{f.label}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{shortModel(f.model)}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{fmtNum(f.calls)}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{fmtNum(f.input_tokens)}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{fmtNum(f.output_tokens)}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{fmtNum(f.total_tokens)}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{fmtDate(f.last_used)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SystemSettings;