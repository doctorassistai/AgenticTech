import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Home, Calendar, LogOut, Search, Bell, Activity,
  Radiation, Syringe, Scissors, ClipboardList, AlertCircle,
  ChevronDown, ChevronRight, Pill, ShieldAlert, Clock,
  Droplet, MapPin, CheckCircle2, XCircle, Target, Layers,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching other components) ─── */
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

// Monochrome scale used for chart segments, darkest first
const GRAYSCALE = ["#000000", "#3d3d3d", "#666666", "#8f8f8f", "#b3b3b3", "#d6d6d6"];

const SIDEBAR_WIDTH = "248px";

// How many chemotherapy-record requests are allowed in flight at once.
// Keeps the background sync fast without hammering the backend when a
// hospital has hundreds of patients.
const CHEMO_FETCH_CONCURRENCY = 6;

/* ─── STYLES (matching other components) ─── */
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

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1rem",
    marginBottom: "1.5rem",
  },

  statCard: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "1.25rem",
  },

  statLabel: {
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    fontWeight: 400,
    marginBottom: "0.5rem",
  },

  statValue: {
    fontSize: "1.6rem",
    fontWeight: 300,
    color: T.text,
    letterSpacing: "-0.02em",
  },

  statSub: {
    fontSize: "0.68rem",
    color: T.textMuted,
    marginTop: "0.25rem",
    fontWeight: 300,
  },

  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
    marginBottom: "1.5rem",
  },

  panel: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "1.5rem",
  },

  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1.25rem",
  },

  panelTitle: {
    fontSize: "0.72rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    margin: 0,
  },

  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.74rem",
    color: T.textSec,
    marginBottom: "0.5rem",
  },

  legendSwatch: {
    width: "9px",
    height: "9px",
    borderRadius: "1px",
    flexShrink: 0,
  },

  legendValue: {
    marginLeft: "auto",
    color: T.textMuted,
    fontSize: "0.7rem",
  },

  barRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "0.7rem",
  },

  barLabel: {
    fontSize: "0.72rem",
    color: T.textSec,
    width: "64px",
    flexShrink: 0,
  },

  barTrack: {
    flex: 1,
    height: "8px",
    background: T.bgTert,
    borderRadius: "2px",
    overflow: "hidden",
  },

  barValue: {
    fontSize: "0.72rem",
    color: T.textMuted,
    width: "28px",
    textAlign: "right",
    flexShrink: 0,
  },

  tableContainer: {
    border: `1px solid ${T.border}`,
    background: T.bg,
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
  },

  th: {
    textAlign: "left",
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    fontWeight: 600,
    padding: "0.85rem 1.25rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
  },

  td: {
    padding: "0.75rem 1.25rem",
    fontSize: "0.8rem",
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
  },

  tdName: {
    color: T.text,
    fontWeight: 400,
  },

  badge: {
    display: "inline-block",
    padding: "0.2rem 0.55rem",
    fontSize: "0.68rem",
    border: `1px solid ${T.border}`,
    borderRadius: "2px",
    color: T.textSec,
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

  errorBox: {
    padding: "1.25rem 1.5rem",
    border: `1px solid ${T.border}`,
    marginBottom: "1.5rem",
    background: T.bgAlt,
    color: T.text,
    fontSize: "0.8rem",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },

  emptyBox: {
    padding: "3.5rem 2rem",
    textAlign: "center",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    color: T.textMuted,
    fontSize: "0.82rem",
    fontWeight: 300,
  },

  /* ─── chemo / surgical shared additions ─── */

  syncBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "0.6rem 0.9rem",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    marginBottom: "1.5rem",
    fontSize: "0.72rem",
    color: T.textMuted,
  },

  syncTrack: {
    flex: 1,
    height: "4px",
    background: T.bgTert,
    borderRadius: "2px",
    overflow: "hidden",
  },

  syncFill: {
    height: "100%",
    background: T.text,
    transition: "width 0.25s ease",
  },

  progressTrack: {
    width: "100%",
    height: "6px",
    background: T.bgTert,
    borderRadius: "3px",
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    borderRadius: "3px",
    transition: "width 0.3s ease",
  },

  patientCard: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    marginBottom: "0.75rem",
  },

  patientCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.9rem 1.1rem",
    cursor: "pointer",
    gap: "1rem",
    flexWrap: "wrap",
  },

  patientCardName: {
    fontSize: "0.85rem",
    fontWeight: 400,
    color: T.text,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },

  patientCardMeta: {
    fontSize: "0.7rem",
    color: T.textMuted,
    marginTop: "2px",
  },

  patientCardStats: {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
  },

  miniStat: {
    textAlign: "right",
  },

  miniStatValue: {
    fontSize: "0.8rem",
    color: T.text,
    fontWeight: 400,
  },

  miniStatLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: T.textMuted,
  },

  cycleTrack: {
    width: "140px",
  },

  recordDetail: {
    borderTop: `1px solid ${T.border}`,
    padding: "1rem 1.1rem 1.2rem",
    background: T.bgAlt,
  },

  recordBlock: {
    marginBottom: "1rem",
    paddingBottom: "1rem",
    borderBottom: `1px dashed ${T.border}`,
  },

  recordBlockLast: {
    marginBottom: 0,
    paddingBottom: 0,
    borderBottom: "none",
  },

  recordBlockHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.6rem",
    flexWrap: "wrap",
    gap: "8px",
  },

  recordBlockTitle: {
    fontSize: "0.76rem",
    fontWeight: 400,
    color: T.text,
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },

  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "0.75rem",
    marginBottom: "0.75rem",
  },

  detailItem: {
    fontSize: "0.72rem",
  },

  detailLabel: {
    color: T.textMuted,
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: "2px",
  },

  detailValue: {
    color: T.textSec,
  },

  drugChipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "0.4rem",
  },

  drugChip: {
    fontSize: "0.68rem",
    padding: "0.2rem 0.55rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.textSec,
    borderRadius: "2px",
  },

  flagChip: {
    fontSize: "0.68rem",
    padding: "0.2rem 0.55rem",
    border: `1px solid ${T.textMuted}`,
    background: T.bg,
    color: T.text,
    borderRadius: "2px",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },

  okChip: {
    fontSize: "0.68rem",
    padding: "0.2rem 0.55rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.textMuted,
    borderRadius: "2px",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },

  cycleStatusRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    marginTop: "0.5rem",
  },

  cycleDot: {
    width: "22px",
    height: "22px",
    borderRadius: "3px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.6rem",
    fontWeight: 600,
    flexShrink: 0,
  },
};

/* ─── small chart primitives, monochrome ─── */

function Donut({ segments, size = 132, thickness = 18 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Segments draw in from zero on mount (and whenever the underlying
  // totals change, e.g. as background sync fills in more records) rather
  // than snapping straight to their final length.
  const segKey = segments.map((s) => `${s.label}:${s.value}`).join("|");
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0);
    const t = setTimeout(() => setProgress(1), 60);
    return () => clearTimeout(t);
  }, [segKey]);

  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={T.bgTert}
          strokeWidth={thickness}
        />
        {segments.map((s, i) => {
          const fullLength = (s.value / total) * circumference;
          const length = fullLength * progress;
          const dasharray = `${length} ${circumference - length}`;
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={dasharray}
              strokeDashoffset={-offset}
              style={{ transition: `stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.08}s` }}
            />
          );
          offset += fullLength;
          return el;
        })}
      </g>
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: "1.1rem", fill: T.text, fontFamily: "'Open Sans', sans-serif" }}
      >
        {total}
      </text>
    </svg>
  );
}

function BarList({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  // Bars grow in from zero, staggered left-to-right, on mount and again
  // whenever the underlying values change (e.g. as records stream in
  // during background sync) rather than jumping straight to full width.
  const dataKey = data.map((d) => `${d.label}:${d.value}`).join("|");
  const [animatedValues, setAnimatedValues] = useState(() => data.map(() => 0));

  useEffect(() => {
    setAnimatedValues(data.map(() => 0));
    const timers = data.map((d, i) =>
      setTimeout(() => {
        setAnimatedValues((prev) => {
          const next = [...prev];
          next[i] = d.value;
          return next;
        });
      }, 60 + i * 80)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  return (
    <div>
      {data.map((d, i) => (
        <div key={d.label} style={S.barRow}>
          <span style={S.barLabel}>{d.label}</span>
          <div style={S.barTrack}>
            <div
              style={{
                width: `${((animatedValues[i] || 0) / max) * 100}%`,
                height: "100%",
                background: GRAYSCALE[i % GRAYSCALE.length],
                borderRadius: "2px",
                transition: "width 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </div>
          <span style={S.barValue}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

/* Small inline progress bar used for per-patient cycle completion.
   Fills from zero to its target value on mount rather than snapping
   straight to the final width. */
function ProgressBar({ value, max, color = T.text, width = "140px" }) {
  const [animatedValue, setAnimatedValue] = useState(0);
  useEffect(() => {
    setAnimatedValue(0);
    const t = setTimeout(() => setAnimatedValue(value), 60);
    return () => clearTimeout(t);
  }, [value, max]);

  const pct = max > 0 ? Math.min((animatedValue / max) * 100, 100) : 0;
  return (
    <div style={{ ...S.progressTrack, width }}>
      <div
        style={{
          ...S.progressFill,
          width: `${pct}%`,
          background: color,
          transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}

/* Row of dots representing each planned cycle: filled = completed,
   ringed = current/pending, empty = not yet reached */
function CycleDots({ planned, completed, current }) {
  if (!planned || planned <= 0) return null;
  const dots = [];
  for (let i = 1; i <= planned; i++) {
    let bg = T.bgTert;
    let color = T.textMuted;
    let border = `1px solid ${T.border}`;
    if (i <= completed) {
      bg = T.text;
      color = "#fff";
      border = `1px solid ${T.text}`;
    } else if (i === current) {
      bg = T.bg;
      color = T.text;
      border = `1px solid ${T.text}`;
    }
    dots.push(
      <div
        key={i}
        className="h-animate-in"
        style={{
          ...S.cycleDot,
          background: bg,
          color,
          border,
          animationDelay: `${Math.min(i * 0.03, 0.6)}s`,
        }}
        title={`Cycle ${i}`}
      >
        {i}
      </div>
    );
  }
  return <div style={S.cycleStatusRow}>{dots}</div>;
}

/* ─── data helpers ─── */

/** Run `worker` over `items` with a max of `limit` in flight at once,
 * invoking `onEach` as soon as each individual result lands so the UI
 * can render progressively instead of waiting for the whole batch. */
async function runWithConcurrency(items, worker, limit, onEach) {
  let cursor = 0;
  const laneCount = Math.max(1, Math.min(limit, items.length));
  const lanes = new Array(laneCount).fill(null).map(async () => {
    while (cursor < items.length) {
      const current = cursor++;
      const item = items[current];
      try {
        const result = await worker(item);
        onEach(item, result, null);
      } catch (err) {
        onEach(item, null, err);
      }
    }
  });
  await Promise.all(lanes);
}

function normalizeGender(g) {
  if (!g) return "Unknown";
  const v = g.trim().toLowerCase();
  if (v === "m" || v === "male") return "Male";
  if (v === "f" || v === "female") return "Female";
  return g.trim();
}

function titleCase(str) {
  if (!str) return "";
  return str
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function yesNo(v) {
  if (v === true) return true;
  if (typeof v === "string") return v.trim().toLowerCase() === "yes";
  return false;
}

/** Collapse the two chemotherapy-record shapes seen from the backend
 * (a full workflow record with a `data` wrapper, and a lighter
 * protocol-assignment record with `regimen` at the top level) into one
 * consistent shape the UI can render without branching everywhere. */
function normalizeChemoRecord(rec) {
  const data = rec.data || {};
  const summary = data.summary || {};
  const cyclesObj = data.cycles || {};
  const cycleKeys = Object.keys(cyclesObj).sort((a, b) => Number(a) - Number(b));
  const firstCycle = cycleKeys.length ? cyclesObj[cycleKeys[0]] : {};

  // regimen can live at rec.regimen (protocol-assignment record) or
  // nested under the first cycle of a full workflow record
  const regimen = rec.regimen || firstCycle?.regimen || {};

  const treatment = rec.treatment || {};

  const plannedCycles =
    treatment.plannedCycles ?? regimen.plannedCycles ?? null;
  const completedCycles = treatment.completedCycles ?? 0;
  const currentCycle = treatment.currentCycle ?? (cycleKeys.length ? Number(cycleKeys[cycleKeys.length - 1]) : null);
  const pendingCycles =
    plannedCycles != null ? Math.max(plannedCycles - completedCycles, 0) : null;

  const drugs =
    (regimen.drugSchedule && regimen.drugSchedule.length && regimen.drugSchedule) ||
    (regimen.drugs && regimen.drugs.filter((d) => d.name)) ||
    [];

  const patientName =
    [summary.firstName, summary.lastName].filter(Boolean).join(" ").trim() || null;

  return {
    id: rec._id,
    treatmentId: rec.treatmentId || null,
    doctorId: rec.doctorId || rec.doctor_id || "",
    recordStatus: rec.status || "",
    updatedAt: rec.updatedAt || null,

    patientName,
    patientAge: summary.age || null,
    patientSex: summary.sex || null,

    diagnosis: data.assessment?.diagnosis || "",
    tumorBoardQuestion: data.assessment?.tbQuestion || "",
    tumorBoardScheduleDate: data.assessment?.tbScheduleDate || "",

    protocolName: regimen.selectedProtocol || regimen.protocolName || "Unspecified protocol",
    treatmentIntent: regimen.treatmentIntent || "",
    protocolDetails: regimen.protocolDetails || "",
    startDate: regimen.startDate || "",
    daysBetweenCycles: regimen.daysBetweenCycles || null,
    drugs,
    safetyFlags: regimen.safetyFlags || [],
    reasonForChange: regimen.reasonForChange || "",

    plannedCycles,
    completedCycles,
    currentCycle,
    pendingCycles,
    treatmentStatus: treatment.status || rec.status || "",
    treatmentCompleted: !!treatment.treatmentCompleted,
  };
}

/** Normalize a surgical-oncology record (booking + intra-op anaesthesia
 * record + operative management note + post-op outcome) into one flat
 * shape the UI can render without knowing about the underlying booking /
 * management / post_op split. */
function normalizeSurgicalRecord(rec) {
  const booking = rec.booking || {};
  const management = rec.management || {};
  const postOp = rec.post_op || {};

  const surgeryTypes =
    (booking.surgeryType && booking.surgeryType.length && booking.surgeryType) ||
    (management.typeOfSurgery && management.typeOfSurgery.length && management.typeOfSurgery) ||
    [];

  const approach =
    (booking.approach && booking.approach.length && booking.approach) ||
    (management.approach ? [management.approach] : []);

  const stagingParts = [management.stagingT, management.stagingN, management.stagingM].filter(Boolean);

  const bloodLossNum = management.bloodLoss !== undefined && management.bloodLoss !== ""
    ? Number(management.bloodLoss)
    : null;

  return {
    id: rec._id,
    patientId: rec.patient_id || "",
    doctorId: rec.doctor_id || "",
    bookingId: rec.booking_id || "",
    createdAt: rec.created_at || null,
    updatedAt: rec.updated_at || null,

    patientName: booking.patientName || "",
    ageSex: booking.ageSex || "",
    wardBed: booking.wardBed || management.wardBed || "",
    unitName: booking.unitName || management.unitName || "",
    treatingDoctor: booking.treatingDoctor || "",

    status: rec.status || booking.bookingStatus || "Unknown",
    surgeryFinished: !!rec.surgery_finished,

    procedureName: booking.procedureName || management.nameOfProcedure || "Unspecified procedure",
    surgeryTypes,
    laterality: booking.laterality || "",
    approach,
    duration: booking.duration || "",
    surgeryDate: booking.surgeryDate || management.operationStartDate || "",
    startTime: booking.startTime || management.operationStartTime || "",
    otRoom: booking.otRoom || "",
    asaClass: booking.asaClass || "",
    caseStatus: booking.caseStatus || "",

    preOpDiagnosis: booking.preOpDiagnosis || management.preOperativeDiagnosis || "",
    postOpDiagnosis: management.postOperativeDiagnosis || "",
    findings: management.findings || "",
    procedureDetails: management.procedureDetails || "",
    primarySurgeon: management.primarySurgeon || booking.surgeonName || "",

    woundClass: management.woundClass || [],
    bloodLoss: bloodLossNum,
    stagingT: management.stagingT || "",
    stagingN: management.stagingN || "",
    stagingM: management.stagingM || "",
    staging: stagingParts.length ? stagingParts.join("") : "",
    resection: management.resection || "",
    classification: management.classification || "",
    frozenSection: management.frozen || "",
    surgicalComplications: management.complications || "",

    postOpHasComplications: yesNo(postOp.hasComplications),
    postOpComplications: postOp.complications || [],
    postOpDescription: postOp.description || "",
    clavienDindo: postOp.clavienDindo || "",
    readmit30: yesNo(postOp.readmit30),
    mortality30: yesNo(postOp.mortality30),
    readmit90: yesNo(postOp.readmit90),
    mortality90: yesNo(postOp.mortality90),
  };
}

/** Normalize one radiotherapy course into a flat shape for the UI.
 * A "course" here is one `radiotherapy_records` workflow entry (has a
 * `treatmentId` and a `data` payload) merged with its matching
 * `rt_record_details` entry (same `treatmentId`), which carries the EBRT
 * delivery/completion/adverse-event data. Fractions are the primary
 * metric: total planned fractions come from the treatment/simulation
 * data, delivered fractions are derived from the daily image-guidance
 * (CBCT) sessions logged under `imaging.imagingShifts`, de-duplicated by
 * session number since the same session can appear more than once in
 * the raw data. */
function normalizeRadiationRecord(rec, detailsByTreatmentId) {
  const data = rec.data || {};
  const treatment = data.treatment || {};
  const intent = data.intent || {};
  const setup = data.setup || {};
  const simulation = data.simulation || {};
  const imaging = data.imaging || {};
  const extracted = rec.extracted_treatment || {};

  const detail = detailsByTreatmentId[rec.treatmentId] || {};
  const ebrt = detail.ebrt || {};
  const simSet = (ebrt.simulationSets && ebrt.simulationSets[0]) || {};
  const procedure = ebrt.procedure || {};
  const completion = ebrt.completion || {};
  const interruption = ebrt.interruption || {};
  const followUp = ebrt.followUp || {};
  const adverseEvents = (ebrt.adverseEvents || []).filter((e) => e.event);

  const totalFractions =
    Number(treatment.numFractions || simSet.totalFractions || 0) || 0;

  // De-dupe CBCT/imaging-verification sessions by session number so a
  // repeated log entry for the same day doesn't inflate the fraction count.
  const sessionNumbers = new Set(
    (imaging.imagingShifts || [])
      .map((s) => s.session)
      .filter((s) => s !== undefined && s !== null && s !== "")
  );
  const completedFractions = sessionNumbers.size;
  const pendingFractions =
    totalFractions > 0 ? Math.max(totalFractions - completedFractions, 0) : null;
  const fractionProgressPct =
    totalFractions > 0
      ? Math.min(Math.round((completedFractions / totalFractions) * 100), 100)
      : 0;

  return {
    id: rec._id,
    treatmentId: rec.treatmentId || null,
    status: detail.status || rec.status || "",
    updatedAt: rec.updatedAt || null,

    treatmentIntent: extracted["Treatment Intent"] || intent.treatmentIntent || "",
    rtRole: extracted.rtRole || "",
    rtSetting: extracted.rtSetting || "",
    rtType: extracted.rtType || "",

    treatmentSite: treatment.treatmentSite || "",
    treatmentType: treatment.treatmentType || "",
    treatmentMachine: treatment.treatmentMachine || simSet.machine || "",
    technique: procedure.technique || "",
    systemicTherapy: procedure.systemicTherapy || "",

    totalDose: treatment.totalDose ?? (simSet.totalDose ? Number(simSet.totalDose) : null),
    dosePerFraction: treatment.dosePerFraction || simSet.dosePerFrac || null,
    totalFractions,
    completedFractions,
    pendingFractions,
    fractionProgressPct,
    treatmentDuration: treatment.treatmentDuration || null,

    rationaleForTreatment: intent.rationaleForTreatment || "",
    precautions: intent.precautions || "",
    emergencyInstructions: intent.emergencyInstructions || "",
    targetVolumes: intent.targetVolumes || [],
    organsAtRisk: intent.organsAtRisk || [],

    simulationDate: simulation.simulationDate || "",
    simulationType: simulation.simulationType || "",
    positioning: setup.positioning || simSet.patientPos || "",
    immobilization:
      (setup.immobilizationDevices && setup.immobilizationDevices[0]?.deviceType) ||
      simSet.immobilisation ||
      "",
    verificationMethod: setup.setupVerificationMethod || imaging.verificationMethod || "",

    peerReview: simSet.peerReview || "",

    txGap: completion.txGap || "No",
    gapReason: completion.gapReason || "",
    rtCompletion: completion.rtCompletion || "",
    interruptReason: interruption.interruptReason || "",

    adverseEvents,
    followUpDate: followUp.date || "",
    followUpPlan: followUp.postCompletionPlan || "",
  };
}

/** Flatten one patient's `/radiation-oncology/patient/:id` response
 * (radiotherapy_records + rt_record_details, joined on treatmentId) into
 * an array of normalized courses. */
function normalizeRadiationResponse(json) {
  const rtRecords = json.radiotherapy_records || [];
  const rtDetails = json.rt_record_details || [];

  const detailsByTreatmentId = {};
  rtDetails.forEach((d) => {
    if (d.treatmentId) detailsByTreatmentId[d.treatmentId] = d;
  });

  // Only workflow entries that actually carry treatment data (i.e. have
  // been through planning) are worth showing as a course.
  return rtRecords
    .filter((r) => r.data && r.treatmentId)
    .map((r) => normalizeRadiationRecord(r, detailsByTreatmentId));
}

function statusColor(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("complete")) return T.text;
  if (s.includes("progress") || s.includes("active")) return "#555555";
  if (s.includes("hold") || s.includes("postpone") || s.includes("pending")) return "#999999";
  return T.textMuted;
}

function OncologyDashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const hospitalId = searchParams.get("hospital_id");

  const [activeTab, setActiveTab] = useState("overview");
const bodyScrollRef = useRef(null);

// Whenever the active section changes, jump back to the top rather than
// preserving whatever scroll position the previous section was left at.
useEffect(() => {
  if (bodyScrollRef.current) {
    bodyScrollRef.current.scrollTop = 0;
  }
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}, [activeTab]);
  const [patients, setPatients] = useState([]);
  const [totalPatients, setTotalPatients] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [chemoQuery, setChemoQuery] = useState("");
  const [surgicalQuery, setSurgicalQuery] = useState("");
  const [radiationQuery, setRadiationQuery] = useState("");
  const [expandedPatientId, setExpandedPatientId] = useState(null);
  const [expandedSurgicalPatientId, setExpandedSurgicalPatientId] = useState(null);
  const [expandedRadiationPatientId, setExpandedRadiationPatientId] = useState(null);

  // patient_id -> array of normalized chemo records (or [] once resolved
  // with no data). Populated progressively in the background.
  const [chemoByPatient, setChemoByPatient] = useState({});
  const [chemoSync, setChemoSync] = useState({ done: 0, total: 0, active: false, complete: false });
  const chemoSyncStarted = useRef(false);

  // patient_id -> array of normalized surgical-oncology records. Unlike
  // chemo, this comes back from a single hospital-wide endpoint, so there's
  // no per-patient fan-out — one request, then group by patient_id.
  const [surgicalByPatient, setSurgicalByPatient] = useState({});
  const [surgicalLoading, setSurgicalLoading] = useState(false);
  const [surgicalError, setSurgicalError] = useState(null);
  const [surgicalLoaded, setSurgicalLoaded] = useState(false);
  const surgicalFetchStarted = useRef(false);

  // patient_id -> array of normalized radiation-oncology courses. Same
  // per-patient fan-out shape as chemo (one request per patient, capped
  // concurrency), since the backend only exposes a per-patient endpoint
  // for this department.
  const [radiationByPatient, setRadiationByPatient] = useState({});
  const [radiationSync, setRadiationSync] = useState({ done: 0, total: 0, active: false, complete: false });
  const radiationSyncStarted = useRef(false);

  useEffect(() => {
    if (!hospitalId) {
      setError("Hospital ID missing in URL");
      setIsLoading(false);
      return;
    }

    const fetchPatients = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}hms/users/data/context/patients/${hospitalId}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          throw new Error("Failed to load patient records");
        }

        const result = await response.json();
        setPatients(result.patients || []);
        setTotalPatients(result.total_patients ?? (result.patients || []).length);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPatients();
  }, [hospitalId]);

  /* ─── background sync of chemotherapy records ───
     Kicks off as soon as the patient list is available, independent of
     which tab is active, so switching into Medical Oncology never blocks
     on a fresh network round trip. Requests are capped at
     CHEMO_FETCH_CONCURRENCY in flight and each patient's data is
     committed to state the moment it arrives, so the UI fills in
     progressively rather than jumping all at once. */
  const fetchChemoForPatient = useCallback(async (patientId) => {
    const res = await fetch(
      `${API_BASE_URL}hms/users/data/context/chemotherapy-records/patient/${patientId}`,
      { credentials: "include" }
    );
    if (!res.ok) {
      // No chemo history for this patient is a normal, non-fatal outcome
      if (res.status === 404) return [];
      throw new Error(`chemo fetch failed (${res.status})`);
    }
    const json = await res.json();
    return (json.chemotherapy_records || []).map(normalizeChemoRecord);
  }, []);

  useEffect(() => {
    if (!patients.length || chemoSyncStarted.current) return;
    chemoSyncStarted.current = true;

    setChemoSync({ done: 0, total: patients.length, active: true, complete: false });

    runWithConcurrency(
      patients,
      (p) => fetchChemoForPatient(p.patient_id),
      CHEMO_FETCH_CONCURRENCY,
      (patient, result, err) => {
        setChemoByPatient((prev) => ({
          ...prev,
          [patient.patient_id]: err ? [] : result,
        }));
        setChemoSync((prev) => ({ ...prev, done: prev.done + 1 }));
      }
    ).then(() => {
      setChemoSync((prev) => ({ ...prev, active: false, complete: true }));
    });
  }, [patients, fetchChemoForPatient]);

  /* ─── single-shot fetch of surgical-oncology records ───
     This endpoint returns every surgical-oncology record for the whole
     hospital in one response, so — unlike chemo — there's no per-patient
     fan-out or concurrency limiter needed. It kicks off as soon as we
     have a hospitalId, independent of the active tab, and the results are
     grouped by patient_id once so the Surgical Oncology tab can render
     immediately when the person switches to it. */
  useEffect(() => {
    if (!hospitalId || surgicalFetchStarted.current) return;
    surgicalFetchStarted.current = true;

    const fetchSurgicalRecords = async () => {
      setSurgicalLoading(true);
      setSurgicalError(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}hms/users/data/context/surgical-oncology/hospital/${hospitalId}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          throw new Error("Failed to load surgical oncology records");
        }

        const result = await response.json();

        // Backend shape isn't fully pinned down yet — accept whichever
        // wrapper key comes back, or a bare array.
        const rawRecords =
          result.surgical_oncology_records ||
          result.surgical_records ||
          result.records ||
          result.data ||
          (Array.isArray(result) ? result : []);

        const normalized = rawRecords.map(normalizeSurgicalRecord);

        const grouped = {};
        normalized.forEach((r) => {
          if (!r.patientId) return;
          if (!grouped[r.patientId]) grouped[r.patientId] = [];
          grouped[r.patientId].push(r);
        });

        setSurgicalByPatient(grouped);
      } catch (err) {
        setSurgicalError(err.message);
      } finally {
        setSurgicalLoading(false);
        setSurgicalLoaded(true);
      }
    };

    fetchSurgicalRecords();
  }, [hospitalId]);

  /* ─── background sync of radiation-oncology records ───
     Same fan-out pattern as chemo: one request per patient (the backend
     only exposes a per-patient endpoint here), capped at
     CHEMO_FETCH_CONCURRENCY in flight, committing each patient's courses
     to state as soon as they arrive so the Radiation Oncology tab fills
     in progressively. */
  const fetchRadiationForPatient = useCallback(async (patientId) => {
    const res = await fetch(
      `${API_BASE_URL}hms/users/data/context/radiation-oncology/patient/${patientId}`,
      { credentials: "include" }
    );
    if (!res.ok) {
      // No radiation history for this patient is a normal, non-fatal outcome
      if (res.status === 404) return [];
      throw new Error(`radiation fetch failed (${res.status})`);
    }
    const json = await res.json();
    return normalizeRadiationResponse(json);
  }, []);

  useEffect(() => {
    if (!patients.length || radiationSyncStarted.current) return;
    radiationSyncStarted.current = true;

    setRadiationSync({ done: 0, total: patients.length, active: true, complete: false });

    runWithConcurrency(
      patients,
      (p) => fetchRadiationForPatient(p.patient_id),
      CHEMO_FETCH_CONCURRENCY,
      (patient, result, err) => {
        setRadiationByPatient((prev) => ({
          ...prev,
          [patient.patient_id]: err ? [] : result,
        }));
        setRadiationSync((prev) => ({ ...prev, done: prev.done + 1 }));
      }
    ).then(() => {
      setRadiationSync((prev) => ({ ...prev, active: false, complete: true }));
    });
  }, [patients, fetchRadiationForPatient]);

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (response.ok) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleDashboard = () => {
    if (!hospitalId) return;
    navigate(`/hospital-dashboard?hospital_id=${hospitalId}`);
  };

  /* ─── derived, dynamic stats from live patient data (overview tab) ─── */
  const stats = useMemo(() => {
    const genderCounts = {};
    const bloodGroupCounts = {};
    const ageBuckets = { "0-18": 0, "19-35": 0, "36-50": 0, "51-65": 0, "66+": 0, "Unknown": 0 };
    let ageSum = 0;
    let ageKnownCount = 0;

    patients.forEach((p) => {
      const gender = normalizeGender(p.gender);
      genderCounts[gender] = (genderCounts[gender] || 0) + 1;

      const bg = p.blood_group && p.blood_group.trim() !== "" ? p.blood_group : "Unknown";
      bloodGroupCounts[bg] = (bloodGroupCounts[bg] || 0) + 1;

      const age = p.age;
      if (!age || age <= 0) {
        ageBuckets["Unknown"] += 1;
      } else {
        ageSum += age;
        ageKnownCount += 1;
        if (age <= 18) ageBuckets["0-18"] += 1;
        else if (age <= 35) ageBuckets["19-35"] += 1;
        else if (age <= 50) ageBuckets["36-50"] += 1;
        else if (age <= 65) ageBuckets["51-65"] += 1;
        else ageBuckets["66+"] += 1;
      }
    });

    const genderSegments = ["Male", "Female"]
      .filter((label) => genderCounts[label] > 0)
      .map((label, i) => ({
        label,
        value: genderCounts[label],
        color: GRAYSCALE[i % GRAYSCALE.length],
      }));

    const bloodGroupBars = Object.entries(bloodGroupCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    const ageBars = Object.entries(ageBuckets)
      .filter(([, value]) => value > 0)
      .map(([label, value]) => ({ label, value }));

    const avgAge = ageKnownCount > 0 ? Math.round(ageSum / ageKnownCount) : 0;
    const topBloodGroup = bloodGroupBars.length ? bloodGroupBars[0].label : "—";
    const maleCount = genderCounts["Male"] || 0;
    const femaleCount = genderCounts["Female"] || 0;

    return { genderSegments, bloodGroupBars, ageBars, avgAge, topBloodGroup, maleCount, femaleCount };
  }, [patients]);

  const filteredPatients = useMemo(() => {
    if (!query.trim()) return patients;
    const q = query.toLowerCase();
    return patients.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.patient_id || "").toLowerCase().includes(q)
    );
  }, [patients, query]);

  /* ─── hospital-wide chemotherapy aggregates (medical oncology tab) ───
     Built from every record across every patient currently loaded, so
     the charts reflect the complete hospital picture as data streams in
     rather than just whichever patient is expanded. */
  const chemoStats = useMemo(() => {
    let totalPlanned = 0;
    let totalCompleted = 0;
    let totalPending = 0;
    let patientsOnChemo = 0;
    let recordsInProgress = 0;
    let recordsCompleted = 0;
    let totalRecords = 0;

    const protocolCounts = {};
    const statusCounts = {};
    const intentCounts = {};

    const perPatient = [];

    patients.forEach((p) => {
      const records = chemoByPatient[p.patient_id];
      if (!records || records.length === 0) return;

      patientsOnChemo += 1;
      let patientPlanned = 0;
      let patientCompleted = 0;
      let patientPending = 0;

      records.forEach((r) => {
        totalRecords += 1;
        if (r.plannedCycles != null) {
          totalPlanned += r.plannedCycles;
          patientPlanned += r.plannedCycles;
        }
        totalCompleted += r.completedCycles || 0;
        patientCompleted += r.completedCycles || 0;
        if (r.pendingCycles != null) {
          totalPending += r.pendingCycles;
          patientPending += r.pendingCycles;
        }

        if (r.treatmentCompleted) recordsCompleted += 1;
        else recordsInProgress += 1;

        const proto = r.protocolName || "Unspecified";
        protocolCounts[proto] = (protocolCounts[proto] || 0) + 1;

        const st = r.treatmentStatus || r.recordStatus || "unknown";
        statusCounts[st] = (statusCounts[st] || 0) + 1;

        if (r.treatmentIntent) {
          intentCounts[r.treatmentIntent] = (intentCounts[r.treatmentIntent] || 0) + 1;
        }
      });

      perPatient.push({
        patientId: p.patient_id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        records,
        plannedCycles: patientPlanned,
        completedCycles: patientCompleted,
        pendingCycles: patientPending,
      });
    });

    const protocolBars = Object.entries(protocolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));

    const statusBars = Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label: titleCase(label) || "Unknown", value }));

    const cycleSegments = [
      { label: "Completed", value: totalCompleted, color: GRAYSCALE[0] },
      { label: "Pending", value: totalPending, color: GRAYSCALE[3] },
    ].filter((s) => s.value > 0);

    return {
      patientsOnChemo,
      totalRecords,
      totalPlanned,
      totalCompleted,
      totalPending,
      recordsInProgress,
      recordsCompleted,
      protocolBars,
      statusBars,
      cycleSegments,
      intentCounts,
      perPatient,
    };
  }, [patients, chemoByPatient]);

  const filteredChemoPatients = useMemo(() => {
    if (!chemoQuery.trim()) return chemoStats.perPatient;
    const q = chemoQuery.toLowerCase();
    return chemoStats.perPatient.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.patientId || "").toLowerCase().includes(q)
    );
  }, [chemoStats.perPatient, chemoQuery]);

  /* ─── hospital-wide surgical-oncology aggregates (surgical tab) ───
     Same idea as chemoStats, but the source data arrives from one
     hospital-wide call instead of a per-patient fan-out. */
  const surgicalStats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    let otherStatus = 0;
    let totalBloodLoss = 0;
    let bloodLossCount = 0;
    let complicationsCount = 0;
    let readmit30Count = 0;
    let mortality30Count = 0;

    const procedureCounts = {};
    const asaCounts = {};
    const statusCounts = {};

    const perPatient = [];

    patients.forEach((p) => {
      const records = surgicalByPatient[p.patient_id];
      if (!records || records.length === 0) return;

      perPatient.push({
        patientId: p.patient_id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        records,
      });

      records.forEach((r) => {
        const stLabel = titleCase(r.status) || "Unknown";
        statusCounts[stLabel] = (statusCounts[stLabel] || 0) + 1;

        const s = (r.status || "").toLowerCase();
        if (s.includes("complete")) completed += 1;
        else if (s.includes("pending")) pending += 1;
        else otherStatus += 1;

        if (r.bloodLoss != null && !Number.isNaN(r.bloodLoss)) {
          totalBloodLoss += r.bloodLoss;
          bloodLossCount += 1;
        }

        if (r.postOpHasComplications) complicationsCount += 1;
        if (r.readmit30) readmit30Count += 1;
        if (r.mortality30) mortality30Count += 1;

        const proto = r.procedureName || "Unspecified";
        procedureCounts[proto] = (procedureCounts[proto] || 0) + 1;

        const asa = r.asaClass || "Unknown";
        asaCounts[asa] = (asaCounts[asa] || 0) + 1;
      });
    });

    const totalSurgeries = completed + pending + otherStatus;

    const statusSegments = [
      { label: "Completed", value: completed, color: GRAYSCALE[0] },
      { label: "Pending", value: pending, color: GRAYSCALE[3] },
      { label: "Other", value: otherStatus, color: GRAYSCALE[5] },
    ].filter((s) => s.value > 0);

    const procedureBars = Object.entries(procedureCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));

    const asaBars = Object.entries(asaCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    const statusBars = Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    const avgBloodLoss = bloodLossCount > 0 ? Math.round(totalBloodLoss / bloodLossCount) : null;
    const complicationRate = totalSurgeries > 0 ? Math.round((complicationsCount / totalSurgeries) * 100) : 0;
    const readmit30Rate = totalSurgeries > 0 ? Math.round((readmit30Count / totalSurgeries) * 100) : 0;

    return {
      patientsWithSurgery: perPatient.length,
      totalSurgeries,
      completed,
      pending,
      complicationsCount,
      readmit30Count,
      mortality30Count,
      statusSegments,
      statusBars,
      procedureBars,
      asaBars,
      avgBloodLoss,
      complicationRate,
      readmit30Rate,
      perPatient,
    };
  }, [patients, surgicalByPatient]);

  const filteredSurgicalPatients = useMemo(() => {
    if (!surgicalQuery.trim()) return surgicalStats.perPatient;
    const q = surgicalQuery.toLowerCase();
    return surgicalStats.perPatient.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.patientId || "").toLowerCase().includes(q)
    );
  }, [surgicalStats.perPatient, surgicalQuery]);

  /* ─── hospital-wide radiation-oncology aggregates (radiation tab) ───
     Same shape as chemoStats/surgicalStats, but rolled up around
     fractions instead of cycles or surgery counts — total planned
     fractions, delivered fractions (from CBCT sessions), and pending
     fractions across every course currently loaded. */
  const radiationStats = useMemo(() => {
    let totalFractionsPlanned = 0;
    let totalFractionsCompleted = 0;
    let totalFractionsPending = 0;
    let patientsOnRT = 0;
    let recordsWithGap = 0;
    let totalRecords = 0;

    const intentCounts = {};
    const siteCounts = {};
    const statusCounts = {};

    const perPatient = [];

    patients.forEach((p) => {
      const records = radiationByPatient[p.patient_id];
      if (!records || records.length === 0) return;

      patientsOnRT += 1;
      let patientPlanned = 0;
      let patientCompleted = 0;

      records.forEach((r) => {
        totalRecords += 1;
        patientPlanned += r.totalFractions || 0;
        patientCompleted += r.completedFractions || 0;
        totalFractionsPlanned += r.totalFractions || 0;
        totalFractionsCompleted += r.completedFractions || 0;
        if (r.pendingFractions != null) totalFractionsPending += r.pendingFractions;
        if ((r.txGap || "").toLowerCase() === "yes") recordsWithGap += 1;

        const intentLabel = titleCase(r.treatmentIntent) || "Unspecified";
        intentCounts[intentLabel] = (intentCounts[intentLabel] || 0) + 1;

        const site = r.treatmentSite || "Unspecified";
        siteCounts[site] = (siteCounts[site] || 0) + 1;

        const st = titleCase(r.status) || "Unknown";
        statusCounts[st] = (statusCounts[st] || 0) + 1;
      });

      perPatient.push({
        patientId: p.patient_id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        records,
        plannedFractions: patientPlanned,
        completedFractions: patientCompleted,
        pendingFractions: Math.max(patientPlanned - patientCompleted, 0),
      });
    });

    const intentBars = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    const siteBars = Object.entries(siteCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));

    const statusBars = Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    const fractionSegments = [
      { label: "Delivered", value: totalFractionsCompleted, color: GRAYSCALE[0] },
      { label: "Pending", value: totalFractionsPending, color: GRAYSCALE[3] },
    ].filter((s) => s.value > 0);

    const overallFractionPct =
      totalFractionsPlanned > 0
        ? Math.round((totalFractionsCompleted / totalFractionsPlanned) * 100)
        : 0;

    return {
      patientsOnRT,
      totalRecords,
      totalFractionsPlanned,
      totalFractionsCompleted,
      totalFractionsPending,
      overallFractionPct,
      recordsWithGap,
      intentBars,
      siteBars,
      statusBars,
      fractionSegments,
      perPatient,
    };
  }, [patients, radiationByPatient]);

  const filteredRadiationPatients = useMemo(() => {
    if (!radiationQuery.trim()) return radiationStats.perPatient;
    const q = radiationQuery.toLowerCase();
    return radiationStats.perPatient.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.patientId || "").toLowerCase().includes(q)
    );
  }, [radiationStats.perPatient, radiationQuery]);

  const navSections = [
    {
      label: "Overview",
      items: [{ label: "Hospital Dashboard", icon: <Home size={14} />, action: handleDashboard }],
    },
    {
      label: "Oncology",
      items: [
        {
          label: "Complete Patient Overview",
          icon: <ClipboardList size={14} />,
          action: () => setActiveTab("overview"),
          key: "overview",
        },
        {
          label: "Medical Oncology",
          icon: <Syringe size={14} />,
          action: () => setActiveTab("medical"),
          key: "medical",
        },
        {
          label: "Surgical Oncology",
          icon: <Scissors size={14} />,
          action: () => setActiveTab("surgical"),
          key: "surgical",
        },
        {
          label: "Radiation Oncology",
          icon: <Radiation size={14} />,
          action: () => setActiveTab("radiation"),
          key: "radiation",
        },
      ],
    },
  ];

  const tabTitles = {
    overview: { label: "Complete Patient Overview", sub: "All oncology patients across every department" },
    medical: { label: "Medical Oncology", sub: "Chemotherapy and systemic treatment patients" },
    surgical: { label: "Surgical Oncology", sub: "Surgical treatment patients" },
    radiation: { label: "Radiation Oncology", sub: "Radiation treatment patients" },
  };

  const chemoSyncPct = chemoSync.total > 0 ? Math.round((chemoSync.done / chemoSync.total) * 100) : 0;
  const radiationSyncPct =
    radiationSync.total > 0 ? Math.round((radiationSync.done / radiationSync.total) * 100) : 0;

  const searchValue =
    activeTab === "medical"
      ? chemoQuery
      : activeTab === "surgical"
      ? surgicalQuery
      : activeTab === "radiation"
      ? radiationQuery
      : query;
  const handleSearchChange = (e) => {
    const v = e.target.value;
    if (activeTab === "medical") setChemoQuery(v);
    else if (activeTab === "surgical") setSurgicalQuery(v);
    else if (activeTab === "radiation") setRadiationQuery(v);
    else setQuery(v);
  };
  const searchPlaceholder =
    activeTab === "medical"
      ? "Search chemo patients..."
      : activeTab === "surgical"
      ? "Search surgical patients..."
      : activeTab === "radiation"
      ? "Search radiation patients..."
      : "Search patients...";

  return (
    <div style={S.layout}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
          * { box-sizing: border-box; }
          .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
          .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
          .h-menu-scroll::-webkit-scrollbar { display: none; }
          .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          .h-row:hover { background: ${T.bgAlt} !important; }
          .h-patient-card-header:hover { background: ${T.bgAlt} !important; }

          @keyframes h-fade-in-up {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .h-animate-in-group > * {
            animation: h-fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .h-animate-in-group > *:nth-child(1) { animation-delay: 0s; }
          .h-animate-in-group > *:nth-child(2) { animation-delay: 0.07s; }
          .h-animate-in-group > *:nth-child(3) { animation-delay: 0.14s; }
          .h-animate-in-group > *:nth-child(4) { animation-delay: 0.21s; }
          .h-animate-in {
            animation: h-fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
          }
        `}
      </style>

      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <div>
              <p style={S.brandName}>EMR Module</p>
              <p style={S.brandSub}>Oncology Department</p>
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
                  style={{
                    ...S.navBtn,
                    ...(item.key && item.key === activeTab ? S.navBtnActive : {}),
                  }}
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

      {/* Main Content */}
      <main ref={bodyScrollRef} style={S.main}>
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>{tabTitles[activeTab].label}</p>
            <p style={S.topBarSub}>{tabTitles[activeTab].sub}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={S.searchWrap}>
              <Search size={13} color={T.textMuted} />
              <input
                type="text"
                placeholder={searchPlaceholder}
                style={S.searchInput}
                value={searchValue}
                onChange={handleSearchChange}
              />
            </div>
            <Bell size={16} color={T.textMuted} style={{ cursor: "pointer", flexShrink: 0 }} />
            <div style={S.dateBadge}>
              <Calendar size={12} color={T.textMuted} />
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        <div style={S.body}>
          <span style={S.pageLabel}>Data Management</span>
          <h1 style={S.pageTitle}>{tabTitles[activeTab].label}</h1>

          {error && (
            <div style={S.errorBox}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {isLoading && !error && (
            <div style={S.loadingBox}>Loading patient records...</div>
          )}

          {!isLoading && !error && activeTab === "overview" && (
            <>
              {/* Stat cards */}
              <div className="h-animate-in-group" style={S.statsGrid}>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Total Patients</div>
                  <div style={S.statValue}>{totalPatients}</div>
                  <div style={S.statSub}>Across all oncology departments</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Average Age</div>
                  <div style={S.statValue}>{stats.avgAge || "—"}</div>
                  <div style={S.statSub}>Years, known ages only</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Male / Female</div>
                  <div style={S.statValue}>
                    {stats.maleCount} / {stats.femaleCount}
                  </div>
                  <div style={S.statSub}>Patient gender split</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Most Common Blood Group</div>
                  <div style={S.statValue}>{stats.topBloodGroup}</div>
                  <div style={S.statSub}>Across recorded patients</div>
                </div>
              </div>

              {/* Charts */}
              <div className="h-animate-in-group" style={S.chartsGrid}>
                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Gender Distribution</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                    <Donut segments={stats.genderSegments} />
                    <div style={{ flex: 1 }}>
                      {stats.genderSegments.map((s) => (
                        <div key={s.label} style={S.legendRow}>
                          <span style={{ ...S.legendSwatch, background: s.color }} />
                          <span>{s.label}</span>
                          <span style={S.legendValue}>{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Age Distribution</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  <BarList data={stats.ageBars} />
                </div>
              </div>

              <div className="h-animate-in" style={{ ...S.panel, marginBottom: "1.5rem" }}>
                <div style={S.panelHeader}>
                  <h3 style={S.panelTitle}>Blood Group Breakdown</h3>
                  <Activity size={14} color={T.textMuted} />
                </div>
                <BarList data={stats.bloodGroupBars} />
              </div>

              {/* Patient table */}
              <div style={S.tableContainer}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Name</th>
                      <th style={S.th}>Age</th>
                      <th style={S.th}>Gender</th>
                      <th style={S.th}>Blood Group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPatients.map((p) => (
                      <tr key={p.patient_id} className="h-row">
                        <td style={{ ...S.td, ...S.tdName }}>{p.name}</td>
                        <td style={S.td}>{p.age > 0 ? p.age : "—"}</td>
                        <td style={S.td}>{normalizeGender(p.gender)}</td>
                        <td style={S.td}>
                          <span style={S.badge}>{p.blood_group || "Unknown"}</span>
                        </td>
                      </tr>
                    ))}
                    {filteredPatients.length === 0 && (
                      <tr>
                        <td style={S.td} colSpan={4}>
                          No patients match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!isLoading && !error && activeTab === "medical" && (
            <>
              {/* Background sync indicator — only shown while records are
                  still streaming in; the tab itself never blocks on it */}
              {chemoSync.active && (
                <div style={S.syncBar}>
                  <Clock size={13} color={T.textMuted} />
                  <span>
                    Syncing chemotherapy records — {chemoSync.done} / {chemoSync.total} patients
                  </span>
                  <div style={S.syncTrack}>
                    <div style={{ ...S.syncFill, width: `${chemoSyncPct}%` }} />
                  </div>
                  <span>{chemoSyncPct}%</span>
                </div>
              )}

              {/* Stat cards — hospital-wide chemotherapy summary */}
              <div className="h-animate-in-group" style={S.statsGrid}>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Patients On Chemotherapy</div>
                  <div style={S.statValue}>{chemoStats.patientsOnChemo}</div>
                  <div style={S.statSub}>Of {totalPatients} total patients</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Cycles Planned</div>
                  <div style={S.statValue}>{chemoStats.totalPlanned}</div>
                  <div style={S.statSub}>Across all active regimens</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Cycles Completed</div>
                  <div style={S.statValue}>{chemoStats.totalCompleted}</div>
                  <div style={S.statSub}>
                    {chemoStats.totalPlanned > 0
                      ? `${Math.round((chemoStats.totalCompleted / chemoStats.totalPlanned) * 100)}% of planned`
                      : "No planned cycles yet"}
                  </div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Cycles Pending</div>
                  <div style={S.statValue}>{chemoStats.totalPending}</div>
                  <div style={S.statSub}>Remaining across all patients</div>
                </div>
              </div>

              {/* Charts */}
              <div className="h-animate-in-group" style={S.chartsGrid}>
                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Cycle Completion</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {chemoStats.cycleSegments.length > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                      <Donut segments={chemoStats.cycleSegments} />
                      <div style={{ flex: 1 }}>
                        {chemoStats.cycleSegments.map((s) => (
                          <div key={s.label} style={S.legendRow}>
                            <span style={{ ...S.legendSwatch, background: s.color }} />
                            <span>{s.label}</span>
                            <span style={S.legendValue}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {chemoSync.active ? "Waiting on cycle data..." : "No cycle data recorded yet."}
                    </p>
                  )}
                </div>

                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Treatment Status</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {chemoStats.statusBars.length > 0 ? (
                    <BarList data={chemoStats.statusBars} />
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {chemoSync.active ? "Waiting on treatment data..." : "No treatment status recorded yet."}
                    </p>
                  )}
                </div>
              </div>

              {/* Per-patient chemotherapy detail */}
              <div style={{ marginBottom: "0.75rem" }}>
                <h3 style={S.panelTitle}>Patient Chemotherapy Records</h3>
              </div>

              {filteredChemoPatients.length === 0 && (
                <div style={S.emptyBox}>
                  {chemoSync.active
                    ? "Syncing chemotherapy records for this hospital's patients..."
                    : "No patients with chemotherapy records found."}
                </div>
              )}

              {filteredChemoPatients.map((patient, patientIdx) => {
                const isExpanded = expandedPatientId === patient.patientId;
                return (
                  <div
                    key={patient.patientId}
                    className="h-animate-in"
                    style={{ ...S.patientCard, animationDelay: `${Math.min(patientIdx * 0.04, 0.4)}s` }}
                  >
                    <div
                      className="h-patient-card-header"
                      style={S.patientCardHeader}
                      onClick={() =>
                        setExpandedPatientId(isExpanded ? null : patient.patientId)
                      }
                    >
                      <div>
                        <div style={S.patientCardName}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {patient.name || patient.patientId}
                        </div>
                        <div style={S.patientCardMeta}>
                          {patient.age > 0 ? `${patient.age} yrs` : "Age —"} ·{" "}
                          {normalizeGender(patient.gender)} · {patient.records.length}{" "}
                          {patient.records.length === 1 ? "record" : "records"}
                        </div>
                      </div>

                      <div style={S.patientCardStats}>
                        <div style={S.miniStat}>
                          <div style={S.miniStatValue}>
                            {patient.completedCycles} / {patient.plannedCycles || "—"}
                          </div>
                          <div style={S.miniStatLabel}>Cycles Done</div>
                        </div>
                        <div style={S.cycleTrack}>
                          <ProgressBar
                            value={patient.completedCycles}
                            max={patient.plannedCycles}
                          />
                        </div>
                        <div style={S.miniStat}>
                          <div style={S.miniStatValue}>{patient.pendingCycles || 0}</div>
                          <div style={S.miniStatLabel}>Pending</div>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={S.recordDetail}>
                        {patient.records.map((r, idx) => (
                          <div
                            key={r.id || idx}
                            style={idx === patient.records.length - 1 ? S.recordBlockLast : S.recordBlock}
                          >
                            <div style={S.recordBlockHeader}>
                              <div style={S.recordBlockTitle}>
                                <Syringe size={13} />
                                {r.protocolName}
                              </div>
                              <span
                                style={{
                                  ...S.badge,
                                  color: statusColor(r.treatmentStatus),
                                  borderColor: statusColor(r.treatmentStatus),
                                }}
                              >
                                {titleCase(r.treatmentStatus) || "Unknown status"}
                              </span>
                            </div>

                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Intent</div>
                                <div style={S.detailValue}>{r.treatmentIntent || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Start Date</div>
                                <div style={S.detailValue}>{r.startDate || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Cycle Interval</div>
                                <div style={S.detailValue}>
                                  {r.daysBetweenCycles ? `${r.daysBetweenCycles} days` : "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Current Cycle</div>
                                <div style={S.detailValue}>
                                  {r.currentCycle ? `Cycle ${r.currentCycle}` : "—"}
                                </div>
                              </div>
                            </div>

                            {/* Planned / completed / pending — required cycle breakdown */}
                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Planned</div>
                                <div style={S.detailValue}>{r.plannedCycles ?? "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Completed</div>
                                <div style={S.detailValue}>{r.completedCycles}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Pending</div>
                                <div style={S.detailValue}>{r.pendingCycles ?? "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Diagnosis</div>
                                <div style={S.detailValue}>{r.diagnosis || "—"}</div>
                              </div>
                            </div>

                            <CycleDots
                              planned={r.plannedCycles}
                              completed={r.completedCycles}
                              current={r.currentCycle}
                            />

                            {r.drugs.length > 0 && (
                              <div style={{ marginTop: "0.6rem" }}>
                                <div style={S.detailLabel}>
                                  <Pill size={10} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
                                  Drug Schedule
                                </div>
                                <div style={S.drugChipRow}>
                                  {r.drugs.map((d, di) => (
                                    <span key={di} style={S.drugChip}>
                                      {d.name}
                                      {d.dose ? ` ${d.dose}${d.unit || ""}` : ""}
                                      {d.route ? ` · ${d.route}` : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {r.safetyFlags.length > 0 && (
                              <div style={{ marginTop: "0.6rem" }}>
                                <div style={S.detailLabel}>
                                  <ShieldAlert size={10} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
                                  Safety Flags
                                </div>
                                <div style={S.drugChipRow}>
                                  {r.safetyFlags.map((f, fi) => (
                                    <span key={fi} style={S.flagChip}>
                                      <ShieldAlert size={10} />
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {r.tumorBoardQuestion && (
                              <div style={{ marginTop: "0.6rem", fontSize: "0.72rem", color: T.textSec }}>
                                <span style={S.detailLabel}>Tumor Board Question </span>
                                {r.tumorBoardQuestion}
                                {r.tumorBoardScheduleDate ? ` (scheduled ${r.tumorBoardScheduleDate})` : ""}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {!isLoading && !error && activeTab === "surgical" && (
            <>
              {/* Loading indicator — single hospital-wide call, so this is
                  a plain in-flight flag rather than a progress bar */}
              {surgicalLoading && (
                <div style={S.syncBar}>
                  <Clock size={13} color={T.textMuted} />
                  <span>Loading surgical oncology records for this hospital...</span>
                </div>
              )}

              {surgicalError && (
                <div style={S.errorBox}>
                  <AlertCircle size={16} />
                  <span>{surgicalError}</span>
                </div>
              )}

              {/* Stat cards — hospital-wide surgical summary */}
              <div className="h-animate-in-group" style={S.statsGrid}>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Patients With Surgery</div>
                  <div style={S.statValue}>{surgicalStats.patientsWithSurgery}</div>
                  <div style={S.statSub}>Of {totalPatients} total patients</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Total Surgeries</div>
                  <div style={S.statValue}>{surgicalStats.totalSurgeries}</div>
                  <div style={S.statSub}>
                    {surgicalStats.completed} completed · {surgicalStats.pending} pending
                  </div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Average Blood Loss</div>
                  <div style={S.statValue}>
                    {surgicalStats.avgBloodLoss != null ? `${surgicalStats.avgBloodLoss}` : "—"}
                  </div>
                  <div style={S.statSub}>mL, across recorded surgeries</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>30-Day Readmission Rate</div>
                  <div style={S.statValue}>{surgicalStats.readmit30Rate}%</div>
                  <div style={S.statSub}>{surgicalStats.readmit30Count} of {surgicalStats.totalSurgeries} surgeries</div>
                </div>
              </div>

              {/* Charts */}
              <div className="h-animate-in-group" style={S.chartsGrid}>
                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Surgery Status</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {surgicalStats.statusSegments.length > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                      <Donut segments={surgicalStats.statusSegments} />
                      <div style={{ flex: 1 }}>
                        {surgicalStats.statusSegments.map((s) => (
                          <div key={s.label} style={S.legendRow}>
                            <span style={{ ...S.legendSwatch, background: s.color }} />
                            <span>{s.label}</span>
                            <span style={S.legendValue}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {surgicalLoading ? "Waiting on surgery data..." : "No surgical records recorded yet."}
                    </p>
                  )}
                </div>

                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>ASA Class Distribution</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {surgicalStats.asaBars.length > 0 ? (
                    <BarList data={surgicalStats.asaBars} />
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {surgicalLoading ? "Waiting on ASA data..." : "No ASA class data recorded yet."}
                    </p>
                  )}
                </div>
              </div>

              <div className="h-animate-in-group" style={S.chartsGrid}>
                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Top Procedures</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {surgicalStats.procedureBars.length > 0 ? (
                    <BarList data={surgicalStats.procedureBars} />
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {surgicalLoading ? "Waiting on procedure data..." : "No procedures recorded yet."}
                    </p>
                  )}
                </div>

                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Outcomes</h3>
                    <ShieldAlert size={14} color={T.textMuted} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                    <div>
                      <div style={S.legendRow}>
                        <span>Complication Rate</span>
                        <span style={S.legendValue}>
                          {surgicalStats.complicationsCount} / {surgicalStats.totalSurgeries}
                        </span>
                      </div>
                      <ProgressBar
                        value={surgicalStats.complicationRate}
                        max={100}
                        width="100%"
                        color={GRAYSCALE[1]}
                      />
                    </div>
                    <div>
                      <div style={S.legendRow}>
                        <span>30-Day Readmission</span>
                        <span style={S.legendValue}>
                          {surgicalStats.readmit30Count} / {surgicalStats.totalSurgeries}
                        </span>
                      </div>
                      <ProgressBar
                        value={surgicalStats.readmit30Rate}
                        max={100}
                        width="100%"
                        color={GRAYSCALE[2]}
                      />
                    </div>
                    <div>
                      <div style={S.legendRow}>
                        <span>30-Day Mortality</span>
                        <span style={S.legendValue}>
                          {surgicalStats.mortality30Count} / {surgicalStats.totalSurgeries}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          surgicalStats.totalSurgeries > 0
                            ? Math.round((surgicalStats.mortality30Count / surgicalStats.totalSurgeries) * 100)
                            : 0
                        }
                        max={100}
                        width="100%"
                        color={GRAYSCALE[0]}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-patient surgical detail */}
              <div style={{ marginBottom: "0.75rem" }}>
                <h3 style={S.panelTitle}>Patient Surgical Records</h3>
              </div>

              {filteredSurgicalPatients.length === 0 && (
                <div style={S.emptyBox}>
                  {surgicalLoading
                    ? "Loading surgical oncology records for this hospital's patients..."
                    : "No patients with surgical oncology records found."}
                </div>
              )}

              {filteredSurgicalPatients.map((patient, patientIdx) => {
                const isExpanded = expandedSurgicalPatientId === patient.patientId;
                const completedCount = patient.records.filter((r) =>
                  (r.status || "").toLowerCase().includes("complete")
                ).length;
                return (
                  <div
                    key={patient.patientId}
                    className="h-animate-in"
                    style={{ ...S.patientCard, animationDelay: `${Math.min(patientIdx * 0.04, 0.4)}s` }}
                  >
                    <div
                      className="h-patient-card-header"
                      style={S.patientCardHeader}
                      onClick={() =>
                        setExpandedSurgicalPatientId(isExpanded ? null : patient.patientId)
                      }
                    >
                      <div>
                        <div style={S.patientCardName}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {patient.name || patient.patientId}
                        </div>
                        <div style={S.patientCardMeta}>
                          {patient.age > 0 ? `${patient.age} yrs` : "Age —"} ·{" "}
                          {normalizeGender(patient.gender)} · {patient.records.length}{" "}
                          {patient.records.length === 1 ? "surgery" : "surgeries"}
                        </div>
                      </div>

                      <div style={S.patientCardStats}>
                        <div style={S.miniStat}>
                          <div style={S.miniStatValue}>
                            {completedCount} / {patient.records.length}
                          </div>
                          <div style={S.miniStatLabel}>Completed</div>
                        </div>
                        <div style={S.cycleTrack}>
                          <ProgressBar value={completedCount} max={patient.records.length} />
                        </div>
                        <div style={S.miniStat}>
                          <div style={S.miniStatValue}>
                            {patient.records.some((r) => r.postOpHasComplications) ? "Yes" : "No"}
                          </div>
                          <div style={S.miniStatLabel}>Complications</div>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={S.recordDetail}>
                        {patient.records.map((r, idx) => (
                          <div
                            key={r.id || idx}
                            style={idx === patient.records.length - 1 ? S.recordBlockLast : S.recordBlock}
                          >
                            <div style={S.recordBlockHeader}>
                              <div style={S.recordBlockTitle}>
                                <Scissors size={13} />
                                {r.procedureName}
                              </div>
                              <span
                                style={{
                                  ...S.badge,
                                  color: statusColor(r.status),
                                  borderColor: statusColor(r.status),
                                }}
                              >
                                {titleCase(r.status) || "Unknown status"}
                              </span>
                            </div>

                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Surgeon</div>
                                <div style={S.detailValue}>{r.treatingDoctor || r.primarySurgeon || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Surgery Date</div>
                                <div style={S.detailValue}>
                                  {r.surgeryDate ? `${r.surgeryDate}${r.startTime ? ` · ${r.startTime}` : ""}` : "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>ASA Class</div>
                                <div style={S.detailValue}>{r.asaClass || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>
                                  <MapPin size={10} style={{ marginRight: "3px", verticalAlign: "-1px" }} />
                                  OT Room
                                </div>
                                <div style={S.detailValue}>{r.otRoom || "—"}</div>
                              </div>
                            </div>

                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Laterality / Approach</div>
                                <div style={S.detailValue}>
                                  {[r.laterality, r.approach.join(", ")].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>
                                  <Droplet size={10} style={{ marginRight: "3px", verticalAlign: "-1px" }} />
                                  Blood Loss
                                </div>
                                <div style={S.detailValue}>
                                  {r.bloodLoss != null ? `${r.bloodLoss} mL` : "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Staging (T/N/M)</div>
                                <div style={S.detailValue}>{r.staging || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Resection / Intent</div>
                                <div style={S.detailValue}>
                                  {[r.resection, r.classification].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </div>
                            </div>

                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Pre-Op Diagnosis</div>
                                <div style={S.detailValue}>{r.preOpDiagnosis || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Post-Op Diagnosis</div>
                                <div style={S.detailValue}>{r.postOpDiagnosis || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Clavien-Dindo</div>
                                <div style={S.detailValue}>{r.clavienDindo || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Frozen Section</div>
                                <div style={S.detailValue}>{r.frozenSection || "—"}</div>
                              </div>
                            </div>

                            {r.findings && (
                              <div style={{ marginTop: "0.4rem", fontSize: "0.72rem", color: T.textSec }}>
                                <span style={S.detailLabel}>Findings </span>
                                {r.findings}
                              </div>
                            )}

                            {/* Outcome flags — complications, readmission, mortality */}
                            <div style={S.drugChipRow}>
                              <span style={r.postOpHasComplications ? S.flagChip : S.okChip}>
                                {r.postOpHasComplications ? <ShieldAlert size={10} /> : <CheckCircle2 size={10} />}
                                {r.postOpHasComplications ? "Post-op complications" : "No complications"}
                              </span>
                              <span style={r.readmit30 ? S.flagChip : S.okChip}>
                                {r.readmit30 ? <ShieldAlert size={10} /> : <CheckCircle2 size={10} />}
                                {r.readmit30 ? "Readmitted (30-day)" : "No 30-day readmission"}
                              </span>
                              <span style={r.mortality30 ? S.flagChip : S.okChip}>
                                {r.mortality30 ? <XCircle size={10} /> : <CheckCircle2 size={10} />}
                                {r.mortality30 ? "30-day mortality" : "No 30-day mortality"}
                              </span>
                            </div>

                            {r.postOpComplications.length > 0 && (
                              <div style={{ marginTop: "0.6rem" }}>
                                <div style={S.detailLabel}>
                                  <ShieldAlert size={10} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
                                  Complication Details
                                </div>
                                <div style={S.drugChipRow}>
                                  {r.postOpComplications.map((c, ci) => (
                                    <span key={ci} style={S.flagChip}>
                                      <ShieldAlert size={10} />
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {!isLoading && !error && activeTab === "radiation" && (
            <>
              {/* Background sync indicator — same fan-out pattern as chemo */}
              {radiationSync.active && (
                <div style={S.syncBar}>
                  <Clock size={13} color={T.textMuted} />
                  <span>
                    Syncing radiation records — {radiationSync.done} / {radiationSync.total} patients
                  </span>
                  <div style={S.syncTrack}>
                    <div style={{ ...S.syncFill, width: `${radiationSyncPct}%` }} />
                  </div>
                  <span>{radiationSyncPct}%</span>
                </div>
              )}

              {/* Stat cards — hospital-wide radiation summary, focused on fractions */}
              <div className="h-animate-in-group" style={S.statsGrid}>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Patients On Radiation</div>
                  <div style={S.statValue}>{radiationStats.patientsOnRT}</div>
                  <div style={S.statSub}>Of {totalPatients} total patients</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Fractions Planned</div>
                  <div style={S.statValue}>{radiationStats.totalFractionsPlanned}</div>
                  <div style={S.statSub}>Across all active courses</div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Fractions Delivered</div>
                  <div style={S.statValue}>{radiationStats.totalFractionsCompleted}</div>
                  <div style={S.statSub}>
                    {radiationStats.totalFractionsPlanned > 0
                      ? `${radiationStats.overallFractionPct}% of planned`
                      : "No planned fractions yet"}
                  </div>
                </div>
                <div style={S.statCard}>
                  <div style={S.statLabel}>Fractions Pending</div>
                  <div style={S.statValue}>{radiationStats.totalFractionsPending}</div>
                  <div style={S.statSub}>Remaining across all patients</div>
                </div>
              </div>

              {/* Charts */}
              <div className="h-animate-in-group" style={S.chartsGrid}>
                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Fraction Completion</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {radiationStats.fractionSegments.length > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                      <Donut segments={radiationStats.fractionSegments} />
                      <div style={{ flex: 1 }}>
                        {radiationStats.fractionSegments.map((s) => (
                          <div key={s.label} style={S.legendRow}>
                            <span style={{ ...S.legendSwatch, background: s.color }} />
                            <span>{s.label}</span>
                            <span style={S.legendValue}>{s.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {radiationSync.active ? "Waiting on fraction data..." : "No fraction data recorded yet."}
                    </p>
                  )}
                </div>

                <div style={S.panel}>
                  <div style={S.panelHeader}>
                    <h3 style={S.panelTitle}>Treatment Sites</h3>
                    <Activity size={14} color={T.textMuted} />
                  </div>
                  {radiationStats.siteBars.length > 0 ? (
                    <BarList data={radiationStats.siteBars} />
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: T.textMuted }}>
                      {radiationSync.active ? "Waiting on treatment data..." : "No treatment sites recorded yet."}
                    </p>
                  )}
                </div>
              </div>

              {/* Per-patient radiation detail */}
              <div style={{ marginBottom: "0.75rem" }}>
                <h3 style={S.panelTitle}>Patient Radiation Records</h3>
              </div>

              {filteredRadiationPatients.length === 0 && (
                <div style={S.emptyBox}>
                  {radiationSync.active
                    ? "Syncing radiation oncology records for this hospital's patients..."
                    : "No patients with radiation oncology records found."}
                </div>
              )}

              {filteredRadiationPatients.map((patient, patientIdx) => {
                const isExpanded = expandedRadiationPatientId === patient.patientId;
                return (
                  <div
                    key={patient.patientId}
                    className="h-animate-in"
                    style={{ ...S.patientCard, animationDelay: `${Math.min(patientIdx * 0.04, 0.4)}s` }}
                  >
                    <div
                      className="h-patient-card-header"
                      style={S.patientCardHeader}
                      onClick={() =>
                        setExpandedRadiationPatientId(isExpanded ? null : patient.patientId)
                      }
                    >
                      <div>
                        <div style={S.patientCardName}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {patient.name || patient.patientId}
                        </div>
                        <div style={S.patientCardMeta}>
                          {patient.age > 0 ? `${patient.age} yrs` : "Age —"} ·{" "}
                          {normalizeGender(patient.gender)} · {patient.records.length}{" "}
                          {patient.records.length === 1 ? "course" : "courses"}
                        </div>
                      </div>

                      <div style={S.patientCardStats}>
                        <div style={S.miniStat}>
                          <div style={S.miniStatValue}>
                            {patient.completedFractions} / {patient.plannedFractions || "—"}
                          </div>
                          <div style={S.miniStatLabel}>Fractions Done</div>
                        </div>
                        <div style={S.cycleTrack}>
                          <ProgressBar
                            value={patient.completedFractions}
                            max={patient.plannedFractions}
                          />
                        </div>
                        <div style={S.miniStat}>
                          <div style={S.miniStatValue}>{patient.pendingFractions || 0}</div>
                          <div style={S.miniStatLabel}>Pending</div>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={S.recordDetail}>
                        {patient.records.map((r, idx) => (
                          <div
                            key={r.id || idx}
                            style={idx === patient.records.length - 1 ? S.recordBlockLast : S.recordBlock}
                          >
                            <div style={S.recordBlockHeader}>
                              <div style={S.recordBlockTitle}>
                                <Radiation size={13} />
                                {r.treatmentSite || "Unspecified site"}
                              </div>
                              <span
                                style={{
                                  ...S.badge,
                                  color: statusColor(r.status),
                                  borderColor: statusColor(r.status),
                                }}
                              >
                                {titleCase(r.status) || "Unknown status"}
                              </span>
                            </div>

                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Intent</div>
                                <div style={S.detailValue}>{titleCase(r.treatmentIntent) || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>RT Role / Setting</div>
                                <div style={S.detailValue}>
                                  {[r.rtRole, r.rtSetting].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>RT Type / Technique</div>
                                <div style={S.detailValue}>
                                  {[r.rtType, r.technique].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Machine</div>
                                <div style={S.detailValue}>{r.treatmentMachine || "—"}</div>
                              </div>
                            </div>

                            {/* Fraction breakdown — the primary metric for this tab */}
                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Total Dose</div>
                                <div style={S.detailValue}>
                                  {r.totalDose != null ? `${r.totalDose} Gy` : "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Dose / Fraction</div>
                                <div style={S.detailValue}>
                                  {r.dosePerFraction ? `${r.dosePerFraction} Gy` : "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Total Fractions</div>
                                <div style={S.detailValue}>{r.totalFractions || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Delivered / Pending</div>
                                <div style={S.detailValue}>
                                  {r.completedFractions} / {r.pendingFractions ?? "—"}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.6rem" }}>
                              <ProgressBar
                                value={r.completedFractions}
                                max={r.totalFractions}
                                width="100%"
                              />
                              <span style={{ fontSize: "0.68rem", color: T.textMuted, flexShrink: 0 }}>
                                {r.fractionProgressPct}%
                              </span>
                            </div>

                            {r.totalFractions > 0 && r.totalFractions <= 20 && (
                              <CycleDots
                                planned={r.totalFractions}
                                completed={r.completedFractions}
                                current={r.completedFractions + 1}
                              />
                            )}

                            <div style={S.detailGrid}>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Simulation</div>
                                <div style={S.detailValue}>
                                  {[r.simulationType?.toUpperCase(), r.simulationDate].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Positioning</div>
                                <div style={S.detailValue}>{r.positioning || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Verification</div>
                                <div style={S.detailValue}>{r.verificationMethod || "—"}</div>
                              </div>
                              <div style={S.detailItem}>
                                <div style={S.detailLabel}>Duration</div>
                                <div style={S.detailValue}>
                                  {r.treatmentDuration ? `${r.treatmentDuration} weeks` : "—"}
                                </div>
                              </div>
                            </div>

                            {r.targetVolumes.length > 0 && (
                              <div style={{ marginTop: "0.6rem" }}>
                                <div style={S.detailLabel}>
                                  <Target size={10} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
                                  Target Volumes
                                </div>
                                <div style={S.drugChipRow}>
                                  {r.targetVolumes.map((v, vi) => (
                                    <span key={vi} style={S.drugChip}>
                                      {v.volumeName}
                                      {v.prescribedDose ? ` · ${v.prescribedDose}` : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {r.organsAtRisk.length > 0 && (
                              <div style={{ marginTop: "0.6rem" }}>
                                <div style={S.detailLabel}>
                                  <Layers size={10} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
                                  Organs At Risk
                                </div>
                                <div style={S.drugChipRow}>
                                  {r.organsAtRisk.map((o, oi) => (
                                    <span key={oi} style={S.drugChip}>
                                      {o.organName}
                                      {o.maxDoseGy ? ` · max ${o.maxDoseGy}` : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Treatment gap flag — worth surfacing since it directly
                                affects fraction delivery schedule */}
                            <div style={S.drugChipRow}>
                              <span style={(r.txGap || "").toLowerCase() === "yes" ? S.flagChip : S.okChip}>
                                {(r.txGap || "").toLowerCase() === "yes" ? (
                                  <ShieldAlert size={10} />
                                ) : (
                                  <CheckCircle2 size={10} />
                                )}
                                {(r.txGap || "").toLowerCase() === "yes"
                                  ? `Treatment gap${r.gapReason ? `: ${r.gapReason}` : ""}`
                                  : "No treatment gap"}
                              </span>
                            </div>

                            {r.adverseEvents.length > 0 && (
                              <div style={{ marginTop: "0.6rem" }}>
                                <div style={S.detailLabel}>
                                  <ShieldAlert size={10} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
                                  Adverse Events
                                </div>
                                <div style={S.drugChipRow}>
                                  {r.adverseEvents.map((e, ei) => (
                                    <span key={ei} style={S.flagChip}>
                                      <ShieldAlert size={10} />
                                      {e.event}
                                      {e.grade ? ` (Grade ${e.grade})` : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {r.precautions && (
                              <div style={{ marginTop: "0.6rem", fontSize: "0.72rem", color: T.textSec }}>
                                <span style={S.detailLabel}>Precautions </span>
                                {r.precautions}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default OncologyDashboard;