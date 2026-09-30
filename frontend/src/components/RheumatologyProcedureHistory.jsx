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

const OUTCOME_COLOR = {
  Improved: "#2e7d32", "Partial improvement": "#8a6d00", "No change": "#5f6368",
  Worsened: "#b3261e", "Not yet assessed": "#8a8a8a",
};

const JOINT_REGION_LABELS = (region) => (region || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function RheumatologyProcedureHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load procedure history");
    } catch (err) {
      console.error("Failed to fetch procedure history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyProcedureHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyProcedureHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Procedure History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No procedures logged yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {records.map((rec, idx) => (
            <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                  {rec.date} · {rec.procedure_type} · {JOINT_REGION_LABELS(rec.joint_region)}
                </Typography>
                <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
                  <Chip label={rec.outcome} size="small" sx={{ fontSize: 10, height: 20, background: OUTCOME_COLOR[rec.outcome] || C.charcoal, color: C.white }} />
                  {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
                </Box>
              </Box>
              <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
                <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>Indication: {rec.indication}</Typography>
                {rec.medication_name && <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>Medication: {rec.medication_name}{rec.volume_ml ? ` · ${rec.volume_ml} mL` : ""}</Typography>}
                {rec.complications && rec.complications !== "None" && (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: "#b3261e" }) }}>
                    Complication: {rec.complications}{rec.complications_detail ? ` — ${rec.complications_detail}` : ""}
                  </Typography>
                )}
                {rec.notes && <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mt: 0.5 }) }}>{rec.notes}</Typography>}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}