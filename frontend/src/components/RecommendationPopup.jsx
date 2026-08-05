// RecommendationPopup.jsx
import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  CircularProgress,
  Avatar,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,  // Make sure IconButton is imported
  LinearProgress
} from "@mui/material";
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  LocalHospital as LocalHospitalIcon,
  Person as PersonIcon,
  Science as ScienceIcon,
  Description as DescriptionIcon,
  ThumbUp as ThumbUpIcon,
  MedicalServices as MedicalServicesIcon,
  AutoAwesome as AutoAwesomeIcon,  // Add this for the loading state
} from "@mui/icons-material";

const FONT = '"Open Sans", sans-serif';
const brandGradient = "linear-gradient(135deg, #0ddcd5ff 0%, #0a88a7ff 50%, #04eb83ff 100%)";

const RecommendationPopup = ({ 
  open, 
  onClose, 
  recommendationData, 
  onAccept, 
  onReject, 
  loading,
  isGenerating = false  // Add isGenerating prop with default false
}) => {
  const [expandedSection, setExpandedSection] = useState("clinical_context");

  const handleAccept = () => {
    if (recommendationData?.tumor_board_report?.final_recommendation) {
      onAccept(recommendationData.tumor_board_report.final_recommendation);
    }
  };

  // Show loading state while generating recommendation
  if (isGenerating) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 4,
            background: "#ffffff",
          },
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: "1px solid #e0e0e0", 
          p: 2.5,
          background: "linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%)",
        }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Avatar sx={{ background: brandGradient, width: 40, height: 40 }}>
                <AutoAwesomeIcon />
              </Avatar>
              <Box>
                <Typography sx={{ fontSize: 20, fontWeight: 600, fontFamily: FONT, color: "#1a1a1a" }}>
                  Generating AI Recommendation
                </Typography>
                <Typography sx={{ fontSize: 12, color: "#666", fontFamily: FONT }}>
                  Please wait while we analyze the case...
                </Typography>
              </Box>
            </Box>
            <IconButton onClick={onClose} size="small" disabled>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 4, textAlign: "center" }}>
          <Box sx={{ py: 4 }}>
            <CircularProgress 
              size={60} 
              sx={{ 
                color: brandGradient,
                mb: 3
              }} 
            />
            <Typography sx={{ fontSize: 16, fontWeight: 500, fontFamily: FONT, mb: 1, color: "#1a1a1a" }}>
              Analyzing Patient Data
            </Typography>
            <Typography sx={{ fontSize: 13, color: "#666", fontFamily: FONT, mb: 3 }}>
              Our AI is reviewing clinical information, biomarkers, and treatment guidelines...
            </Typography>
            <Box sx={{ width: "100%", mb: 3 }}>
              <LinearProgress 
                sx={{ 
                  borderRadius: 2,
                  height: 4,
                  backgroundColor: "#e0e0e0",
                  '& .MuiLinearProgress-bar': {
                    background: brandGradient,
                    borderRadius: 2,
                  }
                }} 
              />
            </Box>
            <Box sx={{ display: "flex", gap: 2, justifyContent: "center", mt: 2 }}>
              <Box sx={{ textAlign: "center" }}>
                <Typography sx={{ fontSize: 11, color: "#999", fontFamily: FONT }}>Clinical Context</Typography>
                <CircularProgress size={20} sx={{ color: "#0ddcd5", mt: 0.5 }} />
              </Box>
              <Box sx={{ textAlign: "center" }}>
                <Typography sx={{ fontSize: 11, color: "#999", fontFamily: FONT }}>Treatment Options</Typography>
                <CircularProgress size={20} sx={{ color: "#0a88a7", mt: 0.5 }} />
              </Box>
              <Box sx={{ textAlign: "center" }}>
                <Typography sx={{ fontSize: 11, color: "#999", fontFamily: FONT }}>Guideline Alignment</Typography>
                <CircularProgress size={20} sx={{ color: "#04eb83", mt: 0.5 }} />
              </Box>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  // Don't render if no data
  if (!recommendationData?.tumor_board_report) return null;

  const report = recommendationData.tumor_board_report;
  const clinicalContext = report.clinical_context;
  const doctorOpinion = report.doctor_opinion;
  const mdtConsensus = report.mdt_consensus;
  const validation = report.validation;

  const getConfidenceColor = (score) => {
    if (score >= 0.8) return "#4caf50";
    if (score >= 0.6) return "#ff9800";
    return "#f44336";
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 4,
          maxHeight: "90vh",
          background: "#ffffff",
        },
      }}
    >
      <DialogTitle sx={{ 
        borderBottom: "1px solid #e0e0e0", 
        p: 2.5,
        background: "linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%)",
      }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ background: brandGradient, width: 40, height: 40 }}>
              <MedicalServicesIcon />
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: 20, fontWeight: 600, fontFamily: FONT, color: "#1a1a1a" }}>
                AI Tumor Board Recommendation
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#666", fontFamily: FONT }}>
                Generated for {recommendationData.requesting_specialty || "Oncology"} Specialist
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} size="small" disabled={loading}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 3, overflowY: "auto" }}>
        {/* Patient Info Header */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 3,
            background: "linear-gradient(135deg, #667eea08 0%, #764ba208 100%)",
            borderRadius: 3,
            border: "1px solid rgba(102, 126, 234, 0.1)",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <PersonIcon sx={{ fontSize: 18, color: "#667eea" }} />
              <Typography sx={{ fontSize: 14, fontFamily: FONT, color: "#1a1a1a" }}>
                {report.patient_age} y/o {report.patient_sex}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LocalHospitalIcon sx={{ fontSize: 18, color: "#667eea" }} />
              <Typography sx={{ fontSize: 14, fontFamily: FONT, color: "#1a1a1a" }}>
                {clinicalContext.primary_diagnosis || "Diagnosis Pending"}
              </Typography>
            </Box>
            {report.confidence_score && (
              <Chip
                icon={<ThumbUpIcon sx={{ fontSize: 14 }} />}
                label={`Confidence: ${Math.round(report.confidence_score * 100)}%`}
                size="small"
                sx={{
                  background: getConfidenceColor(report.confidence_score),
                  color: "#fff",
                  fontFamily: FONT,
                }}
              />
            )}
          </Box>
        </Paper>

        {/* Warnings Section */}
        {report.warnings && report.warnings.length > 0 && (
          <Alert 
            severity="warning" 
            sx={{ mb: 3, borderRadius: 2 }}
            icon={<WarningIcon />}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 1 }}>
              Critical Warnings
            </Typography>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {report.warnings.map((warning, idx) => (
                <li key={idx}>
                  <Typography sx={{ fontSize: 12 }}>{warning}</Typography>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {/* Validation Flags */}
        {validation?.flags && validation.flags.length > 0 && (
          <Alert 
            severity="info" 
            sx={{ mb: 3, borderRadius: 2 }}
            icon={<InfoIcon />}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 1 }}>
              Clinical Flags
            </Typography>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {validation.flags.map((flag, idx) => (
                <li key={idx}>
                  <Typography sx={{ fontSize: 12 }}>{flag}</Typography>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {/* Accordion Sections */}
        <Accordion 
          expanded={expandedSection === "clinical_context"} 
          onChange={() => setExpandedSection(expandedSection === "clinical_context" ? null : "clinical_context")}
          sx={{ mb: 2, borderRadius: 2, "&:before": { display: "none" } }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <DescriptionIcon sx={{ color: "#667eea" }} />
              <Typography sx={{ fontWeight: 600, fontFamily: FONT }}>Clinical Context</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography sx={{ fontSize: 14, fontFamily: FONT, mb: 2, lineHeight: 1.6 }}>
              {clinicalContext.clinical_summary_text}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: FONT, mb: 1 }}>
              Critical Findings:
            </Typography>
            <List dense>
              {clinicalContext.critical_findings?.map((finding, idx) => (
                <ListItem key={idx}>
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <InfoIcon sx={{ fontSize: 16, color: "#ff9800" }} />
                  </ListItemIcon>
                  <ListItemText primary={finding} />
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>

        <Accordion 
          expanded={expandedSection === "doctor_opinion"} 
          onChange={() => setExpandedSection(expandedSection === "doctor_opinion" ? null : "doctor_opinion")}
          sx={{ mb: 2, borderRadius: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MedicalServicesIcon sx={{ color: "#667eea" }} />
              <Typography sx={{ fontWeight: 600, fontFamily: FONT }}>Specialist Opinion</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography sx={{ fontSize: 14, fontFamily: FONT, mb: 2, lineHeight: 1.6 }}>
              {doctorOpinion?.clinical_position}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: FONT, mb: 1 }}>
              Key Actions:
            </Typography>
            <List dense>
              {doctorOpinion?.key_actions?.map((action, idx) => (
                <ListItem key={idx}>
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <CheckCircleIcon sx={{ fontSize: 16, color: "#4caf50" }} />
                  </ListItemIcon>
                  <ListItemText primary={action} />
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>

        <Accordion 
          expanded={expandedSection === "mdt_consensus"} 
          onChange={() => setExpandedSection(expandedSection === "mdt_consensus" ? null : "mdt_consensus")}
          sx={{ mb: 2, borderRadius: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <ScienceIcon sx={{ color: "#667eea" }} />
              <Typography sx={{ fontWeight: 600, fontFamily: FONT }}>MDT Consensus</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Chip 
              label={`Consensus: ${mdtConsensus?.consensus_status || "Pending"}`}
              size="small"
              sx={{ mb: 2, background: "#e3f2fd", color: "#1976d2" }}
            />
            <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: FONT, mb: 1 }}>
              Agreed Actions:
            </Typography>
            <List dense>
              {mdtConsensus?.agreed_actions?.map((action, idx) => (
                <ListItem key={idx}>
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <CheckCircleIcon sx={{ fontSize: 16, color: "#4caf50" }} />
                  </ListItemIcon>
                  <ListItemText primary={action} />
                </ListItem>
              ))}
            </List>
            {mdtConsensus?.chairperson_summary && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: FONT, mb: 1 }}>
                  Chairperson Summary:
                </Typography>
                <Typography sx={{ fontSize: 13, fontFamily: FONT, fontStyle: "italic", color: "#666" }}>
                  {mdtConsensus.chairperson_summary}
                </Typography>
              </>
            )}
          </AccordionDetails>
        </Accordion>

        {/* Final Recommendation Section */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            mt: 2,
            background: "linear-gradient(135deg, #0ddcd508 0%, #0a88a708 100%)",
            borderRadius: 3,
            border: "1px solid rgba(13, 220, 213, 0.2)",
          }}
        >
          <Typography sx={{ fontSize: 16, fontWeight: 600, fontFamily: FONT, mb: 1.5, color: "#0a88a7" }}>
            Final Recommendation
          </Typography>
          <Typography sx={{ fontSize: 14, fontFamily: FONT, lineHeight: 1.7 }}>
            {report.final_recommendation}
          </Typography>
        </Paper>
      </DialogContent>

      <DialogActions sx={{ p: 2.5, borderTop: "1px solid #e0e0e0", gap: 2 }}>
        <Button
          variant="outlined"
          onClick={onReject}
          disabled={loading}
          sx={{
            borderRadius: 2,
            textTransform: "none",
            fontFamily: FONT,
            borderColor: "#f44336",
            color: "#f44336",
            "&:hover": {
              borderColor: "#d32f2f",
              backgroundColor: "rgba(244, 67, 54, 0.04)",
            },
          }}
        >
          Reject
        </Button>
        <Button
          variant="contained"
          onClick={handleAccept}
          disabled={loading}
          sx={{
            borderRadius: 2,
            textTransform: "none",
            fontFamily: FONT,
            background: brandGradient,
            "&:hover": {
              transform: "translateY(-1px)",
            },
          }}
        >
          {loading ? <CircularProgress size={24} sx={{ color: "#fff" }} /> : "Accept to Text Editor"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RecommendationPopup;