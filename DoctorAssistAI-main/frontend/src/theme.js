import { createTheme } from "@mui/material/styles";

const glass = {
  background: "rgba(255, 255, 255, 0.25)", // slightly more opaque
  backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.1))",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.4)",
  borderRadius: 20,
  boxShadow: `
    0 12px 48px rgba(0,0,0,0.12),
    inset 0 1px 2px rgba(255,255,255,0.6),
    0 0 1px rgba(255,255,255,0.3)
  `,
  padding: "12px"
};

const theme = createTheme({
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Helvetica, Arial, sans-serif',
  },
  shape: {
    borderRadius: 20,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Helvetica, Arial, sans-serif',
          background: "linear-gradient(135deg, #f0f3f7, #e2e8f0)"
        },
      },
    },

    // Containers
    MuiCard: { styleOverrides: { root: glass } },
    MuiPaper: { styleOverrides: { root: glass } },
    MuiAccordion: { styleOverrides: { root: glass } },

    // Tables
    MuiTableContainer: { styleOverrides: { root: glass } },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: "1px solid rgba(255,255,255,0.3)",
          padding: "12px",
        },
        head: {
          fontWeight: 600,
          color: "#222",
        },
      },
    },

    // Buttons
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          textTransform: "none",
          fontWeight: 600,
          padding: "8px 20px",
          backdropFilter: "blur(12px) saturate(180%)",
        },
      },
    },

    // Inputs
    MuiOutlinedInput: { styleOverrides: { root: glass } },

    // Alerts / Notifications
    MuiAlert: { styleOverrides: { root: glass } },

    // Menus / Popovers
    MuiMenu: { styleOverrides: { paper: glass } },
    MuiPopover: { styleOverrides: { paper: glass } },
  },
});

export default theme;
