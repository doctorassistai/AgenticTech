import React, { useState, useEffect } from "react";
import { Box, Typography, TextField, Button, IconButton, Accordion, AccordionSummary, AccordionDetails, Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Dialog, DialogTitle, DialogContent, CircularProgress, TablePagination } from "@mui/material";
import { CloseRounded, SaveRounded, ExpandMoreRounded, MicRounded, StopRounded } from "@mui/icons-material";

import { getPatientVitals, getAnaesthesiaHistory, getDoctorsNoteSummary, generateDoctorsNarration, saveSection } from "./shared/api";
import { usePatientInfo } from "./shared/usePatientInfo";

import LabInvestigations, { STANDARD_LAB_FIELDS } from "../LabInvestigations";
import RadioTherapyOverview from "../RadioTherapyOverview";
import ChemotherapyChart from "../ChemotherapyChart";

import { C, FONT, FW_BOLD, FW_NORMAL, thSx, tdSx, inputSx, saveBtnSx, outlineBtnSx } from "../shared/designTokens";
import { SectionBox, FG, FieldLabel, ROInput, CbxGroup, RdoGroup, FlagNote } from "../shared/FormComponents";


const DoctorsNoteSummaryView = ({ patientId, history = [] }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [surgeryPage, setSurgeryPage] = useState(0);
  const surgeryRowsPerPage = 5;

  const handleSurgeryPageChange = (event, newPage) => {
    setSurgeryPage(newPage);
  };

  useEffect(() => {
    if (patientId) {
      setLoading(true);
      getDoctorsNoteSummary(patientId)
        .then(res => {
          if (res && res.data) {
            setSummary(res.data);
          }
        })
        .catch(err => console.error("Failed to fetch summary:", err))
        .finally(() => setLoading(false));
    }
  }, [patientId]);

  if (!summary || (Object.keys(summary.vitals).length === 0 && Object.keys(summary.labs).length === 0 && summary.past_surgeries.length === 0 && Object.keys(summary.assessment).length === 0)) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Patient Summary (Aggregated from Past Records)</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.white }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              {/* Clinical Overview Report */}
              {summary.clinical_overview && Object.keys(summary.clinical_overview).length > 0 && (
                <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 0, p: 2, background: C.bgSecondary }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, color: '#000', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clinical Overview</Typography>
                    {summary.clinical_overview.highRiskMDT && (
                      <Box sx={{ background: '#000', color: '#fff', px: 1, py: 0.2, borderRadius: 0, fontSize: 10, fontWeight: FW_NORMAL, textTransform: 'uppercase' }}>
                        High Risk MDT
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                    {summary.clinical_overview.diagnosis && (
                      <Box>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase' }}>Recent Diagnosis</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL }}>{summary.clinical_overview.diagnosis}</Typography>
                      </Box>
                    )}
                    {summary.clinical_overview.tumorInfo && (
                      <Box>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase' }}>Tumor Profile</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL }}>
                          {summary.clinical_overview.tumorInfo.staging && <span style={{ marginRight: 8, color: '#000' }}>{summary.clinical_overview.tumorInfo.staging}</span>}
                          {summary.clinical_overview.tumorInfo.size && <span style={{ marginRight: 8 }}>Size: {summary.clinical_overview.tumorInfo.size}</span>}
                          {summary.clinical_overview.tumorInfo.location && <span>Loc: {summary.clinical_overview.tumorInfo.location}</span>}
                        </Typography>
                      </Box>
                    )}
                    {summary.clinical_overview.findings && (
                      <Box sx={{ gridColumn: '1 / -1' }}>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase' }}>Key Findings</Typography>
                        <Typography sx={{ fontSize: 13 }}>{summary.clinical_overview.findings}</Typography>
                      </Box>
                    )}
                    {summary.clinical_overview.mdtComments && (
                      <Box sx={{ gridColumn: '1 / -1' }}>
                        <Typography sx={{ fontSize: 10, color: '#000', textTransform: 'uppercase' }}>MDT Comments</Typography>
                        <Typography sx={{ fontSize: 13, color: '#000' }}>{summary.clinical_overview.mdtComments}</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}

              {/* Critical Alerts */}
              {summary.critical_alerts && summary.critical_alerts.length > 0 && (
                <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 0, p: 2, background: C.bgSecondary, mb: 2 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, color: '#000', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>Critical Alerts</Typography>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {summary.critical_alerts.map((alert, idx) => (
                      <li key={idx}>
                        <Typography sx={{ fontSize: 13, color: '#000', fontWeight: FW_NORMAL }}>{alert}</Typography>
                      </li>
                    ))}
                  </ul>
                </Box>
              )}

              {/* Post Op Complications */}
              <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 0, p: 2, background: C.bgSecondary, mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, color: '#000', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>Past Post-Op Complications</Typography>
                {summary.past_post_op_complications && summary.past_post_op_complications.length > 0 ? (
                  <Typography sx={{ fontSize: 13, color: '#000' }}>
                    The patient had {summary.past_post_op_complications.join(", ")} in the past.
                  </Typography>
                ) : (
                  <Typography sx={{ fontSize: 13, color: C.textMuted }}>
                    No past post-op complications recorded.
                  </Typography>
                )}
              </Box>

              {/* Vitals & Assessment */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 300, border: `1px solid ${C.border}`, borderRadius: 0, p: 1.5, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 11, fontWeight: FW_NORMAL, color: C.textMuted, textTransform: 'uppercase', mb: 1 }}>Vitals Trend</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                    {Object.entries(summary.vitals).map(([k, v_list]) => (
                      <Box key={k} sx={{ background: C.white, px: 1.5, py: 0.5, border: `1px solid ${C.border}`, borderRadius: 0 }}>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', mb: 0.5 }}>{k}</Typography>
                        {Array.isArray(v_list) ? v_list.map((item, idx) => (
                          <Box key={idx} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, opacity: idx === 0 ? 1 : 0.6, mb: idx === v_list.length - 1 ? 0 : 0.2 }}>
                            <Typography sx={{ fontSize: idx === 0 ? 13 : 11, fontWeight: FW_NORMAL }}>{item.value}</Typography>
                            {idx > 0 && <Typography sx={{ fontSize: 9, color: C.textMuted }}>{item.date}</Typography>}
                            {idx === 0 && v_list.length > 1 && <Typography sx={{ fontSize: 9, color: '#333', fontStyle: 'italic', ml: 0.5 }}>Latest</Typography>}
                          </Box>
                        )) : <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL }}>{v_list}</Typography>}
                      </Box>
                    ))}
                    {Object.keys(summary.vitals).length === 0 && <Typography sx={{ fontSize: 12, color: C.textMuted }}>No vitals recorded.</Typography>}
                  </Box>
                </Box>

                <Box sx={{ flex: 1, minWidth: 300, border: `1px solid ${C.border}`, borderRadius: 0, p: 1.5, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 11, fontWeight: FW_NORMAL, color: C.textMuted, textTransform: 'uppercase', mb: 1 }}>Latest Assessment</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                    {Object.entries(summary.assessment).map(([k, v]) => (
                      <Box key={k} sx={{ background: C.white, px: 1.5, py: 0.5, border: `1px solid ${C.border}`, borderRadius: 0 }}>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase' }}>{k.replace(/([A-Z])/g, ' $1').trim()}</Typography>
                        <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL }}>{Array.isArray(v) ? v.join(', ') : v}</Typography>
                      </Box>
                    ))}
                    {Object.keys(summary.assessment).length === 0 && <Typography sx={{ fontSize: 12, color: C.textMuted }}>No assessments recorded.</Typography>}
                  </Box>
                </Box>
              </Box>

              {/* Labs */}
              <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 0, p: 1.5, background: C.bgSecondary }}>
                <Typography sx={{ fontSize: 11, fontWeight: FW_NORMAL, color: C.textMuted, textTransform: 'uppercase', mb: 1 }}>Lab Results Trend</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                  {Object.entries(summary.labs).map(([k, l_list]) => {
                    const standardField = STANDARD_LAB_FIELDS.find(f => f.key === k);
                    const label = standardField ? standardField.label : k;
                    return (
                      <Box key={k} sx={{ background: C.white, px: 1.5, py: 0.5, border: `1px solid ${C.border}`, borderRadius: 0 }}>
                        <Typography sx={{ fontSize: 10, color: C.textMuted }}>{label}</Typography>
                        {Array.isArray(l_list) ? l_list.map((item, idx) => {
                          const isAbnormal = item.flag && item.flag !== "";
                          const color = isAbnormal ? '#000' : 'inherit';
                          return (
                            <Box key={idx} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, opacity: idx === 0 ? 1 : 0.6, mb: idx === l_list.length - 1 ? 0 : 0.2 }}>
                              <Typography sx={{ fontSize: idx === 0 ? 13 : 11, fontWeight: FW_NORMAL, color }}>
                                {item.value} {item.flag && idx === 0 && <span style={{ fontSize: 10, fontStyle: 'italic', marginLeft: 4 }}>({item.flag})</span>}
                              </Typography>
                              {idx > 0 && <Typography sx={{ fontSize: 9, color: C.textMuted }}>{item.date}</Typography>}
                              {idx === 0 && l_list.length > 1 && <Typography sx={{ fontSize: 9, color: '#333', fontStyle: 'italic', ml: 0.5 }}>Latest</Typography>}
                            </Box>
                          );
                        }) : <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL }}>{l_list}</Typography>}
                      </Box>
                    )
                  })}
                  {Object.keys(summary.labs).length === 0 && <Typography sx={{ fontSize: 12, color: C.textMuted }}>No lab results recorded.</Typography>}
                </Box>
              </Box>

              {/* Surgeries */}
              {summary.past_surgeries.length > 0 && (
                <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 0, overflow: 'hidden' }}>
                  <Table size="small">
                    <TableHead sx={{ background: C.bgSecondary }}>
                      <TableRow>
                        <TableCell sx={{ ...thSx, py: 1 }}>Date</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Type of Surgery</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Case Status</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Procedure Name</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Laterality</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Surgeon</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Blood Loss</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Complications</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.past_surgeries
                        .slice(surgeryPage * surgeryRowsPerPage, surgeryPage * surgeryRowsPerPage + surgeryRowsPerPage)
                        .map((s, i) => {
                          const comps = summary.past_complications?.filter(c => c.date === s.date) || [];
                          const matchedHistory = history.find(h => {
                            const bd = h.fullBooking || h.booking || h;
                            return (bd.procedureName === s.procedure || h.procedure === s.procedure) || (bd.surgeryDate === s.date || h.date === s.date);
                          }) || {};

                          const bd = matchedHistory.fullBooking || matchedHistory.booking || matchedHistory;
                          const dn = matchedHistory.doctors_note || bd.doctors_note || {};
                          const pi = matchedHistory.anaesthesia?.pi || bd.anaesthesia?.pi || {};

                          const caseStatus = dn.caseStatus || pi.caseStatus || bd.caseStatus || matchedHistory.caseStatus || s.caseStatus || "—";
                          const laterality = dn.laterality || pi.laterality || bd.laterality || matchedHistory.laterality || s.laterality || "—";

                          const stRaw = dn.surgeryType || pi.surgeryType || bd.surgeryType || matchedHistory.surgeryType || s.surgeryType || s.typeOfSurgery;
                          const surgeryType = (Array.isArray(stRaw) ? stRaw.join(', ') : stRaw) || "—";

                          const procedureName = dn.procedureName || pi.procedureName || bd.procedureName || matchedHistory.procedureName || s.procedureName || s.procedure || "—";

                          return (
                            <TableRow key={i}>
                              <TableCell sx={tdSx}>{s.date || "—"}</TableCell>
                              <TableCell sx={tdSx}>{surgeryType}</TableCell>
                              <TableCell sx={tdSx}>{caseStatus}</TableCell>
                              <TableCell sx={tdSx}>{procedureName}</TableCell>
                              <TableCell sx={tdSx}>{laterality}</TableCell>
                              <TableCell sx={tdSx}>{s.surgeon || "—"}</TableCell>
                              <TableCell sx={tdSx}>{s.bloodLoss || "—"}</TableCell>
                              <TableCell sx={tdSx}>
                                {comps.length > 0 ? comps.map((c, j) => (
                                  <Typography key={j} sx={{ fontSize: 12, color: '#000' }}>
                                    {Array.isArray(c.complications) ? c.complications.join(', ') : c.complications}
                                    {c.details && ` (${c.details})`}
                                  </Typography>
                                )) : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  {summary.past_surgeries.length > surgeryRowsPerPage && (
                    <TablePagination
                      component="div"
                      count={summary.past_surgeries.length}
                      page={surgeryPage}
                      onPageChange={handleSurgeryPageChange}
                      rowsPerPage={surgeryRowsPerPage}
                      rowsPerPageOptions={[5]}
                    />
                  )}
                </Box>
              )}
            </Box>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

const DoctorsNoteHistoryTable = ({ history = [], currentBookingId }) => {
  const [expanded, setExpanded] = useState(false);
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });

  const historyData = history.filter(b => b.booking_id !== currentBookingId);
  if (historyData.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_BOLD, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Past Doctors Note / Pre-Induction Records ({historyData.length})</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0, borderTop: `1px solid ${C.border}` }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>Procedure</TableCell>
                  <TableCell sx={thSx}>Surgeon</TableCell>
                  <TableCell sx={thSx}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyData.map((b, i) => {
                  const bd = b.fullBooking || b;
                  // Handle legacy 'pi' and new 'doctors_note'
                  const sectionData = bd.doctors_note || bd.anaesthesia?.pi || b.doctors_note || b.anaesthesia?.pi;

                  let hasData = false;
                  if (sectionData && typeof sectionData === 'object' && !Array.isArray(sectionData)) {
                    hasData = Object.entries(sectionData).some(([k, v]) => k !== 'patientId' && v !== "" && v !== null && (!Array.isArray(v) || v.length > 0));
                  }

                  return (
                    <TableRow key={i} sx={{ "&:hover": { background: C.bgPrimary } }}>
                      <TableCell sx={tdSx}>{bd.surgeryDate || b.date}</TableCell>
                      <TableCell sx={tdSx}>{bd.procedureName || b.procedure}</TableCell>
                      <TableCell sx={tdSx}>{bd.surgeonName || bd.treatingDoctor || b.surgeon}</TableCell>
                      <TableCell sx={tdSx}>
                        <Button disabled={!hasData} size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, borderColor: hasData ? C.primary : C.border, color: hasData ? C.primary : C.textMuted }} onClick={() => setViewDialog({ open: true, data: sectionData })}>
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
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Past Details</Typography>
          <IconButton onClick={() => setViewDialog({ open: false, data: null })} size="small"><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Recorded Data</Typography>
            <FG cols={3}>
              {viewDialog.data && Object.entries(viewDialog.data).map(([k, v]) => {
                if (k === 'patientId') return null;
                if (k === 'labOrder') return <ROInput key={k} label="Lab Order" value={v?.status ? `Status: ${v.status}` : "-"} />;
                if (k === 'labResults') return <ROInput key={k} label="Lab Results" value={v?.approved ? "Approved" : "Pending"} />;

                let displayVal = "-";
                if (Array.isArray(v)) {
                  displayVal = v.length > 0 ? v.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(", ") : "-";
                }
                else if (typeof v === 'object' && v !== null) {
                  displayVal = "Data Recorded (Complex)";
                }
                else if (v !== "" && v !== null && v !== undefined) {
                  displayVal = String(v);
                }
                return <ROInput key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} value={displayVal} />;
              })}
            </FG>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};


const OncologyRecordsView = ({ patientId }) => {
  return (
    <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <ChemotherapyChart patientId={patientId} />
      <RadioTherapyOverview patientId={patientId} />
    </Box>
  );
};

const DoctorsNoteTab = ({ patientId, doctorId, doctorName, bookingData, currentBookingId, onSave, initialPI = {} }) => {
  const [history, setHistory] = useState([]);
  const [investigationsData, setInvestigationsData] = useState({});

  useEffect(() => {
    if (patientId) {
      getAnaesthesiaHistory(patientId)
        .then(res => {
          if (res && res.data) setHistory(res.data);
        })
        .catch(err => console.error("[DoctorsNoteTab] Failed to fetch history:", err));
    }
  }, [patientId]);

  const [pi, setPi] = useState({
    patientId: patientId || "", patientName: "", ageSex: "", height: "", weight: "",
    wardBed: "", unitName: "", treatingDoctor: doctorName || "",
    surgery: "", asaStatus: [], aspirationRisk: "", bloodConfirmed: "",
    surgeryType: [], machineCheck: "", informedConsent: [], premedication: [],
    premedicationDetails: "", bp: "", rr: "", pr: "", spo2: "", temperature: "", consciousness: "",
    // Pre-Op Clinical Staging (cTNM)
    clinicalStagingT: "", clinicalStagingN: "", clinicalStagingM: "",
    clinicalStageGroup: "", clinicalDiagnosis: "", clinicalStagingBasis: [],
    clinicalStagingNotes: "",
    ...initialPI,
  });
  const spi = (k, v) => setPi(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (patientId) {
      getPatientVitals(patientId)
        .then(res => {
          if (res && res.data) {
            const v = res.data;
            setPi(p => ({
              ...p,
              bp: p.bp || (v.blood_pressure ? String(v.blood_pressure).replace(" mmHg", "") : ""),
              rr: p.rr || (v.respiratory_rate ? String(v.respiratory_rate).replace("/min", "") : ""),
              pr: p.pr || (v.pulse ? String(v.pulse).replace(" bpm", "") : ""),
              spo2: p.spo2 || (v.spo2 ? String(v.spo2).replace("%", "") : ""),
              temperature: p.temperature || (v.temperature ? String(v.temperature).replace("°C", "") : ""),
              height: p.height || (v.height ? String(v.height).replace(" cm", "") : ""),
              weight: p.weight || (v.weight ? String(v.weight).replace(" kg", "") : ""),
            }));
          }
        })
        .catch(err => console.error("[DoctorsNoteTab] Failed to fetch vitals:", err));
    }
  }, [patientId]);

  // Doctors Narration State
  const [narrationState, setNarrationState] = useState({
    transcript: initialPI?.narration?.transcript || "",
    narrationText: initialPI?.narration?.narrationText || "",
    synopticText: initialPI?.narration?.synopticText || "",
  });

  useEffect(() => {
    if (initialPI?.narration) {
      setNarrationState(prev => ({
        transcript: initialPI.narration.transcript || prev.transcript,
        narrationText: initialPI.narration.narrationText || prev.narrationText,
        synopticText: initialPI.narration.synopticText || prev.synopticText,
      }));
      setNarrationExpanded(
        !!(initialPI.narration.transcript || initialPI.narration.narrationText || initialPI.narration.synopticText)
      );
    }
  }, [initialPI]);

  const [isRecordingNarration, setIsRecordingNarration] = useState(false);
  const [isProcessingNarration, setIsProcessingNarration] = useState(false);
  const [isGeneratingNarration, setIsGeneratingNarration] = useState(false);
  const narrationMediaRecorderRef = React.useRef(null);
  const narrationAudioChunksRef = React.useRef([]);
  const [narrationExpanded, setNarrationExpanded] = useState(
    !!(initialPI?.narration?.transcript || initialPI?.narration?.narrationText || initialPI?.narration?.synopticText)
  );

  const startNarrationRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      narrationMediaRecorderRef.current = new MediaRecorder(stream);
      narrationAudioChunksRef.current = [];
      narrationMediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) narrationAudioChunksRef.current.push(e.data);
      };
      narrationMediaRecorderRef.current.start();
      setIsRecordingNarration(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopNarrationRecording = () => {
    if (narrationMediaRecorderRef.current && isRecordingNarration) {
      narrationMediaRecorderRef.current.onstop = async () => {
        setIsRecordingNarration(false);
        setIsProcessingNarration(true);
        const audioBlob = new Blob(narrationAudioChunksRef.current, { type: "audio/webm" });
        narrationAudioChunksRef.current = [];

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");
          const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
          const data = await res.json();
          const transcribedText = data.text || data.transcription || "";

          if (transcribedText) {
            setNarrationState(p => ({ ...p, transcript: p.transcript ? p.transcript + " " + transcribedText : transcribedText }));
          }
        } catch (err) {
          console.error("Error processing narration audio:", err);
          alert("Error transcribing voice narration.");
        } finally {
          setIsProcessingNarration(false);
        }
      };
      narrationMediaRecorderRef.current.stop();
      narrationMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleGenerateNarration = async () => {
    if (!narrationState.transcript) return;
    setIsGeneratingNarration(true);
    try {
      const res = await generateDoctorsNarration(currentBookingId, patientId, narrationState.transcript);
      if (res.status === "success" && res.data) {
        const parseOutput = (node, depth = 0) => {
          if (!node) return "";
          if (typeof node === 'string') return node;
          const indent = '  '.repeat(depth);
          if (Array.isArray(node)) {
            return node.map(item => {
              if (typeof item === 'object' && item !== null) {
                const str = Object.entries(item).map(([k, v]) => {
                  if (typeof v === 'object') return `${k}: ${JSON.stringify(v)}`;
                  return `${k}: ${v}`;
                }).join(', ');
                return `${indent}- ${str}`;
              }
              return `${indent}- ${item}`;
            }).join('\n');
          }
          if (typeof node === 'object') {
            return Object.entries(node).map(([k, v]) => {
              if (typeof v === 'object' && v !== null) {
                return `${indent}${k}:\n${parseOutput(v, depth + 1)}`;
              }
              return `${indent}${k}: ${v}`;
            }).join('\n');
          }
          return String(node);
        };

        setNarrationState(p => ({
          ...p,
          narrationText: parseOutput(res.data.narration),
          synopticText: parseOutput(res.data.synoptic)
        }));
      }
    } catch (error) {
      console.error("Error generating doctors narration:", error);
      alert("Failed to generate narration.");
    } finally {
      setIsGeneratingNarration(false);
    }
  };

  const handleSaveNarration = async () => {
    try {
      await saveSection(currentBookingId, "doctors_note.narration", narrationState);
      alert("Doctors Narration saved successfully!");
    } catch (err) {
      console.error("Failed to save narration", err);
      alert("Failed to save Doctors Narration");
    }
  };

  useEffect(() => {
    // Prefill Type of Surgery
    const fb = bookingData?.fullBooking || bookingData?.booking || bookingData || {};
    const bookingSurgeryType = fb.surgeryType || fb.typeOfSurgery || fb.type_of_surgery || fb.caseStatus;
    if (bookingSurgeryType) {
      setPi(prev => {
        if (prev.surgeryType && prev.surgeryType.length > 0) return prev;
        const validOptions = ["Primary", "Adjunct", "Reconstructive"];
        let arr = Array.isArray(bookingSurgeryType) ? bookingSurgeryType : [bookingSurgeryType];
        arr = arr.map(x => typeof x === 'string' ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x);
        const matched = arr.filter(x => validOptions.includes(x));
        if (matched.length > 0) {
          return { ...prev, surgeryType: matched };
        }
        return prev;
      });
    }
  }, [bookingData]);

  const patientInfo = usePatientInfo(patientId);
  useEffect(() => {
    if (patientInfo.name) {
      setPi(p => ({ ...p, patientName: patientInfo.name, ageSex: patientInfo.ageSex }));
    }
  }, [patientInfo.name, patientInfo.ageSex]);

  const currentProcedure = bookingData?.booking?.procedureName || bookingData?.procedureName || "";

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Accordion expanded={narrationExpanded} onChange={() => setNarrationExpanded(!narrationExpanded)} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
            <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Doctors Narration</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.white }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT }}>Voice Dictation / Transcript</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    value={narrationState.transcript}
                    onChange={e => setNarrationState(p => ({ ...p, transcript: e.target.value }))}
                    sx={inputSx}
                    placeholder="Click microphone to dictate or type transcript here..."
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <IconButton
                      onClick={isRecordingNarration ? stopNarrationRecording : startNarrationRecording}
                      sx={{
                        background: isRecordingNarration ? '#000' : '#fff',
                        color: isRecordingNarration ? '#fff' : '#000',
                        border: '1px solid #000',
                        borderRadius: 1,
                        width: 36,
                        height: 36,
                        '&:hover': { background: isRecordingNarration ? '#333' : '#f5f5f5' }
                      }}
                    >
                      {isRecordingNarration ? <StopRounded /> : <MicRounded />}
                    </IconButton>
                    {isProcessingNarration && <Typography sx={{ fontSize: 10, color: C.textMuted }}>Transcribing audio...</Typography>}
                  </Box>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleGenerateNarration}
                  disabled={!narrationState.transcript || isGeneratingNarration}
                  sx={{ ...outlineBtnSx }}
                >
                  {isGeneratingNarration ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                  Generate Narration & Synoptic Note
                </Button>
              </Box>

              {(narrationState.narrationText || narrationState.synopticText) && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT }}>Generated Narration</Typography>
                    <TextField
                      fullWidth
                      multiline
                      rows={10}
                      value={narrationState.narrationText}
                      onChange={e => setNarrationState(p => ({ ...p, narrationText: e.target.value }))}
                      sx={inputSx}
                    />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT }}>Synoptic Format</Typography>
                    <TextField
                      fullWidth
                      multiline
                      rows={10}
                      value={narrationState.synopticText}
                      onChange={e => setNarrationState(p => ({ ...p, synopticText: e.target.value }))}
                      sx={inputSx}
                    />
                  </Box>
                </Box>
              )}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                <Button variant="contained" size="small" onClick={handleSaveNarration} sx={saveBtnSx} startIcon={<SaveRounded />}>
                  Save Narration
                </Button>
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>
      </Box>

      <DoctorsNoteSummaryView patientId={patientId} history={history} />
      <DoctorsNoteHistoryTable history={history} currentBookingId={currentBookingId} />
      <OncologyRecordsView patientId={patientId} />
      <SectionBox title="Primary Details">
        <FG cols={4}>
          <TextField label="Patient ID *" value={pi.patientId} size="small"
            onChange={e => spi("patientId", e.target.value)} sx={inputSx} fullWidth />
          <ROInput label="Patient Name" value={pi.patientName} />
          <ROInput label="Age/Sex" value={pi.ageSex} />
          <TextField label="Height (cm)" value={pi.height} size="small" onChange={e => spi("height", e.target.value)} sx={inputSx} fullWidth />
          <TextField label="Weight (kg)" value={pi.weight} size="small" onChange={e => spi("weight", e.target.value)} sx={inputSx} fullWidth />
          <TextField label="Ward/Bed" value={pi.wardBed} size="small" onChange={e => spi("wardBed", e.target.value)} sx={inputSx} fullWidth />
          <TextField label="Unit Name" value={pi.unitName} size="small" onChange={e => spi("unitName", e.target.value)} sx={inputSx} fullWidth />
          <TextField label="Treating Doctor" value={pi.treatingDoctor} size="small" onChange={e => spi("treatingDoctor", e.target.value)} sx={inputSx} fullWidth />
        </FG>
      </SectionBox>
      <SectionBox title="Pre-Induction Assessment">
        <FG cols={3}>
          <TextField label="Surgery" value={pi.surgery} size="small" onChange={e => spi("surgery", e.target.value)} sx={inputSx} fullWidth />
          <Box><TextField label="ASA Physical Status Class" value={pi.asaStatus} size="small" onChange={e => spi("asaStatus", e.target.value)} sx={inputSx} fullWidth /></Box>
          <Box><RdoGroup label="Aspiration Risk" options={["Yes", "No"]} value={pi.aspirationRisk} onChange={v => spi("aspirationRisk", v)} /></Box>
          <Box><RdoGroup label="Blood Confirmed" options={["Yes", "No", "Not Applicable"]} value={pi.bloodConfirmed} onChange={v => spi("bloodConfirmed", v)} /></Box>
          <Box><CbxGroup label="Type of Surgery" options={["Primary", "Adjunct", "Reconstructive"]} value={pi.surgeryType} onChange={v => spi("surgeryType", v)} /></Box>
          <RdoGroup label="Anaesthesia Machine Check" options={["Yes", "No"]} value={pi.machineCheck} onChange={v => spi("machineCheck", v)} />
          <CbxGroup label="Informed Consent" options={["Standard", "High Risk"]} value={pi.informedConsent} onChange={v => spi("informedConsent", v)} />
          <CbxGroup label="Premedication" options={["Anxiolytic", "Antisialagogues", "Analgesic", "Others"]} value={pi.premedication} onChange={v => spi("premedication", v)} />
          <Box sx={{ gridColumn: "1/-1" }}>
            <TextField label="Premedication Details (Drug, Route, Dose)" value={pi.premedicationDetails} size="small" multiline rows={2} onChange={e => spi("premedicationDetails", e.target.value)} sx={inputSx} fullWidth />
          </Box>
        </FG>
      </SectionBox>
      <SectionBox title="Pre-Induction Vitals">
        <FG cols={3}>
          <Box><TextField label="BP (mmHg)" value={pi.bp} size="small" onChange={e => spi("bp", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., 120/80" /><FlagNote>Flag if &lt;90/50 or &gt;180/110</FlagNote></Box>
          <Box><TextField label="RR (breaths/min)" value={pi.rr} type="number" size="small" onChange={e => spi("rr", e.target.value)} sx={inputSx} fullWidth /><FlagNote>Flag if &lt;10 or &gt;20</FlagNote></Box>
          <Box><TextField label="PR (bpm)" value={pi.pr} type="number" size="small" onChange={e => spi("pr", e.target.value)} sx={inputSx} fullWidth /><FlagNote>Flag if &lt;50 or &gt;120</FlagNote></Box>
          <Box><TextField label="SpO2 (%)" value={pi.spo2} type="number" size="small" onChange={e => spi("spo2", e.target.value)} sx={inputSx} fullWidth /><FlagNote>Flag if &lt;95%</FlagNote></Box>
          <Box><TextField label="Temperature (°C)" value={pi.temperature} type="number" size="small" onChange={e => spi("temperature", e.target.value)} sx={inputSx} fullWidth /><FlagNote>Flag if &gt;100°F</FlagNote></Box>
          <RdoGroup label="Consciousness Status" options={["Normal", "Obtunded", "Unconscious"]} value={pi.consciousness} onChange={v => spi("consciousness", v)} />
        </FG>
      </SectionBox>

      <SectionBox title="Pre-Op Clinical Staging (cTNM)">
        <FG cols={3}>
          <Box>
            <FieldLabel>Clinical TNM</FieldLabel>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField label="cT" value={pi.clinicalStagingT} size="small" onChange={e => spi("clinicalStagingT", e.target.value)} sx={inputSx} fullWidth placeholder="T0-T4" />
              <TextField label="cN" value={pi.clinicalStagingN} size="small" onChange={e => spi("clinicalStagingN", e.target.value)} sx={inputSx} fullWidth placeholder="N0-N3" />
              <TextField label="cM" value={pi.clinicalStagingM} size="small" onChange={e => spi("clinicalStagingM", e.target.value)} sx={inputSx} fullWidth placeholder="M0/M1" />
            </Box>
          </Box>
          <TextField label="Overall cStage" value={pi.clinicalStageGroup} size="small" onChange={e => spi("clinicalStageGroup", e.target.value)} sx={inputSx} fullWidth placeholder="e.g. IIA, III" />
          <TextField label="Pre-Op Diagnosis / Primary Site" value={pi.clinicalDiagnosis} size="small" onChange={e => spi("clinicalDiagnosis", e.target.value)} sx={inputSx} fullWidth />
          <Box sx={{ gridColumn: "1/-1" }}>
            <CbxGroup label="Basis of Staging" options={["CT Scan", "MRI", "PET-CT", "Biopsy", "USG", "Clinical Examination"]} value={pi.clinicalStagingBasis} onChange={v => spi("clinicalStagingBasis", v)} />
          </Box>
          <Box sx={{ gridColumn: "1/-1" }}>
            <TextField label="Notes" value={pi.clinicalStagingNotes} size="small" multiline rows={2} onChange={e => spi("clinicalStagingNotes", e.target.value)} sx={inputSx} fullWidth placeholder="Additional staging notes, MDT comments, etc." />
          </Box>
        </FG>
      </SectionBox>

      <LabInvestigations
        patientId={patientId}
        doctorId={doctorId}
        currentBookingId={currentBookingId}
        currentProcedure={currentProcedure}
        bookingData={bookingData}
        onChange={setInvestigationsData}
      />

      <Button sx={saveBtnSx} onClick={() => {
        const payload = {
          ...(bookingData?.doctors_note || {}),
          ...pi,
          ...(investigationsData || {}),
        };
        onSave("doctors_note", payload);
      }}>
        <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Doctors Note
      </Button>
    </Box>
  );
};

export default DoctorsNoteTab;