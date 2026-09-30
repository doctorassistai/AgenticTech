import React, { useState, useEffect } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, HistoryRounded, CheckCircleRounded } from "@mui/icons-material";
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

export default function RheumatologyTreatmentDecisionHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load treatment decision history");
    } catch (err) {
      console.error("Failed to fetch treatment decision history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyTreatmentHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyTreatmentHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Treatment Decision History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No treatment decision records yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {records.map((rec, idx) => {
            const selected = new Set(rec.selected_options || []);
            return (
              <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formatDate(rec.created_at)}</Typography>
                  {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
                </Box>
                <Box sx={{ p: 2 }}>
                  {selected.size === 0 && (
                    <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic", mb: 1 }) }}>Reviewed — no option selected this visit</Typography>
                  )}
                  {(rec.options_presented || []).map((opt, i) => {
                    const isSelected = selected.has(opt.option);
                    return (
                      <Box key={i} sx={{ mb: 1, opacity: isSelected ? 1 : 0.55 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                          {isSelected && <CheckCircleRounded sx={{ fontSize: 14, color: "#2e7d32" }} />}
                          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{opt.option}</Typography>
                        </Box>
                        <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, ml: isSelected ? 2.75 : 0 }) }}>{opt.reason}</Typography>
                      </Box>
                    );
                  })}
                  {rec.physician_notes && (
                    <Box sx={{ mt: 1, p: 1.25, borderRadius: "2px", background: C.ghost }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.25 }) }}>Physician Notes</Typography>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{rec.physician_notes}</Typography>
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