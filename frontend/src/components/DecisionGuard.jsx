import React from "react";
import { motion } from "framer-motion";
import {
  Box,
  Typography,
  Alert
} from "@mui/material";
import {
  Security
} from "@mui/icons-material";

export default function DecisionGuard({
  alerts = [],
  liquidGlass,
  cardVariants
}) {
  if (!alerts.length) return null;

  return (
    <motion.div variants={cardVariants} initial="hidden" animate="visible">
      <Box
        sx={{
          ...liquidGlass,
          p: 3,
          borderRadius: 3,
          borderTop: "5px solid #ff6b6b"
        }}
      >
        {/* Header */}
        <Typography
          variant="h5"
          sx={{
            fontWeight: 300,
            mb: 3,
            display: "flex",
            alignItems: "center",
            gap: 1.5
          }}
        >
          <Security sx={{ color: "#ff6b6b", fontSize: 26 }} />
          DecisionGuard
        </Typography>

        {/* Alerts */}
        {alerts.map((alert, idx) => (
          <Alert
            key={idx}
            severity={alert.severity}
            sx={{
              mb: 2,
              borderRadius: 2,
              "& .MuiAlert-message": { fontSize: "0.9rem" }
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, mb: 0.5 }}
            >
              {alert.title}
            </Typography>
            {alert.message}
          </Alert>
        ))}
      </Box>
    </motion.div>
  );
}
