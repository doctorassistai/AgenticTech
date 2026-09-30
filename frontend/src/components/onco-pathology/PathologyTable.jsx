// PathologyTable.jsx — compact, click-to-select table for the pathology module.
//
// The laboratory inventories (specimens, blocks, slides, requests, returned
// ancillary work) are lists of real physical items, so they are shown as tables
// the user picks a row from rather than as dropdowns. Selecting a row is how the
// forms below are targeted.
//
// Presentational only: it holds no state and performs no fetch. `columns[].render`
// may return a node (e.g. an action button) — wrap any nested click handler in
// event.stopPropagation() so it does not also select the row.

import React from "react";
import { Box, Typography } from "@mui/material";
import { C, FONT, FW_LIGHT, FW_NORMAL } from "../shared/designTokens";

export default function PathologyTable({
  columns = [],
  rows = [],
  selectedId = "",
  onSelect,
  rowId = (row) => row.id,
  emptyMessage = "Nothing to show yet.",
  maxHeight,
}) {
  const template = columns.map((column) => column.width || "1fr").join(" ");

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.white }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: template,
          gap: 1.5,
          px: 1.5,
          py: 1,
          background: C.bgSecondary,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {columns.map((column) => (
          <Typography
            key={column.key}
            sx={{
              fontFamily: FONT,
              fontSize: 10,
              fontWeight: FW_NORMAL,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: C.textSecond,
              textAlign: column.align || "left",
            }}
          >
            {column.label}
          </Typography>
        ))}
      </Box>

      <Box sx={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        {rows.length === 0 && (
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted, px: 1.5, py: 1.5 }}>
            {emptyMessage}
          </Typography>
        )}

        {rows.map((row) => {
          const id = rowId(row);
          const selected = !!selectedId && id === selectedId;
          return (
            <Box
              key={id}
              onClick={onSelect ? () => onSelect(id, row) : undefined}
              sx={{
                display: "grid",
                gridTemplateColumns: template,
                gap: 1.5,
                alignItems: "center",
                px: 1.5,
                py: 1,
                borderTop: `1px solid ${C.border}`,
                borderLeft: selected ? `3px solid ${C.black}` : "3px solid transparent",
                background: selected ? C.bgTertiary : C.white,
                cursor: onSelect ? "pointer" : "default",
                transition: "background 0.15s",
                "&:hover": onSelect ? { background: selected ? C.bgTertiary : C.bgSecondary } : undefined,
              }}
            >
              {columns.map((column) => {
                const content = column.render ? column.render(row) : row[column.key];
                return (
                  <Box key={column.key} sx={{ minWidth: 0, textAlign: column.align || "left" }}>
                    {typeof content === "string" || typeof content === "number" || content == null ? (
                      <Typography
                        sx={{
                          fontFamily: FONT,
                          fontSize: 12,
                          fontWeight: selected ? FW_NORMAL : FW_LIGHT,
                          color: column.muted ? C.textSecond : C.textPrimary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {content === "" || content == null ? "—" : content}
                      </Typography>
                    ) : (
                      content
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
