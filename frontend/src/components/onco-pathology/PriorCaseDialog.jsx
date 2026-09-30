// PriorCaseDialog.jsx — read-only viewer for ONE previous pathology case.
//
// Opened by the View button in the Case Registry "Previous Pathology Cases"
// table. It replaces the old top-of-page PathologyHistoryAccordion, whose View
// button called switchCase() and so loaded the prior case *into* the live
// workflow, displacing the case being worked on. This is a separate window over
// the current case: it holds no workflow state and performs no fetch, because
// getPatientCases already returns each case's full document.
//
// Sections are listed in workflow order and rendered generically, so whatever a
// tab recorded is visible without this file tracking every tab's field list.
// Empty values and machine bookkeeping keys are hidden; nothing else is.

import React, { useMemo, useState } from "react";
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, IconButton,
  Accordion, AccordionSummary, AccordionDetails,
} from "@mui/material";
import { CloseRounded, ExpandMoreRounded } from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL } from "../shared/designTokens";
import { formatShortDate, priorCaseDate, priorCaseDiagnosis } from "./shared/caseHistory";

// Section order mirrors the workflow sidebar, so a prior case reads in the order
// it was recorded. `tnm` is stored as { latest: {...} }.
const CASE_SECTIONS = [
  { label: "Case Registry", get: (c) => c.case_register },
  { label: "Grossing Bench", get: (c) => c.grossing },
  { label: "Processing & Embedding", get: (c) => c.processing },
  { label: "Sectioning", get: (c) => c.sectioning },
  { label: "Staining", get: (c) => c.staining },
  { label: "Molecular Testing", get: (c) => c.molecular },
  { label: "Cytopathology", get: (c) => c.cytopathology },
  { label: "Microscopy", get: (c) => c.microscopy },
  { label: "Synoptic Report", get: (c) => c.synoptic },
  { label: "TNM Staging", get: (c) => c.tnm?.latest },
  { label: "Final Diagnosis", get: (c) => c.final_diagnosis },
];

// Bookkeeping, not clinical content: schema markers, provenance stamps and the
// advisory-LLM run log (up to 20 runs per section).
const HIDDEN_KEYS = new Set(["schema_version", "data_provenance", "recommendation_runs"]);

const isEmpty = (value) => {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.every(isEmpty);
  if (typeof value === "object") {
    return Object.entries(value).every(([key, item]) => HIDDEN_KEYS.has(key) || isEmpty(item));
  }
  return false;
};

const humanize = (label) => String(label).replace(/_/g, " ");

const primitiveText = (value) => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const labelSx = {
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: FW_NORMAL,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.textMuted,
  width: 190,
  flexShrink: 0,
  pt: 0.2,
};

const valueSx = {
  fontFamily: FONT,
  fontSize: 12,
  color: C.textPrimary,
  whiteSpace: "pre-wrap",
  minWidth: 0,
};

const groupLabelSx = {
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: FW_NORMAL,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: C.textSecond,
  mt: 1.25,
  mb: 0.5,
};

function CaseValue({ label, value, depth = 0 }) {
  if (isEmpty(value)) return null;

  if (Array.isArray(value)) {
    const allPrimitive = value.every((item) => item === null || typeof item !== "object");
    if (allPrimitive) {
      return <CaseValue label={label} value={value.map(primitiveText).join(", ")} depth={depth} />;
    }
    return (
      <Box>
        <Typography sx={groupLabelSx}>{`${humanize(label)} (${value.length})`}</Typography>
        {value.map((item, index) => (
          <Box key={index} sx={{ borderLeft: `1px solid ${C.border}`, pl: 1.5, mb: 1 }}>
            <CaseValue label={`${humanize(label)} ${index + 1}`} value={item} depth={depth + 1} />
          </Box>
        ))}
      </Box>
    );
  }

  if (typeof value === "object") {
    return (
      <Box>
        {depth > 0 && <Typography sx={groupLabelSx}>{humanize(label)}</Typography>}
        <Box sx={{ pl: depth > 0 ? 1.5 : 0 }}>
          {Object.entries(value)
            .filter(([key, item]) => !HIDDEN_KEYS.has(key) && !isEmpty(item))
            .map(([key, item]) => (
              <CaseValue key={key} label={key} value={item} depth={depth + 1} />
            ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", gap: 1.5, py: 0.35, borderBottom: `1px solid ${C.bgTertiary}` }}>
      <Typography sx={labelSx}>{humanize(label)}</Typography>
      <Typography sx={valueSx}>{primitiveText(value)}</Typography>
    </Box>
  );
}

function HeaderFact({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ ...labelSx, width: "auto", pt: 0, mb: 0.25 }}>{label}</Typography>
      <Typography sx={{ ...valueSx, fontSize: 12.5 }}>{value || "—"}</Typography>
    </Box>
  );
}

export default function PriorCaseDialog({ open, caseDoc, onClose }) {
  const [expandedLabel, setExpandedLabel] = useState("");

  const sections = useMemo(() => {
    if (!caseDoc) return [];
    return CASE_SECTIONS
      .map((section) => ({ label: section.label, value: section.get(caseDoc) }))
      .filter((section) => !isEmpty(section.value));
  }, [caseDoc]);

  // Fall back to the first section rather than carrying a label that does not
  // exist on the case that was opened next.
  const activeLabel = sections.some((section) => section.label === expandedLabel)
    ? expandedLabel
    : (sections[0]?.label || "");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
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
        <Box>
          <Typography sx={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: C.textMuted, fontFamily: FONT }}>
            Previous Pathology Case
          </Typography>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 18, color: C.textPrimary }}>
            {caseDoc?.accession_id || "No accession ID"}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: C.textSecond }}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, background: C.bgPrimary }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
            gap: 2,
            px: 3,
            py: 2,
            background: C.white,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <HeaderFact label="Date" value={formatShortDate(priorCaseDate(caseDoc))} />
          <HeaderFact label="Status" value={caseDoc?.status || "Accessioned"} />
          <HeaderFact label="Final Diagnosis" value={priorCaseDiagnosis(caseDoc)} />
        </Box>

        <Box sx={{ p: 3 }}>
          {sections.length === 0 ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
              This case has no recorded sections.
            </Typography>
          ) : sections.map((section) => (
            <Accordion
              key={section.label}
              expanded={activeLabel === section.label}
              onChange={() => setExpandedLabel(activeLabel === section.label ? "" : section.label)}
              disableGutters
              sx={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 0,
                boxShadow: "none",
                mb: 1,
                "&:before": { display: "none" },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreRounded sx={{ fontSize: 18 }} />}
                sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 1 } }}
              >
                <Typography
                  sx={{
                    fontFamily: FONT,
                    fontSize: 11,
                    fontWeight: FW_NORMAL,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: C.textPrimary,
                  }}
                >
                  {section.label}
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ borderTop: `1px solid ${C.border}`, px: 2, py: 1.5 }}>
                <CaseValue label={section.label} value={section.value} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
