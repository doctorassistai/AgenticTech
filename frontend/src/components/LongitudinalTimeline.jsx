import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import {
  RefreshRounded,
  WarningAmberRounded,
  TimelineRounded,
  DescriptionRounded,
  MedicationRounded,
  ScienceRounded,
  MonitorHeartRounded,
  AssignmentRounded,
  PictureAsPdfRounded,
  EventNoteRounded,
  CalendarTodayRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  FiberManualRecordRounded,
} from "@mui/icons-material";

// ─── Design Tokens (mirrors DoctorDashboard.jsx) ─────────────────────────────
import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;

const C = {
  white: theme.bg,
  ghost: theme.bgAlt,
  fog: theme.bgTert,
  black: theme.text,
  ink: theme.text,
  charcoal: theme.textSec,
  smoke: theme.textSec,
  ash: theme.textMuted,
  silver: theme.textMuted,
  mist: theme.border,
  border: theme.borderStr,
  accent: theme.accent,
  accentHover: theme.accentHover ?? theme.accent,
  sec: theme.sec,
};

const FONT = '"Open Sans", sans-serif';
const FW = 300;

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

// ─── Entry type classification ───────────────────────────────────────────────
// Infers a human label + icon + accent from the raw file_name so the timeline
// reads like a clinical record rather than a database dump.
const classifyEntry = (fileName = "") => {
  const f = fileName.toLowerCase();
  if (f.startsWith("dictation_"))
    return { label: "Consultation Dictation", icon: EventNoteRounded, tint: "#5b5bd6" };
  if (f.startsWith("treatment_plan_"))
    return { label: "Treatment Plan", icon: AssignmentRounded, tint: "#2e7d32" };
  if (f.startsWith("medication_list_") || f.startsWith("medication_"))
    return { label: "Medication List", icon: MedicationRounded, tint: "#c2410c" };
  if (f.startsWith("clinical_note_"))
    return { label: "Clinical Note", icon: DescriptionRounded, tint: "#1d4ed8" };
  if (f.startsWith("investigation_"))
    return { label: "Investigation Order", icon: ScienceRounded, tint: "#7c3aed" };
  if (f.startsWith("vitals_"))
    return { label: "Vitals", icon: MonitorHeartRounded, tint: "#d32f2f" };
  if (f.endsWith(".pdf"))
    return { label: "Uploaded Report", icon: PictureAsPdfRounded, tint: "#6b7280" };
  return { label: "Clinical Record", icon: DescriptionRounded, tint: "#6b7280" };
};

const formatDate = (dateString) => {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const formatDateShort = (dateString) => {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatDateRange = (start, end) => {
  if (!start) return "—";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
};

// ─── Minor node: single record on the spine ─────────────────────────────────
const RecordNode = ({ entry, isLast }) => {
  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      {/* Rail */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 40,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: C.white,
            border: `1.5px solid ${C.accent}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            zIndex: 1,
          }}
        >
          <FiberManualRecordRounded
            sx={{ fontSize: 8, color: C.accent }}
          />
        </Box>

        {!isLast && (
          <Box
            sx={{
              width: "1px",
              flex: 1,
              background: C.fog,
              mt: 0.5,
              minHeight: 26,
            }}
          />
        )}
      </Box>

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          pb: isLast ? 0 : 2.25,
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: 0.5,
            flexWrap: "wrap",
          }}
        >
          {/* EXACT filename from endpoint */}
          <Typography
            sx={{
              ...os({
                fontSize: 12,
                color: C.ink,
                wordBreak: "break-all",
              }),
            }}
          >
            {entry.file_name}
          </Typography>

          {/* Report date */}
          <Box
            sx={{
              px: 0.9,
              py: 0.15,
              borderRadius: "2px",
              background: C.ghost,
              border: `1px solid ${C.fog}`,
              flexShrink: 0,
            }}
          >
            <Typography
              sx={{
                ...os({
                  fontSize: 9.5,
                  color: C.silver,
                  letterSpacing: "0.04em",
                }),
              }}
            >
              {formatDate(entry.report_date)}
            </Typography>
          </Box>
        </Box>

        <Typography
          sx={{
            ...os({
              fontSize: 12.5,
              color: C.charcoal,
              lineHeight: 1.65,
            }),
          }}
        >
          {entry.report_summary || "No summary available for this record."}
        </Typography>
      </Box>
    </Box>
  );
};

// ─── Major node: a full visit on the spine ──────────────────────────────────
const VisitNode = ({ visit, isLast, defaultOpen, registerRef }) => {
  const [open, setOpen] = useState(defaultOpen);
  const entries = visit.timeline || [];

  return (
    <Box ref={registerRef} sx={{ display: "flex", gap: 2 }}>
      {/* Rail: major stop */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40, flexShrink: 0 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: C.black,
            color: C.white,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            zIndex: 1,
            boxShadow: `0 0 0 4px ${C.white}`,
          }}
        >
          <Typography sx={{ ...os({ fontSize: 13, color: C.white }) }}>{visit.visit_number}</Typography>
        </Box>
        {!isLast && <Box sx={{ width: "1px", flex: 1, background: C.border, mt: 0.5, minHeight: 20 }} />}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, pb: isLast ? 0 : 4, minWidth: 0 }}>
        {/* Visit header */}
        <Box
          onClick={() => setOpen((p) => !p)}
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 2,
            cursor: "pointer",
            userSelect: "none",
            pt: 0.5,
          }}
        >
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.4, flexWrap: "wrap" }}>
              <Typography sx={{ ...os({ fontSize: 14.5, color: C.ink, letterSpacing: "0.01em" }) }}>
                Visit {visit.visit_number}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <CalendarTodayRounded sx={{ fontSize: 11, color: C.ash }} />
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                  {formatDateRange(visit.visit_start_date, visit.visit_end_date)}
                </Typography>
              </Box>
            </Box>
            {visit.appointment_id && (
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, letterSpacing: "0.03em" }) }}>
                {visit.appointment_id}
              </Typography>
            )}
          </Box>
          <IconButton
            size="small"
            sx={{ width: 26, height: 26, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, flexShrink: 0 }}
          >
            {open ? <ExpandLessRounded sx={{ fontSize: 15 }} /> : <ExpandMoreRounded sx={{ fontSize: 15 }} />}
          </IconButton>
        </Box>

        {/* Visit summary */}
        {visit.visit_summary && (
          <Box sx={{ mt: 1.5, p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
              Visit Summary
            </Typography>
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.7 }) }}>
              {visit.visit_summary}
            </Typography>
          </Box>
        )}

        {/* Nested record spine */}
        {open && (
          <Box sx={{ mt: 2.5 }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1.5 }) }}>
              Records ({entries.length})
            </Typography>
            {entries.length === 0 ? (
              <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>No individual records for this visit.</Typography>
            ) : (
              <Box sx={{ pl: 0.5 }}>
                {entries.map((entry, idx) => (
                  <RecordNode key={entry.timeline_entry_id || idx} entry={entry} isLast={idx === entries.length - 1} />
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
/**
 * Longitudinal Timeline — a single continuous vertical timeline of the
 * patient's full visit history. Each visit is a major stop on the spine;
 * every record inside that visit (dictation, meds, notes, reports, vitals…)
 * branches off it as a minor stop. Drop this in as a tab inside "Clinical
 * Insights" alongside Patient Summary / Current Clinical Context / Medical
 * Clinical Context.
 */
export default function LongitudinalTimeline({ patientId, doctorId, refreshTrigger = 0 }) {
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const visitRefs = useRef({});

  const fetchTimeline = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/timelines/${patientId}`);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.detail || "No timeline found for this patient.");
      }

      const sortedVisits = [...(json?.visits || [])].sort(
        (a, b) => (a.visit_number ?? 0) - (b.visit_number ?? 0)
      );
      setVisits(sortedVisits);
    } catch (err) {
      console.error("❌ Failed to fetch patient timeline:", err);
      setError(err.message || "Failed to load timeline");
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, API_BASE_URL]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline, refreshTrigger]);

  const jumpToVisit = (visitNumber) => {
    visitRefs.current[visitNumber]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Loading ──
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
        <RefreshRounded sx={{ fontSize: 28, color: C.ash, animation: "spin 1s linear infinite" }} />
      </Box>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: "center", border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
        <WarningAmberRounded sx={{ fontSize: 28, color: C.ash, mb: 1 }} />
        <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{error}</Typography>
        <Box
          component="button"
          type="button"
          onClick={fetchTimeline}
          sx={{
            mt: 1.5,
            px: 2,
            py: 0.75,
            fontSize: 11,
            fontFamily: FONT,
            fontWeight: 400,
            letterSpacing: "0.04em",
            background: "transparent",
            color: C.charcoal,
            border: `1px solid ${C.mist}`,
            borderRadius: "2px",
            cursor: "pointer",
            "&:hover": { background: C.white },
          }}
        >
          Retry
        </Box>
      </Box>
    );
  }

  // ── Empty ──
  if (!visits.length) {
    return (
      <Box sx={{ p: 6, textAlign: "center", border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
        <TimelineRounded sx={{ fontSize: 40, color: C.silver, mb: 1.5, opacity: 0.5 }} />
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No visit history available</Typography>
        <Typography sx={{ ...os({ fontSize: 11, color: C.silver, mt: 0.5 }) }}>
          Longitudinal records will appear here after the patient's first documented visit
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header: total visits + refresh */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.04em" }) }}>
          {visits.length} recorded visit{visits.length !== 1 ? "s" : ""} ·{" "}
          {visits.reduce((sum, v) => sum + (v.timeline?.length || 0), 0)} total records
        </Typography>
        <Tooltip title="Refresh Timeline">
          <IconButton
            size="small"
            onClick={fetchTimeline}
            sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, "&:hover": { color: C.ink, background: C.white } }}
          >
            <RefreshRounded sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Jump-to-visit chip rail */}
      <Box sx={{ display: "flex", gap: 0.75, overflowX: "auto", pb: 2, mb: 1 }}>
        {visits.map((v) => (
          <Box
            key={v.appointment_id || v.visit_number}
            component="button"
            type="button"
            onClick={() => jumpToVisit(v.visit_number)}
            sx={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 0.6,
              px: 1.25,
              py: 0.6,
              border: `1px solid ${C.fog}`,
              borderRadius: "2px",
              background: C.white,
              color: C.charcoal,
              fontFamily: FONT,
              fontWeight: 300,
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s",
              "&:hover": { background: C.ghost, borderColor: C.mist },
            }}
          >
            <FiberManualRecordRounded sx={{ fontSize: 7, color: C.ash }} />
            V{v.visit_number} · {formatDateShort(v.appointment_date)}
          </Box>
        ))}
      </Box>

      {/* Continuous spine */}
      <Box sx={{ p: { xs: 2, sm: 2.5 }, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.white }}>
        {visits.map((visit, idx) => (
          <VisitNode
            key={visit.appointment_id || visit.visit_number}
            visit={visit}
            isLast={idx === visits.length - 1}
            defaultOpen={idx === visits.length - 1}
            registerRef={(el) => {
              visitRefs.current[visit.visit_number] = el;
            }}
          />
        ))}
      </Box>
    </Box>
  );
}