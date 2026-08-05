import React, { useEffect, useState, useMemo } from "react";
import {
  Box,
  Typography,
  Divider,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Select,
  MenuItem,
} from "@mui/material";
import { motion } from "framer-motion";

// ─── BRAND TOKENS ─────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';

const C = {
  black:       "#000000",
  white:       "#ffffff",
  bgPrimary:   "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary:  "#f5f5f5",
  textPrimary: "#000000",
  textSecond:  "#444444",
  textMuted:   "#888888",
  border:      "#e0e0e0",
  borderStrong:"#000000",
};

const labelStyle = {
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: C.textMuted,
  fontFamily: FONT,
  fontWeight: 400,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const prettifyKey = (k) =>
  k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const isValid = (v) => v !== "" && v !== null && v !== undefined;

const formatDateTime = (isoOrDate) => {
  const d = new Date(isoOrDate);
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function InvestigationListPanel({ patientId, doctorId }) {
  const [records, setRecords]     = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!patientId || !doctorId) return;
    const load = async () => {
      try {
        const res  = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}hms/users/data/context/documentation-investigation-notes/${patientId}/${doctorId}`
        );
        const json = await res.json();
        const list = Array.isArray(json?.data) ? json.data : [];
        const sorted = list.sort(
          (a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date)
        );
        setRecords(sorted);
        if (sorted.length) setSelectedId(sorted[0]._id);
      } finally { setLoading(false); }
    };
    load();
  }, [patientId, doctorId]);

  const selectedVisit = useMemo(
    () => records.find((r) => r._id === selectedId),
    [records, selectedId]
  );

  const investigations = selectedVisit?.finaloutput?.investigation_orders || [];

  const columns = useMemo(() => {
    if (!investigations.length) return [];
    return Array.from(
      new Set(investigations.flatMap((row) => Object.keys(row).filter((k) => isValid(row[k]))))
    );
  }, [investigations]);

  // ── Loading ──
  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={22} sx={{ color: C.black }} />
      </Box>
    );

  // ── Empty ──
  if (!records.length)
    return (
      <Box sx={{
        border: `1px solid ${C.border}`,
        background: C.bgSecondary,
        px: 2.5, py: 4, textAlign: "center",
      }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT, fontWeight: 300 }}>
          No investigation history found
        </Typography>
      </Box>
    );

  // ── Main ──
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgPrimary, fontFamily: FONT }}>

        {/* ── Header bar ── */}
        <Box sx={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          px: 2.5, py: 1.75,
          background: C.bgSecondary,
          borderBottom: `1px solid ${C.borderStrong}`,
          flexWrap: "wrap", gap: 2,
        }}>
          <Box>
            <Typography sx={{ ...labelStyle, mb: 0.25 }}>Diagnostics</Typography>
            <Typography sx={{
              fontSize: 15, fontWeight: 400, fontFamily: FONT,
              color: C.textPrimary, letterSpacing: "-0.01em",
            }}>
              Investigation History
            </Typography>
          </Box>

          {/* Date selector */}
          <Select
            size="small"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            sx={{
              minWidth: 220,
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 300,
              borderRadius: 0,
              background: C.bgPrimary,
              "& .MuiOutlinedInput-notchedOutline": { borderColor: C.border, borderRadius: 0 },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: C.black },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: C.black, borderWidth: 1 },
              "& .MuiSelect-select": { py: 0.9, px: 1.25 },
            }}
          >
            {records.map((r) => (
              <MenuItem key={r._id} value={r._id} sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 300 }}>
                {formatDateTime(r.created_at || r.date)}
              </MenuItem>
            ))}
          </Select>
        </Box>

        {/* ── Table or empty ── */}
        {investigations.length === 0 ? (
          <Box sx={{ px: 2.5, py: 4, textAlign: "center" }}>
            <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT, fontWeight: 300 }}>
              No investigations for this record
            </Typography>
          </Box>
        ) : (
          <Box sx={{ overflow: "auto" }}>
            <Table size="small" sx={{ borderCollapse: "collapse" }}>

              <TableHead>
                <TableRow sx={{ background: C.bgSecondary }}>
                  {columns.map((c) => (
                    <TableCell key={c} sx={{
                      fontFamily: FONT,
                      fontWeight: 400,
                      fontSize: 10,
                      color: C.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      whiteSpace: "nowrap",
                      borderBottom: `1px solid ${C.border}`,
                      borderRight: `1px solid ${C.border}`,
                      px: 2, py: 1.25,
                      background: C.bgSecondary,
                      "&:last-child": { borderRight: "none" },
                    }}>
                      {prettifyKey(c)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>

              <TableBody>
                {investigations.map((row, i) => (
                  <TableRow key={i} sx={{
                    borderBottom: `1px solid ${C.border}`,
                    transition: "background 0.12s",
                    "&:last-child": { borderBottom: "none" },
                    "&:hover": { background: C.bgSecondary },
                  }}>
                    {columns.map((c) => (
                      <TableCell key={c} sx={{
                        fontFamily: FONT,
                        fontSize: 13,
                        fontWeight: 300,
                        color: C.textSecond,
                        borderBottom: "none",
                        borderRight: `1px solid ${C.border}`,
                        px: 2, py: 1.25,
                        "&:last-child": { borderRight: "none" },
                      }}>
                        {Array.isArray(row[c]) ? row[c].join(", ") : row[c] || (
                          <span style={{ color: C.textMuted }}>—</span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>

            </Table>
          </Box>
        )}

        {/* ── Footer: record count ── */}
        <Box sx={{
          px: 2.5, py: 1,
          borderTop: `1px solid ${C.border}`,
          background: C.bgSecondary,
          display: "flex", justifyContent: "flex-end",
        }}>
          <Typography sx={{ ...labelStyle }}>
            {investigations.length} {investigations.length === 1 ? "investigation" : "investigations"}
          </Typography>
        </Box>

      </Box>
    </motion.div>
  );
}