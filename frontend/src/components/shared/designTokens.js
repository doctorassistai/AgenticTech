// shared/designTokens.js — Single source of truth for design system
// Surgical Oncology Module — Doctorassist.AI brand tokens

export const FONT = '"Open Sans", sans-serif';
export const FW_LIGHT = 300;
export const FW_NORMAL = 400;
export const FW_BOLD = 600;

export const C = {
  black: "#000000",
  white: "#ffffff",
  bgPrimary: "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary: "#000000",
  textSecond: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStrong: "#000000",
};

// ─── MUI-based Styles (for OTRecord and components using MUI) ────────────────

export const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.black },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
  },
  "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 13 },
};

export const fieldLabelSx = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em",
  color: C.textSecond, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 0.75,
};

export const flagNoteSx = {
  fontSize: 10, color: C.textMuted, fontFamily: FONT, mt: 0.5, fontStyle: "italic",
};

export const sectionHeaderSx = {
  px: 2.5, py: 1.25, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em",
  color: C.textPrimary, fontFamily: FONT, fontWeight: FW_NORMAL,
};

export const saveBtnSx = {
  px: 3, py: 0.9, background: C.black, color: C.white,
  fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 12,
  textTransform: "none", borderRadius: 0,
  "&:hover": { background: "#1a1a1a" },
};

export const outlineBtnSx = {
  px: 3, py: 0.9, background: C.white, color: C.black,
  border: `1px solid ${C.black}`, fontFamily: FONT, fontWeight: FW_NORMAL,
  fontSize: 12, textTransform: "none", borderRadius: 0,
  "&:hover": { background: C.bgTertiary },
};

export const thSx = {
  fontFamily: FONT, fontSize: 11, fontWeight: FW_NORMAL,
  textTransform: "uppercase", letterSpacing: "0.08em",
  py: 1, px: 1.5, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
};

export const tdSx = {
  fontFamily: FONT, fontSize: 12, fontWeight: FW_LIGHT, py: 1.25, px: 1.5,
};

// ─── Plain HTML Styles (for components that use native elements) ─────────────

export const inputStyle = {
  width: "100%", padding: "10px 12px", border: `1px solid ${C.border}`,
  borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
  outline: "none", boxSizing: "border-box",
};

export const thStyle = {
  fontFamily: FONT, fontSize: 11, fontWeight: FW_NORMAL,
  textTransform: "uppercase", letterSpacing: "0.08em",
  padding: "8px 12px", background: C.bgSecondary,
  borderBottom: `1px solid ${C.border}`, textAlign: "left",
};

export const tdStyle = {
  fontFamily: FONT, fontSize: 12, fontWeight: FW_LIGHT,
  padding: "10px 12px", borderBottom: `1px solid ${C.border}`,
};

export const catStyle = {
  ...tdSx, // MUI version
  background: C.bgTertiary, fontWeight: FW_NORMAL,
};

export const catStylePlain = {
  fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL,
  padding: "10px 12px", borderBottom: `1px solid ${C.border}`,
  background: C.bgTertiary,
};
