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
  try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

const countJoints = (joints = {}) => {
  const values = Object.values(joints);
  return {
    tender: values.filter((v) => v === "tender" || v === "tender_swollen").length,
    swollen: values.filter((v) => v === "swollen" || v === "tender_swollen").length,
  };
};

export default function RheumatologyJointMapHistory({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-joint-map/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecords(json.data || []);
      else setError(json?.detail || "Failed to load joint map history");
    } catch (err) {
      console.error("Failed to fetch joint map history:", err);
      setError("Network error while fetching history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const handler = () => fetchHistory();
    window.addEventListener("refreshRheumatologyJointMapHistory", handler);
    return () => window.removeEventListener("refreshRheumatologyJointMapHistory", handler);
  }, [patientId, doctorId]);

  const prevCounts = records[1] ? countJoints(records[1].joint_map?.joints) : null;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Joint Map History</Typography>
        </Box>
        {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && records.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No joint map records yet</Typography></Box>
      )}

      {!error && records.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {records.map((rec, idx) => {
            const jm = rec.joint_map || {};
            const counts = countJoints(jm.joints);
            const delta = idx === 0 && prevCounts
              ? { tender: counts.tender - prevCounts.tender, swollen: counts.swollen - prevCounts.swollen }
              : null;
            return (
              <Box key={rec._id || idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
                <Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{formatDate(rec.created_at)}</Typography>
                  {jm.axial_involvement && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>Axial: {jm.axial_involvement}</Typography>}
                </Box>
                <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
                  <Box sx={{ textAlign: "center" }}>
                    <Typography sx={{ ...os({ fontSize: 16, color: C.ink }) }}>{counts.tender}</Typography>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.ash, textTransform: "uppercase" }) }}>Tender</Typography>
                  </Box>
                  <Box sx={{ textAlign: "center" }}>
                    <Typography sx={{ ...os({ fontSize: 16, color: C.ink }) }}>{counts.swollen}</Typography>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.ash, textTransform: "uppercase" }) }}>Swollen</Typography>
                  </Box>
                  {jm.pain_severity !== "" && jm.pain_severity !== undefined && (
                    <Box sx={{ textAlign: "center" }}>
                      <Typography sx={{ ...os({ fontSize: 16, color: C.ink }) }}>{jm.pain_severity}/10</Typography>
                      <Typography sx={{ ...os({ fontSize: 9, color: C.ash, textTransform: "uppercase" }) }}>Pain</Typography>
                    </Box>
                  )}
                  {idx === 0 && (
                    <Chip label="Latest" size="small" sx={{ fontSize: 9, height: 18, background: C.black, color: C.white }} />
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