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

export default function KeyValueTable({ title, data }) {
  const { rows, columns } = useMemo(() => {
    if (!data) return { rows: [], columns: [] };

    let rows = [];
    if (Array.isArray(data)) {
      if (typeof data[0] === "object") rows = data;
      else {
        rows = data.map((value, index) => ({
          "#": index + 1,
          Value: value
        }));
      }
    } else if (typeof data === "object") {
      rows = [data];
    }

    const columnSet = new Set();
    rows.forEach(row => Object.keys(row).forEach(key => columnSet.add(key)));

    return { rows, columns: Array.from(columnSet) };
  }, [data]);

  if (!rows.length) return null;

  const enableHorizontalScroll = columns.length > 4;

const renderValue = value => {
  if (value === null || value === undefined) {
    return <Typography sx={{ opacity: 0.5 }}>–</Typography>;
  }

  // Plain text
  if (typeof value === "string" || typeof value === "number") {
    return (
      <Typography sx={{ fontSize: "15px", lineHeight: 1.6 }}>
        {value}
      </Typography>
    );
  }

  // Arrays → BULLET POINTS (this is your medical text case)
  if (Array.isArray(value)) {
    return (
      <Box component="ul" sx={{ pl: 2, m: 0 }}>
        {value.map((v, idx) => (
          <Box
            key={idx}
            component="li"
            sx={{
              fontSize: "15px",
              lineHeight: 1.7,
              mb: 0.75
            }}
          >
            {renderValue(v)}
          </Box>
        ))}
      </Box>
    );
  }

  // Objects
  if (typeof value === "object") {
    return (
      <Box
        sx={{
          p: 1,
          borderRadius: "12px",
          border: "1px solid rgba(0,0,0,0.08)",
          background: "rgba(255,255,255,0.4)",
          mb: 1
        }}
      >
        {Object.entries(value).map(([k, v]) => (
          <Box key={k} sx={{ mb: 0.75 }}>
            <Typography
              component="span"
              sx={{ fontWeight: 700, mr: 1, fontSize: "15px" }}
            >
              {k}:
            </Typography>
            {renderValue(v)}
          </Box>
        ))}
      </Box>
    );
  }

  return String(value);
};

  return (
    <Card
      sx={{
        mb: 3,
        borderRadius: "24px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.3))",
        backdropFilter: "blur(30px) saturate(180%)",
        WebkitBackdropFilter: "blur(30px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.5)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: "#1d1d1f"
      }}
    >
      <CardContent>
        {title && (
          <Typography
            sx={{
              mb: 2.5,
              fontSize: "14px",
              fontWeight: 700,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              background: brandGradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}
          >
            {title}
          </Typography>
        )}

    <Box
  sx={{
    overflowX: "auto",
    maxWidth: "100%",
    WebkitOverflowScrolling: "touch",
            "&::-webkit-scrollbar": { height: 6 },
            "&::-webkit-scrollbar-thumb": {
              background: "rgba(0,0,0,0.25)",
              borderRadius: 4
            }
          }}
        >
          <Table
  size="small"
  sx={{
    minWidth: columns.length * 240,   // ⬅️ wider columns
    tableLayout: "fixed"              // ⬅️ stable layout
  }}
>

            <TableHead>
              <TableRow>
                {columns.map(col => (
                  <TableCell
                    key={col}
                    sx={{
                      fontSize: "15px",
  color: "#1a1a1a",
  borderBottom: "1px solid rgba(0,0,0,0.04)",
  verticalAlign: "middle",
  textAlign: "left",
  whiteSpace: "nowrap"
                    }}
                  >
                    {col}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>

            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {columns.map(col => (
                    <TableCell
                      key={`${rowIndex}-${col}`}
                     sx={{
  fontSize: "15px",
  color: "#1a1a1a",
  borderBottom: "1px solid rgba(0,0,0,0.04)",
  verticalAlign: "middle",
  textAlign: "left"
}}

                    >
                      {renderValue(row[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  );
}
