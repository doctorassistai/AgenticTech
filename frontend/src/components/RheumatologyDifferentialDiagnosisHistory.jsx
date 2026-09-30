import React, { useState, useEffect } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, HistoryRounded, StarRounded } from "@mui/icons-material";
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

const TIERS = [
  { key: "likely", label: "Likely", accent: "#2e7d32" },
  { key: "possible", label: "Possible", accent: "#8a6d00" },
  { key: "must_not_miss", label: "Must Not Miss", accent: "#b3261e" },
];

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
};

export default function RheumatologyDifferentialDiagnosisHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-differential/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load differential diagnosis history");
    } catch (err) {
      console.error("Failed to fetch differential diagnosis history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyDifferentialHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyDifferentialHistory", handler);
  }, [patientId, doctorId]);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Differential Diagnosis History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No differential diagnosis records yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
          {records.map((rec, idx) => {
            const diff = rec.differential_diagnosis || {};
            return (
              <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formatDate(rec.created_at)}</Typography>
                  {idx === 0 && <Chip label="Most Recent" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />}
                </Box>
                <Box sx={{ p: 2 }}>
                  {rec.working_diagnosis && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1.5, p: 1, borderRadius: "2px", background: "#eef7ee" }}>
                      <StarRounded sx={{ fontSize: 15, color: "#2e7d32" }} />
                      <Typography sx={{ ...os({ fontSize: 12, color: "#1b4d1e" }) }}>Working diagnosis: {rec.working_diagnosis}</Typography>
                    </Box>
                  )}
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                    {TIERS.map((tier) => {
                      const items = diff[tier.key] || [];
                      if (items.length === 0) return null;
                      return (
                        <Box key={tier.key}>
                          <Typography sx={{ ...os({ fontSize: 10, color: tier.accent, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
                            {tier.label}
                          </Typography>
                          {items.map((item, i) => (
                            <Box key={i} sx={{ mb: 1 }}>
                              <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{item.condition}</Typography>
                              {(item.evidence || []).map((e, ei) => (
                                <Typography key={ei} sx={{ ...os({ fontSize: 11, color: C.charcoal, ml: 1 }) }}>• {e}</Typography>
                              ))}
                            </Box>
                          ))}
                        </Box>
                      );
                    })}
                  </Box>
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