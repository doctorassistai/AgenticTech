// DashboardTab.jsx — Surgical Oncology Intelligence dashboard.
//
// Renders the 12-module longitudinal report from ./dashboardConfig. Structure is fixed
// by the config; values are supplied at runtime by the agent pipeline via getDashboard().
// Any value not yet produced by an agent degrades to "Not available" — the UI never
// invents data. Styling follows the shared design system (../shared/designTokens):
// Open Sans, square bordered cards, bgSecondary header bars, and the shared table styles.

import React, { useState, useEffect, useMemo } from "react";
import { Box, Typography, CircularProgress, Button } from "@mui/material";
import SurgicalOncologySkillPanel from "./SurgicalOncologySkillPanel";

import {
  C, FONT, FW_LIGHT, FW_NORMAL, thStyle, tdStyle, outlineBtnSx,
} from "../shared/designTokens";
import { getDashboard, regenerateDashboard } from "./shared/api";
import NurseQuestionnaire from "../NurseQuestionnaire";

import {
  MODULES, KPI_SLOTS, PATIENT_STRIP_SLOTS, columnsFor, emptyRow, NA,
} from "./dashboardConfig";

// Clinical status palette — subtle tints in the same flat/bordered spirit as the
// shared StatusBadge. Color here carries genuine signal (ok / watch / alert), so it
// stays; only the typography is aligned to the rest of the app (Open Sans).
const STATUS = {
  ok: { color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  watch: { color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  alert: { color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  flag: { color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" }, // flagship-engine trigger
  info: { color: "#475569", bg: "#f1f5f9", border: "#cbd5e1" }, // "Noted" — a captured fact (semi-neutral slate)
  neutral: { color: C.textMuted, bg: C.bgSecondary, border: C.border }, // "Not Available" — no data
};

// Blank -> "Not available" for display. Status/action have their own defaults.
const show = (v) => (v === undefined || v === null || v === "" ? NA : v);

// Small uppercase eyebrow label, matching the shared fieldLabel treatment.
const EYEBROW = {
  fontFamily: FONT, fontSize: 11, fontWeight: FW_NORMAL, textTransform: "uppercase",
  letterSpacing: "0.12em", color: C.textSecond,
};

// ─── Small presentational pieces ─────────────────────────────────────────────

function Pill({ status = "neutral", label }) {
  // Color comes purely from `status`; the backend guarantees the label word matches
  // its tier (see base.py _snap_pill), so text and color can never disagree.
  const s = STATUS[status] || STATUS.neutral;
  return (
    <Box component="span" sx={{
      display: "inline-flex", alignItems: "center", gap: 0.75, fontFamily: FONT,
      fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
      px: 1, py: 0.25, color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      whiteSpace: "nowrap",
    }}>
      <Box component="span" sx={{ width: 5, height: 5, borderRadius: "50%", background: s.color }} />
      {label || NA}
    </Box>
  );
}

function KpiCard({ label, value, status = "neutral", note }) {
  const s = STATUS[status] || STATUS.neutral;
  return (
    <Box sx={{ background: C.white, p: 2, border: `1px solid ${C.border}` }}>
      <Typography sx={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textMuted, fontFamily: FONT, mb: 1 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 19, fontWeight: FW_NORMAL, color: C.textPrimary, fontFamily: FONT, lineHeight: 1.25 }}>
        {show(value)}
      </Typography>
      <Box sx={{ mt: 1, display: "inline-flex", alignItems: "center", gap: 0.75 }}>
        <Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
        <Typography sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.05em", color: s.color, textTransform: "uppercase" }}>
          {show(note)}
        </Typography>
      </Box>
    </Box>
  );
}

function PatientCell({ label, value, sub, collapsible = false }) {
  // A cell may carry a long `sub` (e.g. the full pathology report on the Pathology
  // Status cell). When `collapsible`, keep the short `value` visible but tuck the long
  // `sub` behind a toggle so the patient strip stays compact until the user asks for it.
  const [open, setOpen] = useState(false);
  const hasSub = sub !== undefined && sub !== null && String(sub).trim() !== "";
  const isCollapsible = collapsible && hasSub;
  return (
    <Box sx={{ p: 2, background: C.white, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <Typography sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.1em", color: C.textMuted, textTransform: "uppercase", mb: 0.75 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 14, color: C.textPrimary, fontFamily: FONT, fontWeight: FW_NORMAL }}>
        {show(value)}
      </Typography>
      {hasSub && !isCollapsible ? (
        <Typography sx={{ fontSize: 11, color: C.textSecond, fontFamily: FONT, fontWeight: FW_LIGHT, mt: 0.25 }}>
          {sub}
        </Typography>
      ) : null}
      {isCollapsible ? (
        <>
          <Box
            component="span"
            role="button"
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
            sx={{
              display: "inline-flex", alignItems: "center", gap: 0.5, mt: 0.75,
              fontFamily: FONT, fontSize: 10, fontWeight: FW_NORMAL, letterSpacing: "0.08em",
              textTransform: "uppercase", color: C.textSecond, cursor: "pointer",
              userSelect: "none", "&:hover": { color: C.textPrimary },
            }}
          >
            <Box component="span" sx={{ fontSize: 9, lineHeight: 1 }}>{open ? "▾" : "▸"}</Box>
            {open ? "Hide report" : "View report"}
          </Box>
          {open ? (
            <Typography sx={{
              fontSize: 11, color: C.textSecond, fontFamily: FONT, fontWeight: FW_LIGHT,
              mt: 0.75, whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto",
            }}>
              {sub}
            </Typography>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

// ─── Module section (bordered card: header bar + optional flagship note + table) ──

function ModuleSection({ module, data }) {
  const columns = columnsFor(module);

  // Merge live rows over the fixed parameter skeleton, matched by parameter name.
  const rows = useMemo(() => {
    const liveByName = new Map((data?.rows || []).map((r) => [r.parameter, r]));
    return module.parameters.map((param) => {
      const base = emptyRow(param, columns);
      const live = liveByName.get(param);
      return live ? { ...base, ...live, parameter: param } : base;
    });
  }, [module, data, columns]);

  return (
    <Box id={`so-${module.id}`} sx={{ border: `1px solid ${C.border}`, mb: 2.5, background: C.white, scrollMarginTop: "72px" }}>
      {/* Header bar */}
      <Box sx={{ px: 2.5, py: 1.75, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", mb: 0.5 }}>
            Module {module.idx} / 12
          </Typography>
          <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, color: C.textPrimary, fontFamily: FONT }}>
            {module.title}
          </Typography>
          <Typography sx={{ maxWidth: 680, color: C.textSecond, fontSize: 12, fontFamily: FONT, fontWeight: FW_LIGHT, mt: 0.5 }}>
            {module.description}
          </Typography>
        </Box>
        <Box sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textMuted, border: `1px solid ${C.border}`, background: C.white, px: 1.25, py: 0.6, whiteSpace: "nowrap" }}>
          {module.summary}
        </Box>
      </Box>

      {/* Flagship note (Modules 4 & 7) */}
      {module.flagship ? (
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", borderBottom: `1px solid ${C.border}`, background: STATUS.flag.bg, px: 2.5, py: 1.5 }}>
          <Box sx={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: STATUS.flag.color, border: `1px solid ${STATUS.flag.border}`, background: C.white, px: 1, py: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}>
            {module.flagshipTag}
          </Box>
          <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, fontWeight: FW_LIGHT }}>
            {module.flagshipNote}
          </Typography>
        </Box>
      ) : null}

      {/* Table */}
      <Box sx={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ ...thStyle, whiteSpace: "nowrap" }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  if (col.isStatus) {
                    return (
                      <td key={col.key} style={{ ...tdStyle, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        <Pill status={row.status} label={show(row.statusLabel)} />
                      </td>
                    );
                  }
                  const isParam = col.key === "parameter";
                  return (
                    <td key={col.key} style={{
                      ...tdStyle, verticalAlign: "top",
                      color: isParam ? C.textPrimary : C.textSecond,
                      fontWeight: isParam ? FW_NORMAL : FW_LIGHT,
                    }}>
                      {show(row[col.key])}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────

const DashboardTab = ({ patientId, doctorId }) => {
  const [data, setData] = useState(null);       // full payload from getDashboard
  const [status, setStatus] = useState("idle"); // idle | loading | ready | pending
  const [error, setError] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);

  useEffect(() => {
    if (!patientId) { setStatus("pending"); return; }
    let alive = true;
    setStatus("loading");
    getDashboard(patientId)
      .then((res) => { if (alive) { setData(res || {}); setStatus("ready"); } })
      .catch((err) => {
        // Endpoint not live yet, or no data — fall back to skeleton, don't block the UI.
        if (alive) { setError(String(err?.message || err)); setData(null); setStatus("pending"); }
      });
    return () => { alive = false; };
  }, [patientId]);

  // Force a fresh 12-agent run; the backend stores it as a new snapshot (history kept).
  const handleRegenerate = () => {
    if (!patientId || regenerating) return;
    setRegenerating(true);
    setError("");
    regenerateDashboard(patientId)
      .then((res) => { setData(res || {}); setStatus("ready"); })
      .catch((err) => { setError(String(err?.message || err)); })
      .finally(() => setRegenerating(false));
  };

  const modulesData = data?.modules || {};
  const kpis = data?.kpis || {};
  const patient = data?.patient || {};
  const generatedAt = patient?.reportGenerated?.value || "";
  const version = data?.version;

  const jumpTo = (id) => {
    const el = document.getElementById(`so-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Box sx={{ background: C.white }}>
      {/* Title + regenerate + module nav */}
      <Box sx={{ position: "sticky", top: 0, zIndex: 5, background: C.white, borderBottom: `1px solid ${C.border}`, px: 3, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ fontFamily: FONT, fontSize: 10, fontWeight: FW_NORMAL, letterSpacing: "0.16em", color: C.textSecond, border: `1px solid ${C.border}`, px: 1, py: 0.5, textTransform: "uppercase" }}>SX · AI</Box>
          <Typography sx={{ fontSize: 14, fontWeight: FW_NORMAL, letterSpacing: "0.02em", color: C.textPrimary, fontFamily: FONT }}>
            Surgical Oncology Intelligence
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          {/* Generated-at + version indicator (from the stored snapshot) */}
          {generatedAt ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_LIGHT, color: C.textMuted, whiteSpace: "nowrap" }}>
              {version ? `v${version} · ` : ""}{generatedAt}
            </Typography>
          ) : null}
          {/* Regenerate — forces a fresh agent run, stored as a new snapshot */}
          <Button
            onClick={handleRegenerate}
            disabled={!patientId || regenerating}
            sx={{ ...outlineBtnSx, py: 0.5, px: 2, fontSize: 11, minWidth: 0, "&.Mui-disabled": { opacity: 0.5, color: C.textMuted, borderColor: C.border } }}
          >
            {regenerating ? <CircularProgress size={13} sx={{ mr: 1, color: C.textMuted }} /> : null}
            {regenerating ? "Regenerating" : "Regenerate"}
          </Button>
          <Button
            onClick={() => setSkillOpen(true)}
            sx={{
              fontFamily: FONT,
              fontSize: 11.5,
              fontWeight: 500,
              textTransform: "none",
              color: C.white,
              backgroundColor: C.black,
              border: `1px solid ${C.black}`,
              borderRadius: 0,
              px: 2,
              py: 0.7,
              "&:hover": {
                backgroundColor: "#222222",
              },
            }}
          >
            Configure Intelligence Skill
          </Button>
          {/* Module quick-nav */}
          <Box sx={{ display: "flex", gap: 0, overflowX: "auto", "&::-webkit-scrollbar": { display: "none" } }}>
            {MODULES.map((m) => (
              <Box key={m.id} onClick={() => jumpTo(m.id)}
                sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_LIGHT, letterSpacing: "0.04em", color: C.textMuted, cursor: "pointer", px: 1.25, py: 0.75, borderRight: `1px solid ${C.bgTertiary}`, whiteSpace: "nowrap", "&:hover": { color: C.textPrimary } }}>
                {m.idx}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Regenerating banner — agents are re-running; prior data stays visible underneath */}
      {regenerating && (
        <Box sx={{ px: 3, py: 1.25, background: STATUS.flag.bg, borderBottom: `1px solid ${STATUS.flag.border}`, display: "flex", alignItems: "center", gap: 1.25 }}>
          <CircularProgress size={13} sx={{ color: STATUS.flag.color }} />
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: STATUS.flag.color, fontWeight: FW_LIGHT }}>
            Regenerating intelligence — running all 12 agents against the latest record. This may take a moment.
          </Typography>
        </Box>
      )}

      {/* Pending / skeleton banner */}
      {status === "pending" && (
        <Box sx={{ px: 3, py: 1.25, background: STATUS.watch.bg, borderBottom: `1px solid ${STATUS.watch.border}` }}>
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: STATUS.watch.color, fontWeight: FW_LIGHT }}>
            {patientId
              ? "Intelligence agents not yet connected — showing the module skeleton. Each parameter will populate as its agent comes online."
              : "No patient selected — showing the module skeleton."}
          </Typography>
          {error ? (
            <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_LIGHT, color: C.textMuted, mt: 0.5 }}>
              {error}
            </Typography>
          ) : null}
        </Box>
      )}

      {status === "loading" ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 10 }}>
          <CircularProgress size={22} sx={{ color: C.black }} />
        </Box>
      ) : (
        <Box sx={{ px: 3, pb: 8 }}>
          {/* Patient strip */}
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ ...EYEBROW, mb: 1 }}>Patient</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", md: "repeat(3,1fr)", lg: "repeat(6,1fr)" }, borderTop: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
              {PATIENT_STRIP_SLOTS.map((slot) => {
                // A slot may arrive as { value, sub }, as a bare string, or be absent.
                const raw = patient[slot.key];
                const value = raw == null ? undefined : (typeof raw === "object" ? raw.value : raw);
                const sub = raw && typeof raw === "object" ? raw.sub : undefined;
                return <PatientCell key={slot.key} label={slot.label} value={value} sub={sub} collapsible={slot.collapsible} />;
              })}
            </Box>
          </Box>

          {/* KPI row */}
          <Box sx={{ mt: 3.5 }}>
            <Typography sx={{ ...EYEBROW, mb: 1 }}>Key Indicators</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,1fr)", md: "repeat(3,1fr)", lg: "repeat(6,1fr)" }, gap: 1 }}>
              {KPI_SLOTS.map((slot) => {
                const k = kpis[slot.key] || {};
                return <KpiCard key={slot.key} label={slot.label} value={k.value} status={k.status} note={k.note} />;
              })}
            </Box>
          </Box>

          {/* Nurse Questionnaire — collapsible, cross-specialty (shared component) */}
          <Box sx={{ mt: 3.5 }}>
            <NurseQuestionnaire patientId={patientId} speciality="Surgical Oncology" />
          </Box>

          {/* 12 module sections */}
          <Box sx={{ mt: 4 }}>
            {MODULES.map((m) => (
              <ModuleSection key={m.id} module={m} data={modulesData[m.id]} />
            ))}
          </Box>
        </Box>
      )}
      <SurgicalOncologySkillPanel
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
        patientId={patientId}
        doctorId={doctorId}
      />
    </Box>
  );
};

export default DashboardTab;
