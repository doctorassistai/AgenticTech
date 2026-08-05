import React from "react";
import {
  Box,
  Typography,
  Grid,
  Chip,
  Alert
} from "@mui/material";
import {
  Psychology,
  CheckCircle,
  WarningAmberRounded,
  ErrorOutline
} from "@mui/icons-material";
import { motion } from "framer-motion";

/* ---------- Confidence Badge ---------- */
const ConfidenceBadge = ({ level }) => {
  const config = {
    high: { bg: "rgba(107,207,127,0.15)", color: "#6bcf7f" },
    moderate: { bg: "rgba(255,193,7,0.15)", color: "#ffd93d" },
    low: { bg: "rgba(255,107,107,0.15)", color: "#ff6b6b" }
  };

  const c = config[level] || config.low;

  return (
    <Chip
      size="small"
      label={`${level.charAt(0).toUpperCase() + level.slice(1)} Confidence`}
      sx={{
        background: c.bg,
        color: c.color,
        fontWeight: 500,
        fontSize: "0.75rem"
      }}
    />
  );
};

/* ---------- Main Component ---------- */
export default function ClinicalContextAssembly({
  context,
  liquidGlass,
  cardVariants
}) {
  if (!context) return null;

  const {
    verifiedFacts,
    unknowns,
    contradictions,
    synthesis,
    confidence
  } = context;

  return (
    <motion.div variants={cardVariants} initial="hidden" animate="visible">
      <Box sx={{ ...liquidGlass, p: 3, borderRadius: 3 }}>
        {/* Header */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
          <Typography
            variant="h5"
            sx={{ fontWeight: 300, display: "flex", alignItems: "center", gap: 1.5 }}
          >
            <Psychology sx={{ color: "#667eea", fontSize: 28 }} />
            Clinical Context Assembly
          </Typography>
          <ConfidenceBadge level={confidence} />
        </Box>

        <Grid container spacing={3}>
          {/* VERIFIED FACTS */}
          <Grid item xs={12} md={6}>
            <Typography
              variant="subtitle2"
              sx={{ mb: 2, color: "#04eb83", fontWeight: 600 }}
            >
              <CheckCircle fontSize="small" /> Verified Facts
            </Typography>

            <Box sx={{ pl: 2, borderLeft: "3px solid #04eb83" }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Chief Complaint
              </Typography>
              <Typography sx={{ mb: 2 }}>
                {verifiedFacts.chiefComplaint}
              </Typography>

              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                Vitals
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
                {Object.entries(verifiedFacts.vitals).map(([k, v]) => (
                  <Chip
                    key={k}
                    size="small"
                    label={`${k}: ${v}`}
                    sx={{ bgcolor: "rgba(4,235,131,0.1)", fontSize: "0.75rem" }}
                  />
                ))}
              </Box>

              {verifiedFacts.keyFindings.map((f, i) => (
                <Typography
                  key={i}
                  variant="body2"
                  sx={{ mb: 1, pl: 1, borderLeft: "2px solid rgba(4,235,131,0.3)" }}
                >
                  {f}
                </Typography>
              ))}
            </Box>
          </Grid>

          {/* UNKNOWNS & CONTRADICTIONS */}
          <Grid item xs={12} md={6}>
            <Typography
              variant="subtitle2"
              sx={{ mb: 2, color: "#ff9800", fontWeight: 600 }}
            >
              <WarningAmberRounded fontSize="small" /> Unknowns / Missing Data
            </Typography>

            <Box sx={{ pl: 2, borderLeft: "3px solid #ff9800", mb: 3 }}>
              {unknowns.map((u, i) => (
                <Typography key={i} sx={{ mb: 1 }}>
                  • {u}
                </Typography>
              ))}
            </Box>

            {contradictions?.length > 0 && (
              <>
                <Typography
                  variant="subtitle2"
                  sx={{ mb: 2, color: "#ff6b6b", fontWeight: 600 }}
                >
                  <ErrorOutline fontSize="small" /> Contradictions Detected
                </Typography>

                <Box sx={{ pl: 2, borderLeft: "3px solid #ff6b6b" }}>
                  {contradictions.map((c, i) => (
                    <Typography key={i} sx={{ color: "#ff6b6b", mb: 1 }}>
                      • {c}
                    </Typography>
                  ))}
                </Box>
              </>
            )}
          </Grid>
        </Grid>

        {/* AI SYNTHESIS */}
        <Box
          sx={{
            mt: 3,
            p: 2.5,
            bgcolor: "rgba(102,126,234,0.05)",
            borderRadius: 2,
            border: "1px solid rgba(102,126,234,0.1)"
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 600, mb: 1, color: "#667eea" }}
          >
            AI Synthesis
          </Typography>
          <Typography sx={{ lineHeight: 1.6 }}>
            {synthesis}
          </Typography>
        </Box>
      </Box>
    </motion.div>
  );
}
