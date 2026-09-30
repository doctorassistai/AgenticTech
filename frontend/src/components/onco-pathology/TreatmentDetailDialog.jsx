// TreatmentDetailDialog.jsx — one prior treatment record, in a subwindow.
//
// Opened by the View button in the Case Registry "Previous Surgery /
// Chemotherapy / Radiotherapy" table. The backend projects each treatment
// record into a flat, ordered `details` list of {label, value} pairs, so this
// only lays them out — it does no field selection of its own, and a nested
// record can never reach it (the Details column used to render whole compacted
// records, and for chemotherapy those were `json.dumps` blobs).
//
// Read-only and presentational: no case state, no fetch.

import React from "react";
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, IconButton,
} from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL } from "../shared/designTokens";
import { formatShortDate } from "./shared/caseHistory";

const labelSx = {
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: FW_NORMAL,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.textMuted,
  width: 210,
  flexShrink: 0,
  pt: 0.2,
};

const valueSx = {
  fontFamily: FONT,
  fontSize: 12.5,
  color: C.textPrimary,
  whiteSpace: "pre-wrap",
  minWidth: 0,
};

function HeaderFact({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ ...labelSx, width: "auto", pt: 0, mb: 0.25 }}>{label}</Typography>
      <Typography sx={{ ...valueSx, fontSize: 12.5 }}>{value || "—"}</Typography>
    </Box>
  );
}

export default function TreatmentDetailDialog({ open, row, onClose }) {
  const details = row?.details || [];

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
            Previous Treatment
          </Typography>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 18, color: C.textPrimary }}>
            {row?.treatment_type || "Treatment"}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: C.textSecond }}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, background: C.white }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
            gap: 2,
            px: 3,
            py: 2,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <HeaderFact label="Date" value={formatShortDate(row?.date)} />
          <HeaderFact label="Intent" value={row?.intent} />
          <HeaderFact label="Status" value={row?.status} />
        </Box>

        <Box sx={{ px: 3, py: 2 }}>
          {details.length === 0 ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
              No further detail was recorded for this treatment.
            </Typography>
          ) : details.map((detail, index) => (
            <Box
              key={`${detail.label}-${index}`}
              sx={{ display: "flex", gap: 1.5, py: 0.5, borderBottom: `1px solid ${C.bgTertiary}` }}
            >
              <Typography sx={labelSx}>{detail.label}</Typography>
              <Typography sx={valueSx}>{detail.value}</Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
