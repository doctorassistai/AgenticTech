import React from "react";
import { motion } from "framer-motion";
import {
  Box,
  Typography,
  Chip,
  Divider
} from "@mui/material";
import {
  Assessment,
  AccessTime
} from "@mui/icons-material";

export default function Prognosis({
  prognosis,
  liquidGlass,
  cardVariants
}) {
  if (!prognosis) return null;

  const outlookColor =
    prognosis.shortTerm.outlook === "Guarded"
      ? "#ffd93d"
      : "#6bcf7f";

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
          <Assessment sx={{ color: "#764ba2", fontSize: 26 }} />
          Prognosis & Outcomes
        </Typography>

        {/* Short Term */}
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="subtitle2"
            sx={{ mb: 2, fontWeight: 600, opacity: 0.7 }}
          >
            SHORT-TERM OUTLOOK
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
            <Typography
              variant="h4"
              sx={{ color: outlookColor, fontWeight: 300 }}
            >
              {prognosis.shortTerm.outlook}
            </Typography>
            <Chip
              size="small"
              label={prognosis.shortTerm.mortalityRisk}
              color="error"
              variant="outlined"
            />
          </Box>

          <Typography
            variant="body2"
            sx={{ mb: 2, opacity: 0.85 }}
          >
            {prognosis.shortTerm.likelyCourse}
          </Typography>

          {/* Milestones */}
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              display: "block",
              mt: 2,
              mb: 1.5,
              opacity: 0.7
            }}
          >
            RECOVERY MILESTONES
          </Typography>

          {prognosis.shortTerm.milestones.map((milestone, idx) => (
            <Box
              key={idx}
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1.5,
                mb: 1.5,
                p: 1.5,
                bgcolor: "rgba(255,255,255,0.4)",
                borderRadius: 1.5
              }}
            >
              <AccessTime fontSize="small" sx={{ opacity: 0.5, mt: 0.3 }} />
              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, display: "block" }}
                >
                  {milestone.time} Goal
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontSize: "0.85rem", opacity: 0.9 }}
                >
                  {milestone.goal}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        <Divider sx={{ my: 2, opacity: 0.2 }} />

        {/* Modifiable Factors */}
        <Typography
          variant="subtitle2"
          sx={{ mb: 2, fontWeight: 600, opacity: 0.7 }}
        >
          MODIFIABLE FACTORS
        </Typography>

        <Typography
          variant="caption"
          sx={{
            color: "#04eb83",
            fontWeight: 600,
            display: "block",
            mb: 1
          }}
        >
          WILL IMPROVE OUTCOME
        </Typography>

        {prognosis.modifiableFactors.improve.map((item, idx) => (
          <Typography
            key={idx}
            variant="body2"
            sx={{
              fontSize: "0.85rem",
              mb: 0.75,
              pl: 1.5,
              borderLeft: "2px solid #04eb83"
            }}
          >
            {item}
          </Typography>
        ))}
      </Box>
    </motion.div>
  );
}
