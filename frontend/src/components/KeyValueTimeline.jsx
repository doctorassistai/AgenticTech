import React from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip
} from "@mui/material";

const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

/**
 * KeyValueTimeline
 * ------------------------------------
 * Universal medical timeline renderer
 *
 * ✔ Handles any key-value JSON
 * ✔ Date / step based
 * ✔ Discharge summary ready
 */

export default function KeyValueTimeline({ title, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <Card
      sx={{
        mb: 3,
        borderRadius: "24px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.35))",
        backdropFilter: "blur(22px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.5)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
        fontFamily: "'Inter', sans-serif"
      }}
    >
      <CardContent>
        {title && (
          <Typography
            sx={{
              mb: 2,
              fontSize: "14px",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              background: brandGradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}
          >
            {title}
          </Typography>
        )}

        <Box sx={{ position: "relative", pl: 3 }}>
          {/* Vertical line */}
          <Box
            sx={{
              position: "absolute",
              left: 12,
              top: 0,
              bottom: 0,
              width: "2px",
              background: "linear-gradient(to bottom, #3fb6ff, #1ccfc9)",
              opacity: 0.4
            }}
          />

          {items.map((item, index) => (
            <TimelineItem key={index} item={item} isLast={index === items.length - 1} />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

/* ================================================= */
/* ================= TIMELINE ITEM ================= */
/* ================================================= */

function TimelineItem({ item }) {
  const { time, label, data } = item;

  return (
    <Box sx={{ display: "flex", mb: 3, position: "relative" }}>
      {/* Dot */}
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: brandGradient,
          position: "absolute",
          left: -6,
          top: 6,
          boxShadow: "0 0 0 6px rgba(63,182,255,0.15)"
        }}
      />

      <Box sx={{ ml: 3 }}>
        {/* Time / Label */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          {time && (
            <Chip
              label={time}
              size="small"
              sx={{
                fontSize: "10px",
                height: 18,
                background: "rgba(63,182,255,0.15)",
                borderRadius: "6px"
              }}
            />
          )}
          {label && (
            <Typography sx={{ fontSize: "13px", fontWeight: 600 }}>
              {label}
            </Typography>
          )}
        </Box>

        {/* Key-Value Content */}
        <Box sx={{ pl: 0.5 }}>
          {renderKeyValues(data)}
        </Box>
      </Box>
    </Box>
  );
}

/* ================================================= */
/* ================= RENDER HELPERS ================= */
/* ================================================= */

function renderKeyValues(data) {
  if (!data) return null;

  if (typeof data !== "object") {
    return (
      <Typography sx={{ fontSize: "13px", opacity: 0.8 }}>
        {String(data)}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "grid", rowGap: 0.4 }}>
      {Object.entries(data).map(([key, value]) => (
        <Box
          key={key}
          sx={{
            display: "flex",
            gap: 1,
            fontSize: "13px"
          }}
        >
          <Typography sx={{ fontWeight: 600, minWidth: 120 }}>
            {key}:
          </Typography>
          <Typography sx={{ opacity: 0.85 }}>
            {String(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
