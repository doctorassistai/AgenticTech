// tabs/genomics/fields.jsx — shared presentational helpers for the genomics panels
//
// Extracted so the four panels read as clinical content rather than layout, and
// so a field's spacing or a severity fill can only be changed in one place.
// No state, no data — these are pure wrappers over the house design tokens.

import React from "react";
import { Box, Typography, TextField, IconButton } from "@mui/material";
import { DeleteOutlineRounded } from "@mui/icons-material";
import { C, FONT, inputSx } from "../../../shared/designTokens";
import { FieldLabel, Sel } from "../../../shared/FormComponents";

// The three-state answer used by every QC field. "Not recorded" is distinct from
// "No" — a QC step that was never run is not the same as one that failed.
export const YES_NO = ["Yes", "No", "Not recorded"];

export const Grid = ({ cols = 2, children }) => (
  <Box
    sx={{
      display: "grid",
      gridTemplateColumns: { xs: "1fr", md: `repeat(${cols}, 1fr)` },
      gap: 1.5,
    }}
  >
    {children}
  </Box>
);

export const Txt = ({ label, value, onChange, placeholder, type }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      size="small"
      fullWidth
      sx={inputSx}
      type={type || "text"}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      InputLabelProps={type === "datetime-local" ? { shrink: true } : undefined}
    />
  </Box>
);

export const SelF = ({ label, options, value, onChange }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <Sel label={label} options={options} value={value} onChange={onChange} />
  </Box>
);

// Section heading inside a panel. Sentence-free and uppercase, matching the
// section bands used across the module.
export const Block = ({ children }) => (
  <Typography
    sx={{
      fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase",
      letterSpacing: "0.08em", mb: 1, mt: 2.5,
    }}
  >
    {children}
  </Typography>
);

// The state colour. The clinical palette is black/white/grey by design, and this
// is not a colour scheme — it marks a STATE that must not be skimmed past: this
// entry collides with something already on file for the patient. Kept local
// rather than added to C so the shared token map stays the palette it says it is;
// the recording button in Tab 16 already uses the same value for the same reason.
export const FLAG_COLOR = "#cf1322";

// A removable row card — the same shape the NAAT orders use in Tab 8. `flagged`
// draws the collision border without changing the card's structure.
export const RowCard = ({ onRemove, flagged, children }) => (
  <Box sx={{ border: `1px solid ${flagged ? FLAG_COLOR : C.border}`, background: C.bgTertiary, p: 1.5, mb: 1.5 }}>
    <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
      <IconButton size="small" onClick={onRemove} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}>
        <DeleteOutlineRounded fontSize="small" />
      </IconButton>
    </Box>
    {children}
  </Box>
);

// TB classification severity. Shown by FILL, not hue — the module's design
// system is black/white/grey only, so severity has to read without colour.
// Plain susceptibility is the quiet outline; XDR is the filled black box.
export const classificationFill = (cls) => {
  if (cls === "XDR-TB") return { background: C.black, color: C.white, border: `1px solid ${C.black}` };
  if (cls === "pre-XDR-TB" || cls === "MDR-TB") {
    return { background: C.textPrimary, color: C.white, border: `1px solid ${C.textPrimary}` };
  }
  if (cls === "RR-TB") return { background: C.bgSecondary, color: C.textPrimary, border: `1px solid ${C.black}` };
  return { background: "transparent", color: C.textSecond, border: `1px solid ${C.border}` };
};

// A comma-separated text field backed by a string array. Used for the free lists
// (drug targets, mutations) where the vocabulary is too open to enumerate.
export const ListField = ({ label, value, onChange, placeholder }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      size="small"
      fullWidth
      sx={inputSx}
      placeholder={placeholder}
      value={(value || []).join(", ")}
      onChange={(e) =>
        onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
      }
    />
  </Box>
);
