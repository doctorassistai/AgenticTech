// DischargeSummary.jsx — Standalone Discharge Summary component
// Wired to:
//   POST hms/users/ai-legacy/discharge-summary            (Generate button)
//   GET  hms/users/data/context/discharge-summary/{patientId}  (retrieve, after generate succeeds)
// Backend: CCGI Discharge Summary Agent v5.5.0 (TWO-TAB OUTPUT + 3-LEVEL
// DRILL-DOWN TIMELINE + DATE OVERVIEW SUMMARY + FULL QUICK FACTS + SYNOPTIC
// REPORT + DETERMINISTIC COMPLETENESS CHECK — see discharge_summary.py)
//
// v5.5.0 wiring changes vs. v5.4.0:
//   • GENERATE-THEN-RETRIEVE FLOW — matches ClinicalSummaryTab.jsx's pattern
//     exactly: "Generate" POSTs to kick off the pipeline, and ONLY on a
//     successful POST does the component call the GET retrieve endpoint to
//     populate the view from the DB record the backend just saved. The POST
//     response itself is no longer used to populate state directly.
//   • On mount (and whenever patientId changes), the component ALSO calls
//     the GET retrieve endpoint on its own — same as ClinicalSummaryTab's
//     panels — so a previously generated report shows up immediately
//     without requiring the user to click Generate again.
//   • Added a "Refresh" button next to the report header to re-pull from
//     the DB on demand, same as the other CCGI tabs.
//   • FIXED — the specialty dropdown (SPECIALTY_OPTIONS / MenuItem) was
//     imported but never rendered, and the generate payload sent a
//     hardcoded `specialty: "oncology"` regardless of what the user
//     picked. Both fixed: a real specialty <TextField select> is now
//     rendered, and the payload sends the actual `specialty` state value.
//
// v5.4.0 wiring changes vs. v5.2.1 (kept):
//   • Timeline tab is a genuine 3-LEVEL DRILL-DOWN, matching the backend's
//     tabs.timeline.date_index (Level 1), tabs.timeline.blocks[].
//     date_overview_summary (Level 2), and each document's summary +
//     quick_facts covering all 9 DS2-extracted categories (Level 3).
//   • result.version now reports "5.5.0" — surfaced automatically via the
//     existing `v{result.version}` display, no hardcoding needed here.
//   • No other contract changes: still reads
//     result.tabs.timeline.blocks, result.tabs.timeline.date_index,
//     result.tabs.synoptic_report.structured, and
//     result.tabs.synoptic_report.text.
//
// v5.2.1 wiring changes (kept):
//   • Quality Scores / Auditor Review Notes / Gaps Flagged block removed
//     from "Report Overview" — only the compact Approved/Needs Review chip
//     (quality.approved_for_clinical_use) is still rendered.
//   • Timeline entries sit along a vertical rail with dated markers (dots).
//     First OP Visit gets a solid outlined marker; dates with an abnormal
//     document get a danger-colored marker.
//
// The backend still returns legacy `discharge_summary` / `day_wise_timeline`
// fields for backward compatibility, but this component speaks the new
// `tabs` contract directly.
//
// Self-contained — drop this file in anywhere (its own route/tab/modal).
// Brand tokens mirror the rest of the Doctorassist.AI module (OTRecord.jsx,
// ClinicalSummaryTab.jsx) so it looks native alongside them.

import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, TextField, Button, CircularProgress, Collapse, MenuItem,
} from "@mui/material";
import {
  AutoAwesomeRounded, ExpandMoreRounded, ExpandLessRounded,
  AssignmentTurnedInRounded, DescriptionRounded, RefreshRounded,
  LocalHospitalRounded, ScheduleRounded, TableChartRounded, MenuBookRounded,
  FactCheckRounded, ListAltRounded,
} from "@mui/icons-material";

// ─── Brand Tokens ──────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FONT_MONO = '"Roboto Mono", "Courier New", monospace';
const FW_LIGHT = 300;
const FW_NORMAL = 400;
const FW_SEMIBOLD = 600;

const C = {
  black:        "#000000",
  white:        "#ffffff",
  bgPrimary:    "#ffffff",
  bgSecondary:  "#fafafa",
  bgTertiary:   "#f5f5f5",
  bgHighlight:  "#f6f5ef",
  textPrimary:  "#000000",
  textSecond:   "#444444",
  textMuted:    "#888888",
  border:       "#e0e0e0",
  borderStrong: "#000000",
  success:      "#2e7d32",
  warning:      "#795548",
  danger:       "#b00020",
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
// NOTE: matches the FastAPI routes in discharge_summary.py:
//   router.post("/discharge-summary")            — clean alias of the
//                                                    original "/discharge-summaryy"
//                                                    (double 'y' typo) route
//   router.get("/discharge-summary/{patient_id}") — DB retrieve, added in v5.5.0
// Adjust these mount prefixes if your router is included under a different path.
const DISCHARGE_SUMMARY_POST_URL = `${API_BASE_URL}hms/users/ai-legacy/discharge-summaryy`;
const DISCHARGE_SUMMARY_GET_URL  = (patientId) => `${API_BASE_URL}hms/users/data/context/discharge-summary/${patientId}`;

const SPECIALTY_OPTIONS = [
  "Surgical Oncology", "Urology", "General Surgery", "Cardiology",
  "Orthopaedics", "Gastroenterology", "Nephrology", "Pulmonology",
];

// Order + display labels for the 9 DS2-extracted quick_facts categories.
// Mirrors backend `_build_quick_facts` keys exactly.
const QUICK_FACT_CATEGORIES = [
  { key: "vitals",         label: "Vitals" },
  { key: "medications",    label: "Medications" },
  { key: "investigations", label: "Investigations" },
  { key: "procedures",     label: "Procedures" },
  { key: "findings",       label: "Findings" },
  { key: "diagnoses",      label: "Diagnoses" },
  { key: "treatments",     label: "Treatments" },
  { key: "abnormalities",  label: "Abnormalities" },
  { key: "treatment_plan", label: "Treatment Plan" },
];

// ─── Shared Styles ──────────────────────────────────────────────────────────
const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.black },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
  },
  "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 13 },
};
const sectionHeaderSx = {
  px: 2.5, py: 1.25, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em",
  color: C.textPrimary, fontFamily: FONT, fontWeight: FW_NORMAL,
};
const saveBtnSx = {
  px: 3, py: 0.9, background: C.black, color: C.white,
  fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 12,
  textTransform: "none", borderRadius: 0,
  "&:hover": { background: "#1a1a1a" },
  "&.Mui-disabled": { background: "#cccccc", color: "#ffffff" },
};
const outlineBtnSx = {
  px: 3, py: 0.9, background: C.white, color: C.black,
  border: `1px solid ${C.black}`, fontFamily: FONT, fontWeight: FW_NORMAL,
  fontSize: 12, textTransform: "none", borderRadius: 0,
  "&:hover": { background: C.bgTertiary },
};

const SectionBox = ({ title, children, right }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2.5 }}>
    <Box sx={{ ...sectionHeaderSx, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span>{title}</span>
      {right}
    </Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

const FieldLabel = ({ children }) => (
  <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 0.75 }}>
    {children}
  </Typography>
);

const StatusChip = ({ label, tone = "neutral" }) => {
  const map = {
    positive: { bg: "#f0f7f0", color: C.success, border: C.success },
    negative: { bg: "#fafafa", color: C.textMuted, border: C.border },
    warning:  { bg: "#fff8e1", color: C.warning, border: C.warning },
    danger:   { bg: "#fdecea", color: C.danger, border: C.danger },
    neutral:  { bg: "#f5f5f5", color: C.textSecond, border: C.border },
  };
  const s = map[tone] || map.neutral;
  return (
    <Box sx={{ display: "inline-block", px: 1, py: 0.3, border: `1px solid ${s.border}`, background: s.bg, color: s.color, fontSize: 10, fontFamily: FONT, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {label}
    </Box>
  );
};

const EmptyState = ({ message }) => (
  <Box sx={{ py: 5, textAlign: "center" }}>
    <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textMuted, fontStyle: "italic" }}>
      {message}
    </Typography>
  </Box>
);

const LoadingState = ({ message = "Loading…" }) => (
  <Box sx={{ py: 5, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
    <CircularProgress size={22} sx={{ color: C.black }} />
    <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>{message}</Typography>
  </Box>
);

// ─── Tab switcher (Timeline / Synoptic Report) ─────────────────────────────
const TabSwitcher = ({ active, onChange }) => {
  const tabs = [
    { key: "timeline", label: "Timeline", sub: "Narrative, 3-level drill-down", icon: ScheduleRounded },
    { key: "synoptic", label: "Synoptic Report", sub: "Structured, per element", icon: TableChartRounded },
  ];
  return (
    <Box sx={{ display: "flex", borderBottom: `1px solid ${C.border}`, mb: 2.5 }}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <Box
            key={t.key}
            onClick={() => onChange(t.key)}
            sx={{
              display: "flex", flexDirection: "column", gap: 0.15,
              px: 2.5, py: 1, cursor: "pointer",
              borderBottom: isActive ? `2px solid ${C.black}` : "2px solid transparent",
              mb: "-1px",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Icon sx={{ fontSize: 15, color: isActive ? C.black : C.textMuted }} />
              <Typography sx={{
                fontFamily: FONT, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em",
                fontWeight: isActive ? FW_SEMIBOLD : FW_NORMAL,
                color: isActive ? C.textPrimary : C.textMuted,
              }}>
                {t.label}
              </Typography>
            </Box>
            <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, pl: "21px" }}>
              {t.sub}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
};

// ─── LEVEL 1 — Quick Index strip ────────────────────────────────────────────
const QuickIndexStrip = ({ dateIndex, onJump }) => {
  const [open, setOpen] = useState(true);
  if (!dateIndex || dateIndex.length === 0) return null;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, mb: 2.5, background: C.bgSecondary }}>
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          px: 1.75, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", borderBottom: open ? `1px solid ${C.border}` : "none",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <ListAltRounded sx={{ fontSize: 15, color: C.textMuted }} />
          <Typography sx={{ fontFamily: FONT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: FW_SEMIBOLD, color: C.textPrimary }}>
            Quick Index — Date-Wise Summary
          </Typography>
        </Box>
        {open ? <ExpandLessRounded sx={{ fontSize: 18, color: C.textMuted }} /> : <ExpandMoreRounded sx={{ fontSize: 18, color: C.textMuted }} />}
      </Box>
      <Collapse in={open}>
        <Box sx={{ p: 1.5 }}>
          {dateIndex.map((row, i) => (
            <Box
              key={`${row.date || "unknown"}-${i}`}
              onClick={() => onJump && onJump(row.date)}
              sx={{
                display: "flex", alignItems: "baseline", gap: 1.25, py: 0.6, px: 0.5,
                cursor: onJump ? "pointer" : "default",
                borderBottom: i === dateIndex.length - 1 ? "none" : `1px solid ${C.bgTertiary}`,
                "&:hover": onJump ? { background: C.bgTertiary } : {},
              }}
            >
              <Typography sx={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: FW_SEMIBOLD, color: C.textPrimary, minWidth: 88 }}>
                {row.date || "Date Unknown"}
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, minWidth: 130, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {row.date_label}
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_LIGHT, color: C.textSecond, flex: 1 }}>
                {row.one_line_summary}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

// ─── LEVEL 2 — Date overview summary box ───────────────────────────────────
const DateOverviewBox = ({ text }) => {
  if (!text) return null;
  return (
    <Box sx={{ background: C.bgHighlight, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.black}`, p: 1.5, mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.6, mb: 0.5 }}>
        <FactCheckRounded sx={{ fontSize: 14, color: C.textMuted }} />
        <Typography sx={{ fontFamily: FONT, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontWeight: FW_SEMIBOLD }}>
          Day Overview
        </Typography>
      </Box>
      <Typography sx={{ fontFamily: FONT, fontSize: 12.5, fontWeight: FW_LIGHT, lineHeight: 1.7, color: C.textSecond }}>
        {text}
      </Typography>
    </Box>
  );
};

// ─── LEVEL 3 — Quick Facts panel (all 9 categories) ────────────────────────
const QuickFactsPanel = ({ quickFacts }) => {
  const nonEmpty = QUICK_FACT_CATEGORIES.filter(
    (c) => Array.isArray(quickFacts?.[c.key]) && quickFacts[c.key].length > 0
  );
  if (nonEmpty.length === 0) {
    return (
      <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
        No quick facts extracted for this document.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 1.5 }}>
      {nonEmpty.map((cat) => {
        const items = quickFacts[cat.key];
        const isAbnormal = cat.key === "abnormalities";
        return (
          <Box key={cat.key} sx={{ border: `1px solid ${C.border}`, p: 1.25 }}>
            <Typography sx={{
              fontFamily: FONT, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
              color: isAbnormal ? C.danger : C.textMuted, fontWeight: FW_SEMIBOLD, mb: 0.6,
            }}>
              {cat.label} ({items.length})
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 1.75 }}>
              {items.map((item, idx) => (
                <Box component="li" key={idx} sx={{
                  fontFamily: FONT, fontSize: 11.5, fontWeight: FW_LIGHT, lineHeight: 1.6,
                  color: isAbnormal ? C.danger : C.textPrimary, mb: 0.15,
                }}>
                  {item}
                </Box>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

// One independent synoptic table for ONE document.
const DocumentSynopticTable = ({ doc }) => {
  const [open, setOpen] = useState(false);
  const elements = doc?.synoptic_elements || [];

  return (
    <Box sx={{ border: `1px solid ${C.border}`, mb: 1.5 }}>
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          px: 1.75, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", background: C.bgSecondary, borderBottom: open ? `1px solid ${C.border}` : "none",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DescriptionRounded sx={{ fontSize: 15, color: C.textMuted }} />
          <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_SEMIBOLD, color: C.textPrimary }}>
            {doc?.document_label || "Clinical Document"}
          </Typography>
          {doc?.filename && (
            <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textMuted }}>
              [{doc.filename}]
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {doc?.has_abnormalities && <StatusChip label="Abnormal" tone="danger" />}
          <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted }}>
            {elements.length} element{elements.length === 1 ? "" : "s"}
          </Typography>
          {open ? <ExpandLessRounded sx={{ fontSize: 18, color: C.textMuted }} /> : <ExpandMoreRounded sx={{ fontSize: 18, color: C.textMuted }} />}
        </Box>
      </Box>
      <Collapse in={open}>
        <Box sx={{ p: 1.75 }}>
          {elements.length === 0 ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
              No structured data elements extracted for this document.
            </Typography>
          ) : (
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
              <Box component="thead">
                <Box component="tr">
                  {["Element ID", "Data Element", "Value / Response"].map((h) => (
                    <Box component="th" key={h} sx={{
                      textAlign: "left", fontFamily: FONT, fontSize: 10, textTransform: "uppercase",
                      letterSpacing: "0.08em", color: C.textMuted, borderBottom: `1px solid ${C.border}`,
                      pb: 0.75, pr: 1.5,
                    }}>{h}</Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {elements.map((el) => (
                  <Box component="tr" key={el.element_id}>
                    <Box component="td" sx={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textMuted, py: 0.6, pr: 1.5, borderBottom: `1px solid ${C.bgTertiary}`, whiteSpace: "nowrap" }}>
                      {el.element_id}
                    </Box>
                    <Box component="td" sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, py: 0.6, pr: 1.5, borderBottom: `1px solid ${C.bgTertiary}` }}>
                      {el.data_element}
                    </Box>
                    <Box component="td" sx={{ fontFamily: FONT, fontSize: 12, color: C.textPrimary, py: 0.6, borderBottom: `1px solid ${C.bgTertiary}` }}>
                      {el.value}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

// One document card for the TIMELINE tab — LEVEL 3.
const DocumentTimelineCard = ({ doc }) => {
  const [factsOpen, setFactsOpen] = useState(false);
  const factCount = QUICK_FACT_CATEGORIES.reduce(
    (sum, c) => sum + (doc?.quick_facts?.[c.key]?.length || 0), 0
  );

  return (
    <Box
      sx={{
        border: `1px solid ${C.border}`,
        borderLeft: doc?.has_abnormalities ? `3px solid ${C.danger}` : `1px solid ${C.border}`,
        mb: 1.25,
        p: 1.75,
        background: C.white,
        transition: "border-color 120ms ease",
        "&:hover": { borderColor: C.black, borderLeftColor: doc?.has_abnormalities ? C.danger : C.black },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75, flexWrap: "wrap" }}>
        <MenuBookRounded sx={{ fontSize: 15, color: C.textMuted }} />
        <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_SEMIBOLD, color: C.textPrimary }}>
          {doc?.document_label || "Clinical Document"}
        </Typography>
        {doc?.filename && (
          <Typography sx={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textMuted }}>
            [{doc.filename}]
          </Typography>
        )}
        <Box sx={{ display: "flex", gap: 0.5, ml: "auto" }}>
          {doc?.has_abnormalities && <StatusChip label="Abnormal" tone="danger" />}
          {doc?.has_recommendations && <StatusChip label="Plan" tone="warning" />}
        </Box>
      </Box>

      {doc?.one_line_summary && (
        <Typography sx={{ fontFamily: FONT, fontSize: 11, fontStyle: "italic", color: C.textMuted, mb: 0.75 }}>
          {doc.one_line_summary}
        </Typography>
      )}

      <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_LIGHT, lineHeight: 1.7, color: C.textSecond, mb: factCount > 0 ? 1 : 0 }}>
        {doc?.summary || "No structured clinical data extracted for this document."}
      </Typography>

      {factCount > 0 && (
        <Box sx={{ borderTop: `1px solid ${C.bgTertiary}`, pt: 1 }}>
          <Box
            onClick={() => setFactsOpen((o) => !o)}
            sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", width: "fit-content" }}
          >
            <FactCheckRounded sx={{ fontSize: 13, color: C.textMuted }} />
            <Typography sx={{ fontFamily: FONT, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, fontWeight: FW_SEMIBOLD }}>
              Quick Facts ({factCount})
            </Typography>
            {factsOpen ? <ExpandLessRounded sx={{ fontSize: 15, color: C.textMuted }} /> : <ExpandMoreRounded sx={{ fontSize: 15, color: C.textMuted }} />}
          </Box>
          <Collapse in={factsOpen}>
            <Box sx={{ mt: 1 }}>
              <QuickFactsPanel quickFacts={doc?.quick_facts} />
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
};

// ─── Timeline rail marker ────────────────────────────────────────────────
const RailDot = ({ tone = "default" }) => {
  const styleByTone = {
    default: { background: C.black, border: `2px solid ${C.black}` },
    danger:  { background: C.danger, border: `2px solid ${C.danger}` },
    first:   { background: C.white, border: `2px solid ${C.black}` },
  };
  const s = styleByTone[tone] || styleByTone.default;
  return (
    <Box
      sx={{
        position: "absolute",
        left: -25,
        top: 3,
        width: 10,
        height: 10,
        borderRadius: "50%",
        boxShadow: `0 0 0 3px ${C.white}`,
        ...s,
      }}
    />
  );
};

// One date block for either tab.
const DayBlock = ({ entry, mode, blockRef }) => {
  const isFirstVisit = entry.type === "first_op_visit";
  const isTimeline = mode === "timeline";

  if (isFirstVisit) {
    return (
      <Box sx={{ position: "relative", mb: 2.5 }} ref={blockRef}>
        {isTimeline && <RailDot tone="first" />}
        <Box sx={{ border: `1px solid ${C.black}`, p: 1.75, background: C.bgSecondary }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, mb: 0.5 }}>
            First OP Visit
          </Typography>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary, mb: 0.25 }}>
            <strong>{entry.date || "Date not documented"}</strong> — {entry.reason_for_visit || "Reason not documented"}
          </Typography>
          {entry.patient?.name && (
            <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond }}>
              {entry.patient.name} · {entry.patient.dob || "DOB N/A"} · {entry.patient.sex || "Sex N/A"}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  const documents = entry.documents || [];
  const hasAbnormal = documents.some((d) => d?.has_abnormalities);
  const CardComponent = isTimeline ? DocumentTimelineCard : DocumentSynopticTable;

  return (
    <Box sx={{ position: "relative", mb: 3 }} ref={blockRef}>
      {isTimeline && <RailDot tone={hasAbnormal ? "danger" : "default"} />}
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 1, borderBottom: `1px solid ${C.border}`, pb: 0.75 }}>
        <Typography sx={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: FW_SEMIBOLD, color: C.textPrimary }}>
          {entry.date || "Date Unknown"}
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted }}>
          {entry.date_label}
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, ml: "auto" }}>
          {entry.document_count} document{entry.document_count === 1 ? "" : "s"} on this date
        </Typography>
      </Box>

      {isTimeline && <DateOverviewBox text={entry.date_overview_summary} />}

      {documents.map((doc, i) => (
        <CardComponent key={doc.filename || i} doc={doc} />
      ))}
    </Box>
  );
};

const TimelineRail = ({ children }) => (
  <Box sx={{ position: "relative", pl: "25px", ml: "3px" }}>
    <Box
      sx={{
        position: "absolute",
        left: 0,
        top: 6,
        bottom: 6,
        width: "2px",
        background: `linear-gradient(to bottom, ${C.black}, ${C.border} 92%, transparent)`,
      }}
    />
    {children}
  </Box>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — DischargeSummary (standalone component)
// ─────────────────────────────────────────────────────────────────────────────
const DischargeSummary = ({ patientId: initialPatientId = "", doctorId: initialDoctorId = "" }) => {
  const [patientId, setPatientId] = useState(initialPatientId);
  const [doctorId, setDoctorId] = useState(initialDoctorId);
  const [specialty, setSpecialty] = useState("Surgical Oncology");

  const [loading, setLoading] = useState(false);      // GET retrieve in-flight
  const [loadError, setLoadError] = useState("");

  const [generating, setGenerating] = useState(false); // POST generate in-flight
  const [genError, setGenError] = useState("");

  const [result, setResult] = useState(null);
  const [showRawReport, setShowRawReport] = useState(false);
  const [activeTab, setActiveTab] = useState("timeline");

  const blockRefs = React.useRef({});

  // ── Retrieve from DB — same pattern as ClinicalSummaryTab's panels ──────
  const fetchDischargeSummary = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(DISCHARGE_SUMMARY_GET_URL(patientId));
      const data = await res.json();
      if (res.status === 404) {
        setResult(null);
        return;
      }
      if (!res.ok || data?.status !== "success") {
        throw new Error(data?.detail || "Failed to fetch discharge summary");
      }
      setResult(data?.data || null);
    } catch (err) {
      console.error("[DischargeSummary] fetch error:", err);
      setLoadError(err.message || "Unable to load discharge summary");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  // Load whatever's already in the DB as soon as a Patient ID is entered,
  // same as ClinicalSummaryTab's panels do on mount / patientId change.
  useEffect(() => { fetchDischargeSummary(); }, [fetchDischargeSummary]);

  // ── Generate — POST to kick off the pipeline, then ONLY on success pull
  //    the freshly-saved record back from the DB via fetchDischargeSummary.
  //    Mirrors SpecialtySummaryPanel / SynopticSummaryPanel in
  //    ClinicalSummaryTab.jsx exactly (handleGenerate -> fetchX()).
  const handleGenerate = async () => {
    if (!patientId || !doctorId) return;
    setGenerating(true);
    setGenError("");
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId,
        specialty:"oncology",                          // FIXED — was hardcoded "oncology"
        include_intermediates: false,
      };
      const res = await fetch(DISCHARGE_SUMMARY_POST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to generate discharge summary");

      // Only populate from the DB retrieve endpoint after a successful generate.
      await fetchDischargeSummary();
    } catch (err) {
      console.error("[DischargeSummary] generate error:", err);
      setGenError(err.message || "Failed to generate discharge summary");
    } finally {
      setGenerating(false);
    }
  };

  // v5.5.0 tabs shape:
  //   result.tabs.timeline.date_index — LEVEL 1, flat one-line-per-date list
  //   result.tabs.timeline.blocks     — LEVEL 2/3, date blocks carrying
  //                                     date_overview_summary + per-document
  //                                     summary/quick_facts
  //   result.tabs.synoptic_report.*   — Tab 2, structured Element ID/Data
  //                                     Element/Value tables (text + JSON)
  //   result.completeness_check       — deterministic fetched/included/
  //                                     skipped document counts (not
  //                                     rendered here, but available on
  //                                     `result` if you want to surface it)
  const dateIndex        = result?.tabs?.timeline?.date_index || [];
  const timelineBlocks   = result?.tabs?.timeline?.blocks || [];
  const synopticBlocks   = result?.tabs?.synoptic_report?.structured || [];
  const synopticRawText  = result?.tabs?.synoptic_report?.text || "";
  const quality = result?.quality_report || {};

  const activeBlocks = activeTab === "timeline" ? timelineBlocks : synopticBlocks;

  const handleJumpToDate = (date) => {
    const key = date || "unknown";
    const node = blockRefs.current[key];
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <Box sx={{ fontFamily: FONT }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <LocalHospitalRounded sx={{ fontSize: 18, color: C.textMuted }} />
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, fontFamily: FONT }}>
          Discharge Summary — 3-Level Timeline &amp; Synoptic Report
        </Typography>
      </Box>

      <SectionBox title="Generate Discharge Summary">
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
            <Box sx={{ minWidth: 200 }}>
              <FieldLabel>Patient ID</FieldLabel>
              <TextField
                fullWidth size="small" sx={inputSx}
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="e.g. PAT-demo-001"
              />
            </Box>
            <Box sx={{ minWidth: 200 }}>
              <FieldLabel>Doctor ID</FieldLabel>
              <TextField
                fullWidth size="small" sx={inputSx}
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                placeholder="e.g. DOC-demo-001"
              />
            </Box>
            {/* <Box sx={{ minWidth: 220 }}>
              <FieldLabel>Specialty</FieldLabel>
              <TextField
                select
                fullWidth size="small" sx={inputSx}
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
              >
                {SPECIALTY_OPTIONS.map((opt) => (
                  <MenuItem key={opt} value={opt} sx={{ fontFamily: FONT, fontSize: 13 }}>
                    {opt}
                  </MenuItem>
                ))}
              </TextField>
            </Box> */}
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Button
              sx={saveBtnSx}
              onClick={handleGenerate}
              disabled={generating || !patientId || !doctorId}
            >
              {generating ? (
                <CircularProgress size={14} sx={{ color: C.white, mr: 1 }} />
              ) : (
                <AutoAwesomeRounded sx={{ mr: 0.5, fontSize: 14 }} />
              )}
              {generating ? "Generating…" : "Generate Discharge Summary"}
            </Button>
            {(!patientId || !doctorId) && (
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
                Requires both Patient ID and Doctor ID
              </Typography>
            )}
          </Box>
          {genError && (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.danger }}>{genError}</Typography>
          )}
        </Box>
      </SectionBox>

      {!patientId && (
        <EmptyState message="Enter a Patient ID to load or generate a discharge summary." />
      )}

      {patientId && loading && !result && (
        <LoadingState message="Loading discharge summary…" />
      )}

      {patientId && generating && (
        <LoadingState message="Building 3-level timeline and synoptic report…" />
      )}

      {patientId && !loading && !generating && loadError && (
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.danger, mb: 2 }}>{loadError}</Typography>
      )}

      {patientId && !loading && !generating && !loadError && !result && (
        <EmptyState message="No discharge summary generated yet. Use Generate Discharge Summary above." />
      )}

      {result && (
        <>
          {/* Header / patient + admission context */}
          <SectionBox
            title="Report Overview"
            right={
              <Button size="small" onClick={fetchDischargeSummary} disabled={loading}
                sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1.25, fontSize: 10 }}>
                <RefreshRounded sx={{ mr: 0.5, fontSize: 13 }} /> Refresh
              </Button>
            }
          >
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              <Box>
                <FieldLabel>Patient</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary }}>
                  {result.patient?.name || "Not documented"}
                </Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
                  {result.patient?.dob || "DOB N/A"} · {result.patient?.sex || "Sex N/A"}
                </Typography>
              </Box>
              <Box>
                <FieldLabel>First OP Visit</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary }}>
                  {result.admission_date || "Not documented"}
                </Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
                  {result.admission_reason || "Reason not documented"}
                </Typography>
              </Box>
              <Box>
                <FieldLabel>Documents Analyzed</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary }}>
                  {result.documents_analyzed}
                </Typography>
              </Box>
              <Box>
                <FieldLabel>Generated</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary }}>
                  {result.generated_at ? new Date(result.generated_at).toLocaleString() : "—"}
                </Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
                  {result.processing_time_ms}ms · v{result.version}
                </Typography>
              </Box>
              <Box sx={{ ml: "auto" }}>
                <FieldLabel>Clinical Use</FieldLabel>
                <StatusChip
                  label={quality.approved_for_clinical_use ? "Approved" : "Needs Review"}
                  tone={quality.approved_for_clinical_use ? "positive" : "warning"}
                />
              </Box>
            </Box>
          </SectionBox>

          {/* TWO-TAB OUTPUT — Timeline (3-level drill-down, on a vertical
              rail) / Synoptic Report (structured) */}
          <SectionBox
            title="Discharge Report"
            right={
              activeTab === "synoptic" && (
                <Button size="small" onClick={() => setShowRawReport((s) => !s)}
                  sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1.25, fontSize: 10 }}>
                  {showRawReport ? "Hide" : "View"} Raw Report
                </Button>
              )
            }
          >
            <TabSwitcher active={activeTab} onChange={setActiveTab} />

            {activeTab === "timeline" && (
              <QuickIndexStrip dateIndex={dateIndex} onJump={handleJumpToDate} />
            )}

            {activeBlocks.length === 0 ? (
              <EmptyState message="No dated clinical entries in this report." />
            ) : activeTab === "timeline" ? (
              <TimelineRail>
                {activeBlocks.map((entry, i) => (
                  <DayBlock
                    key={i}
                    entry={entry}
                    mode={activeTab}
                    blockRef={(node) => { blockRefs.current[entry.date || "unknown"] = node; }}
                  />
                ))}
              </TimelineRail>
            ) : (
              activeBlocks.map((entry, i) => (
                <DayBlock key={i} entry={entry} mode={activeTab} />
              ))
            )}

            {activeTab === "synoptic" && (
              <Collapse in={showRawReport}>
                <Box sx={{ mt: 2, borderTop: `1px solid ${C.border}`, pt: 2 }}>
                  <FieldLabel>Raw Synoptic Report (Text)</FieldLabel>
                  <Box
                    component="pre"
                    sx={{
                      fontFamily: FONT_MONO, fontSize: 11, lineHeight: 1.6, color: C.textPrimary,
                      background: C.bgSecondary, border: `1px solid ${C.border}`, p: 2,
                      overflowX: "auto", whiteSpace: "pre",
                    }}
                  >
                    {synopticRawText}
                  </Box>
                </Box>
              </Collapse>
            )}
          </SectionBox>
        </>
      )}
    </Box>
  );
};

export default DischargeSummary;