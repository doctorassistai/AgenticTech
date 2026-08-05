import React, { useMemo } from "react";
import {
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Box,
  Divider,
} from "@mui/material";

const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

/**
 * MedicalKeyValueCard
 * - Perfect for discharge summaries, recommendations, vitals, labs
 * - Key-value layout, nested objects/arrays handled
 * - Scrollable if many keys
 */
export default function MedicalKeyValueCard({ title, data, maxHeight = 400 }) {
  const rows = useMemo(() => {
    if (!data || typeof data !== "object") return [];
    return Object.entries(data).map(([key, value]) => ({
      label: key.replace(/_/g, " "),
      value,
    }));
  }, [data]);

  if (!rows.length) return null;

  const renderValue = (value) => {
    if (value === null || value === undefined)
      return <Typography opacity={0.5}>–</Typography>;

    if (typeof value === "string" || typeof value === "number")
      return (
        <Typography sx={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {value}
        </Typography>
      );

    if (Array.isArray(value))
      return (
        <Box>
          {value.map((item, idx) => (
            <Box
              key={idx}
              sx={{
                mb: 1,
                p: 1.5,
                borderRadius: "14px",
                background: "rgba(255,255,255,0.55)",
                border: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              {renderValue(item)}
            </Box>
          ))}
        </Box>
      );

    if (typeof value === "object")
      return (
        <Box sx={{ ml: 1 }}>
          {Object.entries(value).map(([k, v]) => (
            <Box key={k} sx={{ mb: 1 }}>
              <Typography
                component="span"
                fontWeight={700}
                sx={{ mr: 0.5, fontSize: 13 }}
              >
                {k.replace(/_/g, " ")}:
              </Typography>
              {renderValue(v)}
            </Box>
          ))}
        </Box>
      );

    return String(value);
  };

  return (
    <Card
      sx={{
        mb: 3,
        borderRadius: "24px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.35))",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.06)",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}
    >
      <CardContent sx={{ p: 3 }}>
        {title && (
          <>
            <Typography
              sx={{
                mb: 2,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                background: brandGradient,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {title}
            </Typography>
            <Divider sx={{ mb: 2 }} />
          </>
        )}

        <Box sx={{ maxHeight: maxHeight, overflowY: "auto" }}>
          <Table size="small">
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  {/* LEFT COLUMN (LABEL) */}
                  <TableCell
                    sx={{
                      width: "28%",
                      verticalAlign: "top",
                      fontWeight: 700,
                      fontSize: 14,
                      color: "rgba(0,0,0,0.7)",
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                      pr: 2,
                    }}
                  >
                    {row.label}
                  </TableCell>

                  {/* RIGHT COLUMN (CONTENT) */}
                  <TableCell
                    sx={{
                      verticalAlign: "top",
                      fontSize: 14,
                      lineHeight: 1.8,
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    {renderValue(row.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  );
}
