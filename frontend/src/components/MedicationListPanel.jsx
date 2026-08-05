import React, { useEffect, useState, useMemo } from "react";
import {
  Box,
  Typography,
  Paper,
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

/* ===============================
   Glass Card
================================ */
const glassCard = {
  borderRadius: 8,
  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.3)",
  boxShadow: "0 10px 35px rgba(0,0,0,0.08)",
};

/* Helpers */
const prettifyKey = (k) =>
  k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const isValid = (v) => v !== "" && v !== null && v !== undefined;

/* Format time label */
const formatDateTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/* =============================== */

export default function MedicationListPanel({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);

  /* ===============================
     Fetch
  =============================== */
  useEffect(() => {
    if (!patientId || !doctorId) return;

    const load = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}hms/users/data/context/documentation-medication-analysis/${patientId}/${doctorId}`
        );

        const json = await res.json();
        const list = json?.data || [];

        /* 🔥 sort latest first */
        const sorted = list.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );

        setRecords(sorted);

        if (sorted.length) {
          setSelectedId(sorted[0]._id); // latest selected
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [patientId, doctorId]);

  /* ===============================
     Selected Visit
  =============================== */
  const selectedVisit = useMemo(
    () => records.find((r) => r._id === selectedId),
    [records, selectedId]
  );

  const prescriptions =
    selectedVisit?.finaloutput?.prescriptions || [];

  /* ===============================
     Dynamic columns
  =============================== */
  const columns = useMemo(() => {
    if (!prescriptions.length) return [];

    return Object.keys(prescriptions[0]).filter((k) =>
      isValid(prescriptions[0][k])
    );
  }, [prescriptions]);

  /* ===============================
     UI
  =============================== */

  if (loading) return <CircularProgress />;

  if (!records.length)
    return <Typography>No medication history</Typography>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Paper sx={{ ...glassCard, p: 2.5 }}>

        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            mb: 2,
            alignItems: "center",
          }}
        >
          <Typography fontWeight={600} fontSize={16}>
            Medication History
          </Typography>

          {/* 🔥 TIME BASED SELECTOR */}
          <Select
            size="small"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {records.map((r) => (
              <MenuItem key={r._id} value={r._id}>
                {formatDateTime(r.created_at)}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Table */}
        <Box sx={{ overflow: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((c) => (
                  <TableCell key={c}>
                    <b>{prettifyKey(c)}</b>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>

            <TableBody>
              {prescriptions.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c}>
                      {Array.isArray(row[c])
                        ? row[c].join(", ")
                        : row[c] || "--"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </motion.div>
  );
}
