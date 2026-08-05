import React from "react";
import { motion } from "framer-motion";
import {
  Box,
  Typography,
  Grid,
  Button,
  Chip
} from "@mui/material";
import {
  Medication,
  WarningAmberRounded
} from "@mui/icons-material";

export default function TreatmentPlanGenerator({
  plan,
  liquidGlass,
  cardVariants,
  onOpenPrescriptions,
  onOpenInvestigations
}) {
  if (!plan) return null;

  const { primaryPlan, avoid } = plan;

  return (
    <motion.div variants={cardVariants} initial="hidden" animate="visible">
      <Box sx={{ ...liquidGlass, p: 3, borderRadius: 3 }}>
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
          <Medication sx={{ color: "#0a88a7", fontSize: 28 }} />
          Treatment Plan Generator
        </Typography>

        {/* Action Buttons */}
        <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
          <Button
            variant="contained"
            startIcon={<Medication />}
            onClick={onOpenPrescriptions}
            sx={{
              background: "linear-gradient(135deg, #0ddcd5ff, #0a88a7ff, #04eb83ff)",
              textTransform: "none",
              borderRadius: 2
            }}
          >
            View Full Prescription
          </Button>

          <Button
            variant="outlined"
            onClick={onOpenInvestigations}
            sx={{
              textTransform: "none",
              borderRadius: 2,
              borderColor: "#667eea",
              color: "#667eea"
            }}
          >
            Investigation Orders
          </Button>
        </Box>

        <Grid container spacing={3}>
          {/* LEFT: Primary Plan */}
          <Grid item xs={12} md={8}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 600,
                mb: 2,
                color: "#0a88a7",
                fontSize: "1.1rem"
              }}
            >
              {primaryPlan.name}
            </Typography>

            <Typography
              variant="body2"
              sx={{
                mb: 3,
                fontStyle: "italic",
                opacity: 0.8,
                p: 1.5,
                bgcolor: "rgba(10,136,167,0.05)",
                borderRadius: 1
              }}
            >
              {primaryPlan.rationale}
            </Typography>

            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
              Medications
            </Typography>

            {primaryPlan.medications.map((med, idx) => (
              <Box
                key={idx}
                sx={{
                  mb: 2,
                  pl: 2,
                  borderLeft: med.doseAdjusted
                    ? "4px solid #ff9800"
                    : "4px solid #04eb83",
                  py: 0.5
                }}
              >
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {med.name}
                </Typography>

                {med.doseAdjusted && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#ff9800",
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      mt: 0.5
                    }}
                  >
                    <WarningAmberRounded fontSize="small" />
                    Dose adjusted: {med.reason}
                  </Typography>
                )}
              </Box>
            ))}
          </Grid>

          {/* RIGHT: Safety / Avoid */}
          <Grid item xs={12} md={4}>
            {/* Contraindications */}
            <Box
              sx={{
                p: 2.5,
                bgcolor: "rgba(255,107,107,0.05)",
                borderRadius: 2.5,
                mb: 2,
                border: "1px solid rgba(255,107,107,0.1)"
              }}
            >
              <Typography
                variant="subtitle2"
                sx={{
                  color: "#ff6b6b",
                  mb: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  fontWeight: 600
                }}
              >
                <WarningAmberRounded fontSize="small" />
                Contraindications Checked
              </Typography>

              {primaryPlan.contraindicationsChecked.map((check, idx) => (
                <Box
                  key={idx}
                  sx={{
                    mb: 2,
                    pb: 2,
                    borderBottom:
                      idx <
                      primaryPlan.contraindicationsChecked.length - 1
                        ? "1px solid rgba(0,0,0,0.05)"
                        : "none"
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {check.drug}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: "block", opacity: 0.7, mb: 0.5 }}
                  >
                    Issue: {check.issue}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: "block", color: "#04eb83", fontWeight: 500 }}
                  >
                    Mitigation: {check.mitigation}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Avoid */}
            <Box
              sx={{
                p: 2.5,
                bgcolor: "rgba(255,255,255,0.6)",
                borderRadius: 2.5,
                border: "1px solid rgba(0,0,0,0.05)"
              }}
            >
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                Avoid
              </Typography>

              {avoid.map((item, idx) => (
                <Box key={idx} sx={{ mb: 1.5, display: "flex", gap: 1 }}>
                  <Typography sx={{ color: "#ff6b6b", fontWeight: 700 }}>
                    ✗
                  </Typography>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {item.drug}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      {item.reason}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>
      </Box>
    </motion.div>
  );
}
