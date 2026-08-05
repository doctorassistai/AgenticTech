import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Paper,
  Divider,
  Grid
} from "@mui/material";
import { motion } from "framer-motion";
import {
  LocalHospitalRounded,
  MedicationRounded,
  ScienceRounded,
  AssignmentRounded,
  TimelineRounded,
  CheckCircleRounded,
  WarningRounded,
  ThumbUpRounded,
  BuildRounded,
  LoopRounded,
  AssessmentRounded
} from "@mui/icons-material";

// ─── BRAND TOKENS ─────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';

const C = {
  black:       "#000000",
  white:       "#ffffff",
  bgPrimary:   "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary:  "#f5f5f5",
  textPrimary: "#000000",
  textSecond:  "#444444",
  textMuted:   "#888888",
  border:      "#e0e0e0",
  borderStrong:"#000000",
};

// ─── THEME ───
const theme = {
  bg: '#ffffff',
  bgSecondary: '#fafafa',
  bgTertiary: '#f5f5f5',
  textPrimary: '#000000',
  textSecondary: '#444444',
  textMuted: '#888888',
  border: '#e0e0e0',
  borderStrong: '#000000',
  accent: '#000000',
  accentFg: '#ffffff',
  fontFamily: '"Open Sans", sans-serif',
};

const labelStyle = {
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: C.textMuted,
  fontFamily: FONT,
  fontWeight: 400,
};

// ─── TABLE STYLES ─────────────────────────────────────────────────────────────
const th = {
  textAlign: "left",
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 400,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: C.textMuted,
  padding: "10px 16px",
  borderBottom: `1px solid ${C.border}`,
  borderRight: `1px solid ${C.border}`,
  background: C.bgSecondary,
  whiteSpace: "nowrap",
};

const thLast = { ...th, borderRight: "none" };

const td = {
  fontFamily: FONT,
  fontSize: 13,
  fontWeight: 300,
  color: C.textSecond,
  padding: "10px 16px",
  verticalAlign: "top",
  borderRight: `1px solid ${C.border}`,
};

const tdLast = { ...td, borderRight: "none" };

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────
const prettifyKey = (key) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const getUrgencyColor = (urgency) => {
  const u = (urgency || '').toLowerCase();
  if (u === 'stat') return { bg: C.black, color: C.white };
  if (u === 'urgent') return { bg: C.bgTertiary, color: C.textSecond };
  return { bg: C.bgSecondary, color: C.textMuted };
};

const getIntentIcon = (intent) => {
  switch(intent?.toLowerCase()) {
    case 'curative': return <LocalHospitalRounded sx={{ fontSize: '0.9rem' }} />;
    case 'palliative': return <TimelineRounded sx={{ fontSize: '0.9rem' }} />;
    case 'supportive': return <AssignmentRounded sx={{ fontSize: '0.9rem' }} />;
    case 'symptom_control': return <AssessmentRounded sx={{ fontSize: '0.9rem' }} />;
    default: return <LocalHospitalRounded sx={{ fontSize: '0.9rem' }} />;
  }
};

// ─── RENDER TABLES FOR STRUCTURED DATA ────────────────────────────────────────

const renderPrimaryGoals = (structuredData) => {
  if (!structuredData?.primaryGoals?.length) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Primary Goals
        </Typography>
      </Box>
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: `1px solid ${C.border}`, borderRadius: 0 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: C.bgSecondary }}>
              <TableCell sx={{ ...th, width: 50 }}>#</TableCell>
              <TableCell sx={thLast}>Goal Description</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {structuredData.primaryGoals.map((goal, idx) => (
              <TableRow key={idx} sx={{ '&:hover': { backgroundColor: C.bgSecondary } }}>
                <TableCell sx={{ ...td, width: 50, color: C.textMuted }}>{idx + 1}</TableCell>
                <TableCell sx={tdLast}>{goal}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const renderMedications = (structuredData) => {
  if (!structuredData?.medications?.length) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <MedicationRounded sx={{ fontSize: '0.9rem', color: C.textMuted }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Medications
        </Typography>
      </Box>
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: `1px solid ${C.border}`, borderRadius: 0, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: C.bgSecondary }}>
              <TableCell sx={th}>Medication</TableCell>
              <TableCell sx={th}>Dose</TableCell>
              <TableCell sx={th}>Frequency</TableCell>
              <TableCell sx={th}>Indication</TableCell>
              <TableCell sx={thLast}>Guideline</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {structuredData.medications.map((med, idx) => (
              <TableRow key={idx} sx={{ '&:hover': { backgroundColor: C.bgSecondary } }}>
                <TableCell sx={td}>{med.name || '-'}</TableCell>
                <TableCell sx={td}>{med.dose || '-'}</TableCell>
                <TableCell sx={td}>{med.frequency || '-'}</TableCell>
                <TableCell sx={td}>{med.indication || '-'}</TableCell>
                <TableCell sx={tdLast}>
                  {med.guideline ? (
                    <Typography variant="caption" sx={{ fontSize: '0.7rem', color: C.textMuted }}>
                      {med.guideline.substring(0, 60)}...
                    </Typography>
                  ) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const renderProcedures = (structuredData) => {
  const procedures = structuredData?.recommendedProcedures || structuredData?.procedures || [];
  if (!procedures.length) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <AssignmentRounded sx={{ fontSize: '0.9rem', color: C.textMuted }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Recommended Procedures
        </Typography>
      </Box>
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: `1px solid ${C.border}`, borderRadius: 0, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: C.bgSecondary }}>
              <TableCell sx={th}>Procedure</TableCell>
              <TableCell sx={th}>Timing</TableCell>
              <TableCell sx={th}>Indication</TableCell>
              <TableCell sx={thLast}>Guideline</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {procedures.map((proc, idx) => {
              const name = proc.name || proc.procedure_name || '-';
              const timing = proc.timing || '-';
              const indication = proc.indication || '-';
              const guideline = proc.guideline || proc.guideline_rationale;
              return (
                <TableRow key={idx} sx={{ '&:hover': { backgroundColor: C.bgSecondary } }}>
                  <TableCell sx={td}>{name}</TableCell>
                  <TableCell sx={td}>{timing}</TableCell>
                  <TableCell sx={td}>{indication}</TableCell>
                  <TableCell sx={tdLast}>
                    {guideline ? (
                      <Typography variant="caption" sx={{ fontSize: '0.7rem', color: C.textMuted }}>
                        {guideline.substring(0, 60)}...
                      </Typography>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const renderInvestigations = (structuredData) => {
  if (!structuredData?.investigations?.length) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <ScienceRounded sx={{ fontSize: '0.9rem', color: C.textMuted }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Investigations
        </Typography>
      </Box>
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: `1px solid ${C.border}`, borderRadius: 0, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: C.bgSecondary }}>
              <TableCell sx={th}>Test Name</TableCell>
              <TableCell sx={th}>Urgency</TableCell>
              <TableCell sx={thLast}>Indication</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {structuredData.investigations.map((inv, idx) => {
              const urgencyStyle = getUrgencyColor(inv.urgency);
              return (
                <TableRow key={idx} sx={{ '&:hover': { backgroundColor: C.bgSecondary } }}>
                  <TableCell sx={td}>{inv.name || '-'}</TableCell>
                  <TableCell sx={td}>
                    {inv.urgency && (
                      <Chip
                        label={inv.urgency.toUpperCase()}
                        size="small"
                        sx={{
                          borderRadius: 0,
                          fontSize: '0.6rem',
                          height: 20,
                          backgroundColor: urgencyStyle.bg,
                          color: urgencyStyle.color,
                          fontFamily: FONT
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell sx={tdLast}>{inv.indication || '-'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const renderLifestyleModifications = (structuredData) => {
  if (!structuredData?.lifestyleModifications?.length) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <AssignmentRounded sx={{ fontSize: '0.9rem', color: C.textMuted }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Lifestyle Modifications
        </Typography>
      </Box>
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: `1px solid ${C.border}`, borderRadius: 0 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: C.bgSecondary }}>
              <TableCell sx={th}>Recommendation</TableCell>
              <TableCell sx={th}>Evidence</TableCell>
              <TableCell sx={thLast}>Difficulty</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {structuredData.lifestyleModifications.map((mod, idx) => (
              <TableRow key={idx} sx={{ '&:hover': { backgroundColor: C.bgSecondary } }}>
                <TableCell sx={td}>{mod.recommendation || '-'}</TableCell>
                <TableCell sx={td}>
                  {mod.evidence && (
                    <Chip
                      label={`Level ${mod.evidence}`}
                      size="small"
                      sx={{
                        borderRadius: 0,
                        fontSize: '0.6rem',
                        height: 20,
                        border: `1px solid ${C.border}`,
                        backgroundColor: 'transparent'
                      }}
                    />
                  )}
                </TableCell>
                <TableCell sx={tdLast}>
                  {mod.difficulty && (
                    <Chip
                      label={mod.difficulty}
                      size="small"
                      sx={{
                        borderRadius: 0,
                        fontSize: '0.6rem',
                        height: 20,
                        backgroundColor: mod.difficulty === 'difficult' ? C.black : C.bgTertiary,
                        color: mod.difficulty === 'difficult' ? C.white : C.textSecond
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const renderFollowUpPlan = (structuredData) => {
  if (!structuredData?.followUpPlan) return null;
  
  const { nextVisit, monitoringParameters } = structuredData.followUpPlan;
  if (!nextVisit && (!monitoringParameters || monitoringParameters.length === 0)) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <TimelineRounded sx={{ fontSize: '0.9rem', color: C.textMuted }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Follow-up Plan
        </Typography>
      </Box>
      <TableContainer component={Paper} sx={{ boxShadow: 'none', border: `1px solid ${C.border}`, borderRadius: 0 }}>
        <Table size="small">
          <TableBody>
            {nextVisit && (
              <TableRow>
                <TableCell sx={{ ...th, width: 150, borderRight: `1px solid ${C.border}` }}>Next Visit</TableCell>
                <TableCell sx={tdLast}>
                  <Chip
                    label={nextVisit}
                    size="small"
                    sx={{
                      borderRadius: 0,
                      backgroundColor: C.black,
                      color: C.white,
                      fontSize: '0.7rem',
                      height: 24
                    }}
                  />
                </TableCell>
              </TableRow>
            )}
            {monitoringParameters && monitoringParameters.length > 0 && (
              <TableRow>
                <TableCell sx={{ ...th, width: 150, borderRight: `1px solid ${C.border}`, verticalAlign: 'top' }}>Monitoring Parameters</TableCell>
                <TableCell sx={tdLast}>
                  {monitoringParameters.map((param, idx) => (
                    <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: idx < monitoringParameters.length - 1 ? 1 : 0 }}>
                      <Box sx={{ width: 4, height: 4, backgroundColor: C.textMuted, borderRadius: '50%' }} />
                      <Typography sx={{ fontSize: '0.8rem', color: C.textSecond }}>{param}</Typography>
                    </Box>
                  ))}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const renderIntentAlignment = (finaloutput) => {
  const alignment = finaloutput?.intent_alignment;
  if (!alignment || alignment.intent === 'none') return null;
  
  const isAligned = alignment.alignment_status === 'aligned';
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', gap: 1.5,
        px: 1.5, py: 0.75,
        border: `1px solid ${C.border}`,
        backgroundColor: C.bgSecondary,
      }}>
        {getIntentIcon(alignment.intent)}
        <Typography sx={{
          fontFamily: FONT, fontSize: '0.7rem', fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {alignment.intent} · {alignment.alignment_status}
        </Typography>
        {isAligned ? (
          <CheckCircleRounded sx={{ fontSize: '0.8rem', color: C.textMuted }} />
        ) : (
          <WarningRounded sx={{ fontSize: '0.8rem', color: C.textMuted }} />
        )}
      </Box>
      
      {alignment.misalignment_flag && alignment.misalignment_flag.trim() !== "" && (
        <Box sx={{ mt: 1.5, p: 1.5, borderLeft: `3px solid ${C.black}`, backgroundColor: C.bgSecondary }}>
          <Typography sx={{ fontSize: '0.75rem', color: C.textSecond, lineHeight: 1.6 }}>
            {alignment.misalignment_flag}
          </Typography>
          {alignment.notes && (
            <Typography sx={{ fontSize: '0.7rem', color: C.textMuted, mt: 0.75, fontStyle: 'italic' }}>
              Note: {alignment.notes}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};

const renderClinicalEvaluation = (finaloutput) => {
  const evaluation = finaloutput?.clinical_evaluation || finaloutput?.evaluation;
  if (!evaluation) return null;
  
  const evaluationItems = [
    { key: 'standard_of_care_alignment', label: 'Standard of Care', value: evaluation.standard_of_care_alignment || evaluation.appropriateness },
    { key: 'practical_feasibility', label: 'Feasibility', value: evaluation.practical_feasibility || evaluation.safety },
    { key: 'doability_and_sustainability', label: 'Sustainability', value: evaluation.doability_and_sustainability || evaluation.completeness }
  ].filter(item => item.value && item.value.trim() !== "");
  
  if (evaluationItems.length === 0) return null;
  
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 16, backgroundColor: C.black }} />
        <AssessmentRounded sx={{ fontSize: '0.9rem', color: C.textMuted }} />
        <Typography sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, fontWeight: 600 }}>
          Clinical Evaluation
        </Typography>
      </Box>
      <Grid container spacing={1.5}>
        {evaluationItems.map((item) => (
          <Grid item xs={12} md={4} key={item.key}>
            <Paper elevation={0} sx={{ p: 1.5, border: `1px solid ${C.border}`, backgroundColor: C.bgSecondary }}>
              <Typography sx={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, mb: 0.5, fontWeight: 600 }}>
                {item.label}
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: C.textSecond, lineHeight: 1.5 }}>
                {item.value}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

const renderFullTreatmentPlan = (finaloutput) => {
  if (!finaloutput) return null;
  
  const structured = finaloutput.processed_treatment_plan?.structured_data;
  
  if (!structured || Object.keys(structured).length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: C.textMuted }}>
        No structured treatment plan data available
      </Box>
    );
  }
  
  return (
    <Box sx={{ mt: 2 }}>
      {renderIntentAlignment(finaloutput)}
      {renderPrimaryGoals(structured)}
      {renderMedications(structured)}
      {renderProcedures(structured)}
      {renderInvestigations(structured)}
      {renderLifestyleModifications(structured)}
      {renderFollowUpPlan(structured)}
      {renderClinicalEvaluation(finaloutput)}
    </Box>
  );
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function TreatmentPlanPanel({ patientId, doctorId }) {
  console.log("🚨 ACTIVE TreatmentPlanPanel", patientId, doctorId);

  const [plans, setPlans]               = useState([]);
  const [page, setPage]                 = useState(0);
  const PAGE_SIZE = 5;
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [hasMore, setHasMore]           = useState(true);

  const fetchTreatmentPlans = async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const offset = page * PAGE_SIZE;
      const url = `${import.meta.env.VITE_BACKEND_URL}hms/users/data/context/documentation-treatment-plans/${patientId}/${doctorId}?limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url);
      if (res.status === 404) { setPlans([]); setHasMore(false); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        setPlans(json.data);
        setHasMore(json.data.length === PAGE_SIZE);
      } else { setPlans([]); setHasMore(false); }
    } catch (err) {
      console.error(err);
      setError("Failed to load consultation history");
    } finally { setLoading(false); }
  };

  useEffect(() => { setPage(0); setError(null); setPlans([]); }, [patientId, doctorId]);
  useEffect(() => { fetchTreatmentPlans(); setExpandedIndex(null); }, [page, patientId, doctorId]);

  // ── Loading ──
  if (loading)
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 6, gap: 1.5 }}>
        <CircularProgress size={22} sx={{ color: C.black }} />
        <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 300, color: C.textMuted }}>
          Loading treatment plans...
        </Typography>
      </Box>
    );

  // ── Error ──
  if (error)
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 4, textAlign: "center" }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.textMuted, mb: 2 }}>
          {error}
        </Typography>
        <Button size="small" onClick={fetchTreatmentPlans} sx={{
          borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 12, fontWeight: 300,
          border: `1px solid ${C.black}`, color: C.black,
          "&:hover": { background: C.black, color: C.white },
        }}>
          Retry
        </Button>
      </Box>
    );

  // ── Empty ──
  if (!plans.length && !loading)
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 4, textAlign: "center" }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.textMuted }}>
          No treatment plan found for this patient
        </Typography>
      </Box>
    );

  // ── Main ──
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgPrimary, fontFamily: FONT }}>

        {/* ── Header bar ── */}
        <Box sx={{
          px: 2.5, py: 1.75,
          background: C.bgSecondary,
          borderBottom: `1px solid ${C.borderStrong}`,
        }}>
          <Typography sx={{ ...labelStyle, mb: 0.25 }}>Clinical</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 400, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
            Treatment Plan
          </Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 300, fontFamily: FONT, color: C.textMuted, mt: 0.25 }}>
            Doctor-specific treatment plans · Latest first
          </Typography>
        </Box>

        {/* ── Table ── */}
        <Box sx={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={thLast}>Treatment Plan</th>
              </tr>
            </thead>

            <tbody>
              {plans.map((plan, i) => (
                <React.Fragment key={i}>
                  {/* Main row */}
                  <tr
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      cursor: "pointer",
                      background: expandedIndex === i ? C.bgSecondary : C.bgPrimary,
                      transition: "background 0.12s",
                    }}
                    onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                    onMouseEnter={e => { if (expandedIndex !== i) e.currentTarget.style.background = C.bgSecondary; }}
                    onMouseLeave={e => { if (expandedIndex !== i) e.currentTarget.style.background = C.bgPrimary; }}
                  >
                    <td style={{ ...td, whiteSpace: "nowrap", width: 120, color: C.textMuted, fontSize: 12 }}>
                      {plan.date}
                    </td>
                    <td style={tdLast}>
                      {plan.finaloutput?.processed_treatment_plan?.doctor_content
                        ? plan.finaloutput.processed_treatment_plan.doctor_content.substring(0, 180) + "..."
                        : <span style={{ color: C.textMuted }}>No summary available</span>
                      }
                      {/* Expand indicator */}
                      <span style={{
                        marginLeft: 8,
                        fontSize: 10,
                        color: C.textMuted,
                        fontFamily: FONT,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                      }}>
                        {expandedIndex === i ? "▲ collapse" : "▼ expand"}
                      </span>
                    </td>
                  </tr>

                  {/* Expanded row with table view */}
                  {expandedIndex === i && (
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td colSpan={2} style={{ padding: "20px 24px", background: C.bgSecondary }}>
                        {renderFullTreatmentPlan(plan.finaloutput)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Box>

        {/* ── Pagination ── */}
        <Box sx={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          px: 2.5, py: 1.25,
          borderTop: `1px solid ${C.border}`,
          background: C.bgSecondary,
        }}>
          <Typography sx={{ ...labelStyle }}>
            Page {page + 1}
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              size="small"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              sx={{
                borderRadius: 0, textTransform: "none", fontFamily: FONT,
                fontSize: 11, fontWeight: 300, px: 1.5,
                border: `1px solid ${page === 0 ? C.border : C.black}`,
                color: page === 0 ? C.textMuted : C.black,
                "&:hover": { background: C.black, color: C.white, borderColor: C.black },
                "&.Mui-disabled": { borderColor: C.border, color: C.textMuted },
              }}
            >
              ← Previous
            </Button>
            <Button
              size="small"
              disabled={!hasMore}
              onClick={() => setPage(p => p + 1)}
              sx={{
                borderRadius: 0, textTransform: "none", fontFamily: FONT,
                fontSize: 11, fontWeight: 300, px: 1.5,
                border: `1px solid ${!hasMore ? C.border : C.black}`,
                color: !hasMore ? C.textMuted : C.black,
                "&:hover": { background: C.black, color: C.white, borderColor: C.black },
                "&.Mui-disabled": { borderColor: C.border, color: C.textMuted },
              }}
            >
              Next →
            </Button>
          </Box>
        </Box>

      </Box>
    </motion.div>
  );
}