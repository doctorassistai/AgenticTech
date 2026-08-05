import React, { useState, useEffect } from "react";
import { Box, Typography, Accordion, AccordionSummary, AccordionDetails, Table, TableHead, TableBody, TableRow, TableCell, TableContainer, CircularProgress } from "@mui/material";
import { ExpandMoreRounded } from "@mui/icons-material";

import { getOncologyRecords, getInvestigations, getCompletedInvestigations, getDoctorInfo } from "./shared/api";
import mapping from "./shared/oncology_chart_mapping.json";
import { flattenMapping, MedicalRecordTable, resolvePath } from "./shared/OncologyChartUtils";
import { C, FONT, FW_BOLD, FW_NORMAL, thSx, tdSx } from "./shared/designTokens";
import { CompletedInvestigationsTable } from "./LabInvestigations";

const ChemoVitalsDisplay = ({ chemoRecord }) => {
  const cycles = chemoRecord?.data?.cycles;
  const latestCycle = cycles && Array.isArray(cycles) && cycles.length > 0 ? cycles[cycles.length - 1] : null;
  const vitals = latestCycle?.admin?.vitals || {};

  const parameters = [
    { label: 'Temp', pre: vitals.tempPre, during: vitals.tempDuring, post: vitals.tempPost },
    { label: 'Pulse', pre: vitals.pulsePre, during: vitals.pulseDuring, post: vitals.pulsePost },
    { label: 'BP', pre: vitals.bpPre, during: vitals.bpDuring, post: vitals.bpPost },
    { label: 'RR', pre: vitals.rrPre, during: vitals.rrDuring, post: vitals.rrPost },
    { label: 'SpO2', pre: vitals.spo2Pre, during: vitals.spo2During, post: vitals.spo2Post },
  ].filter(p => p.pre || p.during || p.post);

  return (
    <Box sx={{ p: 3, pt: 0 }}>
      <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, color: C.textPrimary, mb: 1.5, fontFamily: FONT, textTransform: 'uppercase' }}>
        Vitals (Latest Cycle)
      </Typography>
      {parameters.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: C.textMuted }}>No vitals recorded.</Typography>
      ) : (
        <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
          <Table size="small">
            <TableHead sx={{ background: C.bgSecondary }}>
              <TableRow>
                <TableCell sx={thSx}>Parameter</TableCell>
                <TableCell sx={thSx}>Pre</TableCell>
                <TableCell sx={thSx}>During</TableCell>
                <TableCell sx={thSx}>Post</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {parameters.map((p, i) => (
                <TableRow key={i}>
                  <TableCell sx={thSx}>{p.label}</TableCell>
                  <TableCell sx={tdSx}>{p.pre || '—'}</TableCell>
                  <TableCell sx={tdSx}>{p.during || '—'}</TableCell>
                  <TableCell sx={tdSx}>{p.post || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

const ChemotherapyChart = ({ patientId, defaultExpanded = false }) => {
  const [records, setRecords] = useState({ chemo: null });
  const [loading, setLoading] = useState(false);
  const [chemoInvestigations, setChemoInvestigations] = useState([]);
  const [chemoDoctorNamesMap, setChemoDoctorNamesMap] = useState({});

  useEffect(() => {
    if (patientId) {
      setLoading(true);
      getOncologyRecords(patientId)
        .then(res => {
          if (res) {
            setRecords({
              chemo: res.chemotherapy || null
            });
            const cDoc = res.chemotherapy?.doctor_id || res.chemotherapy?.doctorId || res.chemotherapy?.primaryDoctor;
            if (cDoc) {
              Promise.all([
                getInvestigations(patientId, cDoc).catch(() => ({ data: [] })),
                getCompletedInvestigations(patientId, cDoc).catch(() => ({ data: [] }))
              ]).then(([invRes, compRes]) => {
                const history = invRes?.data || [];
                const docs = compRes?.data || [];

                const historyMapByDocId = history.reduce((acc, inv) => {
                  if (inv.document_id != null) acc[inv.document_id] = inv;
                  return acc;
                }, {});
                const historyMapById = history.reduce((acc, inv) => {
                  if (inv.id !== undefined) acc[inv.id] = inv;
                  return acc;
                }, {});

                const allCompleted = docs.map(doc => {
                  const match = historyMapById[doc.id] || historyMapByDocId[doc.document_id] || {};
                  return {
                    ...doc,
                    id: doc.id !== undefined ? doc.id : match.id,
                    doctor_id: doc.doctor_id || match.doctor_id || cDoc,
                    order_context: doc.order_context || match.order_context
                  };
                });

                setChemoInvestigations(allCompleted);

                const uniqueDocIds = [...new Set([cDoc, ...allCompleted.map(d => d.doctor_id).filter(Boolean)])];
                Promise.all(
                  uniqueDocIds.map(id =>
                    getDoctorInfo(id)
                      .then(res => ({ id, name: res?.doctor?.name || id }))
                      .catch(() => ({ id, name: id }))
                  )
                ).then(results => {
                  setChemoDoctorNamesMap(prev => {
                    const next = { ...prev };
                    results.forEach(r => next[r.id] = r.name);
                    return next;
                  });
                });
              }).catch(err => console.error(err));
            }
          }
        })
        .catch(err => console.error("Failed to fetch oncology records:", err))
        .finally(() => setLoading(false));
    }
  }, [patientId]);

  const chemoFields = flattenMapping(mapping, 'chemo');

  const renderMedicalRecord = (fields, data, type) => {
    if (!data) return <Box sx={{ p: 2 }}><Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textMuted }}>No {type} records found.</Typography></Box>;

    const evaluatedFields = fields.map(f => {
      // Cycle-pinned collection (e.g. cycle_admin_summary): the mapping hardcodes
      // ".cycles.1.", but expand to one row per cycle key present in the DB.
      if (f.isCycleCollection) {
        const collection = resolvePath(data, f.collectionPath);
        let val = [];
        if (collection && typeof collection === 'object') {
          val = Object.keys(collection)
            .sort((a, b) => Number(a) - Number(b))
            .map(cycleNo => {
              const item = resolvePath(collection[cycleNo], f.itemSuffix);
              if (!item || typeof item !== 'object') return null;
              return { __cycleNo: cycleNo, ...item };
            })
            .filter(Boolean);
        }
        return { ...f, val, isEmpty: val.length === 0 };
      }
      const val = resolvePath(data, f.path);
      const isEmpty = val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0);
      return { ...f, val, isEmpty };
    }).filter(f => !f.isEmpty);

    if (evaluatedFields.length === 0) return <Box sx={{ p: 2 }}><Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textMuted }}>No {type} records found.</Typography></Box>;

    const grouped = evaluatedFields.reduce((acc, f) => {
      if (!acc[f.category]) acc[f.category] = [];
      acc[f.category].push(f);
      return acc;
    }, {});

    const categoriesToRemove = ["Patient Identity", "Final Summary", "Anthropometrics And Bsa", "Drug Preparation", "Response Assessment", "Latest Pre Chemo Labs And Vitals", "Latest Pre Radio Labs And Vitals"];
    const categoriesToCollapse = ["Cycle Status And Progress", "Drug Administration", "Quality Audit"];

    return (
      <Box sx={{ p: 3, background: '#fff' }}>
        {Object.entries(grouped)
          .filter(([category]) => !categoriesToRemove.includes(category))
          .map(([category, catFields]) => {
            const isCollapsible = categoriesToCollapse.includes(category);

            if (isCollapsible) {
              return (
                <Accordion key={category} sx={{ mb: 3, background: '#fff', border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, '& .MuiAccordionSummary-content': { my: 1 } }}>
                    <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_BOLD, color: C.textPrimary, textTransform: 'uppercase' }}>
                      {category}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 2, pt: 3 }}>
                    <MedicalRecordTable catFields={catFields} />
                  </AccordionDetails>
                </Accordion>
              );
            }

            return (
              <Box key={category} sx={{ mb: 4 }}>
                <Typography sx={{
                  fontSize: 14,
                  fontWeight: FW_BOLD,
                  color: C.black,
                  mb: 1.5,
                  fontFamily: FONT,
                  borderBottom: `2px solid ${C.border}`,
                  pb: 0.5
                }}>
                  {category}
                </Typography>
                <MedicalRecordTable catFields={catFields} />
              </Box>
            );
          })}
      </Box>
    );
  };

  if (loading) {
    return <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>;
  }

  return (
    <Accordion defaultExpanded={defaultExpanded} sx={{ border: `1px solid ${C.border}`, mb: 2.5, boxShadow: 'none', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 2.5, py: 0, minHeight: 40, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, '& .MuiAccordionSummary-content': { my: 1.25 } }}>
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textPrimary, fontFamily: FONT, fontWeight: FW_NORMAL }}>Chemotherapy Chart</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 2.5, px: 0 }}>
        {renderMedicalRecord(chemoFields, records.chemo, 'chemotherapy')}
        <ChemoVitalsDisplay chemoRecord={records.chemo} />
        <Box sx={{ p: 3, pt: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, mb: 1.5, fontFamily: FONT, textTransform: 'uppercase', color: C.textPrimary }}>Completed Investigations (Chemotherapy)</Typography>
          <CompletedInvestigationsTable
            completedInvestigations={chemoInvestigations}
            doctorNamesMap={chemoDoctorNamesMap}
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export default ChemotherapyChart;
