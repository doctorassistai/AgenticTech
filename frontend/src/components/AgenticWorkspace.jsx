import React, { useEffect, useState, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Grid,
  Paper,
  Alert,
  AlertTitle,
  CircularProgress,
  Divider,
  Stack,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  useTheme,
  useMediaQuery,
} from "@mui/material";

/* ============================================================================
   UTILITY COMPONENTS
   ============================================================================ */

const SectionCard = ({ title, color = "#1e293b", children, urgent = false }) => (
  <Card
    elevation={urgent ? 4 : 2}
    sx={{
      mb: { xs: 2, sm: 3 },
      borderRadius: 3,
      borderLeft: `6px solid ${color}`,
      backgroundColor: urgent ? "#fef2f2" : "#ffffff",
      overflow: "hidden",
    }}
  >
    <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 3 }, "&:last-child": { pb: { xs: 1.5, sm: 2, md: 3 } } }}>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography
          fontSize={{ xs: "1rem", sm: "1.2rem" }}
          fontWeight={300}
          color={color}
          fontFamily="'Open Sans', sans-serif"
        >
          {title}
        </Typography>
      </Box>
      {children}
    </CardContent>
  </Card>
);

const InfoRow = ({ label, value, color = "#0f172a", bold = false }) => (
  <Box mb={1}>
    <Typography fontSize="0.75rem" color="#64748b" fontWeight={300} fontFamily="'Open Sans', sans-serif">
      {label}
    </Typography>
    <Typography
      fontSize={{ xs: "0.82rem", sm: "0.9rem" }}
      color={color}
      fontWeight={bold ? 400 : 300}
      lineHeight={1.6}
      fontFamily="'Open Sans', sans-serif"
    >
      {value || "N/A"}
    </Typography>
  </Box>
);

const RiskBadge = ({ level }) => {
  const getColor = (level) => {
    const l = (level || "").toLowerCase();
    if (l.includes("high") || l.includes("critical") || l.includes("severe")) {
      return { bg: "#fee2e2", color: "#991b1b" };
    }
    if (l.includes("moderate") || l.includes("medium")) {
      return { bg: "#fff7ed", color: "#9a3412" };
    }
    return { bg: "#dcfce7", color: "#166534" };
  };

  const colors = getColor(level);

  return (
    <Chip
      size="small"
      label={level?.toUpperCase() || "UNKNOWN"}
      sx={{
        fontSize: "0.72rem",
        fontWeight: 300,
        fontFamily: "'Open Sans', sans-serif",
        backgroundColor: colors.bg,
        color: colors.color,
        maxWidth: "100%",
      }}
    />
  );
};

const ScoreBar = ({ score, label }) => (
  <Box mb={1.5}>
    <Box display="flex" justifyContent="space-between" mb={0.5}>
      <Typography fontSize="0.75rem" color="#64748b" fontWeight={300} fontFamily="'Open Sans', sans-serif">
        {label}
      </Typography>
      <Typography fontSize="0.75rem" fontWeight={300} fontFamily="'Open Sans', sans-serif">
        {Math.round((score || 0) * 100)}%
      </Typography>
    </Box>
    <LinearProgress
      variant="determinate"
      value={Math.round((score || 0) * 100)}
      sx={{
        height: 8,
        borderRadius: 4,
        backgroundColor: "#e5e7eb",
        "& .MuiLinearProgress-bar": {
          backgroundColor: score > 0.7 ? "#10b981" : score > 0.4 ? "#f59e0b" : "#ef4444",
          borderRadius: 4,
        },
      }}
    />
  </Box>
);

/* ============================================================================
   ADVANCED TREATMENT INTELLIGENCE COMPONENTS
   ============================================================================ */

const GuidelineBadge = ({ level }) => {
  const colors = {
    I: { bg: "#dcfce7", color: "#166534" },
    IIa: { bg: "#d1fae5", color: "#065f46" },
    IIb: { bg: "#fff7ed", color: "#9a3412" },
    III: { bg: "#fee2e2", color: "#991b1b" },
    A: { bg: "#dbeafe", color: "#1e40af" },
    B: { bg: "#e0e7ff", color: "#3730a3" },
    C: { bg: "#f3f4f6", color: "#374151" },
  };
  const c = colors[level] || { bg: "#f1f5f9", color: "#475569" };
  return (
    <Chip
      size="small"
      label={level}
      sx={{
        fontSize: "0.7rem",
        fontWeight: 400,
        backgroundColor: c.bg,
        color: c.color,
        fontFamily: "'Open Sans', sans-serif",
        minWidth: 32,
      }}
    />
  );
};

const UrgencyBadge = ({ level }) => {
  const map = {
    immediate: { bg: "#fee2e2", color: "#991b1b", label: "IMMEDIATE" },
    within_24h: { bg: "#fff7ed", color: "#9a3412", label: "WITHIN 24H" },
    within_week: { bg: "#fef9c3", color: "#854d0e", label: "WITHIN WEEK" },
    routine: { bg: "#f0fdf4", color: "#166534", label: "ROUTINE" },
  };
  const c = map[level] || { bg: "#f1f5f9", color: "#475569", label: level?.toUpperCase() || "—" };
  return (
    <Chip
      size="small"
      label={c.label}
      sx={{
        fontSize: "0.68rem",
        fontWeight: 400,
        backgroundColor: c.bg,
        color: c.color,
        fontFamily: "'Open Sans', sans-serif",
      }}
    />
  );
};

const SubSectionTitle = ({ children, color = "#1e293b" }) => (
  <Typography
    fontSize={{ xs: "0.75rem", sm: "0.82rem" }}
    fontWeight={600}
    color={color}
    letterSpacing="0.06em"
    textTransform="uppercase"
    mb={1.5}
    mt={0.5}
    fontFamily="'Open Sans', sans-serif"
  >
    {children}
  </Typography>
);

const InlinePill = ({ label, value, pillBg = "#f1f5f9", pillColor = "#334155" }) => (
  <Box display="inline-flex" alignItems="center" gap={0.5} mr={1} mb={0.5}>
    <Typography fontSize="0.7rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
      {label}:
    </Typography>
    <Box
      sx={{
        backgroundColor: pillBg,
        color: pillColor,
        px: 1,
        py: 0.15,
        borderRadius: 1,
        fontSize: "0.72rem",
        fontFamily: "'Open Sans', sans-serif",
      }}
    >
      {value}
    </Box>
  </Box>
);

/* ============================================================================
   RESPONSIVE TABLE WRAPPER — converts tables to cards on mobile
   ============================================================================ */
const ResponsiveTable = ({ headers, rows, renderRow, renderMobileCard }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  if (isMobile && renderMobileCard) {
    return (
      <Box>
        {rows.map((row, idx) => (
          <Box key={idx}>{renderMobileCard(row, idx)}</Box>
        ))}
      </Box>
    );
  }

  return (
    <TableContainer component={Paper} elevation={0} sx={{ overflowX: "auto" }}>
      <Table size="small" sx={{ minWidth: { xs: 400, sm: "auto" } }}>
        <TableHead>
          <TableRow sx={{ backgroundColor: "#f8fafc" }}>
            {headers.map((h, i) => (
              <TableCell key={i} sx={{ fontFamily: "'Open Sans', sans-serif", whiteSpace: "nowrap" }}>
                <strong>{h}</strong>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{rows.map((row, idx) => renderRow(row, idx))}</TableBody>
      </Table>
    </TableContainer>
  );
};

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

const ClinicalReasoningDashboard = ({ patientId, doctorId, trigger }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const API_BASE = import.meta.env.VITE_BACKEND_URL;

  // useCallback prevents re-creation of fetchData on every render
  const fetchData = useCallback(async () => {
    if (!patientId || !doctorId) return;

    setLoading(true);
    setError(null);

    try {
      const url = `${API_BASE}hms/users/data/context/get_agentic_data?patient_id=${patientId}&doctor_id=${doctorId}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) throw new Error("Failed to fetch saved agentic data");

      const result = await response.json();
      setData(result?.data?.data || null);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId, API_BASE]); // trigger intentionally excluded — use separate effect

  // Separate effect for trigger so it doesn't cause stale-closure issues
  useEffect(() => {
    if (trigger === undefined) return;
    fetchData();
  }, [trigger, fetchData]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  /* ============================================================================
     LOADING & ERROR STATES
     ============================================================================ */

  if (loading) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap={2} p={{ xs: 2, sm: 4 }}>
        <CircularProgress size={50} />
        <Typography
          fontSize={{ xs: "0.95rem", sm: "1.1rem" }}
          color="#1e293b"
          fontWeight={300}
          fontFamily="'Open Sans', sans-serif"
          textAlign="center"
        >
          Analyzing Clinical Data...
        </Typography>
        <Typography
          fontSize={{ xs: "0.8rem", sm: "0.9rem" }}
          color="#64748b"
          fontFamily="'Open Sans', sans-serif"
          textAlign="center"
        >
          Running comprehensive clinical reasoning workflow
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: { xs: 1, sm: 3 } }}>
        <AlertTitle>Error</AlertTitle>
        {error}
      </Alert>
    );
  }

  if (!data) return null;

  const {
    warnings = [],
    confidence_scores = {},
    differential_diagnosis,
    disease_causation,
    staging,
    prognosis,
    risk_stratification,
    clinical_deterioration_warning,
    medication_reconciliation,
    treatment_validation,
    guideline_compliance,
    discharge_readiness,
    final_recommendation,
    advanced_treatment_intelligence,
  } = data;

  // Remove emojis/icons from text
  const cleanText = (text) => {
    if (!text) return text;
    return text
      .replace(
        /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|🚨|⚠️|🏥|🚫|📊|✓|✗|⏰|🎯|🚩|📈|🫀|👁️|🚑|💊|💉|📋|🔍|🔬|🔮|🏠/gu,
        ""
      )
      .trim();
  };

  /* ============================================================================
     RENDER MAIN DASHBOARD
     ============================================================================ */

  return (
    <Box
      sx={{
        maxWidth: 1400,
        mx: "auto",
        p: { xs: 1, sm: 2, md: 3 },
        fontFamily: "'Open Sans', sans-serif",
        // Prevent any accidental page navigation from child elements
        "& a": { textDecoration: "none" },
      }}
      // Stop any bubbled submit/click that might navigate
      onClick={(e) => {
        const target = e.target;
        if (target.tagName === "A" && !target.href?.startsWith("mailto")) {
          e.preventDefault();
        }
      }}
    >
      {/* ==================== CRITICAL ALERTS ==================== */}
      {warnings?.length > 0 && (
        <Alert severity="error" sx={{ mb: { xs: 2, sm: 3 } }}>
          <AlertTitle
            sx={{ fontWeight: 400, fontSize: { xs: "0.9rem", sm: "1rem" }, fontFamily: "'Open Sans', sans-serif" }}
          >
            Critical Alerts Requiring Immediate Attention
          </AlertTitle>
          {warnings.map((warning, idx) => (
            <Typography
              key={idx}
              fontSize={{ xs: "0.82rem", sm: "0.9rem" }}
              fontWeight={300}
              sx={{ mt: 1 }}
              fontFamily="'Open Sans', sans-serif"
            >
              • {cleanText(warning)}
            </Typography>
          ))}
        </Alert>
      )}

      {/* ==================== EXECUTIVE SUMMARY ==================== */}
      {final_recommendation?.executive_summary && (
        <SectionCard title="Executive Summary" color="#0ea5e9">
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#f0f9ff", borderRadius: 2 }}>
                <Typography
                  fontSize={{ xs: "0.88rem", sm: "1rem" }}
                  color="#0c4a6e"
                  lineHeight={1.7}
                  mb={2}
                  fontFamily="'Open Sans', sans-serif"
                >
                  {final_recommendation.executive_summary.patient_status}
                </Typography>

                <Grid container spacing={{ xs: 1, sm: 2 }}>
                  <Grid item xs={12} sm={6} md={3}>
                    <InfoRow
                      label="KEY PROBLEM"
                      value={final_recommendation.executive_summary.key_problem}
                      color="#0c4a6e"
                      bold
                    />
                  </Grid>
                  <Grid item xs={6} sm={6} md={3}>
                    <Box>
                      <Typography
                        fontSize="0.75rem"
                        color="#64748b"
                        fontWeight={300}
                        mb={0.5}
                        fontFamily="'Open Sans', sans-serif"
                      >
                        URGENCY
                      </Typography>
                      <RiskBadge level={final_recommendation.executive_summary.urgency} />
                    </Box>
                  </Grid>
                  <Grid item xs={6} sm={6} md={3}>
                    <Box>
                      <Typography
                        fontSize="0.75rem"
                        color="#64748b"
                        fontWeight={300}
                        mb={0.5}
                        fontFamily="'Open Sans', sans-serif"
                      >
                        TRAJECTORY
                      </Typography>
                      <RiskBadge level={final_recommendation.executive_summary.trajectory} />
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <InfoRow
                      label="PRIMARY DIAGNOSIS"
                      value={final_recommendation.diagnostic_confidence?.primary_diagnosis}
                      bold
                    />
                    <ScoreBar
                      score={final_recommendation.diagnostic_confidence?.confidence}
                      label="Diagnostic Confidence"
                    />
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid>
        </SectionCard>
      )}
{/* ==================== PATIENT SUMMARY ==================== */}
     
      {/* ==================== DIFFERENTIAL DIAGNOSIS ==================== */}
      {differential_diagnosis && (
        <SectionCard title="Differential Diagnosis" color="#dc2626">
          {/* Most Likely Diagnoses */}
          <Typography
            fontSize={{ xs: "0.88rem", sm: "0.95rem" }}
            fontWeight={400}
            color="#166534"
            mb={1.5}
            fontFamily="'Open Sans', sans-serif"
          >
            Most Likely Diagnoses
          </Typography>
          {differential_diagnosis.most_likely_diagnoses?.map((dx, idx) => (
            <Paper
              key={idx}
              elevation={0}
              sx={{ p: { xs: 1.5, sm: 2 }, mb: 1.5, backgroundColor: "#f0fdf4", borderRadius: 2 }}
            >
              <Stack direction="row" spacing={1} mb={1} flexWrap="wrap" gap={0.5}>
                <Typography
                  fontSize={{ xs: "0.88rem", sm: "0.95rem" }}
                  fontWeight={400}
                  color="#166534"
                  fontFamily="'Open Sans', sans-serif"
                >
                  {dx.diagnosis}
                </Typography>
                <Chip
                  size="small"
                  label={`${dx.probability}% probability`}
                  sx={{ fontFamily: "'Open Sans', sans-serif" }}
                />
                <RiskBadge level={dx.confidence} />
              </Stack>

              <InfoRow label="Diagnostic Criteria Met" value={dx.diagnostic_criteria_met} color="#166534" />

              <Grid container spacing={{ xs: 1, sm: 2 }} mt={0.5}>
                <Grid item xs={12} md={6}>
                  <Typography
                    fontSize="0.75rem"
                    fontWeight={300}
                    color="#166534"
                    mb={0.5}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    Supporting Evidence:
                  </Typography>
                  {dx.supporting_evidence?.map((e, i) => (
                    <Typography key={i} fontSize="0.75rem" color="#166534" fontFamily="'Open Sans', sans-serif">
                      {cleanText(e)}
                    </Typography>
                  ))}
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography
                    fontSize="0.75rem"
                    fontWeight={300}
                    color="#dc2626"
                    mb={0.5}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    Contradicting Evidence:
                  </Typography>
                  {dx.contradicting_evidence?.map((e, i) => (
                    <Typography key={i} fontSize="0.75rem" color="#dc2626" fontFamily="'Open Sans', sans-serif">
                      {cleanText(e)}
                    </Typography>
                  ))}
                </Grid>
              </Grid>

              {dx.next_steps_to_confirm?.length > 0 && (
                <Box mt={1}>
                  <Typography fontSize="0.75rem" fontWeight={300} color="#075985" fontFamily="'Open Sans', sans-serif">
                    Next Steps: {dx.next_steps_to_confirm.join(", ")}
                  </Typography>
                </Box>
              )}
            </Paper>
          ))}

          <Divider sx={{ my: { xs: 2, sm: 3 } }} />

          {/* Must-Not-Miss Diagnoses */}
          <Typography
            fontSize={{ xs: "0.88rem", sm: "0.95rem" }}
            fontWeight={400}
            color="#991b1b"
            mb={1.5}
            fontFamily="'Open Sans', sans-serif"
          >
            Must-Not-Miss Diagnoses
          </Typography>
          {differential_diagnosis.must_not_miss_diagnoses?.map((dx, idx) => (
            <Paper
              key={idx}
              elevation={0}
              sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, backgroundColor: "#fef2f2", borderRadius: 2 }}
            >
              <Stack direction="row" spacing={1} mb={1} flexWrap="wrap" gap={0.5}>
                <Typography
                  fontSize={{ xs: "0.88rem", sm: "1rem" }}
                  fontWeight={400}
                  color="#991b1b"
                  fontFamily="'Open Sans', sans-serif"
                >
                  {dx.diagnosis}
                </Typography>
                <RiskBadge level={dx.severity} />
                <RiskBadge level={dx.urgency} />
                <Chip
                  size="small"
                  label={`${dx.probability}% probability`}
                  sx={{ fontFamily: "'Open Sans', sans-serif" }}
                />
              </Stack>

              <InfoRow label="Clinical Reasoning" value={dx.reasoning} color="#7f1d1d" />

              <Grid container spacing={{ xs: 1, sm: 2 }} mt={1}>
                <Grid item xs={12} md={6}>
                  <Typography
                    fontSize="0.8rem"
                    fontWeight={300}
                    color="#991b1b"
                    mb={0.5}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    Features Present:
                  </Typography>
                  {dx.key_features_present?.map((f, i) => (
                    <Typography key={i} fontSize="0.8rem" color="#7f1d1d" fontFamily="'Open Sans', sans-serif">
                      {cleanText(f)}
                    </Typography>
                  ))}
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography
                    fontSize="0.8rem"
                    fontWeight={300}
                    color="#991b1b"
                    mb={0.5}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    Features Absent:
                  </Typography>
                  {dx.key_features_absent?.map((f, i) => (
                    <Typography key={i} fontSize="0.8rem" color="#7f1d1d" fontFamily="'Open Sans', sans-serif">
                      {cleanText(f)}
                    </Typography>
                  ))}
                </Grid>
              </Grid>

              {dx.recommended_rule_out_tests?.length > 0 && (
                <Box mt={1.5}>
                  <Typography
                    fontSize="0.8rem"
                    fontWeight={300}
                    color="#991b1b"
                    mb={0.5}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    Recommended Rule-Out Tests:
                  </Typography>
                  <Box display="flex" flexWrap="wrap" gap={0.5}>
                    {dx.recommended_rule_out_tests.map((test, i) => (
                      <Chip
                        key={i}
                        size="small"
                        label={test}
                        sx={{ fontSize: "0.75rem", fontFamily: "'Open Sans', sans-serif" }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </Paper>
          ))}

          {/* Diagnostic Strategy */}
          {differential_diagnosis.diagnostic_strategy && (
            <>
              <Divider sx={{ my: { xs: 2, sm: 3 } }} />
              <Typography
                fontSize={{ xs: "0.88rem", sm: "0.95rem" }}
                fontWeight={400}
                color="#075985"
                mb={1.5}
                fontFamily="'Open Sans', sans-serif"
              >
                Recommended Diagnostic Strategy
              </Typography>

              {/* Mobile: cards; Desktop: table */}
              {isMobile ? (
                <Box>
                  {differential_diagnosis.diagnostic_strategy.recommended_investigation_sequence?.map((step, idx) => (
                    <Paper key={idx} elevation={0} sx={{ p: 1.5, mb: 1, backgroundColor: "#f8fafc", borderRadius: 2 }}>
                      <Typography fontSize="0.75rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
                        Step {step.step}
                      </Typography>
                      <Typography
                        fontSize="0.85rem"
                        fontWeight={500}
                        color="#1e293b"
                        mb={0.5}
                        fontFamily="'Open Sans', sans-serif"
                      >
                        {step.test_or_action}
                      </Typography>
                      <Typography fontSize="0.75rem" color="#475569" mb={0.3} fontFamily="'Open Sans', sans-serif">
                        {step.rationale}
                      </Typography>
                      <Typography fontSize="0.72rem" color="#0369a1" fontFamily="'Open Sans', sans-serif">
                        Impact: {step.expected_impact_on_differential}
                      </Typography>
                    </Paper>
                  ))}
                </Box>
              ) : (
                <TableContainer component={Paper} elevation={0}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: "#f8fafc" }}>
                        {["Step", "Test/Action", "Rationale", "Expected Impact"].map((h) => (
                          <TableCell key={h} sx={{ fontFamily: "'Open Sans', sans-serif" }}>
                            <strong>{h}</strong>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {differential_diagnosis.diagnostic_strategy.recommended_investigation_sequence?.map(
                        (step, idx) => (
                          <TableRow key={idx}>
                            <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{step.step}</TableCell>
                            <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>
                              <strong>{step.test_or_action}</strong>
                            </TableCell>
                            <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{step.rationale}</TableCell>
                            <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>
                              {step.expected_impact_on_differential}
                            </TableCell>
                          </TableRow>
                        )
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {differential_diagnosis.diagnostic_strategy.urgent_investigations?.length > 0 && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  <Typography fontFamily="'Open Sans', sans-serif">
                    <strong>Urgent Investigations Required:</strong>{" "}
                    {differential_diagnosis.diagnostic_strategy.urgent_investigations.join(", ")}
                  </Typography>
                </Alert>
              )}
            </>
          )}

          <Box mt={2}>
            <ScoreBar
              score={differential_diagnosis.overall_diagnostic_confidence}
              label="Overall Diagnostic Confidence"
            />
          </Box>
        </SectionCard>
      )}

      {/* ==================== DISEASE CAUSATION ==================== */}
      {disease_causation && (
        <SectionCard title="Disease Causation & Pathophysiology" color="#6366f1">
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper
                elevation={0}
                sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#eef2ff", borderRadius: 2 }}
              >
                <Typography
                  fontSize={{ xs: "0.95rem", sm: "1.05rem" }}
                  fontWeight={400}
                  color="#4338ca"
                  mb={1}
                  fontFamily="'Open Sans', sans-serif"
                >
                  {disease_causation.primary_etiology?.diagnosis}
                </Typography>

                <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" gap={0.5}>
                  <RiskBadge level={disease_causation.primary_etiology?.evidence_strength} />
                  <Chip
                    size="small"
                    label={`Confidence: ${Math.round((disease_causation.primary_etiology?.confidence || 0) * 100)}%`}
                    sx={{ fontFamily: "'Open Sans', sans-serif" }}
                  />
                </Stack>

                <InfoRow
                  label="Pathophysiological Mechanism"
                  value={disease_causation.primary_etiology?.mechanism}
                  color="#1e293b"
                />

                {disease_causation.primary_etiology?.supporting_evidence?.length > 0 && (
                  <Box mt={2}>
                    <Typography
                      fontSize="0.85rem"
                      fontWeight={300}
                      color="#4338ca"
                      mb={1}
                      fontFamily="'Open Sans', sans-serif"
                    >
                      Supporting Evidence
                    </Typography>
                    {disease_causation.primary_etiology.supporting_evidence.map((e, idx) => (
                      <Paper key={idx} elevation={0} sx={{ p: 1.5, mb: 1, backgroundColor: "#fff" }}>
                        <Typography
                          fontSize="0.85rem"
                          color="#1e293b"
                          fontWeight={300}
                          fontFamily="'Open Sans', sans-serif"
                        >
                          {e.finding}
                        </Typography>
                        <Typography fontSize="0.75rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
                          Source: {e.source} {e.date && `• ${e.date}`}
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                )}
              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography
                fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                fontWeight={400}
                color="#166534"
                mb={1}
                fontFamily="'Open Sans', sans-serif"
              >
                Modifiable Risk Factors
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {disease_causation.risk_factors?.modifiable?.map((rf, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={`${rf.factor} (${Math.round((rf.confidence || 0) * 100)}%)`}
                    sx={{
                      fontSize: "0.75rem",
                      backgroundColor: "#dcfce7",
                      color: "#166534",
                      fontFamily: "'Open Sans', sans-serif",
                    }}
                  />
                ))}
              </Box>
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography
                fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                fontWeight={400}
                color="#64748b"
                mb={1}
                fontFamily="'Open Sans', sans-serif"
              >
                Non-Modifiable Risk Factors
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {disease_causation.risk_factors?.non_modifiable?.map((rf, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={`${rf.factor} (${Math.round((rf.confidence || 0) * 100)}%)`}
                    sx={{
                      fontSize: "0.75rem",
                      backgroundColor: "#e5e7eb",
                      color: "#374151",
                      fontFamily: "'Open Sans', sans-serif",
                    }}
                  />
                ))}
              </Box>
            </Grid>

            {disease_causation.progression_pathway && (
              <Grid item xs={12}>
                <Typography
                  fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                  fontWeight={400}
                  color="#4338ca"
                  mb={1}
                  fontFamily="'Open Sans', sans-serif"
                >
                  Disease Progression
                </Typography>
                <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#f0f9ff", borderRadius: 2 }}>
                  <InfoRow label="Natural History" value={disease_causation.progression_pathway.natural_history} />
                  <InfoRow
                    label="Expected Trajectory"
                    value={disease_causation.progression_pathway.expected_trajectory}
                  />
                  <InfoRow label="Reversibility" value={disease_causation.progression_pathway.reversibility} />
                </Paper>
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={disease_causation.confidence_score} label="Disease Causation Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== STAGING & SEVERITY ==================== */}
      {staging && (
        <SectionCard title="Clinical Staging & Severity" color="#10b981">
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12} md={4}>
              <Paper
                elevation={0}
                sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#f0fdf4", borderRadius: 2, textAlign: "center" }}
              >
                <Typography
                  fontSize="0.75rem"
                  color="#166534"
                  fontWeight={300}
                  mb={0.5}
                  fontFamily="'Open Sans', sans-serif"
                >
                  {staging.primary_staging?.system} STAGE
                </Typography>
                <Typography
                  fontSize={{ xs: "2rem", sm: "2.5rem" }}
                  fontWeight={300}
                  color="#166534"
                  mb={1}
                  fontFamily="'Open Sans', sans-serif"
                >
                  {staging.primary_staging?.stage}
                </Typography>
                <Typography fontSize="0.85rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
                  {staging.primary_staging?.calculation?.interpretation}
                </Typography>
              </Paper>
            </Grid>

            <Grid item xs={12} md={8}>
              <Grid container spacing={{ xs: 1, sm: 2 }}>
                {[
                  {
                    label: "GRADE",
                    value: staging.severity_grade?.grade?.toUpperCase(),
                    bg: "#fff7ed",
                    color: "#9a3412",
                  },
                  {
                    label: "STABILITY",
                    value: staging.severity_grade?.stability?.toUpperCase(),
                    bg: "#f0f9ff",
                    color: "#075985",
                  },
                  {
                    label: "STATUS",
                    value: staging.severity_grade?.compensation_status?.replace(/_/g, " ").toUpperCase(),
                    bg: "#fef2f2",
                    color: "#991b1b",
                    small: true,
                  },
                ].map((item, i) => (
                  <Grid item xs={4} key={i}>
                    <Paper
                      elevation={0}
                      sx={{ p: { xs: 1, sm: 1.5 }, backgroundColor: item.bg, borderRadius: 2, textAlign: "center" }}
                    >
                      <Typography
                        fontSize={{ xs: "0.6rem", sm: "0.7rem" }}
                        color={item.color}
                        fontWeight={300}
                        fontFamily="'Open Sans', sans-serif"
                      >
                        {item.label}
                      </Typography>
                      <Typography
                        fontSize={{ xs: item.small ? "0.75rem" : "0.95rem", sm: item.small ? "0.9rem" : "1.1rem" }}
                        color={item.color}
                        fontWeight={300}
                        fontFamily="'Open Sans', sans-serif"
                      >
                        {item.value}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>

              <Box mt={2}>
                <InfoRow label="Clinical Rationale" value={staging.severity_grade?.rationale} color="#1e293b" />
              </Box>
            </Grid>

            {staging.primary_staging?.calculation?.components?.length > 0 && (
              <Grid item xs={12}>
                <Typography
                  fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                  fontWeight={400}
                  color="#166534"
                  mb={1}
                  fontFamily="'Open Sans', sans-serif"
                >
                  Staging Calculation Components
                </Typography>
                <Grid container spacing={1}>
                  {staging.primary_staging.calculation.components.map((comp, idx) => (
                    <Grid item xs={12} sm={6} md={4} key={idx}>
                      <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#f8fafc", borderRadius: 2 }}>
                        <Typography
                          fontSize="0.8rem"
                          fontWeight={400}
                          color="#1e293b"
                          fontFamily="'Open Sans', sans-serif"
                        >
                          {comp.parameter}
                        </Typography>
                        <Typography fontSize="0.75rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
                          Value: {comp.value} • Score: {comp.score}
                        </Typography>
                        <Chip
                          size="small"
                          label={comp.data_available ? "Available" : "Missing"}
                          sx={{
                            fontSize: "0.65rem",
                            mt: 0.5,
                            backgroundColor: comp.data_available ? "#dcfce7" : "#fee2e2",
                            color: comp.data_available ? "#166534" : "#991b1b",
                            fontFamily: "'Open Sans', sans-serif",
                          }}
                        />
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
                <Typography
                  fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                  fontWeight={400}
                  color="#166534"
                  mt={2}
                  fontFamily="'Open Sans', sans-serif"
                >
                  Total Score: {staging.primary_staging.calculation.total_score}
                </Typography>
              </Grid>
            )}

            {staging.monitoring_plan && (
              <Grid item xs={12}>
                <Typography
                  fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                  fontWeight={400}
                  color="#075985"
                  mb={1}
                  fontFamily="'Open Sans', sans-serif"
                >
                  Monitoring Requirements
                </Typography>
                <Alert severity="info">
                  <Typography fontSize="0.85rem" mb={0.5} fontFamily="'Open Sans', sans-serif">
                    <strong>Parameters:</strong> {staging.monitoring_plan.parameters?.join(", ")}
                  </Typography>
                  <Typography fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">
                    <strong>Frequency:</strong> {staging.monitoring_plan.frequency}
                  </Typography>
                </Alert>

                {staging.monitoring_plan.escalation_triggers?.length > 0 && (
                  <Box mt={1}>
                    <Typography
                      fontSize="0.75rem"
                      fontWeight={400}
                      color="#991b1b"
                      mb={0.5}
                      fontFamily="'Open Sans', sans-serif"
                    >
                      Escalation Triggers:
                    </Typography>
                    <Box display="flex" flexWrap="wrap" gap={0.5}>
                      {staging.monitoring_plan.escalation_triggers.map((t, idx) => (
                        <Chip
                          key={idx}
                          size="small"
                          label={t}
                          sx={{
                            fontSize: "0.7rem",
                            backgroundColor: "#fee2e2",
                            color: "#991b1b",
                            fontFamily: "'Open Sans', sans-serif",
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={staging.confidence_score} label="Staging Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== PROGNOSIS ==================== */}
      {prognosis && (
        <SectionCard title="Prognosis & Outcomes" color="#f59e0b">
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  backgroundColor: "#fff7ed",
                  borderRadius: 2,
                  textAlign: "center",
                }}
              >
                <Typography
                  fontSize="0.8rem"
                  color="#9a3412"
                  fontWeight={300}
                  mb={0.5}
                  fontFamily="'Open Sans', sans-serif"
                >
                  PROGNOSTIC CATEGORY
                </Typography>
                <Typography
                  fontSize={{ xs: "1.4rem", sm: "1.8rem" }}
                  fontWeight={300}
                  color="#9a3412"
                  fontFamily="'Open Sans', sans-serif"
                >
                  {prognosis.prognostic_category?.toUpperCase()}
                </Typography>
              </Paper>
            </Grid>

            {[
              {
                key: "short_term",
                label: "SHORT-TERM OUTCOME",
                bg: "#fef2f2",
                color: "#991b1b",
                data: prognosis.outcome_predictions?.short_term,
              },
              {
                key: "medium_term",
                label: "MEDIUM-TERM OUTCOME",
                bg: "#fff7ed",
                color: "#9a3412",
                data: prognosis.outcome_predictions?.medium_term,
              },
              {
                key: "long_term",
                label: "LONG-TERM OUTCOME",
                bg: "#f0f9ff",
                color: "#075985",
                data: prognosis.outcome_predictions?.long_term,
                showSurvival: true,
              },
            ].map((item) => (
              <Grid item xs={12} md={4} key={item.key}>
                <Paper
                  elevation={0}
                  sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: item.bg, borderRadius: 2, height: "100%" }}
                >
                  <Typography
                    fontSize="0.75rem"
                    fontWeight={400}
                    color={item.color}
                    mb={1}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    {item.label}
                  </Typography>
                  <InfoRow label="Timeline" value={item.data?.timeline} />
                  <InfoRow label="Expected Outcome" value={item.data?.expected_outcome} color="#7f1d1d" />
                  {item.showSurvival && item.data?.survival_estimate && (
                    <InfoRow
                      label="Survival Estimate"
                      value={item.data.survival_estimate}
                      color="#991b1b"
                      bold
                    />
                  )}
                  <ScoreBar score={item.data?.confidence} label="Confidence" />
                </Paper>
              </Grid>
            ))}

            <Grid item xs={12} md={6}>
              <Typography
                fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                fontWeight={400}
                color="#166534"
                mb={1}
                fontFamily="'Open Sans', sans-serif"
              >
                Favorable Prognostic Factors
              </Typography>
              {prognosis.prognostic_factors?.favorable?.map((factor, idx) => (
                <Paper
                  key={idx}
                  elevation={0}
                  sx={{ p: 1.5, mb: 1, backgroundColor: "#f0fdf4", borderRadius: 2 }}
                >
                  <Typography
                    fontSize="0.85rem"
                    color="#166534"
                    fontWeight={300}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    {factor.factor}
                  </Typography>
                  <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap" gap={0.3}>
                    <Chip
                      size="small"
                      label={`Impact: ${factor.impact}`}
                      sx={{ fontSize: "0.65rem", fontFamily: "'Open Sans', sans-serif" }}
                    />
                    <Chip
                      size="small"
                      label={`Evidence: ${factor.evidence}`}
                      sx={{ fontSize: "0.65rem", fontFamily: "'Open Sans', sans-serif" }}
                    />
                    <Chip
                      size="small"
                      label={factor.modifiable ? "Modifiable" : "Fixed"}
                      sx={{
                        fontSize: "0.65rem",
                        backgroundColor: factor.modifiable ? "#dcfce7" : "#e5e7eb",
                        color: factor.modifiable ? "#166534" : "#374151",
                        fontFamily: "'Open Sans', sans-serif",
                      }}
                    />
                  </Stack>
                </Paper>
              ))}
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography
                fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                fontWeight={400}
                color="#991b1b"
                mb={1}
                fontFamily="'Open Sans', sans-serif"
              >
                Unfavorable Prognostic Factors
              </Typography>
              {prognosis.prognostic_factors?.unfavorable?.map((factor, idx) => (
                <Paper
                  key={idx}
                  elevation={0}
                  sx={{ p: 1.5, mb: 1, backgroundColor: "#fef2f2", borderRadius: 2 }}
                >
                  <Typography
                    fontSize="0.85rem"
                    color="#991b1b"
                    fontWeight={300}
                    fontFamily="'Open Sans', sans-serif"
                  >
                    {factor.factor}
                  </Typography>
                  <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap" gap={0.3}>
                    <Chip
                      size="small"
                      label={`Impact: ${factor.impact}`}
                      sx={{ fontSize: "0.65rem", fontFamily: "'Open Sans', sans-serif" }}
                    />
                    <Chip
                      size="small"
                      label={`Evidence: ${factor.evidence}`}
                      sx={{ fontSize: "0.65rem", fontFamily: "'Open Sans', sans-serif" }}
                    />
                    <Chip
                      size="small"
                      label={factor.modifiable ? "Modifiable" : "Fixed"}
                      sx={{
                        fontSize: "0.65rem",
                        backgroundColor: factor.modifiable ? "#fee2e2" : "#e5e7eb",
                        color: factor.modifiable ? "#991b1b" : "#374151",
                        fontFamily: "'Open Sans', sans-serif",
                      }}
                    />
                  </Stack>
                </Paper>
              ))}
            </Grid>

            {prognosis.modifiable_factors_priority?.length > 0 && (
              <Grid item xs={12}>
                <Typography
                  fontSize={{ xs: "0.85rem", sm: "0.9rem" }}
                  fontWeight={400}
                  color="#075985"
                  mb={1}
                  fontFamily="'Open Sans', sans-serif"
                >
                  Priority Modifiable Factors
                </Typography>
                {prognosis.modifiable_factors_priority.map((factor, idx) => (
                  <Paper
                    key={idx}
                    elevation={0}
                    sx={{ p: 1.5, mb: 1, backgroundColor: "#f0f9ff", borderRadius: 2 }}
                  >
                    <Typography
                      fontSize="0.85rem"
                      fontWeight={400}
                      color="#075985"
                      mb={0.5}
                      fontFamily="'Open Sans', sans-serif"
                    >
                      {factor.factor}
                    </Typography>
                    <InfoRow label="Recommended Intervention" value={factor.intervention} color="#0c4a6e" />
                    <Typography fontSize="0.75rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
                      Expected Benefit: {factor.expected_benefit} • Feasibility: {factor.feasibility}
                    </Typography>
                  </Paper>
                ))}
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={prognosis.confidence_score} label="Prognostic Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== RISK STRATIFICATION ==================== */}
      {risk_stratification && (
        <SectionCard
          title="Risk Stratification"
          color="#dc2626"
          urgent={risk_stratification.requires_immediate_action}
        >
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 3 }, backgroundColor: "#fef2f2", borderRadius: 2 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  mb={1.5}
                >
                  <Typography
                    fontSize={{ xs: "1.4rem", sm: "2rem" }}
                    fontWeight={300}
                    color="#991b1b"
                    fontFamily="'Open Sans', sans-serif"
                  >
                    {risk_stratification.overall_risk_category?.level?.toUpperCase()} RISK
                  </Typography>
                  <Chip
                    label={`Score: ${Math.round((risk_stratification.risk_score || 0) * 100)}/100`}
                    sx={{ fontSize: { xs: "0.85rem", sm: "1rem" }, fontWeight: 300, fontFamily: "'Open Sans', sans-serif" }}
                  />
                </Stack>
                <Typography fontSize={{ xs: "0.88rem", sm: "1rem" }} color="#7f1d1d" lineHeight={1.7} fontFamily="'Open Sans', sans-serif">
                  {risk_stratification.overall_risk_category?.summary}
                </Typography>
              </Paper>
            </Grid>

            {[
              {
                label: "MORTALITY RISK",
                bg: "#fff7ed",
                color: "#9a3412",
                content: (
                  <>
                    <Box mb={2}>
                      <Typography fontSize="0.75rem" color="#7c2d12" fontWeight={300} mb={0.3} fontFamily="'Open Sans', sans-serif">Short-Term</Typography>
                      <Typography fontSize="0.85rem" color="#7c2d12" mb={0.3} fontFamily="'Open Sans', sans-serif">{risk_stratification.risk_domains?.mortality?.short_term?.description}</Typography>
                      <Typography fontSize="0.7rem" color="#64748b" fontFamily="'Open Sans', sans-serif">{risk_stratification.risk_domains?.mortality?.short_term?.percentage} ({risk_stratification.risk_domains?.mortality?.short_term?.timeline})</Typography>
                    </Box>
                    <Box>
                      <Typography fontSize="0.75rem" color="#7c2d12" fontWeight={300} mb={0.3} fontFamily="'Open Sans', sans-serif">Long-Term</Typography>
                      <Typography fontSize="0.85rem" color="#7c2d12" mb={0.3} fontFamily="'Open Sans', sans-serif">{risk_stratification.risk_domains?.mortality?.long_term?.description}</Typography>
                      <Typography fontSize="0.7rem" color="#64748b" fontFamily="'Open Sans', sans-serif">{risk_stratification.risk_domains?.mortality?.long_term?.percentage} ({risk_stratification.risk_domains?.mortality?.long_term?.timeline})</Typography>
                    </Box>
                  </>
                ),
              },
              {
                label: "MORBIDITY RISK",
                bg: "#fef2f2",
                color: "#991b1b",
                content: (
                  <>
                    <Typography fontSize="0.85rem" color="#7f1d1d" mb={1} fontFamily="'Open Sans', sans-serif">{risk_stratification.risk_domains?.morbidity?.probability?.description}</Typography>
                    <Typography fontSize="0.75rem" color="#7f1d1d" mb={1.5} fontFamily="'Open Sans', sans-serif"><strong>If Occurs:</strong> {risk_stratification.risk_domains?.morbidity?.severity_if_occurs?.description}</Typography>
                    {risk_stratification.risk_domains?.morbidity?.complications?.length > 0 && (
                      <>
                        <Typography fontSize="0.7rem" fontWeight={300} color="#991b1b" mb={0.5} fontFamily="'Open Sans', sans-serif">Potential Complications:</Typography>
                        {risk_stratification.risk_domains.morbidity.complications.slice(0, 5).map((comp, idx) => (
                          <Typography key={idx} fontSize="0.7rem" color="#7f1d1d" fontFamily="'Open Sans', sans-serif">• {comp}</Typography>
                        ))}
                      </>
                    )}
                  </>
                ),
              },
              {
                label: "TREATMENT RISK",
                bg: "#f0f9ff",
                color: "#075985",
                content: (
                  <>
                    <Typography fontSize="0.85rem" color="#0c4a6e" mb={1.5} fontFamily="'Open Sans', sans-serif">{risk_stratification.risk_domains?.treatment_risk?.overall_level?.description}</Typography>
                    {risk_stratification.risk_domains?.treatment_risk?.medication_adverse_effects?.length > 0 && (
                      <>
                        <Typography fontSize="0.7rem" fontWeight={300} color="#075985" mb={0.5} fontFamily="'Open Sans', sans-serif">Medication Risks:</Typography>
                        {risk_stratification.risk_domains.treatment_risk.medication_adverse_effects.slice(0, 3).map((effect, idx) => (
                          <Typography key={idx} fontSize="0.7rem" color="#0c4a6e" fontFamily="'Open Sans', sans-serif">• {effect}</Typography>
                        ))}
                      </>
                    )}
                  </>
                ),
              },
            ].map((domain, i) => (
              <Grid item xs={12} md={4} key={i}>
                <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, height: "100%", backgroundColor: domain.bg, borderRadius: 2 }}>
                  <Typography fontSize="0.85rem" fontWeight={400} color={domain.color} mb={1.5} fontFamily="'Open Sans', sans-serif">{domain.label}</Typography>
                  {domain.content}
                </Paper>
              </Grid>
            ))}

            {risk_stratification.time_sensitive_risks?.length > 0 && (
              <Grid item xs={12}>
                <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#991b1b" mb={1} fontFamily="'Open Sans', sans-serif">Time-Sensitive Risks</Typography>
                {risk_stratification.time_sensitive_risks.map((risk, idx) => (
                  <Alert key={idx} severity={risk.urgency?.level === "immediate" ? "error" : risk.urgency?.level === "urgent" ? "warning" : "info"} sx={{ mb: 1 }}>
                    <Typography fontSize="0.85rem" fontWeight={400} fontFamily="'Open Sans', sans-serif">{risk.risk}</Typography>
                    <Typography fontSize="0.8rem" mt={0.5} fontFamily="'Open Sans', sans-serif"><strong>Urgency:</strong> {risk.urgency?.level?.toUpperCase()} — {risk.urgency?.description}</Typography>
                    <Typography fontSize="0.8rem" fontFamily="'Open Sans', sans-serif"><strong>Timeline:</strong> {risk.timeline}</Typography>
                    <Typography fontSize="0.8rem" fontFamily="'Open Sans', sans-serif"><strong>Mitigation:</strong> {risk.mitigation}</Typography>
                  </Alert>
                ))}
              </Grid>
            )}

            {risk_stratification.risk_mitigation_priority?.length > 0 && (
              <Grid item xs={12}>
                <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#075985" mb={1} fontFamily="'Open Sans', sans-serif">Risk Mitigation Priorities</Typography>
                {isMobile ? (
                  <Box>
                    {risk_stratification.risk_mitigation_priority.sort((a, b) => a.priority - b.priority).map((item, idx) => (
                      <Paper key={idx} elevation={0} sx={{ p: 1.5, mb: 1, backgroundColor: "#f8fafc", borderRadius: 2 }}>
                        <Stack direction="row" spacing={1} mb={0.5} alignItems="center">
                          <Chip size="small" label={item.priority} sx={{ fontWeight: 300, backgroundColor: item.priority <= 3 ? "#fee2e2" : "#f0f9ff", color: item.priority <= 3 ? "#991b1b" : "#075985", fontFamily: "'Open Sans', sans-serif" }} />
                          <Typography fontSize="0.85rem" fontWeight={500} fontFamily="'Open Sans', sans-serif">{item.risk}</Typography>
                        </Stack>
                        <Typography fontSize="0.75rem" color="#475569" mb={0.3} fontFamily="'Open Sans', sans-serif">{item.intervention}</Typography>
                        <Typography fontSize="0.72rem" color="#64748b" fontFamily="'Open Sans', sans-serif">Reduction: {item.risk_reduction?.level} • Feasibility: {item.feasibility?.level}</Typography>
                      </Paper>
                    ))}
                  </Box>
                ) : (
                  <TableContainer component={Paper} elevation={0}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: "#f8fafc" }}>
                          {["Priority", "Risk", "Intervention", "Risk Reduction", "Feasibility"].map((h) => (
                            <TableCell key={h} sx={{ fontFamily: "'Open Sans', sans-serif" }}><strong>{h}</strong></TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {risk_stratification.risk_mitigation_priority.sort((a, b) => a.priority - b.priority).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell><Chip size="small" label={item.priority} sx={{ fontWeight: 300, backgroundColor: item.priority <= 3 ? "#fee2e2" : "#f0f9ff", color: item.priority <= 3 ? "#991b1b" : "#075985", fontFamily: "'Open Sans', sans-serif" }} /></TableCell>
                            <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{item.risk}</TableCell>
                            <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{item.intervention}</TableCell>
                            <TableCell><Typography fontSize="0.8rem" fontFamily="'Open Sans', sans-serif">{item.risk_reduction?.level} — {item.risk_reduction?.description}</Typography></TableCell>
                            <TableCell><Typography fontSize="0.8rem" fontFamily="'Open Sans', sans-serif">{item.feasibility?.level} — {item.feasibility?.description}</Typography></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Grid>
            )}

            {risk_stratification.red_flags?.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="error">
                  <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>Red Flags</AlertTitle>
                  {risk_stratification.red_flags.map((flag, idx) => (
                    <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">• {cleanText(flag)}</Typography>
                  ))}
                </Alert>
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={confidence_scores.risk || 0} label="Risk Assessment Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== CLINICAL DETERIORATION WARNING ==================== */}
      {clinical_deterioration_warning && (
        <SectionCard title="Clinical Deterioration Warning" color="#dc2626" urgent={clinical_deterioration_warning.requires_immediate_escalation}>
          <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#991b1b" mb={1.5} fontFamily="'Open Sans', sans-serif">Early Warning Scores</Typography>
          <Grid container spacing={{ xs: 1, sm: 2 }} mb={3}>
            {[
              { key: "NEWS2", bg: "#fef2f2", color: "#991b1b", textColor: "#7f1d1d" },
              { key: "qSOFA", bg: "#fff7ed", color: "#9a3412", textColor: "#7c2d12" },
              { key: "MEWS", bg: "#f0f9ff", color: "#075985", textColor: "#0c4a6e" },
            ].map(({ key, bg, color, textColor }) => {
              const score = clinical_deterioration_warning.early_warning_scores?.[key];
              if (!score) return null;
              return (
                <Grid item xs={12} sm={4} key={key}>
                  <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: bg, borderRadius: 2 }}>
                    <Typography fontSize="0.7rem" color={color} fontWeight={300} fontFamily="'Open Sans', sans-serif">{key} SCORE</Typography>
                    <Typography fontSize={{ xs: "1.6rem", sm: "2rem" }} color={color} fontWeight={300} fontFamily="'Open Sans', sans-serif">{score.total_score}</Typography>
                    <RiskBadge level={score.risk_level} />
                    <Typography fontSize="0.75rem" color={textColor} mt={1} fontFamily="'Open Sans', sans-serif">{score.interpretation}</Typography>
                    {score.recommended_action && (
                      <Typography fontSize="0.7rem" color={color} fontWeight={300} mt={1} fontFamily="'Open Sans', sans-serif">Action: {score.recommended_action}</Typography>
                    )}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>

          {clinical_deterioration_warning.trending_analysis && (
            <>
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#075985" mb={1} fontFamily="'Open Sans', sans-serif">Trending Analysis</Typography>
              <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, backgroundColor: clinical_deterioration_warning.trending_analysis.direction === "improving" ? "#f0fdf4" : "#fef2f2", borderRadius: 2 }}>
                <Grid container spacing={{ xs: 1, sm: 2 }}>
                  {[
                    { label: "Direction", value: clinical_deterioration_warning.trending_analysis.direction?.toUpperCase(), bold: true },
                    { label: "Rate of Change", value: clinical_deterioration_warning.trending_analysis.rate_of_change },
                    { label: "Trajectory", value: clinical_deterioration_warning.trending_analysis.trajectory_prediction },
                    { label: "Time to Crisis", value: clinical_deterioration_warning.trending_analysis.estimated_time_to_crisis, color: "#991b1b", bold: true },
                  ].map((item, i) => (
                    <Grid item xs={6} sm={3} key={i}>
                      <InfoRow label={item.label} value={item.value} color={item.color} bold={item.bold} />
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </>
          )}

          {clinical_deterioration_warning.monitoring_recommendations && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#075985" mb={1} fontFamily="'Open Sans', sans-serif">Monitoring Recommendations</Typography>
              <Alert severity="info">
                <Typography fontSize="0.85rem" fontFamily="'Open Sans', sans-serif"><strong>Frequency:</strong> {clinical_deterioration_warning.monitoring_recommendations.vital_signs_frequency}</Typography>
                <Typography fontSize="0.85rem" mt={0.5} fontFamily="'Open Sans', sans-serif"><strong>Parameters:</strong> {clinical_deterioration_warning.monitoring_recommendations.specific_parameters_to_monitor?.join(", ")}</Typography>
                <Typography fontSize="0.85rem" mt={0.5} fontFamily="'Open Sans', sans-serif"><strong>Duration:</strong> {clinical_deterioration_warning.monitoring_recommendations.monitoring_duration}</Typography>
              </Alert>
            </>
          )}

          {clinical_deterioration_warning.escalation_requirements && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#991b1b" mb={1} fontFamily="'Open Sans', sans-serif">Escalation Requirements</Typography>
              {clinical_deterioration_warning.escalation_requirements.rapid_response_team_needed && (
                <Alert severity="error" sx={{ mb: 1 }}><Typography fontFamily="'Open Sans', sans-serif"><strong>RAPID RESPONSE TEAM ACTIVATION REQUIRED</strong></Typography></Alert>
              )}
              {clinical_deterioration_warning.escalation_requirements.ICU_consultation_needed && (
                <Alert severity="error" sx={{ mb: 1 }}><Typography fontFamily="'Open Sans', sans-serif"><strong>ICU CONSULTATION REQUIRED</strong></Typography></Alert>
              )}
              <Typography fontSize="0.85rem" color="#1e293b" fontFamily="'Open Sans', sans-serif">
                <strong>Recommended Level of Care:</strong>{" "}
                {clinical_deterioration_warning.escalation_requirements.recommended_level_of_care?.toUpperCase()}
              </Typography>
            </>
          )}

          <Box mt={2}>
            <ScoreBar score={confidence_scores.deterioration_warning || 0} label="Deterioration Warning Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== MEDICATION RECONCILIATION ==================== */}
      {medication_reconciliation && (
        <SectionCard title="Medication Reconciliation" color="#10b981">
          {medication_reconciliation.critical_safety_alerts?.length > 0 && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>Critical Medication Safety Alerts</AlertTitle>
              {medication_reconciliation.critical_safety_alerts.map((alert, idx) => (
                <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">• {cleanText(alert)}</Typography>
              ))}
            </Alert>
          )}

          {medication_reconciliation.polypharmacy_assessment && (
            <>
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#166534" mb={1} fontFamily="'Open Sans', sans-serif">Polypharmacy Assessment</Typography>
              <Grid container spacing={{ xs: 1, sm: 2 }} mb={2}>
                <Grid item xs={6} sm={3}>
                  <Paper elevation={0} sx={{ p: 1.5, textAlign: "center", backgroundColor: "#f0fdf4" }}>
                    <Typography fontSize="0.7rem" color="#166534" fontWeight={300} fontFamily="'Open Sans', sans-serif">TOTAL MEDS</Typography>
                    <Typography fontSize={{ xs: "1.4rem", sm: "1.8rem" }} color="#166534" fontWeight={300} fontFamily="'Open Sans', sans-serif">{medication_reconciliation.polypharmacy_assessment.total_medication_count}</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Paper elevation={0} sx={{ p: 1.5, textAlign: "center", backgroundColor: "#fff7ed" }}>
                    <Typography fontSize="0.7rem" color="#9a3412" fontWeight={300} fontFamily="'Open Sans', sans-serif">PILLS/DAY</Typography>
                    <Typography fontSize={{ xs: "1.4rem", sm: "1.8rem" }} color="#9a3412" fontWeight={300} fontFamily="'Open Sans', sans-serif">{medication_reconciliation.polypharmacy_assessment.pills_per_day}</Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#fef2f2" }}>
                    <Typography fontSize="0.7rem" color="#991b1b" fontWeight={300} fontFamily="'Open Sans', sans-serif">CATEGORY</Typography>
                    <RiskBadge level={medication_reconciliation.polypharmacy_assessment.polypharmacy_category} />
                    <Typography fontSize="0.75rem" color="#7f1d1d" mt={0.5} fontFamily="'Open Sans', sans-serif">Complexity: {medication_reconciliation.polypharmacy_assessment.complexity_score}</Typography>
                  </Paper>
                </Grid>
              </Grid>
            </>
          )}

          {medication_reconciliation.duplicate_therapy_issues?.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#991b1b" mb={1} fontFamily="'Open Sans', sans-serif">Duplicate Therapy Issues</Typography>
              {medication_reconciliation.duplicate_therapy_issues.map((dup, idx) => (
                <Paper key={idx} elevation={0} sx={{ p: 1.5, mb: 1, backgroundColor: "#fef2f2", borderLeft: "3px solid #dc2626" }}>
                  <Stack direction="row" spacing={1} mb={0.5} flexWrap="wrap" gap={0.3}>
                    <Typography fontSize="0.85rem" fontWeight={400} color="#991b1b" fontFamily="'Open Sans', sans-serif">{dup.medications?.join(" + ")}</Typography>
                    <RiskBadge level={dup.severity} />
                  </Stack>
                  <Typography fontSize="0.8rem" color="#7f1d1d" mb={0.5} fontFamily="'Open Sans', sans-serif">Type: {dup.duplication_type}</Typography>
                  <Typography fontSize="0.8rem" color="#0f172a" fontFamily="'Open Sans', sans-serif"><strong>Recommendation:</strong> {dup.recommendation}</Typography>
                  <Typography fontSize="0.75rem" color="#075985" fontFamily="'Open Sans', sans-serif">Action: {dup.action}</Typography>
                </Paper>
              ))}
            </>
          )}

          {medication_reconciliation.deprescribing_opportunities?.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#075985" mb={1} fontFamily="'Open Sans', sans-serif">Deprescribing Opportunities</Typography>
              {isMobile ? (
                <Box>
                  {medication_reconciliation.deprescribing_opportunities.sort((a, b) => ({ high: 1, medium: 2, low: 3 }[a.priority] - { high: 1, medium: 2, low: 3 }[b.priority])).map((dep, idx) => (
                    <Paper key={idx} elevation={0} sx={{ p: 1.5, mb: 1, backgroundColor: "#f8fafc", borderRadius: 2 }}>
                      <Stack direction="row" spacing={1} mb={0.5} alignItems="center">
                        <RiskBadge level={dep.priority} />
                        <Typography fontSize="0.85rem" fontWeight={500} fontFamily="'Open Sans', sans-serif">{dep.medication}</Typography>
                      </Stack>
                      <Typography fontSize="0.75rem" color="#475569" mb={0.3} fontFamily="'Open Sans', sans-serif">{dep.rationale}</Typography>
                      <Typography fontSize="0.73rem" color="#0369a1" fontFamily="'Open Sans', sans-serif">{dep.action}</Typography>
                    </Paper>
                  ))}
                </Box>
              ) : (
                <TableContainer component={Paper} elevation={0}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: "#f8fafc" }}>
                        {["Priority", "Medication", "Rationale", "Action", "Expected Benefit"].map((h) => (
                          <TableCell key={h} sx={{ fontFamily: "'Open Sans', sans-serif" }}><strong>{h}</strong></TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {medication_reconciliation.deprescribing_opportunities.sort((a, b) => ({ high: 1, medium: 2, low: 3 }[a.priority] - { high: 1, medium: 2, low: 3 }[b.priority])).map((dep, idx) => (
                        <TableRow key={idx}>
                          <TableCell><RiskBadge level={dep.priority} /></TableCell>
                          <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}><strong>{dep.medication}</strong></TableCell>
                          <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{dep.rationale}</TableCell>
                          <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{dep.action}</TableCell>
                          <TableCell sx={{ fontFamily: "'Open Sans', sans-serif" }}>{dep.expected_benefit}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}

          {medication_reconciliation.high_alert_medications?.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontSize={{ xs: "0.88rem", sm: "0.95rem" }} fontWeight={400} color="#991b1b" mb={1} fontFamily="'Open Sans', sans-serif">High-Alert Medications</Typography>
              {medication_reconciliation.high_alert_medications.map((med, idx) => (
                <Alert key={idx} severity="warning" sx={{ mb: 1 }}>
                  <Typography fontSize="0.85rem" fontWeight={400} fontFamily="'Open Sans', sans-serif">{med.medication}</Typography>
                  <Typography fontSize="0.8rem" fontFamily="'Open Sans', sans-serif">Risk: {med.risk}</Typography>
                  <Typography fontSize="0.75rem" color="#7c2d12" fontFamily="'Open Sans', sans-serif">Precautions: {med.special_precautions?.join(", ")}</Typography>
                </Alert>
              ))}
            </>
          )}

          <Box mt={2}>
            <ScoreBar score={medication_reconciliation.overall_medication_safety_score} label="Medication Safety Score" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== TREATMENT VALIDATION ==================== */}
      {treatment_validation && (
        <SectionCard title="Treatment Validation" color="#8b5cf6">
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#f5f3ff", borderRadius: 2 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "flex-start", sm: "center" }} mb={1}>
                  <Typography fontSize={{ xs: "1rem", sm: "1.2rem" }} fontWeight={400} color="#6d28d9" fontFamily="'Open Sans', sans-serif">
                    {treatment_validation.overall_validity?.status?.toUpperCase()}
                  </Typography>
                  <Chip label={`Confidence: ${Math.round((treatment_validation.overall_validity?.confidence || 0) * 100)}%`} sx={{ fontFamily: "'Open Sans', sans-serif" }} />
                </Stack>
                <Typography fontSize={{ xs: "0.85rem", sm: "0.9rem" }} color="#1e293b" fontFamily="'Open Sans', sans-serif">{treatment_validation.overall_validity?.summary}</Typography>
              </Paper>
            </Grid>

            {treatment_validation.missing_standard_treatments?.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="warning">
                  <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>Missing Standard Treatments</AlertTitle>
                  {treatment_validation.missing_standard_treatments.map((missing, idx) => (
                    <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">
                      • <strong>{missing.treatment}</strong> ({missing.importance}) — {missing.rationale}
                    </Typography>
                  ))}
                </Alert>
              </Grid>
            )}

            {treatment_validation.red_flags?.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="error">
                  <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>Treatment Red Flags</AlertTitle>
                  {treatment_validation.red_flags.map((flag, idx) => (
                    <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">• {cleanText(flag)}</Typography>
                  ))}
                </Alert>
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={confidence_scores.treatment || 0} label="Treatment Validation Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== GUIDELINE COMPLIANCE ==================== */}
      {guideline_compliance && (
        <SectionCard title="Guideline Compliance" color="#8b5cf6">
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#f5f3ff", borderRadius: 2, textAlign: "center" }}>
                <Typography fontSize="0.8rem" color="#6d28d9" fontWeight={300} mb={0.5} fontFamily="'Open Sans', sans-serif">OVERALL COMPLIANCE</Typography>
                <Typography fontSize={{ xs: "1.6rem", sm: "2rem" }} fontWeight={300} color="#6d28d9" mb={1} fontFamily="'Open Sans', sans-serif">
                  {Math.round((guideline_compliance.guideline_adherence_summary?.overall_compliance_score || 0) * 100)}%
                </Typography>
                <Typography fontSize="0.85rem" color="#64748b" fontFamily="'Open Sans', sans-serif">
                  {guideline_compliance.guideline_adherence_summary?.overall_assessment?.replace(/_/g, " ").toUpperCase()}
                </Typography>
              </Paper>
            </Grid>

            {guideline_compliance.deviations_from_guidelines?.length > 0 && (
              <Grid item xs={12}>
                <Typography fontSize={{ xs: "0.88rem", sm: "0.9rem" }} fontWeight={400} color="#991b1b" mb={1} fontFamily="'Open Sans', sans-serif">Guideline Deviations</Typography>
                {guideline_compliance.deviations_from_guidelines.map((dev, idx) => (
                  <Paper key={idx} elevation={0} sx={{ p: 1.5, mb: 1, backgroundColor: "#fef2f2", borderRadius: 2 }}>
                    <Stack direction="row" spacing={1} mb={0.5} flexWrap="wrap" gap={0.3}>
                      <Typography fontSize="0.85rem" fontWeight={400} color="#991b1b" fontFamily="'Open Sans', sans-serif">{dev.guideline_recommendation}</Typography>
                      <RiskBadge level={dev.medicolegal_risk} />
                    </Stack>
                    <Typography fontSize="0.75rem" color="#64748b" fontFamily="'Open Sans', sans-serif">Justification: {dev.justification}</Typography>
                  </Paper>
                ))}
              </Grid>
            )}

            {guideline_compliance.medicolegal_risk_assessment && (
              <Grid item xs={12}>
                <Alert severity={guideline_compliance.medicolegal_risk_assessment.overall_risk_level === "very_high" ? "error" : guideline_compliance.medicolegal_risk_assessment.overall_risk_level === "high" ? "warning" : "info"}>
                  <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>
                    Medicolegal Risk: {guideline_compliance.medicolegal_risk_assessment.overall_risk_level?.toUpperCase()}
                  </AlertTitle>
                  {guideline_compliance.medicolegal_risk_assessment.specific_vulnerabilities?.map((vuln, idx) => (
                    <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">• {vuln}</Typography>
                  ))}
                </Alert>
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={confidence_scores.guideline_compliance || 0} label="Guideline Compliance Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== ADVANCED TREATMENT INTELLIGENCE ==================== */}
      {advanced_treatment_intelligence && (
        <SectionCard title="Advanced Treatment Intelligence" color="#0369a1">
          <Alert severity="info" icon={false} sx={{ mb: 3, backgroundColor: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 2 }}>
            <Typography fontSize="0.78rem" color="#075985" fontFamily="'Open Sans', sans-serif">
              <strong>AI Advisory Notice:</strong>{" "}
              {advanced_treatment_intelligence.treatment_intelligence_summary?.physician_advisory_notice}
            </Typography>
          </Alert>

          {advanced_treatment_intelligence.treatment_intelligence_summary?.top_3_priority_actions?.length > 0 && (
            <>
              <SubSectionTitle color="#0369a1">Priority Actions</SubSectionTitle>
              <Grid container spacing={{ xs: 1, sm: 2 }} mb={3}>
                {advanced_treatment_intelligence.treatment_intelligence_summary.top_3_priority_actions.map((action, idx) => (
                  <Grid item xs={12} md={4} key={idx}>
                    <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, height: "100%", borderRadius: 2, backgroundColor: idx === 0 ? "#fef2f2" : idx === 1 ? "#fff7ed" : "#f0f9ff", borderTop: `4px solid ${idx === 0 ? "#dc2626" : idx === 1 ? "#f59e0b" : "#0ea5e9"}` }}>
                      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                        <Typography fontSize="0.68rem" fontWeight={600} color={idx === 0 ? "#991b1b" : idx === 1 ? "#9a3412" : "#075985"} letterSpacing="0.05em" fontFamily="'Open Sans', sans-serif">
                          PRIORITY #{action.rank}
                        </Typography>
                        <UrgencyBadge level={action.urgency} />
                      </Box>
                      <Typography fontSize={{ xs: "0.82rem", sm: "0.88rem" }} fontWeight={500} color="#0f172a" mb={1} lineHeight={1.5} fontFamily="'Open Sans', sans-serif">
                        {action.action}
                      </Typography>
                      <Typography fontSize="0.78rem" color="#475569" lineHeight={1.5} fontFamily="'Open Sans', sans-serif">
                        {action.justification}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {advanced_treatment_intelligence.pharmacological_plan?.first_line_therapy?.length > 0 && (
            <>
              <Divider sx={{ my: 2.5 }} />
              <SubSectionTitle color="#0369a1">Pharmacological Plan</SubSectionTitle>
              <Typography fontSize="0.78rem" fontWeight={500} color="#166534" mb={1} fontFamily="'Open Sans', sans-serif">First-Line Therapy</Typography>
              {advanced_treatment_intelligence.pharmacological_plan.first_line_therapy.map((drug, idx) => (
                <Paper key={idx} elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, mb: 2, borderRadius: 2, backgroundColor: "#f8faff", border: "1px solid #e0e7ff" }}>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1} mb={1.5}>
                    <Box>
                      <Typography fontSize={{ xs: "0.9rem", sm: "1rem" }} fontWeight={500} color="#1e3a8a" fontFamily="'Open Sans', sans-serif">{drug.drug}</Typography>
                      <Typography fontSize="0.75rem" color="#64748b" fontFamily="'Open Sans', sans-serif">{drug.drug_class}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.3}>
                      {drug.guideline_support?.recommendation_class && <GuidelineBadge level={`Class ${drug.guideline_support.recommendation_class}`} />}
                      {drug.guideline_support?.evidence_level && <GuidelineBadge level={`Level ${drug.guideline_support.evidence_level}`} />}
                    </Stack>
                  </Box>

                  <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#eff6ff", borderRadius: 1.5, mb: 1.5 }}>
                    <Typography fontSize="0.68rem" color="#1d4ed8" fontWeight={600} mb={0.3} letterSpacing="0.04em" fontFamily="'Open Sans', sans-serif">CLINICAL RATIONALE</Typography>
                    <Typography fontSize="0.82rem" color="#1e3a8a" lineHeight={1.6} fontFamily="'Open Sans', sans-serif">{drug.clinical_rationale}</Typography>
                  </Paper>

                  {drug.dosing && (
                    <Box mb={1.5}>
                      <Typography fontSize="0.68rem" color="#64748b" fontWeight={600} mb={0.8} letterSpacing="0.04em" fontFamily="'Open Sans', sans-serif">DOSING</Typography>
                      <Box display="flex" flexWrap="wrap">
                        <InlinePill label="Start" value={drug.dosing.starting_dose} pillBg="#e0e7ff" pillColor="#3730a3" />
                        <InlinePill label="Target" value={drug.dosing.target_dose} pillBg="#dbeafe" pillColor="#1e40af" />
                        <InlinePill label="Frequency" value={drug.dosing.frequency} pillBg="#f0f9ff" pillColor="#075985" />
                        <InlinePill label="Route" value={drug.dosing.route} pillBg="#f1f5f9" pillColor="#334155" />
                        <InlinePill label="Duration" value={drug.duration} pillBg="#f1f5f9" pillColor="#334155" />
                      </Box>
                    </Box>
                  )}

                  <Grid container spacing={1.5}>
                    {drug.efficacy_monitoring && (
                      <Grid item xs={12} sm={6}>
                        <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#f0fdf4", borderRadius: 1.5 }}>
                          <Typography fontSize="0.68rem" color="#166534" fontWeight={600} mb={0.5} letterSpacing="0.04em" fontFamily="'Open Sans', sans-serif">EFFICACY MONITORING</Typography>
                          {drug.efficacy_monitoring.parameters?.map((p, i) => (
                            <Typography key={i} fontSize="0.75rem" color="#15803d" fontFamily="'Open Sans', sans-serif">• {p}</Typography>
                          ))}
                        </Paper>
                      </Grid>
                    )}
                    {drug.safety_monitoring && (
                      <Grid item xs={12} sm={6}>
                        <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#fff7ed", borderRadius: 1.5 }}>
                          <Typography fontSize="0.68rem" color="#9a3412" fontWeight={600} mb={0.5} letterSpacing="0.04em" fontFamily="'Open Sans', sans-serif">SAFETY MONITORING</Typography>
                          {drug.safety_monitoring.parameters?.map((p, i) => (
                            <Typography key={i} fontSize="0.75rem" color="#7c2d12" fontFamily="'Open Sans', sans-serif">• {p}</Typography>
                          ))}
                        </Paper>
                      </Grid>
                    )}
                  </Grid>
                </Paper>
              ))}
            </>
          )}

          {advanced_treatment_intelligence.monitoring_and_followup && (
            <>
              <Divider sx={{ my: 2.5 }} />
              <SubSectionTitle color="#0369a1">Monitoring & Follow-Up Plan</SubSectionTitle>
              <Grid container spacing={{ xs: 1, sm: 2 }} mb={2}>
                {[
                  { key: "immediate_week_1", label: "Week 1", bg: "#fef2f2", color: "#991b1b" },
                  { key: "month_1", label: "Month 1", bg: "#fff7ed", color: "#9a3412" },
                  { key: "long_term", label: "Long-Term", bg: "#f0f9ff", color: "#075985" },
                ].map((period) => {
                  const d = advanced_treatment_intelligence.monitoring_and_followup[period.key];
                  return (
                    <Grid item xs={12} md={4} key={period.key}>
                      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: period.bg, borderRadius: 2, height: "100%" }}>
                        <Typography fontSize="0.72rem" fontWeight={600} color={period.color} mb={1} letterSpacing="0.05em" fontFamily="'Open Sans', sans-serif">{period.label}</Typography>
                        {d?.labs?.length > 0 && (
                          <Box mb={1}>
                            <Typography fontSize="0.68rem" color="#64748b" fontFamily="'Open Sans', sans-serif">Labs:</Typography>
                            {d.labs.map((lab, i) => <Typography key={i} fontSize="0.73rem" color="#1e293b" fontFamily="'Open Sans', sans-serif">• {lab}</Typography>)}
                          </Box>
                        )}
                        {d?.targets_to_achieve?.length > 0 && (
                          <Box mb={1}>
                            <Typography fontSize="0.68rem" color="#64748b" fontFamily="'Open Sans', sans-serif">Targets:</Typography>
                            {d.targets_to_achieve.map((t, i) => <Typography key={i} fontSize="0.73rem" color="#166534" fontFamily="'Open Sans', sans-serif">✓ {t}</Typography>)}
                          </Box>
                        )}
                        {d?.escalation_criteria?.length > 0 && (
                          <Box>
                            <Typography fontSize="0.68rem" color="#991b1b" fontFamily="'Open Sans', sans-serif">Escalate if:</Typography>
                            {d.escalation_criteria.map((c, i) => <Typography key={i} fontSize="0.73rem" color="#7f1d1d" fontFamily="'Open Sans', sans-serif">• {c}</Typography>)}
                          </Box>
                        )}
                        {d?.review_frequency && (
                          <Typography fontSize="0.72rem" color="#0369a1" mt={0.5} fontFamily="'Open Sans', sans-serif">Review: {d.review_frequency}</Typography>
                        )}
                      </Paper>
                    </Grid>
                  );
                })}
              </Grid>

              {advanced_treatment_intelligence.monitoring_and_followup.emergency_warning_signs?.length > 0 && (
                <Alert severity="error" sx={{ borderRadius: 2 }}>
                  <Typography fontSize="0.72rem" fontWeight={600} mb={0.8} fontFamily="'Open Sans', sans-serif">EMERGENCY WARNING SIGNS — Patient/Caregiver Must Know</Typography>
                  <Grid container spacing={1}>
                    {advanced_treatment_intelligence.monitoring_and_followup.emergency_warning_signs.map((sign, idx) => (
                      <Grid item xs={12} sm={6} key={idx}>
                        <Typography fontSize="0.78rem" fontFamily="'Open Sans', sans-serif"><strong>{sign.sign}</strong> — {sign.action}</Typography>
                      </Grid>
                    ))}
                  </Grid>
                </Alert>
              )}
            </>
          )}

          <Box mt={2.5}>
            <ScoreBar score={advanced_treatment_intelligence.confidence_score} label="Treatment Intelligence Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== DISCHARGE READINESS ==================== */}
      {discharge_readiness && (
        <SectionCard title="Discharge Readiness" color="#10b981" urgent={!discharge_readiness.discharge_readiness_assessment?.ready_for_discharge}>
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 3 }, backgroundColor: discharge_readiness.discharge_readiness_assessment?.ready_for_discharge ? "#f0fdf4" : "#fef2f2", borderRadius: 2, textAlign: "center" }}>
                <Chip
                  label={discharge_readiness.discharge_readiness_assessment?.ready_for_discharge ? "READY FOR DISCHARGE" : "NOT READY FOR DISCHARGE"}
                  sx={{ fontSize: { xs: "0.82rem", sm: "1rem" }, fontWeight: 300, p: { xs: 1.5, sm: 2 }, backgroundColor: discharge_readiness.discharge_readiness_assessment?.ready_for_discharge ? "#dcfce7" : "#fee2e2", color: discharge_readiness.discharge_readiness_assessment?.ready_for_discharge ? "#166534" : "#991b1b", fontFamily: "'Open Sans', sans-serif", height: "auto", "& .MuiChip-label": { whiteSpace: "normal" } }}
                />
                <Typography fontSize={{ xs: "0.85rem", sm: "0.95rem" }} color="#1e293b" mt={2} lineHeight={1.6} fontFamily="'Open Sans', sans-serif">
                  {discharge_readiness.discharge_readiness_assessment?.assessment_summary}
                </Typography>
              </Paper>
            </Grid>

            <Grid item xs={12}>
              <ScoreBar score={discharge_readiness.discharge_readiness_assessment?.overall_readiness_score} label="Overall Readiness Score" />
            </Grid>

            {discharge_readiness.readmission_risk && (
              <Grid item xs={12}>
                <Typography fontSize={{ xs: "0.88rem", sm: "0.9rem" }} fontWeight={400} color="#991b1b" mb={1} fontFamily="'Open Sans', sans-serif">30-Day Readmission Risk</Typography>
                <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, backgroundColor: "#fef2f2", borderRadius: 2 }}>
                  <Grid container spacing={{ xs: 1, sm: 2 }}>
                    <Grid item xs={4}>
                      <Typography fontSize="0.75rem" color="#64748b" fontWeight={300} fontFamily="'Open Sans', sans-serif">RISK LEVEL</Typography>
                      <RiskBadge level={discharge_readiness.readmission_risk.risk_level} />
                    </Grid>
                    <Grid item xs={4}>
                      <Typography fontSize="0.75rem" color="#64748b" fontWeight={300} fontFamily="'Open Sans', sans-serif">LACE INDEX</Typography>
                      <Typography fontSize={{ xs: "1.2rem", sm: "1.5rem" }} fontWeight={300} color="#991b1b" fontFamily="'Open Sans', sans-serif">{discharge_readiness.readmission_risk.lace_index}</Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography fontSize="0.75rem" color="#64748b" fontWeight={300} fontFamily="'Open Sans', sans-serif">30-DAY PROB.</Typography>
                      <Typography fontSize={{ xs: "1.2rem", sm: "1.5rem" }} fontWeight={300} color="#991b1b" fontFamily="'Open Sans', sans-serif">{discharge_readiness.readmission_risk["30_day_readmission_probability"]}%</Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            )}

            {discharge_readiness.barriers_to_discharge?.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="warning">
                  <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>Barriers to Discharge</AlertTitle>
                  {discharge_readiness.barriers_to_discharge.map((barrier, idx) => (
                    <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">
                      • <strong>{barrier.barrier}</strong> ({barrier.severity}) — {barrier.resolution_plan}
                    </Typography>
                  ))}
                </Alert>
              </Grid>
            )}

            {discharge_readiness.red_flags_preventing_discharge?.length > 0 && (
              <Grid item xs={12}>
                <Alert severity="error">
                  <AlertTitle sx={{ fontWeight: 400, fontFamily: "'Open Sans', sans-serif" }}>Red Flags Preventing Discharge</AlertTitle>
                  {discharge_readiness.red_flags_preventing_discharge.map((flag, idx) => (
                    <Typography key={idx} fontSize="0.85rem" fontFamily="'Open Sans', sans-serif">• {cleanText(flag)}</Typography>
                  ))}
                </Alert>
              </Grid>
            )}
          </Grid>

          <Box mt={2}>
            <ScoreBar score={confidence_scores.discharge_readiness || 0} label="Discharge Readiness Confidence" />
          </Box>
        </SectionCard>
      )}

      {/* ==================== CONFIDENCE SCORES SUMMARY ==================== */}
      <Card elevation={2} sx={{ borderRadius: 3, borderLeft: "6px solid #64748b" }}>
        <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 3 }, "&:last-child": { pb: { xs: 1.5, sm: 2, md: 3 } } }}>
          <Typography fontSize={{ xs: "1rem", sm: "1.2rem" }} fontWeight={300} color="#1e293b" mb={2} fontFamily="'Open Sans', sans-serif">
            Overall Confidence Scores
          </Typography>
          <Grid container spacing={{ xs: 1, sm: 2 }}>
            {Object.entries(confidence_scores).map(([key, score]) => (
              <Grid item xs={12} sm={6} md={4} key={key}>
                <ScoreBar score={score} label={key.replace(/_/g, " ").toUpperCase()} />
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ClinicalReasoningDashboard;