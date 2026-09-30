// ReportDialog.jsx — the full report of one completed investigation, in a subwindow.
//
// Opened by the Report column's View button in the Case Registry history tables.
// The stored text is markdown (see shared/reportMarkdown.js) and runs to
// thousands of characters, so a table cell can only carry a preview; the whole
// report is rendered here with its headings, bullets and tables intact.
//
// Read-only and presentational: it holds no case state and performs no fetch.

import React, { useMemo } from "react";
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, IconButton,
  Table, TableHead, TableBody, TableRow, TableCell,
} from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL } from "../shared/designTokens";
import { parseReportMarkdown } from "./shared/reportMarkdown";

const bodySx = { fontFamily: FONT, fontSize: 12.5, color: C.textPrimary };

const reportThSx = {
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: FW_NORMAL,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.textSecond,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
};

const reportTdSx = {
  fontFamily: FONT,
  fontSize: 12,
  color: C.textPrimary,
  verticalAlign: "top",
  borderBottom: `1px solid ${C.border}`,
};

function ReportBlock({ block }) {
  if (block.type === "rule") {
    return <Box sx={{ borderTop: `1px solid ${C.border}`, my: 2 }} />;
  }

  if (block.type === "heading") {
    return (
      <Typography
        sx={{
          fontFamily: FONT,
          fontSize: block.level <= 2 ? 12.5 : 11,
          fontWeight: FW_NORMAL,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: C.textPrimary,
          mt: 2,
          mb: 0.75,
        }}
      >
        {block.text}
      </Typography>
    );
  }

  if (block.type === "list") {
    return (
      <Box sx={{ mb: 1.25 }}>
        {block.items.map((item, index) => (
          <Box key={index} sx={{ display: "flex", gap: 1, mb: 0.35 }}>
            <Typography sx={{ ...bodySx, color: C.textMuted }}>•</Typography>
            <Typography sx={bodySx}>{item}</Typography>
          </Box>
        ))}
      </Box>
    );
  }

  if (block.type === "table") {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, mb: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {block.head.map((cell, index) => (
                <TableCell key={index} sx={reportThSx}>{cell}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {block.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, index) => (
                  <TableCell key={index} sx={reportTdSx}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    );
  }

  return (
    <Typography sx={{ ...bodySx, whiteSpace: "pre-line", mb: 1.25 }}>
      {block.lines.join("\n")}
    </Typography>
  );
}

export default function ReportDialog({ open, title, subtitle, markdown, onClose }) {
  const blocks = useMemo(() => parseReportMarkdown(markdown), [markdown]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: C.bgSecondary,
          borderBottom: `1px solid ${C.border}`,
          py: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: C.textMuted, fontFamily: FONT }}>
            {subtitle || "Report"}
          </Typography>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 18, color: C.textPrimary }}>
            {title || "Investigation Report"}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: C.textSecond }}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 3, py: 2.5, background: C.white }}>
        {blocks.length === 0 ? (
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
            No report text was stored for this investigation.
          </Typography>
        ) : blocks.map((block, index) => (
          <ReportBlock key={index} block={block} />
        ))}
      </DialogContent>
    </Dialog>
  );
}
