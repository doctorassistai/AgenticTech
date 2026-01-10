import React from "react";
import { Card, CardContent, Grid, Typography } from "@mui/material";

// Refined Gradient (slightly cleaner saturation)
const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

export default function ProfileHeader({ data }) {
  if (!data) return null;

  return (
    <Card
      sx={{
        mb: 3,
        borderRadius: "24px",
        position: "relative",
        overflow: "hidden",

        /* 🧊 LIQUID GLASS BASE */
        background: "linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.3))",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",

        /* Premium Border & Shadow */
        border: "1px solid rgba(255, 255, 255, 0.4)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.04)",

        /* 🖋️ CLASSIC FONT SETTING */
        fontFamily: "'Inter', sans-serif",
        color: "#1a1a1a",
        transition: "transform 0.2s ease-in-out",
        "&:hover": {
          transform: "translateY(-2px)",
        }
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Grid container spacing={2}>
          {Object.entries(data).map(([key, value]) => (
            <Grid item xs={10} key={key}>
              {/* Label: Small, muted, and clean */}
              <Typography
                sx={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  mb: 1,
                  opacity: 0.6, // Muted labels look more professional
                  color: "#1a1a1a",
                }}
              >
                {key}
              </Typography>

              {/* Value: Sharp and legible */}
              <Typography
                sx={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "15px",
                  fontWeight: 50,
                  color: "#1a1a1a",
                  opacity: 0.8,
                  letterSpacing: "-0.01em", // Tighter tracking for Inter
                }}
              >
                {value || "—"}
              </Typography>
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
}