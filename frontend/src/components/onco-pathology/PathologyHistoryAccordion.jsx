// PathologyHistoryAccordion.jsx — Past Cases for the Current Patient
//
// Shows a collapsible history table of all pathology cases for the patient,
// newest first. Each row has a "View" button that switches the workflow to
// that case (via switchCase(case_id) from usePathologyCase).
//
// Props: { cases = [], currentCaseId, switchCase }

import React, { useState } from "react";
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Accordion, AccordionSummary, AccordionDetails, Button,
} from "@mui/material";
import { ExpandMoreRounded } from "@mui/icons-material";
import { C, FONT, FW_BOLD, FW_NORMAL, thSx, tdSx, outlineBtnSx } from "../shared/designTokens";

const PathologyHistoryAccordion = ({ cases = [], currentCaseId, switchCase }) => {
  const [expanded, setExpanded] = useState(false);

  // Exclude the current case; show all others (including signed-out).
  const historyData = cases.filter((c) => c.case_id !== currentCaseId);
  if (historyData.length === 0) return null;

  const formatDate = (isoStr) => {
    if (!isoStr) return "—";
    try {
      return new Date(isoStr).toLocaleDateString();
    } catch {
      return "—";
    }
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion
        expanded={expanded}
        onChange={() => setExpanded(!expanded)}
        sx={{
          background: C.bgSecondary,
          border: `1px solid ${C.border}`,
          boxShadow: "none",
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreRounded />}
          sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 1 } }}
        >
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: FW_BOLD,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Past Pathology Cases ({historyData.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0, borderTop: `1px solid ${C.border}` }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>Accession ID</TableCell>
                  <TableCell sx={thSx}>Status</TableCell>
                  <TableCell sx={thSx}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyData.map((c, i) => {
                  const caseReg = c.case_register || {};
                  const accessionId = caseReg.accession_id || "—";
                  const dateReceived = caseReg.date_received || c.created_at;
                  return (
                    <TableRow key={i} sx={{ "&:hover": { background: C.bgPrimary } }}>
                      <TableCell sx={tdSx}>{formatDate(dateReceived)}</TableCell>
                      <TableCell sx={tdSx}>{accessionId}</TableCell>
                      <TableCell sx={tdSx}>{c.status || "Accessioned"}</TableCell>
                      <TableCell sx={tdSx}>
                        <Button
                          size="small"
                          sx={{
                            ...outlineBtnSx,
                            mt: 0,
                            py: 0.4,
                            px: 1.5,
                            fontSize: 10,
                            borderColor: C.black,
                            color: C.black,
                          }}
                          onClick={() => switchCase(c.case_id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default PathologyHistoryAccordion;
