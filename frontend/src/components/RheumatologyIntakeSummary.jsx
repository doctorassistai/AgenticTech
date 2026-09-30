import React, { useState, useEffect } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, HistoryRounded } from "@mui/icons-material";
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

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
};

const Row = ({ label, value }) => {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <Box sx={{ mb: 1.25 }}>
      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.25 }) }}>{label}</Typography>
      <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.5 }) }}>
        {Array.isArray(value) ? value.join(", ") : String(value)}
      </Typography>
    </Box>
  );
};

export default function RheumatologyIntakeSummary({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-intake/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load intake history");
    } catch (err) {
      console.error("Failed to fetch rheumatology intake history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyIntakeHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyIntakeHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Intake History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography>
        </Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No intake records yet</Typography>
        </Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
          {records.map((rec, idx) => {
            const intake = rec.rheumatology_intake || {};
            return (
              <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formatDate(rec.created_at)}</Typography>
                  {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
                </Box>
                <Box sx={{ p: 2 }}>
                  <Row label="Chief Complaint" value={intake.chief_complaint} />
                  <Row label="Onset / Progression" value={[intake.onset, intake.progression].filter(Boolean).join(" · ")} />
                  <Row label="Joint Pattern" value={[intake.joint_distribution, intake.joint_size, intake.joint_symmetry].filter(Boolean).join(" · ")} />
                  <Row label="Affected Joints" value={intake.affected_joints} />
                  <Row label="Morning Stiffness" value={intake.morning_stiffness_minutes ? `${intake.morning_stiffness_minutes} min` : ""} />
                  <Row label="Extra-articular Symptoms" value={intake.extra_articular_symptoms} />
                  <Row label="Previous Autoimmune Disease" value={intake.previous_autoimmune_disease} />
                  <Row label="Family History" value={intake.family_history} />
                  <Row label="Comorbidities" value={intake.comorbidities} />
                  <Row label="Steroid Exposure" value={intake.steroid_exposure?.has_used === "Yes" ? `Yes — ${intake.steroid_exposure?.detail || ""}` : intake.steroid_exposure?.has_used} />
                  {intake.suspected_patterns?.length > 0 && (
                    <Box sx={{ mt: 1, p: 1.5, borderRadius: "2px", background: C.ghost }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Suspected Patterns</Typography>
                      {intake.suspected_patterns.map((p, i) => (
                        <Typography key={i} sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>• {p}</Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}