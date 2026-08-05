import React, { useState } from "react";
import {
  Box, Typography, Chip, Paper, Grid, Avatar, IconButton,
  Collapse, Alert, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Divider, Card, CardContent, Stack,
  LinearProgress, Tooltip, alpha, Tab, Tabs, Drawer, List,
  ListItemButton, ListItemText, ListItemIcon, useTheme, useMediaQuery,
} from "@mui/material";
import {
  ExpandMore, ExpandLess, Assignment, LocalHospital, Warning,
  MonitorHeart, Medication, Description, AttachMoney, CheckCircle,
  Error, Timeline, Summarize, Science, Healing, Bloodtype,
  MedicalServices, PriorityHigh, Verified, Cancel, Analytics,
  Schedule, TrendingUp, Biotech, DocumentScanner, Speed,
  Person, Favorite, Psychology, Restaurant, FitnessCenter,
  AccessTime, InfoOutlined, Circle, MenuRounded, CloseRounded,
} from "@mui/icons-material";

/* ─── THEME TOKENS — exact match to DoctorDashboard ─── */
const FONT = "'Open Sans', sans-serif";
const FW = 300;

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

/* ─── Inline Styles — mirrors DoctorDashboard S object ─── */
const S = {
  layout: {
    fontFamily: FONT,
    fontWeight: FW,
    background: T.bg,
    color: T.text,
    minHeight: "100%",
    WebkitFontSmoothing: "antialiased",
  },

  /* top header / tab bar */
  topBar: {
    position: "sticky",
    top: 0,
    background: T.bg,
    borderBottom: `1px solid ${T.border}`,
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
  },

  /* page body */
  body: {
    padding: "1.5rem 2rem",
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
  },

  /* section block */
  section: {
    border: `1px solid ${T.border}`,
    background: T.bg,
  },
  sectionHeader: {
    padding: "0.875rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontSize: "0.72rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: 0,
    fontFamily: FONT,
  },
  sectionSub: {
    fontSize: "0.62rem",
    color: T.textMuted,
    marginTop: "2px",
    fontFamily: FONT,
    fontWeight: FW,
  },
  sectionBody: {
    padding: "1.25rem 1.5rem",
  },

  /* collapsible header */
  collapsibleHead: {
    padding: "0.875rem 1.5rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    background: T.bgAlt,
    borderBottom: `1px solid ${T.border}`,
    transition: "background 0.15s",
  },

  /* tables */
  tableWrap: { overflowX: "auto", WebkitOverflowScrolling: "touch" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "500px",
  },
  th: {
    textAlign: "left",
    padding: "0.6rem 1rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
    background: T.bgAlt,
    fontFamily: FONT,
  },
  td: {
    padding: "0.7rem 1rem",
    fontSize: "0.75rem",
    fontWeight: FW,
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
    fontFamily: FONT,
    verticalAlign: "top",
  },

  /* badge */
  badge: {
    padding: "0.18rem 0.5rem",
    fontSize: "0.58rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
    fontFamily: FONT,
    color: T.textSec,
    background: T.bg,
    whiteSpace: "nowrap",
  },
  badgeDark: {
    padding: "0.18rem 0.5rem",
    fontSize: "0.58rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.text}`,
    display: "inline-block",
    fontFamily: FONT,
    color: T.text,
    background: T.bg,
    whiteSpace: "nowrap",
  },
  badgeFilled: {
    padding: "0.18rem 0.5rem",
    fontSize: "0.58rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    display: "inline-block",
    fontFamily: FONT,
    color: T.bg,
    background: T.text,
    border: `1px solid ${T.text}`,
    whiteSpace: "nowrap",
  },

  /* KV pair */
  kvLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "3px",
    fontFamily: FONT,
  },
  kvValue: {
    fontSize: "0.78rem",
    fontWeight: FW,
    color: T.textSec,
    fontFamily: FONT,
    lineHeight: 1.5,
  },

  /* metric cell */
  metricCell: {
    border: `1px solid ${T.border}`,
    padding: "1rem",
    textAlign: "center",
    background: T.bg,
  },
  metricNum: {
    fontSize: "1.4rem",
    fontWeight: 300,
    letterSpacing: "-0.03em",
    color: T.text,
    margin: 0,
    lineHeight: 1,
    fontFamily: FONT,
  },
  metricLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    marginTop: "0.35rem",
    display: "block",
    fontFamily: FONT,
    fontWeight: 400,
  },
  metricSub: {
    fontSize: "0.6rem",
    color: T.textMuted,
    fontFamily: FONT,
    display: "block",
    marginTop: "2px",
  },

  /* grid helpers */
  twoCol: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1.25rem",
  },
  threeCol: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1rem",
  },
  infoCard: {
    background: T.bgAlt,
    border: `1px solid ${T.border}`,
    padding: "1rem",
  },

  /* timeline dot */
  timelineDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: T.text,
    border: `2px solid ${T.border}`,
    flexShrink: 0,
    marginTop: "4px",
  },

  /* action button */
  actionBtn: {
    padding: "0.28rem 0.75rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.62rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: FONT,
    letterSpacing: "0.05em",
    display: "inline-block",
  },
  outlineBtn: {
    padding: "0.28rem 0.75rem",
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    fontSize: "0.62rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: FONT,
  },

  /* tab bar */
  tabBar: {
    display: "flex",
    overflowX: "auto",
    borderBottom: `1px solid ${T.border}`,
    background: T.bg,
    scrollbarWidth: "none",
  },
  tab: (active) => ({
    padding: "0.75rem 1.25rem",
    fontSize: "0.7rem",
    fontWeight: active ? 400 : FW,
    color: active ? T.text : T.textMuted,
    fontFamily: FONT,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    cursor: "pointer",
    background: "none",
    border: "none",
    borderBottom: active ? `2px solid ${T.text}` : "2px solid transparent",
    whiteSpace: "nowrap",
    transition: "all 0.15s",
    flexShrink: 0,
  }),
};

/* ─── safe value coercion ─── */
const s = (v) => {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(s).join(", ");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
};

/* ─── Reusable Building Blocks ─── */

const SectionBlock = ({ title, sub, action, children, style = {} }) => (
  <div style={{ ...S.section, ...style }}>
    <div style={S.sectionHeader}>
      <div>
        <p style={S.sectionTitle}>{title}</p>
        {sub && <p style={S.sectionSub}>{sub}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
    <div style={S.sectionBody}>{children}</div>
  </div>
);

const CollapsibleBlock = ({ title, sub, defaultOpen = false, children, action }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={S.section}>
      <div
        style={S.collapsibleHead}
        onClick={() => setOpen(o => !o)}
        className="ip-collapsible-head"
      >
        <div>
          <p style={S.sectionTitle}>{title}</p>
          {sub && <p style={S.sectionSub}>{sub}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {action}
          <span style={{ fontSize: "0.7rem", color: T.textMuted }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div style={S.sectionBody}>{children}</div>
      )}
    </div>
  );
};

const KV = ({ label, value, style = {} }) => (
  <div style={{ marginBottom: "0.75rem", ...style }}>
    <span style={S.kvLabel}>{label}</span>
    <span style={S.kvValue}>{s(value)}</span>
  </div>
);

const Badge = ({ label, variant = "default" }) => {
  if (!label || label === "—") return <span style={S.badge}>—</span>;
  const style = variant === "filled" ? S.badgeFilled : variant === "dark" ? S.badgeDark : S.badge;
  return <span style={style}>{label}</span>;
};

const RiskBadge = ({ level }) => {
  const map = {
    High: "High Risk",
    Moderate: "Moderate",
    Low: "Low Risk",
    Critical: "Critical",
    IMMEDIATE: "Immediate",
    Urgent: "Urgent",
  };
  const label = map[level] || s(level);
  const isDanger = ["High", "Critical", "IMMEDIATE"].includes(level);
  return <Badge label={label} variant={isDanger ? "filled" : "dark"} />;
};

const UrgencyBadge = ({ val }) => {
  const danger = ["STAT", "Immediate"].includes(val);
  return <Badge label={s(val)} variant={danger ? "filled" : "dark"} />;
};

const StyledTable = ({ headers, rows }) => (
  <div style={S.tableWrap}>
    <table style={S.table} className="ip-table">
      <thead>
        <tr>
          {headers.map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="ip-tbl-row">
            {row.map((cell, j) => (
              <td key={j} style={S.td}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MetricsGrid = ({ items }) => (
  <div style={{
    display: "grid",
    gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)`,
    gap: "1px",
    background: T.border,
    border: `1px solid ${T.border}`,
  }}>
    {items.map((item, i) => (
      <div key={i} style={{ ...S.metricCell, background: i % 2 === 0 ? T.bg : T.bgAlt }}>
        <p style={S.metricNum}>{s(item.value)}</p>
        <span style={S.metricLabel}>{item.label}</span>
        {item.sub && <span style={S.metricSub}>{item.sub}</span>}
      </div>
    ))}
  </div>
);

const TwoCol = ({ left, right }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
    <div>{left}</div>
    <div>{right}</div>
  </div>
);

const TagRow = ({ items, variant }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
    {(items || []).map((t, i) => <Badge key={i} label={s(t)} variant={variant} />)}
  </div>
);

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function IPPatientSummary({ initialData }) {
  const [tab, setTab] = useState(0);

  const tabs = ["Overview", "Clinical", "Monitoring", "Care Plan", "Treatments", "Insurance"];

  if (!initialData) {
    return (
      <div style={{ ...S.layout, padding: "2rem", textAlign: "center" }}>
        <div style={{ ...S.section, padding: "2rem", color: T.textMuted, fontSize: "0.78rem" }}>
          No IP summary data available. Please run IP Onboarding first.
        </div>
      </div>
    );
  }

  const d = initialData;
  const sum = d.ip_onboarding_summary || d;
  const metadata = {
    patient_id: d.patient_id,
    doctor_id: d.doctor_id,
    generated_at: d.generated_at,
    admission_date: d.admission_date,
    documents_analyzed: d.documents_analyzed,
    op_docs_analyzed: d.op_docs_analyzed,
    ip_docs_analyzed: d.ip_docs_analyzed,
    op_diagnoses_found: d.op_diagnoses_found,
    doc_features_found: d.doc_features_found,
    processing_time_ms: d.processing_time_ms,
    errors: d.errors || [],
    version: d.version,
  };
  const agentTimings = d.agent_timings || {};
  const opSumRaw = sum.previous_op_summary || {};
  const ipClinSum = sum.ip_clinical_summary || {};
  const patOverview = ipClinSum.patient_overview || {};
  const opSum = ipClinSum.previous_op_summary || opSumRaw;
  const reasonRaw = sum.reason_for_op_to_ip_admission || {};
  const reason = ipClinSum.reason_for_op_to_ip_admission || reasonRaw;
  const ipAdmRaw = sum.ip_admission_details || {};
  const admLog = ipAdmRaw.admission_logistics || {};
  const ipAdm = ipClinSum.ip_admission_details || {};
  const curCond = ipAdmRaw.current_condition_on_admission || {};
  const curPic = ipClinSum.current_clinical_picture || {};
  const vitalsRaw = ipAdmRaw.current_vitals || {};
  const vitalsArray = vitalsRaw.vitals || [];
  const docs = ipAdmRaw.current_documents || [];
  const meds = ipAdmRaw.current_medications || [];
  const treatments = sum.treatments_tried_and_response || {};
  const diseaseProg = sum.disease_progression_clinical_insights || {};
  const risk = sum.risk_stratification || {};
  const critical = sum.critical_conditions_to_watch || {};
  const monitoring = sum.monitoring_plan || {};
  const carePlanRaw = sum.step_by_step_ip_care_plan || {};
  const insurance = sum.insurance_and_documentation || {};
  const timeline = ipClinSum.clinical_timeline || [];
  const narrative = ipClinSum.ip_clinical_summary_narrative || "";
  const score = d.score || {};

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .ip-tab:hover { color: #000 !important; }
        .ip-collapsible-head:hover { background: #f5f5f5 !important; }
        .ip-tbl-row:hover td { background: #fafafa !important; }
        .ip-table { font-family: 'Open Sans', sans-serif; }
        .ip-tab-bar::-webkit-scrollbar { display: none; }
        .ip-tab-bar { -ms-overflow-style: none; scrollbar-width: none; }
        @media (max-width: 767px) {
          .ip-two-col { grid-template-columns: 1fr !important; }
          .ip-three-col { grid-template-columns: 1fr 1fr !important; }
          .ip-metrics-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .ip-body { padding: 1rem !important; }
        }
      `}</style>

      {/* ── TAB BAR ── */}
      <div style={S.topBar}>
        <div className="ip-tab-bar" style={S.tabBar}>
          {tabs.map((t, i) => (
            <button
              key={t}
              className="ip-tab"
              style={S.tab(tab === i)}
              onClick={() => setTab(i)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="ip-body" style={S.body}>

        {/* ════════════════════════════════════════════
            TAB 0 — OVERVIEW
        ════════════════════════════════════════════ */}
        {tab === 0 && (
          <>
            {/* Clinical Narrative */}
            {narrative && (
              <SectionBlock
                title="Clinical Narrative"
                sub="AI-powered clinical summary"
              >
                <p style={{ ...S.kvValue, lineHeight: 1.7, margin: 0 }}>{narrative}</p>
              </SectionBlock>
            )}

            {/* Reason for Admission */}
            {(Object.keys(reason).length > 0 || Object.keys(reasonRaw).length > 0) && (
              <SectionBlock
                title="Reason for OP → IP Admission"
                sub="OP to IP transition rationale"
                action={
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <RiskBadge level={reason.admission_urgency || reasonRaw.urgency} />
                    <Badge label={s(reason.admission_type_clinical || reasonRaw.admission_type_clinical)} />
                  </div>
                }
              >
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Primary Reason" value={reason.primary_reason || reasonRaw.primary_reason_for_admission} />
                    <KV label="Clinical Justification" value={reason.clinical_justification || reasonRaw.primary_reason_detailed} />
                  </div>
                  <div>
                    <KV label="OP Working Diagnosis" value={reasonRaw.op_working_diagnosis} />
                    <KV label="IP Admission Diagnosis" value={reason.ip_admission_diagnosis || reasonRaw.ip_admission_diagnosis} />
                    <KV label="Diagnosis Evolution" value={reasonRaw.diagnosis_evolution} />
                  </div>
                </div>
                {reasonRaw.expected_ip_course && (
                  <>
                    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: "1rem", paddingTop: "1rem" }}>
                      <span style={S.kvLabel}>Expected IP Course</span>
                      <div className="ip-two-col" style={{ ...S.twoCol, marginTop: "0.5rem" }}>
                        <div>
                          <KV label="Estimated LOS" value={reasonRaw.expected_ip_course.estimated_los_days} />
                          <KV label="Primary Procedures" value={reasonRaw.expected_ip_course.primary_planned_procedures?.join(", ")} />
                        </div>
                        <div>
                          <KV label="Key Milestones" value={reasonRaw.expected_ip_course.key_milestones_before_discharge?.join(", ")} />
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {(reason.specific_triggers || reasonRaw.specific_clinical_triggers)?.length > 0 && (
                  <div style={{ borderTop: `1px solid ${T.border}`, marginTop: "1rem", paddingTop: "1rem" }}>
                    <span style={S.kvLabel}>Clinical Triggers</span>
                    <div style={{ marginTop: "0.5rem" }}>
                      <TagRow items={reason.specific_triggers || reasonRaw.specific_clinical_triggers} />
                    </div>
                  </div>
                )}
                {reasonRaw.transition_narrative && (
                  <div style={{ borderTop: `1px solid ${T.border}`, marginTop: "1rem", paddingTop: "1rem" }}>
                    <KV label="Transition Narrative" value={reasonRaw.transition_narrative} />
                  </div>
                )}
              </SectionBlock>
            )}

            {/* Admission Logistics */}
            {Object.keys(admLog).length > 0 && (
              <SectionBlock title="IP Admission Details" sub="Admission logistics">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Admission Date" value={admLog.admission_date} />
                    <KV label="Admission Type" value={admLog.admission_type} />
                    <KV label="Department" value={admLog.department} />
                  </div>
                  <div>
                    <KV label="Specialty" value={admLog.specialty} />
                    <KV label="Chief Complaint" value={admLog.chief_complaint_at_admission} />
                    <KV label="Patient Status" value={admLog.patient_status} />
                  </div>
                </div>
              </SectionBlock>
            )}

            {/* Clinical Timeline */}
            {timeline.length > 0 && (
              <SectionBlock title="Clinical Timeline" sub="Key events and care transitions">
                <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                  {timeline.map((ev, i) => (
                    <div key={i} style={{
                      display: "flex",
                      gap: "1rem",
                      paddingBottom: "1rem",
                      borderLeft: `2px solid ${T.border}`,
                      paddingLeft: "1rem",
                      marginLeft: "4px",
                      position: "relative",
                    }}>
                      <div style={{
                        position: "absolute",
                        left: "-6px",
                        top: "2px",
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: ev.care_setting === "IP" ? T.text : T.textMuted,
                        border: `2px solid ${T.bg}`,
                        outline: `1px solid ${T.border}`,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <span style={S.kvLabel}>{s(ev.date)}</span>
                          <Badge label={s(ev.care_setting)} variant={ev.care_setting === "IP" ? "filled" : "dark"} />
                        </div>
                        <p style={{ ...S.kvValue, fontWeight: 400, color: T.text, margin: "0 0 2px" }}>{s(ev.event)}</p>
                        <p style={{ ...S.kvValue, fontSize: "0.72rem", margin: 0 }}>{s(ev.significance)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionBlock>
            )}

            {/* Vitals */}
            {vitalsArray.length > 0 && (
              <SectionBlock title="Vital Signs" sub="Current vital signs on admission">
                <div style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.min(vitalsArray.length, 5)}, 1fr)`,
                  gap: "1px",
                  background: T.border,
                  border: `1px solid ${T.border}`,
                }} className="ip-metrics-grid">
                  {vitalsArray.map((vital, idx) => (
                    <div key={idx} style={{ ...S.metricCell, background: idx % 2 === 0 ? T.bg : T.bgAlt }}>
                      <p style={S.metricNum}>{s(vital.value)}</p>
                      <span style={S.metricLabel}>{s(vital.parameter)}</span>
                      <span style={S.metricSub}>
                        <Badge label={s(vital.status)} variant={vital.status === "Normal" ? "default" : "filled"} />
                      </span>
                    </div>
                  ))}
                </div>
              </SectionBlock>
            )}

            {/* Active Diagnoses */}
            {curCond.active_diagnoses?.length > 0 && (
              <SectionBlock title="Active Diagnoses" sub="Current active diagnoses at admission">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {curCond.active_diagnoses.map((dx, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", paddingBottom: "0.75rem", borderBottom: i < curCond.active_diagnoses.length - 1 ? `1px solid ${T.border}` : "none" }}>
                      <span style={{ fontSize: "0.5rem", marginTop: "6px", color: T.textMuted }}>●</span>
                      <div>
                        <p style={{ ...S.kvValue, fontWeight: 400, color: T.text, margin: "0 0 4px" }}>{s(dx.diagnosis)}</p>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {dx.status && <Badge label={s(dx.status)} />}
                          {dx.date && <span style={{ ...S.kvLabel, margin: 0, lineHeight: "1.6rem" }}>Confirmed: {dx.date}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionBlock>
            )}

            {/* Active Problems */}
            {curPic.active_problems?.length > 0 && (
              <SectionBlock title="Active Problems">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {curPic.active_problems.map((problem, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                      <span style={{ fontSize: "0.5rem", marginTop: "6px", color: T.textMuted }}>●</span>
                      <p style={{ ...S.kvValue, margin: 0 }}>{s(problem)}</p>
                    </div>
                  ))}
                </div>
              </SectionBlock>
            )}

            {/* Current Medications */}
            {meds?.length > 0 && (
              <SectionBlock title="Current Medications" sub="Active inpatient medications">
                <StyledTable
                  headers={["Drug Name", "Dose", "Frequency", "Route", "Indication", "Source"]}
                  rows={meds.map(m => [
                    s(m.drug_name || m.name),
                    s(m.dose),
                    s(m.frequency),
                    s(m.route),
                    s(m.indication),
                    s(m.source),
                  ])}
                />
              </SectionBlock>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════
            TAB 1 — CLINICAL
        ════════════════════════════════════════════ */}
        {tab === 1 && (
          <>
            {/* OP Clinical Trajectory */}
            {(opSum.op_clinical_trajectory || opSumRaw.op_clinical_trajectory) && (
              <SectionBlock title="OP Clinical Trajectory" sub="Outpatient clinical trajectory">
                <p style={{ ...S.kvValue, lineHeight: 1.7, margin: "0 0 0.75rem" }}>
                  {s(opSum.op_clinical_trajectory || opSumRaw.op_clinical_trajectory)}
                </p>
                {opSumRaw.data_quality_flag && (
                  <Badge label={`Data Quality: ${opSumRaw.data_quality_flag}`} />
                )}
              </SectionBlock>
            )}

            {/* Chief Complaints */}
            {((opSum.chief_complaints?.length > 0) || (opSumRaw.chief_complaints?.length > 0)) && (
              <CollapsibleBlock title="Chief Complaints (OP)" defaultOpen>
                <StyledTable
                  headers={["Complaint", "Date", "Source"]}
                  rows={(opSum.chief_complaints || opSumRaw.chief_complaints || []).map(c => [
                    s(c.complaint), s(c.date), s(c.source || c.source_document)
                  ])}
                />
              </CollapsibleBlock>
            )}

            {/* Unified Diagnoses */}
            {((opSum.unified_diagnoses?.length > 0) || (opSumRaw.unified_diagnoses?.length > 0)) && (
              <CollapsibleBlock title="Unified Diagnoses" defaultOpen>
                <StyledTable
                  headers={["Diagnosis", "Date Confirmed", "Method", "Evidence"]}
                  rows={(opSum.unified_diagnoses || opSumRaw.unified_diagnoses || []).map(dx => [
                    s(dx.diagnosis), s(dx.date_confirmed || dx.date),
                    s(dx.confirmation_method || dx.confirmed_by), s(dx.evidence),
                  ])}
                />
              </CollapsibleBlock>
            )}

            {/* OP Doctor Plans */}
            {((opSum.op_doctor_plans?.length > 0) || (opSumRaw.doctor_plans_op?.length > 0)) && (
              <CollapsibleBlock title="OP Doctor Plans" defaultOpen>
                <StyledTable
                  headers={["Plan", "Date", "Type"]}
                  rows={(opSum.op_doctor_plans || opSumRaw.doctor_plans_op || []).map(p => [
                    s(p.plan), s(p.date), s(p.plan_type || p.type)
                  ])}
                />
              </CollapsibleBlock>
            )}

            {/* Disease Progression */}
            {Object.keys(diseaseProg).length > 0 && (
              <SectionBlock title="Disease Progression & Clinical Insights" sub="Disease progression tracking">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Progression Trend" value={diseaseProg.progression_trend} />
                    <KV label="Data Source" value={diseaseProg.derived_from} />
                  </div>
                  <div>
                    <KV label="Key Events" value={diseaseProg.key_events?.join(", ")} />
                  </div>
                </div>
              </SectionBlock>
            )}

            {/* Current Clinical Picture */}
            {Object.keys(curPic).length > 0 && (
              <SectionBlock title="IP Clinical Status" sub="Current clinical picture">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Primary IP Diagnosis" value={curPic.primary_ip_diagnosis} />
                    <KV label="Diagnosis Status" value={curPic.diagnosis_status} />
                    <KV label="Clinical Status" value={curPic.clinical_status} />
                  </div>
                  <div>
                    <KV label="Current Medications" value={curPic.current_medications?.join(", ")} />
                  </div>
                </div>
                {curPic.relevant_comorbidities?.length > 0 && (
                  <div style={{ borderTop: `1px solid ${T.border}`, marginTop: "1rem", paddingTop: "1rem" }}>
                    <span style={S.kvLabel}>Relevant Comorbidities</span>
                    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {curPic.relevant_comorbidities.map((c, i) => (
                        <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                          <span style={{ fontSize: "0.5rem", marginTop: "6px", color: T.textMuted }}>●</span>
                          <p style={{ ...S.kvValue, margin: 0 }}>{s(c.condition)} — {s(c.relevance_to_ip_management)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </SectionBlock>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════
            TAB 2 — MONITORING
        ════════════════════════════════════════════ */}
        {tab === 2 && (
          <>
            {/* Risk Stratification */}
            {Object.keys(risk).length > 0 && (
              <SectionBlock
                title="Risk Stratification"
                sub="Clinical risk assessment"
                action={<RiskBadge level={risk.overall_risk?.level} />}
              >
                {risk.overall_risk && (
                  <div style={{ background: T.bgAlt, border: `1px solid ${T.border}`, padding: "1rem", marginBottom: "1rem" }}>
                    <KV label="Overall Risk Level" value={risk.overall_risk.level} />
                    <KV label="Key Risk Drivers" value={risk.overall_risk.key_risk_drivers?.join(", ")} />
                    <KV label="Clinical Justification" value={risk.overall_risk.clinical_justification} />
                  </div>
                )}
                {risk.high_risk_comorbidities?.length > 0 && (
                  <>
                    <span style={{ ...S.kvLabel, marginBottom: "0.5rem", display: "block" }}>High Risk Comorbidities</span>
                    {risk.high_risk_comorbidities.map((c, i) => (
                      <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.5rem", background: T.bgAlt }}>
                        <KV label="Comorbidity" value={c.comorbidity} />
                        <KV label="Risk Mechanism" value={c.risk_mechanism} />
                        <KV label="Management" value={c.management_implication} />
                      </div>
                    ))}
                  </>
                )}
                {risk.red_flags?.length > 0 && (
                  <>
                    <span style={{ ...S.kvLabel, marginTop: "1rem", marginBottom: "0.5rem", display: "block" }}>Red Flags</span>
                    {risk.red_flags.map((rf, i) => (
                      <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                          <span style={{ ...S.kvValue, fontWeight: 400, color: T.text }}>{s(rf.red_flag)}</span>
                          <UrgencyBadge val={rf.urgency} />
                        </div>
                        <p style={{ ...S.kvValue, margin: 0, fontSize: "0.72rem" }}>{s(rf.clinical_implication)}</p>
                      </div>
                    ))}
                  </>
                )}
              </SectionBlock>
            )}

            {/* Critical Conditions */}
            {critical.critical_conditions?.length > 0 && (
              <SectionBlock title="Critical Conditions to Watch" sub="Conditions requiring close surveillance">
                {critical.critical_conditions.map((c, i) => (
                  <div key={i} style={{ border: `1px solid ${T.border}`, padding: "1rem", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                      <p style={{ ...S.kvValue, fontWeight: 400, color: T.text, margin: 0, fontSize: "0.85rem" }}>{s(c.condition)}</p>
                      <UrgencyBadge val={c.priority} />
                    </div>
                    <div className="ip-two-col" style={S.twoCol}>
                      <div>
                        <KV label="Why Critical" value={c.why_critical} />
                        <KV label="Supporting Evidence" value={c.supporting_evidence} />
                      </div>
                      <div>
                        <KV label="Current Status" value={c.current_status} />
                        <KV label="Time Sensitivity" value={c.time_sensitivity} />
                      </div>
                    </div>
                  </div>
                ))}
              </SectionBlock>
            )}

            {/* Monitoring Plan */}
            {Object.keys(monitoring).length > 0 && (
              <SectionBlock
                title="Monitoring Plan"
                sub="Scheduled monitoring parameters"
                action={<Badge label={`Acuity: ${s(monitoring.monitoring_acuity)}`} />}
              >
                {monitoring.vital_signs?.length > 0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <span style={{ ...S.kvLabel, marginBottom: "0.5rem", display: "block" }}>Vital Signs</span>
                    <StyledTable
                      headers={["Parameter", "Frequency", "Warning Threshold", "Action"]}
                      rows={monitoring.vital_signs.map(v => [
                        s(v.parameter), s(v.frequency), s(v.warning_threshold), s(v.action_on_breach)
                      ])}
                    />
                  </div>
                )}
                {monitoring.laboratory_parameters?.length > 0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <span style={{ ...S.kvLabel, marginBottom: "0.5rem", display: "block" }}>Laboratory Parameters</span>
                    <StyledTable
                      headers={["Parameter", "Frequency", "Warning Threshold", "Action"]}
                      rows={monitoring.laboratory_parameters.map(l => [
                        s(l.parameter), s(l.frequency), s(l.warning_threshold), s(l.action_on_breach)
                      ])}
                    />
                  </div>
                )}
                {monitoring.medication_monitoring?.length > 0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <span style={{ ...S.kvLabel, marginBottom: "0.5rem", display: "block" }}>Medication Monitoring</span>
                    <StyledTable
                      headers={["Medication", "Parameter", "Frequency", "Toxicity Threshold"]}
                      rows={monitoring.medication_monitoring.map(m => [
                        s(m.medication), s(m.parameter_to_monitor), s(m.frequency), s(m.toxicity_threshold)
                      ])}
                    />
                  </div>
                )}
                {monitoring.imaging_procedure_followup?.length > 0 && (
                  <div>
                    <span style={{ ...S.kvLabel, marginBottom: "0.5rem", display: "block" }}>Imaging Follow-up</span>
                    <StyledTable
                      headers={["Investigation", "Frequency", "Purpose"]}
                      rows={monitoring.imaging_procedure_followup.map(i => [
                        s(i.investigation), s(i.when), s(i.purpose)
                      ])}
                    />
                  </div>
                )}
              </SectionBlock>
            )}

            {/* Immediate Actions */}
            {critical.immediate_actions_required?.length > 0 && (
              <SectionBlock title="Critical Actions" sub="Immediate actions required">
                <StyledTable
                  headers={["Action", "Reason", "Timeframe", "Responsible"]}
                  rows={critical.immediate_actions_required.map(a => [
                    s(a.action), s(a.reason), s(a.timeframe), s(a.responsible)
                  ])}
                />
              </SectionBlock>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════
            TAB 3 — CARE PLAN
        ════════════════════════════════════════════ */}
        {tab === 3 && (
          <>
            {/* Immediate Actions 0-6h */}
            {carePlanRaw.immediate_actions_0_6h?.length > 0 && (
              <SectionBlock title="Immediate Actions (0–6 Hours)" sub="Critical first interventions">
                {carePlanRaw.immediate_actions_0_6h.map((a, i) => (
                  <div key={i} style={{ border: `1px solid ${T.border}`, padding: "1rem", marginBottom: "0.75rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                    <div style={{
                      width: "28px", height: "28px", borderRadius: "50%",
                      background: T.text, color: T.bg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.65rem", fontWeight: 400, flexShrink: 0,
                      fontFamily: FONT,
                    }}>{s(a.step)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                        <span style={{ ...S.kvValue, fontWeight: 400, color: T.text }}>{s(a.action)}</span>
                        <Badge label={s(a.priority)} variant="filled" />
                      </div>
                      <p style={{ ...S.kvValue, margin: "4px 0 2px", fontSize: "0.72rem" }}>{s(a.reason)}</p>
                      <span style={S.kvLabel}>Responsible: {s(a.responsible)}</span>
                    </div>
                  </div>
                ))}
              </SectionBlock>
            )}

            {/* Day 1 Plan */}
            {carePlanRaw.day_1_plan?.length > 0 && (
              <SectionBlock title="Day 1 Clinical Plan">
                <StyledTable
                  headers={["Item", "Category", "Details", "Timing"]}
                  rows={carePlanRaw.day_1_plan.map(p => [
                    s(p.item), s(p.category), s(p.details), s(p.timing)
                  ])}
                />
              </SectionBlock>
            )}

            {/* Diagnostic Workup */}
            {carePlanRaw.diagnostic_workup?.length > 0 && (
              <SectionBlock title="Diagnostic Workup" sub="Pending and planned investigations">
                <StyledTable
                  headers={["Investigation", "Purpose", "Urgency", "When"]}
                  rows={carePlanRaw.diagnostic_workup.map(i => [
                    s(i.investigation), s(i.purpose), <UrgencyBadge key="u" val={i.urgency} />, s(i.when_to_order)
                  ])}
                />
              </SectionBlock>
            )}

            {/* Treatment Plan */}
            {carePlanRaw.treatment_plan?.length > 0 && (
              <SectionBlock title="Treatment Plan" sub="Planned therapeutic interventions">
                <StyledTable
                  headers={["Treatment", "Type", "Indication", "Duration"]}
                  rows={carePlanRaw.treatment_plan.map(t => [
                    s(t.treatment), s(t.type), s(t.indication), s(t.duration)
                  ])}
                />
              </SectionBlock>
            )}

            {/* Procedure / Surgical Plan */}
            {carePlanRaw.procedure_surgical_plan?.length > 0 && (
              <SectionBlock title="Procedure / Surgical Plan" sub="Planned procedures">
                {carePlanRaw.procedure_surgical_plan.map((p, i) => (
                  <div key={i} style={{ border: `1px solid ${T.border}`, padding: "1rem", marginBottom: "0.75rem" }}>
                    <p style={{ ...S.kvValue, fontWeight: 400, color: T.text, margin: "0 0 0.75rem" }}>{s(p.procedure)}</p>
                    <div className="ip-two-col" style={S.twoCol}>
                      <div>
                        <KV label="Indication" value={p.indication} />
                        <KV label="Planned Timing" value={p.planned_timing} />
                      </div>
                      <div>
                        <KV label="Pre-procedure Requirements" value={p.pre_procedure_requirements?.join(", ")} />
                        <KV label="Post-procedure Monitoring" value={p.post_procedure_monitoring?.join(", ")} />
                      </div>
                    </div>
                  </div>
                ))}
              </SectionBlock>
            )}

            {/* Consultations */}
            {carePlanRaw.consultations?.length > 0 && (
              <SectionBlock title="Consultations" sub="Required consultations">
                <StyledTable
                  headers={["Department", "Reason", "Urgency", "Expected Contribution"]}
                  rows={carePlanRaw.consultations.map(c => [
                    s(c.department), s(c.reason), <UrgencyBadge key="u" val={c.urgency} />, s(c.expected_contribution)
                  ])}
                />
              </SectionBlock>
            )}

            {/* Nutrition Plan */}
            {carePlanRaw.nutrition_fluid_plan && (
              <SectionBlock title="Nutritional Support" sub="Nutrition & fluid plan">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Diet Type" value={carePlanRaw.nutrition_fluid_plan.diet_type} />
                    <KV label="Nutritional Support" value={carePlanRaw.nutrition_fluid_plan.nutritional_support} />
                  </div>
                  <div>
                    <KV label="IV Fluids" value={carePlanRaw.nutrition_fluid_plan.iv_fluids} />
                    <KV label="IO Monitoring" value={carePlanRaw.nutrition_fluid_plan.io_monitoring} />
                  </div>
                </div>
              </SectionBlock>
            )}

            {/* Discharge Planning */}
            {carePlanRaw.discharge_planning && (
              <SectionBlock title="Discharge Planning" sub="Discharge criteria and follow-up">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Estimated LOS" value={carePlanRaw.discharge_planning.estimated_los} />
                    {carePlanRaw.discharge_planning.expected_discharge_criteria?.length > 0 && (
                      <>
                        <span style={{ ...S.kvLabel, marginTop: "0.5rem", display: "block" }}>Discharge Criteria</span>
                        <div style={{ marginTop: "0.25rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                          {carePlanRaw.discharge_planning.expected_discharge_criteria.map((c, i) => (
                            <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                              <span style={{ fontSize: "0.6rem", marginTop: "4px", color: T.textMuted }}>✓</span>
                              <p style={{ ...S.kvValue, margin: 0 }}>{s(c)}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    <KV label="Follow-Up Plan" value={carePlanRaw.discharge_planning.follow_up_plan} />
                    <KV label="Post-Discharge Medications" value={carePlanRaw.discharge_planning.post_discharge_medications?.join(", ")} />
                    {carePlanRaw.discharge_planning.patient_education_needed?.length > 0 && (
                      <>
                        <span style={{ ...S.kvLabel, marginTop: "0.5rem", display: "block" }}>Patient Education</span>
                        <div style={{ marginTop: "0.25rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                          {carePlanRaw.discharge_planning.patient_education_needed.map((e, i) => (
                            <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                              <span style={{ fontSize: "0.5rem", marginTop: "6px", color: T.textMuted }}>●</span>
                              <p style={{ ...S.kvValue, margin: 0 }}>{s(e)}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </SectionBlock>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════
            TAB 4 — TREATMENTS
        ════════════════════════════════════════════ */}
        {tab === 4 && (
          <>
            {/* Treatments Tried */}
            {treatments.treatments_tried?.length > 0 && (
              <SectionBlock title="Treatments Tried" sub="Previously administered therapies">
                <StyledTable
                  headers={["Treatment", "Type", "Start Date", "End Date", "Outcome"]}
                  rows={treatments.treatments_tried.map(t => [
                    s(t.treatment),
                    <Badge key="tp" label={s(t.type)} />,
                    s(t.start_date),
                    s(t.end_date || "Ongoing"),
                    s(t.outcome),
                  ])}
                />
              </SectionBlock>
            )}

            {/* Treatment Response Summary */}
            {treatments.treatment_response_summary && (
              <SectionBlock title="Treatment Response Summary" sub="Effectiveness assessment">
                <KV label="Overall Response" value={treatments.treatment_response_summary.overall_response} />
                <KV label="Narrative" value={treatments.treatment_response_summary.narrative} />
                {treatments.treatment_response_summary.effective_treatments?.length > 0 && (
                  <>
                    <span style={{ ...S.kvLabel, marginTop: "0.5rem", display: "block" }}>Effective Treatments</span>
                    <div style={{ marginTop: "0.35rem" }}>
                      <TagRow items={treatments.treatment_response_summary.effective_treatments} />
                    </div>
                  </>
                )}
              </SectionBlock>
            )}

            {/* Failed Therapies */}
            {treatments.failed_therapies?.length > 0 && (
              <SectionBlock title="Failed Therapies">
                <StyledTable
                  headers={["Therapy", "Reason for Failure", "Date"]}
                  rows={treatments.failed_therapies.map(f => [
                    s(f.therapy), s(f.reason_for_failure), s(f.date)
                  ])}
                />
              </SectionBlock>
            )}

            {/* Escalation Reason */}
            {treatments.escalation_reason && (
              <SectionBlock title="Escalation Reason" sub="Reason for treatment escalation">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Primary Classification" value={treatments.escalation_reason.primary_classification} />
                    <KV label="Secondary Classifications" value={treatments.escalation_reason.secondary_classifications?.join(", ")} />
                  </div>
                  <div>
                    <KV label="Specific Reason" value={treatments.escalation_reason.specific_reason} />
                    <KV label="Evidence" value={treatments.escalation_reason.evidence} />
                  </div>
                </div>
                <div style={{ borderTop: `1px solid ${T.border}`, marginTop: "0.75rem", paddingTop: "0.75rem" }}>
                  <KV label="Clinical Narrative" value={treatments.escalation_reason.clinical_narrative} />
                </div>
              </SectionBlock>
            )}

            {/* Treatment Journey */}
            {treatments.treatment_journey_summary && (
              <SectionBlock title="Clinical Journey" sub="Treatment journey summary">
                <p style={{ ...S.kvValue, lineHeight: 1.7, margin: 0 }}>{treatments.treatment_journey_summary}</p>
              </SectionBlock>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════
            TAB 5 — INSURANCE
        ════════════════════════════════════════════ */}
        {tab === 5 && (
          <>
            {/* Clinical Criteria */}
            {Object.keys(insurance).length > 0 && (
              <SectionBlock
                title="Clinical Criteria"
                sub="Insurance approval criteria"
                action={
                  <Badge
                    label={insurance.clinical_criteria_met?.overall_criteria_met ? "All Criteria Met" : "Criteria Incomplete"}
                    variant={insurance.clinical_criteria_met?.overall_criteria_met ? "filled" : "dark"}
                  />
                }
              >
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "1px",
                  background: T.border,
                  border: `1px solid ${T.border}`,
                }} className="ip-three-col">
                  {Object.entries(insurance.clinical_criteria_met || {})
                    .filter(([k]) => k !== "overall_criteria_met")
                    .map(([k, v]) => (
                      <div key={k} style={{ background: T.bg, padding: "0.875rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                          <span style={{ ...S.kvLabel, margin: 0, textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
                          <Badge label={v?.met ? "Met" : "Not Met"} variant={v?.met ? "filled" : "dark"} />
                        </div>
                        {v?.evidence && <p style={{ ...S.kvValue, fontSize: "0.68rem", margin: "0 0 4px" }}>{s(v.evidence)}</p>}
                        {v?.procedures && <p style={{ ...S.kvValue, fontSize: "0.68rem", margin: 0, color: T.textMuted }}>Procedures: {v.procedures.join(", ")}</p>}
                      </div>
                    ))}
                </div>
              </SectionBlock>
            )}

            {/* Pre-authorization */}
            {insurance.pre_authorization && (
              <SectionBlock title="Insurance Authorization" sub="Pre-authorization status">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Status" value={insurance.pre_authorization.status} />
                    <KV label="Justification Strength" value={insurance.pre_authorization.justification_strength} />
                  </div>
                  <div>
                    <KV label="Denial Risks" value={insurance.pre_authorization.denial_risks?.join(", ")} />
                    <KV label="Recommended Actions" value={insurance.pre_authorization.recommended_actions?.join(", ")} />
                  </div>
                </div>
              </SectionBlock>
            )}

            {/* Required Documents */}
            {insurance.required_documents?.length > 0 && (
              <SectionBlock title="Missing Documentation" sub="Required documents for approval">
                <StyledTable
                  headers={["Document", "Purpose", "Urgency", "Available"]}
                  rows={insurance.required_documents.map(d => [
                    s(d.document), s(d.purpose), <UrgencyBadge key="u" val={d.urgency} />, d.available ? "Yes" : "No"
                  ])}
                />
              </SectionBlock>
            )}

            {/* ICD-10 Codes */}
            {insurance.icd10_codes && (
              <SectionBlock title="ICD-10 Codes" sub="Billing and coding">
                <div style={{ background: T.bgAlt, border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "1rem" }}>
                  <span style={S.kvLabel}>Primary</span>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.35rem" }}>
                    <Badge label={s(insurance.icd10_codes.primary?.code)} variant="filled" />
                    <span style={S.kvValue}>{s(insurance.icd10_codes.primary?.description)}</span>
                  </div>
                </div>
                {insurance.icd10_codes.secondary?.length > 0 && (
                  <>
                    <span style={{ ...S.kvLabel, display: "block", marginBottom: "0.5rem" }}>Secondary</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {insurance.icd10_codes.secondary.map((c, i) => (
                        <div key={i} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          <Badge label={s(c.code)} variant="dark" />
                          <span style={S.kvValue}>{s(c.description)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {insurance.icd10_codes.procedure_codes?.length > 0 && (
                  <div style={{ borderTop: `1px solid ${T.border}`, marginTop: "1rem", paddingTop: "1rem" }}>
                    <span style={{ ...S.kvLabel, display: "block", marginBottom: "0.5rem" }}>Procedure Codes</span>
                    <TagRow items={insurance.icd10_codes.procedure_codes} />
                  </div>
                )}
              </SectionBlock>
            )}

            {/* Cost Estimate */}
            {insurance.cost_estimate && (
              <SectionBlock title="Financial Estimate" sub="Cost estimate">
                <div className="ip-two-col" style={S.twoCol}>
                  <div>
                    <KV label="Tier" value={insurance.cost_estimate.tier} />
                    <KV label="Estimated LOS" value={insurance.cost_estimate.estimated_los_days} />
                  </div>
                  <div>
                    <KV label="Key Cost Drivers" value={insurance.cost_estimate.key_cost_drivers?.join(", ")} />
                  </div>
                </div>
              </SectionBlock>
            )}

            {/* Documentation Gaps */}
            {insurance.documentation_gaps?.length > 0 && (
              <SectionBlock title="Critical Gaps" sub="Documentation gaps">
                <StyledTable
                  headers={["Missing Document", "Impact", "Urgency"]}
                  rows={insurance.documentation_gaps.map(g => [
                    s(g.missing_document), s(g.impact), <UrgencyBadge key="u" val={g.urgency} />
                  ])}
                />
              </SectionBlock>
            )}
          </>
        )}

      </div>
    </div>
  );
}                                                     