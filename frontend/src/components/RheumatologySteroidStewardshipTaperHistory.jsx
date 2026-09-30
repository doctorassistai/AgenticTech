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

const formatDateOnly = (d) => {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologySteroidStewardshipTaperHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/taper-plan-history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load taper plan history");
    } catch (err) {
      console.error("Failed to fetch taper plan history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologySteroidStewardshipTaperHistory", handler);
    return () => window.removeEventListener("refreshRheumatologySteroidStewardshipTaperHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Tapering Plan History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No taper plans saved yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {records.map((rec, idx) => (
            <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formatDate(rec.created_at)}</Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {rec.generated_from_active_dose_mg != null && (
                    <Chip label={`Started at ${rec.generated_from_active_dose_mg}mg/day`} size="small" sx={{ fontSize: 9.5, height: 20, background: C.white, color: C.charcoal, border: `1px solid ${C.mist}` }} />
                  )}
                  {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
                </Box>
              </Box>
              <Box sx={{ p: 2 }}>
                {rec.disclaimer && (
                  <Typography sx={{ ...os({ fontSize: 10.5, color: "#8a6d00", lineHeight: 1.5, mb: 1.25 }) }}>{rec.disclaimer}</Typography>
                )}
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {(rec.steps || []).map((s, i) => (
                    <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Chip label={`#${s.step}`} size="small" sx={{ fontSize: 9.5, height: 19, background: C.ghost, color: C.ash }} />
                      <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>
                        {formatDateOnly(s.start_date)} · {s.dose_mg}mg/day for {s.duration_days} days → next {s.next_dose_mg}mg/day
                      </Typography>
                      {s.note && (
                        <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, width: "100%", pl: 0.5 }) }}>{s.note}</Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}