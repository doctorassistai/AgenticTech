import React, { useEffect, useState, useMemo } from "react";
import {
  Box,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
} from "@mui/material";
import { motion } from "framer-motion";
import RefreshIcon from "@mui/icons-material/Refresh";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;

const C = {
  black:    "#000000",
  charcoal: "#444444",
  ash:      "#888888",
  mist:     "#e0e0e0",
  ghost:    "#fafafa",
  offwhite: "#f5f5f5",
  white:    "#ffffff",
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...extra,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const prettifyKey = (key) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const safeRender = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map((v) => safeRender(v)).join(", ");
    if (value.systolic && value.diastolic) return `${value.systolic}/${value.diastolic}`;
    if (value.value !== undefined) return safeRender(value.value);
    if (Object.keys(value).length === 0) return "—";
    return JSON.stringify(value);
  }
  return String(value);
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function VitalsPanel({ patientId, doctorId }) {
  const [vitals, setVitals]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const fetchVitals = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}hms/users/data/get_patient_vitals_v2/${patientId}`
      );
      const json = await res.json();
      if (json?.detail) { setVitals([]); setError(json.detail); return; }
      if (Array.isArray(json)) { setVitals(json); return; }
      setVitals([]);
    } catch (err) {
      console.error("Vitals fetch error:", err);
      setError("Failed to load vitals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVitals(); }, [patientId, doctorId]);

  const sortedVitals = useMemo(() => [...vitals].reverse(), [vitals]);

  const dynamicKeys = useMemo(() => {
    const set = new Set();
    sortedVitals.forEach((v) => {
      Object.keys(v.vital_data || {}).forEach((k) => {
        if (k !== "doctor_id" && k !== "appointment_id") set.add(k);
      });
    });
    return Array.from(set);
  }, [sortedVitals]);

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <CircularProgress size={20} thickness={1.5} sx={{ color: C.black }} />
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>
          Loading vitals...
        </Typography>
      </Box>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 2 }) }}>{error}</Typography>
        <Box
          component="button"
          onClick={fetchVitals}
          sx={{
            fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
            color: C.black, background: "transparent",
            border: `1px solid ${C.mist}`,
            px: 2.5, py: 0.9, cursor: "pointer",
            letterSpacing: "0.05em", textTransform: "uppercase",
            transition: "all 0.2s",
            "&:hover": { background: C.ghost, borderColor: C.black },
          }}
        >
          <RefreshIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: "middle" }} />
          Retry
        </Box>
      </Box>
    );
  }

  // ─── Empty ──────────────────────────────────────────────────────────────────
  if (!sortedVitals.length) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, letterSpacing: "0.05em" }) }}>
          No vitals recorded yet
        </Typography>
      </Box>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        mb: 2.5, pb: 2, borderBottom: `1px solid ${C.mist}`,
        flexWrap: "wrap", gap: 1,
      }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.12em", textTransform: "uppercase", mb: 0.4 }) }}>
            Patient Vitals
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.black, fontWeight: FW_REGULAR }) }}>
            {sortedVitals.length} record{sortedVitals.length !== 1 ? "s" : ""} · Latest first
          </Typography>
        </Box>

        <Box
          component="button"
          onClick={fetchVitals}
          sx={{
            width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid ${C.mist}`,
            cursor: "pointer", color: C.ash, transition: "all 0.2s",
            "&:hover": { background: C.ghost, borderColor: C.black, color: C.black },
          }}
        >
          <RefreshIcon sx={{ fontSize: 13 }} />
        </Box>
      </Box>

      {/* Table */}
      <Box sx={{ overflow: "auto", maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: FW_REGULAR }),
                  background: C.ghost,
                  borderBottom: `1px solid ${C.mist}`,
                  py: 1.25, px: 2,
                  whiteSpace: "nowrap",
                }}
              >
                Date
              </TableCell>
              {dynamicKeys.map((key) => (
                <TableCell
                  key={key}
                  sx={{
                    ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: FW_REGULAR }),
                    background: C.ghost,
                    borderBottom: `1px solid ${C.mist}`,
                    py: 1.25, px: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {prettifyKey(key)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {sortedVitals.map((entry, i) => {
              const d = entry.vital_data || {};
              return (
                <TableRow
                  key={i}
                  component={motion.tr}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  sx={{
                    "&:hover": { background: C.ghost },
                    "&:last-child td": { borderBottom: "none" },
                    transition: "background 0.15s",
                  }}
                >
                  <TableCell sx={{ borderBottom: `1px solid ${C.mist}`, py: 1.25, px: 2 }}>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                      {entry.date}
                    </Typography>
                  </TableCell>

                  {dynamicKeys.map((k) => (
                    <TableCell key={k} sx={{ borderBottom: `1px solid ${C.mist}`, py: 1.25, px: 2 }}>
                      <Box sx={{
                        display: "inline-block",
                        px: 1.25, py: 0.3,
                        border: `1px solid ${C.mist}`,
                        background: C.white,
                      }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, fontWeight: FW_REGULAR }) }}>
                          {safeRender(d[k])}
                        </Typography>
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </motion.div>
  );
}