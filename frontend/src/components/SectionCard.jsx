import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Typography,
  Collapse,
  Box
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";

const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

export default function SectionCard({
  title,
  children,
  data,
  defaultExpanded = true
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const renderValue = (value, level = 0) => {
    /* Primitive values (string, number, boolean) */
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const displayValue = String(value);
// Force double quotes for strings
      return (
        <Typography
          sx={{
            fontSize: "14.5px",
            lineHeight: 1.7,
            fontFamily: "'Inter', sans-serif",
            color: "#1d1d1f",
            mb: 0.5,
          }}
        >
          {displayValue}
        </Typography>
      );
    }

    /* Arrays */
    if (Array.isArray(value)) {
      return (
        <Box
          sx={{
            pl: level > 0 ? 2 : 0,
            borderLeft: level > 0 ? "1px solid rgba(0,0,0,0.05)" : "none",
            mt: 1,
          }}
        >
          {value.map((item, index) => (
            <Box key={index} sx={{ mb: 1.5 }}>
              {renderValue(item, level + 1)}
            </Box>
          ))}
        </Box>
      );
    }

    /* Objects */
    if (typeof value === "object" && value !== null) {
      return (
        <Box
          sx={{
            pl: level > 0 ? 2 : 0,
            borderLeft: level > 0 ? "1px solid rgba(0,0,0,0.05)" : "none",
          }}
        >
          {Object.entries(value).map(([key, val]) => (
            <Box key={key} sx={{ mb: 2.2, pt: 0.5 }}>
              {/* KEY */}
              <Typography
                sx={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontFamily: "'Inter', sans-serif",
                  background: brandGradient,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  mb: 0.8,
                }}
              >
                {key}
              </Typography>

              {/* VALUE */}
              <Box sx={{ pl: 0.5 }}>{renderValue(val, level + 1)}</Box>
            </Box>
          ))}
        </Box>
      );
    }

    return null;
  };

  return (
    <Card
      sx={{
        mb: 3,
        borderRadius: "24px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.4))",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.5)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.04)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <CardHeader
        sx={{ p: 2.5 }}
        title={
          <Typography
            sx={{
              fontSize: "17px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "#1a1a1a",
            }}
          >
            {title}
          </Typography>
        }
        action={
          <IconButton
            onClick={() => setExpanded((prev) => !prev)}
            sx={{
              background: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(0,0,0,0.06)",
              width: 32,
              height: 32,
              transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 0.2s ease",
              cursor: "pointer",
            }}
          >
            <ExpandMore fontSize="small" />
          </IconButton>
        }
      />

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <CardContent sx={{ pt: 0, px: 2.5, pb: 2.5 }}>
          {children ? (
            children
          ) : data ? (
            <Box sx={{ mt: 1 }}>{renderValue(data)}</Box>
          ) : (
            <Typography sx={{ fontSize: "13px", color: "#666" }}>
              No data available
            </Typography>
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
}
