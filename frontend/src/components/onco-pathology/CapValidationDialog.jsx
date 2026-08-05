// CapValidationDialog.jsx — Modal showing CAP validation results
//
// Renders the structured result array from shared/capValidation.js as a list of
// leveled alert rows (ok / warning / error / info). Pure presentational; the
// parent computes results and passes them in.

import React from "react";
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, IconButton,
} from "@mui/material";
import {
  CloseRounded, CheckCircleRounded, WarningAmberRounded, ErrorRounded, InfoRounded,
} from "@mui/icons-material";
import { C, FONT, FW_NORMAL } from "../shared/designTokens";

const LEVEL = {
  ok: { color: "#237804", Icon: CheckCircleRounded },
  warning: { color: "#b76e00", Icon: WarningAmberRounded },
  error: { color: "#cf1322", Icon: ErrorRounded },
  info: { color: C.textSecond, Icon: InfoRounded },
};

export default function CapValidationDialog({ open, onClose, title = "CAP Validation", results = [] }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
        <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>{title}</Typography>
        <IconButton onClick={onClose} size="small"><CloseRounded /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 2.5, "&:first-of-type": { pt: 3 }, fontFamily: FONT }}>
        {results.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>No validation results.</Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            {results.map((r, i) => {
              const cfg = LEVEL[r.level] || LEVEL.info;
              const { Icon } = cfg;
              return (
                <Box key={i} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", p: 1.25, border: `1px solid ${C.border}`, background: C.white }}>
                  <Icon sx={{ fontSize: 18, color: cfg.color, mt: 0.2, flexShrink: 0 }} />
                  <Box>
                    <Typography sx={{ fontSize: 12.5, fontWeight: FW_NORMAL, fontFamily: FONT, color: cfg.color }}>{r.title}</Typography>
                    {r.message && (
                      <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, whiteSpace: "pre-line", mt: 0.25 }}>
                        {r.message}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
