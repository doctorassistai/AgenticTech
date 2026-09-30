// shared/BypassVerificationControl.jsx — the doctor's escape hatch for a barcode
// image gate that could not be verified.
//
// Rendered on an item whose latest verification is not "matched". Three states:
//   • item was bypassed → a small banner stating the barcode was NOT
//     machine-verified, with the reason and who/when.
//   • bypass form open  → a reason field (required) plus Confirm / Cancel.
//   • otherwise         → a "Bypass Barcode Verification" button.
//
// The bypass is recorded by the caller into the same append-only verification
// list (see shared/barcodeVerification.js); this component only collects the
// reason and shows the outcome.

import React from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import {
  CheckRounded,
  CloseRounded,
  GppGoodRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import { C, FONT, inputSx, outlineBtnSx } from "../../shared/designTokens";

const AMBER = "#b76e00";

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
};

export default function BypassVerificationControl({
  bypassed,
  bypassedBy = {},
  bypassedAt = "",
  bypassReason = "",
  open,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  onOpen,
  busy = false,
}) {
  if (bypassed) {
    return (
      <Box sx={{ borderTop: `1px solid ${C.border}`, mt: 1.25, pt: 1.25 }}>
        <Typography sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: FONT, fontSize: 11, color: AMBER }}>
          <GppGoodRounded sx={{ fontSize: 16 }} />
          Barcode verification bypassed — identity was NOT machine-verified.
        </Typography>
        {bypassReason && (
          <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.textSecond, mt: 0.5 }}>
            Reason: {bypassReason}
          </Typography>
        )}
        {bypassedBy?.name && (
          <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.textMuted, mt: 0.5 }}>
            By {bypassedBy.name} on {formatDateTime(bypassedAt)}
          </Typography>
        )}
      </Box>
    );
  }

  if (open) {
    return (
      <Box sx={{ borderTop: `1px solid ${C.border}`, mt: 1.25, pt: 1.25 }}>
        <Typography sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: FONT, fontSize: 11, color: AMBER, mb: 1 }}>
          <WarningAmberRounded sx={{ fontSize: 16 }} />
          The system could not verify this barcode. Bypass only after visually confirming the physical label.
        </Typography>
        <TextField
          autoFocus
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
          placeholder="Why the barcode could not be verified (e.g. smudged, torn, misprinted) — required"
          sx={inputSx}
        />
        <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
          <Button sx={{ ...outlineBtnSx, px: 1.5, py: 0.5 }} disabled={busy} onClick={onCancel}>
            <CloseRounded sx={{ mr: 0.5, fontSize: 15 }} /> Cancel
          </Button>
          <Button
            sx={{
              ...outlineBtnSx,
              px: 1.5,
              py: 0.5,
              background: AMBER,
              color: C.white,
              borderColor: AMBER,
              "&:hover": { background: "#8a5200" },
            }}
            disabled={busy || !reason.trim()}
            onClick={onConfirm}
          >
            <CheckRounded sx={{ mr: 0.5, fontSize: 15 }} /> Confirm Bypass
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ borderTop: `1px solid ${C.border}`, mt: 1.25, pt: 1.25 }}>
      <Button
        sx={{ ...outlineBtnSx, px: 1.5, py: 0.5, color: AMBER, borderColor: AMBER }}
        onClick={onOpen}
      >
        <WarningAmberRounded sx={{ mr: 0.5, fontSize: 16 }} /> Bypass Barcode Verification
      </Button>
      <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.textMuted, mt: 0.75 }}>
        Proceeds without machine-verifying the barcode. The record is saved as not verified, with this bypass note.
      </Typography>
    </Box>
  );
}
