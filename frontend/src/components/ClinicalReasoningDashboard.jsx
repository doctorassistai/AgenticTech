import React, { useEffect, useState, useRef } from "react";

import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Grid,
  Alert,
  AlertTitle,
  CircularProgress,
  Divider,
  Stack,
  LinearProgress,
  Button,
  Collapse,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from "@mui/material";
import {
  ExpandMore as ExpandMoreIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  LocalHospital as HospitalIcon,
  Refresh as RefreshIcon,
  Medication as MedicationIcon,
  HeartBroken as HeartBrokenIcon,
  Healing as HealingIcon,
  ExitToApp as DischargeIcon,
  Timeline as TimelineIcon,
  ReportProblem as ReportProblemIcon,
} from "@mui/icons-material";

/* ============================================================================
   UTILITY COMPONENTS - Clean & Fast to Read
   ============================================================================ */

const ConfidenceMeter = ({ score, size = "medium" }) => {
  const percentage = Math.round((score || 0) * 100);
  const getColor = () => {
    if (percentage >= 80) return "#10b981";
    if (percentage >= 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
        <Typography fontSize={size === "small" ? "0.75rem" : "0.85rem"} color="#64748b" fontWeight={600}>
          Confidence
        </Typography>
        <Typography fontSize={size === "small" ? "0.85rem" : "1rem"} fontWeight={700} color={getColor()}>
          {percentage}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percentage}
        sx={{
          height: size === "small" ? 6 : 8,
          borderRadius: 4,
          backgroundColor: "#e5e7eb",
          "& .MuiLinearProgress-bar": {
            backgroundColor: getColor(),
            borderRadius: 4,
          },
        }}
      />
    </Box>
  );
};

const QuickStatusCard = ({ title, value, subtitle, color = "#0ea5e9", icon }) => (
  <Card elevation={2} sx={{ height: "100%", borderTop: `4px solid ${color}` }}>
    <CardContent>
      <Stack spacing={1}>
        <Box display="flex" alignItems="center" gap={1}>
          {icon}
          <Typography fontSize="0.75rem" color="#64748b" fontWeight={600} textTransform="uppercase">
            {title}
          </Typography>
        </Box>
        <Typography fontSize="1.5rem" fontWeight={800} color={color}>
          {value}
        </Typography>
        {subtitle && (
          <Typography fontSize="0.8rem" color="#64748b">
            {subtitle}
          </Typography>
        )}
      </Stack>
    </CardContent>
  </Card>
);

const RiskChip = ({ level }) => {
  const configs = {
    critical: { bg: "#fee2e2", color: "#991b1b", label: "CRITICAL" },
    high: { bg: "#fef2f2", color: "#dc2626", label: "HIGH" },
    moderate: { bg: "#fff7ed", color: "#ea580c", label: "MODERATE" },
    medium: { bg: "#fff7ed", color: "#ea580c", label: "MODERATE" },
    low: { bg: "#dcfce7", color: "#166534", label: "LOW" },
    unknown: { bg: "#f3f4f6", color: "#6b7280", label: "UNKNOWN" },
  };

  const config = configs[level?.toLowerCase()] || configs.unknown;

  return (
    <Chip
      size="small"
      label={config.label}
      sx={{
        fontSize: "0.7rem",
        fontWeight: 700,
        backgroundColor: config.bg,
        color: config.color,
        height: 24,
      }}
    />
  );
};

const ExpandableSection = ({ title, children, defaultExpanded = false, urgent = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded || urgent);

  return (
    <Card
      elevation={urgent ? 4 : 2}
      sx={{
        mb: 2,
        borderLeft: urgent ? "4px solid #dc2626" : "none",
        backgroundColor: urgent ? "#fef2f2" : "#ffffff",
      }}
    >
      <CardContent>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          sx={{ cursor: "pointer" }}
          onClick={() => setExpanded(!expanded)}
        >
          <Typography fontSize="1.1rem" fontWeight={700} color={urgent ? "#991b1b" : "#1e293b"}>
            {title}
          </Typography>
          <IconButton size="small">
            <ExpandMoreIcon
              sx={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.3s",
              }}
            />
          </IconButton>
        </Box>
        <Collapse in={expanded}>
          <Box mt={2}>{children}</Box>
        </Collapse>
      </CardContent>
    </Card>
  );
};

/* ============================================================================
   MAIN DASHBOARD COMPONENT
   ============================================================================ */

const ClinicalReasoningDashboard = ({ patientId, doctorId, consultationText }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const hasFetchedRef = useRef(false);
  const API_BASE = import.meta.env.VITE_BACKEND_URL

  const fetchClinicalReasoning = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE}hms/users/ai-legacy/api/v2/clinical-reasoning`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            consultation_text:
              consultationText || "Clinical reasoning analysis requested",
            max_iterations: 2,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `API Error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to fetch clinical reasoning");
      console.error("Clinical Reasoning Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!patientId || !doctorId) return;
    if (hasFetchedRef.current) return;

    console.log("🔥 Clinical Reasoning API fired on page load");
    hasFetchedRef.current = true;
    fetchClinicalReasoning();
  }, [patientId, doctorId]);

  /* ============================================================================
     LOADING & ERROR STATES
     ============================================================================ */

  if (loading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="400px"
        gap={3}
      >
        <CircularProgress size={60} thickness={4} />
        <Box textAlign="center">
          <Typography fontSize="1.2rem" fontWeight={700} color="#1e293b">
            Analyzing Patient Data...
          </Typography>
          <Typography fontSize="0.9rem" color="#64748b" mt={1}>
            Running comprehensive clinical reasoning workflow
          </Typography>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        <AlertTitle>Clinical Reasoning Failed</AlertTitle>
        {error}
        <Button
          onClick={fetchClinicalReasoning}
          sx={{ mt: 2 }}
          startIcon={<RefreshIcon />}
          variant="outlined"
        >
          Retry Analysis
        </Button>
      </Alert>
    );
  }

  if (!data) {
    return (
      <Box textAlign="center" p={4}>
        <Typography color="#64748b" mb={2}>
          No clinical reasoning data available
        </Typography>
        <Button
          onClick={fetchClinicalReasoning}
          variant="contained"
          startIcon={<RefreshIcon />}
        >
          Generate Clinical Reasoning
        </Button>
      </Box>
    );
  }

  /* ============================================================================
     EXTRACT DATA
     ============================================================================ */

  const {
    request_id,
    timestamp,
    patient_id,
    primary_diagnosis,
    risk_level,
    discharge_recommendation,
    overall_confidence,
    requires_review,
    warnings = [],
    agents_summary = [],
    iterations_performed,
    contradictions_resolved,
    contradictions_remaining,
    detailed_outputs = {},
  } = data;

  const {
    differential_diagnosis,
    medication_reconciliation,
    risk_stratification,
    treatment_validation,
    discharge_readiness,
    reasoning_coordination,
  } = detailed_outputs;

  /* ============================================================================
     RENDER DASHBOARD
     ============================================================================ */

  return (
    <Box sx={{ maxWidth: 1400, mx: "auto", p: 3, fontFamily: '"Inter", "Segoe UI", sans-serif' }}>
      {/* ==================== HEADER INFO ==================== */}
      <Card elevation={2} sx={{ mb: 3, backgroundColor: "#f8fafc" }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Typography fontSize="0.8rem" color="#64748b" fontWeight={600}>
                Request ID
              </Typography>
              <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                {request_id}
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography fontSize="0.8rem" color="#64748b" fontWeight={600}>
                Timestamp
              </Typography>
              <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                {new Date(timestamp).toLocaleString()}
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography fontSize="0.8rem" color="#64748b" fontWeight={600}>
                Patient ID
              </Typography>
              <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                {patient_id}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* ==================== CRITICAL ALERTS ==================== */}
      {warnings.length > 0 && (
        <Alert
          severity="error"
          icon={<WarningIcon fontSize="large" />}
          sx={{
            mb: 3,
            borderLeft: "6px solid #dc2626",
            "& .MuiAlert-message": { width: "100%" },
          }}
        >
          <AlertTitle sx={{ fontSize: "1.1rem", fontWeight: 800 }}>
            ⚠️ {warnings.length} Critical Alert{warnings.length > 1 ? "s" : ""} Require Immediate Attention
          </AlertTitle>
          <Box mt={1}>
            {warnings.slice(0, 10).map((warning, idx) => (
              <Typography key={idx} fontSize="0.9rem" fontWeight={600} sx={{ mt: 0.5 }}>
                • {warning}
              </Typography>
            ))}
            {warnings.length > 10 && (
              <Typography fontSize="0.85rem" color="#991b1b" fontStyle="italic" mt={1}>
                + {warnings.length - 10} more warnings
              </Typography>
            )}
          </Box>
        </Alert>
      )}

      {/* ==================== QUICK OVERVIEW ==================== */}
      <Card elevation={3} sx={{ mb: 3, borderTop: "6px solid #0ea5e9" }}>
        <CardContent>
          <Typography fontSize="1.3rem" fontWeight={800} color="#0f172a" mb={2}>
            📋 Clinical Summary
          </Typography>

          {/* Status Cards Row */}
          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} sm={6} md={3}>
              <QuickStatusCard
                title="Primary Diagnosis"
                value={primary_diagnosis || "Pending"}
                color="#6366f1"
                icon={<HospitalIcon sx={{ color: "#6366f1" }} />}
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <QuickStatusCard
                title="Risk Level"
                value={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <RiskChip level={risk_level} />
                  </Stack>
                }
                color="#dc2626"
                icon={<WarningIcon sx={{ color: "#dc2626" }} />}
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <QuickStatusCard
                title="Discharge Status"
                value={discharge_recommendation || "Evaluating"}
                subtitle={
                  discharge_readiness?.safe_to_discharge
                    ? "Ready for discharge"
                    : "Not ready - barriers present"
                }
                color={discharge_readiness?.safe_to_discharge ? "#10b981" : "#f59e0b"}
                icon={
                  discharge_readiness?.safe_to_discharge ? (
                    <CheckCircleIcon sx={{ color: "#10b981" }} />
                  ) : (
                    <InfoIcon sx={{ color: "#f59e0b" }} />
                  )
                }
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card
                elevation={2}
                sx={{ height: "100%", borderTop: requires_review ? "4px solid #dc2626" : "4px solid #10b981" }}
              >
                <CardContent>
                  <Typography fontSize="0.75rem" color="#64748b" fontWeight={600} textTransform="uppercase" mb={1}>
                    Analysis Status
                  </Typography>
                  <Chip
                    label={requires_review ? "REQUIRES REVIEW" : "ANALYSIS COMPLETE"}
                    sx={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      backgroundColor: requires_review ? "#fee2e2" : "#dcfce7",
                      color: requires_review ? "#991b1b" : "#166534",
                      width: "100%",
                    }}
                  />
                  <Box mt={2}>
                    <ConfidenceMeter score={overall_confidence} size="small" />
                  </Box>
                  <Typography fontSize="0.7rem" color="#64748b" mt={1}>
                    {iterations_performed} iteration{iterations_performed !== 1 ? "s" : ""} | 
                    {contradictions_resolved} resolved, {contradictions_remaining} remaining
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Agent Summary Pills */}
          <Divider sx={{ my: 2 }} />
          <Typography fontSize="0.85rem" fontWeight={600} color="#64748b" mb={1}>
            Agent Analysis Summary
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {agents_summary.map((agent, idx) => (
              <Card key={idx} variant="outlined" sx={{ p: 1, minWidth: 200 }}>
                <Typography fontSize="0.75rem" fontWeight={700} color="#1e293b">
                  {agent.agent_name}
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mt={0.5}>
                  <Typography fontSize="0.75rem" color="#64748b">
                    Confidence: {Math.round(agent.confidence * 100)}%
                  </Typography>
                  <RiskChip level={agent.confidence > 0.7 ? "low" : agent.confidence > 0.5 ? "moderate" : "high"} />
                </Stack>
                {agent.key_findings && agent.key_findings.length > 0 && (
                  <Typography fontSize="0.7rem" color="#64748b" mt={0.5}>
                    {agent.key_findings[0]}
                    {agent.key_findings.length > 1 && ` +${agent.key_findings.length - 1}`}
                  </Typography>
                )}
              </Card>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* ==================== REASONING COORDINATION ==================== */}
      {reasoning_coordination && (
        <ExpandableSection 
          title="🔄 Reasoning Coordination" 
          urgent={!reasoning_coordination.safe_to_proceed}
          defaultExpanded={true}
        >
          <Card variant="outlined" sx={{ mb: 2, backgroundColor: reasoning_coordination.safe_to_proceed ? "#f0fdf4" : "#fef2f2" }}>
            <CardContent>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Overall Consistency: {reasoning_coordination.overall_consistency?.toUpperCase() || "UNKNOWN"}
              </Typography>
              <Chip
                label={reasoning_coordination.safe_to_proceed ? "SAFE TO PROCEED" : "REQUIRES REANALYSIS"}
                sx={{
                  backgroundColor: reasoning_coordination.safe_to_proceed ? "#dcfce7" : "#fee2e2",
                  color: reasoning_coordination.safe_to_proceed ? "#166534" : "#991b1b",
                  fontWeight: 700,
                }}
              />
              <Typography fontSize="0.9rem" color="#64748b" mt={1}>
                {reasoning_coordination.requires_reanalysis ? "Reanalysis required: " + reasoning_coordination.reanalysis_reason : "No reanalysis needed"}
              </Typography>
            </CardContent>
          </Card>

          {reasoning_coordination.contradictions && reasoning_coordination.contradictions.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#dc2626" mb={1}>
                Contradictions ({reasoning_coordination.contradictions.length})
              </Typography>
              {reasoning_coordination.contradictions.map((contra, idx) => (
                <Card key={idx} variant="outlined" sx={{ mb: 1, p: 2, borderLeft: "4px solid #dc2626" }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626">
                        {contra.agent_1}: {contra.agent_1_conclusion}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626">
                        {contra.agent_2}: {contra.agent_2_conclusion}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography fontSize="0.8rem" color="#991b1b">
                        Severity: {contra.severity?.toUpperCase()} | Implication: {contra.clinical_implication}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#1e293b" mt={0.5}>
                        Resolution: {contra.resolution_strategy}
                      </Typography>
                    </Grid>
                  </Grid>
                </Card>
              ))}
            </Box>
          )}

          {reasoning_coordination.inconsistencies && reasoning_coordination.inconsistencies.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#f59e0b" mb={1}>
                Inconsistencies ({reasoning_coordination.inconsistencies.length})
              </Typography>
              {reasoning_coordination.inconsistencies.map((inc, idx) => (
                <Card key={idx} variant="outlined" sx={{ mb: 1, p: 2, borderLeft: "4px solid #f59e0b" }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                    {inc.agent}: {inc.finding}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Conflicting Data: {inc.conflicting_data}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#ea580c" mt={0.5}>
                    Concern: {inc.clinical_concern}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#1e293b" mt={0.5}>
                    Action: {inc.recommended_action}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}

          {reasoning_coordination.critical_gaps && reasoning_coordination.critical_gaps.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#ef4444" mb={1}>
                Critical Gaps ({reasoning_coordination.critical_gaps.length})
              </Typography>
              {reasoning_coordination.critical_gaps.map((gap, idx) => (
                <Card key={idx} variant="outlined" sx={{ mb: 1, p: 2, borderLeft: "4px solid #ef4444" }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                    {gap.gap}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Affected Agents: {gap.affected_agents?.join(", ")}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#dc2626" mt={0.5}>
                    Safety Impact: {gap.patient_safety_impact?.toUpperCase()}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#1e293b" mt={0.5}>
                    Required Action: {gap.required_action}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}

          {reasoning_coordination.reanalysis_triggers && reasoning_coordination.reanalysis_triggers.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#0ea5e9" mb={1}>
                Reanalysis Triggers ({reasoning_coordination.reanalysis_triggers.length})
              </Typography>
              {reasoning_coordination.reanalysis_triggers.map((trigger, idx) => (
                <Card key={idx} variant="outlined" sx={{ mb: 1, p: 2 }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                    {trigger.trigger}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Agent to Rerun: {trigger.agent_to_rerun}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#1e293b" mt={0.5}>
                    Reason: {trigger.reason} | Priority: {trigger.priority?.toUpperCase()}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}

          {reasoning_coordination.resolutions && reasoning_coordination.resolutions.length > 0 && (
            <Box>
              <Typography fontSize="1rem" fontWeight={700} color="#10b981" mb={1}>
                Resolutions ({reasoning_coordination.resolutions.length})
              </Typography>
              {reasoning_coordination.resolutions.map((res, idx) => (
                <Card key={idx} variant="outlined" sx={{ mb: 1, p: 2, borderLeft: "4px solid #10b981" }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                    {res.contradiction_or_gap}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Resolution: {res.resolution}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#166534" mt={0.5}>
                    Confidence: {res.confidence?.toUpperCase()}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}
        </ExpandableSection>
      )}

      {/* ==================== MUST-NOT-MISS DIAGNOSES ==================== */}
      {differential_diagnosis?.must_not_miss_diagnoses?.length > 0 && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
            borderLeft: "6px solid #991b1b",
          }}
        >
          <AlertTitle sx={{ fontSize: "1rem", fontWeight: 700 }}>
            🚨 Must-Not-Miss Diagnoses ({differential_diagnosis.must_not_miss_diagnoses.length})
          </AlertTitle>
          {differential_diagnosis.must_not_miss_diagnoses.map((dx, idx) => (
            <Box key={idx} mb={1} p={1.5} sx={{ backgroundColor: "#fff", borderRadius: 1 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" mb={0.5} alignItems="center">
                <Typography fontSize="0.9rem" fontWeight={700} color="#991b1b">
                  {dx.diagnosis}
                </Typography>
                <RiskChip level={dx.urgency} />
                <Chip size="small" label={`${dx.probability}% probability`} />
                <Chip size="small" label={dx.severity} sx={{ backgroundColor: "#fee2e2", color: "#991b1b" }} />
              </Stack>
              <Typography fontSize="0.8rem" color="#7f1d1d" mb={1}>
                {dx.reasoning}
              </Typography>
              
              <Grid container spacing={1}>
                <Grid item xs={12} md={6}>
                  <Typography fontSize="0.75rem" fontWeight={600} color="#166534">
                    Features Present:
                  </Typography>
                  {dx.key_features_present?.map((feature, i) => (
                    <Typography key={i} fontSize="0.75rem" color="#0f172a">
                      ✓ {feature}
                    </Typography>
                  ))}
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography fontSize="0.75rem" fontWeight={600} color="#dc2626">
                    Features Absent:
                  </Typography>
                  {dx.key_features_absent?.map((feature, i) => (
                    <Typography key={i} fontSize="0.75rem" color="#64748b">
                      ✗ {feature}
                    </Typography>
                  ))}
                </Grid>
              </Grid>
              
              {dx.recommended_rule_out_tests && dx.recommended_rule_out_tests.length > 0 && (
                <Typography fontSize="0.75rem" color="#0ea5e9" mt={1}>
                  Tests to Rule Out: {dx.recommended_rule_out_tests.join(", ")}
                </Typography>
              )}
            </Box>
          ))}
        </Alert>
      )}

      {/* ==================== DIFFERENTIAL DIAGNOSIS DETAILS ==================== */}
      {differential_diagnosis && (
        <ExpandableSection title="🔍 Differential Diagnosis" defaultExpanded={false}>
          {/* Clinical Reasoning Section */}
          <Card variant="outlined" sx={{ mb: 3, p: 2 }}>
            <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
              Clinical Reasoning
            </Typography>
            <Typography fontSize="0.9rem" color="#64748b" mb={2}>
              {differential_diagnosis.clinical_reasoning?.problem_representation}
            </Typography>
            
            {differential_diagnosis.clinical_reasoning?.semantic_qualifiers && (
              <Box mb={2}>
                <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                  Semantic Qualifiers:
                </Typography>
                <Grid container spacing={1} mt={0.5}>
                  <Grid item xs={6} md={3}>
                    <Typography fontSize="0.8rem" color="#64748b">Acuity: <strong>{differential_diagnosis.clinical_reasoning.semantic_qualifiers.acuity}</strong></Typography>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Typography fontSize="0.8rem" color="#64748b">Trajectory: <strong>{differential_diagnosis.clinical_reasoning.semantic_qualifiers.trajectory}</strong></Typography>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Typography fontSize="0.8rem" color="#64748b">Severity: <strong>{differential_diagnosis.clinical_reasoning.semantic_qualifiers.severity}</strong></Typography>
                  </Grid>
                </Grid>
                <Typography fontSize="0.8rem" color="#64748b" mt={1}>
                  {differential_diagnosis.clinical_reasoning.semantic_qualifiers.acuity_reasoning}
                </Typography>
              </Box>
            )}

            {/* Reasoning Chain */}
            {differential_diagnosis.clinical_reasoning?.reasoning_chain && (
              <Box mb={2}>
                <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b" mb={1}>
                  Reasoning Chain:
                </Typography>
                {differential_diagnosis.clinical_reasoning.reasoning_chain.map((step, idx) => (
                  <Card key={idx} variant="outlined" sx={{ mb: 1, p: 1.5 }}>
                    <Typography fontSize="0.8rem" fontWeight={600} color="#1e293b">
                      Step {step.step}: {step.observation}
                    </Typography>
                    <Typography fontSize="0.75rem" color="#64748b" mt={0.5}>
                      Interpretation: {step.interpretation}
                    </Typography>
                    <Typography fontSize="0.75rem" color="#0ea5e9" mt={0.5}>
                      Hypothesis: {step.hypothesis}
                    </Typography>
                    <Typography fontSize="0.75rem" color="#64748b" mt={0.5}>
                      Confidence: {Math.round(step.confidence * 100)}%
                    </Typography>
                  </Card>
                ))}
              </Box>
            )}
          </Card>

          {/* Most Likely Diagnoses */}
          {differential_diagnosis.most_likely_diagnoses?.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={2}>
                Most Likely Diagnoses
              </Typography>
              <Grid container spacing={2}>
                {differential_diagnosis.most_likely_diagnoses.map((dx, idx) => (
                  <Grid item xs={12} key={idx}>
                    <Card variant="outlined" sx={{ p: 2 }}>
                      <Stack direction="row" spacing={1} mb={1} flexWrap="wrap" alignItems="center">
                        <Typography fontSize="1rem" fontWeight={700} color="#1e293b">
                          {idx + 1}. {dx.diagnosis}
                        </Typography>
                        <Chip size="small" label={`${dx.probability}% probability`} />
                        <RiskChip level={dx.confidence} />
                      </Stack>

                      <Typography fontSize="0.85rem" color="#64748b" mb={1}>
                        {dx.diagnostic_criteria_met}
                      </Typography>

                      {/* Bayesian Reasoning */}
                      {dx.bayesian_reasoning && (
                        <Card variant="outlined" sx={{ p: 1.5, mb: 2, backgroundColor: "#f8fafc" }}>
                          <Typography fontSize="0.8rem" fontWeight={600} color="#0ea5e9" mb={1}>
                            Bayesian Reasoning
                          </Typography>
                          <Grid container spacing={2}>
                            <Grid item xs={12} md={4}>
                              <Typography fontSize="0.75rem" color="#64748b">
                                Pre-test: {dx.bayesian_reasoning.pre_test_probability}%
                              </Typography>
                              <Typography fontSize="0.75rem" color="#64748b">
                                Post-test: {dx.bayesian_reasoning.post_test_probability}%
                              </Typography>
                            </Grid>
                            <Grid item xs={12} md={8}>
                              <Typography fontSize="0.75rem" color="#64748b">
                                {dx.bayesian_reasoning.pre_test_reasoning}
                              </Typography>
                            </Grid>
                          </Grid>
                        </Card>
                      )}

                      <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                          <Typography fontSize="0.75rem" fontWeight={600} color="#166534" mb={0.5}>
                            Supporting Evidence:
                          </Typography>
                          {dx.supporting_evidence?.slice(0, 3).map((e, i) => (
                            <Typography key={i} fontSize="0.75rem" color="#0f172a">
                              ✓ {e}
                            </Typography>
                          ))}
                          {dx.supporting_evidence?.length > 3 && (
                            <Typography fontSize="0.75rem" color="#64748b" fontStyle="italic">
                              + {dx.supporting_evidence.length - 3} more
                            </Typography>
                          )}
                        </Grid>
                        <Grid item xs={12} md={6}>
                          <Typography fontSize="0.75rem" fontWeight={600} color="#dc2626" mb={0.5}>
                            Contradicting Evidence:
                          </Typography>
                          {dx.contradicting_evidence?.slice(0, 3).map((e, i) => (
                            <Typography key={i} fontSize="0.75rem" color="#64748b">
                              ✗ {e}
                            </Typography>
                          ))}
                          {dx.contradicting_evidence?.length > 3 && (
                            <Typography fontSize="0.75rem" color="#64748b" fontStyle="italic">
                              + {dx.contradicting_evidence.length - 3} more
                            </Typography>
                          )}
                        </Grid>
                      </Grid>

                      {dx.next_steps_to_confirm && dx.next_steps_to_confirm.length > 0 && (
                        <Box mt={2}>
                          <Typography fontSize="0.75rem" fontWeight={600} color="#0ea5e9" mb={0.5}>
                            Next Steps to Confirm:
                          </Typography>
                          {dx.next_steps_to_confirm.map((step, i) => (
                            <Typography key={i} fontSize="0.75rem" color="#1e293b">
                              • {step}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Unlikely but Considered */}
          {differential_diagnosis.unlikely_but_considered?.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Unlikely but Considered
              </Typography>
              <Grid container spacing={1}>
                {differential_diagnosis.unlikely_but_considered.map((dx, idx) => (
                  <Grid item xs={12} sm={6} key={idx}>
                    <Card variant="outlined" sx={{ p: 1.5 }}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                        {dx.diagnosis} ({dx.probability}% probability)
                      </Typography>
                      <Typography fontSize="0.75rem" color="#64748b" mt={0.5}>
                        {dx.why_unlikely}
                      </Typography>
                      <Typography fontSize="0.75rem" color="#0ea5e9" mt={0.5}>
                        Would be more likely if: {dx.what_would_make_more_likely}
                      </Typography>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Diagnostic Strategy */}
          {differential_diagnosis.diagnostic_strategy && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Diagnostic Strategy
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626" mb={1}>
                      Urgent Investigations
                    </Typography>
                    {differential_diagnosis.diagnostic_strategy.urgent_investigations?.map((item, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {item}
                      </Typography>
                    ))}
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#0ea5e9" mb={1}>
                      Can Wait for Outpatient
                    </Typography>
                    {differential_diagnosis.diagnostic_strategy.can_wait_for_outpatient?.map((item, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {item}
                      </Typography>
                    ))}
                  </Card>
                </Grid>
              </Grid>

              {/* Recommended Investigation Sequence */}
              {differential_diagnosis.diagnostic_strategy.recommended_investigation_sequence && (
                <Box mt={2}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b" mb={1}>
                    Recommended Investigation Sequence
                  </Typography>
                  {differential_diagnosis.diagnostic_strategy.recommended_investigation_sequence.map((step, idx) => (
                    <Card key={idx} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                      <Typography fontSize="0.8rem" fontWeight={600} color="#1e293b">
                        Step {step.step}: {step.test_or_action}
                      </Typography>
                      <Typography fontSize="0.75rem" color="#64748b" mt={0.5}>
                        Rationale: {step.rationale}
                      </Typography>
                      <Typography fontSize="0.75rem" color="#0ea5e9" mt={0.5}>
                        Expected Impact: {step.expected_impact_on_differential}
                      </Typography>
                    </Card>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* Additional Information */}
          <Grid container spacing={2}>
            {differential_diagnosis.diagnostic_uncertainty_factors && differential_diagnosis.diagnostic_uncertainty_factors.length > 0 && (
              <Grid item xs={12} md={6}>
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#f59e0b" mb={1}>
                    Diagnostic Uncertainty Factors
                  </Typography>
                  {differential_diagnosis.diagnostic_uncertainty_factors.map((factor, idx) => (
                    <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                      • {factor}
                    </Typography>
                  ))}
                </Card>
              </Grid>
            )}

            {differential_diagnosis.red_flags_for_reconsidering && differential_diagnosis.red_flags_for_reconsidering.length > 0 && (
              <Grid item xs={12} md={6}>
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626" mb={1}>
                    Red Flags for Reconsidering
                  </Typography>
                  {differential_diagnosis.red_flags_for_reconsidering.map((flag, idx) => (
                    <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                      • {flag}
                    </Typography>
                  ))}
                </Card>
              </Grid>
            )}

            {differential_diagnosis.cognitive_biases_avoided && differential_diagnosis.cognitive_biases_avoided.length > 0 && (
              <Grid item xs={12} md={6}>
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Typography fontSize="0.85rem" fontWeight={600} color="#10b981" mb={1}>
                    Cognitive Biases Avoided
                  </Typography>
                  {differential_diagnosis.cognitive_biases_avoided.map((bias, idx) => (
                    <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                      • {bias}
                    </Typography>
                  ))}
                </Card>
              </Grid>
            )}
          </Grid>

          {/* Confidence Meter */}
          <Box mt={2}>
            <ConfidenceMeter score={differential_diagnosis.overall_diagnostic_confidence} />
            <Typography fontSize="0.75rem" color="#64748b" mt={1} textAlign="center">
              {differential_diagnosis.confidence_reasoning}
            </Typography>
          </Box>
        </ExpandableSection>
      )}

      {/* ==================== MEDICATION RECONCILIATION ==================== */}
      {medication_reconciliation && (
        <ExpandableSection
          title="💊 Medication Safety"
          urgent={medication_reconciliation.safety_alerts?.some((a) => a.severity === "Critical")}
        >
          {/* Safety Alerts */}
          {medication_reconciliation.safety_alerts?.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>Medication Safety Alerts ({medication_reconciliation.safety_alerts.length})</AlertTitle>
              {medication_reconciliation.safety_alerts.map((alert, idx) => (
                <Typography key={idx} fontSize="0.85rem" mb={0.5}>
                  • [{alert.severity}] {alert.description} - {alert.immediate_action_required} ({alert.timeframe})
                </Typography>
              ))}
            </Alert>
          )}

          {/* Stats Cards */}
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                <Typography fontSize="0.7rem" color="#64748b" fontWeight={600}>
                  TOTAL MEDICATIONS
                </Typography>
                <Typography fontSize="2rem" fontWeight={800} color="#0ea5e9">
                  {medication_reconciliation.reconciled_medication_list?.length || 0}
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                <Typography fontSize="0.7rem" color="#64748b" fontWeight={600}>
                  INTERACTIONS
                </Typography>
                <Typography fontSize="2rem" fontWeight={800} color="#dc2626">
                  {medication_reconciliation.drug_drug_interactions?.length || 0}
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                <Typography fontSize="0.7rem" color="#64748b" fontWeight={600}>
                  HIGH-RISK MEDS
                </Typography>
                <Typography fontSize="2rem" fontWeight={800} color="#f59e0b">
                  {medication_reconciliation.high_risk_medications_alert?.length || 0}
                </Typography>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                <Typography fontSize="0.7rem" color="#64748b" fontWeight={600}>
                  SAFETY SCORE
                </Typography>
                <Typography fontSize="2rem" fontWeight={800} color="#10b981">
                  {Math.round((medication_reconciliation.confidence_score || 0) * 100)}%
                </Typography>
              </Card>
            </Grid>
          </Grid>

          {/* Medication List */}
          {medication_reconciliation.reconciled_medication_list && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Reconciled Medication List ({medication_reconciliation.reconciled_medication_list.length})
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "#f8fafc" }}>
                      <TableCell sx={{ fontWeight: 600 }}>Medication</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Dose</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Route/Frequency</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Indication</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Source</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {medication_reconciliation.reconciled_medication_list.map((med, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Typography fontSize="0.85rem" fontWeight={600}>
                            {med.medication_name}
                          </Typography>
                        </TableCell>
                        <TableCell>{med.dose}</TableCell>
                        <TableCell>
                          {med.route} {med.frequency}
                        </TableCell>
                        <TableCell>{med.indication}</TableCell>
                        <TableCell>{med.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {/* Drug Interactions */}
          {medication_reconciliation.drug_drug_interactions && medication_reconciliation.drug_drug_interactions.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#dc2626" mb={1}>
                Drug Interactions ({medication_reconciliation.drug_drug_interactions.length})
              </Typography>
              {medication_reconciliation.drug_drug_interactions.map((interaction, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1, borderLeft: "4px solid #dc2626" }}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                    {interaction.interacting_medications?.join(" + ")}
                  </Typography>
                  <Grid container spacing={2} mt={1}>
                    <Grid item xs={12} md={6}>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Type: {interaction.interaction_type}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Mechanism: {interaction.mechanism}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#dc2626">
                        Severity: {interaction.severity}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography fontSize="0.8rem" color="#1e293b">
                        Consequence: {interaction.clinical_consequence}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#0ea5e9">
                        Management: {interaction.management_strategy}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Monitoring: {interaction.monitoring_required}
                      </Typography>
                    </Grid>
                  </Grid>
                </Card>
              ))}
            </Box>
          )}

          {/* Medication Induced Symptoms */}
          {medication_reconciliation.medication_induced_symptoms && medication_reconciliation.medication_induced_symptoms.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#f59e0b" mb={1}>
                Medication Induced Symptoms
              </Typography>
              {medication_reconciliation.medication_induced_symptoms.map((symptom, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                    {symptom.symptom} (Likelihood: {symptom.likelihood})
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Potentially Causative: {symptom.potentially_causative_medication}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b">
                    Naranjo Score: {symptom.naranjo_score}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#0ea5e9" mt={0.5}>
                    Recommendation: {symptom.recommendation}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}

          {/* Polypharmacy Assessment */}
          {medication_reconciliation.polypharmacy_assessment && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Polypharmacy Assessment
              </Typography>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                      Total Medications: {medication_reconciliation.polypharmacy_assessment.total_medication_count}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                      Level: {medication_reconciliation.polypharmacy_assessment.polypharmacy_level}
                    </Typography>
                  </Grid>
                </Grid>
                
                {medication_reconciliation.polypharmacy_assessment.deprescribing_opportunities && 
                 medication_reconciliation.polypharmacy_assessment.deprescribing_opportunities.length > 0 && (
                  <Box mt={2}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#10b981">
                      Deprescribing Opportunities
                    </Typography>
                    {medication_reconciliation.polypharmacy_assessment.deprescribing_opportunities.map((opp, idx) => (
                      <Card key={idx} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
                        <Typography fontSize="0.8rem" fontWeight={600} color="#1e293b">
                          {opp.medication}
                        </Typography>
                        <Typography fontSize="0.75rem" color="#64748b">
                          Reason: {opp.reason_for_deprescribing}
                        </Typography>
                        <Typography fontSize="0.75rem" color="#0ea5e9">
                          Strategy: {opp.deprescribing_strategy}
                        </Typography>
                      </Card>
                    ))}
                  </Box>
                )}
              </Card>
            </Box>
          )}

          {/* Transition of Care Plan */}
          {medication_reconciliation.transition_of_care_plan && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Transition of Care Plan
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#10b981" mb={1}>
                      Continue ({medication_reconciliation.transition_of_care_plan.medications_to_continue?.length || 0})
                    </Typography>
                    {medication_reconciliation.transition_of_care_plan.medications_to_continue?.map((med, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {med.medication}
                      </Typography>
                    ))}
                  </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#0ea5e9" mb={1}>
                      Start ({medication_reconciliation.transition_of_care_plan.medications_to_start?.length || 0})
                    </Typography>
                    {medication_reconciliation.transition_of_care_plan.medications_to_start?.map((med, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {med.medication} - {med.indication}
                      </Typography>
                    ))}
                  </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626" mb={1}>
                      Stop ({medication_reconciliation.transition_of_care_plan.medications_to_stop?.length || 0})
                    </Typography>
                    {medication_reconciliation.transition_of_care_plan.medications_to_stop?.map((med, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {med.medication} - {med.reason_for_stopping}
                      </Typography>
                    ))}
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Recommendations */}
          {medication_reconciliation.recommendations_summary && medication_reconciliation.recommendations_summary.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <AlertTitle>Medication Recommendations</AlertTitle>
              {medication_reconciliation.recommendations_summary.map((rec, idx) => (
                <Typography key={idx} fontSize="0.85rem">
                  • {rec}
                </Typography>
              ))}
            </Alert>
          )}

          {/* Footer */}
          <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
            <Typography fontSize="0.8rem" color="#64748b">
              Requires Pharmacist Review: {medication_reconciliation.requires_pharmacist_review ? "Yes" : "No"}
            </Typography>
            <Typography fontSize="0.8rem" color="#64748b">
              Requires Prescriber Contact: {medication_reconciliation.requires_prescriber_contact ? "Yes" : "No"}
            </Typography>
          </Box>
        </ExpandableSection>
      )}

      {/* ==================== RISK STRATIFICATION ==================== */}
      {risk_stratification && (
        <ExpandableSection
          title="⚠️ Risk Assessment"
          urgent={risk_stratification.requires_immediate_action}
        >
          {/* Overall Risk */}
          <Card variant="outlined" sx={{ p: 2, backgroundColor: "#fef2f2", mb: 2 }}>
            <Typography fontSize="1.2rem" fontWeight={800} color="#991b1b" mb={1}>
              {risk_stratification.overall_risk_level?.toUpperCase()} RISK
            </Typography>
            <Typography fontSize="0.9rem" color="#7f1d1d">
              {risk_stratification.clinical_reasoning?.overall_assessment}
            </Typography>
          </Card>

          {/* Clinical Reasoning */}
          {risk_stratification.clinical_reasoning && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Clinical Reasoning
              </Typography>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography fontSize="0.9rem" color="#64748b" mb={1}>
                  {risk_stratification.clinical_reasoning.overall_assessment}
                </Typography>
                {risk_stratification.clinical_reasoning.key_risk_factors && (
                  <Box mt={1}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626">
                      Key Risk Factors:
                    </Typography>
                    {risk_stratification.clinical_reasoning.key_risk_factors.map((factor, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {factor}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Card>
            </Box>
          )}

          {/* Risk Scores */}
          {risk_stratification.validated_risk_scores && (
            <Grid container spacing={2} mb={3}>
              {risk_stratification.validated_risk_scores.NEWS2 && (
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography fontSize="0.8rem" color="#64748b" fontWeight={600} mb={0.5}>
                      NEWS2 SCORE
                    </Typography>
                    <Typography fontSize="2.5rem" fontWeight={800} color="#dc2626">
                      {risk_stratification.validated_risk_scores.NEWS2.total_score}
                    </Typography>
                    <RiskChip level={risk_stratification.validated_risk_scores.NEWS2.risk_level} />
                    <Typography fontSize="0.8rem" color="#64748b" mt={1}>
                      {risk_stratification.validated_risk_scores.NEWS2.interpretation}
                    </Typography>
                    <Typography fontSize="0.7rem" color="#64748b" mt={0.5}>
                      Monitoring Frequency: {risk_stratification.validated_risk_scores.NEWS2.monitoring_frequency}
                    </Typography>
                  </Card>
                </Grid>
              )}

              {risk_stratification.validated_risk_scores.qSOFA && (
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography fontSize="0.8rem" color="#64748b" fontWeight={600} mb={0.5}>
                      qSOFA SCORE
                    </Typography>
                    <Typography fontSize="2.5rem" fontWeight={800} color="#dc2626">
                      {risk_stratification.validated_risk_scores.qSOFA.total_score}
                    </Typography>
                    <RiskChip level={risk_stratification.validated_risk_scores.qSOFA.risk_level} />
                    <Typography fontSize="0.8rem" color="#64748b" mt={1}>
                      {risk_stratification.validated_risk_scores.qSOFA.interpretation}
                    </Typography>
                  </Card>
                </Grid>
              )}
            </Grid>
          )}

          {/* Mortality Risk */}
          {risk_stratification.mortality_risk && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Mortality Risk Assessment
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626" mb={1}>
                      Short-term (In-hospital)
                    </Typography>
                    <Typography fontSize="0.8rem" color="#1e293b">
                      Level: {risk_stratification.mortality_risk.short_term?.level}
                    </Typography>
                    <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                      {risk_stratification.mortality_risk.short_term?.reasoning}
                    </Typography>
                    <Typography fontSize="0.8rem" color="#dc2626" mt={0.5}>
                      Estimated: {risk_stratification.mortality_risk.short_term?.estimated_percentage}
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#991b1b" mb={1}>
                      Long-term (1-year)
                    </Typography>
                    <Typography fontSize="0.8rem" color="#1e293b">
                      Level: {risk_stratification.mortality_risk.long_term?.level}
                    </Typography>
                    <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                      {risk_stratification.mortality_risk.long_term?.reasoning}
                    </Typography>
                    <Typography fontSize="0.8rem" color="#dc2626" mt={0.5}>
                      Estimated: {risk_stratification.mortality_risk.long_term?.estimated_percentage}
                    </Typography>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Morbidity Risk */}
          {risk_stratification.morbidity_risk && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Morbidity Risk Assessment
              </Typography>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography fontSize="0.8rem" color="#1e293b">
                  Complication Probability: {risk_stratification.morbidity_risk.complication_probability}
                </Typography>
                <Typography fontSize="0.8rem" color="#1e293b">
                  Severity if Occurs: {risk_stratification.morbidity_risk.severity_if_occurs}
                </Typography>
                
                {risk_stratification.morbidity_risk.specific_complications && 
                 risk_stratification.morbidity_risk.specific_complications.length > 0 && (
                  <Box mt={2}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#dc2626">
                      Specific Complications:
                    </Typography>
                    {risk_stratification.morbidity_risk.specific_complications.map((comp, idx) => (
                      <Card key={idx} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
                        <Typography fontSize="0.8rem" fontWeight={600} color="#1e293b">
                          {comp.complication} ({comp.probability})
                        </Typography>
                        <Typography fontSize="0.75rem" color="#64748b">
                          Impact: {comp.clinical_impact}
                        </Typography>
                        <Typography fontSize="0.75rem" color="#0ea5e9">
                          Prevention: {comp.prevention_strategy}
                        </Typography>
                      </Card>
                    ))}
                  </Box>
                )}
              </Card>
            </Box>
          )}

          {/* Time Sensitive Risks */}
          {risk_stratification.time_sensitive_risks && risk_stratification.time_sensitive_risks.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#f59e0b" mb={1}>
                Time Sensitive Risks ({risk_stratification.time_sensitive_risks.length})
              </Typography>
              {risk_stratification.time_sensitive_risks.map((risk, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1, borderLeft: "4px solid #f59e0b" }}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                    {risk.risk}
                  </Typography>
                  <Grid container spacing={2} mt={1}>
                    <Grid item xs={12} md={4}>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Urgency: {risk.urgency}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Timeframe: {risk.timeframe}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={8}>
                      <Typography fontSize="0.8rem" color="#0ea5e9">
                        Mitigation: {risk.mitigation}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Monitoring: {risk.monitoring_required}
                      </Typography>
                    </Grid>
                  </Grid>
                </Card>
              ))}
            </Box>
          )}

          {/* Risk Mitigation Priorities */}
          {risk_stratification.risk_mitigation_priorities && risk_stratification.risk_mitigation_priorities.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#10b981" mb={1}>
                Risk Mitigation Priorities
              </Typography>
              {risk_stratification.risk_mitigation_priorities.map((priority, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                    Priority #{priority.priority}: {priority.risk}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Intervention: {priority.intervention}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#0ea5e9" mt={0.5}>
                    Expected Benefit: {priority.expected_benefit}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Feasibility: {priority.feasibility} | Rationale: {priority.rationale}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}

          {/* Immediate Action Items */}
          {risk_stratification.requires_immediate_action && risk_stratification.immediate_action_items && 
           risk_stratification.immediate_action_items.length > 0 && (
            <Alert severity="error" sx={{ mt: 2 }}>
              <AlertTitle>Immediate Actions Required</AlertTitle>
              {risk_stratification.immediate_action_items.map((action, idx) => (
                <Typography key={idx} fontSize="0.85rem">
                  • {action}
                </Typography>
              ))}
            </Alert>
          )}

          {/* Confidence */}
          <Box mt={2}>
            <ConfidenceMeter score={risk_stratification.confidence_score} />
            <Typography fontSize="0.75rem" color="#64748b" mt={1} textAlign="center">
              {risk_stratification.confidence_rationale}
            </Typography>
          </Box>
        </ExpandableSection>
      )}

      {/* ==================== TREATMENT VALIDATION ==================== */}
      {treatment_validation && (
        <ExpandableSection title="💉 Treatment Plan">
          {/* Clinical Reasoning */}
          {treatment_validation.clinical_reasoning && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Clinical Reasoning
              </Typography>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography fontSize="0.9rem" color="#64748b" mb={2}>
                  {treatment_validation.clinical_reasoning.treatment_rationale}
                </Typography>
                
                {/* Key Decision Points */}
                {treatment_validation.clinical_reasoning.key_decision_points && 
                 treatment_validation.clinical_reasoning.key_decision_points.length > 0 && (
                  <Box mt={2}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#0ea5e9">
                      Key Decision Points:
                    </Typography>
                    {treatment_validation.clinical_reasoning.key_decision_points.map((point, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {point}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Card>
            </Box>
          )}

          {/* Guideline Basis */}
          {treatment_validation.clinical_reasoning?.guideline_basis && 
           treatment_validation.clinical_reasoning.guideline_basis.length > 0 && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Guideline Basis
              </Typography>
              {treatment_validation.clinical_reasoning.guideline_basis.map((guideline, idx) => (
                <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                    {guideline.guideline}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    {guideline.recommendation}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#0ea5e9" mt={0.5}>
                    Strength: {guideline.strength_of_recommendation}
                  </Typography>
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Applicability: {guideline.applicability_to_patient}
                  </Typography>
                </Card>
              ))}
            </Box>
          )}

          {/* Recommended Treatment Plan */}
          {treatment_validation.recommended_treatment_plan && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Recommended Treatment Plan
              </Typography>
              
              {/* Immediate Interventions */}
              {treatment_validation.recommended_treatment_plan.immediate_interventions && 
               treatment_validation.recommended_treatment_plan.immediate_interventions.length > 0 && (
                <Box mb={3}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#dc2626" mb={1}>
                    Immediate Interventions ({treatment_validation.recommended_treatment_plan.immediate_interventions.length})
                  </Typography>
                  <Grid container spacing={2}>
                    {treatment_validation.recommended_treatment_plan.immediate_interventions.map((intervention, idx) => (
                      <Grid item xs={12} key={idx}>
                        <Card variant="outlined" sx={{ p: 2 }}>
                          <Typography fontSize="0.95rem" fontWeight={700} color="#1e293b" mb={1}>
                            {intervention.intervention}
                          </Typography>
                          <Typography fontSize="0.85rem" color="#64748b" mb={1}>
                            {intervention.rationale}
                          </Typography>
                          <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}>
                              <Typography fontSize="0.75rem" color="#64748b" fontWeight={600}>
                                Dose & Route:
                              </Typography>
                              <Typography fontSize="0.85rem">{intervention.dose_and_route}</Typography>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                              <Typography fontSize="0.75rem" color="#64748b" fontWeight={600}>
                                Expected Benefit:
                              </Typography>
                              <Typography fontSize="0.85rem">{intervention.expected_benefit}</Typography>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                              <Typography fontSize="0.75rem" color="#64748b" fontWeight={600}>
                                Duration:
                              </Typography>
                              <Typography fontSize="0.85rem">{intervention.duration}</Typography>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                              <Typography fontSize="0.75rem" color="#64748b" fontWeight={600}>
                                Monitoring Required:
                              </Typography>
                              <Typography fontSize="0.85rem">{intervention.monitoring_required}</Typography>
                            </Grid>
                          </Grid>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )}

              {/* Ongoing Management */}
              {treatment_validation.recommended_treatment_plan.ongoing_management && 
               treatment_validation.recommended_treatment_plan.ongoing_management.length > 0 && (
                <Box mb={3}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#0ea5e9" mb={1}>
                    Ongoing Management ({treatment_validation.recommended_treatment_plan.ongoing_management.length})
                  </Typography>
                  {treatment_validation.recommended_treatment_plan.ongoing_management.map((therapy, idx) => (
                    <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                      <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                        {therapy.therapy}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                        Indication: {therapy.indication}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Regimen: {therapy.regimen}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#0ea5e9" mt={0.5}>
                        Goal: {therapy.goal}
                      </Typography>
                    </Card>
                  ))}
                </Box>
              )}

              {/* Medications to Discontinue */}
              {treatment_validation.recommended_treatment_plan.medications_to_discontinue && 
               treatment_validation.recommended_treatment_plan.medications_to_discontinue.length > 0 && (
                <Box mb={3}>
                  <Typography fontSize="0.9rem" fontWeight={600} color="#f59e0b" mb={1}>
                    Medications to Discontinue ({treatment_validation.recommended_treatment_plan.medications_to_discontinue.length})
                  </Typography>
                  {treatment_validation.recommended_treatment_plan.medications_to_discontinue.map((med, idx) => (
                    <Card key={idx} variant="outlined" sx={{ p: 2, mb: 1 }}>
                      <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                        {med.medication}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#64748b">
                        Reason: {med.reason_for_discontinuation}
                      </Typography>
                      <Typography fontSize="0.8rem" color="#dc2626">
                        Tapering Required: {med.tapering_required ? "Yes" : "No"}
                      </Typography>
                    </Card>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* Monitoring Plan */}
          {treatment_validation.monitoring_plan && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Monitoring Plan
              </Typography>
              <Grid container spacing={2}>
                {/* Laboratory Monitoring */}
                {treatment_validation.monitoring_plan.laboratory_monitoring && 
                 treatment_validation.monitoring_plan.laboratory_monitoring.length > 0 && (
                  <Grid item xs={12} md={6}>
                    <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#0ea5e9" mb={1}>
                        Laboratory Monitoring
                      </Typography>
                      {treatment_validation.monitoring_plan.laboratory_monitoring.map((monitor, idx) => (
                        <Box key={idx} mb={1}>
                          <Typography fontSize="0.8rem" fontWeight={600} color="#1e293b">
                            {monitor.parameter}
                          </Typography>
                          <Typography fontSize="0.75rem" color="#64748b">
                            Frequency: {monitor.frequency} | Target: {monitor.target_range}
                          </Typography>
                        </Box>
                      ))}
                    </Card>
                  </Grid>
                )}

                {/* Response Assessment */}
                {treatment_validation.monitoring_plan.response_assessment && (
                  <Grid item xs={12} md={6}>
                    <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#10b981" mb={1}>
                        Response Assessment
                      </Typography>
                      <Typography fontSize="0.8rem" color="#1e293b">
                        Timeframe: {treatment_validation.monitoring_plan.response_assessment.timeframe}
                      </Typography>
                      <Typography fontSize="0.75rem" color="#64748b" mt={0.5}>
                        Success: {treatment_validation.monitoring_plan.response_assessment.success_criteria}
                      </Typography>
                      <Typography fontSize="0.75rem" color="#64748b">
                        Failure: {treatment_validation.monitoring_plan.response_assessment.failure_criteria}
                      </Typography>
                    </Card>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {/* Safety Warnings */}
          {treatment_validation.safety_warnings && treatment_validation.safety_warnings.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>Safety Warnings</AlertTitle>
              {treatment_validation.safety_warnings.map((warning, idx) => (
                <Typography key={idx} fontSize="0.85rem">
                  • {warning.concern} (Likelihood: {warning.likelihood}, Severity: {warning.severity_if_occurs})
                </Typography>
              ))}
            </Alert>
          )}

          {/* Confidence */}
          <Box mt={2}>
            <ConfidenceMeter score={treatment_validation.confidence_score} />
            <Typography fontSize="0.75rem" color="#64748b" mt={1} textAlign="center">
              {treatment_validation.confidence_rationale}
            </Typography>
            <Typography fontSize="0.75rem" color="#64748b" mt={0.5} textAlign="center">
              Specialist Input Required: {treatment_validation.requires_specialist_input ? "Yes" : "No"}
              {treatment_validation.recommended_specialist && ` | Recommended: ${treatment_validation.recommended_specialist}`}
            </Typography>
          </Box>
        </ExpandableSection>
      )}

      {/* ==================== DISCHARGE READINESS ==================== */}
      {discharge_readiness && (
        <ExpandableSection
          title="🏠 Discharge Planning"
          urgent={!discharge_readiness.safe_to_discharge}
        >
          {/* Overall Status */}
          <Card
            variant="outlined"
            sx={{
              p: 3,
              backgroundColor: discharge_readiness.safe_to_discharge ? "#f0fdf4" : "#fef2f2",
              textAlign: "center",
              mb: 2,
            }}
          >
            <Chip
              label={
                discharge_readiness.safe_to_discharge
                  ? "✓ READY FOR DISCHARGE"
                  : "✗ NOT READY FOR DISCHARGE"
              }
              sx={{
                fontSize: "1rem",
                fontWeight: 800,
                p: 2,
                backgroundColor: discharge_readiness.safe_to_discharge ? "#dcfce7" : "#fee2e2",
                color: discharge_readiness.safe_to_discharge ? "#166534" : "#991b1b",
              }}
            />
            <Typography fontSize="0.9rem" color="#64748b" mt={2}>
              Overall Discharge Readiness: {discharge_readiness.overall_discharge_readiness}
            </Typography>
          </Card>

          {/* Readiness Assessment */}
          {discharge_readiness.readiness_assessment && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Readiness Assessment
              </Typography>
              <Grid container spacing={2}>
                {Object.entries(discharge_readiness.readiness_assessment).map(([key, assessment]) => (
                  <Grid item xs={12} sm={6} md={4} key={key}>
                    <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b" textTransform="capitalize">
                        {key.replace(/_/g, ' ')}
                      </Typography>
                      <Chip
                        size="small"
                        label={assessment.ready_for_discharge ? "READY" : "NOT READY"}
                        sx={{
                          mt: 1,
                          backgroundColor: assessment.ready_for_discharge ? "#dcfce7" : "#fee2e2",
                          color: assessment.ready_for_discharge ? "#166534" : "#991b1b",
                        }}
                      />
                      {assessment.concerns && assessment.concerns.length > 0 && (
                        <Typography fontSize="0.75rem" color="#dc2626" mt={1}>
                          Concerns: {assessment.concerns.join(", ")}
                        </Typography>
                      )}
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Readmission Risk */}
          {discharge_readiness.readmission_risk_assessment && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Readmission Risk Assessment
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                    <Typography fontSize="0.7rem" color="#64748b" fontWeight={600}>
                      30-DAY READMISSION RISK
                    </Typography>
                    <Typography fontSize="2rem" fontWeight={800} color="#dc2626">
                      {discharge_readiness.estimated_readmission_risk || "MODERATE"}
                    </Typography>
                    <RiskChip level={discharge_readiness.estimated_readmission_risk?.toLowerCase()} />
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                    <Typography fontSize="0.7rem" color="#64748b" fontWeight={600}>
                      READINESS SCORE
                    </Typography>
                    <Typography fontSize="2rem" fontWeight={800} color="#10b981">
                      {Math.round((discharge_readiness.confidence_score || 0) * 100)}%
                    </Typography>
                  </Card>
                </Grid>
              </Grid>

              {/* Risk Scores */}
              <Grid container spacing={2} mt={1}>
                {discharge_readiness.readmission_risk_assessment.lace_index && (
                  <Grid item xs={12} md={6}>
                    <Card variant="outlined" sx={{ p: 2 }}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                        LACE Index
                      </Typography>
                      <Typography fontSize="1.5rem" fontWeight={800} color="#dc2626">
                        Score: {discharge_readiness.readmission_risk_assessment.lace_index.total_score}
                      </Typography>
                      <RiskChip level={discharge_readiness.readmission_risk_assessment.lace_index.risk_level} />
                      <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                        {discharge_readiness.readmission_risk_assessment.lace_index.interpretation}
                      </Typography>
                    </Card>
                  </Grid>
                )}

                {discharge_readiness.readmission_risk_assessment.hospital_score && (
                  <Grid item xs={12} md={6}>
                    <Card variant="outlined" sx={{ p: 2 }}>
                      <Typography fontSize="0.85rem" fontWeight={600} color="#1e293b">
                        Hospital Score
                      </Typography>
                      <Typography fontSize="1.5rem" fontWeight={800} color="#dc2626">
                        Score: {discharge_readiness.readmission_risk_assessment.hospital_score.total_score}
                      </Typography>
                      <RiskChip level={discharge_readiness.readmission_risk_assessment.hospital_score.risk_level} />
                      <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                        {discharge_readiness.readmission_risk_assessment.hospital_score.interpretation}
                      </Typography>
                    </Card>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {/* Barriers to Discharge */}
          {discharge_readiness.barriers_to_discharge?.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2, mb: 2 }}>
              <AlertTitle>Barriers to Discharge ({discharge_readiness.barriers_to_discharge.length})</AlertTitle>
              {discharge_readiness.barriers_to_discharge.map((barrier, idx) => (
                <Typography key={idx} fontSize="0.85rem" mb={0.5}>
                  • [{barrier.category}] {barrier.barrier} - {barrier.severity} ({barrier.resolution_strategy})
                </Typography>
              ))}
            </Alert>
          )}

          {/* Discharge Plan */}
          {discharge_readiness.discharge_plan && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Discharge Plan
              </Typography>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                  Destination: {discharge_readiness.discharge_plan.discharge_destination}
                </Typography>
                <Typography fontSize="0.9rem" color="#64748b">
                  Recommended Date: {discharge_readiness.discharge_plan.recommended_discharge_date}
                </Typography>

                {/* Medications */}
                {discharge_readiness.discharge_plan.medication_plan && (
                  <Box mt={2}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#0ea5e9">
                      Medication Plan
                    </Typography>
                    {discharge_readiness.discharge_plan.medication_plan.discharge_medications?.map((med, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {med.medication} ({med.new_or_continued}) - {med.indication}
                      </Typography>
                    ))}
                  </Box>
                )}

                {/* Follow-up */}
                {discharge_readiness.discharge_plan.follow_up_plan && (
                  <Box mt={2}>
                    <Typography fontSize="0.85rem" fontWeight={600} color="#10b981">
                      Follow-up Plan
                    </Typography>
                    {discharge_readiness.discharge_plan.follow_up_plan.appointments?.map((appt, idx) => (
                      <Typography key={idx} fontSize="0.8rem" color="#1e293b">
                        • {appt.provider} in {appt.timeframe} - {appt.reason}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Card>
            </Box>
          )}

          {/* Transition of Care Summary */}
          {discharge_readiness.transition_of_care_summary && (
            <Box mb={3}>
              <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={1}>
                Transition of Care Summary
              </Typography>
              <Card variant="outlined" sx={{ p: 2 }}>
                <Typography fontSize="0.9rem" fontWeight={600} color="#1e293b">
                  Primary Diagnosis: {discharge_readiness.transition_of_care_summary.primary_diagnosis}
                </Typography>
                {discharge_readiness.transition_of_care_summary.secondary_diagnoses && 
                 discharge_readiness.transition_of_care_summary.secondary_diagnoses.length > 0 && (
                  <Typography fontSize="0.8rem" color="#64748b" mt={0.5}>
                    Secondary: {discharge_readiness.transition_of_care_summary.secondary_diagnoses.join(", ")}
                  </Typography>
                )}
                <Typography fontSize="0.8rem" color="#64748b" mt={1}>
                  {discharge_readiness.transition_of_care_summary.hospital_course_summary}
                </Typography>
              </Card>
            </Box>
          )}

          {/* Red Flags */}
          {discharge_readiness.red_flags_for_readmission?.length > 0 && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <AlertTitle>Red Flags for Readmission</AlertTitle>
              {discharge_readiness.red_flags_for_readmission.map((flag, idx) => (
                <Typography key={idx} fontSize="0.85rem">
                  • {flag.warning_sign} - {flag.significance} ({flag.action})
                </Typography>
              ))}
            </Alert>
          )}

          {/* Confidence */}
          <Box mt={2}>
            <ConfidenceMeter score={discharge_readiness.confidence_score} />
            <Typography fontSize="0.75rem" color="#64748b" mt={1} textAlign="center">
              {discharge_readiness.confidence_rationale}
            </Typography>
          </Box>
        </ExpandableSection>
      )}

      {/* ==================== CONFIDENCE FOOTER ==================== */}
      <Card elevation={2} sx={{ mt: 3, borderTop: "4px solid #64748b" }}>
        <CardContent>
          <Typography fontSize="1rem" fontWeight={700} color="#1e293b" mb={2}>
            Overall Analysis Confidence
          </Typography>
          <ConfidenceMeter score={overall_confidence} />
          <Typography fontSize="0.75rem" color="#64748b" mt={1} textAlign="center">
            Based on {iterations_performed} iteration{iterations_performed !== 1 ? "s" : ""} of clinical
            reasoning | {contradictions_resolved} contradictions resolved, {contradictions_remaining} remaining
          </Typography>
          <Typography fontSize="0.75rem" color="#64748b" mt={1} textAlign="center">
            Analysis Status: {requires_review ? "REQUIRES CLINICIAN REVIEW" : "READY FOR CLINICAL USE"}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ClinicalReasoningDashboard;