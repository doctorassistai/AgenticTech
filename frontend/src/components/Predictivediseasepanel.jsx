/**
 * PredictiveDiseasePanel.jsx  —  v4.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Aligned to PDGI v4.0 backend response structure.
 *
 * Backend response keys consumed:
 *   data.patient_education
 *     .section_01_your_current_health   → condition_cards, medications_plain, key_lab_values,
 *                                          allergies_and_history, overall_health_summary
 *     .section_02_what_to_watch_for     → short_term_risks, long_term_risks,
 *                                          early_warning_signs, qrisk3_plain
 *     .section_03_monitoring_checklist  → home_monitoring, clinical_tests
 *     .section_04_who_to_consult        → specialist_referrals, pharmacy_review
 *     .section_05_lifestyle             → what_to_eat (eat_more, reduce_or_avoid,
 *                                          dietary_conflicts), physical_activity,
 *                                          habits (build_these, stop_these),
 *                                          organ_specific_notes, motivational_note
 *     .patient_summary_headline
 *     .executive_summary
 *   data.qrisk3                         → score_percent, risk_category, interpretation, …
 *   data.organ_effect_analysis          → organ_health_registry, organ_effect_chains,
 *                                          organ_relationship_matrix,
 *                                          organ_effect_chain_narratives,
 *                                          patient_organ_health_overview,
 *                                          overall_organ_health
 *   data.confirmed_diagnoses            → quick-access array
 *   data.abnormal_signals_summary
 *   data.executive_summary
 *   data.errors, data.agent_timings, data.token_stats
 *
 * PDF export mirrors the sample MedConsolidate PDF:
 *   Cover → Section 01 → Section 02 → Section 03 → Section 04 → Section 05
 *   → Organ Analysis → Disclaimer
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Typography, Chip, Tabs, Tab, LinearProgress,
  Collapse, CircularProgress, Divider,
} from "@mui/material";
import {
  RefreshRounded, ExpandMoreRounded, ExpandLessRounded,
  WarningAmberRounded, ErrorRounded, CheckCircleRounded,
  InfoRounded, TrendingUpRounded, TrendingDownRounded,
  TrendingFlatRounded, FiberManualRecordRounded, TimelineRounded,
  MonitorHeartRounded, DownloadRounded, BiotechRounded,
  LocalHospitalRounded, AccessTimeRounded, ArticleRounded,
  VisibilityRounded, VerifiedRounded, FavoriteRounded,
  RestaurantRounded, HubRounded, BlockRounded, CheckRounded,
  WarningRounded, PersonRounded, MedicationRounded,
  ScienceRounded, HomeRounded, EventNoteRounded,
  PeopleRounded, FitnessCenterRounded,SpaRounded , 
  PriorityHighRounded, NotificationsActiveRounded,
} from "@mui/icons-material";
import jsPDF from "jspdf";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"DM Sans", "Open Sans", sans-serif';
const FW   = 300;

const C = {
  black: "#0a0a0a", ink: "#1a1a1a", charcoal: "#2e2e2e", smoke: "#4a4a4a",
  ash: "#7a7a7a", silver: "#a8a8a8", mist: "#d4d4d4", fog: "#e8e8e8",
  ghost: "#f4f4f4", white: "#ffffff",
  critical: "#b91c1c", criticalBg: "#fef2f2", criticalBdr: "#fecaca",
  high: "#c2410c",    highBg: "#fff7ed",    highBdr: "#fed7aa",
  moderate: "#92400e",moderateBg: "#fffbeb",moderateBdr: "#fde68a",
  low: "#166534",     lowBg: "#f0fdf4",     lowBdr: "#bbf7d0",
  info: "#1e40af",    infoBg: "#eff6ff",    infoBdr: "#bfdbfe",
  confirmed: "#581c87",confirmedBg: "#faf5ff",confirmedBdr: "#e9d5ff",
  teal: "#0f766e",    tealBg: "#f0fdfa",    tealBdr: "#99f6e4",
  sky: "#0369a1",     skyBg: "#f0f9ff",     skyBdr: "#bae6fd",
  organ: "#0891b2",   organBg: "#ecfeff",   organBdr: "#a5f3fc",
  avoid: "#be123c",   avoidBg: "#fff1f2",   avoidBdr: "#fecdd3",
  support:"#15803d",  supportBg:"#f0fdf4",  supportBdr:"#86efac",
  limit: "#b45309",   limitBg: "#fefce8",   limitBdr: "#fef08a",
  watch: "#7c3aed",   watchBg: "#f5f3ff",   watchBdr: "#ddd6fe",
};

const os  = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });
const card       = { background: C.white, border: `1px solid ${C.fog}`, borderRadius: "6px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" };
const sectionCard= { ...card, overflow: "hidden" };

const tabSx = {
  "& .MuiTab-root": {
    textTransform: "none", fontWeight: 300, fontFamily: FONT, fontSize: 12,
    minWidth: "auto", px: 2, color: C.ash, letterSpacing: "0.03em",
    "&.Mui-selected": { color: C.ink, fontWeight: 500 },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 2, borderRadius: "1px" },
  "& .MuiTabs-scrollButtons": { display: "flex" },
  borderBottom: `1px solid ${C.fog}`,
};

// ─── Severity / Badge configs ─────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  CRITICAL:      { color: C.critical,  bg: C.criticalBg,  bdr: C.criticalBdr,  dot: "#dc2626" },
  SERIOUS:       { color: C.high,      bg: C.highBg,      bdr: C.highBdr,      dot: "#ea580c" },
  HIGH_RISK:     { color: C.high,      bg: C.highBg,      bdr: C.highBdr,      dot: "#ea580c" },
  "HIGH RISK":   { color: C.high,      bg: C.highBg,      bdr: C.highBdr,      dot: "#ea580c" },
  MODERATE:      { color: C.moderate,  bg: C.moderateBg,  bdr: C.moderateBdr,  dot: "#d97706" },
  MILD:          { color: C.low,       bg: C.lowBg,       bdr: C.lowBdr,       dot: "#16a34a" },
  LOW:           { color: C.low,       bg: C.lowBg,       bdr: C.lowBdr,       dot: "#16a34a" },
  CONFIRMED:     { color: C.confirmed, bg: C.confirmedBg, bdr: C.confirmedBdr, dot: "#7c3aed" },
  "WATCH CLOSELY":{ color: C.watch,   bg: C.watchBg,     bdr: C.watchBdr,     dot: "#7c3aed" },
  WATCH_CLOSELY: { color: C.watch,    bg: C.watchBg,     bdr: C.watchBdr,     dot: "#7c3aed" },
};
const sevCfg = (s) => SEVERITY_CONFIG[(s || "").toUpperCase().replace(/ /g, "_")] || SEVERITY_CONFIG[(s || "").toUpperCase()] || { color: C.ash, bg: C.ghost, bdr: C.fog, dot: C.silver };

const organScoreColor = (score) => {
  if (score >= 85) return { color: C.low,      bg: C.lowBg,      bdr: C.lowBdr,      label: "Healthy" };
  if (score >= 65) return { color: C.teal,     bg: C.tealBg,     bdr: C.tealBdr,     label: "Mild concern" };
  if (score >= 45) return { color: C.moderate, bg: C.moderateBg, bdr: C.moderateBdr, label: "Moderate concern" };
  if (score >= 25) return { color: C.high,     bg: C.highBg,     bdr: C.highBdr,     label: "High concern" };
  return               { color: C.critical,  bg: C.criticalBg, bdr: C.criticalBdr, label: "Critical" };
};

const URGENCY_CONFIG = {
  HIGH:       { color: C.critical,  bg: C.criticalBg,  bdr: C.criticalBdr },
  MEDIUM:     { color: C.moderate,  bg: C.moderateBg,  bdr: C.moderateBdr },
  ANNUAL:     { color: C.info,      bg: C.infoBg,      bdr: C.infoBdr },
  "6 MONTHS": { color: C.teal,      bg: C.tealBg,      bdr: C.tealBdr },
  ONGOING:    { color: C.low,       bg: C.lowBg,       bdr: C.lowBdr },
  "AS NEEDED":{ color: C.ash,       bg: C.ghost,       bdr: C.fog },
};
const urgCfg = (u) => URGENCY_CONFIG[(u || "").toUpperCase()] || { color: C.ash, bg: C.ghost, bdr: C.fog };

// ─── Shared micro-components ──────────────────────────────────────────────────
const Label = ({ children, sx = {} }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em" }), ...sx }}>
    {children}
  </Typography>
);

const SeverityBadge = ({ level, size = "small" }) => {
  const cfg = sevCfg(level);
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5,
      px: size === "large" ? 1.5 : 1, py: size === "large" ? 0.6 : 0.3,
      borderRadius: "3px", background: cfg.bg, border: `1px solid ${cfg.bdr}` }}>
      <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
      <Typography sx={{ ...os({ fontSize: size === "large" ? 12 : 10, color: cfg.color, fontWeight: 500 }) }}>
        {level}
      </Typography>
    </Box>
  );
};

const UrgencyBadge = ({ urgency }) => {
  const cfg = urgCfg(urgency);
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.3,
      borderRadius: "3px", background: cfg.bg, border: `1px solid ${cfg.bdr}` }}>
      <AccessTimeRounded sx={{ fontSize: 10, color: cfg.color }} />
      <Typography sx={{ ...os({ fontSize: 10, color: cfg.color, fontWeight: 500 }) }}>{urgency}</Typography>
    </Box>
  );
};

const SectionHeader = ({ children, sub, icon, action }) => (
  <Box sx={{ px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 2,
    borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", gap: 2 }}>
    <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
      {icon && <Box sx={{ mt: 0.2, color: C.ash }}>{icon}</Box>}
      <Box>
        <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.01em" }) }}>{children}</Typography>
        {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>{sub}</Typography>}
      </Box>
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Box>
);

const ExpandableCard = ({ children, defaultOpen = true, headerContent, accentColor, noBg }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border: `1px solid ${accentColor || C.fog}`, borderRadius: "6px", overflow: "hidden", background: noBg ? "transparent" : C.white }}>
      <Box component="button" onClick={() => setOpen(v => !v)}
        sx={{ width: "100%", p: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <Box sx={{ px: 2.5, py: 1.75, display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 2,
          background: open ? C.white : C.ghost,
          "&:hover": { background: C.ghost }, transition: "background 0.15s" }}>
          {headerContent}
          {open
            ? <ExpandLessRounded sx={{ fontSize: 16, color: C.ash, flexShrink: 0 }} />
            : <ExpandMoreRounded sx={{ fontSize: 16, color: C.ash, flexShrink: 0 }} />}
        </Box>
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 2.5, pb: 2.5, pt: 1.5, borderTop: `1px solid ${C.fog}` }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
};

const EmptyState = ({ message, sub }) => (
  <Box sx={{ textAlign: "center", py: 6 }}>
    <InfoRounded sx={{ fontSize: 32, color: C.mist, mb: 1.5 }} />
    <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{message}</Typography>
    {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.silver, mt: 0.5 }) }}>{sub}</Typography>}
  </Box>
);

const QRISK3Gauge = ({ score }) => {
  if (score == null) return null;
  const pct      = Math.min(100, Math.max(0, score));
  const catColor = pct < 10 ? "#16a34a" : pct < 20 ? "#d97706" : "#dc2626";
  const catLabel = pct < 10 ? "LOW RISK" : pct < 20 ? "MODERATE RISK" : "HIGH RISK";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 3, px: 4 }}>
      <Box sx={{ position: "relative", width: 160, height: 80, mb: 1 }}>
        <svg width="160" height="80" viewBox="0 0 160 80">
          <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke={C.fog} strokeWidth="12" strokeLinecap="round" />
          <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke={catColor} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${pct * 2.2} 220`} style={{ transition: "stroke-dasharray 1s ease" }} />
        </svg>
        <Box sx={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 28, color: C.ink, lineHeight: 1 }) }}>{score}%</Typography>
          <Typography sx={{ ...os({ fontSize: 10, color: catColor, fontWeight: 600, letterSpacing: "0.06em" }) }}>{catLabel}</Typography>
        </Box>
      </Box>
      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textAlign: "center" }) }}>10-year estimated CVD / stroke risk</Typography>
    </Box>
  );
};

const OrganHealthBar = ({ organ, score, label, burdenLevel, isConfirmed }) => {
  const cfg = organScoreColor(score ?? 70);
  return (
    <Box sx={{ p: 2, border: `1px solid ${cfg.bdr}`, borderRadius: "6px", background: cfg.bg }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{organ}</Typography>
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
          {isConfirmed && <VerifiedRounded sx={{ fontSize: 12, color: C.confirmed }} />}
          <Typography sx={{ ...os({ fontSize: 16, color: cfg.color, fontWeight: 600 }) }}>{score ?? "—"}</Typography>
        </Box>
      </Box>
      <LinearProgress variant="determinate" value={score ?? 0}
        sx={{ height: 5, borderRadius: "3px", bgcolor: "rgba(0,0,0,0.08)", mb: 1,
          "& .MuiLinearProgress-bar": { bgcolor: cfg.color, borderRadius: "3px" } }} />
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
        <Box sx={{ display: "inline-flex", px: 1, py: 0.2, borderRadius: "2px", background: C.white, border: `1px solid ${cfg.bdr}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: cfg.color, fontWeight: 500 }) }}>{label ?? cfg.label}</Typography>
        </Box>
        {burdenLevel && burdenLevel !== "NONE" && <Label>{burdenLevel}</Label>}
      </Box>
    </Box>
  );
};

// ─── Agent progress bar ────────────────────────────────────────────────────────
const AgentProgressBar = ({ currentAgent }) => {
  const AGENTS = [
    "Phase 0A · Entity Typed Graph Fetcher",
    "Phase 0B · LLM Abnormality Assessor",
    "Phase 0C · Graph Preprocessor",
    "B_QRISK3 · CVD / Stroke Risk Score",
    "B10 · Predictive Narrative  [Section 02]",
    "B12 · Patient Understanding  [Sections 01 & 03]",
    "B_CONSULT · Consultant Map  [Section 04]",
    "B13 · Dietary Guidance  [Section 05 — parallel]",
    "B14 · Organ Effect Analysis  [parallel]",
  ];
  return (
    <Box sx={{ mt: 2 }}>
      {AGENTS.map((a, i) => {
        const done   = i < currentAgent;
        const active = i === currentAgent;
        return (
          <Box key={a} sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.7, px: 1,
            borderRadius: "3px", background: active ? C.ghost : "transparent" }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: done ? C.black : active ? C.charcoal : C.mist,
              animation: active ? "pulse 1.2s infinite" : "none",
              "@keyframes pulse": { "0%": { opacity: 0.4 }, "50%": { opacity: 1 }, "100%": { opacity: 0.4 } } }} />
            <Typography sx={{ ...os({ fontSize: 12, color: done ? C.ink : active ? C.charcoal : C.silver }) }}>{a}</Typography>
          </Box>
        );
      })}
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PDF EXPORT — matches MedConsolidate PDF structure
// ═══════════════════════════════════════════════════════════════════════════════
function generateMedicalPDF({ data, patientInfo, qrisk3, patientEducation, organEffectAnalysis }) {
  const doc    = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PAGE_W = 210, MARGIN = 16, CONTENT = PAGE_W - MARGIN * 2;
  let y = 0;

  const checkPage = (needed = 12) => { if (y + needed > 275) { doc.addPage(); y = 20; } };
  const hLine = (color = [220,220,220]) => { doc.setDrawColor(...color); doc.line(MARGIN, y, PAGE_W-MARGIN, y); };
  const bodyText = (text, color = [30,30,30], indent = 0) => {
    if (!text) return;
    checkPage(6); doc.setFontSize(9.5); doc.setFont("helvetica","normal"); doc.setTextColor(...color);
    doc.splitTextToSize(String(text), CONTENT-indent).forEach(l => { checkPage(5); doc.text(l, MARGIN+indent, y); y += 5; });
  };
  const sectionTitle = (title) => {
    checkPage(18); y += 4;
    doc.setFillColor(26,26,26); doc.rect(MARGIN, y-4, CONTENT, 10, "F");
    doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    doc.text(title, MARGIN+4, y+2.5);
    doc.setFont("helvetica","normal"); y += 12;
  };
  const subTitle = (title, colorArr=[60,60,60]) => {
    checkPage(12); y += 2;
    doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(...colorArr);
    doc.text(title, MARGIN, y); doc.setFont("helvetica","normal"); y += 7;
  };

  const pe = patientEducation || {};
  const s01 = pe.section_01_your_current_health  || {};
  const s02 = pe.section_02_what_to_watch_for    || {};
  const s03 = pe.section_03_monitoring_checklist || {};
  const s04 = pe.section_04_who_to_consult       || {};
  const s05 = pe.section_05_lifestyle            || {};

  // ── COVER ──
  y = 30;
  doc.setFillColor(26,26,26); doc.rect(0,0,PAGE_W,65,"F");
  doc.setFontSize(20); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
  doc.text("MedConsolidate | Patient Health Report", MARGIN, 22);
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.setTextColor(200,200,200);
  doc.text("Personal Health Consolidation — A complete summary tailored for you", MARGIN, 32);
  doc.setFontSize(8); doc.setTextColor(140,140,140);
  doc.text("CONFIDENTIAL  ·  This report is for informational purposes only. Consult your physician before making any medical decisions.", MARGIN, 42);
  y = 75;

  if (patientInfo?.patient_name) {
    doc.setFillColor(240,240,240); doc.rect(MARGIN, y-4, CONTENT, 32, "F");
    doc.setFontSize(8); doc.setFont("helvetica","bold"); doc.setTextColor(120,120,120);
    doc.text("PATIENT INFORMATION", MARGIN+3, y+1); y += 7;
    doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
    doc.text(patientInfo.patient_name, MARGIN+3, y); y += 7;
    const meta = [];
    if (patientInfo.age)    meta.push(`Age: ${patientInfo.age}`);
    if (patientInfo.gender) meta.push(`Gender: ${patientInfo.gender}`);
    if (patientInfo.hms_id) meta.push(`HMS ID: ${patientInfo.hms_id}`);
    doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.setTextColor(60,60,60);
    if (meta.length) { doc.text(meta.join("   ·   "), MARGIN+3, y); y += 5; }
    doc.setFontSize(8.5); doc.setTextColor(80,80,80);
    doc.text(`Report Generated: ${new Date().toLocaleDateString("en-IN",{dateStyle:"long"})}`, MARGIN+3, y); y += 8;
  }

  // ── SECTION 01: YOUR CURRENT HEALTH ──
  sectionTitle("01 | Your Current Health — In Plain Language");
  bodyText(s01.section_intro, [60,60,60]); y += 2;

  (s01.condition_cards || [])
  .slice(0, 4)   // Only first 4 diagnoses
  .forEach(card => {
    checkPage(36);
    const severityColors = {
      CRITICAL:       [[185,28,28],[254,242,242],[254,202,202]],
      SERIOUS:        [[194,65,12],[255,247,237],[254,215,170]],
      MODERATE:       [[146,64,14],[255,251,235],[253,230,138]],
      MILD:           [[22,101,52],[240,253,244],[187,247,208]],
      "WATCH CLOSELY":[[124,58,237],[245,243,255],[221,214,254]],
    };
    const sc = severityColors[card.severity_badge] || [[80,80,80],[244,244,244],[220,220,220]];
    doc.setFillColor(...sc[1]); doc.setDrawColor(...sc[2]);
    const blockH = 14 + (card.what_it_is?10:0) + (card.what_it_means_for_life?10:0) + (card.current_status?6:0) + (card.key_number?6:0);
    doc.rect(MARGIN, y-4, CONTENT, blockH+8, "FD");
    doc.setFontSize(8); doc.setFont("helvetica","bold"); doc.setTextColor(...sc[0]);
    doc.text(card.severity_badge || "—", PAGE_W-MARGIN-doc.getTextWidth(card.severity_badge||"")-2, y+2);
    doc.setFontSize(12); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
    doc.text(card.condition_plain_name || card.condition_medical_name || "—", MARGIN+3, y+4); y += 10;
    doc.setFont("helvetica","normal");
    if (card.what_it_is)             { bodyText(card.what_it_is, [60,60,60]); }
    if (card.what_it_means_for_life) { bodyText(card.what_it_means_for_life, [90,90,90]); }
    if (card.current_status)         { bodyText(card.current_status, [100,100,100]); }
    if (card.key_number) {
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(...sc[0]);
      doc.text(`Key number: ${card.key_number}`, MARGIN+3, y); y += 4.5;
      if (card.key_number_context) { doc.setFont("helvetica","italic"); doc.setFontSize(8.5); doc.setTextColor(100,100,100); doc.text(card.key_number_context, MARGIN+3, y); y += 4.5; doc.setFont("helvetica","normal"); }
    }
    y += 5;
  });

  // Medications
  if (s01.medications_plain?.length) {
    subTitle("Current Medications Simplified");
    const cols = [40, 40, CONTENT-80];
    const headers = ["Medicine", "Dose", "What It Does (Simply)"];
    checkPage(10);
    doc.setFillColor(40,40,40); doc.rect(MARGIN, y-4, CONTENT, 8, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    let cx = MARGIN+2;
    headers.forEach((h,i) => { doc.text(h, cx, y+1); cx += cols[i]; });
    y += 8;
    doc.setFont("helvetica","normal"); doc.setTextColor(30,30,30);
    s01.medications_plain.forEach((med, mi) => {
      checkPage(8);
      if (mi % 2 === 0) { doc.setFillColor(248,248,248); doc.rect(MARGIN, y-3, CONTENT, 7, "F"); }
      cx = MARGIN+2;
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(String(med.medicine_name||"").slice(0,22), cx, y+1); cx += cols[0];
      doc.setFont("helvetica","normal"); doc.setTextColor(60,60,60);
      doc.text(String(med.dose_and_frequency||"").slice(0,20), cx, y+1); cx += cols[1];
      doc.text(String(med.what_it_does_simply||"").slice(0,50), cx, y+1); y += 7;
    });
    y += 4;
  }

  // Summary
  if (s01.overall_health_summary) { checkPage(12); bodyText(s01.overall_health_summary, [50,50,50]); y += 2; }

  // ── SECTION 02: WHAT TO WATCH FOR ──
  sectionTitle("02 | What to Watch For — Risks & Predictions");
  bodyText(s02.section_intro, [60,60,60]); y += 2;

  const shortRisks = s02.short_term_risks?.items || [];
  const longRisks  = s02.long_term_risks?.items  || [];

  if (shortRisks.length) {
    subTitle("SHORT-TERM RISKS (Next 3–6 Months)", [194,65,12]);
    shortRisks.forEach(r => {
      checkPage(16);
      doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(`• ${r.risk_name||"—"}  [${r.severity_badge||""}]`, MARGIN, y); y += 5;
      if (r.plain_description)   { bodyText(r.plain_description, [70,70,70]); }
      if (r.what_patient_feels)  { doc.setFontSize(8.5); doc.setFont("helvetica","italic"); doc.setTextColor(110,110,110); doc.text(`You may feel: ${r.what_patient_feels}`, MARGIN+2, y); y += 4.5; doc.setFont("helvetica","normal"); }
    });
    y += 3;
  }

  if (longRisks.length) {
    subTitle("LONG-TERM RISKS (1–5 Years)", [146,64,14]);
    longRisks.forEach(r => {
      checkPage(18);
      doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(`• ${r.risk_name||"—"}  [${r.severity_badge||""}]`, MARGIN, y); y += 5;
      if (r.plain_description)    { bodyText(r.plain_description, [70,70,70]); }
      if (r.why_this_patient)     { bodyText(r.why_this_patient, [90,90,90]); }
      if (r.preventability_note)  { doc.setFontSize(8.5); doc.setFont("helvetica","italic"); doc.setTextColor(100,100,100); doc.text(r.preventability_note, MARGIN+2, y); y += 4.5; doc.setFont("helvetica","normal"); }
    });
    y += 3;
  }

  const warningGroups = s02.early_warning_signs?.groups || [];
  if (warningGroups.length) {
    subTitle("EARLY WARNING SIGNS — SEEK HELP IMMEDIATELY IF YOU NOTICE", [185,28,28]);
    const cols2 = CONTENT / 2;
    const leftGroups  = warningGroups.filter((_,i) => i % 2 === 0);
    const rightGroups = warningGroups.filter((_,i) => i % 2 !== 0);
    const maxRows = Math.max(leftGroups.length, rightGroups.length);
    for (let gi = 0; gi < maxRows; gi++) {
      const renderGroup = (grp, xOff) => {
        if (!grp) return;
        doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(185,28,28);
        doc.text(grp.group_name||"", MARGIN+xOff, y); y += 5;
        doc.setFont("helvetica","normal"); doc.setTextColor(50,50,50);
        (grp.signs||[]).forEach(s => { checkPage(5); doc.text(`• ${s}`, MARGIN+xOff+2, y); y += 4.5; });
      };
      const yStart = y;
      renderGroup(leftGroups[gi], 0);
      const yAfterLeft = y;
      y = yStart;
      renderGroup(rightGroups[gi], cols2);
      y = Math.max(yAfterLeft, y) + 4;
    }
    y += 3;
  }

  // QRISK3 plain
  const qp = s02.qrisk3_plain || {};
  if (qp.score_percent != null) {
    checkPage(16);
    const qrc = qp.score_percent < 10 ? [22,101,52] : qp.score_percent < 20 ? [146,64,14] : [185,28,28];
    doc.setFillColor(...qrc); doc.roundedRect(MARGIN, y, 100, 12, 1, 1, "F");
    doc.setFontSize(12); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    doc.text(`QRISK3: ${qp.score_percent}%  ·  ${qp.risk_category_plain||""}`, MARGIN+4, y+8);
    y += 18;
    if (qp.plain_statement) { bodyText(qp.plain_statement, [30,30,30]); }
    if (qp.caveat)          { doc.setFontSize(8); doc.setFont("helvetica","italic"); doc.setTextColor(120,120,120); doc.text(qp.caveat, MARGIN, y); y += 5; doc.setFont("helvetica","normal"); }
    y += 3;
  }

  // ── SECTION 03: MONITORING CHECKLIST ──
  sectionTitle("03 | Your Monitoring Checklist");
  bodyText(s03.section_intro, [60,60,60]); y += 2;

  const homeChecks = s03.home_monitoring || [];
  if (homeChecks.length) {
    subTitle("At Home — Self-Monitoring");
    checkPage(10);
    const hcCols = [50, 35, CONTENT-85];
    doc.setFillColor(40,40,40); doc.rect(MARGIN, y-4, CONTENT, 8, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    ["What to Check","How Often","Target / Goal"].forEach((h,i) => {
      const xc = MARGIN+2+(i===0?0:i===1?hcCols[0]:hcCols[0]+hcCols[1]);
      doc.text(h, xc, y+1);
    });
    y += 8;
    homeChecks.forEach((chk, ci) => {
      checkPage(8);
      if (ci % 2 === 0) { doc.setFillColor(248,248,248); doc.rect(MARGIN, y-3, CONTENT, 7, "F"); }
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(String(chk.what_to_check||"").slice(0,26), MARGIN+2, y+1);
      doc.setFont("helvetica","normal"); doc.setTextColor(60,60,60);
      doc.text(String(chk.how_often||"").slice(0,22), MARGIN+2+hcCols[0], y+1);
      doc.text(String(chk.target_or_goal||"—").slice(0,38), MARGIN+2+hcCols[0]+hcCols[1], y+1);
      y += 7;
    });
    y += 5;
  }

  const clinTests = s03.clinical_tests || [];
  if (clinTests.length) {
    subTitle("Clinical Tests — Lab & Doctor Visits");
    const ctCols = [60, 30, CONTENT-90];
    checkPage(10);
    doc.setFillColor(40,40,40); doc.rect(MARGIN, y-4, CONTENT, 8, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    ["Test","Frequency","Purpose"].forEach((h,i) => {
      const xc = MARGIN+2+(i===0?0:i===1?ctCols[0]:ctCols[0]+ctCols[1]);
      doc.text(h, xc, y+1);
    });
    y += 8;
    clinTests.forEach((t, ti) => {
      checkPage(8);
      if (ti % 2 === 0) { doc.setFillColor(248,248,248); doc.rect(MARGIN, y-3, CONTENT, 7, "F"); }
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(String(t.test_name||"").slice(0,32), MARGIN+2, y+1);
      doc.setFont("helvetica","normal"); doc.setTextColor(60,60,60);
      doc.text(String(t.how_often||"").slice(0,18), MARGIN+2+ctCols[0], y+1);
      doc.text(String(t.purpose_plain||"").slice(0,38), MARGIN+2+ctCols[0]+ctCols[1], y+1);
      y += 7;
    });
    y += 5;
  }

  // ── SECTION 04: WHO TO CONSULT ──
  sectionTitle("04 | Who You Should Consult");
  bodyText(s04.section_intro, [60,60,60]); y += 2;

  const referrals = s04.specialist_referrals || [];
  if (referrals.length) {
    checkPage(10);
    const refCols = [52, 35, CONTENT-87];
    doc.setFillColor(40,40,40); doc.rect(MARGIN, y-4, CONTENT, 8, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    ["Specialist","Urgency","Why You Need Them"].forEach((h,i) => {
      const xc = MARGIN+2+(i===0?0:i===1?refCols[0]:refCols[0]+refCols[1]);
      doc.text(h, xc, y+1);
    });
    y += 8;
    referrals.forEach((ref, ri) => {
      checkPage(10);
      if (ri % 2 === 0) { doc.setFillColor(248,248,248); doc.rect(MARGIN, y-3, CONTENT, 8, "F"); }
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(String(ref.specialist_type||"").slice(0,28), MARGIN+2, y+2);
      const urgColor = ref.urgency === "HIGH" ? [185,28,28] : ref.urgency === "MEDIUM" ? [146,64,14] : [22,101,52];
      doc.setTextColor(...urgColor); doc.text(ref.urgency||"—", MARGIN+2+refCols[0], y+2);
      doc.setFont("helvetica","normal"); doc.setTextColor(60,60,60);
      doc.text(String(ref.why_needed||"").slice(0,46), MARGIN+2+refCols[0]+refCols[1], y+2);
      y += 8;
    });
    y += 4;
  }

  // ── SECTION 05: LIFESTYLE ──
  sectionTitle("05 | Diet, Habits & Lifestyle Changes");
  bodyText(s05.what_to_eat?.intro || s05.section_intro, [60,60,60]); y += 2;

  const eatMore = s05.what_to_eat?.eat_more || [];
  const avoid   = s05.what_to_eat?.reduce_or_avoid || [];
  if (eatMore.length || avoid.length) {
    subTitle("What to Eat");
    const halfW = CONTENT / 2 - 2;
    checkPage(10);
    doc.setFillColor(21,128,61); doc.rect(MARGIN, y-3, halfW, 7, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    doc.text("EAT MORE OF THESE", MARGIN+2, y+1);
    doc.setFillColor(190,18,60); doc.rect(MARGIN+halfW+4, y-3, halfW, 7, "F");
    doc.text("REDUCE OR AVOID", MARGIN+halfW+6, y+1);
    y += 9;
    doc.setFont("helvetica","normal");
    const maxRows2 = Math.max(eatMore.length, avoid.length);
    for (let i = 0; i < maxRows2; i++) {
      checkPage(6);
      if (eatMore[i]) { doc.setTextColor(21,128,61); doc.setFontSize(9); doc.text(`• ${String(eatMore[i].food_item||"").slice(0,40)}`, MARGIN, y+1); }
      if (avoid[i])   { doc.setTextColor(190,18,60);  doc.setFontSize(9); doc.text(`• ${String(avoid[i].food_item||"").slice(0,40)}`, MARGIN+halfW+4, y+1); }
      y += 5.5;
    }
    y += 4;
  }

  // Activity
  const activities = s05.physical_activity?.activity_plan || [];
  if (activities.length) {
    subTitle("Physical Activity");
    activities.forEach(a => {
      checkPage(12);
      doc.setFontSize(9.5); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
      doc.text(`• ${a.activity||"—"}  (${a.frequency||""})`, MARGIN, y); y += 5;
      if (a.plain_benefit) { bodyText(a.plain_benefit, [80,80,80]); }
      if (a.caution)       { doc.setFontSize(8.5); doc.setFont("helvetica","italic"); doc.setTextColor(140,60,0); doc.text(a.caution, MARGIN+2, y); y += 4.5; doc.setFont("helvetica","normal"); }
    });
    y += 3;
  }

  // Habits
  const buildHabits = s05.habits?.build_these || [];
  const stopHabits  = s05.habits?.stop_these  || [];
  if (buildHabits.length || stopHabits.length) {
    subTitle("Habits to Build & Break");
    const halfH = CONTENT / 2 - 2;
    checkPage(10);
    doc.setFillColor(21,128,61); doc.rect(MARGIN, y-3, halfH, 7, "F");
    doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(255,255,255);
    doc.text("BUILD THESE HABITS", MARGIN+2, y+1);
    doc.setFillColor(185,28,28); doc.rect(MARGIN+halfH+4, y-3, halfH, 7, "F");
    doc.text("STOP THESE HABITS", MARGIN+halfH+6, y+1);
    y += 9; doc.setFont("helvetica","normal");
    const maxHabits = Math.max(buildHabits.length, stopHabits.length);
    for (let i = 0; i < maxHabits; i++) {
      checkPage(6);
      if (buildHabits[i]) { doc.setFontSize(8.5); doc.setTextColor(21,128,61); doc.text(`• ${String(buildHabits[i].habit||"").slice(0,40)}`, MARGIN, y+1); }
      if (stopHabits[i])  { doc.setFontSize(8.5); doc.setTextColor(185,28,28); doc.text(`• ${String(stopHabits[i].habit||"").slice(0,40)}`, MARGIN+halfH+4, y+1); }
      y += 5.5;
    }
    y += 3;
  }

  if (s05.motivational_note) {
    checkPage(18); y += 2;
    doc.setFillColor(240,249,255); doc.setDrawColor(186,230,253);
    const mnLines = doc.splitTextToSize(s05.motivational_note, CONTENT-8);
    doc.rect(MARGIN, y-4, CONTENT, mnLines.length*5+10, "FD");
    doc.setFontSize(9.5); doc.setFont("helvetica","italic"); doc.setTextColor(3,105,161);
    mnLines.forEach(l => { doc.text(l, MARGIN+4, y+2); y += 5; });
    doc.setFont("helvetica","normal"); y += 8;
  }

  // ── ORGAN ANALYSIS ──
  const oa = organEffectAnalysis;
  if (oa && !oa.error) {
    sectionTitle("Organ Health Analysis");
    const oh = oa.overall_organ_health;
    if (oh) {
      checkPage(18);
      doc.setFillColor(236,254,255); doc.setDrawColor(165,243,252);
      doc.rect(MARGIN, y-4, CONTENT, 20, "FD");
      doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(8,145,178);
      doc.text(`Overall Organ Health Score: ${oh.overall_organ_health_score??'—'} / 100  ·  Trend: ${oh.organ_health_trend||'—'}`, MARGIN+4, y+3); y += 9;
      if (oh.organ_health_summary) { bodyText(oh.organ_health_summary, [40,100,110]); }
      y += 5;
    }
    const registry = oa.organ_health_registry || [];
    if (registry.length) {
      subTitle("Organ Health Scores (0 = critical, 100 = healthy)", [8,145,178]);
      const colW2 = CONTENT/2;
      registry.forEach((org, i) => {
        const score = org.health_score ?? 70;
        const sc2 = score >= 65 ? [22,101,52] : score >= 45 ? [146,64,14] : [185,28,28];
        const col = i % 2 === 0 ? MARGIN : MARGIN+colW2;
        if (i % 2 === 0) { checkPage(14); }
        doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
        doc.text(org.organ||"—", col, y);
        const barW = colW2-40, barY = y+3;
        doc.setFillColor(232,232,232); doc.rect(col, barY, barW, 3, "F");
        doc.setFillColor(...sc2); doc.rect(col, barY, Math.max(0, Math.min(barW,(score/100)*barW)), 3, "F");
        doc.setFontSize(8); doc.setTextColor(...sc2);
        doc.text(`${score}  ${org.health_label||""}`, col+barW+2, y+3);
        if (i % 2 === 1) y += 14;
      });
      if (registry.length % 2 !== 0) y += 14;
      y += 3;
    }

    const patOrgans = oa.patient_organ_health_overview || [];
    if (patOrgans.length) {
      subTitle("Your Organ Health — Plain Language", [15,118,110]);
      patOrgans.forEach(org => {
        checkPage(22);
        doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(20,20,20);
        doc.text(org.organ_plain_name||"—", MARGIN, y); y += 5;
        if (org.what_was_found_plain) { bodyText(org.what_was_found_plain, [70,70,70]); }
        if (org.why_it_matters_plain) { bodyText(org.why_it_matters_plain, [90,90,90]); }
        y += 2; doc.setDrawColor(200,240,230); doc.line(MARGIN, y, PAGE_W-MARGIN, y); y += 4;
      });
    }
  }

  // ── DISCLAIMER ──
  checkPage(30); y += 6;
  doc.setFillColor(239,246,255); doc.setDrawColor(191,219,254);
  const disc = "IMPORTANT DISCLAIMER: This report has been automatically generated from your medical records to help you understand your health. It is not a medical diagnosis, prognosis, or recommendation for any treatment. Please discuss all findings with your doctor or specialist before taking any action. All findings require specialist clinical review.";
  const dLines = doc.splitTextToSize(disc, CONTENT-8);
  doc.rect(MARGIN, y-4, CONTENT, dLines.length*4.5+12, "FD");
  doc.setFontSize(8.5); doc.setFont("helvetica","bold"); doc.setTextColor(30,64,175);
  doc.text("IMPORTANT DISCLAIMER", MARGIN+4, y+2); doc.setFont("helvetica","normal"); y += 8;
  dLines.slice(1).forEach(l => { checkPage(5); doc.text(l, MARGIN+4, y); y += 4.5; });

  // Footers
  const totalPages = doc.internal.getNumberOfPages();
  for (let pg = 1; pg <= totalPages; pg++) {
    doc.setPage(pg); doc.setDrawColor(220,220,220); doc.line(MARGIN,285,PAGE_W-MARGIN,285);
    doc.setFontSize(7.5); doc.setFont("helvetica","normal"); doc.setTextColor(150,150,150);
    doc.text("MedConsolidate | Patient Health Report  ·  CONFIDENTIAL  ·  Not a clinical diagnosis or treatment recommendation", MARGIN, 290);
    doc.text(`Page ${pg} of ${totalPages}`, PAGE_W-MARGIN-18, 290);
  }
  return doc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION COMPONENTS (v4.0 data shapes)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Section 01: Current Health ────────────────────────────────────────────────
const Section01 = ({ data }) => {
  const s = data || {};
  const [activeTab, setActiveTab] = useState(0);
  const tabs = [
    { label: "Conditions",   icon: <LocalHospitalRounded sx={{ fontSize: 13 }} /> },
    { label: "Medications",  icon: <MedicationRounded    sx={{ fontSize: 13 }} /> },
    { label: "Lab Values",   icon: <ScienceRounded       sx={{ fontSize: 13 }} /> },
    { label: "History",      icon: <ArticleRounded       sx={{ fontSize: 13 }} /> },
  ];
  return (
    <Box>
      {s.overall_health_summary && (
        <Box sx={{ mb: 2.5, p: 2.5, border: `1px solid ${C.skyBdr}`, borderRadius: "6px", background: C.skyBg, display: "flex", gap: 1.5 }}>
          <PersonRounded sx={{ fontSize: 20, color: C.sky, flexShrink: 0, mt: 0.2 }} />
          <Box>
            <Label sx={{ mb: 0.3, color: C.sky }}>Overall Health Summary</Label>
            <Typography sx={{ ...os({ fontSize: 13, color: C.sky, lineHeight: 1.7 }) }}>{s.overall_health_summary}</Typography>
          </Box>
        </Box>
      )}
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ ...tabSx, mb: 0, "& .MuiTab-root": { ...tabSx["& .MuiTab-root"], fontSize: 11, px: 1.5 } }}>
        {tabs.map((t, i) => <Tab key={i} value={i} label={<Box sx={{ display:"flex", alignItems:"center", gap: 0.6 }}>{t.icon}<span>{t.label}</span></Box>} />)}
      </Tabs>
      <Box sx={{ pt: 2.5 }}>
        {/* Conditions */}
        {activeTab === 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {(s.condition_cards || []).length === 0 && <EmptyState message="No conditions documented" />}
            {(s.condition_cards || []).map((card, i) => {
              const cfg = sevCfg(card.severity_badge);
              return (
                <ExpandableCard key={i} defaultOpen={i < 3} accentColor={cfg.bdr}
                  headerContent={
                    <Box sx={{ display:"flex", alignItems:"center", gap: 1.5, flex: 1, flexWrap:"wrap" }}>
                      <SeverityBadge level={card.severity_badge} />
                      <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                        {card.condition_plain_name || card.condition_medical_name}
                      </Typography>
                      {card.condition_medical_name && card.condition_medical_name !== card.condition_plain_name && (
                        <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>({card.condition_medical_name})</Typography>
                      )}
                      <Box sx={{ ml:"auto", display:"flex", gap:0.75 }}>
                        {card.specialty_domain && <Chip label={card.specialty_domain} size="small" sx={{ fontSize:10, height:20, background:C.ghost, color:C.smoke, border:`1px solid ${C.fog}`, fontFamily:FONT }} />}
                      </Box>
                    </Box>
                  }>
                  <Box sx={{ display:"flex", flexDirection:"column", gap: 1.25 }}>
                    {card.what_it_is && <Box><Label sx={{ mb:0.3 }}>What it is</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.7 }) }}>{card.what_it_is}</Typography></Box>}
                    {card.what_it_means_for_life && <Box><Label sx={{ mb:0.3 }}>How it affects daily life</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{card.what_it_means_for_life}</Typography></Box>}
                    {card.current_status && <Box><Label sx={{ mb:0.3 }}>Current status</Label><Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>{card.current_status}</Typography></Box>}
                    {card.key_number && (
                      <Box sx={{ p:1.5, border:`1px solid ${cfg.bdr}`, borderRadius:"4px", background:cfg.bg }}>
                        <Label sx={{ mb:0.3, color:cfg.color }}>Key number</Label>
                        <Typography sx={{ ...os({ fontSize:16, color:cfg.color, lineHeight:1.2 }) }}>{card.key_number}</Typography>
                        {card.key_number_context && <Typography sx={{ ...os({ fontSize:11, color:cfg.color, mt:0.4 }) }}>{card.key_number_context}</Typography>}
                      </Box>
                    )}
                    {card.evidence_plain && (
                      <Box sx={{ p:1.25, border:`1px solid ${C.fog}`, borderRadius:"3px", background:C.ghost }}>
                        <Label sx={{ mb:0.3 }}>Evidence</Label>
                        <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{card.evidence_plain}</Typography>
                        {card.confirmed_in_document && <Label sx={{ mt:0.3 }}>{card.confirmed_in_document}{card.confirmed_on_date ? ` · ${card.confirmed_on_date}` : ""}</Label>}
                      </Box>
                    )}
                  </Box>
                </ExpandableCard>
              );
            })}
          </Box>
        )}
        {/* Medications */}
        {activeTab === 1 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
            {(s.medications_plain || []).length === 0 && <EmptyState message="No medications documented" />}
            {(s.medications_plain || []).map((med, i) => (
              <Box key={i} sx={{ p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.white, display:"flex", gap:2 }}>
                <Box sx={{ width:36, height:36, borderRadius:"50%", background:C.ghost, border:`1px solid ${C.fog}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <MedicationRounded sx={{ fontSize:16, color:C.ash }} />
                </Box>
                <Box sx={{ flex:1 }}>
                  <Box sx={{ display:"flex", justifyContent:"space-between", gap:1, flexWrap:"wrap", mb:0.5 }}>
                    <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{med.medicine_name}</Typography>
                    <Box sx={{ px:1, py:0.3, borderRadius:"3px", background:C.ghost, border:`1px solid ${C.fog}` }}>
                      <Typography sx={{ ...os({ fontSize:10, color:C.charcoal }) }}>{med.dose_and_frequency}</Typography>
                    </Box>
                  </Box>
                  <Typography sx={{ ...os({ fontSize:12, color:C.ash, lineHeight:1.5 }) }}>{med.what_it_does_simply}</Typography>
                  {med.confirmed_in_document && <Label sx={{ mt:0.5 }}>{med.confirmed_in_document}{med.confirmed_on_date ? ` · ${med.confirmed_on_date}` : ""}</Label>}
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {/* Lab Values */}
        {activeTab === 2 && (
          <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", sm:"repeat(2,1fr)", lg:"repeat(3,1fr)" }, gap:1.5 }}>
            {(s.key_lab_values || []).length === 0 && <Box sx={{ gridColumn:"1/-1" }}><EmptyState message="No key lab values documented" /></Box>}
            {(s.key_lab_values || []).map((lab, i) => (
              <Box key={i} sx={{ p:2.5, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.white }}>
                <Label sx={{ mb:0.5 }}>{lab.test_name_plain || lab.test_name_medical}</Label>
                <Typography sx={{ ...os({ fontSize:20, color:C.ink, lineHeight:1.2 }) }}>{lab.your_result}</Typography>
                {lab.target_or_normal && <Typography sx={{ ...os({ fontSize:10, color:C.ash, mt:0.3 }) }}>Target: {lab.target_or_normal}</Typography>}
                {lab.date && <Label sx={{ mt:0.3 }}>{lab.date}</Label>}
                {lab.what_it_means_plain && <Typography sx={{ ...os({ fontSize:11, color:C.ash, mt:1, lineHeight:1.5, borderTop:`1px solid ${C.fog}`, pt:1 }) }}>{lab.what_it_means_plain}</Typography>}
              </Box>
            ))}
          </Box>
        )}
        {/* History */}
        {activeTab === 3 && (
          <Box>
            {(() => {
              const hist = s.allergies_and_history || {};
              return (
                <Box sx={{ display:"flex", flexDirection:"column", gap:2 }}>
                  {hist.summary_paragraph && <Box sx={{ p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost }}><Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.7 }) }}>{hist.summary_paragraph}</Typography></Box>}
                  {hist.known_allergies?.length > 0 && <Box><Label sx={{ mb:0.75 }}>Known Allergies</Label><Box sx={{ display:"flex", gap:0.75, flexWrap:"wrap" }}>{hist.known_allergies.map((a,i) => <Box key={i} sx={{ px:1.25, py:0.4, borderRadius:"3px", background:C.criticalBg, border:`1px solid ${C.criticalBdr}` }}><Typography sx={{ ...os({ fontSize:11, color:C.critical }) }}>{a}</Typography></Box>)}</Box></Box>}
                  {hist.past_surgeries?.length > 0 && <Box><Label sx={{ mb:0.75 }}>Past Surgeries</Label><Box sx={{ display:"flex", flexDirection:"column", gap:0.5 }}>{hist.past_surgeries.map((s,i) => <Typography key={i} sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>· {s}</Typography>)}</Box></Box>}
                  {hist.past_hospitalisations?.length > 0 && <Box><Label sx={{ mb:0.75 }}>Past Hospitalisations</Label><Box sx={{ display:"flex", flexDirection:"column", gap:0.5 }}>{hist.past_hospitalisations.map((h,i) => <Typography key={i} sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>· {h}</Typography>)}</Box></Box>}
                  {!hist.summary_paragraph && !hist.known_allergies?.length && !hist.past_surgeries?.length && !hist.past_hospitalisations?.length && <EmptyState message="No history documented" />}
                </Box>
              );
            })()}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ── Section 02: What to Watch For ────────────────────────────────────────────
const Section02 = ({ data, qrisk3 }) => {
  const s = data || {};
  const [activeTab, setActiveTab] = useState(0);
  const tabs = [
    { label: "Short-Term Risks",      icon: <NotificationsActiveRounded sx={{ fontSize:13 }} /> },
    { label: "Long-Term Risks",        icon: <TimelineRounded            sx={{ fontSize:13 }} /> },
    { label: "Early Warning Signs",    icon: <WarningAmberRounded        sx={{ fontSize:13 }} /> },
    { label: "Heart & Stroke (QRISK3)",icon: <FavoriteRounded            sx={{ fontSize:13 }} /> },
  ];
  return (
    <Box>
      {s.section_intro && (
        <Box sx={{ mb:2.5, p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost }}>
          <Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.6 }) }}>{s.section_intro}</Typography>
        </Box>
      )}
      {s.section_02_summary && (
        <Box sx={{ mb:2, p:2, border:`1px solid ${C.highBdr}`, borderRadius:"6px", background:C.highBg }}>
          <Label sx={{ mb:0.3, color:C.high }}>Summary</Label>
          <Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{s.section_02_summary}</Typography>
          {s.highest_priority_risk && <Typography sx={{ ...os({ fontSize:11, color:C.critical, mt:0.5, fontWeight:500 }) }}>Highest priority: {s.highest_priority_risk}</Typography>}
        </Box>
      )}
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ ...tabSx, mb:0, "& .MuiTab-root":{ ...tabSx["& .MuiTab-root"], fontSize:11, px:1.5 } }}>
        {tabs.map((t, i) => <Tab key={i} value={i} label={<Box sx={{ display:"flex", alignItems:"center", gap:0.6 }}>{t.icon}<span>{t.label}</span></Box>} />)}
      </Tabs>
      <Box sx={{ pt:2.5 }}>
        {/* Short-term */}
        {activeTab === 0 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.5 }}>
            {s.short_term_risks?.label && <Label>{s.short_term_risks.label}</Label>}
            {(s.short_term_risks?.items || []).length === 0 && <EmptyState message="No short-term risks documented" />}
            {(s.short_term_risks?.items || []).map((risk, i) => {
              const cfg = sevCfg(risk.severity_badge);
              return (
                <ExpandableCard key={i} defaultOpen accentColor={cfg.bdr}
                  headerContent={
                    <Box sx={{ display:"flex", alignItems:"center", gap:1.5, flex:1, flexWrap:"wrap" }}>
                      <SeverityBadge level={risk.severity_badge} />
                      <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{risk.risk_name}</Typography>
                      {risk.specialty_domain && <Chip label={risk.specialty_domain} size="small" sx={{ fontSize:10, height:20, background:C.ghost, color:C.smoke, border:`1px solid ${C.fog}`, fontFamily:FONT, ml:"auto" }} />}
                    </Box>
                  }>
                  <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
                    {risk.plain_description  && <Box><Label sx={{ mb:0.3 }}>What this means</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{risk.plain_description}</Typography></Box>}
                    {risk.trigger_scenario   && <Box><Label sx={{ mb:0.3 }}>What makes it worse</Label><Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>{risk.trigger_scenario}</Typography></Box>}
                    {risk.what_patient_feels && <Box sx={{ p:1.25, border:`1px solid ${C.moderateBdr}`, borderRadius:"3px", background:C.moderateBg }}><Label sx={{ mb:0.3, color:C.moderate }}>You may feel</Label><Typography sx={{ ...os({ fontSize:12, color:C.moderate }) }}>{risk.what_patient_feels}</Typography></Box>}
                    {risk.source_entity     && <Label>Source: {risk.source_entity}{risk.source_document ? ` · ${risk.source_document}` : ""}</Label>}
                  </Box>
                </ExpandableCard>
              );
            })}
          </Box>
        )}
        {/* Long-term */}
        {activeTab === 1 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.5 }}>
            {s.long_term_risks?.label && <Label>{s.long_term_risks.label}</Label>}
            {(s.long_term_risks?.items || []).length === 0 && <EmptyState message="No long-term risks documented" />}
            {(s.long_term_risks?.items || []).map((risk, i) => {
              const cfg = sevCfg(risk.severity_badge);
              return (
                <ExpandableCard key={i} defaultOpen={i < 3} accentColor={cfg.bdr}
                  headerContent={
                    <Box sx={{ display:"flex", alignItems:"center", gap:1.5, flex:1, flexWrap:"wrap" }}>
                      <SeverityBadge level={risk.severity_badge} />
                      <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{risk.risk_name}</Typography>
                      {risk.specialty_domain && <Chip label={risk.specialty_domain} size="small" sx={{ fontSize:10, height:20, background:C.ghost, color:C.smoke, border:`1px solid ${C.fog}`, fontFamily:FONT, ml:"auto" }} />}
                    </Box>
                  }>
                  <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
                    {risk.plain_description   && <Box><Label sx={{ mb:0.3 }}>What this means</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{risk.plain_description}</Typography></Box>}
                    {risk.why_this_patient    && <Box><Label sx={{ mb:0.3 }}>Why you specifically</Label><Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>{risk.why_this_patient}</Typography></Box>}
                    {risk.preventability_note && <Box sx={{ p:1.25, border:`1px solid ${C.lowBdr}`, borderRadius:"3px", background:C.lowBg }}><Label sx={{ mb:0.3, color:C.low }}>Preventability</Label><Typography sx={{ ...os({ fontSize:12, color:C.low }) }}>{risk.preventability_note}</Typography></Box>}
                    {risk.source_entity       && <Label>Source: {risk.source_entity}{risk.source_document ? ` · ${risk.source_document}` : ""}</Label>}
                  </Box>
                </ExpandableCard>
              );
            })}
          </Box>
        )}
        {/* Warning Signs */}
        {activeTab === 2 && (
          <Box>
            {s.early_warning_signs?.intro && (
              <Box sx={{ mb:2, p:2, border:`1px solid ${C.criticalBdr}`, borderRadius:"6px", background:C.criticalBg, display:"flex", gap:1.5 }}>
                <WarningAmberRounded sx={{ fontSize:16, color:C.critical, flexShrink:0, mt:0.2 }} />
                <Typography sx={{ ...os({ fontSize:12, color:C.critical, lineHeight:1.6 }) }}>{s.early_warning_signs.intro}</Typography>
              </Box>
            )}
            <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", sm:"repeat(2,1fr)" }, gap:1.5 }}>
              {(s.early_warning_signs?.groups || []).length === 0 && <EmptyState message="No warning sign groups documented" />}
              {(s.early_warning_signs?.groups || []).map((grp, i) => (
                <Box key={i} sx={{ p:2, border:`1px solid ${C.criticalBdr}`, borderRadius:"6px", background:C.criticalBg }}>
                  <Box sx={{ display:"flex", alignItems:"center", gap:0.75, mb:1.25 }}>
                    <PriorityHighRounded sx={{ fontSize:16, color:C.critical }} />
                    <Typography sx={{ ...os({ fontSize:12, color:C.critical, fontWeight:500 }) }}>{grp.group_name}</Typography>
                  </Box>
                  {grp.related_condition && <Label sx={{ mb:0.75, color:C.critical }}>Related to: {grp.related_condition}</Label>}
                  <Box sx={{ display:"flex", flexDirection:"column", gap:0.5 }}>
                    {(grp.signs || []).map((sign, j) => (
                      <Box key={j} sx={{ display:"flex", gap:0.75, alignItems:"flex-start" }}>
                        <FiberManualRecordRounded sx={{ fontSize:8, color:C.critical, mt:0.5, flexShrink:0 }} />
                        <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{sign}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        {/* QRISK3 */}
        {activeTab === 3 && (
          <Box>
            {qrisk3?.score_percent != null ? (
              <Box sx={{ display:"flex", flexDirection:{ xs:"column", sm:"row" }, gap:3 }}>
                <Box sx={{ flex:"0 0 auto", border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost, minWidth:200 }}>
                  <QRISK3Gauge score={qrisk3.score_percent} />
                </Box>
                <Box sx={{ flex:1, display:"flex", flexDirection:"column", gap:1.5 }}>
                  {s.qrisk3_plain?.plain_statement && (
                    <Box sx={{ p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.white }}>
                      <Typography sx={{ ...os({ fontSize:14, color:C.ink, lineHeight:1.6 }) }}>{s.qrisk3_plain.plain_statement}</Typography>
                    </Box>
                  )}
                  {s.qrisk3_plain?.what_this_means && <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{s.qrisk3_plain.what_this_means}</Typography>}
                  <Box sx={{ display:"flex", gap:2, flexWrap:"wrap" }}>
                    {qrisk3.sex_used && <Box sx={{ p:1.5, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.white }}><Label sx={{ mb:0.3 }}>Sex</Label><Typography sx={{ ...os({ fontSize:12, color:C.ink }) }}>{qrisk3.sex_used}</Typography></Box>}
                    {qrisk3.age_used != null && <Box sx={{ p:1.5, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.white }}><Label sx={{ mb:0.3 }}>Age</Label><Typography sx={{ ...os({ fontSize:12, color:C.ink }) }}>{qrisk3.age_used} yrs</Typography></Box>}
                    {qrisk3.key_variables_present != null && <Box sx={{ p:1.5, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.white }}><Label sx={{ mb:0.3 }}>Key Variables</Label><Typography sx={{ ...os({ fontSize:12, color:C.ink }) }}>{qrisk3.key_variables_present} / {qrisk3.key_variables_total}</Typography></Box>}
                    {qrisk3.confidence && <Box sx={{ p:1.5, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.white, flex:1 }}><Label sx={{ mb:0.3 }}>Confidence</Label><Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{qrisk3.confidence}</Typography></Box>}
                  </Box>
                  {qrisk3.caveats?.length > 0 && (
                    <Box sx={{ p:1.5, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.ghost }}>
                      <Label sx={{ mb:0.5 }}>Caveats</Label>
                      {qrisk3.caveats.map((cv, i) => <Typography key={i} sx={{ ...os({ fontSize:11, color:C.ash }) }}>· {cv}</Typography>)}
                    </Box>
                  )}
                  {s.qrisk3_plain?.caveat && <Typography sx={{ ...os({ fontSize:10, color:C.silver, fontStyle:"italic" }) }}>{s.qrisk3_plain.caveat}</Typography>}
                  {qrisk3.reference && <Label>{qrisk3.reference}</Label>}
                </Box>
              </Box>
            ) : (
              <EmptyState message={qrisk3?.error || "QRISK3 score not available"} sub="Age, sex, or key clinical variables missing from graph" />
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ── Section 03: Monitoring Checklist ─────────────────────────────────────────
const Section03 = ({ data }) => {
  const s = data || {};
  const [tab, setTab] = useState(0);
  return (
    <Box>
      {s.section_intro && <Box sx={{ mb:2.5, p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost }}><Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.6 }) }}>{s.section_intro}</Typography></Box>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ ...tabSx, mb:0 }}>
        <Tab value={0} label={<Box sx={{ display:"flex", alignItems:"center", gap:0.6 }}><HomeRounded sx={{ fontSize:13 }} /><span>Home Monitoring</span></Box>} />
        <Tab value={1} label={<Box sx={{ display:"flex", alignItems:"center", gap:0.6 }}><EventNoteRounded sx={{ fontSize:13 }} /><span>Clinical Tests</span></Box>} />
      </Tabs>
      <Box sx={{ pt:2.5 }}>
        {tab === 0 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
            {(s.home_monitoring || []).length === 0 && <EmptyState message="No home monitoring items" />}
            {(s.home_monitoring || []).map((chk, i) => (
              <Box key={i} sx={{ p:2.5, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.white }}>
                <Box sx={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:1, mb:1, flexWrap:"wrap" }}>
                  <Box sx={{ display:"flex", gap:1, alignItems:"center" }}>
                    <HomeRounded sx={{ fontSize:14, color:C.teal }} />
                    <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{chk.what_to_check}</Typography>
                  </Box>
                  <Box sx={{ display:"flex", gap:0.75, flexWrap:"wrap" }}>
                    <Box sx={{ px:1, py:0.3, borderRadius:"3px", background:C.tealBg, border:`1px solid ${C.tealBdr}` }}>
                      <Typography sx={{ ...os({ fontSize:10, color:C.teal }) }}>{chk.how_often}</Typography>
                    </Box>
                    {chk.target_or_goal && (
                      <Box sx={{ px:1, py:0.3, borderRadius:"3px", background:C.ghost, border:`1px solid ${C.fog}` }}>
                        <Typography sx={{ ...os({ fontSize:10, color:C.charcoal }) }}>Target: {chk.target_or_goal}</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
                {chk.how_to_do_it  && <Typography sx={{ ...os({ fontSize:12, color:C.ash, mb:0.5 }) }}>{chk.how_to_do_it}</Typography>}
                {chk.why_important && <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{chk.why_important}</Typography>}
                {chk.alert_level   && (
                  <Box sx={{ mt:1, p:1.25, border:`1px solid ${C.criticalBdr}`, borderRadius:"3px", background:C.criticalBg, display:"flex", gap:0.75 }}>
                    <WarningAmberRounded sx={{ fontSize:12, color:C.critical, flexShrink:0 }} />
                    <Typography sx={{ ...os({ fontSize:11, color:C.critical }) }}>{chk.alert_level}</Typography>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
        {tab === 1 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
            {(s.clinical_tests || []).length === 0 && <EmptyState message="No clinical tests documented" />}
            {(s.clinical_tests || []).map((t, i) => {
              const urgCfg2 = t.urgency === "Critical" ? { color:C.critical, bg:C.criticalBg, bdr:C.criticalBdr } : t.urgency === "Important" ? { color:C.moderate, bg:C.moderateBg, bdr:C.moderateBdr } : { color:C.ash, bg:C.ghost, bdr:C.fog };
              return (
                <Box key={i} sx={{ p:2.5, border:`1px solid ${urgCfg2.bdr}`, borderRadius:"6px", background:urgCfg2.bg }}>
                  <Box sx={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:1, mb:1, flexWrap:"wrap" }}>
                    <Box sx={{ display:"flex", gap:1, alignItems:"center" }}>
                      <ScienceRounded sx={{ fontSize:14, color:urgCfg2.color }} />
                      <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{t.test_name}</Typography>
                    </Box>
                    <Box sx={{ display:"flex", gap:0.75 }}>
                      <Box sx={{ px:1, py:0.3, borderRadius:"3px", background:C.white, border:`1px solid ${urgCfg2.bdr}` }}>
                        <Typography sx={{ ...os({ fontSize:10, color:urgCfg2.color }) }}>{t.how_often}</Typography>
                      </Box>
                      {t.urgency && (
                        <Box sx={{ px:1, py:0.3, borderRadius:"3px", background:C.white, border:`1px solid ${urgCfg2.bdr}` }}>
                          <Typography sx={{ ...os({ fontSize:10, color:urgCfg2.color, fontWeight:500 }) }}>{t.urgency}</Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                  {t.purpose_plain    && <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{t.purpose_plain}</Typography>}
                  {t.why_this_patient && <Typography sx={{ ...os({ fontSize:11, color:C.ash, mt:0.5 }) }}>{t.why_this_patient}</Typography>}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
      <Box sx={{ mt:2, display:"flex", gap:2 }}>
        {s.total_home_checks > 0 && <Label>{s.total_home_checks} home checks</Label>}
        {s.total_clinical_tests > 0 && <Label>{s.total_clinical_tests} clinical tests</Label>}
      </Box>
    </Box>
  );
};

// ── Section 04: Who to Consult ────────────────────────────────────────────────
const Section04 = ({ data }) => {
  const s = data || {};
  const referrals = s.specialist_referrals || [];
  return (
    <Box>
      {s.section_intro && <Box sx={{ mb:2.5, p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost }}><Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.6 }) }}>{s.section_intro}</Typography></Box>}
      <Box sx={{ display:"flex", flexDirection:"column", gap:1.5 }}>
        {referrals.length === 0 && <EmptyState message="No specialist referrals documented" />}
        {referrals.map((ref, i) => {
          const cfg = urgCfg(ref.urgency);
          return (
            <ExpandableCard key={i} defaultOpen={ref.urgency === "HIGH"} accentColor={cfg.bdr}
              headerContent={
                <Box sx={{ display:"flex", alignItems:"center", gap:1.5, flex:1, flexWrap:"wrap" }}>
                  <LocalHospitalRounded sx={{ fontSize:14, color:cfg.color }} />
                  <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{ref.specialist_type}</Typography>
                  <Box sx={{ ml:"auto", display:"flex", gap:0.75, alignItems:"center" }}>
                    <UrgencyBadge urgency={ref.urgency} />
                    {ref.specialty_domain && <Chip label={ref.specialty_domain} size="small" sx={{ fontSize:10, height:20, background:C.ghost, color:C.smoke, border:`1px solid ${C.fog}`, fontFamily:FONT }} />}
                  </Box>
                </Box>
              }>
              <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
                {ref.why_needed && <Box><Label sx={{ mb:0.3 }}>Why you need them</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{ref.why_needed}</Typography></Box>}
                {ref.urgency_plain && <Box sx={{ p:1.25, border:`1px solid ${cfg.bdr}`, borderRadius:"3px", background:"transparent" }}><Typography sx={{ ...os({ fontSize:12, color:cfg.color }) }}>{ref.urgency_plain}</Typography></Box>}
                {ref.what_to_expect && <Box><Label sx={{ mb:0.3 }}>What to expect</Label><Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{ref.what_to_expect}</Typography></Box>}
                {ref.related_conditions?.length > 0 && (
                  <Box>
                    <Label sx={{ mb:0.5 }}>Related conditions</Label>
                    <Box sx={{ display:"flex", gap:0.5, flexWrap:"wrap" }}>
                      {ref.related_conditions.map((c, j) => <Chip key={j} label={c} size="small" sx={{ fontSize:10, height:18, background:C.ghost, color:C.smoke, border:`1px solid ${C.fog}`, fontFamily:FONT }} />)}
                    </Box>
                  </Box>
                )}
                {ref.source_entity && <Label>Source: {ref.source_entity}{ref.source_document ? ` · ${ref.source_document}` : ""}</Label>}
              </Box>
            </ExpandableCard>
          );
        })}
      </Box>
      {s.pharmacy_review?.needed && (
        <Box sx={{ mt:2, p:2, border:`1px solid ${C.moderateBdr}`, borderRadius:"6px", background:C.moderateBg }}>
          <Box sx={{ display:"flex", gap:1, mb:0.75, alignItems:"center" }}>
            <MedicationRounded sx={{ fontSize:14, color:C.moderate }} />
            <Typography sx={{ ...os({ fontSize:12, color:C.moderate, fontWeight:500 }) }}>Pharmacy Review Recommended</Typography>
            {s.pharmacy_review.polypharmacy_flag && <Chip label="Polypharmacy" size="small" sx={{ fontSize:10, height:18, background:C.highBg, color:C.high, border:`1px solid ${C.highBdr}`, fontFamily:FONT }} />}
          </Box>
          <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{s.pharmacy_review.reason}</Typography>
          {s.pharmacy_review.polypharmacy_note && <Typography sx={{ ...os({ fontSize:11, color:C.ash, mt:0.5 }) }}>{s.pharmacy_review.polypharmacy_note}</Typography>}
        </Box>
      )}
      {s.care_coordination_note && (
        <Box sx={{ mt:2, p:2, border:`1px solid ${C.infoBdr}`, borderRadius:"6px", background:C.infoBg, display:"flex", gap:1.25 }}>
          <PeopleRounded sx={{ fontSize:14, color:C.info, flexShrink:0, mt:0.2 }} />
          <Typography sx={{ ...os({ fontSize:12, color:C.info }) }}>{s.care_coordination_note}</Typography>
        </Box>
      )}
      {(s.total_specialists_recommended > 0 || s.high_urgency_count > 0) && (
        <Box sx={{ mt:2, display:"flex", gap:2 }}>
          {s.total_specialists_recommended > 0 && <Label>{s.total_specialists_recommended} specialists recommended</Label>}
          {s.high_urgency_count > 0 && <Label sx={{ color:C.critical }}>{s.high_urgency_count} HIGH urgency</Label>}
          {s.medium_urgency_count > 0 && <Label sx={{ color:C.moderate }}>{s.medium_urgency_count} MEDIUM urgency</Label>}
        </Box>
      )}
    </Box>
  );
};

// ── Section 05: Lifestyle & Diet ──────────────────────────────────────────────
const Section05 = ({ data }) => {
  const s = data || {};
  const [tab, setTab] = useState(0);
  const tabs = [
    { label: "What to Eat",         icon: <RestaurantRounded     sx={{ fontSize:13 }} /> },
    { label: "Physical Activity",   icon: <FitnessCenterRounded  sx={{ fontSize:13 }} /> },
    { label: "Habits",              icon: <SpaRounded            sx={{ fontSize:13 }} /> },
    { label: "Organ-Specific Notes",icon: <HubRounded            sx={{ fontSize:13 }} /> },
  ];
  const FoodPill = ({ text, color, bg, bdr }) => (
    <Box sx={{ px:1.25, py:0.5, borderRadius:"3px", background:bg, border:`1px solid ${bdr}` }}>
      <Typography sx={{ ...os({ fontSize:11, color, fontWeight:500 }) }}>{text}</Typography>
    </Box>
  );
  return (
    <Box>
      {s.section_intro && <Box sx={{ mb:2.5, p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost }}><Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.6 }) }}>{s.section_intro}</Typography></Box>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ ...tabSx, mb:0, "& .MuiTab-root":{ ...tabSx["& .MuiTab-root"], fontSize:11, px:1.5 } }}>
        {tabs.map((t, i) => <Tab key={i} value={i} label={<Box sx={{ display:"flex", alignItems:"center", gap:0.6 }}>{t.icon}<span>{t.label}</span></Box>} />)}
      </Tabs>
      <Box sx={{ pt:2.5 }}>
        {/* Eat */}
        {tab === 0 && (
          <Box>
            {s.what_to_eat?.intro && <Typography sx={{ ...os({ fontSize:13, color:C.charcoal, mb:2, lineHeight:1.6 }) }}>{s.what_to_eat.intro}</Typography>}
            <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", sm:"repeat(2,1fr)" }, gap:2 }}>
              <Box>
                <Box sx={{ display:"flex", alignItems:"center", gap:0.75, mb:1.25, px:1.5, py:0.75, borderRadius:"4px", background:C.supportBg, border:`1px solid ${C.supportBdr}` }}>
                  <CheckRounded sx={{ fontSize:14, color:C.support }} />
                  <Typography sx={{ ...os({ fontSize:12, color:C.support, fontWeight:500 }) }}>EAT MORE OF THESE</Typography>
                </Box>
                <Box sx={{ display:"flex", flexDirection:"column", gap:1 }}>
                  {(s.what_to_eat?.eat_more || []).map((item, i) => (
                    <Box key={i} sx={{ p:1.5, border:`1px solid ${C.supportBdr}`, borderRadius:"4px", background:C.supportBg }}>
                      <Typography sx={{ ...os({ fontSize:12, color:C.ink, fontWeight:500, mb:0.3 }) }}>{item.food_item}</Typography>
                      {item.plain_why && <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{item.plain_why}</Typography>}
                      {item.priority === "Essential" && <Box sx={{ mt:0.4, display:"inline-flex", px:0.75, py:0.1, borderRadius:"2px", background:C.white, border:`1px solid ${C.supportBdr}` }}><Typography sx={{ ...os({ fontSize:9, color:C.support }) }}>Essential</Typography></Box>}
                    </Box>
                  ))}
                  {(s.what_to_eat?.eat_more || []).length === 0 && <EmptyState message="No eat-more items" />}
                </Box>
              </Box>
              <Box>
                <Box sx={{ display:"flex", alignItems:"center", gap:0.75, mb:1.25, px:1.5, py:0.75, borderRadius:"4px", background:C.avoidBg, border:`1px solid ${C.avoidBdr}` }}>
                  <BlockRounded sx={{ fontSize:14, color:C.avoid }} />
                  <Typography sx={{ ...os({ fontSize:12, color:C.avoid, fontWeight:500 }) }}>REDUCE OR AVOID</Typography>
                </Box>
                <Box sx={{ display:"flex", flexDirection:"column", gap:1 }}>
                  {(s.what_to_eat?.reduce_or_avoid || []).map((item, i) => (
                    <Box key={i} sx={{ p:1.5, border:`1px solid ${C.avoidBdr}`, borderRadius:"4px", background:C.avoidBg }}>
                      <Typography sx={{ ...os({ fontSize:12, color:C.avoid, fontWeight:500, mb:0.3 }) }}>{item.food_item}</Typography>
                      {item.plain_why && <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{item.plain_why}</Typography>}
                      {item.avoid_level && <Box sx={{ mt:0.4, display:"inline-flex", px:0.75, py:0.1, borderRadius:"2px", background:C.white, border:`1px solid ${C.avoidBdr}` }}><Typography sx={{ ...os({ fontSize:9, color:C.avoid }) }}>{item.avoid_level}</Typography></Box>}
                    </Box>
                  ))}
                  {(s.what_to_eat?.reduce_or_avoid || []).length === 0 && <EmptyState message="No avoid items" />}
                </Box>
              </Box>
            </Box>
            {(s.what_to_eat?.dietary_conflicts || []).length > 0 && (
              <Box sx={{ mt:2 }}>
                <Label sx={{ mb:1 }}>Dietary Conflicts Between Conditions</Label>
                {s.what_to_eat.dietary_conflicts.map((dc, i) => (
                  <Box key={i} sx={{ p:2, border:`1px solid ${C.limitBdr}`, borderRadius:"6px", background:C.limitBg, mb:1 }}>
                    <Typography sx={{ ...os({ fontSize:12, color:C.limit, fontWeight:500, mb:0.5 }) }}>{dc.conflict_description}</Typography>
                    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{dc.resolution}</Typography>
                    {dc.conditions_involved?.length > 0 && (
                      <Box sx={{ mt:0.75, display:"flex", gap:0.5, flexWrap:"wrap" }}>
                        {dc.conditions_involved.map((c, j) => <Chip key={j} label={c} size="small" sx={{ fontSize:9, height:16, background:C.white, color:C.limit, border:`1px solid ${C.limitBdr}`, fontFamily:FONT }} />)}
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
        {/* Activity */}
        {tab === 1 && (
          <Box>
            {s.physical_activity?.intro && <Typography sx={{ ...os({ fontSize:13, color:C.charcoal, mb:2, lineHeight:1.6 }) }}>{s.physical_activity.intro}</Typography>}
            <Box sx={{ display:"flex", flexDirection:"column", gap:1.25, mb:2 }}>
              {(s.physical_activity?.activity_plan || []).length === 0 && <EmptyState message="No activity plan" />}
              {(s.physical_activity?.activity_plan || []).map((a, i) => (
                <Box key={i} sx={{ p:2.5, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.white, display:"flex", gap:2 }}>
                  <Box sx={{ width:28, height:28, borderRadius:"50%", background:C.tealBg, border:`1px solid ${C.tealBdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Typography sx={{ ...os({ fontSize:11, color:C.teal }) }}>{a.step}</Typography>
                  </Box>
                  <Box sx={{ flex:1 }}>
                    <Box sx={{ display:"flex", justifyContent:"space-between", gap:1, mb:0.5, flexWrap:"wrap" }}>
                      <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{a.activity}</Typography>
                      <Box sx={{ px:1, py:0.3, borderRadius:"3px", background:C.tealBg, border:`1px solid ${C.tealBdr}` }}>
                        <Typography sx={{ ...os({ fontSize:10, color:C.teal }) }}>{a.frequency}</Typography>
                      </Box>
                    </Box>
                    {a.plain_benefit && <Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>{a.plain_benefit}</Typography>}
                    {a.caution && (
                      <Box sx={{ mt:0.75, p:1.25, border:`1px solid ${C.moderateBdr}`, borderRadius:"3px", background:C.moderateBg, display:"flex", gap:0.75 }}>
                        <WarningAmberRounded sx={{ fontSize:12, color:C.moderate, flexShrink:0 }} />
                        <Typography sx={{ ...os({ fontSize:11, color:C.moderate }) }}>{a.caution}</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
            {(s.physical_activity?.activities_to_avoid || []).length > 0 && (
              <Box>
                <Label sx={{ mb:1, color:C.critical }}>Activities to Avoid</Label>
                <Box sx={{ display:"flex", flexDirection:"column", gap:0.75 }}>
                  {s.physical_activity.activities_to_avoid.map((a, i) => (
                    <Box key={i} sx={{ p:1.5, border:`1px solid ${C.criticalBdr}`, borderRadius:"4px", background:C.criticalBg, display:"flex", gap:1 }}>
                      <BlockRounded sx={{ fontSize:13, color:C.critical, flexShrink:0, mt:0.1 }} />
                      <Box><Typography sx={{ ...os({ fontSize:12, color:C.critical, fontWeight:500 }) }}>{a.activity}</Typography><Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{a.reason_plain}</Typography></Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
        {/* Habits */}
        {tab === 2 && (
          <Box>
            <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", sm:"repeat(2,1fr)" }, gap:2 }}>
              <Box>
                <Box sx={{ display:"flex", alignItems:"center", gap:0.75, mb:1.25, px:1.5, py:0.75, borderRadius:"4px", background:C.supportBg, border:`1px solid ${C.supportBdr}` }}>
                  <CheckRounded sx={{ fontSize:14, color:C.support }} />
                  <Typography sx={{ ...os({ fontSize:12, color:C.support, fontWeight:500 }) }}>BUILD THESE HABITS</Typography>
                </Box>
                <Box sx={{ display:"flex", flexDirection:"column", gap:1 }}>
                  {(s.habits?.build_these || []).map((h, i) => (
                    <Box key={i} sx={{ p:1.5, border:`1px solid ${C.supportBdr}`, borderRadius:"4px", background:C.supportBg }}>
                      <Typography sx={{ ...os({ fontSize:12, color:C.ink, fontWeight:500, mb:0.3 }) }}>{h.habit}</Typography>
                      {h.plain_why   && <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{h.plain_why}</Typography>}
                      {h.how_to_start && <Typography sx={{ ...os({ fontSize:11, color:C.teal, mt:0.3 }) }}>💡 {h.how_to_start}</Typography>}
                    </Box>
                  ))}
                  {(s.habits?.build_these || []).length === 0 && <EmptyState message="No build-habits" />}
                </Box>
              </Box>
              <Box>
                <Box sx={{ display:"flex", alignItems:"center", gap:0.75, mb:1.25, px:1.5, py:0.75, borderRadius:"4px", background:C.criticalBg, border:`1px solid ${C.criticalBdr}` }}>
                  <BlockRounded sx={{ fontSize:14, color:C.critical }} />
                  <Typography sx={{ ...os({ fontSize:12, color:C.critical, fontWeight:500 }) }}>STOP THESE HABITS</Typography>
                </Box>
                <Box sx={{ display:"flex", flexDirection:"column", gap:1 }}>
                  {(s.habits?.stop_these || []).map((h, i) => (
                    <Box key={i} sx={{ p:1.5, border:`1px solid ${C.criticalBdr}`, borderRadius:"4px", background:C.criticalBg }}>
                      <Typography sx={{ ...os({ fontSize:12, color:C.avoid, fontWeight:500, mb:0.3 }) }}>{h.habit}</Typography>
                      {h.plain_why && <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{h.plain_why}</Typography>}
                      {h.urgency   && <Box sx={{ mt:0.4, display:"inline-flex", px:0.75, py:0.1, borderRadius:"2px", background:C.white, border:`1px solid ${C.criticalBdr}` }}><Typography sx={{ ...os({ fontSize:9, color:C.critical }) }}>{h.urgency}</Typography></Box>}
                    </Box>
                  ))}
                  {(s.habits?.stop_these || []).length === 0 && <EmptyState message="No stop-habits" />}
                </Box>
              </Box>
            </Box>
            {s.motivational_note && (
              <Box sx={{ mt:2.5, p:2.5, border:`1px solid ${C.skyBdr}`, borderRadius:"6px", background:C.skyBg }}>
                <Typography sx={{ ...os({ fontSize:13, color:C.sky, lineHeight:1.7, fontStyle:"italic" }) }}>{s.motivational_note}</Typography>
              </Box>
            )}
          </Box>
        )}
        {/* Organ-specific */}
        {tab === 3 && (
          <Box>
            {(s.organ_specific_notes || []).length === 0 && <EmptyState message="No organ-specific notes" />}
            <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr", sm:"repeat(2,1fr)" }, gap:1.5 }}>
              {(s.organ_specific_notes || []).map((note, i) => (
                <Box key={i} sx={{ p:2, border:`1px solid ${C.organBdr}`, borderRadius:"6px", background:C.organBg }}>
                  <Box sx={{ display:"flex", gap:0.75, mb:0.75, alignItems:"center" }}>
                    <HubRounded sx={{ fontSize:14, color:C.organ }} />
                    <Typography sx={{ ...os({ fontSize:12, color:C.organ, fontWeight:500 }) }}>{note.organ}</Typography>
                  </Box>
                  <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{note.dietary_note_plain}</Typography>
                  {note.related_condition && <Label sx={{ mt:0.5 }}>Related: {note.related_condition}</Label>}
                </Box>
              ))}
            </Box>
            {s.section_05_summary && (
              <Box sx={{ mt:2, p:2, border:`1px solid ${C.fog}`, borderRadius:"6px", background:C.ghost }}>
                <Label sx={{ mb:0.3 }}>Summary</Label>
                <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{s.section_05_summary}</Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ── Organ Effect Analysis ─────────────────────────────────────────────────────
const OrganAnalysisSection = ({ data }) => {
  const oa = data || {};
  const [tab, setTab] = useState(0);
  if (oa.error) return <EmptyState message={`Organ analysis error: ${oa.error}`} />;
  const registry    = oa.organ_health_registry     || [];
  const chains      = oa.organ_effect_chains        || [];
  const matrix      = oa.organ_relationship_matrix  || { nodes:[], edges:[] };
  const narratives  = oa.organ_effect_chain_narratives || [];
  const patientView = oa.patient_organ_health_overview  || [];
  const overall     = oa.overall_organ_health       || {};
  const tabs = [
    { label: "Health Scores",       icon: <MonitorHeartRounded sx={{ fontSize:13 }} /> },
    { label: "Effect Chains",       icon: <HubRounded         sx={{ fontSize:13 }} /> },
    { label: "Relationship Matrix", icon: <TimelineRounded    sx={{ fontSize:13 }} /> },
    { label: "Chain Narratives",    icon: <ArticleRounded     sx={{ fontSize:13 }} /> },
    { label: "Patient View",        icon: <PersonRounded      sx={{ fontSize:13 }} /> },
  ];
  return (
    <Box>
      {(overall.overall_organ_health_score != null || overall.organ_health_summary) && (
        <Box sx={{ mb:2.5, p:2.5, border:`1px solid ${C.organBdr}`, borderRadius:"6px", background:C.organBg }}>
          <Box sx={{ display:"flex", gap:3, flexWrap:"wrap", mb:overall.organ_health_summary?1.5:0 }}>
            {overall.overall_organ_health_score != null && (
              <Box>
                <Label sx={{ mb:0.3, color:C.organ }}>Overall Organ Health Score</Label>
                <Box sx={{ display:"flex", alignItems:"baseline", gap:0.75 }}>
                  <Typography sx={{ ...os({ fontSize:28, color:C.organ, lineHeight:1 }) }}>{overall.overall_organ_health_score}</Typography>
                  <Typography sx={{ ...os({ fontSize:13, color:C.ash }) }}>/ 100</Typography>
                </Box>
              </Box>
            )}
            {overall.organ_health_trend && <Box><Label sx={{ mb:0.3, color:C.organ }}>Trend</Label><Typography sx={{ ...os({ fontSize:12, color: overall.organ_health_trend==="DETERIORATING"?C.critical:overall.organ_health_trend==="IMPROVING"?C.low:C.moderate }) }}>{overall.organ_health_trend}</Typography></Box>}
            {overall.total_organs_assessed && <Box><Label sx={{ mb:0.3, color:C.organ }}>Assessed</Label><Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>{overall.total_organs_assessed}</Typography></Box>}
            {overall.organs_with_confirmed_disease > 0 && <Box><Label sx={{ mb:0.3, color:C.confirmed }}>With Confirmed Disease</Label><Typography sx={{ ...os({ fontSize:13, color:C.confirmed }) }}>{overall.organs_with_confirmed_disease}</Typography></Box>}
            {overall.most_affected_organ && <Box><Label sx={{ mb:0.3, color:C.critical }}>Most Affected</Label><Typography sx={{ ...os({ fontSize:13, color:C.critical }) }}>{overall.most_affected_organ} ({overall.most_affected_score})</Typography></Box>}
          </Box>
          {overall.organ_health_summary && <Typography sx={{ ...os({ fontSize:12, color:C.organ, lineHeight:1.6 }) }}>{overall.organ_health_summary}</Typography>}
        </Box>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ ...tabSx, mb:0, "& .MuiTab-root":{ ...tabSx["& .MuiTab-root"], fontSize:11, px:1.5 } }}>
        {tabs.map((t, i) => <Tab key={i} value={i} label={<Box sx={{ display:"flex", alignItems:"center", gap:0.6 }}>{t.icon}<span>{t.label}</span></Box>} />)}
      </Tabs>
      <Box sx={{ pt:2.5 }}>
        {tab === 0 && (
          <Box>
            {registry.length > 0 ? (
              <Box>
                <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"1fr 1fr", sm:"repeat(3,1fr)", lg:"repeat(4,1fr)" }, gap:1.5, mb:2.5 }}>
                  {registry.map((org, i) => <OrganHealthBar key={i} organ={org.organ||"—"} score={org.health_score} label={org.health_label} burdenLevel={org.burden_level} isConfirmed={org.confirmation_status?.includes("CONFIRMED")||org.burden_level==="CONFIRMED_DISEASE"} />)}
                </Box>
                <Box sx={{ p:2, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.ghost }}>
                  <Label sx={{ mb:1 }}>Health Score Scale</Label>
                  <Box sx={{ display:"flex", gap:1.25, flexWrap:"wrap" }}>
                    {[{r:"85–100",l:"Healthy",c:C.low,bg:C.lowBg,bdr:C.lowBdr},{r:"65–84",l:"Mild concern",c:C.teal,bg:C.tealBg,bdr:C.tealBdr},{r:"45–64",l:"Moderate concern",c:C.moderate,bg:C.moderateBg,bdr:C.moderateBdr},{r:"25–44",l:"High concern",c:C.high,bg:C.highBg,bdr:C.highBdr},{r:"0–24",l:"Critical",c:C.critical,bg:C.criticalBg,bdr:C.criticalBdr}].map(s => (
                      <Box key={s.r} sx={{ display:"flex", alignItems:"center", gap:0.75, px:1.25, py:0.5, borderRadius:"3px", background:s.bg, border:`1px solid ${s.bdr}` }}>
                        <Typography sx={{ ...os({ fontSize:11, color:s.c, fontWeight:500 }) }}>{s.r}</Typography>
                        <Typography sx={{ ...os({ fontSize:10, color:s.c }) }}>{s.l}</Typography>
                      </Box>
                    ))}
                  </Box>
                  {oa.organ_analysis_disclaimer && <Typography sx={{ ...os({ fontSize:10, color:C.silver, mt:1.5 }) }}>{oa.organ_analysis_disclaimer}</Typography>}
                </Box>
              </Box>
            ) : <EmptyState message="No organ health scores computed" />}
          </Box>
        )}
        {tab === 1 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.25 }}>
            {chains.length === 0 && <EmptyState message="No organ-to-organ effect chains" />}
            {chains.map((chain, i) => {
              const sigColor = chain.clinical_significance==="High"?C.critical:chain.clinical_significance==="Moderate"?C.moderate:C.ash;
              const sigBg    = chain.clinical_significance==="High"?C.criticalBg:chain.clinical_significance==="Moderate"?C.moderateBg:C.ghost;
              const sigBdr   = chain.clinical_significance==="High"?C.criticalBdr:chain.clinical_significance==="Moderate"?C.moderateBdr:C.fog;
              return (
                <Box key={i} sx={{ p:2, border:`1px solid ${sigBdr}`, borderRadius:"6px", background:sigBg }}>
                  <Box sx={{ display:"flex", alignItems:"center", gap:1.5, mb:1.25, flexWrap:"wrap" }}>
                    <Box sx={{ display:"flex", alignItems:"center", gap:1, px:1.5, py:0.5, borderRadius:"3px", background:C.white, border:`1px solid ${C.organBdr}` }}>
                      <Typography sx={{ ...os({ fontSize:12, color:C.organ }) }}>{chain.source_organ}</Typography>
                      <Typography sx={{ ...os({ fontSize:14, color:sigColor }) }}>{chain.direction||"→"}</Typography>
                      <Typography sx={{ ...os({ fontSize:12, color:C.organ }) }}>{chain.target_organ}</Typography>
                    </Box>
                    <Box sx={{ display:"flex", gap:0.75, flexWrap:"wrap" }}>
                      {chain.effect_type && <Chip label={chain.effect_type} size="small" sx={{ fontSize:10, height:20, background:C.white, color:C.smoke, border:`1px solid ${C.fog}`, fontFamily:FONT }} />}
                      {chain.effect_strength && <Chip label={`${chain.effect_strength} effect`} size="small" sx={{ fontSize:10, height:20, background:sigBg, color:sigColor, border:`1px solid ${sigBdr}`, fontFamily:FONT }} />}
                    </Box>
                  </Box>
                  {chain.effect_description && <Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.6 }) }}>{chain.effect_description}</Typography>}
                  {chain.graph_evidence && (
                    <Box sx={{ mt:1.25, p:1.25, border:`1px solid ${C.fog}`, borderRadius:"3px", background:C.white }}>
                      <Label sx={{ mb:0.3 }}>Graph evidence</Label>
                      {chain.graph_evidence.source_entity && <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>Source: {chain.graph_evidence.source_entity}</Typography>}
                      {chain.graph_evidence.target_entity && <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>Target: {chain.graph_evidence.target_entity}</Typography>}
                      {chain.graph_evidence.document && <Label sx={{ mt:0.3 }}>{chain.graph_evidence.document}{chain.graph_evidence.date?` · ${chain.graph_evidence.date}`:""}</Label>}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
        {tab === 2 && (
          <Box>
            {matrix.nodes?.length > 0 ? (
              <Box>
                <Label sx={{ mb:1 }}>Organ Nodes</Label>
                <Box sx={{ display:"grid", gridTemplateColumns:{ xs:"repeat(2,1fr)", sm:"repeat(3,1fr)", lg:"repeat(4,1fr)" }, gap:1, mb:2.5 }}>
                  {matrix.nodes.map((node, i) => {
                    const cfg = organScoreColor(node.health_score ?? 70);
                    return (
                      <Box key={i} sx={{ p:1.5, border:`1px solid ${cfg.bdr}`, borderRadius:"4px", background:cfg.bg, textAlign:"center" }}>
                        {node.has_confirmed_disease && <VerifiedRounded sx={{ fontSize:12, color:C.confirmed, display:"block", mx:"auto", mb:0.5 }} />}
                        <Typography sx={{ ...os({ fontSize:12, color:C.ink }) }}>{node.label}</Typography>
                        <Typography sx={{ ...os({ fontSize:18, color:cfg.color, lineHeight:1.2 }) }}>{node.health_score??'—'}</Typography>
                        <Typography sx={{ ...os({ fontSize:9, color:cfg.color }) }}>{node.health_label}</Typography>
                      </Box>
                    );
                  })}
                </Box>
                {matrix.edges?.length > 0 && (
                  <Box>
                    <Label sx={{ mb:1 }}>Effect Edges</Label>
                    {matrix.edges.map((edge, i) => {
                      const eff = edge.effect_strength==="Strong"?C.critical:edge.effect_strength==="Moderate"?C.moderate:C.ash;
                      return (
                        <Box key={i} sx={{ p:1.5, border:`1px solid ${C.fog}`, borderRadius:"3px", background:C.white, display:"flex", alignItems:"center", gap:1.5, flexWrap:"wrap", mb:0.75 }}>
                          <Typography sx={{ ...os({ fontSize:12, color:C.organ }) }}>{edge.source}</Typography>
                          <Typography sx={{ ...os({ fontSize:14, color:eff }) }}>{edge.direction||"→"}</Typography>
                          <Typography sx={{ ...os({ fontSize:12, color:C.organ }) }}>{edge.target}</Typography>
                          <Box sx={{ ml:"auto", display:"flex", gap:0.75 }}>
                            {edge.effect_strength && <Chip label={edge.effect_strength} size="small" sx={{ fontSize:10, height:18, background:C.ghost, color:eff, border:`1px solid ${C.fog}`, fontFamily:FONT }} />}
                            {edge.label && <Chip label={edge.label} size="small" sx={{ fontSize:10, height:18, background:C.ghost, color:C.ash, border:`1px solid ${C.fog}`, fontFamily:FONT }} />}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Box>
            ) : <EmptyState message="No organ relationship matrix data" />}
          </Box>
        )}
        {tab === 3 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.5 }}>
            {narratives.length === 0 && <EmptyState message="No effect chain narratives" />}
            {narratives.map((narrative, i) => {
              const sevColor = narrative.chain_severity==="Critical"?C.critical:narrative.chain_severity==="High"?C.high:narrative.chain_severity==="Moderate"?C.moderate:C.ash;
              const sevBg    = narrative.chain_severity==="Critical"?C.criticalBg:narrative.chain_severity==="High"?C.highBg:narrative.chain_severity==="Moderate"?C.moderateBg:C.ghost;
              const sevBdr   = narrative.chain_severity==="Critical"?C.criticalBdr:narrative.chain_severity==="High"?C.highBdr:narrative.chain_severity==="Moderate"?C.moderateBdr:C.fog;
              return (
                <ExpandableCard key={i} defaultOpen={narrative.chain_severity==="Critical"||narrative.chain_severity==="High"} accentColor={sevBdr}
                  headerContent={
                    <Box sx={{ display:"flex", alignItems:"center", gap:1.5, flex:1, flexWrap:"wrap" }}>
                      <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>Starting: {narrative.starting_organ}</Typography>
                      <Box sx={{ ml:"auto", display:"inline-flex", px:1, py:0.3, borderRadius:"3px", background:sevBg, border:`1px solid ${sevBdr}` }}>
                        <Typography sx={{ ...os({ fontSize:10, color:sevColor, fontWeight:500 }) }}>{narrative.chain_severity}</Typography>
                      </Box>
                    </Box>
                  }>
                  <Box sx={{ display:"flex", flexDirection:"column", gap:0.75, mb:1.5 }}>
                    {(narrative.chain_steps||[]).map((step, j) => (
                      <Box key={j} sx={{ display:"flex", gap:1.5 }}>
                        <Box sx={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                          <Box sx={{ width:22, height:22, borderRadius:"50%", background:C.organBg, border:`1px solid ${C.organBdr}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <Typography sx={{ ...os({ fontSize:10, color:C.organ }) }}>{step.step}</Typography>
                          </Box>
                          {j < (narrative.chain_steps.length-1) && <Box sx={{ width:1, flex:1, background:C.organBdr, my:0.25 }} />}
                        </Box>
                        <Box sx={{ flex:1, pb:1 }}>
                          <Typography sx={{ ...os({ fontSize:12, color:C.ink, fontWeight:500 }) }}>{step.organ}</Typography>
                          {step.condition && <Typography sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>{step.condition}</Typography>}
                          {step.effect_on_next && <Typography sx={{ ...os({ fontSize:11, color:C.ash, mt:0.25 }) }}>→ {step.effect_on_next}</Typography>}
                          {step.graph_entity && <Label sx={{ mt:0.25 }}>{step.graph_entity}{step.document?` · ${step.document}`:""}</Label>}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                  {narrative.final_impact && (
                    <Box sx={{ p:1.5, border:`1px solid ${sevBdr}`, borderRadius:"3px", background:sevBg }}>
                      <Label sx={{ mb:0.3, color:sevColor }}>Final impact</Label>
                      <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{narrative.final_impact}</Typography>
                    </Box>
                  )}
                </ExpandableCard>
              );
            })}
          </Box>
        )}
        {tab === 4 && (
          <Box sx={{ display:"flex", flexDirection:"column", gap:1.5 }}>
            {patientView.length === 0 && <EmptyState message="No patient organ health overview" />}
            {patientView.map((org, i) => {
              const cfg = organScoreColor(org.health_score ?? 70);
              return (
                <Box key={i} sx={{ border:`1px solid ${cfg.bdr}`, borderRadius:"6px", overflow:"hidden", background:C.white }}>
                  <Box sx={{ px:2.5, py:1.5, background:cfg.bg, display:"flex", alignItems:"center", justifyContent:"space-between", gap:1, flexWrap:"wrap" }}>
                    <Typography sx={{ ...os({ fontSize:14, color:cfg.color }) }}>{org.organ_plain_name||org.organ_medical_name}</Typography>
                    <Box sx={{ display:"flex", alignItems:"center", gap:1 }}>
                      {org.health_score!=null && <Typography sx={{ ...os({ fontSize:18, color:cfg.color, fontWeight:600 }) }}>{org.health_score}</Typography>}
                      <Box sx={{ display:"inline-flex", px:1, py:0.3, borderRadius:"3px", background:C.white, border:`1px solid ${cfg.bdr}` }}>
                        <Typography sx={{ ...os({ fontSize:11, color:cfg.color }) }}>{org.concern_level_plain}</Typography>
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ px:2.5, py:2 }}>
                    {org.health_status_plain    && <Box sx={{ mb:1.25 }}><Label sx={{ mb:0.3 }}>Status</Label><Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.6 }) }}>{org.health_status_plain}</Typography></Box>}
                    {org.what_was_found_plain   && <Box sx={{ mb:1.25 }}><Label sx={{ mb:0.3 }}>What was found</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.5 }) }}>{org.what_was_found_plain}</Typography></Box>}
                    {org.why_it_matters_plain   && <Box sx={{ mb:1.25 }}><Label sx={{ mb:0.3 }}>Why this matters</Label><Typography sx={{ ...os({ fontSize:12, color:C.charcoal, lineHeight:1.5 }) }}>{org.why_it_matters_plain}</Typography></Box>}
                    {org.connected_organs_plain && <Box sx={{ p:1.25, border:`1px solid ${C.organBdr}`, borderRadius:"3px", background:C.organBg }}><Label sx={{ mb:0.3, color:C.organ }}>Connected organs</Label><Typography sx={{ ...os({ fontSize:11, color:C.organ }) }}>{org.connected_organs_plain}</Typography></Box>}
                    {org.source_document_plain  && <Label sx={{ mt:1 }}>Source: {org.source_document_plain}</Label>}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function PredictiveDiseasePanel({ patientId, doctorId }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [activeTab,   setActiveTab]   = useState(0);
  const [agentStep,   setAgentStep]   = useState(0);
  const [patientInfo, setPatientInfo] = useState(null);
  const stepRef = useRef(null);

  const fetchPrediction = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true); setError(null); setData(null); setAgentStep(0);
    stepRef.current = setInterval(() => setAgentStep(s => s < 8 ? s + 1 : s), 3500);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/predictive-disease-intelligence`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ patient_id: patientId, doctor_id: doctorId, include_intermediates: false }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      console.log("PDGI v4.0 response:", json);
      setData(json);
      setAgentStep(9);
    } catch (err) {
      setError(err.message || "Failed to load predictive disease intelligence");
    } finally {
      clearInterval(stepRef.current);
      setLoading(false);
    }
  }, [patientId, doctorId]);

  useEffect(() => () => { if (stepRef.current) clearInterval(stepRef.current); }, []);

  useEffect(() => {
    const fetchPatientInfo = async () => {
      try {
        const res    = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientId}`);
        const result = await res.json();
        setPatientInfo({ patient_name: result.patient_name||"", age: result.age||"", gender: result.gender||"", hms_id: result.hms_id||"" });
      } catch {}
    };
    if (patientId) fetchPatientInfo();
  }, [patientId]);

  // ── Data extraction ────────────────────────────────────────────────────────
  const pe   = data?.patient_education || {};
  const s01  = pe.section_01_your_current_health   || {};
  const s02  = pe.section_02_what_to_watch_for     || {};
  const s03  = pe.section_03_monitoring_checklist  || {};
  const s04  = pe.section_04_who_to_consult        || {};
  const s05  = pe.section_05_lifestyle             || {};
  const qrisk3 = data?.qrisk3 || null;
  const oa   = data?.organ_effect_analysis || null;
  const confirmedDiagnoses = data?.confirmed_diagnoses || [];
  const execSummary = pe.executive_summary || data?.executive_summary || "";
  const headline    = pe.patient_summary_headline || "";

  const qrisk3Score = qrisk3?.score_percent;
  const overallOrganScore = oa?.overall_organ_health?.overall_organ_health_score;
  const numConditions = s01?.condition_cards?.length || 0;
  const numSpecialists = s04?.specialist_referrals?.length || 0;

  // PDF handler
  const handleDownloadPDF = () => {
    const pdfDoc = generateMedicalPDF({ data, patientInfo, qrisk3, patientEducation: pe, organEffectAnalysis: oa });
    pdfDoc.save(`medconsolidate-patient-report-${new Date().toISOString().slice(0,10)}.pdf`);
  };

  const TABS = [
    { label: "01  Current Health",   id: "s01", icon: <PersonRounded sx={{ fontSize:13 }} /> },
    { label: "02  What to Watch",    id: "s02", icon: <WarningAmberRounded sx={{ fontSize:13 }} /> },
    { label: "03  Monitoring",       id: "s03", icon: <EventNoteRounded sx={{ fontSize:13 }} /> },
    { label: "04  Who to Consult",   id: "s04", icon: <PeopleRounded sx={{ fontSize:13 }} /> },
    { label: "05  Diet & Lifestyle", id: "s05", icon: <RestaurantRounded sx={{ fontSize:13 }} /> },
    { label: "Organ Analysis",       id: "oa",  icon: <HubRounded sx={{ fontSize:13 }} /> },
  ];

  return (
    <Box sx={{ display:"flex", flexDirection:"column", gap:2.5 }}>

      {/* ── Header ── */}
      <Box sx={{ ...sectionCard }}>
        <SectionHeader
          icon={<MonitorHeartRounded sx={{ fontSize:18 }} />}
          sub="PDGI v4.0  ·  Patient-Education Pipeline  ·  Graph-entity-grounded  ·  No treatment recommendations"
          action={
            <Box sx={{ display:"flex", gap:1, flexWrap:"wrap" }}>
              {data && !loading && (
                <Box component="button" onClick={handleDownloadPDF}
                  sx={{ ...os({ fontSize:12, color:C.charcoal }), px:2, py:1, borderRadius:"4px", background:C.white, border:`1px solid ${C.mist}`, cursor:"pointer", display:"flex", alignItems:"center", gap:0.75, "&:hover":{ background:C.ghost } }}>
                  <DownloadRounded sx={{ fontSize:15 }} /> Download PDF
                </Box>
              )}
              <Box component="button" onClick={fetchPrediction} disabled={loading}
                sx={{ ...os({ fontSize:12, color: loading ? C.silver : C.white }), px:2.5, py:1.1, borderRadius:"4px", background: loading ? C.mist : C.black, border:"none", cursor: loading ? "not-allowed" : "pointer", display:"flex", alignItems:"center", gap:0.75, "&:hover":{ background: loading ? C.mist : C.charcoal } }}>
                {loading ? <CircularProgress size={13} sx={{ color:C.silver }} /> : <RefreshRounded sx={{ fontSize:15 }} />}
                {loading ? "Analysing…" : data ? "Refresh Analysis" : "Run Analysis"}
              </Box>
            </Box>
          }
        >
          Predictive Disease Intelligence
        </SectionHeader>

        {/* Stats row */}
        {(data || patientInfo) && !loading && (
          <Box sx={{ px:3, py:2, borderTop:`1px solid ${C.fog}`, background:C.ghost, display:"flex", gap:3, flexWrap:"wrap" }}>
            {patientInfo?.patient_name && <Box><Label sx={{ mb:0.3 }}>Patient</Label><Typography sx={{ ...os({ fontSize:14, color:C.ink }) }}>{patientInfo.patient_name}</Typography></Box>}
            {(patientInfo?.age || patientInfo?.gender) && <Box><Label sx={{ mb:0.3 }}>Age / Sex</Label><Typography sx={{ ...os({ fontSize:14, color:C.ink }) }}>{[patientInfo.age, patientInfo.gender].filter(Boolean).join(" / ")}</Typography></Box>}
            {patientInfo?.hms_id && <Box><Label sx={{ mb:0.3 }}>HMS ID</Label><Typography sx={{ ...os({ fontSize:13, color:C.ash }) }}>{patientInfo.hms_id}</Typography></Box>}
            {data && <Box sx={{ width:"1px", background:C.fog, alignSelf:"stretch", mx:0.5 }} />}
            {data && numConditions > 0 && <Box><Label sx={{ mb:0.3 }}>Conditions</Label><Typography sx={{ ...os({ fontSize:14, color:C.ink }) }}>{numConditions}</Typography></Box>}
            {data && confirmedDiagnoses.length > 0 && <Box><Label sx={{ mb:0.3 }}>Confirmed Diagnoses</Label><Typography sx={{ ...os({ fontSize:14, color:C.confirmed }) }}>{confirmedDiagnoses.length}</Typography></Box>}
            {data && numSpecialists > 0 && <Box><Label sx={{ mb:0.3 }}>Specialists Recommended</Label><Typography sx={{ ...os({ fontSize:14, color:C.ink }) }}>{numSpecialists}</Typography></Box>}
            {data && qrisk3Score != null && (
              <Box>
                <Label sx={{ mb:0.3 }}>QRISK3 (10yr CVD)</Label>
                <Box sx={{ display:"inline-flex", alignItems:"center", gap:0.5, px:1, py:0.3, borderRadius:"3px",
                  background: qrisk3Score<10?C.lowBg:qrisk3Score<20?C.moderateBg:C.criticalBg,
                  border:`1px solid ${qrisk3Score<10?C.lowBdr:qrisk3Score<20?C.moderateBdr:C.criticalBdr}` }}>
                  <FavoriteRounded sx={{ fontSize:11, color:qrisk3Score<10?C.low:qrisk3Score<20?C.moderate:C.critical }} />
                  <Typography sx={{ ...os({ fontSize:12, color:qrisk3Score<10?C.low:qrisk3Score<20?C.moderate:C.critical, fontWeight:500 }) }}>{qrisk3Score}%</Typography>
                </Box>
              </Box>
            )}
            {data && overallOrganScore != null && (() => { const cfg = organScoreColor(overallOrganScore); return (
              <Box>
                <Label sx={{ mb:0.3 }}>Organ Health Score</Label>
                <Box sx={{ display:"inline-flex", alignItems:"center", gap:0.5, px:1, py:0.3, borderRadius:"3px", background:cfg.bg, border:`1px solid ${cfg.bdr}` }}>
                  <HubRounded sx={{ fontSize:11, color:cfg.color }} />
                  <Typography sx={{ ...os({ fontSize:12, color:cfg.color, fontWeight:500 }) }}>{overallOrganScore}/100 · {cfg.label}</Typography>
                </Box>
              </Box>
            ); })()}
            {data && data.processing_time_ms && <Box><Label sx={{ mb:0.3 }}>Processing Time</Label><Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{(data.processing_time_ms/1000).toFixed(1)}s</Typography></Box>}
          </Box>
        )}
      </Box>

      {/* ── Loading ── */}
      {loading && (
        <Box sx={{ ...sectionCard }}>
          <Box sx={{ px:3, pt:3, pb:1 }}>
            <Typography sx={{ ...os({ fontSize:14, color:C.ink }) }}>Running PDGI v4.0 Pipeline — 9 Agents</Typography>
            <Typography sx={{ ...os({ fontSize:11, color:C.ash, mt:0.4 }) }}>Sections 01–05 will be generated in sequence. Dietary guidance and organ analysis run in parallel at the end.</Typography>
          </Box>
          <Box sx={{ px:3, pb:3 }}><AgentProgressBar currentAgent={agentStep} /></Box>
        </Box>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <Box sx={{ p:3, border:`1px solid ${C.criticalBdr}`, borderRadius:"6px", background:C.criticalBg, display:"flex", alignItems:"flex-start", gap:2 }}>
          <ErrorRounded sx={{ fontSize:18, color:C.critical, flexShrink:0 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize:13, color:C.critical, mb:0.5 }) }}>Analysis failed</Typography>
            <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>{error}</Typography>
            <Box component="button" onClick={fetchPrediction} sx={{ ...os({ fontSize:11, color:C.charcoal }), mt:1.5, px:2, py:0.9, borderRadius:"4px", background:"transparent", border:`1px solid ${C.mist}`, cursor:"pointer", "&:hover":{ background:C.ghost } }}>Retry</Box>
          </Box>
        </Box>
      )}

      {/* ── Empty ── */}
      {!loading && !error && !data && (
        <Box sx={{ ...sectionCard }}>
          <Box sx={{ p:6, textAlign:"center" }}>
            <MonitorHeartRounded sx={{ fontSize:40, color:C.mist, mb:2 }} />
            <Typography sx={{ ...os({ fontSize:15, color:C.charcoal, mb:1 }) }}>MedConsolidate Patient Health Intelligence  ·  v4.0</Typography>
            <Typography sx={{ ...os({ fontSize:13, color:C.ash, mb:3, maxWidth:560, mx:"auto", lineHeight:1.6 }) }}>
              Click "Run Analysis" to generate a full patient-education report across 5 sections — in plain language, tailored to this patient's documented conditions.
            </Typography>
            <Box sx={{ display:"flex", gap:1.25, justifyContent:"center", flexWrap:"wrap" }}>
              {["Section 01 — Current Health","Section 02 — What to Watch For","Section 03 — Monitoring Checklist","Section 04 — Who to Consult","Section 05 — Diet & Lifestyle","QRISK3 CVD Risk","Organ Effect Analysis"].map(f => (
                <Box key={f} sx={{ px:2, py:1, border:`1px solid ${C.fog}`, borderRadius:"4px", background:C.ghost }}>
                  <Typography sx={{ ...os({ fontSize:11, color:C.smoke }) }}>{f}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Results ── */}
      {data && !loading && (
        <>
          {/* Confirmed diagnoses banner */}
          {confirmedDiagnoses.length > 0 && (
            <Box sx={{ p:2.5, border:`1px solid ${C.confirmedBdr}`, borderRadius:"6px", background:C.confirmedBg, display:"flex", alignItems:"flex-start", gap:2 }}>
              <VerifiedRounded sx={{ fontSize:18, color:C.confirmed, flexShrink:0, mt:0.2 }} />
              <Box sx={{ flex:1 }}>
                <Typography sx={{ ...os({ fontSize:13, color:C.confirmed, mb:0.5 }) }}>
                  {confirmedDiagnoses.length} Confirmed {confirmedDiagnoses.length===1?"Diagnosis":"Diagnoses"} in Clinical Record
                </Typography>
                <Box sx={{ display:"flex", gap:0.75, flexWrap:"wrap", mt:0.5 }}>
                  {confirmedDiagnoses.map((d, i) => (
                    <Chip key={i} label={d.condition||d.name||d} size="small"
                      sx={{ fontSize:10, height:22, background:C.white, color:C.confirmed, border:`1px solid ${C.confirmedBdr}`, fontFamily:FONT }} />
                  ))}
                </Box>
              </Box>
            </Box>
          )}

          {/* QRISK3 banner */}
          {qrisk3Score != null && (
            <Box sx={{ p:2.5, border:`1px solid ${qrisk3Score<10?C.lowBdr:qrisk3Score<20?C.moderateBdr:C.criticalBdr}`, borderRadius:"6px",
              background: qrisk3Score<10?C.lowBg:qrisk3Score<20?C.moderateBg:C.criticalBg,
              display:"flex", alignItems:"flex-start", gap:2 }}>
              <FavoriteRounded sx={{ fontSize:18, color:qrisk3Score<10?C.low:qrisk3Score<20?C.moderate:C.critical, flexShrink:0, mt:0.2 }} />
              <Box sx={{ flex:1 }}>
                <Typography sx={{ ...os({ fontSize:13, color:qrisk3Score<10?C.low:qrisk3Score<20?C.moderate:C.critical, mb:0.4 }) }}>
                  QRISK3: {qrisk3Score}% estimated 10-year CVD / stroke risk  ·  {qrisk3?.risk_category}
                </Typography>
                <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>
                  {qrisk3?.confidence}  ·  {qrisk3?.key_variables_present}/{qrisk3?.key_variables_total} key variables from graph
                </Typography>
              </Box>
              <Box component="button" onClick={() => setActiveTab(0)}
                sx={{ ...os({ fontSize:11, color:C.charcoal }), px:1.5, py:0.6, borderRadius:"4px", background:C.white, border:`1px solid ${C.fog}`, cursor:"pointer", flexShrink:0, "&:hover":{ background:C.ghost } }}>
                Section 02
              </Box>
            </Box>
          )}

          {/* Organ health banner */}
          {overallOrganScore != null && (() => { const cfg = organScoreColor(overallOrganScore); return (
            <Box sx={{ p:2.5, border:`1px solid ${cfg.bdr}`, borderRadius:"6px", background:cfg.bg, display:"flex", alignItems:"flex-start", gap:2 }}>
              <HubRounded sx={{ fontSize:18, color:cfg.color, flexShrink:0, mt:0.2 }} />
              <Box sx={{ flex:1 }}>
                <Typography sx={{ ...os({ fontSize:13, color:cfg.color, mb:0.4 }) }}>
                  Organ Health Score: {overallOrganScore}/100  ·  {cfg.label}  ·  Trend: {oa?.overall_organ_health?.organ_health_trend||"—"}
                </Typography>
                {oa?.overall_organ_health?.most_affected_organ && <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>Most affected: {oa.overall_organ_health.most_affected_organ} ({oa.overall_organ_health.most_affected_score})</Typography>}
              </Box>
              <Box component="button" onClick={() => setActiveTab(5)}
                sx={{ ...os({ fontSize:11, color:C.charcoal }), px:1.5, py:0.6, borderRadius:"4px", background:C.white, border:`1px solid ${C.fog}`, cursor:"pointer", flexShrink:0, "&:hover":{ background:C.ghost } }}>
                Organ Analysis
              </Box>
            </Box>
          ); })()}

          {/* Headline / Executive Summary */}
          {headline && (
            <Box sx={{ p:2.5, border:`1px solid ${C.skyBdr}`, borderRadius:"6px", background:C.skyBg, display:"flex", gap:1.5 }}>
              <InfoRounded sx={{ fontSize:18, color:C.sky, flexShrink:0, mt:0.2 }} />
              <Typography sx={{ ...os({ fontSize:14, color:C.sky, lineHeight:1.6 }) }}>{headline}</Typography>
            </Box>
          )}
          {execSummary && !headline && (
            <Box sx={{ ...sectionCard }}>
              <Box sx={{ px:3, py:2.5, borderBottom:`1px solid ${C.fog}`, background:C.ghost, display:"flex", gap:1.5 }}>
                <ArticleRounded sx={{ fontSize:16, color:C.smoke }} />
                <Typography sx={{ ...os({ fontSize:13, color:C.ink }) }}>Executive Summary</Typography>
              </Box>
              <Box sx={{ px:3, py:2.5 }}><Typography sx={{ ...os({ fontSize:13, color:C.charcoal, lineHeight:1.7 }) }}>{execSummary}</Typography></Box>
            </Box>
          )}

          {/* Errors from pipeline */}
          {data.errors?.length > 0 && (
            <Box sx={{ p:2, border:`1px solid ${C.moderateBdr}`, borderRadius:"6px", background:C.moderateBg }}>
              <Label sx={{ mb:0.75, color:C.moderate }}>Pipeline Warnings</Label>
              {data.errors.map((e, i) => <Typography key={i} sx={{ ...os({ fontSize:11, color:C.charcoal }) }}>· {e}</Typography>)}
            </Box>
          )}

          {/* Main tabbed sections */}
          <Box sx={{ ...sectionCard }}>
            <Box sx={{ px:3, pt:2.5, pb:0 }}>
              <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={tabSx}>
                {TABS.map((t, i) => (
                  <Tab key={t.id} value={i} label={
                    <Box sx={{ display:"flex", alignItems:"center", gap:0.75 }}>
                      {t.icon}<span>{t.label}</span>
                      {t.id === "s01" && numConditions > 0 && (
                        <Box sx={{ width:16, height:16, borderRadius:"50%", background:C.confirmed, display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <Typography sx={{ ...os({ fontSize:9, color:C.white }) }}>{numConditions}</Typography>
                        </Box>
                      )}
                      {t.id === "s02" && qrisk3Score != null && (
                        <Box sx={{ px:0.75, py:0.1, borderRadius:"2px",
                          background: qrisk3Score<10?C.lowBg:qrisk3Score<20?C.moderateBg:C.criticalBg,
                          border:`1px solid ${qrisk3Score<10?C.lowBdr:qrisk3Score<20?C.moderateBdr:C.criticalBdr}` }}>
                          <Typography sx={{ ...os({ fontSize:9, color:qrisk3Score<10?C.low:qrisk3Score<20?C.moderate:C.critical, fontWeight:500 }) }}>{qrisk3Score}%</Typography>
                        </Box>
                      )}
                      {t.id === "s04" && numSpecialists > 0 && (
                        <Box sx={{ px:0.75, py:0.1, borderRadius:"2px", background:C.infoBg, border:`1px solid ${C.infoBdr}` }}>
                          <Typography sx={{ ...os({ fontSize:9, color:C.info, fontWeight:500 }) }}>{numSpecialists}</Typography>
                        </Box>
                      )}
                      {t.id === "oa" && overallOrganScore != null && (() => { const cfg = organScoreColor(overallOrganScore); return (
                        <Box sx={{ px:0.75, py:0.1, borderRadius:"2px", background:cfg.bg, border:`1px solid ${cfg.bdr}` }}>
                          <Typography sx={{ ...os({ fontSize:9, color:cfg.color, fontWeight:500 }) }}>{overallOrganScore}</Typography>
                        </Box>
                      ); })()}
                    </Box>
                  } />
                ))}
              </Tabs>
            </Box>
            <Box sx={{ p:{ xs:2, sm:3 } }}>
              {activeTab === 0 && <Section01 data={s01} />}
              {activeTab === 1 && <Section02 data={s02} qrisk3={qrisk3} />}
              {activeTab === 2 && <Section03 data={s03} />}
              {activeTab === 3 && <Section04 data={s04} />}
              {activeTab === 4 && <Section05 data={s05} />}
              {activeTab === 5 && <OrganAnalysisSection data={oa} />}
            </Box>
          </Box>

          {/* Disclaimer */}
          {(pe.disclaimer || data.disclaimer) && (
            <Box sx={{ p:2, border:`1px solid ${C.infoBdr}`, borderRadius:"6px", background:C.infoBg, display:"flex", alignItems:"flex-start", gap:1.5 }}>
              <InfoRounded sx={{ fontSize:14, color:C.info, flexShrink:0, mt:0.2 }} />
              <Typography sx={{ ...os({ fontSize:11, color:C.info, lineHeight:1.5 }) }}>{pe.disclaimer || data.disclaimer}</Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}