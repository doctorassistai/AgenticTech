import React, { useState, useEffect } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, HistoryRounded, WarningAmberRounded } from "@mui/icons-material";
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

const STATUS_COLOR = { green: "#2e7d32", yellow: "#8a6d00", red: "#b3261e" };
const STATUS_BG = { green: "#eef7ee", yellow: "#fbf6e3", red: "#fbecea" };
const STATUS_LABEL = { green: "Continue", yellow: "Monitoring Required", red: "Review / Hold / Escalate" };
const STATUS_DOT = { green: "\uD83D\uDFE2", yellow: "\uD83D\uDFE1", red: "\uD83D\uDD34" };

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
};

export default function RheumatologyDMARDSafetyHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-dmard-safety/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load DMARD safety history");
    } catch (err) {
      console.error("Failed to fetch DMARD safety history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyDMARDSafetyHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyDMARDSafetyHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>DMARD Safety History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No DMARD safety reviews saved yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
          {records.map((rec, idx) => {
            const panel = rec.panel || [];
            const redCount = panel.filter((p) => p.status === "red").length;
            const yellowCount = panel.filter((p) => p.status === "yellow").length;
            return (
              <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formatDate(rec.created_at)}</Typography>
                  <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
                    {redCount > 0 && <Chip label={`${redCount} Escalate`} size="small" sx={{ fontSize: 9, height: 18, background: "#fbecea", color: "#b3261e" }} />}
                    {yellowCount > 0 && <Chip label={`${yellowCount} Monitor`} size="small" sx={{ fontSize: 9, height: 18, background: "#fbf6e3", color: "#8a6d00" }} />}
                    {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
                  </Box>
                </Box>
                <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
                  {panel.map((p, i) => (
                    <Box key={i} sx={{ borderLeft: `2px solid ${STATUS_COLOR[p.status] || C.mist}`, pl: 1.25, py: 0.25 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                        <Typography sx={{ fontSize: 13 }}>{STATUS_DOT[p.status] || "\u26AA"}</Typography>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{p.name}</Typography>
                        <Chip label={STATUS_LABEL[p.status] || p.status} size="small" sx={{ fontSize: 9, height: 17, background: STATUS_BG[p.status] || C.ghost, color: STATUS_COLOR[p.status] || C.charcoal, border: `1px solid ${STATUS_COLOR[p.status] || C.mist}44` }} />
                      </Box>
                      {(p.reasons || []).slice(0, 3).map((r, ri) => (
                        <Box key={ri} sx={{ display: "flex", gap: 0.5, alignItems: "flex-start", mt: 0.4 }}>
                          {p.status !== "green" && <WarningAmberRounded sx={{ fontSize: 11, color: STATUS_COLOR[p.status], mt: 0.2 }} />}
                          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{r}</Typography>
                        </Box>
                      ))}
                    </Box>
                  ))}
                  {rec.narrative && (
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6, mt: 0.5 }) }}>{rec.narrative}</Typography>
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