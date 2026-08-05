// shared/FormComponents.jsx — Unified reusable form components
// Replaces duplicated components from both OTRecord.jsx and SurgicalOncologyWorkflow.jsx
// Uses MUI consistently for a unified look.

import React from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, FormGroup, RadioGroup, Radio,
} from "@mui/material";
import { C, FONT, FW_LIGHT, FW_NORMAL, inputSx, fieldLabelSx, flagNoteSx, sectionHeaderSx } from "./designTokens";

// ─── SectionBox ──────────────────────────────────────────────────────────────
// A bordered section with an uppercase header bar.
export const SectionBox = ({ title, children, style = {} }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2.5, ...style }}>
    <Box sx={sectionHeaderSx}>{title}</Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

// ─── FG (Field Grid) ─────────────────────────────────────────────────────────
// CSS grid wrapper for form fields.
export const FG = ({ children, cols = 3 }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2, mb: 1.5 }}>
    {children}
  </Box>
);

// ─── FieldLabel ──────────────────────────────────────────────────────────────
export const FieldLabel = ({ children }) => (
  <Typography sx={fieldLabelSx}>{children}</Typography>
);

// ─── FlagNote ────────────────────────────────────────────────────────────────
export const FlagNote = ({ children }) => (
  <Typography sx={flagNoteSx}>{children}</Typography>
);

// ─── ROInput (Read-Only Input) ───────────────────────────────────────────────
export const ROInput = ({ label, value }) => (
  <TextField
    label={label}
    value={value || ""}
    size="small"
    InputProps={{ readOnly: true }}
    sx={inputSx}
    fullWidth
    placeholder="Auto-populated"
  />
);

// ─── Sel (Select Dropdown — MUI version) ─────────────────────────────────────
// Supports options as strings OR { value, label } objects.
export const Sel = ({ label, options, value, onChange, minWidth, fullWidth = true, ...rest }) => (
  <FormControl size="small" fullWidth={fullWidth} sx={{ ...inputSx, ...(minWidth ? { minWidth } : {}) }}>
    <InputLabel>{label}</InputLabel>
    <Select label={label} value={value || ""} onChange={e => onChange(e.target.value)} {...rest}>
      {options.map(o => {
        const v = typeof o === "object" ? o.value : o;
        const l = typeof o === "object" ? o.label : o;
        return <MenuItem key={v} value={v} sx={{ fontFamily: FONT, fontSize: 13 }}>{l}</MenuItem>;
      })}
    </Select>
  </FormControl>
);

// ─── SelectInput (Select Dropdown — native HTML version) ─────────────────────
// For SurgicalOncologyWorkflow which uses plain HTML selects.
export const SelectInput = ({ label, value, onChange, options }) => (
  <Box>
    {label && <FieldLabel>{label}</FieldLabel>}
    <select
      value={value || ""}
      onChange={onChange}
      style={{
        width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`,
        borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
        outline: "none", boxSizing: "border-box", appearance: "auto",
      }}
    >
      <option value="" disabled>Select {label}</option>
      {options.map(opt => {
        const val = typeof opt === "object" ? opt.value : opt;
        const lbl = typeof opt === "object" ? opt.label : opt;
        return <option key={val} value={val}>{lbl}</option>;
      })}
    </select>
  </Box>
);

// ─── TextInput (for SurgicalOncologyWorkflow — plain HTML) ───────────────────
export const TextInput = ({ label, value, onChange, placeholder, type = "text", multiline = false, rows = 3 }) => {
  const isControlled = onChange !== undefined;
  const inputProps = isControlled ? { value: value || "", onChange } : { defaultValue: value || "" };
  const style = {
    width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`,
    borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
    outline: "none", boxSizing: "border-box",
  };
  return (
    <Box>
      {label && <FieldLabel>{label}</FieldLabel>}
      {multiline ? (
        <textarea {...inputProps} placeholder={placeholder} rows={rows} style={{ ...style, resize: "vertical" }} />
      ) : (
        <input type={type} {...inputProps} placeholder={placeholder} style={style} />
      )}
    </Box>
  );
};

// ─── CbxGroup (Checkbox Group) ───────────────────────────────────────────────
// Supports options as strings OR { value, label } objects.
export const CbxGroup = ({ label, options, value = [], onChange }) => (
  <Box>
    {label && <FieldLabel>{label}</FieldLabel>}
    <FormGroup row sx={{ gap: 0.25 }}>
      {options.map(opt => {
        const v = typeof opt === "object" ? opt.value : opt;
        const l = typeof opt === "object" ? opt.label : opt;
        return (
          <FormControlLabel
            key={v}
            control={
              <Checkbox
                size="small"
                checked={value.includes(v)}
                onChange={e => onChange(e.target.checked ? [...value, v] : value.filter(x => x !== v))}
                sx={{ color: C.border, "&.Mui-checked": { color: C.black }, pl: 0, pr: 0.8, py: 0.4 }}
              />
            }
            label={<Typography sx={{ fontSize: 12, fontFamily: FONT }}>{l}</Typography>}
            sx={{ ml: 0, mr: 2.5 }}
          />
        );
      })}
    </FormGroup>
  </Box>
);

// ─── RdoGroup (Radio Group) ──────────────────────────────────────────────────
// Supports options as strings OR { value, label } objects.
// The `name` prop is optional — MUI RadioGroup handles grouping via `value`.
export const RdoGroup = ({ label, options, value, onChange, row = true, name }) => (
  <Box>
    {label && <FieldLabel>{label}</FieldLabel>}
    <RadioGroup row={row} value={value || ""} onChange={e => onChange(e.target.value)} name={name}>
      {options.map(opt => {
        const v = typeof opt === "object" ? opt.value : opt;
        const l = typeof opt === "object" ? opt.label : opt;
        return (
          <FormControlLabel
            key={v}
            value={v}
            control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black }, pl: 0, pr: 0.8, py: 0.4 }} />}
            label={<Typography sx={{ fontSize: 12, fontFamily: FONT }}>{l}</Typography>}
            sx={{ ml: 0, mr: 2.5 }}
          />
        );
      })}
    </RadioGroup>
  </Box>
);

// ─── StatusBadge ─────────────────────────────────────────────────────────────
export const StatusBadge = ({ status }) => {
  const map = {
    Completed: { bg: "#f0f0f0", color: "#000", border: "#666" },
    "In Progress": { bg: "#fff8e1", color: "#795548", border: "#795548" },
    Pending: { bg: "#fff", color: "#555", border: "#bbb" },
    Cancelled: { bg: "#fafafa", color: "#999", border: "#ddd" },
    Elective: { bg: "#f0f0f0", color: "#333", border: "#aaa" },
    Postponed: { bg: "#fce4ec", color: "#880e4f", border: "#880e4f" },
  };
  const s = map[status] || map.Pending;
  return (
    <Box sx={{
      display: "inline-block", px: 1, py: 0.2,
      border: `1px solid ${s.border}`, background: s.bg, color: s.color,
      fontSize: 10, fontFamily: FONT, letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      {status}
    </Box>
  );
};

// ─── PostponedBanner ─────────────────────────────────────────────────────────
// Warning / history banner shown when the active procedure was postponed.
// Two modes, driven by getPostponeInfo() (see shared/postponeStatus.js):
//   • isFuture   → live warning: the rescheduled date has not yet arrived. When
//                  `gated` is true, editing is soft-gated and a "Proceed anyway"
//                  button (onOverride) is offered.
//   • !isFuture  → informational: the case is now due, but we still surface that it
//                  was previously postponed (crucial clinical context) with no gate.
// Renders nothing when the booking was never postponed.
export const PostponedBanner = ({ info, gated = false, onOverride }) => {
  if (!info || !info.isPostponed) return null;

  const { isFuture, newDate, originalDate, reason } = info;
  // Palette matches the "Postponed" StatusBadge (pink/maroon).
  const bg = isFuture ? "#fce4ec" : "#f5f5f5";
  const border = "#880e4f";
  const accent = "#880e4f";

  return (
    <Box sx={{
      mb: 2, border: `1px solid ${border}`, background: bg,
      borderLeft: `4px solid ${accent}`, px: 2, py: 1.5, fontFamily: FONT,
    }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, color: accent, letterSpacing: "0.04em", textTransform: "uppercase", mb: 0.5 }}>
            {isFuture ? "Procedure Postponed" : "Previously Postponed"}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: "#333", lineHeight: 1.5 }}>
            {isFuture ? (
              <>This procedure is postponed and rescheduled to <b>{newDate || "an unspecified date"}</b>. The scheduled date has not yet arrived{gated ? " — editing is locked until then." : "."}</>
            ) : (
              <>This procedure was postponed{originalDate ? <> from <b style={{ textDecoration: "line-through" }}>{originalDate}</b></> : ""} and is now due. Proceed as normal.</>
            )}
          </Typography>
          {reason && (
            <Typography sx={{ fontSize: 12, color: "#555", mt: 0.5 }}>
              <b>Reason:</b> {reason}
            </Typography>
          )}
        </Box>
        {isFuture && gated && onOverride && (
          <Box
            component="button"
            type="button"
            onClick={onOverride}
            sx={{
              flexShrink: 0, px: 2, py: 0.75, cursor: "pointer",
              background: C.white, color: accent, border: `1px solid ${accent}`,
              fontFamily: FONT, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase",
              "&:hover": { background: accent, color: C.white },
            }}>
            Proceed anyway
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ─── WasPostponedTag ─────────────────────────────────────────────────────────
// Small persistent marker for worklist rows whose case was postponed but whose
// rescheduled date has arrived (so the primary badge is no longer "Postponed").
export const WasPostponedTag = () => (
  <Box sx={{
    display: "inline-block", px: 0.75, py: 0.1,
    border: "1px solid #880e4f", background: "#fce4ec", color: "#880e4f",
    fontSize: 9, fontFamily: FONT, letterSpacing: "0.06em", textTransform: "uppercase",
  }}>
    Was Postponed
  </Box>
);

// ─── SubTabBar ───────────────────────────────────────────────────────────────
// Used by AnaesthesiaTab for its sub-tab navigation.
export const SubTabBar = ({ tabs, active, onSelect }) => (
  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2.5, borderBottom: `1px solid ${C.border}`, pb: 1.5 }}>
    {tabs.map((t, i) => (
      <Box
        key={t}
        onClick={() => onSelect(i)}
        sx={{
          px: 1.75, py: 0.6, border: `1px solid ${active === i ? C.black : C.border}`,
          background: active === i ? C.black : C.white,
          color: active === i ? C.white : C.textSecond,
          fontSize: 11, fontFamily: FONT, letterSpacing: "0.08em",
          cursor: "pointer", textTransform: "uppercase", transition: "all 0.15s",
          "&:hover": { borderColor: C.black },
        }}
      >
        {t}
      </Box>
    ))}
  </Box>
);
