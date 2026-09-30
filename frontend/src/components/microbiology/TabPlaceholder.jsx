import React from "react";
import { Box, Typography } from "@mui/material";
import { C, FONT, FW_LIGHT } from "../shared/designTokens";

// Shared placeholder rendered for every sidebar tab until the real tab is
// built. Kept deliberately bare — this file exists so the sidebar skeleton can
// be reviewed before any tab logic is written.

const TabPlaceholder = ({ title }) => (
  <Box sx={{ py: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
    <Typography sx={{ fontSize: 18, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textSecond }}>
      {title}
    </Typography>
    <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
      Not yet implemented
    </Typography>
  </Box>
);

export default TabPlaceholder;
