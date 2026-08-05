// CompletedInvestigationsPanel.jsx — Read-only view of completed (uploaded)
// oncology investigation reports for a patient/doctor, with the extracted
// parameter-wise values shown in a dialog. Driven by the
// `oncology-investigations/completed-documents` endpoint.
//
// Reused across the Doctors Note, Surgical Checklist (Pre-Induction Labs) and
// Discharge Summary so the same completed-report data appears consistently.

import React, { useState, useEffect } from "react";
import {
  Box, Typography, Button, IconButton, Dialog, DialogTitle, DialogContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, TablePagination, CircularProgress,
} from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { C, FONT, FW_NORMAL, FW_BOLD, thSx, tdSx, outlineBtnSx } from "./designTokens";
import { getCompletedInvestigationDocuments, getInvestigations } from "./api";

// Generic "Ordered For" label. The oncology-investigations endpoint is shared:
// surgical stores a procedure, chemo/radio store a cycle. Both go into
// order_context.label, so this renders correctly for every module.
const orderContextLabel = (inv) => {
  const ctx = inv?.order_context;
  if (ctx && typeof ctx === "object") return ctx.label || ctx.procedure || ctx.cycle || "—";
  if (typeof ctx === "string" && ctx) return ctx;
  return "—";
};

const InvestigationRow = ({ inv, formattedDate, onViewValues }) => {
  const [indExpanded, setIndExpanded] = useState(false);
  const [paramExpanded, setParamExpanded] = useState(false);

  const indication = inv.clinical_indication || "None provided";
  const isIndLong = indication.length > 50;
  const dispInd = indExpanded ? indication : (isIndLong ? indication.substring(0, 50) + "..." : indication);

  const paramsStr = Array.isArray(inv.parameters)
    ? inv.parameters.map(p => typeof p === "string" ? p : p.label).join(", ")
    : (typeof inv.parameters === "string" ? inv.parameters : "None");
  const isParamLong = paramsStr.length > 50;
  const dispParam = paramExpanded ? paramsStr : (isParamLong ? paramsStr.substring(0, 50) + "..." : paramsStr);

  const hasValues = Array.isArray(inv.parameterwise_content) && inv.parameterwise_content.length > 0;

  return (
    <TableRow sx={{ "&:hover": { background: C.bgPrimary } }}>
      <TableCell sx={tdSx}>{formattedDate}</TableCell>
      <TableCell sx={tdSx}>{(inv.investigation || inv.investigation_type || "").includes("radiology") ? "Radiology" : "Lab"}</TableCell>
      <TableCell sx={tdSx}>{orderContextLabel(inv)}</TableCell>
      <TableCell sx={{ ...tdSx, cursor: isIndLong ? "pointer" : "default" }} onClick={() => isIndLong && setIndExpanded(!indExpanded)}>
        {dispInd}
      </TableCell>
      <TableCell sx={{ ...tdSx, cursor: isParamLong ? "pointer" : "default" }} onClick={() => isParamLong && setParamExpanded(!paramExpanded)}>
        {dispParam}
      </TableCell>
      <TableCell sx={tdSx}>
        {hasValues ? (
          <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }} onClick={() => onViewValues(inv)}>
            View Values
          </Button>
        ) : "—"}
      </TableCell>
    </TableRow>
  );
};

const CompletedInvestigationsPanel = ({ patientId, doctorId, title = "Completed Investigation Reports" }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [valuesDialog, setValuesDialog] = useState({ open: false, inv: null });

  useEffect(() => {
    if (patientId && doctorId) {
      setLoading(true);
      Promise.all([
        getCompletedInvestigationDocuments(patientId, doctorId),
        getInvestigations(patientId, doctorId)
      ])
        .then(([completedRes, allRes]) => {
          const completed = completedRes?.data || [];
          const all = allRes?.data || [];
          
          const historyMapByDocId = all.reduce((acc, inv) => {
            if (inv.document_id != null) acc[inv.document_id] = inv;
            return acc;
          }, {});
          
          const historyMapById = all.reduce((acc, inv) => {
            if (inv.id !== undefined) acc[inv.id] = inv;
            return acc;
          }, {});

          const mergedDocs = completed.map(doc => {
            const match = historyMapById[doc.id] || historyMapByDocId[doc.document_id] || {};
            return {
              ...doc,
              id: doc.id !== undefined ? doc.id : match.id,
              order_context: doc.order_context || match.order_context
            };
          });

          setDocs(mergedDocs);
        })
        .catch(err => console.error("[CompletedInvestigationsPanel] fetch failed:", err))
        .finally(() => setLoading(false));
    }
  }, [patientId, doctorId]);

  const closeValues = () => setValuesDialog({ open: false, inv: null });
  const sorted = [...docs].sort((a, b) => new Date(b.date_of_order) - new Date(a.date_of_order));
  const isEmpty = sorted.length === 0;

  return (
    <Box sx={{ mt: 2 }}>
      {title && (
        <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT }}>{title}</Typography>
      )}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}><CircularProgress size={20} /></Box>
      ) : isEmpty ? (
        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted, fontStyle: "italic" }}>
          No completed investigation reports.
        </Typography>
      ) : (
        <>
          <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
            <Table size="small">
              <TableHead sx={{ background: C.bgSecondary }}>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>Investigation</TableCell>
                  <TableCell sx={thSx}>Ordered For</TableCell>
                  <TableCell sx={thSx}>Clinical Indication</TableCell>
                  <TableCell sx={thSx}>Parameters</TableCell>
                  <TableCell sx={thSx}>Values</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((inv, idx) => {
                    const dt = new Date(inv.date_of_order);
                    const formattedDate = isNaN(dt) ? inv.date_of_order : dt.toLocaleString();
                    return (
                      <InvestigationRow
                        key={inv.document_id || idx}
                        inv={inv}
                        formattedDate={formattedDate}
                        onViewValues={(i) => setValuesDialog({ open: true, inv: i })}
                      />
                    );
                  })}
              </TableBody>
            </Table>
          </TableContainer>
          {sorted.length > rowsPerPage && (
            <TablePagination
              component="div"
              count={sorted.length}
              page={page}
              onPageChange={(e, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25]}
            />
          )}
        </>
      )}

      <Dialog open={valuesDialog.open} onClose={closeValues} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Extracted Values</Typography>
          <IconButton onClick={closeValues} size="small"><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          {valuesDialog.inv && (
            <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
              <Table size="small">
                <TableHead sx={{ background: C.bgSecondary }}>
                  <TableRow>
                    <TableCell sx={thSx}>Parameter</TableCell>
                    <TableCell sx={thSx}>Date</TableCell>
                    <TableCell sx={thSx}>Content</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(valuesDialog.inv.parameterwise_content || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ ...tdSx, textAlign: "center", py: 2, color: "#888" }}>No extracted values.</TableCell>
                    </TableRow>
                  ) : (
                    (valuesDialog.inv.parameterwise_content || []).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell sx={tdSx}>{p.parameter_name || "—"}</TableCell>
                        <TableCell sx={tdSx}>{p.date || "—"}</TableCell>
                        <TableCell sx={{ ...tdSx, whiteSpace: "pre-wrap" }}>{p.content || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default CompletedInvestigationsPanel;
