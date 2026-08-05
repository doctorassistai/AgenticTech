import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Box,
  Typography,
  LinearProgress,
  Collapse,
  Grid,
  Button
} from "@mui/material";
import { Biotech, ChevronRight } from "@mui/icons-material";

export default function DifferentialDiagnosisEngine({
  context = [],
  liquidGlass,
  cardVariants,
}) {
  const [selectedDifferential, setSelectedDifferential] = useState(null);

  if (!context.length) {
    return (
      <Box sx={{ ...liquidGlass, p: 3 }}>
        <Typography color="text.secondary">
          No differentials available
        </Typography>
      </Box>
    );
  }

  return (
    <motion.div variants={cardVariants} initial="hidden" animate="visible">
      <Box sx={{ ...liquidGlass, p: 3, borderRadius: 3 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 300, mb: 3, display: "flex", gap: 1.5 }}
        >
          <Biotech sx={{ color: "#764ba2" }} />
          Differential Diagnosis Engine
        </Typography>

        {context.map((diff, idx) => (
          <Box
            key={idx}
            sx={{
              mb: 2.5,
              p: 2.5,
              bgcolor: "rgba(255,255,255,0.6)",
              borderRadius: 2,
              cursor: "pointer",
              border:
                selectedDifferential === idx
                  ? "2px solid #764ba2"
                  : "1px solid rgba(0,0,0,0.05)",
            }}
            onClick={() =>
              setSelectedDifferential(
                selectedDifferential === idx ? null : idx
              )
            }
          >
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography sx={{ fontWeight: 600 }}>
                {diff.diagnosis}
              </Typography>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>
                  {diff.probability}%
                </Typography>
                <ChevronRight
                  sx={{
                    transform:
                      selectedDifferential === idx
                        ? "rotate(90deg)"
                        : "none",
                  }}
                />
              </Box>
            </Box>

            <LinearProgress
              variant="determinate"
              value={diff.probability}
              sx={{ mt: 1.5, height: 8, borderRadius: 4 }}
            />

            <Collapse in={selectedDifferential === idx}>
              <Box sx={{ mt: 3 }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="caption" fontWeight={600}>
                      SUPPORTING
                    </Typography>
                    {diff.supporting.map((s, i) => (
                      <Typography key={i} variant="body2">
                        • {s}
                      </Typography>
                    ))}
                  </Grid>

                  <Grid item xs={12} md={4}>
                    <Typography variant="caption" fontWeight={600}>
                      AGAINST
                    </Typography>
                    {diff.against.map((a, i) => (
                      <Typography key={i} variant="body2">
                        • {a}
                      </Typography>
                    ))}
                  </Grid>

                  <Grid item xs={12} md={4}>
                    <Typography variant="caption" fontWeight={600}>
                      WORKUP
                    </Typography>
                    <Typography variant="body2">
                      {diff.workup}
                    </Typography>
                    <Button size="small" sx={{ mt: 1 }}>
                      Order Tests
                    </Button>
                  </Grid>
                </Grid>
              </Box>
            </Collapse>
          </Box>
        ))}
      </Box>
    </motion.div>
  );
}
