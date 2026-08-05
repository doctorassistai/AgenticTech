import React, { useEffect, useState, useMemo } from "react";
import {
  Box,
  Typography,
  Paper,
  Divider,
  Select,
  MenuItem,
  CircularProgress,
  Chip,
} from "@mui/material";
import { motion } from "framer-motion";

/* ===============================
   Light Blue Glass Theme
================================ */
const glassCard = {
  borderRadius: 14,
  background: "rgba(63,182,255,0.08)",
  backdropFilter: "blur(16px) saturate(140%)",
  WebkitBackdropFilter: "blur(16px) saturate(140%)",
  border: "1px solid rgba(63,182,255,0.2)",
  boxShadow: "0 12px 32px rgba(63,182,255,0.18)",
};

/* ===============================
   Helpers
================================ */
const prettifyKey = (k) =>
  k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatDateTime = (d) =>
  new Date(d).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ===============================
   Recursive Renderer
================================ */
const RenderValue = ({ value, level = 0 }) => {
  if (value === null || value === undefined || value === "") {
    return <Typography fontSize={13}>--</Typography>;
  }

  // STRING / NUMBER
  if (typeof value !== "object") {
    return (
      <Typography fontSize={13} sx={{ whiteSpace: "pre-line" }}>
        {String(value)}
      </Typography>
    );
  }

  // ARRAY
  if (Array.isArray(value)) {
    return (
      <Box sx={{ pl: 2 }}>
        {value.map((item, i) => (
          <Box key={i} sx={{ mb: 1 }}>
            <Typography fontSize={12} sx={{ color: "#1ccfc9" }}>
              •
            </Typography>
            <Box sx={{ pl: 1 }}>
              <RenderValue value={item} level={level + 1} />
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  // OBJECT
  return (
    <Box sx={{ pl: level ? 2 : 0 }}>
      {Object.entries(value).map(([k, v]) => (
        <Box key={k} sx={{ mb: 1.5 }}>
          <Typography
            fontSize={12}
            fontWeight={600}
            sx={{ color: "#3fb6ff", mb: 0.25 }}
          >
            {prettifyKey(k)}
          </Typography>
          <RenderValue value={v} level={level + 1} />
        </Box>
      ))}
    </Box>
  );
};

/* ===============================
   Component
================================ */
export default function TreatmentPlanList({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  /* ===============================
     Fetch
  =============================== */
  useEffect(() => {
    if (!patientId || !doctorId) return;

    const load = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}hms/users/data/context/documentation-treatment-plan/${patientId}/${doctorId}`
        );
        const json = await res.json();
        const list = Array.isArray(json?.data) ? json.data : [];

        const sorted = list.sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );

        setRecords(sorted);
        setSelectedIndex(0);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [patientId, doctorId]);

  const selected = records[selectedIndex];
  const output = selected?.finaloutput || {};

  /* ===============================
     UI States
  =============================== */
  if (loading)
    return (
      <Box sx={{ textAlign: "center", p: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );

  if (!records.length)
    return (
      <Typography sx={{ opacity: 0.6 }}>
        No treatment plan history available
      </Typography>
    );

  /* ===============================
     Render
  =============================== */
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Paper sx={{ ...glassCard, p: 3 }}>
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 2,
            mb: 2,
          }}
        >
          <Typography
            fontWeight={600}
            fontSize={16}
            sx={{ color: "#3fb6ff" }}
          >
            Treatment Plan History
          </Typography>

          <Select
            size="small"
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(e.target.value)}
            sx={{
              minWidth: 240,
              background: "rgba(255,255,255,0.6)",
              borderRadius: 2,
            }}
          >
            {records.map((r, i) => (
              <MenuItem key={i} value={i}>
                {formatDateTime(r.date)}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Dynamic Content */}
        <RenderValue value={output} />
      </Paper>
    </motion.div>
  );
}
