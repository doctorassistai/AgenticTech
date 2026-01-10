import React, { useMemo } from "react";
import {
  Card,
  CardContent,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Box
} from "@mui/material";

const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

export default function InsightTable({ title, data }) {
  const { rows, columns } = useMemo(() => {
    if (!data) return { rows: [], columns: [] };

    let rows = [];
    if (Array.isArray(data)) rows = data;
    else rows = [data];

    const columnSet = new Set();
    rows.forEach(row => Object.keys(row).forEach(key => columnSet.add(key)));

    return { rows, columns: Array.from(columnSet) };
  }, [data]);

  if (!rows.length) return null;

  return (
    <Card
      sx={{
        mb: 3,
        borderRadius: "22px",
        background: "rgba(255,255,255,0.35)",
        backdropFilter: "blur(28px) saturate(150%)",
        WebkitBackdropFilter: "blur(28px) saturate(150%)",
        border: "1px solid rgba(255,255,255,0.45)",
        boxShadow: "0 10px 34px rgba(0,0,0,0.06)",
        fontFamily: "'Inter', sans-serif"
      }}
    >
      <CardContent sx={{ p: 3 }}>
        {title && (
          <Typography
            sx={{
              mb: 2,
              fontSize: "15px",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background: brandGradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}
          >
            {title}
          </Typography>
        )}

        <Table size="small" sx={{ tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              {columns.map(col => (
                <TableCell
                  key={col}
                  sx={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "rgba(0,0,0,0.55)",
                    borderBottom: "1px solid rgba(0,0,0,0.08)"
                  }}
                >
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx} hover>
                {columns.map(col => (
                  <TableCell
                    key={col}
                    sx={{
                      fontSize: "14px",
                      color: "#1a1a1a",
                      borderBottom: "1px solid rgba(0,0,0,0.05)",
                      py: 1.4
                    }}
                  >
                    {row[col] ?? "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
