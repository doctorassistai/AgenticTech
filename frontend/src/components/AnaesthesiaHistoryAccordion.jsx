import React, { useState } from "react";
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Dialog, DialogTitle, DialogContent, IconButton, Accordion, AccordionSummary, AccordionDetails, Button
} from "@mui/material";
import { CloseRounded, ExpandMoreRounded } from "@mui/icons-material";
import { C, FONT, FW_BOLD, FW_NORMAL, thSx, tdSx, outlineBtnSx } from "./shared/designTokens";
import { ROInput, FG } from "./shared/FormComponents";

const formatArrayData = (arr) => {
  const validItems = arr.map((item, idx) => {
    if (typeof item === 'object' && item !== null) {
      if (item.product !== undefined && item.checked !== undefined) {
        if (!item.checked || String(item.checked) === "false") return null;
        return (
          <Typography key={idx} sx={{ fontSize: 12, fontFamily: FONT }}>
            • {item.product}
            {item.volume ? `: ${item.volume}` : ''}
            {item.bagNo && item.bagNo !== "not applicable" ? ` (Bag: ${item.bagNo})` : ''}
            {item.reaction ? ` [Reaction: ${item.reaction}]` : ''}
          </Typography>
        );
      }
      if (item.time !== undefined && item.value !== undefined) {
        return <Typography key={idx} sx={{ fontSize: 12, fontFamily: FONT }}>• {item.time} - {item.value}</Typography>;
      }
      const fields = Object.entries(item)
        .filter(([k, v]) => v !== "" && v !== null && k !== 'checked' && v !== false)
        .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()}: ${v}`);
      if (fields.length === 0) return null;
      return <Typography key={idx} sx={{ fontSize: 12, fontFamily: FONT }}>• {fields.join(', ')}</Typography>;
    }
    return <Typography key={idx} sx={{ fontSize: 12, fontFamily: FONT }}>• {String(item)}</Typography>;
  }).filter(Boolean);
  
  if (validItems.length === 0) return null;
  return <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>{validItems}</Box>;
};

const renderNestedData = (obj) => {
  if (!obj || typeof obj !== 'object') return String(obj);
  
  const renderLevel = (data) => {
    return Object.entries(data).map(([key, val]) => {
      if (val === null || val === "" || val === undefined) return null;
      
      const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      
      let parsedVal = val;
      if (typeof val === 'string' && (val.trim().startsWith('[') || val.trim().startsWith('{'))) {
          try { parsedVal = JSON.parse(val); } catch(e) {}
      }
      if (Array.isArray(parsedVal) && parsedVal.length === 0) return null;

      if (typeof parsedVal === 'object' && parsedVal !== null && !Array.isArray(parsedVal)) {
        const subContent = renderLevel(parsedVal).filter(Boolean);
        if (subContent.length === 0) return null;
        return (
          <Box key={key} sx={{ mb: 1, mt: 1, gridColumn: '1 / -1' }}>
            <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textSecond, borderBottom: `1px solid ${C.border}`, mb: 0.5 }}>{formattedKey}</Typography>
            <Box sx={{ pl: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>{subContent}</Box>
          </Box>
        );
      }
      
      let displayContent;
      if (Array.isArray(parsedVal)) {
        displayContent = formatArrayData(parsedVal);
        if (!displayContent) return null;
      } else {
        displayContent = <Typography sx={{ fontSize: 12, fontFamily: FONT }}>{String(parsedVal)}</Typography>;
      }
      
      return (
        <Box key={key} sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase' }}>{formattedKey}</Typography>
          {displayContent}
        </Box>
      );
    });
  };

  const content = renderLevel(obj).filter(Boolean);
  if (content.length === 0) return <Typography sx={{ fontSize: 12, color: C.textMuted }}>No data</Typography>;
  
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
      {content}
    </Box>
  );
};

const AnaesthesiaHistoryAccordion = ({ history = [], currentRecordId, title = "Past Anaesthesia Records" }) => {
  const [expanded, setExpanded] = useState(false);
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });

  const historyData = history.filter(r => r.record_id !== currentRecordId);
  if (historyData.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_BOLD, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title} ({historyData.length})</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0, borderTop: `1px solid ${C.border}` }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>Status</TableCell>
                  <TableCell sx={thSx}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyData.map((r, i) => {
                  const hasData = Object.keys(r).some(k => k !== 'record_id' && k !== 'patient_id' && k !== 'doctor_id' && k !== 'created_at' && k !== 'updated_at' && k !== 'status' && r[k]);
                  return (
                    <TableRow key={i} sx={{ "&:hover": { background: C.bgPrimary } }}>
                      <TableCell sx={tdSx}>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                      <TableCell sx={tdSx}>{r.status}</TableCell>
                      <TableCell sx={tdSx}>
                        <Button disabled={!hasData} size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, borderColor: hasData ? C.primary : C.border, color: hasData ? C.primary : C.textMuted }} onClick={() => setViewDialog({ open: true, data: r })}>
                          {hasData ? "View" : "No Data"}
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

      <Dialog open={viewDialog.open} onClose={() => setViewDialog({ open: false, data: null })} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Past Record Details</Typography>
          <IconButton onClick={() => setViewDialog({ open: false, data: null })} size="small"><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Recorded Data Sections</Typography>
            <FG cols={3}>
              {viewDialog.data && Object.entries(viewDialog.data).map(([k, v]) => {
                if (['record_id', 'patient_id', 'doctor_id', 'created_at', 'updated_at', '_id'].includes(k)) return null;

                const labelStr = k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

                let parsedVal = v;
                if (typeof v === 'string' && (v.trim().startsWith('[') || v.trim().startsWith('{'))) {
                    try { parsedVal = JSON.parse(v); } catch(e) {}
                }

                if (typeof parsedVal === 'object' && parsedVal !== null && !Array.isArray(parsedVal)) {
                  return (
                     <Box key={k} sx={{ gridColumn: '1 / -1', border: `1px solid ${C.border}`, p: 1.5, mb: 1, background: C.bgPrimary }}>
                       <Typography sx={{ fontSize: 12, fontWeight: FW_BOLD, color: C.textSecond, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{labelStr}</Typography>
                       {renderNestedData(parsedVal)}
                     </Box>
                  );
                }

                if (Array.isArray(parsedVal)) {
                  if (parsedVal.length === 0) return null;
                  const displayContent = formatArrayData(parsedVal);
                  if (!displayContent) return null;
                  return (
                    <Box key={k} sx={{ display: 'flex', flexDirection: 'column', mb: 2 }}>
                       <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', mb: 0.5 }}>{labelStr}</Typography>
                       {displayContent}
                    </Box>
                  );
                }

                if (parsedVal === "" || parsedVal === null || parsedVal === undefined) return null;

                return <ROInput key={k} label={labelStr} value={String(parsedVal)} />;
              })}
            </FG>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default AnaesthesiaHistoryAccordion;
