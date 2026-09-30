import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  TrendingUpRounded,
  TrendingDownRounded,
  TrendingFlatRounded,
  WarningAmberRounded,
  HistoryRounded,
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

const CLASSIFICATION_META = {
  "Improving": { color: "#2e7d32", icon: TrendingUpRounded },
  "Stable": { color: "#3d5a80", icon: TrendingFlatRounded },
  "Inadequate response": { color: "#8a6d00", icon: TrendingFlatRounded },
  "Worsening": { color: "#b3261e", icon: TrendingDownRounded },
  "Possible flare": { color: "#b3261e", icon: WarningAmberRounded },
};

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
};

export default function RheumatologyTreatmentResponseHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const loadHistory = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-response/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load treatment response history");
    } catch (err) {
      console.error("Failed to fetch treatment response history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    loadHistory();
    const handler = () => loadHistory();
    window.addEventListener("refreshRheumatologyTreatmentResponseHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyTreatmentResponseHistory", handler);
  }, [loadHistory]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 16, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Treatment Response History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 15, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>No treatment response evaluations saved yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 1.5, sm: 2 }, display: "flex", flexDirection: "column", gap: 1 }}>
          {records.map((r) => {
            const meta = CLASSIFICATION_META[r.classification] || {};
            const Icon = meta.icon;
            const expanded = expandedId === r._id;
            return (
              <Box key={r._id} sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", overflow: "hidden" }}>
                <Box
                  onClick={() => setExpandedId(expanded ? null : r._id)}
                  sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", "&:hover": { background: C.ghost } }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                    {Icon && <Icon sx={{ fontSize: 16, color: meta.color }} />}
                    <Typography sx={{ ...os({ fontSize: 12.5, color: meta.color || C.ink }) }}>{r.classification}</Typography>
                  </Box>
                  <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>{formatDate(r.created_at)}</Typography>
                </Box>
                {expanded && (
                  <Box sx={{ px: 1.5, pb: 1.5, borderTop: `1px solid ${C.fog}`, pt: 1.25 }}>
                    {r.primary_signal && (
                      <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 0.5 }) }}>
                        {String(r.primary_signal.score_key || "").toUpperCase()}: {r.primary_signal.previous_category} → {r.primary_signal.current_category}
                      </Typography>
                    )}
                    {r.biomarker_signal && (
                      <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 0.5 }) }}>
                        Biomarkers: {r.biomarker_signal.previous_abnormal_count} → {r.biomarker_signal.current_abnormal_count} abnormal
                      </Typography>
                    )}
                    {r.imaging_signal && (
                      <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 0.5 }) }}>
                        Imaging: {r.imaging_signal.regions_worsening} worsening / {r.imaging_signal.regions_improving} improving / {r.imaging_signal.regions_stable} stable
                      </Typography>
                    )}
                    {r.narrative && (
                      <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, fontStyle: "italic", mt: 0.75 }) }}>{r.narrative}</Typography>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}