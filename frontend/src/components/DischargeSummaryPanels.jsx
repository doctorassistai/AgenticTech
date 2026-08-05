/**
 * DischargeSummaryPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders discharge summary data from the backend API.
 * Displays: admission_date, admission_reason, patient, discharge_summary,
 *           day_wise_timeline (with documents, abnormalities, recommendations)
 *
 * Usage:
 *   <DischargeSummaryPanel doctorId={doctorId} patientId={patientId} />
 *
 * Backend endpoint: POST /discharge-summary
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Collapse,
  CircularProgress,
  Divider,
  Tabs,
  Tab,
} from "@mui/material";
import {
  RefreshRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  WarningAmberRounded,
  CheckCircleOutlineRounded,
  LocalHospitalRounded,
  ScienceRounded,
  MedicationRounded,
  AssignmentRounded,
  FiberManualRecordRounded,
  CalendarTodayRounded,
  PersonRounded,
  ArticleRounded,
  RecommendRounded,
} from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ── Design tokens (mirrors dashboard palette) ────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;
const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
  warn: "#b45309",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",
  ok: "#166534",
  okBg: "#f0fdf4",
  okBorder: "#bbf7d0",
  blue: "#1e3a5f",
  blueBg: "#eff6ff",
  blueBorder: "#bfdbfe",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

// ── Small utility components ─────────────────────────────────────────────────

const Label = ({ children, sx = {} }) => (
  <Typography
    sx={{
      ...os({
        fontSize: 10,
        color: C.silver,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        mb: 0.5,
      }),
      ...sx,
    }}
  >
    {children}
  </Typography>
);

const Value = ({ children, sx = {} }) => (
  <Typography sx={{ ...os({ fontSize: 13, color: C.ink, lineHeight: 1.5 }), ...sx }}>
    {children || "—"}
  </Typography>
);

const SectionDivider = ({ label }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 2 }}>
    <Box sx={{ flex: 1, height: 1, background: C.fog }} />
    {label && (
      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, letterSpacing: "0.1em", textTransform: "uppercase" }) }}>
        {label}
      </Typography>
    )}
    <Box sx={{ flex: 1, height: 1, background: C.fog }} />
  </Box>
);

// ── Tag pill for entity types ────────────────────────────────────────────────
const TypeTag = ({ label, color = C.smoke, bg = C.ghost }) => (
  <Box
    sx={{
      display: "inline-flex",
      alignItems: "center",
      px: 1,
      py: 0.25,
      borderRadius: "2px",
      background: bg,
      border: `1px solid ${C.fog}`,
      mr: 0.5,
      mb: 0.5,
    }}
  >
    <Typography sx={{ ...os({ fontSize: 9, color, letterSpacing: "0.06em", textTransform: "uppercase" }) }}>
      {label}
    </Typography>
  </Box>
);

// ── Collapsible document card inside a day ───────────────────────────────────
const DocumentCard = ({ doc, index }) => {
  const [open, setOpen] = useState(index === 0);

  const sections = [
    { key: "vitals", label: "Vitals", icon: <LocalHospitalRounded sx={{ fontSize: 13 }} />, color: C.blue },
    { key: "investigations", label: "Investigations", icon: <ScienceRounded sx={{ fontSize: 13 }} />, color: C.smoke },
    { key: "medications", label: "Medications", icon: <MedicationRounded sx={{ fontSize: 13 }} />, color: C.charcoal },
    { key: "procedures", label: "Procedures", icon: <AssignmentRounded sx={{ fontSize: 13 }} />, color: C.smoke },
    { key: "findings", label: "Findings", icon: <FiberManualRecordRounded sx={{ fontSize: 10 }} />, color: C.smoke },
    { key: "diagnoses", label: "Diagnoses", icon: <LocalHospitalRounded sx={{ fontSize: 13 }} />, color: C.ink },
    { key: "treatments", label: "Treatments", icon: <CheckCircleOutlineRounded sx={{ fontSize: 13 }} />, color: C.smoke },
  ];

  const hasAbnorm = doc.abnormalities?.length > 0;
  const hasRecs = doc.recommendations?.length > 0;

  return (
    <Box
      sx={{
        border: `1px solid ${C.fog}`,
        borderRadius: "4px",
        overflow: "hidden",
        mb: 1.5,
        background: C.white,
      }}
    >
      {/* Header row */}
      <Box
        onClick={() => setOpen((p) => !p)}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.25,
          cursor: "pointer",
          background: open ? C.ghost : C.white,
          borderBottom: open ? `1px solid ${C.fog}` : "none",
          "&:hover": { background: C.ghost },
          transition: "background 0.15s",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
          <ArticleRounded sx={{ fontSize: 15, color: C.ash, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                ...os({ fontSize: 12, color: C.ink }),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {doc.document_label || `Document ${index + 1}`}
            </Typography>
            {doc.filename && (
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>
                {doc.filename}
              </Typography>
            )}
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, ml: 1 }}>
          {hasAbnorm && (
            <Chip
              icon={<WarningAmberRounded sx={{ fontSize: 11, color: C.warn + " !important" }} />}
              label={`${doc.abnormalities.length} alert${doc.abnormalities.length > 1 ? "s" : ""}`}
              size="small"
              sx={{
                fontSize: 10,
                height: 20,
                background: C.warnBg,
                color: C.warn,
                border: `1px solid ${C.warnBorder}`,
                "& .MuiChip-icon": { ml: 0.5 },
              }}
            />
          )}
          {hasRecs && (
            <Chip
              label={`${doc.recommendations.length} plan`}
              size="small"
              sx={{
                fontSize: 10,
                height: 20,
                background: C.okBg,
                color: C.ok,
                border: `1px solid ${C.okBorder}`,
              }}
            />
          )}
          <IconButton size="small" sx={{ p: 0.25, color: C.ash }}>
            {open ? <ExpandLessRounded sx={{ fontSize: 16 }} /> : <ExpandMoreRounded sx={{ fontSize: 16 }} />}
          </IconButton>
        </Box>
      </Box>

      {/* Expanded content */}
      <Collapse in={open}>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {/* Clinical sections */}
          {sections.map(({ key, label, icon, color }) => {
            const items = doc[key];
            if (!items || items.length === 0) return null;
            return (
              <Box key={key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                  <Box sx={{ color }}>{icon}</Box>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
                    {label}
                  </Typography>
                </Box>
                <Box sx={{ pl: 2.5 }}>
                  {items.map((item, i) => {
                    // vitals / investigations / procedures are objects
                    if (typeof item === "object" && item !== null) {
                      const parts = [];
                      if (item.parameter) parts.push(item.parameter);
                      if (item.test) parts.push(item.test);
                      if (item.name) parts.push(item.name);
                      if (item.value !== undefined) parts.push(item.value);
                      if (item.result !== undefined) parts.push(item.result);
                      if (item.unit) parts.push(item.unit);
                      if (item.drug) {
                        parts.push(item.drug);
                        if (item.dose) parts.push(item.dose);
                        if (item.route) parts.push(`(${item.route})`);
                        if (item.frequency) parts.push(item.frequency);
                      }
                      if (item.reference_range) parts.push(`[ref: ${item.reference_range}]`);
                      if (item.detail) parts.push(`— ${item.detail}`);
                      const isAbnormal = (item.status || "").toLowerCase() === "abnormal" || (item.status || "").toLowerCase() === "critical";
                      return (
                        <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.5 }}>
                          <Box sx={{ width: 4, height: 4, borderRadius: "50%", background: C.mist, mt: 0.6, flexShrink: 0 }} />
                          <Typography
                            sx={{
                              ...os({ fontSize: 12, color: isAbnormal ? C.warn : C.charcoal, lineHeight: 1.5 }),
                            }}
                          >
                            {parts.join("  ")}
                            {isAbnormal && (
                              <Box component="span" sx={{ ml: 0.5, fontSize: 10, color: C.warn }}>
                                ⚠ {item.status?.toUpperCase()}
                              </Box>
                            )}
                          </Typography>
                        </Box>
                      );
                    }
                    // string items
                    return (
                      <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.5 }}>
                        <Box sx={{ width: 4, height: 4, borderRadius: "50%", background: C.mist, mt: 0.6, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.5 }) }}>
                          {item}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })}

          {/* Abnormalities */}
          {hasAbnorm && (
            <Box
              sx={{
                background: C.warnBg,
                border: `1px solid ${C.warnBorder}`,
                borderRadius: "3px",
                p: 1.5,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                <WarningAmberRounded sx={{ fontSize: 13, color: C.warn }} />
                <Typography sx={{ ...os({ fontSize: 10, color: C.warn, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
                  Abnormalities / Alerts
                </Typography>
              </Box>
              {doc.abnormalities.map((ab, i) => (
                <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.warn }) }}>⚠</Typography>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.warn, lineHeight: 1.5 }) }}>{ab}</Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* Recommendations */}
          {hasRecs && (
            <Box
              sx={{
                background: C.okBg,
                border: `1px solid ${C.okBorder}`,
                borderRadius: "3px",
                p: 1.5,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                <RecommendRounded sx={{ fontSize: 13, color: C.ok }} />
                <Typography sx={{ ...os({ fontSize: 10, color: C.ok, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
                  Recommendations / Plan
                </Typography>
              </Box>
              {doc.recommendations.map((rec, i) => (
                <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ok }) }}>→</Typography>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ok, lineHeight: 1.5 }) }}>{rec}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

// ── Day block on the timeline ────────────────────────────────────────────────
const DayBlock = ({ entry, isFirst }) => {
  const [open, setOpen] = useState(isFirst);
  const isAdmission = entry.type === "admission";
  const hasAbnorm = entry.has_abnormalities;

  return (
    <Box sx={{ display: "flex", gap: 0 }}>
      {/* Timeline spine */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mr: 2, flexShrink: 0 }}>
        {/* Dot */}
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: isAdmission ? C.black : hasAbnorm ? C.warn : C.charcoal,
            border: `2px solid ${C.white}`,
            boxShadow: `0 0 0 1px ${isAdmission ? C.black : hasAbnorm ? C.warnBorder : C.mist}`,
            mt: 1.5,
            flexShrink: 0,
          }}
        />
        {/* Vertical line */}
        <Box sx={{ flex: 1, width: 1, background: C.fog, mt: 0.5 }} />
      </Box>

      {/* Card */}
      <Box sx={{ flex: 1, pb: 2.5 }}>
        {/* Header */}
        <Box
          onClick={() => !isAdmission && setOpen((p) => !p)}
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            cursor: isAdmission ? "default" : "pointer",
            "&:hover": !isAdmission ? { opacity: 0.8 } : {},
          }}
        >
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                {entry.date_label || entry.date || "Date Unknown"}
              </Typography>
              {entry.date && entry.type !== "admission" && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                  {entry.date}
                </Typography>
              )}
              {isAdmission && (
                <Chip
                  label="Admission"
                  size="small"
                  sx={{ fontSize: 9, height: 18, background: C.black, color: C.white, borderRadius: "2px" }}
                />
              )}
              {hasAbnorm && (
                <Chip
                  icon={<WarningAmberRounded sx={{ fontSize: 10, color: C.warn + " !important" }} />}
                  label={`${entry.all_abnormalities?.length || 0} alert${(entry.all_abnormalities?.length || 0) > 1 ? "s" : ""}`}
                  size="small"
                  sx={{ fontSize: 9, height: 18, background: C.warnBg, color: C.warn, border: `1px solid ${C.warnBorder}`, "& .MuiChip-icon": { ml: 0.5 } }}
                />
              )}
            </Box>
            {entry.story_narrative && (
              <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mt: 0.4, lineHeight: 1.5 }) }}>
                {entry.story_narrative}
              </Typography>
            )}
          </Box>
          {!isAdmission && (
            <IconButton size="small" sx={{ p: 0.25, color: C.ash, mt: 0.25 }}>
              {open ? <ExpandLessRounded sx={{ fontSize: 16 }} /> : <ExpandMoreRounded sx={{ fontSize: 16 }} />}
            </IconButton>
          )}
        </Box>

        {/* Documents */}
        {!isAdmission && (
          <Collapse in={open}>
            <Box sx={{ mt: 1.5 }}>
              {entry.documents?.length > 0 ? (
                entry.documents.map((doc, i) => (
                  <DocumentCard key={i} doc={doc} index={i} />
                ))
              ) : (
                <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>
                  No document details available for this date.
                </Typography>
              )}
            </Box>
          </Collapse>
        )}
      </Box>
    </Box>
  );
};

// ── Plain text view ──────────────────────────────────────────────────────────
const PlainTextView = ({ text }) => (
  <Box
    sx={{
      background: C.ghost,
      border: `1px solid ${C.fog}`,
      borderRadius: "4px",
      p: 2.5,
      overflowX: "auto",
    }}
  >
    <Box
      component="pre"
      sx={{
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: 11,
        color: C.charcoal,
        lineHeight: 1.7,
        m: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </Box>
  </Box>
);

// ── Main component ───────────────────────────────────────────────────────────
export default function DischargeSummaryPanel({ doctorId, patientId, specialty }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [viewTab, setViewTab] = useState(0); // 0 = Timeline, 1 = Plain Text

  const fetchSummary = useCallback(async () => {
    if (!doctorId || !patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/discharge-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          specialty: specialty || "General Medicine",
          include_intermediates: true,
          "batch_size": 10
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || "Failed to load discharge summary");
    } finally {
      setLoading(false);
    }
  }, [doctorId, patientId, specialty]);

  // ─── patient info ──────────────────────────────────────────────────────────
  const patient = data?.patient || {};
  const admissionDate = data?.admission_date;
  const admissionReason = data?.admission_reason;
  const timeline = data?.day_wise_timeline || [];
  const plainText = data?.discharge_summary || "";

  // ─── empty / loading ───────────────────────────────────────────────────────
  const renderEmpty = () => (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 8,
        gap: 2,
      }}
    >
      <ArticleRounded sx={{ fontSize: 48, color: C.silver, opacity: 0.4 }} />
      <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
        No discharge summary (chronological order) generated yet.
      </Typography>
      <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
        Click Generate Discharge Summary (chronological order) to begin.
      </Typography>
      <Box
        component="button"
        type="button"
        onClick={fetchSummary}
        sx={{
          mt: 1,
          px: 3,
          py: 1.25,
          borderRadius: "2px",
          fontSize: 12,
          fontFamily: FONT,
          fontWeight: 300,
          textTransform: "none",
          background: C.black,
          color: C.white,
          border: "none",
          cursor: "pointer",
          letterSpacing: "0.06em",
          "&:hover": { background: C.charcoal },
        }}
      >
        Generate Discharge Summary (chronological order)
      </Box>
    </Box>
  );

  if (!data && !loading && !error) return renderEmpty();

  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW }}>
      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2.5,
          flexWrap: "wrap",
          gap: 1.5,
        }}
      >
        <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>
          Discharge Summary (chronological order)
        </Typography>
        <Tooltip title={data ? "Regenerate summary" : "Generate summary"}>
          <Box
            component="button"
            type="button"
            onClick={fetchSummary}
            disabled={loading}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 2,
              py: 0.85,
              borderRadius: "2px",
              fontSize: 11,
              fontFamily: FONT,
              fontWeight: 300,
              letterSpacing: "0.05em",
              background: loading ? C.ghost : C.black,
              color: loading ? C.ash : C.white,
              border: `1px solid ${loading ? C.fog : C.black}`,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              "&:hover:not(:disabled)": { background: C.charcoal },
            }}
          >
            {loading ? (
              <CircularProgress size={12} sx={{ color: C.ash }} />
            ) : (
              <RefreshRounded sx={{ fontSize: 14 }} />
            )}
            {loading ? "Generating..." : data ? "Regenerate" : "Generate"}
          </Box>
        </Tooltip>
      </Box>

      {/* ── Loading skeleton ─────────────────────────────────────────────── */}
      {loading && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {[80, 60, 90, 50, 70].map((w, i) => (
            <Box
              key={i}
              sx={{
                height: 14,
                width: `${w}%`,
                background: C.fog,
                borderRadius: "2px",
                animation: "pulse 1.4s ease-in-out infinite",
                "@keyframes pulse": {
                  "0%, 100%": { opacity: 0.5 },
                  "50%": { opacity: 1 },
                },
              }}
            />
          ))}
        </Box>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {error && !loading && (
        <Box
          sx={{
            p: 3,
            border: `1px solid ${C.warnBorder}`,
            borderRadius: "4px",
            background: C.warnBg,
            display: "flex",
            gap: 1.5,
            alignItems: "flex-start",
          }}
        >
          <WarningAmberRounded sx={{ fontSize: 18, color: C.warn, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 13, color: C.warn, mb: 0.5 }) }}>
              Failed to load discharge summary
            </Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.warn }) }}>{error}</Typography>
          </Box>
        </Box>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {data && !loading && (
        <>
          {/* Admission info strip */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
              gap: 0,
              border: `1px solid ${C.fog}`,
              borderRadius: "4px",
              overflow: "hidden",
              mb: 2.5,
              background: C.white,
            }}
          >
            {[
              {
                icon: <PersonRounded sx={{ fontSize: 14 }} />,
                label: "Patient",
                value: patient.name || "—",
                sub: patient.dob ? `DOB: ${patient.dob}` : (patient.sex || null),
              },
              {
                icon: <CalendarTodayRounded sx={{ fontSize: 14 }} />,
                label: "Admission Date",
                value: admissionDate || "Not documented",
                sub: null,
              },
              {
                icon: <LocalHospitalRounded sx={{ fontSize: 14 }} />,
                label: "Reason for Admission",
                value: admissionReason || "Not documented",
                sub: null,
              },
              {
                icon: <ArticleRounded sx={{ fontSize: 14 }} />,
                label: "Documents Analyzed",
                value: data.documents_analyzed ?? timeline.filter((t) => t.type === "clinical_day").reduce((s, t) => s + (t.documents?.length || 0), 0),
                sub: data.version ? `v${data.version}` : null,
              },
            ].map((item, i, arr) => (
              <Box
                key={i}
                sx={{
                  p: 2,
                  borderRight: i < arr.length - 1 ? `1px solid ${C.fog}` : "none",
                  background: C.ghost,
                  "&:hover": { background: C.white },
                  transition: "background 0.15s",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75, color: C.ash }}>
                  {item.icon}
                  <Label sx={{ mb: 0 }}>{item.label}</Label>
                </Box>
                <Value>{item.value}</Value>
                {item.sub && (
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>
                    {item.sub}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>

          {/* View toggle tabs */}
          <Box
            sx={{
              display: "flex",
              borderBottom: `1px solid ${C.fog}`,
              mb: 2,
            }}
          >
            {["Timeline View", "Plain Text"].map((label, i) => (
              <Box
                key={label}
                component="button"
                type="button"
                onClick={() => setViewTab(i)}
                sx={{
                  px: 2.5,
                  py: 1,
                  border: "none",
                  background: "none",
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: viewTab === i ? 400 : 300,
                  color: viewTab === i ? C.ink : C.ash,
                  cursor: "pointer",
                  borderBottom: viewTab === i ? `2px solid ${C.black}` : "2px solid transparent",
                  mb: "-1px",
                  transition: "color 0.15s",
                  letterSpacing: "0.04em",
                }}
              >
                {label}
              </Box>
            ))}
          </Box>

          {/* ── Timeline view ─────────────────────────────────────────── */}
          {viewTab === 0 && (
            <Box>
              {timeline.length === 0 ? (
                <Typography sx={{ ...os({ fontSize: 13, color: C.ash, textAlign: "center", py: 4 }) }}>
                  No timeline data available.
                </Typography>
              ) : (
                <Box>
                  {timeline.map((entry, i) => (
                    <DayBlock key={i} entry={entry} isFirst={i === 0} />
                  ))}
                  {/* End of timeline marker */}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", background: C.fog, border: `1px solid ${C.mist}` }} />
                    <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
                      End of timeline
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {/* ── Plain text view ───────────────────────────────────────── */}
          {viewTab === 1 && (
            <Box>
              {plainText ? (
                <PlainTextView text={plainText} />
              ) : (
                <Typography sx={{ ...os({ fontSize: 13, color: C.ash, textAlign: "center", py: 4 }) }}>
                  No plain text summary available.
                </Typography>
              )}
            </Box>
          )}

          {/* Quality / gaps row */}
          {/* {data.gaps_flagged?.length > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <SectionDivider label="Quality Flags" />
              <Box
                sx={{
                  border: `1px solid ${C.warnBorder}`,
                  borderRadius: "4px",
                  background: C.warnBg,
                  p: 2,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
                  <WarningAmberRounded sx={{ fontSize: 14, color: C.warn }} />
                  <Typography sx={{ ...os({ fontSize: 11, color: C.warn, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
                    Gaps Flagged
                  </Typography>
                </Box>
                {data.gaps_flagged.map((g, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.warn }) }}>•</Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.warn, lineHeight: 1.5 }) }}>{g}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )} */}

          {/* Score bar */}
          {/* {data.score && Object.keys(data.score).length > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <SectionDivider label="Quality Score" />
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 1,
                }}
              >
                {Object.entries(data.score).map(([key, val]) => {
                  const pct = Math.round((val || 0) * 100);
                  const isHigh = pct >= 80;
                  const isMed = pct >= 50 && pct < 80;
                  const color = isHigh ? C.ok : isMed ? C.warn : "#9b2c2c";
                  const bg = isHigh ? C.okBg : isMed ? C.warnBg : "#fff5f5";
                  const border = isHigh ? C.okBorder : isMed ? C.warnBorder : "#fed7d7";

                  return (
                    <Box
                      key={key}
                      sx={{
                        p: 1.5,
                        background: bg,
                        border: `1px solid ${border}`,
                        borderRadius: "3px",
                      }}
                    >
                      <Label sx={{ color: C.ash, mb: 0.25 }}>
                        {key.replace(/_/g, " ")}
                      </Label>
                      <Typography sx={{ ...os({ fontSize: 16, color, fontWeight: 400 }) }}>
                        {pct}%
                      </Typography>
                      <Box
                        sx={{
                          height: 3,
                          background: border,
                          borderRadius: "2px",
                          mt: 0.5,
                          overflow: "hidden",
                        }}
                      >
                        <Box
                          sx={{
                            height: "100%",
                            width: `${pct}%`,
                            background: color,
                            borderRadius: "2px",
                            transition: "width 0.6s ease",
                          }}
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )} */}
        </>
      )}
    </Box>
  );
}
