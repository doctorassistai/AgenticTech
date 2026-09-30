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

const CATEGORY_COLOR = { Low: "#2e7d32", Moderate: "#8a6d00", High: "#b3261e" };

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
};

export default function RheumatologyComorbidityRiskHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-comorbidity-risk/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load comorbidity risk history");
    } catch (err) {
      console.error("Failed to fetch comorbidity risk history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyComorbidityRiskHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyComorbidityRiskHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Comorbidity & Risk History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No comorbidity risk reviews saved yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {records.map((rec, idx) => (
            <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formatDate(rec.created_at)}</Typography>
                {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
              </Box>
              <Box sx={{ p: 2 }}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: rec.narrative ? 1.5 : 0 }}>
                  {(rec.domains || []).map((d) => (
                    <Chip
                      key={d.domain}
                      label={`${d.domain}: ${d.category}`}
                      size="small"
                      sx={{ fontSize: 10.5, height: 22, background: `${CATEGORY_COLOR[d.category] || C.charcoal}18`, color: CATEGORY_COLOR[d.category] || C.charcoal, border: `1px solid ${CATEGORY_COLOR[d.category] || C.mist}44` }}
                    />
                  ))}
                </Box>
                {rec.narrative && (
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}>{rec.narrative}</Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}