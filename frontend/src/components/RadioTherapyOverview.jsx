import React, { useState, useEffect } from "react";
import { Box, Typography, Accordion, AccordionSummary, AccordionDetails, CircularProgress } from "@mui/material";
import { ExpandMoreRounded } from "@mui/icons-material";
import { C, FONT, FW_BOLD, FW_NORMAL } from "./shared/designTokens";
import { flattenMapping, MedicalRecordTable, resolvePath } from "./shared/OncologyChartUtils";
import { CompletedInvestigationsTable } from "./LabInvestigations";
import { getDoctorInfo, getOncologyRecords, getInvestigations, getCompletedInvestigations } from "./shared/api";
import mapping from "./shared/oncology_chart_mapping.json";

const RadioVitalsDisplay = ({ radioRecord }) => {
  const baseline = radioRecord?.data?.baseline || {};

  const parameters = [
    { key: 'phy_performance', label: 'Performance Status' },
    { key: 'phy-painscore', label: 'Pain Score' },
    { key: 'phy-bp', label: 'Blood Pressure' },
    { key: 'phy-hr', label: 'Heart Rate' },
    { key: 'phy-temp', label: 'Temperature' },
    { key: 'phy-rr', label: 'Respiratory Rate' },
  ];

  const dataFields = parameters.filter(p => baseline[p.key]);

  return (
    <Box sx={{ p: 3, pt: 0 }}>
      <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, color: C.textPrimary, mb: 1.5, fontFamily: FONT, textTransform: 'uppercase' }}>
        Baseline Vitals
      </Typography>
      {dataFields.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: C.textMuted }}>No baseline vitals recorded.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {dataFields.map(p => (
            <Box key={p.key} sx={{ background: C.bgSecondary, px: 1.5, py: 1, border: `1px solid ${C.border}`, borderRadius: 1, minWidth: 120 }}>
              <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', mb: 0.5 }}>{p.label}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, color: C.textPrimary }}>{baseline[p.key]}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

const RadioTherapyOverview = ({ patientId }) => {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [investigations, setInvestigations] = useState([]);
  const [doctorNameMap, setDoctorNameMap] = useState({});

  useEffect(() => {
    if (patientId) {
      setLoading(true);
      getOncologyRecords(patientId)
        .then(res => {
          if (res && res.radiotherapy) {
            setRecord(res.radiotherapy);
            const rDoc = res.radiotherapy.doctor_id || res.radiotherapy.doctorId || res.radiotherapy.primaryDoctor;
            if (rDoc) {
              Promise.all([
                getInvestigations(patientId, rDoc).catch(() => ({ data: [] })),
                getCompletedInvestigations(patientId, rDoc).catch(() => ({ data: [] }))
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
                    doctor_id: doc.doctor_id || match.doctor_id || rDoc,
                    order_context: doc.order_context || match.order_context
                  };
                });
                
                setInvestigations(allCompleted);

                const uniqueDocIds = [...new Set([rDoc, ...allCompleted.map(d => d.doctor_id).filter(Boolean)])];
                Promise.all(
                  uniqueDocIds.map(id =>
                    getDoctorInfo(id)
                      .then(res => ({ id, name: res?.doctor?.name || id }))
                      .catch(() => ({ id, name: id }))
                  )
                ).then(results => {
                  setDoctorNameMap(prev => {
                    const next = { ...prev };
                    results.forEach(r => next[r.id] = r.name);
                    return next;
                  });
                });
              }).catch(err => console.error(err));
            }
          }
        })
        .catch(err => console.error("Failed to fetch radiotherapy records:", err))
        .finally(() => setLoading(false));
    }
  }, [patientId]);

  const radioFields = flattenMapping(mapping, 'radio');

  const renderMedicalRecord = (fields, data, type) => {
    if (!data) return <Box sx={{ p: 2 }}><Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textMuted }}>No {type} records found.</Typography></Box>;

    const evaluatedFields = fields.map(f => {
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
    <Accordion defaultExpanded={false} sx={{ border: `1px solid ${C.border}`, mb: 2.5, boxShadow: 'none', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 2.5, py: 0, minHeight: 40, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, '& .MuiAccordionSummary-content': { my: 1.25 } }}>
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textPrimary, fontFamily: FONT, fontWeight: FW_NORMAL }}>Radiotherapy Chart</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 2.5, px: 0 }}>
        {renderMedicalRecord(radioFields, record, 'radiotherapy')}
        <RadioVitalsDisplay radioRecord={record} />
        <Box sx={{ p: 3, pt: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, mb: 1.5, fontFamily: FONT, textTransform: 'uppercase', color: C.textPrimary }}>Completed Investigations (Radiotherapy)</Typography>
          <CompletedInvestigationsTable 
            completedInvestigations={investigations} 
            doctorNamesMap={doctorNameMap} 
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export default RadioTherapyOverview;
