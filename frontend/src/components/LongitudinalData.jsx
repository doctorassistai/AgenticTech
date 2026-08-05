import React, { useEffect, useState } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import { motion } from "framer-motion";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

export default function Timeline({ patientId }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) return;

    const loadTimeline = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/data/context/timeline/${patientId}`
        );

        const json = await res.json();
        setTimeline(json.timeline || []);
      } catch (err) {
        console.error("Timeline load failed:", err);
      } finally {
        setLoading(false);
      }
    };

    loadTimeline();
  }, [patientId]);

  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ position: "relative", pl: 3 }}>
      {/* Vertical Line */}
      <Box
        sx={{
          position: "absolute",
          left: 10,
          top: 0,
          bottom: 0,
          width: 2,
          background: "linear-gradient(#3fb6ff, transparent)",
        }}
      />

      {timeline.map((day, i) => (
        <Box key={day.date} sx={{ mb: 4 }}>
          {/* Date Header */}
          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 500,
              color: "#3fb6ff",
              mb: 2,
            }}
          >
            {day.date}
          </Typography>

          {day.events.map((ev, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Box
                sx={{
                  position: "relative",
                  mb: 2,
                  pl: 4,
                }}
              >
                {/* Dot */}
                <Box
                  sx={{
                    position: "absolute",
                    left: -1,
                    top: 6,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#3fb6ff",
                    boxShadow: "0 0 10px rgba(63,182,255,0.6)",
                  }}
                />

                {/* Card */}
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.6)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.5)",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: 13,
                      fontWeight: 600,
                      mb: 0.5,
                    }}
                  >
                    {ev.feature}
                  </Typography>

                  <Typography
                    sx={{
                      fontSize: 11,
                      opacity: 0.6,
                      mb: 1,
                    }}
                  >
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </Typography>

                  <Typography
                    sx={{
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(ev.data, null, 2)}
                  </Typography>
                </Box>
              </Box>
            </motion.div>
          ))}
        </Box>
      ))}
    </Box>
  );
}
