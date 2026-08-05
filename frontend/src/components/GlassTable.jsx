import React, { useMemo } from "react";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  createTheme,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from "@mui/material";

/* ================================
   🎨 Clinical Brand Colors
================================ */
const brandPrimary = "#1ccfc9";
const brandSecondary = "#3fb6ff";

const brandGradient =
  "linear-gradient(90deg, #1ccfc9 0%, #3fb6ff 100%)";

/* ================================
   🌐 Global Theme
================================ */
const theme = createTheme({
  typography: {
    fontFamily: "'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 600
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background:
            "linear-gradient(180deg, #eaf7f8 0%, #f3fbfd 55%, #ffffff 100%)",
          minHeight: "100vh"
        }
      }
    }
  }
});

export default function GlassTablePage({ title, data, maxHeight = 520 }) {
  const { rows, columns } = useMemo(() => {
    if (!data) return { rows: [], columns: [] };

    let rows = [];

    if (Array.isArray(data)) {
      if (typeof data[0] === "object") rows = data;
      else rows = data.map((v, i) => ({ "#": i + 1, Value: v }));
    } else if (
      typeof data === "object" &&
      Object.values(data).every(
        v => Array.isArray(v) && v.length === Object.values(data)[0].length
      )
    ) {
      const keys = Object.keys(data);
      rows = Array.from({ length: data[keys[0]].length }).map((_, i) =>
        keys.reduce((acc, k) => ({ ...acc, [k]: data[k][i] }), {})
      );
    } else if (typeof data === "object") {
      rows = [data];
    }

    const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
    return { rows, columns };
  }, [data]);

  const renderValue = value => {
    if (value == null)
      return <Typography sx={{ opacity: 0.5 }}>–</Typography>;

    if (typeof value === "string" || typeof value === "number")
      return <Typography sx={{ fontSize: 14 }}>{value}</Typography>;

    if (Array.isArray(value))
      return (
        <Box component="ul" sx={{ pl: 2, m: 0 }}>
          {value.map((v, i) => (
            <li key={i}>{renderValue(v)}</li>
          ))}
        </Box>
      );

    if (typeof value === "object")
      return (
        <Box
          sx={{
            p: 1.4,
            borderRadius: "12px",
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.12)",
            mb: 1
          }}
        >
          {Object.entries(value).map(([k, v]) => (
            <Box key={k} sx={{ mb: 0.6 }}>
              <Typography component="span" sx={{ fontWeight: 600, mr: 0.5 }}>
                {k}:
              </Typography>
              {renderValue(v)}
            </Box>
          ))}
        </Box>
      );

    return String(value);
  };

  if (!rows.length) return null;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Box sx={{ px: { xs: 2, md: 6 }, pt: 4, pb: 6 }}>
        <Box
          sx={{
            borderRadius: "28px",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7))",
            backdropFilter: "blur(32px)",
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 28px 70px rgba(15,47,51,0.14)",
            p: { xs: 2, md: 4 }
          }}
        >
          {title && (
            <Box sx={{ mb: 3 }}>
              <Typography sx={{ fontSize: 19, fontWeight: 700 }}>
                {title}
              </Typography>
              <Typography sx={{ fontSize: 13, opacity: 0.65, mt: 0.5 }}>
                Structured clinical data overview
              </Typography>
              <Box
                sx={{
                  mt: 1,
                  height: 3,
                  width: 72,
                  borderRadius: 2,
                  background: brandGradient
                }}
              />
            </Box>
          )}

          <Box
            sx={{
              maxHeight,
              overflow: "auto",
              borderRadius: "16px",
              background: "#ffffff",
              border: "1px solid rgba(0,0,0,0.15)",

              /* ===== STANDARD SCROLLBAR ===== */
              scrollbarWidth: "auto",        // Firefox
              scrollbarColor: "auto",

              "&::-webkit-scrollbar": {
                width: "14px",
                height: "14px"
              },
              "&::-webkit-scrollbar-track": {
                background: "#f1f1f1"
              },
              "&::-webkit-scrollbar-thumb": {
                backgroundColor: "#b5b5b5",
                borderRadius: "8px",
                border: "3px solid #f1f1f1"
              },
              "&::-webkit-scrollbar-thumb:hover": {
                backgroundColor: "#9e9e9e"
              }
            }}
          >

            <Table stickyHeader size="medium">
              {/* ================= HEADER ================= */}
              <TableHead>
                <TableRow>
                  {columns.map(col => (
                    <TableCell
                      key={col}
                      sx={{
                        fontSize: 13,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        background: "#f1f9fb",
                        borderBottom: "2px solid rgba(0,0,0,0.2)",
                        borderRight: "1px solid rgba(0,0,0,0.15)",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {col}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>

              {/* ================= BODY ================= */}
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow
                    key={i}
                    sx={{
                      background:
                        i % 2 === 0 ? "#ffffff" : "rgba(28,207,201,0.04)"
                    }}
                  >
                    {columns.map(col => (
                      <TableCell
                        key={col}
                        sx={{
                          fontSize: 14,
                          py: 1.8,
                          px: 1.6,
                          verticalAlign: "top",
                          borderBottom: "1px solid rgba(0,0,0,0.12)",
                          borderRight: "1px solid rgba(0,0,0,0.12)",
                          lineHeight: 1.7
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
        </Box>
      </Box>
    </ThemeProvider>
  );
}
