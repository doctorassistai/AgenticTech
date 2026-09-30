import React, { useState, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  FactCheckRounded,
  ArrowUpwardRounded,
  ArrowDownwardRounded,
} from "@mui/icons-material";
import { THEMES } from "../dashboard/themes";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  white: theme.bg, ghost: theme.bgAlt, fog: theme.bgTert,
  black: theme.text, ink: theme.text, charcoal: theme.textSec,
  smoke: theme.textSec, ash: theme.textMuted, silver: theme.textMuted,
  mist: theme.border, border: theme.borderStr,
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });
const card = { background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };

const actionButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.06em",
  background: C.black, color: C.white, border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal }, "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const DIRECTION_COLOR = { worsening: "#b3261e", improving: "#2e7d32", stable: "#8a6d00", rising: "#b3261e", falling: "#8a6d00", fluctuating: "#c26b1e" };
const DIRECTION_BG = { worsening: "#fbecea", improving: "#eef7ee", stable: "#fbf6e3", rising: "#fbecea", falling: "#fbf6e3", fluctuating: "#fdf0e4" };

const JOINT_STATUS_LABEL = { tender: "Tender", swollen: "Swollen", tender_swollen: "Tender + Swollen", none: "Resolved" };

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

const SectionHeader = ({ label, dateRange }) => (
  <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 1 }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>{label}</Typography>
    {dateRange && <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>{dateRange}</Typography>}
  </Box>
);

const EmptyDomain = ({ text }) => (
  <Box sx={{ p: 1.5, border: `1px dashed ${C.mist}`, borderRadius: "2px" }}>
    <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver }) }}>{text}</Typography>
  </Box>
);

function JointFindingsSection({ data }) {
  if (!data) return <EmptyDomain text="Not enough joint map history yet (need at least 2 saved visits) — Module 2" />;
  const { newly_affected = [], escalated = [], resolved = [], improved = [] } = data;
  const totalChanges = newly_affected.length + escalated.length + resolved.length + improved.length;
  return (
    <Box>
      <SectionHeader label="Joint Findings" dateRange={`${formatDate(data.previous_date)} → ${formatDate(data.current_date)}`} />
      {totalChanges === 0 ? (
        <EmptyDomain text="No change in joint findings since last visit." />
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {newly_affected.map((j) => (
            <Chip key={`new-${j.joint}`} label={`+ ${j.joint} (${JOINT_STATUS_LABEL[j.status] || j.status})`} size="small"
              sx={{ fontSize: 10.5, height: 24, background: "#fbecea", color: "#b3261e", border: "1px solid #b3261e44" }} />
          ))}
          {escalated.map((j) => (
            <Chip key={`esc-${j.joint}`} label={`${j.joint}: ${JOINT_STATUS_LABEL[j.previous_status]} → ${JOINT_STATUS_LABEL[j.status]}`} size="small"
              sx={{ fontSize: 10.5, height: 24, background: "#fdf0e4", color: "#c26b1e", border: "1px solid #c26b1e44" }} />
          ))}
          {improved.map((j) => (
            <Chip key={`imp-${j.joint}`} label={`${j.joint}: ${JOINT_STATUS_LABEL[j.previous_status]} → ${JOINT_STATUS_LABEL[j.status]}`} size="small"
              sx={{ fontSize: 10.5, height: 24, background: "#eef7ee", color: "#2e7d32", border: "1px solid #2e7d3244" }} />
          ))}
          {resolved.map((j) => (
            <Chip key={`res-${j.joint}`} label={`✓ ${j.joint} resolved`} size="small"
              sx={{ fontSize: 10.5, height: 24, background: "#eef7ee", color: "#2e7d32", border: "1px solid #2e7d3244" }} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function LabsSection({ data }) {
  if (!data) return <EmptyDomain text="No saved lab trend analysis yet — Module 5" />;
  const { changed = [] } = data;
  return (
    <Box>
      <SectionHeader label="Labs" dateRange={formatDate(data.analysis_date)} />
      {changed.length === 0 ? (
        <EmptyDomain text="No labs changed direction since the last analysis." />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {changed.map((t, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, border: `1px solid ${C.fog}`, borderRadius: "2px" }}>
              {t.direction === "rising" ? <ArrowUpwardRounded sx={{ fontSize: 14, color: DIRECTION_COLOR[t.direction] }} />
                : t.direction === "falling" ? <ArrowDownwardRounded sx={{ fontSize: 14, color: DIRECTION_COLOR[t.direction] }} />
                : null}
              <Typography sx={{ ...os({ fontSize: 12, color: C.ink, flex: 1 }) }}>{t.test_name}</Typography>
              <Chip label={t.direction} size="small" sx={{ fontSize: 9.5, height: 18, background: DIRECTION_COLOR[t.direction] || C.charcoal, color: C.white }} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

const SCORE_LABEL = { das28_esr: "DAS28-ESR", das28_crp: "DAS28-CRP", cdai: "CDAI", sdai: "SDAI" };

function DiseaseActivitySection({ data }) {
  if (!data) return <EmptyDomain text="Not enough disease activity history yet (need at least 2 saved visits) — Module 6" />;
  return (
    <Box>
      <SectionHeader label="Disease Activity" dateRange={`${formatDate(data.previous_date)} → ${formatDate(data.current_date)}`} />
      {!data.metric_used ? (
        <EmptyDomain text="No score type present on both the previous and current visit to compare." />
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", background: DIRECTION_BG[data.trend] || C.ghost }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{SCORE_LABEL[data.metric_used]}</Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
            {data.previous_scores[data.metric_used]?.value} → {data.current_scores[data.metric_used]?.value}
          </Typography>
          <Chip label={data.trend} size="small" sx={{ fontSize: 9.5, height: 18, background: DIRECTION_COLOR[data.trend] || C.charcoal, color: C.white }} />
        </Box>
      )}
    </Box>
  );
}

function ImagingSection({ data }) {
  if (!data) return <EmptyDomain text="No saved imaging comparison yet — Module 11" />;
  const { changed = [] } = data;
  return (
    <Box>
      <SectionHeader label="Imaging" dateRange={formatDate(data.comparison_date)} />
      {changed.length === 0 ? (
        <EmptyDomain text="No imaging regions changed direction since the last comparison." />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {changed.map((c, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, p: 1, border: `1px solid ${C.fog}`, borderRadius: "2px" }}>
              <Typography sx={{ ...os({ fontSize: 12, color: C.ink, flex: 1 }) }}>{c.region}</Typography>
              <Chip label={c.direction} size="small" sx={{ fontSize: 9.5, height: 18, background: DIRECTION_COLOR[c.direction] || C.charcoal, color: C.white }} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function RheumatologyFollowup({ doctorId, patientId, patientName }) {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const generateBriefing = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-followup/briefing/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status !== "success") throw new Error(json?.detail || "Failed to build follow-up briefing");
      setBriefing(json.finaloutput);
    } catch (err) {
      console.error("Follow-up briefing failed:", err);
      setError(err.message || "Failed to build follow-up briefing");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

  const handleSave = async () => {
    if (!briefing) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-followup/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, briefing }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Briefing saved");
      window.dispatchEvent(new Event("refreshRheumatologyFollowupHistory"));
    } catch (err) {
      console.error("Follow-up briefing save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Follow-up Briefing</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `What's changed since the last visit — ${patientName}` : "What's changed since the last visit"}
          </Typography>
        </Box>
        <Chip label="Module 16 · Follow-up Agent" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      <Box sx={{ px: 3, py: 2.5, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={generateBriefing} disabled={loading} sx={{ ...actionButton, minWidth: 200 }}>
          {loading ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <FactCheckRounded sx={{ fontSize: 15 }} />}
          {loading ? "Building briefing..." : "Generate Briefing"}
        </Box>
      </Box>

      {error && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 2 }) }}>{error}</Typography>}

      {briefing && (
        <Box sx={{ px: 3, pb: 2, display: "flex", flexDirection: "column", gap: 2.5 }}>
          {!briefing.narrative && ![briefing.joint_findings, briefing.labs, briefing.disease_activity, briefing.imaging].some(Boolean) && (
            <EmptyDomain text="No prior data found across joint findings, labs, disease activity, or imaging — nothing to compare yet." />
          )}
          <JointFindingsSection data={briefing.joint_findings} />
          <LabsSection data={briefing.labs} />
          <DiseaseActivitySection data={briefing.disease_activity} />
          <ImagingSection data={briefing.imaging} />

          {briefing.narrative && (
            <Box sx={{ p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>60-Second Pre-Visit Summary</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{briefing.narrative}</Typography>
            </Box>
          )}
        </Box>
      )}

      {!briefing && !loading && !error && (
        <Box sx={{ px: 3, pb: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            Click "Generate Briefing" to see what's changed since the patient's last visit.
          </Typography>
        </Box>
      )}

      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !briefing} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Briefing"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}