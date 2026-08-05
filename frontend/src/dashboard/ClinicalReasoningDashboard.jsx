// components/ClinicalReasoningDashboard.jsx

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Alert,
  AlertTitle,
  LinearProgress,
  Stepper,
  Step,
  StepLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  IconButton,
  Tooltip,
  CircularProgress,
  Badge,
} from "@mui/material";
import {
  ExpandMoreRounded,
  WarningAmberRounded,
  CheckCircleRounded,
  ErrorRounded,
  InfoRounded,
  LocalHospitalRounded,
  ScienceRounded,
  TrendingUpRounded,
  ShieldRounded,
  MedicationRounded,
  AssessmentRounded,
  RefreshRounded,
} from "@mui/icons-material";

// =====================================================================
// MAIN CLINICAL REASONING DASHBOARD
// =====================================================================

const ClinicalReasoningDashboard = ({ patientId, doctorId, consultationText }) => {
  const [reasoning, setReasoning] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeStep, setActiveStep] = useState(0);

  const liquidGlass = {
    position: "relative",
    borderRadius: 18,
    background: "rgba(255, 255, 255, 0.7)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    boxShadow: `
      0 8px 32px rgba(31, 38, 135, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1)
    `,
    border: "1px solid rgba(255, 255, 255, 0.3)",
  };

  const fetchClinicalReasoning = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${API_BASE_URL}hms/users/ai/clinical-reasoning`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            consultation_text: consultationText,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch clinical reasoning");
      }

      const data = await response.json();
      setReasoning(data);
      setActiveStep(6); // Show completion
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId && doctorId && consultationText) {
      fetchClinicalReasoning();
    }
  }, [patientId, doctorId, consultationText]);

  const steps = [
    { label: "Disease Causation", icon: <ScienceRounded /> },
    { label: "Staging Analysis", icon: <AssessmentRounded /> },
    { label: "Prognosis", icon: <TrendingUpRounded /> },
    { label: "Risk Stratification", icon: <WarningAmberRounded /> },
    { label: "Treatment Validation", icon: <MedicationRounded /> },
    { label: "Safety Check", icon: <ShieldRounded /> },
    { label: "Final Recommendation", icon: <CheckCircleRounded /> },
  ];

  if (loading) {
    return (
      <Box sx={{ ...liquidGlass, p: 6, textAlign: "center" }}>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Box sx={{ mb: 3 }}>
            <CircularProgress size={60} thickness={4} />
          </Box>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 300 }}>
            Analyzing Clinical Context
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.7, mb: 3 }}>
            Running multi-agent reasoning system...
          </Typography>
          <Stepper activeStep={activeStep} alternativeLabel>
            {steps.map((step, index) => (
              <Step key={index}>
                <StepLabel
                  icon={
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background:
                          index <= activeStep
                            ? "linear-gradient(135deg, #0ddcd5 0%, #04eb83 100%)"
                            : "rgba(0,0,0,0.1)",
                        color: index <= activeStep ? "#fff" : "rgba(0,0,0,0.3)",
                        transition: "all 0.3s ease",
                      }}
                    >
                      {step.icon}
                    </Box>
                  }
                >
                  {step.label}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
        </motion.div>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ ...liquidGlass }}>
        <AlertTitle>Analysis Failed</AlertTitle>
        {error}
      </Alert>
    );
  }

  if (!reasoning) {
    return (
      <Box sx={{ ...liquidGlass, p: 4, textAlign: "center" }}>
        <Typography variant="body1" sx={{ opacity: 0.6 }}>
          No clinical reasoning data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Header with Warnings */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <Box sx={{ ...liquidGlass, p: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 300, mb: 1 }}>
                Clinical Decision Support
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                AI-powered multi-agent reasoning for evidence-based care
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              {reasoning.requires_review && (
                <Chip
                  icon={<WarningAmberRounded />}
                  label="Requires Review"
                  color="warning"
                  sx={{ fontWeight: 600 }}
                />
              )}
              <Tooltip title="Refresh Analysis">
                <IconButton onClick={fetchClinicalReasoning} sx={{ ...liquidGlass }}>
                  <RefreshRounded />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Warnings */}
          {reasoning.warnings && reasoning.warnings.length > 0 && (
            <Box sx={{ mt: 2 }}>
              {reasoning.warnings.map((warning, idx) => (
                <Alert key={idx} severity="warning" sx={{ mb: 1 }}>
                  {warning}
                </Alert>
              ))}
            </Box>
          )}

          {/* Confidence Scores */}
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, opacity: 0.7 }}>
              Analysis Confidence Scores
            </Typography>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {Object.entries(reasoning.confidence_scores || {}).map(([key, value]) => (
                <Box key={key} sx={{ flex: 1, minWidth: 150 }}>
                  <Typography variant="caption" sx={{ textTransform: "capitalize" }}>
                    {key.replace("_", " ")}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={value * 100}
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: "rgba(0,0,0,0.1)",
                      "& .MuiLinearProgress-bar": {
                        background: `linear-gradient(90deg, 
                          ${value < 0.5 ? "#ff6b6b" : value < 0.75 ? "#ffd93d" : "#6bcf7f"} 0%, 
                          ${value < 0.5 ? "#ff4757" : value < 0.75 ? "#fbc02d" : "#04eb83"} 100%)`,
                      },
                    }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    {(value * 100).toFixed(0)}%
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </motion.div>

      {/* Disease Causation */}
      <DiseaseCausationPanel data={reasoning.disease_causation} liquidGlass={liquidGlass} />

      {/* Staging Analysis */}
      <StagingPanel data={reasoning.staging} liquidGlass={liquidGlass} />

      {/* Prognosis */}
      <PrognosisPanel data={reasoning.prognosis} liquidGlass={liquidGlass} />

      {/* Risk Stratification */}
      <RiskStratificationPanel data={reasoning.risk_stratification} liquidGlass={liquidGlass} />

      {/* Treatment Validation */}
      <TreatmentValidationPanel data={reasoning.treatment_validation} liquidGlass={liquidGlass} />

      {/* Contraindications */}
      <ContraindicationPanel data={reasoning.contraindications} liquidGlass={liquidGlass} />

      {/* Final Recommendation */}
      <FinalRecommendationPanel data={reasoning.final_recommendation} liquidGlass={liquidGlass} />
    </Box>
  );
};

// =====================================================================
// DISEASE CAUSATION PANEL
// =====================================================================

const DiseaseCausationPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
    >
      <Accordion sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <ScienceRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Disease Causation & Pathophysiology
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Etiology, risk factors, and disease mechanisms
              </Typography>
            </Box>
            <Chip
              label={`${(data.confidence_score * 100).toFixed(0)}% Confidence`}
              size="small"
              sx={{
                background: "rgba(102, 126, 234, 0.1)",
                color: "#667eea",
              }}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Primary Etiology */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: "#667eea", fontWeight: 600 }}>
              Primary Etiology
            </Typography>
            <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
              <CardContent>
                <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
                  {data.primary_etiology?.diagnosis}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {data.primary_etiology?.mechanism}
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Chip
                    label={data.primary_etiology?.evidence_strength}
                    size="small"
                    color={
                      data.primary_etiology?.evidence_strength === "definite"
                        ? "success"
                        : data.primary_etiology?.evidence_strength === "probable"
                        ? "warning"
                        : "default"
                    }
                  />
                  <Chip
                    label={`${(data.primary_etiology?.confidence * 100).toFixed(0)}% Confidence`}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              </CardContent>
            </Card>
          </Box>

          {/* Risk Factors */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#667eea", fontWeight: 600 }}>
              Risk Factors
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
              {/* Modifiable Risk Factors */}
              <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.2)" }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2, color: "#4caf50", fontWeight: 600 }}>
                    Modifiable Factors
                  </Typography>
                  {data.risk_factors?.modifiable?.map((factor, idx) => (
                    <Box key={idx} sx={{ mb: 2 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {factor.factor}
                        </Typography>
                        <Chip
                          label={factor.impact}
                          size="small"
                          color={
                            factor.impact === "high"
                              ? "error"
                              : factor.impact === "medium"
                              ? "warning"
                              : "success"
                          }
                        />
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                        Status: {factor.current_status}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "#4caf50" }}>
                        {factor.intervention_potential}
                      </Typography>
                    </Box>
                  ))}
                </CardContent>
              </Card>

              {/* Non-Modifiable Risk Factors */}
              <Card sx={{ background: "rgba(255, 152, 0, 0.05)", border: "1px solid rgba(255, 152, 0, 0.2)" }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 2, color: "#ff9800", fontWeight: 600 }}>
                    Non-Modifiable Factors
                  </Typography>
                  {data.risk_factors?.non_modifiable?.map((factor, idx) => (
                    <Box key={idx} sx={{ mb: 2 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {factor.factor}
                        </Typography>
                        <Chip
                          label={factor.impact}
                          size="small"
                          color={
                            factor.impact === "high"
                              ? "error"
                              : factor.impact === "medium"
                              ? "warning"
                              : "default"
                          }
                        />
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {factor.relevance}
                      </Typography>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Box>
          </Box>

          {/* Disease Progression Pathway */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#667eea", fontWeight: 600 }}>
              Disease Progression Pathway
            </Typography>
            <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
              <CardContent>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                    Natural History
                  </Typography>
                  <Typography variant="body2">
                    {data.progression_pathway?.natural_history}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
                  <Chip
                    label={`Trajectory: ${data.progression_pathway?.expected_trajectory}`}
                    color={
                      data.progression_pathway?.expected_trajectory === "improving"
                        ? "success"
                        : data.progression_pathway?.expected_trajectory === "stable"
                        ? "default"
                        : "error"
                    }
                  />
                  <Chip label={data.progression_pathway?.reversibility} variant="outlined" />
                </Box>
                {data.progression_pathway?.acceleration_factors?.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                      Acceleration Factors
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      {data.progression_pathway.acceleration_factors.map((factor, idx) => (
                        <Chip key={idx} label={factor} size="small" color="error" />
                      ))}
                    </Box>
                  </Box>
                )}
                {data.progression_pathway?.deceleration_opportunities?.length > 0 && (
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                      Deceleration Opportunities
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      {data.progression_pathway.deceleration_opportunities.map((opp, idx) => (
                        <Chip key={idx} label={opp} size="small" color="success" />
                      ))}
                    </Box>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>

          {/* Missing Information */}
          {data.missing_information && data.missing_information.length > 0 && (
            <Alert severity="info" sx={{ mt: 3 }}>
              <AlertTitle>Missing Information</AlertTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {data.missing_information.map((item, idx) => (
                  <li key={idx}>
                    <Typography variant="body2">{item}</Typography>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// =====================================================================
// STAGING PANEL
// =====================================================================

const StagingPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
    >
      <Accordion sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <AssessmentRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Staging & Severity Classification
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Disease stage, severity grading, and prognostic implications
              </Typography>
            </Box>
            <Chip
              label={`${(data.confidence_score * 100).toFixed(0)}% Confidence`}
              size="small"
              sx={{
                background: "rgba(240, 147, 251, 0.1)",
                color: "#f093fb",
              }}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Primary Staging */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
              Primary Staging System
            </Typography>
            <Card sx={{ background: "rgba(240, 147, 251, 0.05)", border: "1px solid rgba(240, 147, 251, 0.2)" }}>
              <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {data.primary_staging?.system}
                  </Typography>
                  <Chip
                    label={`Stage: ${data.primary_staging?.stage}`}
                    size="large"
                    sx={{
                      fontSize: 16,
                      fontWeight: 600,
                      background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                      color: "#fff",
                    }}
                  />
                </Box>

                {/* Calculation Components */}
                {data.primary_staging?.calculation?.components && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1, opacity: 0.7 }}>
                      Staging Components
                    </Typography>
                    {data.primary_staging.calculation.components.map((comp, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          py: 1,
                          borderBottom: "1px solid rgba(0,0,0,0.05)",
                        }}
                      >
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {comp.parameter}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>
                            Value: {comp.value}
                          </Typography>
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Chip
                            label={`Score: ${comp.score}`}
                            size="small"
                            variant="outlined"
                          />
                          {comp.data_available ? (
                            <CheckCircleRounded sx={{ color: "#4caf50", fontSize: 20 }} />
                          ) : (
                            <ErrorRounded sx={{ color: "#ff6b6b", fontSize: 20 }} />
                          )}
                        </Box>
                      </Box>
                    ))}
                    <Box sx={{ mt: 2, p: 2, background: "rgba(0,0,0,0.03)", borderRadius: 2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                        Total Score: {data.primary_staging.calculation.total_score}
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                        {data.primary_staging.calculation.interpretation}
                      </Typography>
                    </Box>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>

          {/* Severity Grade */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
              Severity Assessment
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 2 }}>
              <Card
                sx={{
                  background:
                    data.severity_grade?.grade === "critical"
                      ? "rgba(255, 107, 107, 0.1)"
                      : data.severity_grade?.grade === "severe"
                      ? "rgba(255, 152, 0, 0.1)"
                      : data.severity_grade?.grade === "moderate"
                      ? "rgba(255, 211, 61, 0.1)"
                      : "rgba(107, 207, 127, 0.1)",
                  border: `1px solid ${
                    data.severity_grade?.grade === "critical"
                      ? "#ff6b6b"
                      : data.severity_grade?.grade === "severe"
                      ? "#ff9800"
                      : data.severity_grade?.grade === "moderate"
                      ? "#ffd33d"
                      : "#6bcf7f"
                  }`,
                }}
              >
                <CardContent>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                    Grade
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, textTransform: "uppercase" }}>
                    {data.severity_grade?.grade}
                  </Typography>
                </CardContent>
              </Card>

              <Card
                sx={{
                  background:
                    data.severity_grade?.stability === "deteriorating"
                      ? "rgba(255, 107, 107, 0.1)"
                      : data.severity_grade?.stability === "unstable"
                      ? "rgba(255, 152, 0, 0.1)"
                      : "rgba(107, 207, 127, 0.1)",
                  border: `1px solid ${
                    data.severity_grade?.stability === "deteriorating"
                      ? "#ff6b6b"
                      : data.severity_grade?.stability === "unstable"
                      ? "#ff9800"
                      : "#6bcf7f"
                  }`,
                }}
              >
                <CardContent>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                    Stability
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, textTransform: "uppercase" }}>
                    {data.severity_grade?.stability}
                  </Typography>
                </CardContent>
              </Card>

              <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
                <CardContent>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                    Compensation
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, textTransform: "uppercase" }}>
                    {data.severity_grade?.compensation_status}
                  </Typography>
                </CardContent>
              </Card>
            </Box>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {data.severity_grade?.rationale}
              </Typography>
            </Box>
          </Box>

          {/* Prognostic Implications */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
              Prognostic Implications
            </Typography>
            <Card sx={{ background: "rgba(240, 147, 251, 0.05)", border: "1px solid rgba(240, 147, 251, 0.2)" }}>
              <CardContent>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                    Expected Outcome
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {data.prognostic_implications?.expected_outcome}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  <Chip
                    label={`Progression Risk: ${data.prognostic_implications?.progression_risk}`}
                    color={
                      data.prognostic_implications?.progression_risk === "high"
                        ? "error"
                        : data.prognostic_implications?.progression_risk === "medium"
                        ? "warning"
                        : "success"
                    }
                  />
                  <Chip
                    label={`Treatment Response: ${data.prognostic_implications?.treatment_response_likelihood}`}
                    variant="outlined"
                  />
                  <Chip
                    label={`QoL Impact: ${data.prognostic_implications?.quality_of_life_impact}`}
                    variant="outlined"
                  />
                </Box>
                {data.prognostic_implications?.survival_estimate && (
                  <Box sx={{ mt: 2, p: 2, background: "rgba(0,0,0,0.03)", borderRadius: 2 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                      Survival Estimate
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {data.prognostic_implications.survival_estimate}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>

          {/* Monitoring Plan */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
              Monitoring Plan
            </Typography>
            <Card sx={{ background: "rgba(240, 147, 251, 0.05)", border: "1px solid rgba(240, 147, 251, 0.2)" }}>
              <CardContent>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                    Parameters to Monitor
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {data.monitoring_plan?.parameters?.map((param, idx) => (
                      <Chip key={idx} label={param} size="small" variant="outlined" />
                    ))}
                  </Box>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                    Frequency
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {data.monitoring_plan?.frequency}
                  </Typography>
                </Box>
                {data.monitoring_plan?.escalation_triggers && (
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                      Escalation Triggers
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.monitoring_plan.escalation_triggers.map((trigger, idx) => (
                        <li key={idx}>
                          <Typography variant="body2">{trigger}</Typography>
                        </li>
                      ))}
                    </ul>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// =====================================================================
// PROGNOSIS PANEL
// =====================================================================

// const PrognosisPanel = ({ data, liquidGlass }) => {
//   if (!data) return null;

//   const getPrognosisColor = (category) => {
//     const colors = {
//       excellent: "#4caf50",
//       good: "#8bc34a",
//       guarded: "#ffc107",
//       poor: "#ff9800",
//       grave: "#f44336",
//     };
//     return colors[category] || "#9e9e9e";
//   };

//   return (
//     <motion.div
//       initial={{ opacity: 0, y: 20 }}
//       animate={{ opacity: 1, y: 0 }}
//       transition={{ duration: 0.4, delay: 0.3 }}
//     >
//       <Accordion sx={{ ...liquidGlass }}>
//         <AccordionSummary expandIcon={<ExpandMoreRounded />}>
//           <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
//             <Box
//               sx={{
//                 width: 44,
//                 height: 44,
//                 borderRadius: 3,
//                 background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
//                 display: "flex",
//                 alignItems: "center",
//                 justifyContent: "center",
//                 color: "#fff",
//               }}
//             >
//               <TrendingUpRounded />
//             </Box>
//             <Box sx={{ flex: 1 }}>
//               <Typography variant="h6" sx={{ fontWeight: 300 }}>
//                 Prognosis & Outcome Prediction
//               </Typography>
//               <Typography variant="caption" sx={{ opacity: 0.7 }}>
//                 Short, medium, and long-term outcome predictions
//               </Typography>
//             </Box>
//             <Chip
//               label={data.prognostic_category || "Unknown"}
//               size="small"
//               sx={{
//                 background: `${getPrognosisColor(data.prognostic_category)}20`,
//                 color: getPrognosisColor(data.prognostic_category),
//                 fontWeight: 600,
//                 textTransform: "uppercase",
//               }}
//             />
//           </Box>
//         </AccordionSummary>
//         <AccordionDetails>
//           {/* Prognostic Category Banner */}
//           <Box
//             sx={{
//               mb: 3,
//               p: 3,
//               borderRadius: 3,
//               background: `linear-gradient(135deg, ${getPrognosisColor(data.prognostic_category)}15 0%, ${getPrognosisColor(data.prognostic_category)}05 100%)`,
//               border: `2px solid ${getPrognosisColor(data.prognostic_category)}`,
//             }}
//           >
//             <Typography variant="h4" sx={{ fontWeight: 600, color: getPrognosisColor(data.prognostic_category), mb: 1 }}>
//               {data.prognostic_category?.toUpperCase()} PROGNOSIS
//             </Typography>
//             <Typography variant="body2" sx={{ opacity: 0.8 }}>
//               Overall confidence: {(data.confidence_score * 100).toFixed(0)}%
//             </Typography>
//           </Box>

//           {/* Prognostic Factors */}
//           <Box sx={{ mb: 3 }}>
//             <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
//               Prognostic Factors
//             </Typography>
//             <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
//               {/* Favorable Factors */}
//               <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
//                 <CardContent>
//                   <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
//                     <CheckCircleRounded sx={{ color: "#4caf50" }} />
//                     <Typography variant="subtitle2" sx={{ color: "#4caf50", fontWeight: 600 }}>
//                       Favorable Factors
//                     </Typography>
//                   </Box>
//                   {data.prognostic_factors?.favorable?.map((factor, idx) => (
//                     <Box
//                       key={idx}
//                       sx={{
//                         mb: 2,
//                         p: 1.5,
//                         borderRadius: 2,
//                         background: "rgba(255,255,255,0.5)",
//                         border: "1px solid rgba(76, 175, 80, 0.2)",
//                       }}
//                     >
//                       <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
//                         <Typography variant="body2" sx={{ fontWeight: 600 }}>
//                           {factor.factor}
//                         </Typography>
//                         {factor.modifiable && (
//                           <Chip label="Modifiable" size="small" color="success" sx={{ height: 20 }} />
//                         )}
//                       </Box>
//                       <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
//                         <Chip
//                           label={`Impact: ${factor.impact}`}
//                           size="small"
//                           variant="outlined"
//                           sx={{ fontSize: 10 }}
//                         />
//                         <Chip
//                           label={`Evidence: ${factor.evidence}`}
//                           size="small"
//                           variant="outlined"
//                           sx={{ fontSize: 10 }}
//                         />
//                       </Box>
//                     </Box>
//                   ))}
//                 </CardContent>
//               </Card>

//               {/* Unfavorable Factors */}
//               <Card sx={{ background: "rgba(244, 67, 54, 0.05)", border: "1px solid rgba(244, 67, 54, 0.3)" }}>
//                 <CardContent>
//                   <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
//                     <WarningAmberRounded sx={{ color: "#f44336" }} />
//                     <Typography variant="subtitle2" sx={{ color: "#f44336", fontWeight: 600 }}>
//                       Unfavorable Factors
//                     </Typography>
//                   </Box>
//                   {data.prognostic_factors?.unfavorable?.map((factor, idx) => (
//                     <Box
//                       key={idx}
//                       sx={{
//                         mb: 2,
//                         p: 1.5,
//                         borderRadius: 2,
//                         background: "rgba(255,255,255,0.5)",
//                         border: "1px solid rgba(244, 67, 54, 0.2)",
//                       }}
//                     >
//                       <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
//                         <Typography variant="body2" sx={{ fontWeight: 600 }}>
//                           {factor.factor}
//                         </Typography>
//                         {factor.modifiable && (
//                           <Chip label="Modifiable" size="small" color="warning" sx={{ height: 20 }} />
//                         )}
//                       </Box>
//                       <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
//                         <Chip
//                           label={`Impact: ${factor.impact}`}
//                           size="small"
//                           variant="outlined"
//                           sx={{ fontSize: 10 }}
//                         />
//                         <Chip
//                           label={`Evidence: ${factor.evidence}`}
//                           size="small"
//                           variant="outlined"
//                           sx={{ fontSize: 10 }}
//                         />
//                       </Box>
//                     </Box>
//                   ))}
//                 </CardContent>
//               </Card>
//             </Box>
//           </Box>

//           {/* Outcome Predictions Timeline */}
//           <Box sx={{ mb: 3 }}>
//             <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
//               Outcome Predictions Timeline
//             </Typography>
//             <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
//               {/* Short-term */}
//               <Card
//                 sx={{
//                   background: "linear-gradient(90deg, rgba(79, 172, 254, 0.1) 0%, rgba(0, 242, 254, 0.05) 100%)",
//                   border: "1px solid rgba(79, 172, 254, 0.3)",
//                 }}
//               >
//                 <CardContent>
//                   <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
//                     <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#4facfe" }}>
//                       Short-term ({data.outcome_predictions?.short_term?.timeline})
//                     </Typography>
//                     <Chip
//                       label={`${(data.outcome_predictions?.short_term?.confidence * 100).toFixed(0)}% Confidence`}
//                       size="small"
//                       sx={{ background: "rgba(79, 172, 254, 0.2)", color: "#4facfe" }}
//                     />
//                   </Box>
//                   <Typography variant="body2">{data.outcome_predictions?.short_term?.expected_outcome}</Typography>
//                 </CardContent>
//               </Card>

//               {/* Medium-term */}
//               <Card
//                 sx={{
//                   background: "linear-gradient(90deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.05) 100%)",
//                   border: "1px solid rgba(102, 126, 234, 0.3)",
//                 }}
//               >
//                 <CardContent>
//                   <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
//                     <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#667eea" }}>
//                       Medium-term ({data.outcome_predictions?.medium_term?.timeline})
//                     </Typography>
//                     <Chip
//                       label={`${(data.outcome_predictions?.medium_term?.confidence * 100).toFixed(0)}% Confidence`}
//                       size="small"
//                       sx={{ background: "rgba(102, 126, 234, 0.2)", color: "#667eea" }}
//                     />
//                   </Box>
//                   <Typography variant="body2">{data.outcome_predictions?.medium_term?.expected_outcome}</Typography>
//                 </CardContent>
//               </Card>

//               {/* Long-term */}
//               <Card
//                 sx={{
//                   background: "linear-gradient(90deg, rgba(240, 147, 251, 0.1) 0%, rgba(245, 87, 108, 0.05) 100%)",
//                   border: "1px solid rgba(240, 147, 251, 0.3)",
//                 }}
//               >
//                 <CardContent>
//                   <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
//                     <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#f093fb" }}>
//                       Long-term ({data.outcome_predictions?.long_term?.timeline})
//                     </Typography>
//                     <Chip
//                       label={`${(data.outcome_predictions?.long_term?.confidence * 100).toFixed(0)}% Confidence`}
//                       size="small"
//                       sx={{ background: "rgba(240, 147, 251, 0.2)", color: "#f093fb" }}
//                     />
//                   </Box>
//                   <Typography variant="body2" sx={{ mb: 1 }}>
//                     {data.outcome_predictions?.long_term?.expected_outcome}
//                   </Typography>
//                   {data.outcome_predictions?.long_term?.survival_estimate && (
//                     <Alert severity="info" sx={{ mt: 1 }}>
//                       <Typography variant="caption" sx={{ fontWeight: 600 }}>
//                         Survival Estimate: {data.outcome_predictions.long_term.survival_estimate}
//                       </Typography>
//                     </Alert>
//                   )}
//                 </CardContent>
//               </Card>
//             </Box>
//           </Box>

//           {/* Trajectory Scenarios */}
//           <Box sx={{ mb: 3 }}>
//             <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
//               Trajectory Scenarios
//             </Typography>
//             <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
//               <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
//                 <CardContent>
//                   <Typography variant="subtitle2" sx={{ color: "#4caf50", fontWeight: 600, mb: 1 }}>
//                     ✓ Best Case Scenario
//                   </Typography>
//                   <Typography variant="body2">{data.trajectory_scenarios?.best_case}</Typography>
//                 </CardContent>
//               </Card>

//               <Card sx={{ background: "rgba(33, 150, 243, 0.05)", border: "1px solid rgba(33, 150, 243, 0.3)" }}>
//                 <CardContent>
//                   <Typography variant="subtitle2" sx={{ color: "#2196f3", fontWeight: 600, mb: 1 }}>
//                     → Expected Scenario
//                   </Typography>
//                   <Typography variant="body2">{data.trajectory_scenarios?.expected_case}</Typography>
//                 </CardContent>
//               </Card>

//               <Card sx={{ background: "rgba(244, 67, 54, 0.05)", border: "1px solid rgba(244, 67, 54, 0.3)" }}>
//                 <CardContent>
//                   <Typography variant="subtitle2" sx={{ color: "#f44336", fontWeight: 600, mb: 1 }}>
//                     ✗ Worst Case Scenario
//                   </Typography>
//                   <Typography variant="body2">{data.trajectory_scenarios?.worst_case}</Typography>
//                 </CardContent>
//               </Card>
//             </Box>
//           </Box>

//           {/* Modifiable Factors Priority */}
//           <Box>
//             <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
//               Priority Interventions for Prognostic Improvement
//             </Typography>
//             <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
//               {data.modifiable_factors_priority?.map((item, idx) => (
//                 <Card
//                   key={idx}
//                   sx={{
//                     background: "rgba(79, 172, 254, 0.05)",
//                     border: "1px solid rgba(79, 172, 254, 0.2)",
//                     position: "relative",
//                     overflow: "visible",
//                   }}
//                 >
//                   <Box
//                     sx={{
//                       position: "absolute",
//                       top: -10,
//                       left: 20,
//                       width: 32,
//                       height: 32,
//                       borderRadius: "50%",
//                       background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
//                       display: "flex",
//                       alignItems: "center",
//                       justifyContent: "center",
//                       color: "#fff",
//                       fontWeight: 600,
//                       fontSize: 14,
//                       boxShadow: "0 4px 12px rgba(79, 172, 254, 0.3)",
//                     }}
//                   >
//                     {idx + 1}
//                   </Box>
//                   <CardContent sx={{ pt: 3 }}>
//                     <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
//                       {item.factor}
//                     </Typography>
//                     <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
//                       Intervention: {item.intervention}
//                     </Typography>
//                     <Box sx={{ display: "flex", gap: 1 }}>
//                       <Chip label={`Benefit: ${item.expected_benefit}`} size="small" color="success" />
//                       <Chip
//                         label={`Feasibility: ${item.feasibility}`}
//                         size="small"
//                         color={
//                           item.feasibility === "easy"
//                             ? "success"
//                             : item.feasibility === "moderate"
//                             ? "warning"
//                             : "error"
//                         }
//                       />
//                     </Box>
//                   </CardContent>
//                 </Card>
//               ))}
//             </Box>
//           </Box>

//           {/* Uncertainty Factors */}
//           {data.uncertainty_factors && data.uncertainty_factors.length > 0 && (
//             <Alert severity="warning" sx={{ mt: 3 }}>
//               <AlertTitle>Prognostic Uncertainty</AlertTitle>
//               <Typography variant="body2" sx={{ mb: 1 }}>
//                 The following factors introduce uncertainty into prognostic predictions:
//               </Typography>
//               <ul style={{ margin: 0, paddingLeft: 20 }}>
//                 {data.uncertainty_factors.map((factor, idx) => (
//                   <li key={idx}>
//                     <Typography variant="body2">{factor}</Typography>
//                   </li>
//                 ))}
//               </ul>
//             </Alert>
//           )}
//         </AccordionDetails>
//       </Accordion>
//     </motion.div>
//   );
// };

// =====================================================================
// RISK STRATIFICATION PANEL
// =====================================================================

const RiskStratificationPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  const getRiskColor = (level) => {
    const colors = {
      low: "#4caf50",
      moderate: "#ff9800",
      high: "#f44336",
      critical: "#d32f2f",
    };
    return colors[level] || "#9e9e9e";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
    >
      <Accordion sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <WarningAmberRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Risk Stratification & Assessment
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Comprehensive risk analysis across multiple domains
              </Typography>
            </Box>
            <Badge
              badgeContent={data.red_flags?.length || 0}
              color="error"
              sx={{
                "& .MuiBadge-badge": {
                  fontSize: 11,
                  fontWeight: 600,
                },
              }}
            >
              <Chip
                label={data.overall_risk_category?.toUpperCase() || "Unknown"}
                size="small"
                sx={{
                  background: `${getRiskColor(data.overall_risk_category)}20`,
                  color: getRiskColor(data.overall_risk_category),
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              />
            </Badge>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Overall Risk Banner */}
          <Box
            sx={{
              mb: 3,
              p: 3,
              borderRadius: 3,
              background: `linear-gradient(135deg, ${getRiskColor(data.overall_risk_category)}20 0%, ${getRiskColor(data.overall_risk_category)}05 100%)`,
              border: `3px solid ${getRiskColor(data.overall_risk_category)}`,
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography
                  variant="h4"
                  sx={{ fontWeight: 600, color: getRiskColor(data.overall_risk_category), mb: 0.5 }}
                >
                  {data.overall_risk_category?.toUpperCase()} RISK
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  Overall risk score: {(data.risk_score * 100).toFixed(0)}%
                </Typography>
              </Box>
              {data.requires_immediate_action && (
                <Chip
                  icon={<WarningAmberRounded />}
                  label="IMMEDIATE ACTION REQUIRED"
                  color="error"
                  sx={{
                    fontWeight: 600,
                    fontSize: 13,
                    animation: "pulse 1.5s infinite",
                    "@keyframes pulse": {
                      "0%": { transform: "scale(1)" },
                      "50%": { transform: "scale(1.05)" },
                      "100%": { transform: "scale(1)" },
                    },
                  }}
                />
              )}
            </Box>
          </Box>

          {/* Red Flags */}
          {data.red_flags && data.red_flags.length > 0 && (
            <Alert
              severity="error"
              sx={{
                mb: 3,
                "& .MuiAlert-icon": {
                  fontSize: 28,
                },
              }}
            >
              <AlertTitle sx={{ fontWeight: 600, fontSize: 16 }}>🚨 Critical Red Flags</AlertTitle>
              <Box sx={{ mt: 1 }}>
                {data.red_flags.map((flag, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      py: 1,
                      px: 2,
                      mb: 1,
                      borderRadius: 2,
                      background: "rgba(211, 47, 47, 0.1)",
                      border: "1px solid rgba(211, 47, 47, 0.3)",
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {flag}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Alert>
          )}

          {/* Risk Domains */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#fa709a", fontWeight: 600 }}>
              Risk Domains Analysis
            </Typography>

            {/* Mortality Risk */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                Mortality Risk
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 2 }}>
                <Card
                  sx={{
                    background: `${getRiskColor(data.risk_domains?.mortality?.short_term?.level)}10`,
                    border: `1px solid ${getRiskColor(data.risk_domains?.mortality?.short_term?.level)}`,
                  }}
                >
                  <CardContent>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                      Short-term
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                      {data.risk_domains?.mortality?.short_term?.level?.toUpperCase()}
                    </Typography>
                    {data.risk_domains?.mortality?.short_term?.percentage && (
                      <Chip
                        label={data.risk_domains.mortality.short_term.percentage}
                        size="small"
                        sx={{ fontSize: 11 }}
                      />
                    )}
                    <Typography variant="caption" sx={{ display: "block", mt: 1, opacity: 0.7 }}>
                      Timeline: {data.risk_domains?.mortality?.short_term?.timeline}
                    </Typography>
                  </CardContent>
                </Card>

                <Card
                  sx={{
                    background: `${getRiskColor(data.risk_domains?.mortality?.long_term?.level)}10`,
                    border: `1px solid ${getRiskColor(data.risk_domains?.mortality?.long_term?.level)}`,
                  }}
                >
                  <CardContent>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                      Long-term
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                      {data.risk_domains?.mortality?.long_term?.level?.toUpperCase()}
                    </Typography>
                    {data.risk_domains?.mortality?.long_term?.percentage && (
                      <Chip
                        label={data.risk_domains.mortality.long_term.percentage}
                        size="small"
                        sx={{ fontSize: 11 }}
                      />
                    )}
                    <Typography variant="caption" sx={{ display: "block", mt: 1, opacity: 0.7 }}>
                      Timeline: {data.risk_domains?.mortality?.long_term?.timeline}
                    </Typography>
                  </CardContent>
                </Card>
              </Box>
            </Box>

            {/* Morbidity Risk */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                Morbidity Risk
              </Typography>
              <Card
                sx={{
                  background: `${getRiskColor(data.risk_domains?.morbidity?.probability)}10`,
                  border: `1px solid ${getRiskColor(data.risk_domains?.morbidity?.probability)}`,
                }}
              >
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                    <Chip
                      label={`Probability: ${data.risk_domains?.morbidity?.probability?.toUpperCase()}`}
                      sx={{
                        background: getRiskColor(data.risk_domains?.morbidity?.probability),
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    />
                    <Chip
                      label={`Severity: ${data.risk_domains?.morbidity?.severity_if_occurs}`}
                      variant="outlined"
                    />
                  </Box>
                  {data.risk_domains?.morbidity?.complications && (
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Potential Complications:
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {data.risk_domains.morbidity.complications.map((comp, idx) => (
                          <Chip key={idx} label={comp} size="small" />
                        ))}
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>

            {/* Treatment Risk */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                Treatment-Related Risk
              </Typography>
              <Card
                sx={{
                  background: `${getRiskColor(data.risk_domains?.treatment_risk?.overall_level)}10`,
                  border: `1px solid ${getRiskColor(data.risk_domains?.treatment_risk?.overall_level)}`,
                }}
              >
                <CardContent>
                  <Chip
                    label={`Overall Level: ${data.risk_domains?.treatment_risk?.overall_level?.toUpperCase()}`}
                    sx={{
                      background: getRiskColor(data.risk_domains?.treatment_risk?.overall_level),
                      color: "#fff",
                      fontWeight: 600,
                      mb: 2,
                    }}
                  />
                  {data.risk_domains?.treatment_risk?.medication_adverse_effects?.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Medication Adverse Effects:
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.risk_domains.treatment_risk.medication_adverse_effects.map((effect, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{effect}</Typography>
                          </li>
                        ))}
                      </ul>
                    </Box>
                  )}
                  {data.risk_domains?.treatment_risk?.procedure_complications?.length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Procedure Complications:
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.risk_domains.treatment_risk.procedure_complications.map((comp, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{comp}</Typography>
                          </li>
                        ))}
                      </ul>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Box>

          {/* Time-Sensitive Risks */}
          {data.time_sensitive_risks && data.time_sensitive_risks.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#fa709a", fontWeight: 600 }}>
                Time-Sensitive Risks
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.time_sensitive_risks.map((risk, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background:
                        risk.urgency === "immediate"
                          ? "rgba(211, 47, 47, 0.1)"
                          : risk.urgency === "urgent"
                          ? "rgba(255, 152, 0, 0.1)"
                          : "rgba(33, 150, 243, 0.1)",
                      border: `2px solid ${
                        risk.urgency === "immediate"
                          ? "#d32f2f"
                          : risk.urgency === "urgent"
                          ? "#ff9800"
                          : "#2196f3"
                      }`,
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: "flex", justifyContent: "between", alignItems: "flex-start", mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
                          {risk.risk}
                        </Typography>
                        <Chip
                          label={risk.urgency?.toUpperCase()}
                          size="small"
                          color={
                            risk.urgency === "immediate"
                              ? "error"
                              : risk.urgency === "urgent"
                              ? "warning"
                              : "info"
                          }
                          sx={{ fontWeight: 600 }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ display: "block", opacity: 0.7, mb: 1 }}>
                        Timeline: {risk.timeline}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "#4caf50", fontWeight: 600 }}>
                        Mitigation: {risk.mitigation}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Risk Mitigation Priority */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#fa709a", fontWeight: 600 }}>
              Risk Mitigation Priorities
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {data.risk_mitigation_priority
                ?.sort((a, b) => a.priority - b.priority)
                .map((item, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background: "rgba(250, 112, 154, 0.05)",
                      border: "1px solid rgba(250, 112, 154, 0.2)",
                      position: "relative",
                      overflow: "visible",
                    }}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        top: -12,
                        left: 20,
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 16,
                        boxShadow: "0 4px 12px rgba(250, 112, 154, 0.4)",
                      }}
                    >
                      {item.priority}
                    </Box>
                    <CardContent sx={{ pt: 3 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                        {item.risk}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
                        <strong>Intervention:</strong> {item.intervention}
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <Chip
                          label={`Risk Reduction: ${item.risk_reduction}`}
                          size="small"
                          color={
                            item.risk_reduction === "major"
                              ? "success"
                              : item.risk_reduction === "moderate"
                              ? "warning"
                              : "default"
                          }
                        />
                        <Chip
                          label={`Feasibility: ${item.feasibility}`}
                          size="small"
                          color={
                            item.feasibility === "easy"
                              ? "success"
                              : item.feasibility === "moderate"
                              ? "warning"
                              : "error"
                          }
                        />
                      </Box>
                    </CardContent>
                  </Card>
                ))}
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// =====================================================================
// PROGNOSIS PANEL
// =====================================================================

const PrognosisPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  const getPrognosisColor = (category) => {
    const colors = {
      excellent: "#4caf50",
      good: "#8bc34a",
      guarded: "#ffc107",
      poor: "#ff9800",
      grave: "#f44336",
    };
    return colors[category] || "#9e9e9e";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
    >
      <Accordion sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <TrendingUpRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Prognosis & Outcome Prediction
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Short, medium, and long-term outcome predictions
              </Typography>
            </Box>
            <Chip
              label={data.prognostic_category || "Unknown"}
              size="small"
              sx={{
                background: `${getPrognosisColor(data.prognostic_category)}20`,
                color: getPrognosisColor(data.prognostic_category),
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Prognostic Category Banner */}
          <Box
            sx={{
              mb: 3,
              p: 3,
              borderRadius: 3,
              background: `linear-gradient(135deg, ${getPrognosisColor(data.prognostic_category)}15 0%, ${getPrognosisColor(data.prognostic_category)}05 100%)`,
              border: `2px solid ${getPrognosisColor(data.prognostic_category)}`,
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 600, color: getPrognosisColor(data.prognostic_category), mb: 1 }}>
              {data.prognostic_category?.toUpperCase()} PROGNOSIS
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Overall confidence: {(data.confidence_score * 100).toFixed(0)}%
            </Typography>
          </Box>

          {/* Prognostic Factors */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
              Prognostic Factors
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
              {/* Favorable Factors */}
              <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                    <CheckCircleRounded sx={{ color: "#4caf50" }} />
                    <Typography variant="subtitle2" sx={{ color: "#4caf50", fontWeight: 600 }}>
                      Favorable Factors
                    </Typography>
                  </Box>
                  {data.prognostic_factors?.favorable?.map((factor, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        mb: 2,
                        p: 1.5,
                        borderRadius: 2,
                        background: "rgba(255,255,255,0.5)",
                        border: "1px solid rgba(76, 175, 80, 0.2)",
                      }}
                    >
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {factor.factor}
                        </Typography>
                        {factor.modifiable && (
                          <Chip label="Modifiable" size="small" color="success" sx={{ height: 20 }} />
                        )}
                      </Box>
                      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                        <Chip
                          label={`Impact: ${factor.impact}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 10 }}
                        />
                        <Chip
                          label={`Evidence: ${factor.evidence}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 10 }}
                        />
                      </Box>
                    </Box>
                  ))}
                </CardContent>
              </Card>

              {/* Unfavorable Factors */}
              <Card sx={{ background: "rgba(244, 67, 54, 0.05)", border: "1px solid rgba(244, 67, 54, 0.3)" }}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                    <WarningAmberRounded sx={{ color: "#f44336" }} />
                    <Typography variant="subtitle2" sx={{ color: "#f44336", fontWeight: 600 }}>
                      Unfavorable Factors
                    </Typography>
                  </Box>
                  {data.prognostic_factors?.unfavorable?.map((factor, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        mb: 2,
                        p: 1.5,
                        borderRadius: 2,
                        background: "rgba(255,255,255,0.5)",
                        border: "1px solid rgba(244, 67, 54, 0.2)",
                      }}
                    >
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {factor.factor}
                        </Typography>
                        {factor.modifiable && (
                          <Chip label="Modifiable" size="small" color="warning" sx={{ height: 20 }} />
                        )}
                      </Box>
                      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                        <Chip
                          label={`Impact: ${factor.impact}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 10 }}
                        />
                        <Chip
                          label={`Evidence: ${factor.evidence}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 10 }}
                        />
                      </Box>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Box>
          </Box>

          {/* Outcome Predictions Timeline */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
              Outcome Predictions Timeline
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Short-term */}
              <Card
                sx={{
                  background: "linear-gradient(90deg, rgba(79, 172, 254, 0.1) 0%, rgba(0, 242, 254, 0.05) 100%)",
                  border: "1px solid rgba(79, 172, 254, 0.3)",
                }}
              >
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#4facfe" }}>
                      Short-term ({data.outcome_predictions?.short_term?.timeline})
                    </Typography>
                    <Chip
                      label={`${(data.outcome_predictions?.short_term?.confidence * 100).toFixed(0)}% Confidence`}
                      size="small"
                      sx={{ background: "rgba(79, 172, 254, 0.2)", color: "#4facfe" }}
                    />
                  </Box>
                  <Typography variant="body2">{data.outcome_predictions?.short_term?.expected_outcome}</Typography>
                </CardContent>
              </Card>

              {/* Medium-term */}
              <Card
                sx={{
                  background: "linear-gradient(90deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.05) 100%)",
                  border: "1px solid rgba(102, 126, 234, 0.3)",
                }}
              >
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#667eea" }}>
                      Medium-term ({data.outcome_predictions?.medium_term?.timeline})
                    </Typography>
                    <Chip
                      label={`${(data.outcome_predictions?.medium_term?.confidence * 100).toFixed(0)}% Confidence`}
                      size="small"
                      sx={{ background: "rgba(102, 126, 234, 0.2)", color: "#667eea" }}
                    />
                  </Box>
                  <Typography variant="body2">{data.outcome_predictions?.medium_term?.expected_outcome}</Typography>
                </CardContent>
              </Card>

              {/* Long-term */}
              <Card
                sx={{
                  background: "linear-gradient(90deg, rgba(240, 147, 251, 0.1) 0%, rgba(245, 87, 108, 0.05) 100%)",
                  border: "1px solid rgba(240, 147, 251, 0.3)",
                }}
              >
                <CardContent>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "#f093fb" }}>
                      Long-term ({data.outcome_predictions?.long_term?.timeline})
                    </Typography>
                    <Chip
                      label={`${(data.outcome_predictions?.long_term?.confidence * 100).toFixed(0)}% Confidence`}
                      size="small"
                      sx={{ background: "rgba(240, 147, 251, 0.2)", color: "#f093fb" }}
                    />
                  </Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {data.outcome_predictions?.long_term?.expected_outcome}
                  </Typography>
                  {data.outcome_predictions?.long_term?.survival_estimate && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Survival Estimate: {data.outcome_predictions.long_term.survival_estimate}
                      </Typography>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Box>
          </Box>

          {/* Trajectory Scenarios */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
              Trajectory Scenarios
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ color: "#4caf50", fontWeight: 600, mb: 1 }}>
                    ✓ Best Case Scenario
                  </Typography>
                  <Typography variant="body2">{data.trajectory_scenarios?.best_case}</Typography>
                </CardContent>
              </Card>

              <Card sx={{ background: "rgba(33, 150, 243, 0.05)", border: "1px solid rgba(33, 150, 243, 0.3)" }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ color: "#2196f3", fontWeight: 600, mb: 1 }}>
                    → Expected Scenario
                  </Typography>
                  <Typography variant="body2">{data.trajectory_scenarios?.expected_case}</Typography>
                </CardContent>
              </Card>

              <Card sx={{ background: "rgba(244, 67, 54, 0.05)", border: "1px solid rgba(244, 67, 54, 0.3)" }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ color: "#f44336", fontWeight: 600, mb: 1 }}>
                    ✗ Worst Case Scenario
                  </Typography>
                  <Typography variant="body2">{data.trajectory_scenarios?.worst_case}</Typography>
                </CardContent>
              </Card>
            </Box>
          </Box>

          {/* Modifiable Factors Priority */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#4facfe", fontWeight: 600 }}>
              Priority Interventions for Prognostic Improvement
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {data.modifiable_factors_priority?.map((item, idx) => (
                <Card
                  key={idx}
                  sx={{
                    background: "rgba(79, 172, 254, 0.05)",
                    border: "1px solid rgba(79, 172, 254, 0.2)",
                    position: "relative",
                    overflow: "visible",
                  }}
                >
                  <Box
                    sx={{
                      position: "absolute",
                      top: -10,
                      left: 20,
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: 14,
                      boxShadow: "0 4px 12px rgba(79, 172, 254, 0.3)",
                    }}
                  >
                    {idx + 1}
                  </Box>
                  <CardContent sx={{ pt: 3 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      {item.factor}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
                      Intervention: {item.intervention}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Chip label={`Benefit: ${item.expected_benefit}`} size="small" color="success" />
                      <Chip
                        label={`Feasibility: ${item.feasibility}`}
                        size="small"
                        color={
                          item.feasibility === "easy"
                            ? "success"
                            : item.feasibility === "moderate"
                            ? "warning"
                            : "error"
                        }
                      />
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>

          {/* Uncertainty Factors */}
          {data.uncertainty_factors && data.uncertainty_factors.length > 0 && (
            <Alert severity="warning" sx={{ mt: 3 }}>
              <AlertTitle>Prognostic Uncertainty</AlertTitle>
              <Typography variant="body2" sx={{ mb: 1 }}>
                The following factors introduce uncertainty into prognostic predictions:
              </Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {data.uncertainty_factors.map((factor, idx) => (
                  <li key={idx}>
                    <Typography variant="body2">{factor}</Typography>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// =====================================================================
// RISK STRATIFICATION PANEL
// =====================================================================

// const RiskStratificationPanel = ({ data, liquidGlass }) => {
//   if (!data) return null;

//   const getRiskColor = (level) => {
//     const colors = {
//       low: "#4caf50",
//       moderate: "#ff9800",
//       high: "#f44336",
//       critical: "#d32f2f",
//     };
//     return colors[level] || "#9e9e9e";
//   };

//   return (
//     <motion.div
//       initial={{ opacity: 0, y: 20 }}
//       animate={{ opacity: 1, y: 0 }}
//       transition={{ duration: 0.4, delay: 0.4 }}
//     >
//       <Accordion sx={{ ...liquidGlass }}>
//         <AccordionSummary expandIcon={<ExpandMoreRounded />}>
//           <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
//             <Box
//               sx={{
//                 width: 44,
//                 height: 44,
//                 borderRadius: 3,
//                 background: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
//                 display: "flex",
//                 alignItems: "center",
//                 justifyContent: "center",
//                 color: "#fff",
//               }}
//             >
//               <WarningAmberRounded />
//             </Box>
//             <Box sx={{ flex: 1 }}>
//               <Typography variant="h6" sx={{ fontWeight: 300 }}>
//                 Risk Stratification & Assessment
//               </Typography>
//               <Typography variant="caption" sx={{ opacity: 0.7 }}>
//                 Comprehensive risk analysis across multiple domains
//               </Typography>
//             </Box>
//             <Badge
//               badgeContent={data.red_flags?.length || 0}
//               color="error"
//               sx={{
//                 "& .MuiBadge-badge": {
//                   fontSize: 11,
//                   fontWeight: 600,
//                 },
//               }}
//             >
//               <Chip
//                 label={data.overall_risk_category?.toUpperCase() || "Unknown"}
//                 size="small"
//                 sx={{
//                   background: `${getRiskColor(data.overall_risk_category)}20`,
//                   color: getRiskColor(data.overall_risk_category),
//                   fontWeight: 600,
//                   textTransform: "uppercase",
//                 }}
//               />
//             </Badge>
//           </Box>
//         </AccordionSummary>
//         <AccordionDetails>
//           {/* Overall Risk Banner */}
//           <Box
//             sx={{
//               mb: 3,
//               p: 3,
//               borderRadius: 3,
//               background: `linear-gradient(135deg, ${getRiskColor(data.overall_risk_category)}20 0%, ${getRiskColor(data.overall_risk_category)}05 100%)`,
//               border: `3px solid ${getRiskColor(data.overall_risk_category)}`,
//             }}
//           >
//             <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
//               <Box>
//                 <Typography
//                   variant="h4"
//                   sx={{ fontWeight: 600, color: getRiskColor(data.overall_risk_category), mb: 0.5 }}
//                 >
//                   {data.overall_risk_category?.toUpperCase()} RISK
//                 </Typography>
//                 <Typography variant="body2" sx={{ opacity: 0.8 }}>
//                   Overall risk score: {(data.risk_score * 100).toFixed(0)}%
//                 </Typography>
//               </Box>
//               {data.requires_immediate_action && (
//                 <Chip
//                   icon={<WarningAmberRounded />}
//                   label="IMMEDIATE ACTION REQUIRED"
//                   color="error"
//                   sx={{
//                     fontWeight: 600,
//                     fontSize: 13,
//                     animation: "pulse 1.5s infinite",
//                     "@keyframes pulse": {
//                       "0%": { transform: "scale(1)" },
//                       "50%": { transform: "scale(1.05)" },
//                       "100%": { transform: "scale(1)" },
//                     },
//                   }}
//                 />
//               )}
//             </Box>
//           </Box>

//           {/* Red Flags */}
//           {data.red_flags && data.red_flags.length > 0 && (
//             <Alert
//               severity="error"
//               sx={{
//                 mb: 3,
//                 "& .MuiAlert-icon": {
//                   fontSize: 28,
//                 },
//               }}
//             >
//               <AlertTitle sx={{ fontWeight: 600, fontSize: 16 }}>🚨 Critical Red Flags</AlertTitle>
//               <Box sx={{ mt: 1 }}>
//                 {data.red_flags.map((flag, idx) => (
//                   <Box
//                     key={idx}
//                     sx={{
//                       py: 1,
//                       px: 2,
//                       mb: 1,
//                       borderRadius: 2,
//                       background: "rgba(211, 47, 47, 0.1)",
//                       border: "1px solid rgba(211, 47, 47, 0.3)",
//                     }}
//                   >
//                     <Typography variant="body2" sx={{ fontWeight: 600 }}>
//                       {flag}
//                     </Typography>
//                   </Box>
//                 ))}
//               </Box>
//             </Alert>
//           )}

//           {/* Risk Domains */}
//           <Box sx={{ mb: 3 }}>
//             <Typography variant="subtitle2" sx={{ mb: 2, color: "#fa709a", fontWeight: 600 }}>
//               Risk Domains Analysis
//             </Typography>

//             {/* Mortality Risk */}
//             <Box sx={{ mb: 3 }}>
//               <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
//                 Mortality Risk
//               </Typography>
//               <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 2 }}>
//                 <Card
//                   sx={{
//                     background: `${getRiskColor(data.risk_domains?.mortality?.short_term?.level)}10`,
//                     border: `1px solid ${getRiskColor(data.risk_domains?.mortality?.short_term?.level)}`,
//                   }}
//                 >
//                   <CardContent>
//                     <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
//                       Short-term
//                     </Typography>
//                     <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
//                       {data.risk_domains?.mortality?.short_term?.level?.toUpperCase()}
//                     </Typography>
//                     {data.risk_domains?.mortality?.short_term?.percentage && (
//                       <Chip
//                         label={data.risk_domains.mortality.short_term.percentage}
//                         size="small"
//                         sx={{ fontSize: 11 }}
//                       />
//                     )}
//                     <Typography variant="caption" sx={{ display: "block", mt: 1, opacity: 0.7 }}>
//                       Timeline: {data.risk_domains?.mortality?.short_term?.timeline}
//                     </Typography>
//                   </CardContent>
//                 </Card>

//                 <Card
//                   sx={{
//                     background: `${getRiskColor(data.risk_domains?.mortality?.long_term?.level)}10`,
//                     border: `1px solid ${getRiskColor(data.risk_domains?.mortality?.long_term?.level)}`,
//                   }}
//                 >
//                   <CardContent>
//                     <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
//                       Long-term
//                     </Typography>
//                     <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
//                       {data.risk_domains?.mortality?.long_term?.level?.toUpperCase()}
//                     </Typography>
//                     {data.risk_domains?.mortality?.long_term?.percentage && (
//                       <Chip
//                         label={data.risk_domains.mortality.long_term.percentage}
//                         size="small"
//                         sx={{ fontSize: 11 }}
//                       />
//                     )}
//                     <Typography variant="caption" sx={{ display: "block", mt: 1, opacity: 0.7 }}>
//                       Timeline: {data.risk_domains?.mortality?.long_term?.timeline}
//                     </Typography>
//                   </CardContent>
//                 </Card>
//               </Box>
//             </Box>

//             {/* Morbidity Risk */}
//             <Box sx={{ mb: 3 }}>
//               <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
//                 Morbidity Risk
//               </Typography>
//               <Card
//                 sx={{
//                   background: `${getRiskColor(data.risk_domains?.morbidity?.probability)}10`,
//                   border: `1px solid ${getRiskColor(data.risk_domains?.morbidity?.probability)}`,
//                 }}
//               >
//                 <CardContent>
//                   <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
//                     <Chip
//                       label={`Probability: ${data.risk_domains?.morbidity?.probability?.toUpperCase()}`}
//                       sx={{
//                         background: getRiskColor(data.risk_domains?.morbidity?.probability),
//                         color: "#fff",
//                         fontWeight: 600,
//                       }}
//                     />
//                     <Chip
//                       label={`Severity: ${data.risk_domains?.morbidity?.severity_if_occurs}`}
//                       variant="outlined"
//                     />
//                   </Box>
//                   {data.risk_domains?.morbidity?.complications && (
//                     <Box>
//                       <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
//                         Potential Complications:
//                       </Typography>
//                       <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
//                         {data.risk_domains.morbidity.complications.map((comp, idx) => (
//                           <Chip key={idx} label={comp} size="small" />
//                         ))}
//                       </Box>
//                     </Box>
//                   )}
//                 </CardContent>
//               </Card>
//             </Box>

//             {/* Treatment Risk */}
//             <Box>
//               <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
//                 Treatment-Related Risk
//               </Typography>
//               <Card
//                 sx={{
//                   background: `${getRiskColor(data.risk_domains?.treatment_risk?.overall_level)}10`,
//                   border: `1px solid ${getRiskColor(data.risk_domains?.treatment_risk?.overall_level)}`,
//                 }}
//               >
//                 <CardContent>
//                   <Chip
//                     label={`Overall Level: ${data.risk_domains?.treatment_risk?.overall_level?.toUpperCase()}`}
//                     sx={{
//                       background: getRiskColor(data.risk_domains?.treatment_risk?.overall_level),
//                       color: "#fff",
//                       fontWeight: 600,
//                       mb: 2,
//                     }}
//                   />
//                   {data.risk_domains?.treatment_risk?.medication_adverse_effects?.length > 0 && (
//                     <Box sx={{ mb: 2 }}>
//                       <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
//                         Medication Adverse Effects:
//                       </Typography>
//                       <ul style={{ margin: 0, paddingLeft: 20 }}>
//                         {data.risk_domains.treatment_risk.medication_adverse_effects.map((effect, idx) => (
//                           <li key={idx}>
//                             <Typography variant="body2">{effect}</Typography>
//                           </li>
//                         ))}
//                       </ul>
//                     </Box>
//                   )}
//                   {data.risk_domains?.treatment_risk?.procedure_complications?.length > 0 && (
//                     <Box>
//                       <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
//                         Procedure Complications:
//                       </Typography>
//                       <ul style={{ margin: 0, paddingLeft: 20 }}>
//                         {data.risk_domains.treatment_risk.procedure_complications.map((comp, idx) => (
//                           <li key={idx}>
//                             <Typography variant="body2">{comp}</Typography>
//                           </li>
//                         ))}
//                       </ul>
//                     </Box>
//                   )}
//                 </CardContent>
//               </Card>
//             </Box>
//           </Box>

//           {/* Time-Sensitive Risks */}
//           {data.time_sensitive_risks && data.time_sensitive_risks.length > 0 && (
//             <Box sx={{ mb: 3 }}>
//               <Typography variant="subtitle2" sx={{ mb: 2, color: "#fa709a", fontWeight: 600 }}>
//                 Time-Sensitive Risks
//               </Typography>
//               <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
//                 {data.time_sensitive_risks.map((risk, idx) => (
//                   <Card
//                     key={idx}
//                     sx={{
//                       background:
//                         risk.urgency === "immediate"
//                           ? "rgba(211, 47, 47, 0.1)"
//                           : risk.urgency === "urgent"
//                           ? "rgba(255, 152, 0, 0.1)"
//                           : "rgba(33, 150, 243, 0.1)",
//                       border: `2px solid ${
//                         risk.urgency === "immediate"
//                           ? "#d32f2f"
//                           : risk.urgency === "urgent"
//                           ? "#ff9800"
//                           : "#2196f3"
//                       }`,
//                     }}
//                   >
//                     <CardContent>
//                       <Box sx={{ display: "flex", justifyContent: "between", alignItems: "flex-start", mb: 1 }}>
//                         <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
//                           {risk.risk}
//                         </Typography>
//                         <Chip
//                           label={risk.urgency?.toUpperCase()}
//                           size="small"
//                           color={
//                             risk.urgency === "immediate"
//                               ? "error"
//                               : risk.urgency === "urgent"
//                               ? "warning"
//                               : "info"
//                           }
//                           sx={{ fontWeight: 600 }}
//                         />
//                       </Box>
//                       <Typography variant="caption" sx={{ display: "block", opacity: 0.7, mb: 1 }}>
//                         Timeline: {risk.timeline}
//                       </Typography>
//                       <Typography variant="body2" sx={{ color: "#4caf50", fontWeight: 600 }}>
//                         Mitigation: {risk.mitigation}
//                       </Typography>
//                     </CardContent>
//                   </Card>
//                 ))}
//               </Box>
//             </Box>
//           )}

//           {/* Risk Mitigation Priority */}
//           <Box>
//             <Typography variant="subtitle2" sx={{ mb: 2, color: "#fa709a", fontWeight: 600 }}>
//               Risk Mitigation Priorities
//             </Typography>
//             <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
//               {data.risk_mitigation_priority
//                 ?.sort((a, b) => a.priority - b.priority)
//                 .map((item, idx) => (
//                   <Card
//                     key={idx}
//                     sx={{
//                       background: "rgba(250, 112, 154, 0.05)",
//                       border: "1px solid rgba(250, 112, 154, 0.2)",
//                       position: "relative",
//                       overflow: "visible",
//                     }}
//                   >
//                     <Box
//                       sx={{
//                         position: "absolute",
//                         top: -12,
//                         left: 20,
//                         width: 36,
//                         height: 36,
//                         borderRadius: "50%",
//                         background: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
//                         display: "flex",
//                         alignItems: "center",
//                         justifyContent: "center",
//                         color: "#fff",
//                         fontWeight: 600,
//                         fontSize: 16,
//                         boxShadow: "0 4px 12px rgba(250, 112, 154, 0.4)",
//                       }}
//                     >
//                       {item.priority}
//                     </Box>
//                     <CardContent sx={{ pt: 3 }}>
//                       <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
//                         {item.risk}
//                       </Typography>
//                       <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
//                         <strong>Intervention:</strong> {item.intervention}
//                       </Typography>
//                       <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
//                         <Chip
//                           label={`Risk Reduction: ${item.risk_reduction}`}
//                           size="small"
//                           color={
//                             item.risk_reduction === "major"
//                               ? "success"
//                               : item.risk_reduction === "moderate"
//                               ? "warning"
//                               : "default"
//                           }
//                         />
//                         <Chip
//                           label={`Feasibility: ${item.feasibility}`}
//                           size="small"
//                           color={
//                             item.feasibility === "easy"
//                               ? "success"
//                               : item.feasibility === "moderate"
//                               ? "warning"
//                               : "error"
//                           }
//                         />
//                       </Box>
//                     </CardContent>
//                   </Card>
//                 ))}
//             </Box>
//           </Box>
//         </AccordionDetails>
//       </Accordion>
//     </motion.div>
//   );
// };

// =====================================================================
// TREATMENT VALIDATION PANEL
// =====================================================================

const TreatmentValidationPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  const getValidityColor = (status) => {
    const colors = {
      appropriate: "#4caf50",
      questionable: "#ff9800",
      inappropriate: "#f44336",
    };
    return colors[status] || "#9e9e9e";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
    >
      <Accordion sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#333",
              }}
            >
              <MedicationRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Treatment Validation & Appropriateness
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Evidence-based treatment assessment and guideline alignment
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              {data.requires_expert_review && (
                <Chip
                  icon={<InfoRounded />}
                  label="Expert Review"
                  color="info"
                  size="small"
                />
              )}
              <Chip
                label={data.overall_validity?.status?.toUpperCase() || "Unknown"}
                size="small"
                sx={{
                  background: `${getValidityColor(data.overall_validity?.status)}20`,
                  color: getValidityColor(data.overall_validity?.status),
                  fontWeight: 600,
                }}
              />
            </Box>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Overall Validity Summary */}
          <Box
            sx={{
              mb: 3,
              p: 3,
              borderRadius: 3,
              background: `linear-gradient(135deg, ${getValidityColor(data.overall_validity?.status)}15 0%, ${getValidityColor(data.overall_validity?.status)}05 100%)`,
              border: `2px solid ${getValidityColor(data.overall_validity?.status)}`,
            }}
          >
            <Typography
              variant="h5"
              sx={{
                fontWeight: 600,
                color: getValidityColor(data.overall_validity?.status),
                mb: 1,
              }}
            >
              {data.overall_validity?.status?.toUpperCase()} TREATMENT PLAN
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, mb: 2 }}>
              {data.overall_validity?.summary}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={data.overall_validity?.confidence * 100}
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: "rgba(0,0,0,0.1)",
                "& .MuiLinearProgress-bar": {
                  background: `linear-gradient(90deg, ${getValidityColor(data.overall_validity?.status)} 0%, ${getValidityColor(data.overall_validity?.status)}80 100%)`,
                },
              }}
            />
            <Typography variant="caption" sx={{ mt: 0.5, opacity: 0.7 }}>
              Confidence: {(data.overall_validity?.confidence * 100).toFixed(0)}%
            </Typography>
          </Box>

          {/* Red Flags */}
          {data.red_flags && data.red_flags.length > 0 && (
            <Alert severity="error" sx={{ mb: 3 }}>
              <AlertTitle sx={{ fontWeight: 600 }}>⚠️ Treatment Red Flags</AlertTitle>
              <Box sx={{ mt: 1 }}>
                {data.red_flags.map((flag, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      py: 1,
                      px: 2,
                      mb: 1,
                      borderRadius: 2,
                      background: "rgba(211, 47, 47, 0.1)",
                      border: "1px solid rgba(211, 47, 47, 0.3)",
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {flag}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Alert>
          )}

          {/* Guideline Alignment */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, color: "#a8edea", fontWeight: 600 }}>
              Guideline Alignment
            </Typography>
            <Card
              sx={{
                background: "rgba(168, 237, 234, 0.1)",
                border: "1px solid rgba(168, 237, 234, 0.3)",
              }}
            >
              <CardContent>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                    Applicable Guidelines
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {data.guideline_alignment?.applicable_guidelines?.map((guideline, idx) => (
                      <Chip
                        key={idx}
                        label={guideline}
                        size="small"
                        sx={{
                          background: "rgba(168, 237, 234, 0.2)",
                          border: "1px solid rgba(168, 237, 234, 0.5)",
                        }}
                      />
                    ))}
                  </Box>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                    Alignment Score
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={data.guideline_alignment?.alignment_score * 100}
                    sx={{
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: "rgba(0,0,0,0.1)",
                      "& .MuiLinearProgress-bar": {
                        background: "linear-gradient(90deg, #a8edea 0%, #fed6e3 100%)",
                      },
                    }}
                  />
                  <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                    {(data.guideline_alignment?.alignment_score * 100).toFixed(0)}% Aligned
                  </Typography>
                </Box>

                {data.guideline_alignment?.deviations &&
                  data.guideline_alignment.deviations.length > 0 && (
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Guideline Deviations
                      </Typography>
                      {data.guideline_alignment.deviations.map((deviation, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            mb: 1.5,
                            p: 1.5,
                            borderRadius: 2,
                            background:
                              deviation.justification === "unjustified"
                                ? "rgba(244, 67, 54, 0.1)"
                                : deviation.justification === "questionable"
                                ? "rgba(255, 152, 0, 0.1)"
                                : "rgba(76, 175, 80, 0.1)",
                            border: `1px solid ${
                              deviation.justification === "unjustified"
                                ? "#f44336"
                                : deviation.justification === "questionable"
                                ? "#ff9800"
                                : "#4caf50"
                            }`,
                          }}
                        >
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {deviation.deviation}
                            </Typography>
                            <Chip
                              label={deviation.justification}
                              size="small"
                              color={
                                deviation.justification === "unjustified"
                                  ? "error"
                                  : deviation.justification === "questionable"
                                  ? "warning"
                                  : "success"
                              }
                              sx={{ height: 22 }}
                            />
                          </Box>
                          <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            {deviation.rationale}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
              </CardContent>
            </Card>
          </Box>

          {/* Pharmacological Treatment */}
          {data.treatment_appropriateness?.pharmacological &&
            data.treatment_appropriateness.pharmacological.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 2, color: "#a8edea", fontWeight: 600 }}>
                  Pharmacological Treatment Assessment
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {data.treatment_appropriateness.pharmacological.map((drug, idx) => (
                    <Card
                      key={idx}
                      sx={{
                        background: `${getValidityColor(drug.appropriateness)}08`,
                        border: `1px solid ${getValidityColor(drug.appropriateness)}40`,
                      }}
                    >
                      <CardContent>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            mb: 2,
                          }}
                        >
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {drug.drug}
                          </Typography>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Chip
                              label={drug.appropriateness}
                              size="small"
                              sx={{
                                background: getValidityColor(drug.appropriateness),
                                color: "#fff",
                                fontWeight: 600,
                              }}
                            />
                            <Chip
                              label={`Dose: ${drug.dose_validation}`}
                              size="small"
                              color={
                                drug.dose_validation === "correct"
                                  ? "success"
                                  : drug.dose_validation === "needs_adjustment"
                                  ? "warning"
                                  : "error"
                              }
                            />
                          </Box>
                        </Box>

                        {drug.concerns && drug.concerns.length > 0 && (
                          <Box sx={{ mb: 2 }}>
                            <Typography
                              variant="caption"
                              sx={{ opacity: 0.7, display: "block", mb: 1 }}
                            >
                              Concerns:
                            </Typography>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {drug.concerns.map((concern, cIdx) => (
                                <li key={cIdx}>
                                  <Typography variant="body2">{concern}</Typography>
                                </li>
                              ))}
                            </ul>
                          </Box>
                        )}

                        {drug.recommendations && drug.recommendations.length > 0 && (
                          <Box
                            sx={{
                              p: 1.5,
                              borderRadius: 2,
                              background: "rgba(76, 175, 80, 0.1)",
                              border: "1px solid rgba(76, 175, 80, 0.3)",
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{ opacity: 0.7, display: "block", mb: 1, fontWeight: 600 }}
                            >
                              ✓ Recommendations:
                            </Typography>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {drug.recommendations.map((rec, rIdx) => (
                                <li key={rIdx}>
                                  <Typography variant="body2">{rec}</Typography>
                                </li>
                              ))}
                            </ul>
                          </Box>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Box>
            )}

          {/* Procedural Treatment */}
          {data.treatment_appropriateness?.procedural &&
            data.treatment_appropriateness.procedural.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 2, color: "#a8edea", fontWeight: 600 }}>
                  Procedural Treatment Assessment
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {data.treatment_appropriateness.procedural.map((proc, idx) => (
                    <Card
                      key={idx}
                      sx={{
                        background: "rgba(168, 237, 234, 0.05)",
                        border: "1px solid rgba(168, 237, 234, 0.3)",
                      }}
                    >
                      <CardContent>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            mb: 2,
                          }}
                        >
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {proc.procedure}
                          </Typography>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Chip
                              label={`Indication: ${proc.indication_strength}`}
                              size="small"
                              color={
                                proc.indication_strength === "strong"
                                  ? "success"
                                  : proc.indication_strength === "moderate"
                                  ? "warning"
                                  : "error"
                              }
                            />
                            <Chip
                              label={`Timing: ${proc.timing}`}
                              size="small"
                              variant="outlined"
                            />
                          </Box>
                        </Box>

                        {proc.concerns && proc.concerns.length > 0 && (
                          <Box sx={{ mb: 2 }}>
                            <Typography
                              variant="caption"
                              sx={{ opacity: 0.7, display: "block", mb: 1 }}
                            >
                              Concerns:
                            </Typography>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {proc.concerns.map((concern, cIdx) => (
                                <li key={cIdx}>
                                  <Typography variant="body2">{concern}</Typography>
                                </li>
                              ))}
                            </ul>
                          </Box>
                        )}

                        {proc.recommendations && proc.recommendations.length > 0 && (
                          <Box
                            sx={{
                              p: 1.5,
                              borderRadius: 2,
                              background: "rgba(76, 175, 80, 0.1)",
                              border: "1px solid rgba(76, 175, 80, 0.3)",
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{ opacity: 0.7, display: "block", mb: 1, fontWeight: 600 }}
                            >
                              ✓ Recommendations:
                            </Typography>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {proc.recommendations.map((rec, rIdx) => (
                                <li key={rIdx}>
                                  <Typography variant="body2">{rec}</Typography>
                                </li>
                              ))}
                            </ul>
                          </Box>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Box>
            )}

          {/* Missing Standard Treatments */}
          {data.missing_standard_treatments && data.missing_standard_treatments.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#ff9800", fontWeight: 600 }}>
                Missing Standard Treatments
              </Typography>
              <Alert severity="warning">
                <AlertTitle>Consider Adding These Treatments</AlertTitle>
                <Box sx={{ mt: 1 }}>
                  {data.missing_standard_treatments.map((treatment, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        mb: 1.5,
                        p: 1.5,
                        borderRadius: 2,
                        background: "rgba(255, 152, 0, 0.1)",
                        border: "1px solid rgba(255, 152, 0, 0.3)",
                      }}
                    >
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {treatment.treatment}
                        </Typography>
                        <Chip
                          label={treatment.importance}
                          size="small"
                          color={
                            treatment.importance === "critical"
                              ? "error"
                              : treatment.importance === "important"
                              ? "warning"
                              : "default"
                          }
                        />
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.8 }}>
                        {treatment.rationale}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Alert>
            </Box>
          )}

          {/* Over-treatment Concerns */}
          {data.over_treatment_concerns && data.over_treatment_concerns.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#f44336", fontWeight: 600 }}>
                Over-treatment Concerns
              </Typography>
              <Alert severity="error">
                <AlertTitle>Potential Over-treatment Identified</AlertTitle>
                <Box sx={{ mt: 1 }}>
                  {data.over_treatment_concerns.map((concern, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        mb: 1.5,
                        p: 1.5,
                        borderRadius: 2,
                        background: "rgba(244, 67, 54, 0.1)",
                        border: "1px solid rgba(244, 67, 54, 0.3)",
                      }}
                    >
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {concern.concern}
                        </Typography>
                        <Chip
                          label={concern.severity}
                          size="small"
                          color={
                            concern.severity === "major"
                              ? "error"
                              : concern.severity === "moderate"
                              ? "warning"
                              : "default"
                          }
                        />
                      </Box>
                      <Typography variant="caption" sx={{ display: "block", opacity: 0.8, mb: 1 }}>
                        Alternative: {concern.alternative}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Alert>
            </Box>
          )}

          {/* Alternative Approaches */}
          {data.alternative_approaches && data.alternative_approaches.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#a8edea", fontWeight: 600 }}>
                Alternative Treatment Approaches
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.alternative_approaches.map((approach, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background:
                        approach.appropriateness === "preferred"
                          ? "rgba(76, 175, 80, 0.1)"
                          : approach.appropriateness === "equivalent"
                          ? "rgba(33, 150, 243, 0.1)"
                          : "rgba(158, 158, 158, 0.1)",
                      border: `1px solid ${
                        approach.appropriateness === "preferred"
                          ? "#4caf50"
                          : approach.appropriateness === "equivalent"
                          ? "#2196f3"
                          : "#9e9e9e"
                      }`,
                    }}
                  >
                    <CardContent>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          mb: 2,
                        }}
                      >
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          {approach.approach}
                        </Typography>
                        <Chip
                          label={approach.appropriateness}
                          size="small"
                          color={
                            approach.appropriateness === "preferred"
                              ? "success"
                              : approach.appropriateness === "equivalent"
                              ? "info"
                              : "default"
                          }
                          sx={{ fontWeight: 600 }}
                        />
                      </Box>

                      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                        <Box>
                          <Typography
                            variant="caption"
                            sx={{ opacity: 0.7, display: "block", mb: 1 }}
                          >
                            Advantages:
                          </Typography>
                          <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {approach.advantages?.map((adv, aIdx) => (
                              <li key={aIdx}>
                                <Typography variant="body2" sx={{ color: "#4caf50" }}>
                                  {adv}
                                </Typography>
                              </li>
                            ))}
                          </ul>
                        </Box>

                        <Box>
                          <Typography
                            variant="caption"
                            sx={{ opacity: 0.7, display: "block", mb: 1 }}
                          >
                            Disadvantages:
                          </Typography>
                          <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {approach.disadvantages?.map((dis, dIdx) => (
                              <li key={dIdx}>
                                <Typography variant="body2" sx={{ color: "#f44336" }}>
                                  {dis}
                                </Typography>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// =====================================================================
// CONTRAINDICATION PANEL
// =====================================================================

const ContraindicationPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.6 }}
    >
      <Accordion sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <ShieldRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Safety & Contraindication Check
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Drug interactions, contraindications, and safety monitoring
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              {data.overall_safety_assessment?.requires_specialist_consultation && (
                <Chip icon={<WarningAmberRounded />} label="Specialist Needed" color="warning" size="small" />
              )}
              <Chip
                label={data.overall_safety_assessment?.safe_to_proceed ? "Safe" : "Caution"}
                size="small"
                color={data.overall_safety_assessment?.safe_to_proceed ? "success" : "error"}
                sx={{ fontWeight: 600 }}
              />
            </Box>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Critical Safety Alerts */}
          {data.critical_safety_alerts && data.critical_safety_alerts.length > 0 && (
            <Box sx={{ mb: 3 }}>
              {data.critical_safety_alerts.map((alert, idx) => (
                <Alert
                  key={idx}
                  severity={
                    alert.severity === "life_threatening" || alert.severity === "major"
                      ? "error"
                      : alert.severity === "moderate"
                      ? "warning"
                      : "info"
                  }
                  sx={{
                    mb: 2,
                    "& .MuiAlert-icon": { fontSize: 28 },
                    animation:
                      alert.severity === "life_threatening"
                        ? "pulse 1.5s infinite"
                        : "none",
                    "@keyframes pulse": {
                      "0%": { transform: "scale(1)" },
                      "50%": { transform: "scale(1.02)" },
                      "100%": { transform: "scale(1)" },
                    },
                  }}
                >
                  <AlertTitle sx={{ fontWeight: 600, fontSize: 16 }}>
                    {alert.severity === "life_threatening"
                      ? "🚨 LIFE-THREATENING"
                      : alert.severity === "major"
                      ? "⚠️ MAJOR ALERT"
                      : alert.severity === "moderate"
                      ? "⚠️ MODERATE ALERT"
                      : "ℹ️ MINOR ALERT"}
                  </AlertTitle>
                  <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                    {alert.alert}
                  </Typography>
                  <Box
                    sx={{
                      mt: 1.5,
                      p: 1.5,
                      borderRadius: 2,
                      background: "rgba(0, 0, 0, 0.05)",
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                      Immediate Action Required:
                    </Typography>
                    <Typography variant="body2">{alert.immediate_action}</Typography>
                  </Box>
                </Alert>
              ))}
            </Box>
          )}

          {/* Absolute Contraindications */}
          {data.absolute_contraindications && data.absolute_contraindications.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#f44336", fontWeight: 600 }}>
                Absolute Contraindications
              </Typography>
              <Alert severity="error" sx={{ mb: 2 }}>
                <AlertTitle>These treatments MUST NOT be used</AlertTitle>
              </Alert>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.absolute_contraindications.map((item, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background: "rgba(244, 67, 54, 0.1)",
                      border: "2px solid #f44336",
                    }}
                  >
                    <CardContent>
                      <Typography variant="h6" sx={{ fontWeight: 600, color: "#f44336", mb: 1 }}>
                        ✗ {item.medication_or_procedure}
                      </Typography>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                          Contraindication:
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {item.contraindication}
                        </Typography>
                      </Box>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                          Reason:
                        </Typography>
                        <Typography variant="body2">{item.reason}</Typography>
                      </Box>
                      {item.alternative && (
                        <Box
                          sx={{
                            p: 1.5,
                            borderRadius: 2,
                            background: "rgba(76, 175, 80, 0.1)",
                            border: "1px solid rgba(76, 175, 80, 0.3)",
                          }}
                        >
                          <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                            ✓ Recommended Alternative:
                          </Typography>
                          <Typography variant="body2" sx={{ color: "#4caf50", fontWeight: 600 }}>
                            {item.alternative}
                          </Typography>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Relative Contraindications */}
          {data.relative_contraindications && data.relative_contraindications.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#ff9800", fontWeight: 600 }}>
                Relative Contraindications
              </Typography>
              <Alert severity="warning" sx={{ mb: 2 }}>
                <AlertTitle>Use with caution - requires careful consideration</AlertTitle>
              </Alert>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.relative_contraindications.map((item, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background: "rgba(255, 152, 0, 0.08)",
                      border: `1px solid ${
                        item.severity === "major"
                          ? "#f44336"
                          : item.severity === "moderate"
                          ? "#ff9800"
                          : "#fbc02d"
                      }`,
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          {item.medication_or_procedure}
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <Chip
                            label={item.severity}
                            size="small"
                            color={
                              item.severity === "major"
                                ? "error"
                                : item.severity === "moderate"
                                ? "warning"
                                : "default"
                            }
                          />
                          <Chip
                            label={item.proceed}
                            size="small"
                            variant="outlined"
                            color={
                              item.proceed === "avoid"
                                ? "error"
                                : item.proceed === "consult_specialist"
                                ? "warning"
                                : "success"
                            }
                          />
                        </Box>
                      </Box>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                          Concern:
                        </Typography>
                        <Typography variant="body2">{item.concern}</Typography>
                      </Box>
                      <Box
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          background: "rgba(33, 150, 243, 0.1)",
                          border: "1px solid rgba(33, 150, 243, 0.3)",
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                          Mitigation Strategy:
                        </Typography>
                        <Typography variant="body2">{item.mitigation}</Typography>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Drug Interactions */}
          {data.drug_interactions && data.drug_interactions.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
                Drug-Drug Interactions
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.drug_interactions.map((interaction, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background:
                        interaction.interaction_severity === "contraindicated"
                          ? "rgba(244, 67, 54, 0.1)"
                          : interaction.interaction_severity === "major"
                          ? "rgba(255, 152, 0, 0.1)"
                          : interaction.interaction_severity === "moderate"
                          ? "rgba(255, 193, 7, 0.1)"
                          : "rgba(33, 150, 243, 0.1)",
                      border: `2px solid ${
                        interaction.interaction_severity === "contraindicated"
                          ? "#f44336"
                          : interaction.interaction_severity === "major"
                          ? "#ff9800"
                          : interaction.interaction_severity === "moderate"
                          ? "#ffc107"
                          : "#2196f3"
                      }`,
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          {interaction.drug_1} ⚡ {interaction.drug_2}
                        </Typography>
                        <Chip
                          label={interaction.interaction_severity?.toUpperCase()}
                          size="small"
                          sx={{
                            background:
                              interaction.interaction_severity === "contraindicated"
                                ? "#f44336"
                                : interaction.interaction_severity === "major"
                                ? "#ff9800"
                                : interaction.interaction_severity === "moderate"
                                ? "#ffc107"
                                : "#2196f3",
                            color: "#fff",
                            fontWeight: 600,
                          }}
                        />
                      </Box>

                      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}>
                        <Box>
                          <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                            Mechanism:
                          </Typography>
                          <Typography variant="body2">{interaction.mechanism}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                            Clinical Effect:
                          </Typography>
                          <Typography variant="body2">{interaction.clinical_effect}</Typography>
                        </Box>
                      </Box>

                      <Box
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          background:
                            interaction.management === "avoid"
                              ? "rgba(244, 67, 54, 0.1)"
                              : "rgba(76, 175, 80, 0.1)",
                          border: `1px solid ${
                            interaction.management === "avoid" ? "#f44336" : "#4caf50"
                          }`,
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                          Management: {interaction.management?.toUpperCase()}
                        </Typography>
                        {interaction.monitoring_required && interaction.monitoring_required.length > 0 && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                              Required Monitoring:
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                              {interaction.monitoring_required.map((mon, mIdx) => (
                                <Chip key={mIdx} label={mon} size="small" variant="outlined" />
                              ))}
                            </Box>
                          </Box>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Organ Dysfunction Concerns */}
          {data.organ_dysfunction_concerns && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
                Organ Function Considerations
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
                {/* Renal */}
                {data.organ_dysfunction_concerns.renal && data.organ_dysfunction_concerns.renal.length > 0 && (
                  <Card sx={{ background: "rgba(103, 58, 183, 0.05)", border: "1px solid rgba(103, 58, 183, 0.3)" }}>
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#673ab7" }}>
                        🫘 Renal Concerns
                      </Typography>
                      {data.organ_dysfunction_concerns.renal.map((item, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            mb: 2,
                            p: 1.5,
                            borderRadius: 2,
                            background: "rgba(255,255,255,0.5)",
                            border: "1px solid rgba(103, 58, 183, 0.2)",
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            {item.drug}
                          </Typography>
                          <Typography variant="caption" sx={{ display: "block", mb: 1, opacity: 0.8 }}>
                            {item.concern}
                          </Typography>
                          {item.dose_adjustment && (
                            <Chip label={`Dose: ${item.dose_adjustment}`} size="small" color="warning" />
                          )}
                          {item.monitoring && item.monitoring.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                Monitor: {item.monitoring.join(", ")}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Hepatic */}
                {data.organ_dysfunction_concerns.hepatic && data.organ_dysfunction_concerns.hepatic.length > 0 && (
                  <Card sx={{ background: "rgba(255, 87, 34, 0.05)", border: "1px solid rgba(255, 87, 34, 0.3)" }}>
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#ff5722" }}>
                        🫀 Hepatic Concerns
                      </Typography>
                      {data.organ_dysfunction_concerns.hepatic.map((item, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            mb: 2,
                            p: 1.5,
                            borderRadius: 2,
                            background: "rgba(255,255,255,0.5)",
                            border: "1px solid rgba(255, 87, 34, 0.2)",
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            {item.drug}
                          </Typography>
                          <Typography variant="caption" sx={{ display: "block", mb: 1, opacity: 0.8 }}>
                            {item.concern}
                          </Typography>
                          {item.dose_adjustment && (
                            <Chip label={`Dose: ${item.dose_adjustment}`} size="small" color="warning" />
                          )}
                          {item.monitoring && item.monitoring.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                Monitor: {item.monitoring.join(", ")}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Cardiac */}
                {data.organ_dysfunction_concerns.cardiac && data.organ_dysfunction_concerns.cardiac.length > 0 && (
                  <Card sx={{ background: "rgba(233, 30, 99, 0.05)", border: "1px solid rgba(233, 30, 99, 0.3)" }}>
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#e91e63" }}>
                        ❤️ Cardiac Concerns
                      </Typography>
                      {data.organ_dysfunction_concerns.cardiac.map((item, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            mb: 2,
                            p: 1.5,
                            borderRadius: 2,
                            background: "rgba(255,255,255,0.5)",
                            border: "1px solid rgba(233, 30, 99, 0.2)",
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            {item.drug}
                          </Typography>
                          <Typography variant="caption" sx={{ display: "block", mb: 1, opacity: 0.8 }}>
                            {item.concern}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "#e91e63", fontWeight: 600 }}>
                            {item.recommendation}
                          </Typography>
                        </Box>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </Box>
            </Box>
          )}

          {/* Monitoring Requirements */}
          {data.monitoring_requirements && data.monitoring_requirements.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#f093fb", fontWeight: 600 }}>
                Safety Monitoring Requirements
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.monitoring_requirements.map((req, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background: "rgba(240, 147, 251, 0.05)",
                      border: "1px solid rgba(240, 147, 251, 0.3)",
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 2 }}>
                        <Box>
                          <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                            Parameter
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {req.parameter}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                            Frequency
                          </Typography>
                          <Chip label={req.frequency} size="small" color="primary" />
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                            Safety Threshold
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: "#f44336" }}>
                            {req.safety_threshold}
                          </Typography>
                        </Box>
                      </Box>
                      <Box
                        sx={{
                          mt: 2,
                          p: 1.5,
                          borderRadius: 2,
                          background: "rgba(255, 152, 0, 0.1)",
                          border: "1px solid rgba(255, 152, 0, 0.3)",
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                          Action if Abnormal:
                        </Typography>
                        <Typography variant="body2">{req.action_if_abnormal}</Typography>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Safety Conditions */}
          {data.overall_safety_assessment?.conditions_for_safety &&
            data.overall_safety_assessment.conditions_for_safety.length > 0 && (
              <Alert severity="info" sx={{ mt: 3 }}>
                <AlertTitle>Conditions for Safe Treatment</AlertTitle>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {data.overall_safety_assessment.conditions_for_safety.map((condition, idx) => (
                    <li key={idx}>
                      <Typography variant="body2">{condition}</Typography>
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// =====================================================================
// FINAL RECOMMENDATION PANEL
// =====================================================================

const FinalRecommendationPanel = ({ data, liquidGlass }) => {
  if (!data) return null;

  const getUrgencyColor = (urgency) => {
    const colors = {
      emergent: "#d32f2f",
      urgent: "#f57c00",
      semi_urgent: "#fbc02d",
      routine: "#388e3c",
    };
    return colors[urgency] || "#757575";
  };

  const getTrajectoryColor = (trajectory) => {
    const colors = {
      improving: "#4caf50",
      stable: "#2196f3",
      deteriorating: "#f44336",
      critical: "#b71c1c",
    };
    return colors[trajectory] || "#757575";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.7 }}
    >
      <Accordion defaultExpanded sx={{ ...liquidGlass }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <CheckCircleRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                Final Clinical Recommendation
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Integrated decision support and action plan
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              {data.requires_human_review && (
                <Chip
                  icon={<InfoRounded />}
                  label="Human Review Required"
                  color="warning"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
              <Chip
                label={`${(data.evidence_confidence?.overall_confidence * 100).toFixed(0)}% Confidence`}
                size="small"
                sx={{
                  background: "rgba(102, 126, 234, 0.2)",
                  color: "#667eea",
                  fontWeight: 600,
                }}
              />
            </Box>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Executive Summary */}
          <Box
            sx={{
              mb: 4,
              p: 4,
              borderRadius: 4,
              background: "linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.05) 100%)",
              border: "2px solid rgba(102, 126, 234, 0.3)",
            }}
          >
            <Typography variant="h5" sx={{ fontWeight: 600, color: "#667eea", mb: 3 }}>
              Executive Summary
            </Typography>

            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 2, mb: 3 }}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  background: `${getUrgencyColor(data.executive_summary?.urgency)}15`,
                  border: `2px solid ${getUrgencyColor(data.executive_summary?.urgency)}`,
                }}
              >
                <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                  Urgency Level
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 600,
                    color: getUrgencyColor(data.executive_summary?.urgency),
                    textTransform: "uppercase",
                  }}
                >
                  {data.executive_summary?.urgency}
                </Typography>
              </Box>

              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  background: `${getTrajectoryColor(data.executive_summary?.trajectory)}15`,
                  border: `2px solid ${getTrajectoryColor(data.executive_summary?.trajectory)}`,
                }}
              >
                <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                  Clinical Trajectory
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 600,
                    color: getTrajectoryColor(data.executive_summary?.trajectory),
                    textTransform: "uppercase",
                  }}
                >
                  {data.executive_summary?.trajectory}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: "#667eea" }}>
                Patient Status
              </Typography>
              <Typography variant="body1" sx={{ lineHeight: 1.7 }}>
                {data.executive_summary?.patient_status}
              </Typography>
            </Box>

            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                background: "rgba(102, 126, 234, 0.1)",
                border: "1px solid rgba(102, 126, 234, 0.3)",
              }}
            >
              <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                Key Clinical Problem
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {data.executive_summary?.key_problem}
              </Typography>
            </Box>
          </Box>

          {/* Diagnostic Confidence */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
              Diagnostic Assessment
            </Typography>
            <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
              <CardContent>
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Primary Diagnosis
                    </Typography>
                    <Chip
                      label={`${(data.diagnostic_confidence?.confidence * 100).toFixed(0)}% Confidence`}
                      size="small"
                      color={
                        data.diagnostic_confidence?.confidence >= 0.8
                          ? "success"
                          : data.diagnostic_confidence?.confidence >= 0.6
                          ? "warning"
                          : "error"
                      }
                    />
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: "#667eea" }}>
                    {data.diagnostic_confidence?.primary_diagnosis}
                  </Typography>
                </Box>

                {data.diagnostic_confidence?.differential_diagnoses &&
                  data.diagnostic_confidence.differential_diagnoses.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Differential Diagnoses to Consider
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {data.diagnostic_confidence.differential_diagnoses.map((dx, idx) => (
                          <Chip key={idx} label={dx} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                {data.diagnostic_confidence?.confirmatory_tests_needed &&
                  data.diagnostic_confidence.confirmatory_tests_needed.length > 0 && (
                    <Alert severity="info" sx={{ mt: 2 }}>
                      <AlertTitle>Confirmatory Tests Needed</AlertTitle>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.diagnostic_confidence.confirmatory_tests_needed.map((test, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{test}</Typography>
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  )}
              </CardContent>
            </Card>
          </Box>

          {/* Treatment Recommendations */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
              Treatment Action Plan
            </Typography>

            {/* Immediate Actions */}
            {data.treatment_recommendations?.immediate_actions &&
              data.treatment_recommendations.immediate_actions.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#f44336" }}>
                    🚨 Immediate Actions (Next 24 Hours)
                  </Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {data.treatment_recommendations.immediate_actions
                      .sort((a, b) => b.priority - a.priority)
                      .map((action, idx) => (
                        <Card
                          key={idx}
                          sx={{
                            background: "rgba(244, 67, 54, 0.08)",
                            border: "2px solid #f44336",
                            position: "relative",
                            overflow: "visible",
                          }}
                        >
                          <Box
                            sx={{
                              position: "absolute",
                              top: -12,
                              left: 20,
                              width: 36,
                              height: 36,
                              borderRadius: "50%",
                              background: "linear-gradient(135deg, #f44336 0%, #e91e63 100%)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: 16,
                              boxShadow: "0 4px 12px rgba(244, 67, 54, 0.4)",
                            }}
                          >
                            {action.priority}
                          </Box>
                          <CardContent sx={{ pt: 3 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                              {action.action}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
                              {action.rationale}
                            </Typography>
                            <Chip
                              label={`Evidence: ${action.evidence_strength}`}
                              size="small"
                              color={
                                action.evidence_strength === "strong"
                                  ? "success"
                                  : action.evidence_strength === "moderate"
                                  ? "warning"
                                  : "default"
                              }
                            />
                          </CardContent>
                        </Card>
                      ))}
                  </Box>
                </Box>
              )}

            {/* Priority Categories */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2, mb: 3 }}>
              {/* Must Do */}
              {data.treatment_recommendations?.must_do && data.treatment_recommendations.must_do.length > 0 && (
                <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#4caf50" }}>
                      ✓ MUST DO
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.must_do.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 8 }}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Should Do */}
              {data.treatment_recommendations?.should_do && data.treatment_recommendations.should_do.length > 0 && (
                <Card sx={{ background: "rgba(33, 150, 243, 0.05)", border: "1px solid rgba(33, 150, 243, 0.3)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#2196f3" }}>
                      → SHOULD DO
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.should_do.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 8 }}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Consider */}
              {data.treatment_recommendations?.consider && data.treatment_recommendations.consider.length > 0 && (
                <Card sx={{ background: "rgba(158, 158, 158, 0.05)", border: "1px solid rgba(158, 158, 158, 0.3)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#9e9e9e" }}>
                      ? CONSIDER
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.consider.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 8 }}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Avoid */}
              {data.treatment_recommendations?.avoid && data.treatment_recommendations.avoid.length > 0 && (
                <Card sx={{ background: "rgba(244, 67, 54, 0.05)", border: "1px solid rgba(244, 67, 54, 0.3)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2, color: "#f44336" }}>
                      ✗ AVOID
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.avoid.map((item, idx) => (
                        <li key={idx} style={{ marginBottom: 8 }}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </Box>

            {/* Timeline Plans */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {data.treatment_recommendations?.short_term_plan && (
                <Card sx={{ background: "rgba(33, 150, 243, 0.05)", border: "1px solid rgba(33, 150, 243, 0.2)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: "#2196f3" }}>
                      Short-term Plan (This Week)
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.short_term_plan.map((item, idx) => (
                        <li key={idx}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {data.treatment_recommendations?.medium_term_plan && (
                <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: "#667eea" }}>
                      Medium-term Plan (This Month)
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.medium_term_plan.map((item, idx) => (
                        <li key={idx}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {data.treatment_recommendations?.long_term_strategy && (
                <Card sx={{ background: "rgba(156, 39, 176, 0.05)", border: "1px solid rgba(156, 39, 176, 0.2)" }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: "#9c27b0" }}>
                      Long-term Strategy
                    </Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {data.treatment_recommendations.long_term_strategy.map((item, idx) => (
                        <li key={idx}>
                          <Typography variant="body2">{item}</Typography>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </Box>
          </Box>

          {/* Safety Priorities */}
          {data.safety_priorities && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
                Safety Monitoring Priorities
              </Typography>
              <Card
                sx={{
                  background: "rgba(255, 152, 0, 0.05)",
                  border: "1px solid rgba(255, 152, 0, 0.3)",
                }}
              >
                <CardContent>
                  {data.safety_priorities.critical_concerns &&
                    data.safety_priorities.critical_concerns.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: "#f44336" }}>
                          Critical Concerns
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                          {data.safety_priorities.critical_concerns.map((concern, idx) => (
                            <Chip key={idx} label={concern} size="small" color="error" />
                          ))}
                        </Box>
                      </Box>
                    )}

                  {data.safety_priorities.monitoring_priorities &&
                    data.safety_priorities.monitoring_priorities.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                          Monitoring Schedule
                        </Typography>
                        {data.safety_priorities.monitoring_priorities.map((mon, idx) => (
                          <Box
                            key={idx}
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              py: 1,
                              borderBottom: "1px solid rgba(0,0,0,0.05)",
                            }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {mon.parameter}
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1 }}>
                              <Chip label={mon.frequency} size="small" />
                              <Typography variant="caption" sx={{ alignSelf: "center", opacity: 0.7 }}>
                                Alert at: {mon.action_threshold}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    )}

                  {data.safety_priorities.red_flags && data.safety_priorities.red_flags.length > 0 && (
                    <Alert severity="error">
                      <AlertTitle>Red Flags - Escalate Immediately</AlertTitle>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.safety_priorities.red_flags.map((flag, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{flag}</Typography>
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Outcome Optimization */}
          {data.outcome_optimization?.highest_yield_interventions &&
            data.outcome_optimization.highest_yield_interventions.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
                  Highest-Yield Interventions
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {data.outcome_optimization.highest_yield_interventions
                    .sort((a, b) => b.priority - a.priority)
                    .map((intervention, idx) => (
                      <Card
                        key={idx}
                        sx={{
                          background: "rgba(76, 175, 80, 0.05)",
                          border: "1px solid rgba(76, 175, 80, 0.3)",
                          position: "relative",
                          overflow: "visible",
                        }}
                      >
                        <Box
                          sx={{
                            position: "absolute",
                            top: -12,
                            left: 20,
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #4caf50 0%, #8bc34a 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontWeight: 600,
                            fontSize: 16,
                            boxShadow: "0 4px 12px rgba(76, 175, 80, 0.4)",
                          }}
                        >
                          {intervention.priority}
                        </Box>
                        <CardContent sx={{ pt: 3 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                            {intervention.intervention}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
                            Expected Benefit: {intervention.expected_benefit}
                          </Typography>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Chip
                              label={`Feasibility: ${intervention.feasibility}`}
                              size="small"
                              color={
                                intervention.feasibility === "easy"
                                  ? "success"
                                  : intervention.feasibility === "moderate"
                                  ? "warning"
                                  : "error"
                              }
                            />
                            <Chip label={`Timeline: ${intervention.timeline}`} size="small" variant="outlined" />
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                </Box>
              </Box>
            )}

          {/* Follow-up Strategy */}
          {data.follow_up_strategy && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
                Follow-up Strategy
              </Typography>
              <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
                <CardContent>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.5 }}>
                      Next Assessment
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: "#667eea" }}>
                      {data.follow_up_strategy.next_assessment}
                    </Typography>
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Success Criteria
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.follow_up_strategy.success_criteria?.map((criterion, idx) => (
                          <li key={idx}>
                            <Typography variant="body2" sx={{ color: "#4caf50" }}>
                              {criterion}
                            </Typography>
                          </li>
                        ))}
                      </ul>
                    </Box>

                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Failure Criteria (Reassess)
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.follow_up_strategy.failure_criteria?.map((criterion, idx) => (
                          <li key={idx}>
                            <Typography variant="body2" sx={{ color: "#f44336" }}>
                              {criterion}
                            </Typography>
                          </li>
                        ))}
                      </ul>
                    </Box>
                  </Box>

                  {data.follow_up_strategy.parameters_to_track && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Parameters to Track
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {data.follow_up_strategy.parameters_to_track.map((param, idx) => (
                          <Chip key={idx} label={param} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Specialist Consultations */}
          {data.consultation_needs && data.consultation_needs.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
                Specialist Consultations Required
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.consultation_needs.map((consult, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background:
                        consult.urgency === "emergent"
                          ? "rgba(244, 67, 54, 0.1)"
                          : consult.urgency === "urgent"
                          ? "rgba(255, 152, 0, 0.1)"
                          : "rgba(33, 150, 243, 0.1)",
                      border: `1px solid ${
                        consult.urgency === "emergent"
                          ? "#f44336"
                          : consult.urgency === "urgent"
                          ? "#ff9800"
                          : "#2196f3"
                      }`,
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          {consult.specialty}
                        </Typography>
                        <Chip
                          label={consult.urgency?.toUpperCase()}
                          size="small"
                          color={
                            consult.urgency === "emergent"
                              ? "error"
                              : consult.urgency === "urgent"
                              ? "warning"
                              : "info"
                          }
                          sx={{ fontWeight: 600 }}
                        />
                      </Box>
                      {consult.specific_questions && consult.specific_questions.length > 0 && (
                        <Box>
                          <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                            Specific Questions for Specialist:
                          </Typography>
                          <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {consult.specific_questions.map((question, qIdx) => (
                              <li key={qIdx}>
                                <Typography variant="body2">{question}</Typography>
                              </li>
                            ))}
                          </ul>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Evidence Confidence & Uncertainty */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
              Evidence & Confidence Assessment
            </Typography>
            <Card sx={{ background: "rgba(102, 126, 234, 0.05)", border: "1px solid rgba(102, 126, 234, 0.2)" }}>
              <CardContent>
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                    Overall Confidence
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={data.evidence_confidence?.overall_confidence * 100}
                    sx={{
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: "rgba(0,0,0,0.1)",
                      "& .MuiLinearProgress-bar": {
                        background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
                      },
                    }}
                  />
                  <Typography variant="h6" sx={{ mt: 1, fontWeight: 600 }}>
                    {(data.evidence_confidence?.overall_confidence * 100).toFixed(0)}%
                  </Typography>
                </Box>

                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                      High Certainty Areas
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {data.evidence_confidence?.high_certainty_areas?.map((area, idx) => (
                        <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <CheckCircleRounded sx={{ fontSize: 16, color: "#4caf50" }} />
                          <Typography variant="body2">{area}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>

                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                      Uncertainty Areas
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {data.evidence_confidence?.uncertainty_areas?.map((area, idx) => (
                        <Box key={idx} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <ErrorRounded sx={{ fontSize: 16, color: "#ff9800" }} />
                          <Typography variant="body2">{area}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>

                {data.evidence_confidence?.knowledge_gaps &&
                  data.evidence_confidence.knowledge_gaps.length > 0 && (
                    <Alert severity="info" sx={{ mt: 2 }}>
                      <AlertTitle>Knowledge Gaps</AlertTitle>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {data.evidence_confidence.knowledge_gaps.map((gap, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{gap}</Typography>
                          </li>
                        ))}
                      </ul>
                    </Alert>
                  )}
              </CardContent>
            </Card>
          </Box>

          {/* Conflicts & Resolutions */}
          {data.conflicts_and_resolutions && data.conflicts_and_resolutions.length > 0 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: "#667eea" }}>
                Clinical Reasoning Conflicts & Resolutions
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.conflicts_and_resolutions.map((item, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background: "rgba(255, 152, 0, 0.05)",
                      border: "1px solid rgba(255, 152, 0, 0.3)",
                    }}
                  >
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: "#ff9800" }}>
                        ⚠️ Conflict: {item.conflict}
                      </Typography>
                      <Box
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          background: "rgba(76, 175, 80, 0.1)",
                          border: "1px solid rgba(76, 175, 80, 0.3)",
                          mb: 1,
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                          ✓ Resolution:
                        </Typography>
                        <Typography variant="body2">{item.resolution}</Typography>
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        Rationale: {item.rationale}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Review Requirement */}
          {data.requires_human_review && (
            <Alert severity="warning" sx={{ mt: 3 }}>
              <AlertTitle sx={{ fontWeight: 600 }}>Human Review Required</AlertTitle>
              <Typography variant="body2">{data.review_rationale}</Typography>
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

// Export the main dashboard component
export default ClinicalReasoningDashboard;



