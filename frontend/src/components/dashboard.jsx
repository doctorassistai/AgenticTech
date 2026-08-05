import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  IconButton,
  Avatar,
  Divider,
  useTheme,
  useMediaQuery,
  Chip,
  Paper,
  Grid,
  Tooltip,

} from "@mui/material";


import { WarningAmberRounded, ArrowBackRounded } from "@mui/icons-material";
import {
  EditRounded,
  MessageRounded,
  CloseRounded,
  ImageRounded,
  MenuRounded,
  AccountCircleRounded,
  Close,
  DashboardRounded,
  AddRounded,
  RefreshRounded,
  MoreVertRounded,
  TabRounded,
  ViewModuleRounded,
  HeightRounded,
  LocalHospital,
  PsychologyRounded,
  DragIndicator,
  OpenInFull,
  CloseFullscreen,
  Cake as CakeIcon,
  Wc as WcIcon,
  Favorite as RingIcon,
  Phone as PhoneIcon,
  LocationOn as LocationOnIcon,
  Bloodtype as BloodtypeIcon,
  Person as PersonIcon,
  SaveRounded,
  CheckCircleRounded,
  ErrorRounded,
} from "@mui/icons-material";
import { Menu, MenuItem, Checkbox, Tabs, Tab } from "@mui/material";
import Badge from "@mui/material/Badge";
import jsPDF from "jspdf";
import { PictureAsPdfRounded } from "@mui/icons-material";
import TimelineIcon from "@mui/icons-material/Timeline";

import { DndContext, closestCenter } from "@dnd-kit/core";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Notification from "./Notification";
import CanvasRenderer from "./CanvasRenderer";
import ManualPanel from "./ManualPanel";
import GlassTranscriptionPanel from "./GlassTranscriptionPanel";
import Condition from "./Condition";
import ToxicitySurveillancePanel from "./Toxicitysurveillancepanel";
import GenomicsPanel from "./GenomicsPanel"
import AgenticMedicationPanel from "./Agenticmedicationpanel";
import QuickNote from "./QuickNote";
import Trend from './Trend';  // 👈 ADD HERE
import DiagnosisAnalysis from "./DiagnosisAnalysis";
import AgenticWorkspace from "./AgenticWorkspace";
import QuickNotesList from "./QuickNotesList";
import DocumentRetrieval from "./DocumentRetrieval";
import PatientSummary from "./PatientSummary";
import ClinicalReasoningDashboard from "./ClinicalReasoningDashboard";
import DICOMViewer from "./DICOMViewer";
import TriageAssessment from "./TriageAssessment";
import AgenticPopup from "./AgenticPopup";
import ClinicalNotesPanel from "./ClinicalNotesPanel";
import VitalsPanel from "./VitalsPanel";
import MedicationPanel from "./MedicationPanel";
import InvestigationNotes from "./InvestigationPanel";
import ProcedureNotes from "./ProcedureNotes";
import MedicationListPanel from "./MedicationListPanel";
import InvestigationListPanel from "./InvestigationListPanel";
import TreatmentPlan from "./TreatmentPlan";
import DischargeSummaryPanel from "./DischargeSummaryPanel";
import PrognosisAnalysis from "./PrognosisAnalysis";
import ClinicalSummaryPanel from "./ClinicalSummaryPanel";
import ReferralLetterPanel from "./ReferralLetterPanel";
import StructuredNotePanel from "./StructuredNotePanel";
import TreatmentPlanPanel from "./TreatmentPlanPanel";
import ClinicalNotePanel from "./ClinicalNotePanel";
import TreatmentResponseDashboard from "./TreatmentResponseDashboard";
import AssertionNew from "./AssertionNew";
import LongitudinalData from "./LongitudinalData";
import ConsultationDataTab from "./ConsultationDataTab";
import TreatmentPlanPopup from "./TreatmentPlanPopup";
import Unifiedinsurance from "./Unifiedinsurance";
import ContextHistoryPanel from "./ContextHistoryPanel";
import PatientEducation from "./PatientEducation";
import ChemotherapyWorkflow from "./ChemotherapyWorkflow";
import ConsultationHistoryFollowUp from "./ConsultationHistoryFollowUp";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const LogoSource = "frontend/src/assets/lodo only.png";
import TumorBoard from "./TumorBoard";
import MedicalBoardPlanTab from "./MedicalBoardPlanTab";
import Predictivediseasepanel from "./Predictivediseasepanel";
import OPRecord from "./OPRecord";
import PainManagementHistoryTables from "./PainManagementHistoryTables";
import OTRecord from "./surgical-oncology/OTRecord";
import AnaesthesiaRecord from "./AnaesthesiaRecord"
import PalliativeAssessmentForm from "./PalliativeAssessmentForm";
import PalliativeAssessmentSummary from "./PalliativeAssessmentSummary";
import PreAnaesthesiaCheckup from "./PreAnaesthesiaCheckup";

import RadiotherapyRecord from "./RadiotherapyRecord"
import DiagnosisAnalysisskill from "./DiagnosisAnalysisskill";
import TreatmentPlanSkill from "./TreatmentPlanSkill";
import PainManagementNewFollowUp from "./PainManagementNewFollowUp";
import PainManagementHistoryPanel from "./PainManagementHistoryPanel";
import OncoPathologyWorkflow from "./onco-pathology/OncoPathologyWorkflow"

// ─── Design Tokens ───────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

// Monochrome palette
import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;

const C = {
  // Backgrounds
  white: theme.bg,          // Main page/card background
  ghost: theme.bgAlt,       // Alternate card/panel background
  fog: theme.bgTert,        // Section/header background

  // Text
  black: theme.text,        // Primary text
  ink: theme.text,          // Titles
  charcoal: theme.textSec,  // Secondary text
  smoke: theme.textSec,     // Labels
  ash: theme.textMuted,     // Muted/caption text
  silver: theme.textMuted,  // Disabled/light text

  // Borders
  mist: theme.border,       // Normal borders
  border: theme.borderStr,  // Strong borders/highlight borders

  // Brand / Accent
  accent: theme.accent,
  accentHover: theme.accentHover ?? theme.accent,

  // Secondary surface
  sec: theme.sec,
};

const SIDEBAR_WIDTH = 240;

// ─── Shared Styles ───────────────────────────────────────────────────────────
const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW,
  ...extra,
});

// Clean card — subtle border, white bg
const card = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const sectionCard = {
  ...card,
  overflow: "hidden",
};
const glassCard = {
  position: "relative",
  borderRadius: 18,
  background: "rgba(230, 232, 238, 0.3)",
  backdropFilter: "blur(8px) saturate(105%)",
  WebkitBackdropFilter: "blur(8px) saturate(105%)",
  boxShadow: `
    0 14px 50px rgba(0,0,0,0.18),
    inset 0 1px 0 rgba(255,255,255,0.30),
    inset 0 -1px 0 rgba(0,0,0,0.18)
  `,
  border: "0px solid rgba(255,255,255,0.22)",
  overflow: "hidden",
  "&::before": {
    content: '""',
    position: "absolute",
    inset: 0,
    background: `
      radial-gradient(circle at 20% 15%, rgba(255,255,255,0.25), transparent 45%),
      linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.05))
    `,
    pointerEvents: "none",
  },
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
    pointerEvents: "none",
  },
  "& > *": { position: "relative", zIndex: 1 },
};
const actionButton = {
  px: 2.5,
  py: 1.1,
  borderRadius: "2px",
  fontSize: 12,
  fontWeight: 400,
  fontFamily: FONT,
  textTransform: "none",
  letterSpacing: "0.06em",
  background: C.black,
  color: C.white,
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal },
  "&:active": { background: C.ink },
  "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const ghostButton = {
  px: 2,
  py: 0.9,
  borderRadius: "2px",
  fontSize: 12,
  fontWeight: 400,
  fontFamily: FONT,
  textTransform: "none",
  letterSpacing: "0.04em",
  background: "transparent",
  color: C.charcoal,
  border: `1px solid ${C.mist}`,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 0.5,
  transition: "all 0.15s ease",
  "&:hover": { borderColor: C.smoke, background: C.ghost },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const stableHeightVariant = (id) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return (Math.abs(hash) % 3) + 1;
};

const FORCED_FEATURE_DEFINITIONS = [
  { feature_id: "current-clinical-context", feature_name: "Current Clinical Context Retriever", category_id: "current-context", category_name: "Current Context Nodes", enabled: true, configured: true, trigger: { type: "page-reload", button_label: null }, display_method: "text" },
  { feature_id: "medical-clinical-context", feature_name: "Medical Clinical Context Retriever", category_id: "medical-context", category_name: "Medical Context Nodes", enabled: true, configured: true, trigger: { type: "page-reload", button_label: null }, display_method: "text" },
  { feature_id: "documentation-medication-analysis", feature_name: "Medication Analysis", enabled: true, configured: true, trigger: { type: "manual" }, display_method: "canvas" },
  { feature_id: "documentation-investigation-notes", feature_name: "Investigation Notes", enabled: true, configured: true, trigger: { type: "manual" }, display_method: "canvas" },
  { feature_id: "documentation-clinical-notes", feature_name: "Clinical Notes", enabled: true, configured: true, trigger: { type: "manual" }, display_method: "canvas" },
  { feature_id: "documentation-treatment-plan", feature_name: "Treatment Plan", enabled: true, configured: true, trigger: { type: "manual" }, display_method: "canvas" },
];

const oncologySpecialties = [
  "Medical Oncology", "Chemotherapy", "Immunotherapy", "Targeted therapy", "Hormone therapy", "Precision oncology", "Radiation Oncology", "External beam radiotherapy", "Brachytherapy", "Stereotactic radiosurgery", "Surgical Oncology", "Curative surgery", "Cytoreductive surgery", "Reconstructive surgery", "Breast Oncology", "Thoracic Oncology", "Gastrointestinal Oncology", "Gynecologic Oncology", "Urologic Oncology", "Head and Neck Oncology", "Neuro-oncology", "Pediatric Oncology", "Hematologic Oncology", "Imaging Oncology", "Pathology", "Histopathology", "Cytology", "Molecular pathology", "Molecular Oncology", "Biomarker Analysis", "Nuclear Medicine", "Interventional Oncology", "Ablation therapies", "Embolization", "Research Oncology", "Palliative Oncology", "Pain Management", "Rehabilitation Oncology", "Nutritional Oncology", "Psycho-oncology", "Preventive Oncology", "Cancer Screening Programs", "Genetic Counseling",
];

const ALWAYS_ENABLED_NODE_IDS = new Set([
  "patient-profile", "current-clinical-context", "medical-clinical-context",
  "documentation-medication-analysis", "documentation-clinical-notes",
  "documentation-investigation-notes", "documentation-treatment-plan",
  "documentation-discharge-summary", "documentation-referral-letter",
]);

const DOCUMENTATION_NODES = [
  "documentation-medication-analysis", "documentation-clinical-notes",
  "documentation-investigation-notes", "documentation-treatment-plan",
  "documentation-discharge-summary", "documentation-clinical-summary",
  "documentation-referral-letter",
];

const DOCUMENTATION_LABELS = {
  "documentation-medication-analysis": "Medication Analysis",
  "documentation-clinical-notes": "Clinical Notes",
  "documentation-investigation-notes": "Investigation Notes",
  "documentation-treatment-plan": "Treatment Plan",
  "structured-note": "Structured Clinical Note",
};


// ─── Patient Images Gallery Component ───────────────────────────────────────
const PatientImagesGallery = ({ patientId, doctorId }) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [error, setError] = useState(null);

  const fetchImages = async () => {
    if (!patientId || !doctorId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${API_BASE_URL}hms/users/data/patient-images/${doctorId}/${patientId}`
      );
      
      const result = await response.json();
      
      if (result.status === "success") {
        setImages(result.data || []);
      } else {
        setError(result.message || "Failed to load images");
        setImages([]);
      }
    } catch (err) {
      console.error("Error fetching patient images:", err);
      setError("Network error while fetching images");
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
    
    // Listen for refresh event
    const handleRefresh = () => fetchImages();
    window.addEventListener('refreshPatientImages', handleRefresh);
    
    return () => {
      window.removeEventListener('refreshPatientImages', handleRefresh);
    };
  }, [patientId, doctorId]);

  const handleImageClick = (image) => {
    setSelectedImage(image);
  };

  const handleCloseModal = () => {
    setSelectedImage(null);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Unknown date";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getCategoryLabel = (category) => {
    const labels = {
      "patient-image": "Patient Image",
      "clinical-photo": "Clinical Photo",
      "radiology": "Radiology Image",
      "scan": "Scan",
      "none": "General Image",
    };
    return labels[category] || category || "Medical Image";
  };

  return (
    <>
      {/* Loading state */}
      {loading && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
          <RefreshRounded sx={{ fontSize: 32, color: C.ash, animation: "spin 1s linear infinite" }} />
        </Box>
      )}

      {/* Error state */}
      {error && !loading && (
        <Box sx={{
          p: 4,
          textAlign: "center",
          border: `1px solid ${C.fog}`,
          borderRadius: "4px",
          background: C.ghost,
        }}>
          <WarningAmberRounded sx={{ fontSize: 32, color: C.ash, mb: 1 }} />
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{error}</Typography>
        </Box>
      )}

      {/* Empty state */}
      {!loading && !error && images.length === 0 && (
        <Box sx={{
          p: 6,
          textAlign: "center",
          border: `1px solid ${C.fog}`,
          borderRadius: "4px",
          background: C.ghost,
        }}>
          <ImageRounded sx={{ fontSize: 48, color: C.silver, mb: 1.5, opacity: 0.5 }} />
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            No medical images available
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.silver, mt: 0.5 }) }}>
            Patient images will appear here when uploaded
          </Typography>
        </Box>
      )}

      {/* Image gallery */}
      {!loading && !error && images.length > 0 && (
        <Box sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(3, 1fr)",
            lg: "repeat(4, 1fr)",
          },
          gap: 2,
        }}>
          {images.map((image, index) => (
            <Box
              key={image._id || index}
              onClick={() => handleImageClick(image)}
              sx={{
                cursor: "pointer",
                border: `1px solid ${C.fog}`,
                borderRadius: "4px",
                overflow: "hidden",
                background: C.white,
                transition: "all 0.2s ease",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  borderColor: C.mist,
                },
              }}
            >
              {/* Image thumbnail */}
              <Box
                sx={{
                  aspectRatio: "1",
                  overflow: "hidden",
                  background: C.ghost,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src={image.file_url}
                  alt={image.filename}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  onError={(e) => {
                    e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%23a8a8a8' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'%3E%3C/circle%3E%3Cpolyline points='21 15 16 10 5 21'%3E%3C/polyline%3E%3C/svg%3E";
                  }}
                />
              </Box>

              {/* Image info */}
              <Box sx={{ p: 1.5 }}>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>
                  {formatDate(image.created_at)}
                </Typography>
                {image.subcategory && image.subcategory !== "none" && (
                  <Chip
                    label={image.subcategory}
                    size="small"
                    sx={{
                      mt: 0.5,
                      fontSize: 9,
                      height: 18,
                      background: C.ghost,
                      color: C.ash,
                    }}
                  />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Image Modal/Popup */}
      {selectedImage && (
        <>
          <Box
            onClick={handleCloseModal}
            sx={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.85)",
              zIndex: 10000,
              cursor: "pointer",
            }}
          />
          <Box
            sx={{
              position: "fixed",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10001,
              pointerEvents: "none",
              p: 3,
            }}
          >
            <Box
              sx={{
                background: C.white,
                borderRadius: "4px",
                maxWidth: "90vw",
                maxHeight: "90vh",
                overflow: "auto",
                pointerEvents: "auto",
                boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
              }}
            >
              {/* Modal header */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  p: 2,
                  borderBottom: `1px solid ${C.fog}`,
                  background: C.ghost,
                }}
              >
                <Box>
                  <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>
                    {getCategoryLabel(selectedImage.category)}
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
                    {formatDate(selectedImage.created_at)}
                  </Typography>
                </Box>
                <IconButton
                  onClick={handleCloseModal}
                  sx={{
                    color: C.ash,
                    border: `1px solid ${C.fog}`,
                    borderRadius: "2px",
                    "&:hover": { background: C.fog },
                  }}
                >
                  <CloseRounded sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>

              {/* Modal image */}
              <Box
                sx={{
                  p: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: C.white,
                }}
              >
                <img
                  src={selectedImage.file_url}
                  alt={selectedImage.filename}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "70vh",
                    objectFit: "contain",
                  }}
                  onError={(e) => {
                    e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 24 24' fill='none' stroke='%23a8a8a8' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'%3E%3C/circle%3E%3Cpolyline points='21 15 16 10 5 21'%3E%3C/polyline%3E%3C/svg%3E";
                  }}
                />
              </Box>

              {/* Modal footer with metadata */}
              <Box
                sx={{
                  p: 2,
                  borderTop: `1px solid ${C.fog}`,
                  background: C.ghost,
                  display: "flex",
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase" }) }}>
                    Filename
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                    {selectedImage.filename}
                  </Typography>
                </Box>
                {selectedImage.report_date && (
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase" }) }}>
                      Report Date
                    </Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                      {new Date(selectedImage.report_date).toLocaleDateString()}
                    </Typography>
                  </Box>
                )}
                <Box>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase" }) }}>
                    Upload Mode
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                    {selectedImage.upload_mode || "N/A"}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        </>
      )}
    </>
  );
};
// ─── Save Confirmation Popup Component ───────────────────────────────────────
// ─── Save Status Popup Component ─────────────────────────────────────────
const SaveStatusPopup = ({ open, onClose, isSaving, saveSuccess, saveError, documentCount }) => {
  // Auto close after 2 seconds on success or error
  useEffect(() => {
    if (saveSuccess || saveError) {
      const timer = setTimeout(() => {
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess, saveError, onClose]);

  if (!open) return null;

  return (
    <>
      <Box
        onClick={onClose}
        sx={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 3000,
        }}
      />
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 3001,
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            background: C.white,
            border: `1px solid ${C.fog}`,
            borderRadius: "4px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
            width: 380,
            maxWidth: "90vw",
            pointerEvents: "auto",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <Box
            sx={{
              px: 3,
              py: 2.5,
              borderBottom: `1px solid ${C.fog}`,
              background: C.ghost,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              {saveSuccess ? (
                <CheckCircleRounded sx={{ fontSize: 18, color: "#2e7d32" }} />
              ) : saveError ? (
                <ErrorRounded sx={{ fontSize: 18, color: "#d32f2f" }} />
              ) : (
                <SaveRounded sx={{ fontSize: 18, color: C.smoke }} />
              )}
              <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>
                {saveSuccess ? "Save Successful" : saveError ? "Save Failed" : "Saving Session"}
              </Typography>
            </Box>
            <IconButton
              size="small"
              onClick={onClose}
              sx={{
                color: C.ash,
                border: `1px solid ${C.fog}`,
                borderRadius: "2px",
                "&:hover": { background: C.fog },
              }}
            >
              <CloseRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>

          {/* Content */}
          <Box sx={{ p: 3, textAlign: "center" }}>
            {isSaving ? (
              <>
                <RefreshRounded
                  sx={{
                    fontSize: 40,
                    color: C.ash,
                    animation: "spin 1s linear infinite",
                    mb: 2,
                  }}
                />
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 1 }) }}>
                  Saving {documentCount} document(s)...
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
                  Please wait while we save your clinical data
                </Typography>
              </>
            ) : saveSuccess ? (
              <>
                <CheckCircleRounded sx={{ fontSize: 48, color: "#2e7d32", mb: 2 }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 1 }) }}>
                  Successfully saved {documentCount} document(s)!
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
                  Your clinical data has been saved securely
                </Typography>
              </>
            ) : saveError ? (
              <>
                <ErrorRounded sx={{ fontSize: 48, color: "#d32f2f", mb: 2 }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 1 }) }}>
                  Failed to save documents
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
                  {saveError}
                </Typography>
              </>
            ) : null}
          </Box>
        </Box>
      </Box>
    </>
  );
};
// ─── PDF ─────────────────────────────────────────────────────────────────────
const downloadPDF = ({ title, data, patientName = "######", patientId = "***", doctorId = "****" }) => {
  if (!data) return;
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14, marginY = 18;
  const usableWidth = pageWidth - marginX * 2;
  let y = marginY;
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("DoctorAssist.ai Hospital", marginX, y);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text("Clinical Documentation Report", marginX, y + 6);
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
  doc.line(marginX, y + 10, pageWidth - marginX, y + 10); y += 16;
  const boxHeight = 26; doc.rect(marginX, y, usableWidth, boxHeight);
  doc.setFont("helvetica", "bold");
  doc.text("Patient Name:", marginX + 4, y + 7); doc.text("Patient ID:", marginX + 4, y + 14);
  doc.text("Doctor ID:", marginX + usableWidth / 2 + 4, y + 7); doc.text("Report Date:", marginX + usableWidth / 2 + 4, y + 14);
  doc.setFont("helvetica", "normal");
  doc.text(patientName, marginX + 32, y + 7); doc.text(patientId, marginX + 32, y + 14);
  doc.text(doctorId, marginX + usableWidth / 2 + 32, y + 7); doc.text(new Date().toLocaleDateString(), marginX + usableWidth / 2 + 32, y + 14);
  y += boxHeight + 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(title, marginX, y); y += 10;
  const ensureSpace = (h) => { if (y + h > pageHeight - 25) { doc.addPage(); y = marginY; } };
  const drawTable = (headers, rows, colWidths) => {
    const padding = 2, lineHeight = 5; ensureSpace(10);
    let x = marginX; doc.setFont("helvetica", "bold");
    headers.forEach((h, i) => { doc.rect(x, y, colWidths[i], 8); doc.text(h, x + padding, y + 5.5); x += colWidths[i]; });
    y += 8; doc.setFont("helvetica", "normal");
    rows.forEach((row) => {
      const heights = row.map((cell, i) => doc.splitTextToSize(String(cell), colWidths[i] - padding * 2).length);
      const rowHeight = Math.max(...heights) * lineHeight + padding * 2; ensureSpace(rowHeight);
      let colX = marginX;
      row.forEach((cell, i) => {
        doc.rect(colX, y, colWidths[i], rowHeight);
        const lines = doc.splitTextToSize(String(cell), colWidths[i] - padding * 2);
        doc.text(lines, colX + padding, y + padding + lineHeight - 1); colX += colWidths[i];
      }); y += rowHeight;
    }); y += 6;
  };
  const renderValue = (value) => {
    if (Array.isArray(value)) { const rows = value.map((item, i) => { if (typeof item === "object" && item !== null) return [i + 1, Object.entries(item).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n")]; return [i + 1, String(item)]; }); drawTable(["#", "Details"], rows, [12, usableWidth - 12]); return; }
    if (typeof value === "object" && value !== null) { Object.entries(value).forEach(([subKey, subVal]) => { ensureSpace(8); doc.setFont("helvetica", "bold"); doc.text(subKey.replace(/_/g, " ").toUpperCase(), marginX + 2, y); y += 5; doc.setFont("helvetica", "normal"); renderValue(subVal); }); return; }
    drawTable(["Value"], [[String(value)]], [usableWidth]);
  };
  if (typeof data === "object") { Object.entries(data).forEach(([section, value]) => { ensureSpace(12); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(section.replace(/_/g, " ").toUpperCase(), marginX, y); y += 6; doc.setFontSize(10); renderValue(value); }); }
  ensureSpace(30); doc.line(pageWidth - 80, y + 20, pageWidth - 20, y + 20); doc.text("Doctor Signature", pageWidth - 78, y + 26);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(9); doc.text(`Generated on ${new Date().toLocaleString()} • Page ${i} of ${pages}`, pageWidth / 2, pageHeight - 10, { align: "center" }); }
  doc.save(`${title.replace(/\s+/g, "_")}.pdf`);
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const AGENTS = [
  "A0: Disease Anchor",
  "A1: Graph Structuring",
  "A2: Timeline",
  "A3: Organ Analysis",
  "A4: Causal Reasoning",
  "A5: Evidence",
  "A6: Signal Importance",
  "A7: Treatment",
  "A8: Missing Info",
  "A9: Insights",
  "A10: Summary",
  "A11: Validation",
  "A12: Output",
];

const AgentLoader = ({ activeStep = 2 }) => {
  return (
    <Box sx={{ mt: 2 }}>
      {AGENTS.map((agent, index) => {
        const isDone = index < activeStep;
        const isActive = index === activeStep;

        return (
          <motion.div
            key={agent}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 0.8,
                px: 1,
                borderRadius: "6px",
                background: isActive
                  ? "rgba(0,0,0,0.05)"
                  : "transparent",
              }}
            >
              {/* Status Dot */}
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: isDone
                    ? "#0a0a0a"
                    : isActive
                    ? "#4a4a4a"
                    : "#d4d4d4",
                  animation: isActive
                    ? "pulse 1.2s infinite"
                    : "none",
                }}
              />

              {/* Label */}
              <Typography
                sx={{
                  fontSize: 12,
                  color: isDone
                    ? "#1a1a1a"
                    : isActive
                    ? "#2e2e2e"
                    : "#a8a8a8",
                }}
              >
                {agent}
              </Typography>
            </Box>
          </motion.div>
        );
      })}
    </Box>
  );
};
function DraggableNodeItem({ node, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: node.node_id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

const NodeCanvas = React.memo(function NodeCanvas({ node, data }) {
  const comp = React.useMemo(() => ({ ...node.components[0], data }), [node.node_id, data]);
  return <CanvasRenderer components={[comp]} />;
});

// ─── Patient Profile Card ─────────────────────────────────────────────────────
const PatientProfileCard = ({ data }) => {
  if (!data) return null;

  const capitalizeName = (name) =>
    name ? name.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";

  const formatDate = (dateString) => {
    if (!dateString || dateString === "—") return "—";
    return new Date(dateString).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const calculateAge = (dob) => {
    if (!dob || dob === "—") return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  const age = calculateAge(data.date_of_birth);

  const infoItems = [
    { icon: <CakeIcon sx={{ fontSize: 16 }} />, label: "Date of Birth", value: formatDate(data.date_of_birth) },
    { icon: <WcIcon sx={{ fontSize: 16 }} />, label: "Gender", value: data.gender || "—" },
    { icon: <RingIcon sx={{ fontSize: 16 }} />, label: "Marital Status", value: data.marital_status || "—" },
    { icon: <PhoneIcon sx={{ fontSize: 16 }} />, label: "Phone", value: data.phone_number || "—" },
  ];

  return (
    <Box sx={{ ...sectionCard }}>
      {/* Header strip */}
      <Box sx={{ p: { xs: 2.5, sm: 3 }, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 2.5, flexWrap: "wrap", background: C.ghost }}>
        <Avatar sx={{ width: 56, height: 56, fontSize: 22, background: C.black, color: C.white, fontFamily: FONT, fontWeight: 400, borderRadius: "2px" }}>
          {capitalizeName(data.name)?.[0] || "P"}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 100 }}>
          <Typography sx={{ ...os({ fontSize: 20, color: C.ink, letterSpacing: "-0.3px" }) }}>
            {capitalizeName(data.name)}
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mt: 0.75, flexWrap: "wrap", alignItems: "center" }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.04em" }) }}>
              HMS ID: {data.hms_id || "—"}
            </Typography>
            {age && (
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>· {age} yrs</Typography>
            )}
          </Box>
        </Box>
        {data.blood_group && data.blood_group !== "—" && (
          <Box sx={{ textAlign: "center", border: `1px solid ${C.mist}`, borderRadius: "2px", px: 2, py: 1, background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>Blood</Typography>
            <Typography sx={{ ...os({ fontSize: 20, color: C.ink }) }}>{data.blood_group}</Typography>
          </Box>
        )}
      </Box>

      {/* Info grid */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 0 }}>
        {infoItems.map((item, i) => (
          <Box key={item.label} sx={{ p: 2.5, borderRight: i < infoItems.length - 1 ? `1px solid ${C.fog}` : "none", "&:hover": { background: C.ghost }, transition: "background 0.15s" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1, color: C.ash }}>
              {item.icon}
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>{item.label}</Typography>
            </Box>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{item.value}</Typography>
          </Box>
        ))}
      </Box>

      {/* Address row */}
      {data.address && (
        <Box sx={{ px: 2.5, py: 2, borderTop: `1px solid ${C.fog}`, display: "flex", gap: 1.5, alignItems: "flex-start" }}>
          <LocationOnIcon sx={{ fontSize: 15, color: C.ash, mt: 0.2 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Address</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink, lineHeight: 1.5 }) }}>{data.address}</Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ─── Clinical Context Card ────────────────────────────────────────────────────
const CurrentClinicalContextCard = ({ data }) => {
  if (!data) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No clinical context available</Typography>
        <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 0.5 }) }}>Clinical data will appear here after dictation</Typography>
      </Box>
    );
  }

  const sectionConfig = {
    chief_complaint: { label: "Chief Complaint" },
    history_of_present_illness: { label: "History of Present Illness" },
    past_medical_history: { label: "Past Medical History" },
    medications: { label: "Current Medications" },
    allergies: { label: "Allergies" },
    family_history: { label: "Family History" },
    social_history: { label: "Social History" },
    review_of_systems: { label: "Review of Systems" },
    physical_examination: { label: "Physical Examination" },
    vital_signs: { label: "Vital Signs" },
    assessment: { label: "Clinical Assessment" },
    plan: { label: "Treatment Plan" },
    diagnostic_tests: { label: "Diagnostic Tests" },
    differential_diagnosis: { label: "Differential Diagnosis" },
  };

  const getConfig = (key) => {
    const norm = key.toLowerCase().replace(/\s+/g, "_");
    return sectionConfig[norm] || { label: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) };
  };

  const formatValue = (value) => {
    if (Array.isArray(value)) {
      return (
        <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
          {value.map((item, idx) => (
            <Box component="li" key={idx} sx={{ ...os({ mb: 0.5, fontSize: 13, color: C.charcoal }) }}>
              {typeof item === "object" ? JSON.stringify(item, null, 2) : String(item)}
            </Box>
          ))}
        </Box>
      );
    }
    if (typeof value === "object" && value !== null) {
      return (
        <Box sx={{ p: 1.5, borderRadius: "2px", background: C.ghost, fontFamily: "monospace", fontSize: 12, color: C.smoke, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(value, null, 2)}
        </Box>
      );
    }
    return <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>{String(value)}</Typography>;
  };

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, 1fr)" }, gap: 2 }}>
      {Object.entries(data).map(([key, value]) => {
        const config = getConfig(key);
        const hasContent = value && (Array.isArray(value) ? value.length > 0 : String(value).trim() !== "");
        return (
          <Box key={key} sx={{ p: 2.5, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.white, "&:hover": { borderColor: C.mist, background: C.ghost }, transition: "all 0.15s" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, pb: 1.5, borderBottom: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>{config.label}</Typography>
              <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: hasContent ? C.charcoal : C.mist }} />
            </Box>
            {formatValue(value)}
          </Box>
        );
      })}
    </Box>
  );
};

// ─── Draggable PDF Viewer Dialog ─────────────────────────────────────────────
const DraggablePDFDialog = ({ open, onClose, pdfUrl, title }) => {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const elementStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (!e.target.closest(".drag-handle")) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    elementStartRef.current = { x: position.x, y: position.y };
  };
  const handleMouseMove = (e) => {
    if (!isDragging) return; e.preventDefault();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPosition({ x: elementStartRef.current.x + dx, y: elementStartRef.current.y + dy });
  };
  const handleMouseUp = () => { setIsDragging(false); };
useEffect(() => {
  setCurrentDictation("");
  setDictationTranscript("");
  setAnalyzedDictation(null);
}, [patientId]);
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
    }
  }, [isDragging]);

  if (!open) return null;

  return (
    <div style={{ position: "fixed", left: `${position.x}px`, top: `${position.y}px`, zIndex: isDragging ? 10000 : 9999, width: "800px", maxWidth: "90vw", height: "600px", maxHeight: "80vh" }}>
      <Paper elevation={0} sx={{ border: `1px solid ${C.mist}`, borderRadius: "4px", overflow: "hidden", display: "flex", flexDirection: "column", height: "100%", boxShadow: isDragging ? "0 20px 40px rgba(0,0,0,0.18)" : "0 4px 16px rgba(0,0,0,0.1)", backgroundColor: C.white }}>
        <Box className="drag-handle" sx={{ background: C.black, p: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "grab", userSelect: "none", "&:active": { cursor: "grabbing" }, flexShrink: 0 }} onMouseDown={handleMouseDown}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <DragIndicator sx={{ fontSize: 18, color: C.silver }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.white, letterSpacing: "0.04em" }) }}>{title || "PDF Viewer"}</Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: C.silver, "&:hover": { background: "rgba(255,255,255,0.1)" } }}>
            <CloseRounded sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, overflow: "auto", bgcolor: C.ghost }}>
          {pdfUrl ? (
            <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title="PDF Viewer" />
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No PDF available</Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </div>
  );
};

// ─── Shared Tab Styles ────────────────────────────────────────────────────────
const tabSx = {
  "& .MuiTab-root": {
    textTransform: "none",
    fontWeight: 300,
    fontFamily: FONT,
    fontSize: 12,
    minWidth: "auto",
    px: { xs: 1.5, sm: 2 },
    color: C.ash,
    letterSpacing: "0.04em",
    "&.Mui-selected": { color: C.ink, fontWeight: 400 },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
  "& .MuiTabs-scrollButtons": { display: "flex" },
  borderBottom: `1px solid ${C.fog}`,
};

// ─── Section Header ───────────────────────────────────────────────────────────
const SectionHeader = ({ children, sub, action }) => (
  <Box sx={{ px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
    <Box>
      <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>{children}</Typography>
      {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>{sub}</Typography>}
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Box>
);

// ─── DOC_IDS ─────────────────────────────────────────────────────────────────
const DOC_IDS = [
  "documentation-medication-analysis", "documentation-clinical-notes",
  "documentation-investigation-notes", "documentation-treatment-plan",
  "structured-note",
];

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function DoctorDashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isSmall = useMediaQuery(theme.breakpoints.down("sm"));
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");
  const patientId = query.get("patient_id");

  // State
  const [open, setOpen] = useState(false);
    const [visitType, setVisitType] = useState(null);
  const [triageData, setTriageData] = useState(null);
  const [isFollowUp, setIsFollowUp] = useState(false); 
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [enabledNodes, setEnabledNodes] = useState([]);
  const [nodeData, setNodeData] = useState({});
  const [reloadingNode, setReloadingNode] = useState(null);
  const [selectedTabNodes, setSelectedTabNodes] = useState([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [patientSummaryTrigger, setPatientSummaryTrigger] = useState(0);
  const [tabAnchor, setTabAnchor] = useState(null);
  const [mainTab, setMainTab] = useState("clinical");
  const [docTab, setDocTab] = useState(0);
  const [dataDocTab, setDataDocTab] = useState(0);
  const [conditions, setConditions] = useState([]);
  const [currentAppointmentId, setCurrentAppointmentId] = useState(null);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [showNotesList, setShowNotesList] = useState(false);
  const [quickNoteEnabled, setQuickNoteEnabled] = useState(false);
  const [dicomViewerEnabled, setDicomViewerEnabled] = useState(true);
  const [currentDictation, setCurrentDictation] = useState("");
  const [analyzedDictation, setAnalyzedDictation] = useState(null);
  const [treatmentObjective, setTreatmentObjective] = useState("");
  const [dictationRun, setDictationRun] = useState(0);
  const [triageRefreshTrigger, setTriageRefreshTrigger] = useState(0);
  const [agenticOpen, setAgenticOpen] = useState(false);
  const [agenticTrigger, setAgenticTrigger] = useState(0);
  const [treatmentResponseOpen, setTreatmentResponseOpen] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [clinicalReasoningTrigger, setClinicalReasoningTrigger] = useState(0);
  const [openDiagnosis, setOpenDiagnosis] = useState(false);
  const [openPrognosis, setOpenPrognosis] = useState(false);
  const [diagnosisText, setDiagnosisText] = useState("");
  const [prognosisText, setPrognosisText] = useState("");
  const [fontSize, setFontSize] = useState(14);
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [treatmentPlanPopupOpen, setTreatmentPlanPopupOpen] = useState(false);
  const treatmentPlanRef = useRef(null);
  const [loadingDoc, setLoadingDoc] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const prognosisRef = useRef(null);
  const pageReloadExecutedRef = useRef(new Set());
  const [contextTabIndex, setContextTabIndex] = useState(0);
  const [medicalBoardPlanStatus, setMedicalBoardPlanStatus] = useState("none"); // "loading" | "none" | "pending" | "approved"
  const [isOncologySpecialist, setIsOncologySpecialist] = useState(false);
  const [isAnaesthesiologist, setIsAnaesthesiologist] = useState(false);
const [isPainPalliativeSpecialist, setIsPainPalliativeSpecialist] = useState(false);
const [isPalliativeMedicineSpecialist, setIsPalliativeMedicineSpecialist] = useState(false);
const [palliativeInitialData, setPalliativeInitialData] = useState(null);
const [palliativeDataLoading, setPalliativeDataLoading] = useState(false);
const [anaesthesiaChecklist, setAnaesthesiaChecklist] = useState({
  signin_consent: "", signin_consent_remark: "",
  signin_machine: "", signin_machine_remark: "",
  signin_oximeter: "", signin_oximeter_remark: "",
  signin_airway: "", signin_airway_remark: "",
  signin_aspiration: "", signin_aspiration_remark: "",
  signin_starvation: "", signin_starvation_remark: "",
  signin_allergy: "", signin_allergy_remark: "",
  timeout_anaesthesia_events: "",
  timeout_antibiotic: "", timeout_antibiotic_remark: "",
  timeout_throat: "", timeout_throat_remark: "",
  signout_concerns: "",
  extubation_throat: "", extubation_throat_remark: "",
});
  const [dictationMode, setDictationMode] = useState("auto"); // "auto" | "manual"
  const patientProfileRef = useRef(null);
  const patientSummaryRef = useRef(null);
  const transcriptionRef = useRef(null);
  const documentationRef = useRef(null);
  const dataTabRef = useRef(null);
  const procedureTabRef = useRef(null);
  const [savePopupOpen, setSavePopupOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveDocumentCount, setSaveDocumentCount] = useState(0);
  const [patientEducationOpen, setPatientEducationOpen] = useState(false);
  const [hasTreatmentPlanData, setHasTreatmentPlanData] = useState(false); 
  const [agenticMedData, setAgenticMedData] = useState(null);
const [isAgenticMedLoading, setIsAgenticMedLoading] = useState(false);// ADD THIS LINE
const [patientDocTab, setPatientDocTab] = useState(0); // 0 = Medical Records, 1 = Patient Images
const [openDiagnosisSkill, setOpenDiagnosisSkill] = useState(false);
  // Store only the primary diagnosis and reason from skill-based analysis
const [diagnosisSkillPrimary, setDiagnosisSkillPrimary] = useState("");
const [diagnosisSkillReason, setDiagnosisSkillReason] = useState("");
// For the treatment plan with skills popup (if needed later)
const [openTreatmentPlanSkill, setOpenTreatmentPlanSkill] = useState(false);
const [diagnosisTabIndex, setDiagnosisTabIndex] = useState(0);
const [treatmentTabIndex, setTreatmentTabIndex] = useState(0);
  // ─── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doctorId || !patientId) return;
    setClinicalReasoningTrigger((p) => p + 1);
  }, [doctorId, patientId]);
useEffect(() => {
  const fetchTriageFromBackend = async () => {
    if (visitType?.toLowerCase() === "emergency" && patientId) {
      console.log("🔍 Fetching triage assessment for patient:", patientId);
      
      try {
        const response = await fetch(
          `https://doctorassist.ai/api/hms/users/data/context/get_latest_simple_triage/${patientId}`
        );
        
        const result = await response.json();
        console.log("📥 Triage fetch result:", result);
        
        if (result.status === 'success' && result.data) {
          console.log("✅ Triage data loaded from backend:", result.data);
          setTriageData(result.data);
        } else {
          console.log("ℹ️ No triage data found in backend for this patient");
          setTriageData(null);
        }
      } catch (err) {
        console.error("❌ Error fetching triage from backend:", err);
        setTriageData(null);
      }
    }
  };
  
  fetchTriageFromBackend();
  
  // Also listen for when triage is saved (real-time update)
  const handleTriageSaved = () => {
    console.log("🔄 Triage saved event received, refetching...");
    fetchTriageFromBackend();
  };
  
  window.addEventListener('triageDataReady', handleTriageSaved);
  window.addEventListener('triageDataSaved', handleTriageSaved);
  
  return () => {
    window.removeEventListener('triageDataReady', handleTriageSaved);
    window.removeEventListener('triageDataSaved', handleTriageSaved);
  };
}, [visitType, patientId, triageRefreshTrigger]); // ✅ ADD triageRefreshTrigger to dependencies
useEffect(() => {
  const fetchVisitType = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/doctors/doctor_today_appointments/${doctorId}`
      );

      const json = await res.json();
      const appointments = json?.appointments || [];

      const currentPatientAppt = appointments.find(
        (appt) =>
          appt.sys_user_id?.toLowerCase() === patientId?.toLowerCase()
      );

      console.log("MATCHED APPOINTMENT:", currentPatientAppt);

      if (currentPatientAppt) {
        setVisitType(currentPatientAppt.visit_type);
        setCurrentAppointmentId(currentPatientAppt.appointment_id); // ✅ ADD THIS LINE
        console.log("✅ Appointment ID set to:", currentPatientAppt.appointment_id);
      }

    } catch (err) {
      console.error("Error fetching visit type:", err);
    }
  };

  if (doctorId && patientId) {
    fetchVisitType();
  }
}, [doctorId, patientId]);

useEffect(() => {
  const checkLatestAppointment = async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/doctors/appointment/latest?patient_id=${patientId}&doctor_id=${doctorId}`
      );
      const data = await res.json();
      setIsFollowUp(data?.is_follow_up === true);
    } catch (err) {
      console.error("❌ Failed to check follow-up status:", err);
      setIsFollowUp(false);
    }
  };
  checkLatestAppointment();
}, [patientId, doctorId]);


useEffect(() => {
  if (onboardingStatus === "processing") {
    setCurrentStep(0);

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= 12) return prev;
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }
}, [onboardingStatus]);
  useEffect(() => {
    const fetchDoctorDetails = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctor_id: doctorId }) });
        const data = await res.json();
        if (data.status === "success") { setDoctorName(data.doctor_name); setDoctorSpeciality(data.doctor_speciality); }
      } catch (err) { console.error("Failed loading doctor profile:", err); }
    };
    fetchDoctorDetails();
  }, [doctorId]);

 useEffect(() => {
  const checkOncologySpecialist = async () => {
    if (doctorId) {
      try {
        const response = await fetch(`${API_BASE_URL}hms/users/data/get-doctor-info/${doctorId}`);
        const data = await response.json();
        const specialty = data?.specialization || doctorSpeciality || "";
        const isOncology = oncologySpecialties.some((spec) => specialty.toLowerCase().includes(spec.toLowerCase()));
        setIsOncologySpecialist(isOncology);
        setIsAnaesthesiologist(specialty === "Anesthesiology"); // 👈 add this line
        setIsPainPalliativeSpecialist(specialty === "Onco Pain and Palliative Care");  
        setIsPalliativeMedicineSpecialist(specialty === "Palliative Medicine"); // ← add
        console.log("doctorId used:", doctorId);
console.log("raw specialty from API:", data?.specialization);
console.log("fallback doctorSpeciality:", doctorSpeciality);
console.log("final specialty value:", specialty);
 // ← add


      } catch (error) { console.error("Failed to fetch doctor info:", error); }
    }
  };
  checkOncologySpecialist();
}, [doctorId, doctorSpeciality]);
useEffect(() => {
  const loadPalliativeInitialData = async () => {
    if (!isPalliativeMedicineSpecialist || !patientId || !doctorId) {
      setPalliativeInitialData(null);
      return;
    }
    setPalliativeDataLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/palliative-assessment/history/${patientId}/${doctorId}`
      );
      const json = await res.json();
      if (json?.status === "success" && Array.isArray(json.data) && json.data.length > 0) {
        // history is already sorted most-recent-first by the backend,
        // but sort defensively here too in case that ever changes
        const sorted = [...json.data].sort(
          (a, b) => new Date(b.created_at || b.saved_at) - new Date(a.created_at || a.saved_at)
        );
        const latest = sorted[0];
        // Backend saves the assessment under "palliative_assessment" (snake_case) —
        // same key PalliativeAssessmentSummary.jsx reads. Fallback to camelCase
        // in case that's ever changed going forward.
        const assessment = latest?.palliative_assessment || latest?.palliativeAssessment || null;
        setPalliativeInitialData(assessment);
      } else {
        setPalliativeInitialData(null);
      }
    } catch (err) {
      console.error("Failed to load palliative assessment initial data:", err);
      setPalliativeInitialData(null);
    } finally {
      setPalliativeDataLoading(false);
    }
  };
  loadPalliativeInitialData();

  // Refetch if a save happens elsewhere (mirrors PalliativeAssessmentSummary's listener)
  const handler = () => loadPalliativeInitialData();
  window.addEventListener("refreshPalliativeAssessmentHistory", handler);
  return () => window.removeEventListener("refreshPalliativeAssessmentHistory", handler);
}, [isPalliativeMedicineSpecialist, patientId, doctorId]);
  const handleTreatmentPlanApprove = (formattedPlan) => {
    setDictationTranscript((prev) => prev && prev.trim() ? prev + formattedPlan : formattedPlan);
  };
  const hasTreatmentProtocol = (
  analyzedData,
  dictationText = ""
) => {
  return dictationText
    ?.toLowerCase()
    .includes("treatment protocol");
};
  const saveDiagnosis = async () => {
    const diagnosis = diagnosisText?.trim();
    if (!diagnosis) { alert("⚠️ Please enter diagnosis or 'Nil'"); return; }
    try {
      await fetch(`${API_BASE_URL}hms/users/data/context/diagnosis/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, diagnosis }) });
    } catch (err) { console.error("❌ Diagnosis save failed:", err); }
  };
const scrollToSection = (ref) => {
  ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
};
const saveContextData = async () => {
  
  console.log("saveContextData function was called!");
  
  try {
    const response = await fetch(`${API_BASE_URL}hms/users/data/context/context/save`, { 
      method: "POST", 
      headers: { "Content-Type": "application/json" }, 
      body: JSON.stringify({ 
        patient_id: patientId, 
        doctor_id: doctorId, 
        appointment_id: currentAppointmentId,
        current_clinical_context: nodeData["current-clinical-context"], 
        medical_clinical_context: nodeData["medical-clinical-context"] 
      }) 
    });
    const result = await response.json();
    console.log("Response:", result);
    
  } catch (err) { 
    console.error("❌ Context save failed:", err); 
    alert("Error: " + err.message);
  }
};
  const fetchPatientProfileDefinition = async (doctorId) => {
    try {
      if (!doctorId) return [];
      const res = await fetch(`${API_BASE_URL}hms/users/orchestration/doctor_patient_features/${doctorId}`);
      const json = await res.json();
      return json?.features || [];
    } catch { return []; }
  };
const handleDocTabChange = async (_, v) => {
  const nodeId = DOC_IDS[v];

  if (!currentDictation?.trim()) {
    alert("Please run transcription first");
    return;
  }

  setDocTab(v);

  // ❗ Already loaded → don't reload
  if (nodeData[nodeId]) return;

  try {
    setLoadingDoc(nodeId); // ✅ START spinner

    const data = await runDictationFeatureWithText(
      nodeId,
      currentDictation,
      analyzedDictation
    );

    setNodeData((prev) => ({
      ...prev,
      [nodeId]: data,
    }));
  } catch (err) {
    console.error(`❌ Failed to load ${nodeId}:`, err);
  } finally {
    setLoadingDoc(null); // ✅ STOP spinner
  }
};
  const fetchFeatureData = async (nodeId) => {
    const node = enabledNodes.find((n) => n.node_id === nodeId);
    if (node?.requires_dictation && !currentDictation.trim()) return null;
    const endpoint = nodeId === "patient-profile"
      ? `${API_BASE_URL}hms/users/orchestration/execute-feature-db`
      : `${API_BASE_URL}hms/users/orchestration/process-feature-with-fetched-data1`;
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, feature_id: nodeId, dictation: currentDictation }) });
      const json = await res.json();
      if (nodeId === "patient-profile") return json?.data?.profile_retrieved?.profile_data || null;
      return json?.finaloutput || null;
    } catch { return null; }
  };


useEffect(() => {
  const loadDiagnosisContext = async () => {
    if (!patientId || !doctorId) return;

    try {
      // 1. Try latest diagnosis
      const diagnosisRes = await fetch(
        `${API_BASE_URL}hms/users/data/context/diagnosis/history/${patientId}/${doctorId}`
      );

      const diagnosisJson = await diagnosisRes.json();

      if (
        diagnosisJson.status === "success" &&
        diagnosisJson.count > 0
      ) {
        const latestDiagnosis = diagnosisJson.data[0]?.diagnosis;

        if (
          latestDiagnosis &&
          latestDiagnosis.trim() !== "" &&
          latestDiagnosis !== "Nil"
        ) {
          setDiagnosisText(latestDiagnosis);
          return;
        }
      }

      // 2. Fallback to Patient Summary
      const summaryRes = await fetch(
        `${API_BASE_URL}hms/users/data/context/patient-summary/${patientId}`
      );

      const summaryJson = await summaryRes.json();

      if (summaryJson.status === "success") {
        const summary = summaryJson.data?.summary;

        // Prefer confirmed diagnosis
        if (
          summary?.confirmed_diagnoses &&
          summary.confirmed_diagnoses.length > 0
        ) {
          setDiagnosisText(summary.confirmed_diagnoses[0]);
          return;
        }

        // Otherwise use diagnosis header
        if (summary?.diagnosis_header) {
          setDiagnosisText(
            summary.diagnosis_header.replace(/\*\*/g, "")
          );
          return;
        }
      }

      // Nothing found
      setDiagnosisText("");
    } catch (err) {
      console.error("Error loading diagnosis:", err);
      setDiagnosisText("");
    }
  };

  loadDiagnosisContext();
}, [patientId, doctorId]);

  useEffect(() => {
    const load = async () => {
      try {
        const [featureRes, patientDefs] = await Promise.all([
          fetch(`${API_BASE_URL}hms/users/orchestration/get-doctor-features/${doctorId}`),
          fetchPatientProfileDefinition(doctorId),
        ]);
        const json = await featureRes.json();
        const apiFeatures = json?.status === "success" && Array.isArray(json.features) ? json.features : [];
        const forcedMap = new Map(FORCED_FEATURE_DEFINITIONS.map((f) => [String(f.feature_id).trim().toLowerCase(), f]));
        const mergedFeatures = apiFeatures.map((f) => {
          const id = String(f.feature_id).trim().toLowerCase();
          return forcedMap.has(id) ? { ...f, ...forcedMap.get(id) } : f;
        });
        FORCED_FEATURE_DEFINITIONS.forEach((forced) => {
          if (!mergedFeatures.some((f) => String(f.feature_id).trim().toLowerCase() === forced.feature_id.toLowerCase()))
            mergedFeatures.unshift(forced);
        });
        const patientProfileIds = new Set(patientDefs.map((p) => String(p.feature_id).trim().toLowerCase()));
        const DICTATION_IDS = new Set(["documentation-medication-analysis", "documentation-clinical-notes", "documentation-investigation-notes", "documentation-treatment-plan", "documentation-discharge-summary", "documentation-clinical-summary", "documentation-referral-letter"]);
        const nodes = mergedFeatures
          .filter((f) => f.enabled || ALWAYS_ENABLED_NODE_IDS.has(String(f.feature_id).trim().toLowerCase()))
          .map((f) => {
            const isProfile = patientProfileIds.has(String(f.feature_id).trim().toLowerCase());
            return { node_id: f.feature_id, node_name: f.feature_name, category: f.category, priority: f.priority, display_mode: isProfile ? "profile" : null, requires_dictation: DICTATION_IDS.has(String(f.feature_id).trim().toLowerCase()), heightVariant: stableHeightVariant(f.feature_id), components: [{ type: f.display_method, title: f.feature_name, data: null, trigger: isProfile ? { type: "page-reload" } : f.trigger, display_mode: isProfile ? "profile" : null }] };
          });
        const alwaysNodes = [
          { node_id: "current-clinical-context", node_name: "Current Clinical Context", components: [{ type: "canvas", title: "Current Clinical Context", data: null, trigger: { type: "page-reload" } }] },
          { node_id: "medical-clinical-context", node_name: "Medical Clinical Context", components: [{ type: "canvas", title: "Medical Clinical Context", data: null, trigger: { type: "page-reload" } }] },
        ];
        alwaysNodes.forEach((an) => {
          if (!nodes.some((n) => n.node_id === an.node_id))
            nodes.unshift({ ...an, category: "patient-data", priority: "high", requires_dictation: false, heightVariant: stableHeightVariant(an.node_id) });
        });
        if (!nodes.some((n) => n.node_id === "patient-profile")) {
          nodes.unshift({ node_id: "patient-profile", node_name: "Patient Profile", category: "patient-data", priority: "high", display_mode: "profile", requires_dictation: false, heightVariant: stableHeightVariant("patient-profile"), components: [{ type: "profile", title: "Patient Profile", data: null, trigger: { type: "page-reload" }, display_mode: "profile" }] });
        }
        setEnabledNodes(nodes);
        nodes.forEach(async (node) => {
          if (node.components[0].trigger?.type !== "page-reload") return;
          if (pageReloadExecutedRef.current.has(node.node_id)) return;
          if (node.requires_dictation && !currentDictation.trim()) return;
          pageReloadExecutedRef.current.add(node.node_id);
          const data = await fetchFeatureData(node.node_id);
          setNodeData((prev) => ({ ...prev, [node.node_id]: data }));
        });
      } catch (err) { console.error("Error loading features:", err); }
    };
    load();
  }, []);

  // ─── Actions ─────────────────────────────────────────────────────────────────
  const reloadSingleNode = async (nodeId) => {
    setReloadingNode(nodeId);
    try { const data = await fetchFeatureData(nodeId); setNodeData((prev) => ({ ...prev, [nodeId]: data })); }
    finally { setTimeout(() => setReloadingNode(null), 500); }
  };

  const startOnboarding = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical-reasoning-summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }) });
      const json = await res.json();
      setOnboardingStatus("processing");
      const interval = setInterval(async () => {
        const status = await checkOnboardingStatus();
        if (status === "completed") { setPatientSummaryTrigger((prev) => prev + 1); clearInterval(interval); }
      }, 15000);
    } catch (err) { console.error("Onboarding failed:", err); }
  };
const navigateToSection = (tab, ref = null, contextTabValue = null) => {
  console.log("=== navigateToSection called ===");
  console.log("Target tab:", tab);
  console.log("Current mainTab:", mainTab);
  console.log("Ref exists:", !!ref);
  console.log("Ref current:", ref?.current);
  console.log("Context tab value:", contextTabValue);
  
  // Only change tab if it's different from current
  if (mainTab !== tab) {
    console.log("Switching tab from", mainTab, "to", tab);
    setMainTab(tab);
    
    // Wait for tab change to complete before scrolling
    setTimeout(() => {
      console.log("Attempting scroll after tab change");
      if (ref?.current) {
        console.log("Found ref after tab change, scrolling to:", ref.current);
        ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        console.log("Ref still not available after tab change");
        // Try one more time
        setTimeout(() => {
          if (ref?.current) {
            console.log("Ref available on second attempt, scrolling");
            ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            console.error("Ref never became available for:", tab);
          }
        }, 300);
      }
    }, 300);
  } else {
    console.log("Already on correct tab, scrolling immediately");
    
    // If we need to switch to a specific tab within the clinical insights
    if (contextTabValue !== null && tab === "clinical") {
      console.log("Setting context tab index to:", contextTabValue);
      setContextTabIndex(contextTabValue);
      
      // Wait for context tab to change
      setTimeout(() => {
        if (ref?.current) {
          console.log("Scrolling to ref after context tab change");
          ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          console.log("Ref not found after context tab change");
        }
      }, 200);
    } else {
      // Scroll immediately
      if (ref?.current) {
        console.log("Scrolling to ref immediately");
        ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        console.log("Ref not available immediately, waiting...");
        setTimeout(() => {
          if (ref?.current) {
            console.log("Ref available after delay, scrolling");
            ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            console.error("Ref never became available for:", tab);
          }
        }, 200);
      }
    }
  }
};
  const checkOnboardingStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/status/summary/${patientId}/${doctorId}`);
      const json = await res.json();
      setOnboardingStatus(json.status);
      return json.status;
    } catch (err) { console.error("Status check failed", err); return null; }
  };

  const runCurrentClinicalContext = async (dictationText) => {
    setReloadingNode("current-clinical-context");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/orchestration/process-feature-with-fetched-data1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, feature_id: "current-clinical-context", dictation: dictationText }) });
      const json = await res.json();
      setNodeData((prev) => ({ ...prev, "current-clinical-context": json?.finaloutput ?? null }));
    } finally { setReloadingNode(null); }
  };
const runAgenticMedication = async (dictationText) => {
  if (!dictationText?.trim()) return;

  setIsAgenticMedLoading(true);

  try {
    const res = await fetch(
      `${API_BASE_URL}hms/users/ai-legacy/medication-agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          prescription_text: dictationText,
        }),
      }
    );

    const json = await res.json();

    const cleanedJson = {
      prescriptions: (json.prescriptions || []).map(
        ({
          raw_extracted_text,
          safety_alerts,
          ...rest
        }) => rest
      ),
    };

    console.log("CLEANED JSON", cleanedJson);

    setAgenticMedData(json);

    setNodeData((prev) => ({
      ...prev,
      "documentation-medication-analysis": cleanedJson,
    }));

  return cleanedJson;
  } catch (err) {
    console.error("❌ Agentic medication failed:", err);
  } finally {
    setIsAgenticMedLoading(false);
  }
};
  const runDictationFeatureWithText = async (
  nodeId,
  dictationText,
  analyzedJson
) => {

  if (
  nodeId === "documentation-medication-analysis" &&
  !hasTreatmentProtocol(analyzedJson, dictationText)
) {
  const json = await runAgenticMedication(dictationText);
  console.log("RETURNING FROM AGENTIC", json);

  return json;
}

  try {
    const res = await fetch(
      `${API_BASE_URL}hms/users/orchestration/generate_documentation_with_suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, feature_id: nodeId, dictation: dictationText, output_json: analyzedJson ?? analyzedDictation ?? null, objectives: nodeId === "documentation-treatment-plan" ? treatmentObjective : null }) });
      const json = await res.json();
      return json?.finaloutput ?? null;
    } catch { return null; }
  };

  const runAllDictationNodes = async (dictationText, analyzedJson) => {
    if (!dictationText?.trim()) return;
    const dictationNodes = enabledNodes.filter((n) => n.requires_dictation);
    if (!dictationNodes.length) return;
    setReloadingNode("ALL");
    try {
      const results = await Promise.all(dictationNodes.map(async (node) => ({ nodeId: node.node_id, data: await runDictationFeatureWithText(node.node_id, dictationText, analyzedJson) })));
      setNodeData((prev) => { const updated = { ...prev }; results.forEach((r) => { updated[r.nodeId] = r.data; }); return updated; });
    } finally { setReloadingNode(null); }
  };

  const runSummaryDictation = async (featureId, dictationText, analyzedJson) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/orchestration/generate_documentation_with_suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, feature_id: featureId, dictation: dictationText, output_json: analyzedJson ?? null }) });
      const json = await res.json();
      setNodeData((prev) => ({ ...prev, [featureId]: json?.finaloutput ?? null }));
    } catch (err) { console.error(`❌ ${featureId} dictation failed:`, err); }
  };

  const completeAppointment = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/doctors/complete-appointment/${doctorId}/${patientId}`, { method: "PUT", headers: { "Content-Type": "application/json" } });
      return res.ok;
    } catch { return false; }
  };

  const handleSave = async () => {
    try {
      const diagnosis = diagnosisText?.trim();
      if (!diagnosis) {
        alert("⚠️ Diagnosis is required. If no diagnosis, please enter 'Nil'.");
        return;
      }
      if (diagnosis.length < 2 && diagnosis.toLowerCase() !== "nil") {
        alert("⚠️ Please enter a valid diagnosis or 'Nil'.");
        return;
      }
      
      // Calculate document count - only count TreatmentPlan if it has data
      let documentCount = 0;
      if (treatmentPlanRef.current && hasTreatmentPlanData) documentCount++;
      documentCount += enabledNodes.filter((n) => n.requires_dictation && n.node_id !== "documentation-treatment-plan" && nodeData[n.node_id]).length;
      
      if (documentCount === 0) {
        alert("No documentation available to save");
        return;
      }
      
      // Show popup and start saving immediately
      setSaveDocumentCount(documentCount);
      setSavePopupOpen(true);
      setIsSaving(true);
      setSaveSuccess(false);
      setSaveError(null);
      
      // Perform save
      await saveDiagnosis();
      await saveContextData();
const investigationData = nodeData["documentation-investigation-notes"];
      if (investigationData?.investigation_orders?.length > 0) {
        const failedInvestigations = [];

        for (const inv of investigationData.investigation_orders) {
          try {
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/oncology-investigations`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                patient_id: patientId,
                doctor_id: doctorId,
                investigation_type: inv.investigation_name || inv.category || "General",
                clinical_indication: inv.standard_indications || "",
                parameters: inv.parameters || [],
              }),
            });

            const json = await res.json().catch(() => ({}));

            if (!res.ok) {
              throw new Error(json.detail || `Failed to save: ${inv.investigation_name}`);
            }
          } catch (err) {
            console.error(`❌ Failed to save investigation "${inv.investigation_name}":`, err);
            failedInvestigations.push(inv.investigation_name);
            // Continue to the next investigation rather than aborting the whole save
          }
        }

        if (failedInvestigations.length > 0) {
          console.warn(`⚠️ ${failedInvestigations.length} investigation(s) failed to save:`, failedInvestigations);
        }
      }
      const documents = [];
      if (treatmentPlanRef.current && hasTreatmentPlanData) {
        const doc = treatmentPlanRef.current.saveTreatmentPlanData();
        if (doc) documents.push(doc);
      }
      const otherDocs = enabledNodes
        .filter((n) => n.requires_dictation && n.node_id !== "documentation-treatment-plan" && nodeData[n.node_id])
        .map((n) => ({
          status: "success",
          feature_id: n.node_id,
          feature_name: n.node_name,
          display_method: n.components?.[0]?.type || "text",
          finaloutput: nodeData[n.node_id],
          metadata: { doctor_id: doctorId, patient_id: patientId, saved_from: "doctor-dashboard" },
        }));
      documents.push(...otherDocs);
      
      if (prognosisRef.current?.savePrognosisData) {
        try {
          await prognosisRef.current.savePrognosisData();
        } catch {}
      }
      console.log(
        "MED NODE",
        nodeData["documentation-medication-analysis"]
      );
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/save_documentation_features_bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents }),
      });
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.message || "Unknown error");
      }
      
      // Success
      setIsSaving(false);
      setSaveSuccess(true);

setTimeout(() => {
  const openEducation = window.confirm(
    "Session saved successfully.\n\nDo you want to generate Patient Education?"
  );

  if (openEducation) {
    setPatientEducationOpen(true);
  }
}, 500);
      await completeAppointment();
      
    } catch (err) {
      console.error("Save error:", err);
      setIsSaving(false);
      setSaveError(err.message || "Unexpected error while saving");
    }
  };

  // New function to actually perform the save
  const performSave = async () => {
    setIsSaving(true);
    try {
      await saveDiagnosis();
      const documents = [];
      if (treatmentPlanRef.current) {
        const doc = treatmentPlanRef.current.saveTreatmentPlanData();
        if (doc) documents.push(doc);
      }
      const otherDocs = enabledNodes
        .filter((n) => n.requires_dictation && n.node_id !== "documentation-treatment-plan" && nodeData[n.node_id])
        .map((n) => ({
          status: "success",
          feature_id: n.node_id,
          feature_name: n.node_name,
          display_method: n.components?.[0]?.type || "text",
          finaloutput: nodeData[n.node_id],
          metadata: { doctor_id: doctorId, patient_id: patientId, saved_from: "doctor-dashboard" },
        }));
      documents.push(...otherDocs);
      
      if (prognosisRef.current?.savePrognosisData) {
        try {
          await prognosisRef.current.savePrognosisData();
        } catch {}
      }
      
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/save_documentation_features_bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents }),
      });
      const json = await res.json();
      
      if (!res.ok) {
        alert(`Failed to save: ${json.message || "Unknown error"}`);
        setSavePopupOpen(false);
        setIsSaving(false);
        return;
      }
      
      // Show success briefly then close
      setTimeout(() => {
        setSavePopupOpen(false);
        setIsSaving(false);
        completeAppointment();
      }, 1500);
    } catch (err) {
      console.error("Save error:", err);
      alert("Unexpected error while saving");
      setSavePopupOpen(false);
      setIsSaving(false);
    }
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setEnabledNodes((items) => {
      const oldIdx = items.findIndex((n) => n.node_id === active.id);
      const newIdx = items.findIndex((n) => n.node_id === over.id);
      const updated = [...items];
      const [moved] = updated.splice(oldIdx, 1);
      updated.splice(newIdx, 0, moved);
      return updated;
    });
  };

  const isTabNode = (nodeId) => selectedTabNodes.some((t) => t.node_id === nodeId);

  // ─── Render doc panel ─────────────────────────────────────────────────────
  // const renderDocPanel = (activeId) => {
  //   const node = enabledNodes.find((n) => n.node_id === activeId);
  //   const setDoc = (payload) => setNodeData((prev) => ({ ...prev, [activeId]: payload }));
  //   if (activeId === "documentation-medication-analysis") return <MedicationPanel data={nodeData[activeId]} metadata={{ patient_id: patientId, doctor_id: doctorId }} diagnosisText={diagnosisText} onSave={(p) => setDoc({ prescriptions: p.prescriptions })} />;
  //   if (activeId === "documentation-clinical-notes") return <ClinicalNotesPanel data={nodeData[activeId]} metadata={{ doctor_id: doctorId, patient_id: patientId }} onSave={setDoc} />;
  //   if (activeId === "documentation-investigation-notes") return <InvestigationNotes data={nodeData[activeId]} doctorId={doctorId} patientId={patientId} onSave={setDoc} />;
  //   if (activeId === "documentation-treatment-plan") return <TreatmentPlan ref={treatmentPlanRef} doctorId={doctorId} patientId={patientId} treatmentObjective={treatmentObjective} dictationData={nodeData[activeId]} dictationText={currentDictation} onTreatmentObjectiveChange={setTreatmentObjective} reloadTrigger={dictationRun} />;
  //   if (activeId === "documentation-discharge-summary") return <DischargeSummaryPanel doctorId={doctorId} patientId={patientId} data={nodeData[activeId] ?? null} onSave={setDoc} />;
  //   if (activeId === "documentation-clinical-summary") return <ClinicalSummaryPanel doctorId={doctorId} patientId={patientId} data={nodeData[activeId] ?? null} onSave={setDoc} />;
  //   if (activeId === "documentation-referral-letter") return <ReferralLetterPanel doctorId={doctorId} patientId={patientId} data={nodeData[activeId] ?? null} onSave={setDoc} />;
  //   if (activeId === "structured-note") return <StructuredNotePanel doctorId={doctorId} patientId={patientId} dictation={currentDictation} />;
  //   if (node) return <NodeCanvas node={node} data={nodeData[activeId] ?? null} />;
  //   return <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Documentation module not available</Typography>;
  // };

  const renderDocPanel = (activeId) => {
    const node = enabledNodes.find((n) => n.node_id === activeId);
    const setDoc = (payload) => setNodeData((prev) => ({ ...prev, [activeId]: payload }));
    
    if (activeId === "documentation-medication-analysis") {

      const protocolExists = hasTreatmentProtocol(
        analyzedDictation,
        currentDictation
      );

      if (!protocolExists && agenticMedData) {
        return (
          <AgenticMedicationPanel
            data={agenticMedData}
            patientId={patientId}
            doctorId={doctorId}
            diagnosisText={diagnosisText}
            onSave={(updatedData) => {
              setAgenticMedData(updatedData);

              setNodeData((prev) => ({
                ...prev,
                "documentation-medication-analysis": updatedData,
              }));
            }}
          />
        );
      }

      return (
        <MedicationPanel
          data={nodeData[activeId]}
          metadata={{
            patient_id: patientId,
            doctor_id: doctorId,
          }}
          diagnosisText={diagnosisText}
          onSave={(p) =>
            setDoc({
              prescriptions: p.prescriptions,
            })
          }
        />
      );
    }
    if (activeId === "documentation-clinical-notes") return <ClinicalNotesPanel data={nodeData[activeId]} metadata={{ doctor_id: doctorId, patient_id: patientId }} onSave={setDoc} />;
    if (activeId === "documentation-investigation-notes") return <InvestigationNotes data={nodeData[activeId]} doctorId={doctorId} patientId={patientId} onSave={setDoc} />;
    if (activeId === "documentation-treatment-plan") return <TreatmentPlan ref={treatmentPlanRef} doctorId={doctorId} patientId={patientId} treatmentObjective={treatmentObjective} dictationData={nodeData[activeId]} dictationText={currentDictation} onTreatmentObjectiveChange={setTreatmentObjective} reloadTrigger={dictationRun} />;
    if (activeId === "documentation-discharge-summary") return <DischargeSummaryPanel doctorId={doctorId} patientId={patientId} data={nodeData[activeId] ?? null} onSave={setDoc} />;
    if (activeId === "documentation-clinical-summary") return <ClinicalSummaryPanel doctorId={doctorId} patientId={patientId} data={nodeData[activeId] ?? null} onSave={setDoc} />;
    if (activeId === "documentation-referral-letter") return <ReferralLetterPanel doctorId={doctorId} patientId={patientId} data={nodeData[activeId] ?? null} onSave={setDoc} />;
    if (activeId === "structured-note") return <StructuredNotePanel doctorId={doctorId} patientId={patientId} dictation={currentDictation} />;
    if (node) return <NodeCanvas node={node} data={nodeData[activeId] ?? null} />;
    return <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Documentation module not available</Typography>;
  };

  // ─── Sidebar ─────────────────────────────────────────────────────────────
  const sidebarContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: C.white }}>
      {/* Logo */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}` }}>
        <Box component="img" src={LogoSource} sx={{ width: 28, height: 28, filter: "grayscale(100%)" }} />
        <Box>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, letterSpacing: "0.08em" }) }}>
            DOCTOR<span style={{ fontWeight: 600 }}>ASSIST.AI</span>
          </Typography>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>Smart Dashboard</Typography>
        </Box>
      </Box>

      {/* Doctor info */}
      <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }) }}>Physician</Typography>
        <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>{doctorName || "Loading..."}</Typography>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{doctorSpeciality || "..."}</Typography>
      </Box>

      {/* Nav sections */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {/* Overview */}
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.1em", px: 1, pt: 1.5, pb: 0.75 }) }}>Overview</Typography>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={enabledNodes.map((n) => n.node_id)} strategy={verticalListSortingStrategy}>
            <List disablePadding>
              <ListItemButton onClick={() => navigateToSection("clinical", patientProfileRef)}>
                <ListItemText
                  primary="Patient Profile"
                  primaryTypographyProps={{
                    ...os({ fontSize: 12, color: C.charcoal }),
                  }}
                />
              </ListItemButton>

              <ListItemButton onClick={() => navigateToSection("clinical", patientSummaryRef, 0)}>
                <ListItemText
                  primary="Patient Summary"
                  primaryTypographyProps={{
                    ...os({ fontSize: 12, color: C.charcoal }),
                  }}
                />
              </ListItemButton>

              <ListItemButton onClick={() => navigateToSection("clinical", transcriptionRef)}>
                <ListItemText
                  primary="Transcription"
                  primaryTypographyProps={{
                    ...os({ fontSize: 12, color: C.charcoal }),
                  }}
                />
              </ListItemButton>

              <ListItemButton onClick={() => navigateToSection("clinical", documentationRef)}>
                <ListItemText
                  primary="Clinical Documentation"
                  primaryTypographyProps={{
                    ...os({ fontSize: 12, color: C.charcoal }),
                  }}
                />
              </ListItemButton>
              
              <ListItemButton onClick={() => navigateToSection("data", dataTabRef)}>
                <ListItemText 
                  primary="Data (Documents & Vitals)" 
                  primaryTypographyProps={{
                    ...os({ fontSize: 12, color: C.charcoal }),
                  }}
                />
              </ListItemButton>

              <ListItemButton onClick={() => navigateToSection("procedure", procedureTabRef)}>
                <ListItemText 
                  primary="Procedures" 
                  primaryTypographyProps={{
                    ...os({ fontSize: 12, color: C.charcoal }),
                  }}
                />
              </ListItemButton>
            </List>
          </SortableContext>
        </DndContext>

        {/* Feature toggles */}
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.1em", px: 1, pt: 2, pb: 0.75 }) }}>Features</Typography>
        {[
          { label: "Quick Notes", icon: <EditRounded sx={{ fontSize: 14 }} />, enabled: quickNoteEnabled, toggle: () => setQuickNoteEnabled((v) => !v) },
          { label: "DICOM Viewer", icon: <ImageRounded sx={{ fontSize: 14 }} />, enabled: dicomViewerEnabled, toggle: () => setDicomViewerEnabled((v) => !v) },
        ].map((f) => (
          <ListItemButton key={f.label} onClick={f.toggle} sx={{ borderRadius: "2px", mb: 0.25, py: 0.85, px: 1.25, "&:hover": { background: C.ghost }, transition: "all 0.12s" }}>
            <ListItemIcon sx={{ minWidth: 30, color: C.ash }}>{f.icon}</ListItemIcon>
            <ListItemText primary={<Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{f.label}</Typography>} />
            <Typography sx={{ ...os({ fontSize: 10, color: f.enabled ? C.ink : C.silver }) }}>{f.enabled ? "On" : "Off"}</Typography>
          </ListItemButton>
        ))}
      </Box>

      {/* Combine modules */}
      <Box sx={{ p: 2, borderTop: `1px solid ${C.fog}` }}>
        <Box component="button" type="button" onClick={(e) => setTabAnchor(e.currentTarget)} sx={{ ...actionButton, width: "100%", py: 1, fontSize: 11, borderRadius: "2px" }}>
          <AddRounded sx={{ fontSize: 14 }} /> Combine Modules
        </Box>
      </Box>
    </Box>
  );

  // ─── Main Tabs ────────────────────────────────────────────────────────────
  const mainTabs = [
    { label: "Clinical", value: "clinical" },
    { label: "Data", value: "data" },
    { label: "Procedural", value: "procedure" },
    { label: "Clinical Workflow", value: "agentic" },
    { label: "Insurance", value: "insurance" },
      ...(isAnaesthesiologist ? [{ label: "Pre-Anaesthesia Checkup", value: "pac" }] : []),
      ...(isAnaesthesiologist ? [{ label: "Anaesthesia", value: "anaesthesia" }] : []), // 👈 add

    // { label: "Longitudinal", value: "longitudinal" },
    ...(isOncologySpecialist ? [{ label: "Medical Board", value: "medical-board" }] : []),
    ...(isOncologySpecialist ? [{ 
      label: doctorSpeciality === "Surgical Oncology" ? "Surgical Workflow" :
             doctorSpeciality === "Medical Oncology" ? "Chemotherapy Workflow" :
             doctorSpeciality === "Radiation Oncology" ? "Radiation Workflow" :
             doctorSpeciality === "Pathology" ? "Pathology Workflow" :
             "Reports", 
      value: "reports" 
    }] : []),
    
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box
  sx={{
    fontSize: `${fontSize}px`, // 🔥 dynamic font
    "& *": {
      fontSize: "inherit !important", // 🔥 force override
    },
    height: "100vh",
    display: "flex", overflow: "hidden", background: C.ghost, fontFamily: FONT, fontWeight: FW }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Sidebar toggle */}
      <IconButton
        onClick={() => setOpen((p) => !p)}
        sx={{ position: "fixed", top: 14, left: 14, zIndex: 1400, width: 36, height: 36, background: C.white, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.charcoal, "&:hover": { background: C.ghost } }}
      >
        {open ? <Close sx={{ fontSize: 16 }} /> : <MenuRounded sx={{ fontSize: 16 }} />}
      </IconButton>

      {/* Sidebar */}
      <Drawer
        open={open}
        variant="temporary"
        onClose={() => setOpen(false)}
        sx={{
          width: SIDEBAR_WIDTH,
          "& .MuiDrawer-paper": {
            width: SIDEBAR_WIDTH,
            height: "100vh",
            background: C.white,
            borderRight: `1px solid ${C.fog}`,
            boxShadow: "2px 0 12px rgba(0,0,0,0.06)",
            fontFamily: FONT,
            fontWeight: FW,
            overflow: "hidden",
          },
        }}
      >
        {sidebarContent}
      </Drawer>

      {/* Main content */}
      <Box
        sx={{
          flex: 1,
          height: "100vh",
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT,
          fontWeight: FW,
          "@keyframes spin": {
      "0%": { transform: "rotate(0deg)" },
      "100%": { transform: "rotate(360deg)" },
    },
"@keyframes pulse": {
  "0%": { opacity: 0.4 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.4 },
},
    "& .canvas-root .MuiPaper-root": {
      background: "transparent !important",
    },
          "& .canvas-root .MuiPaper-root, & .canvas-root .MuiTableContainer-root, & .canvas-root .MuiCard-root": { background: "transparent !important", backdropFilter: "none", boxShadow: "none", border: "none" },
          "& .canvas-root .MuiTypography-root": { color: `${C.ink} !important`, fontFamily: `${FONT} !important`, fontWeight: `${FW} !important` },
          "& .canvas-root .MuiInputBase-root, & .canvas-root .MuiInputLabel-root": { color: `${C.ink} !important`, fontFamily: `${FONT} !important`, fontWeight: `${FW} !important` },
          "& .canvas-root table, & .canvas-root td, & .canvas-root th": { color: C.ink, fontFamily: FONT, fontWeight: FW },
        }}
      >
        {/* ─── Top Bar ──────────────────────────────────────────────────────── */}
        <Box sx={{ background: C.white, borderBottom: `1px solid ${C.fog}`, px: { xs: 2, sm: 3 }, pt: { xs: 3.5, sm: 2 }, pb: 0, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, pb: 1.5, flexWrap: "wrap", pl: { xs: 5, sm: 5 } }}>
            
            {/* Back + Title grouped together */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Tooltip title="Back">
                <IconButton
                  onClick={() => navigate(-1)}
                  size="small"
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                    color: C.smoke,
                    "&:hover": { background: C.ghost, color: C.ink },
                  }}
                >
                  <ArrowBackRounded sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>

              <Box>
                <Typography sx={{ ...os({ fontSize: { xs: 14, sm: 16 }, color: C.ink, letterSpacing: "0.02em" }) }}>
                  EMR MODULE
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                  {selectedTabNodes.length > 0 ? `${selectedTabNodes.length} modules combined` : "Doctor's Workspace"}
                </Typography>
              </Box>
            </Box>

            {/* Action icons */}

            {/* Action icons */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Tooltip title="Patient Onboarding">
                <IconButton onClick={() => { startOnboarding(); setShowOnboarding(true); }} size="small"
                  sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.smoke, "&:hover": { background: C.ghost, color: C.ink } }}>
                  <AddRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clinical Workspace">
                <IconButton size="small" onClick={() => { setAgenticOpen(true); setAgenticTrigger((v) => v + 1); }}
                  sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.smoke, "&:hover": { background: C.ghost, color: C.ink } }}>
                  <PsychologyRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
  <Typography sx={{ fontSize: 11, color: C.ash }}>
    Font
  </Typography>

  <Box
    component="select"
    value={fontSize}
    onChange={(e) => setFontSize(Number(e.target.value))}
    sx={{
      border: `1px solid ${C.fog}`,
      borderRadius: "2px",
      fontSize: 11,
      px: 1,
      py: 0.5,
      background: C.white,
      cursor: "pointer",
    }}
  >
    <option value={12}>Small</option>
    <option value={14}>Default</option>
    <option value={16}>Large</option>
    <option value={18}>XL</option>
  </Box>
</Box>
              <Tooltip title="Clinical Reasoning">
                <IconButton size="small" onClick={() => { setMainTab("clinical-reasoning"); setClinicalReasoningTrigger((p) => p + 1); }}
                  sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.smoke, "&:hover": { background: C.ghost, color: C.ink } }}>
                  <LocalHospital sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Quick Notes">
                <IconButton size="small" onClick={() => setShowNotesList(true)}
                  sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.smoke, "&:hover": { background: C.ghost, color: C.ink } }}>
                  <MessageRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Patient Conditions">
                <IconButton size="small" onClick={() => setConditionsOpen(true)}
                  sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.smoke, "&:hover": { background: C.ghost, color: C.ink } }}>
                  <Badge badgeContent={conditions.length} color="default" sx={{ "& .MuiBadge-badge": { fontSize: 9, height: 14, minWidth: 14, background: C.charcoal, color: C.white } }}>
                    <LocalHospital sx={{ fontSize: 15 }} />
                  </Badge>
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Main Tabs */}
          <Tabs value={mainTab} onChange={(_, v) => setMainTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
            sx={{ ...tabSx, pl: { xs: 5, sm: 5 }, "& .MuiTabs-root": { minHeight: 38 }, "& .MuiTab-root": { ...tabSx["& .MuiTab-root"], py: 1, minHeight: 38 } }}>
            {mainTabs.map((t) => <Tab key={t.value} label={t.label} value={t.value} />)}
          </Tabs>
        </Box>

        {/* ─── Page Content ─────────────────────────────────────────────────── */}
        <Box sx={{ flex: 1, overflowY: "auto", p: { xs: 2, sm: 2.5, md: 3 }, pb: 12 }}>

          {/* ═══ CLINICAL TAB ═══════════════════════════════════════════════ */}
          {mainTab === "clinical" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

              {/* Patient Profile */}
              {enabledNodes.find((n) => n.node_id === "patient-profile") && (
                <Box ref={patientProfileRef}>
                <PatientProfileCard data={nodeData["patient-profile"]} />
                </Box>
              )}
              {isFollowUp && (
                <ConsultationHistoryFollowUp
                  patientId={patientId}
                  doctorId={doctorId}
                  currentAppointmentId={currentAppointmentId}
                  isMobile={isMobile}
                />
              )}

{/* {visitType && visitType.toLowerCase().includes("emergency") && (
  <Box sx={{
    background: C.white,
    border: `1px solid ${C.fog}`,
    borderRadius: "4px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
    mb: 2,
  }}>

   
    <Box sx={{
      px: { xs: 2.5, sm: 3 }, py: 2,
      borderBottom: `1px solid ${C.fog}`,
      background: C.ghost,
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 2,
    }}>
      <Box>
        <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
          Triage Assessment
        </Typography>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mt: 0.4 }) }}>
          Emergency Visit
        </Typography>
      </Box>

      <Tooltip title="Refresh Triage Data">
        <IconButton
          size="small"
          onClick={() => setTriageRefreshTrigger(prev => prev + 1)}
          sx={{
            width: 28, height: 28,
            border: `1px solid ${C.fog}`,
            borderRadius: "2px",
            color: C.ash,
            flexShrink: 0,
            "&:hover": { background: C.fog, color: C.ink },
          }}
        >
          <RefreshRounded sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Box>

  
    <Box sx={{
      p: { xs: 2, sm: 2.5 },
      background: C.ghost,
      borderRadius: "0 0 4px 4px",
    }}>
      <TriageAssessment
        data={triageData}
        patientId={patientId}
        refreshTrigger={triageRefreshTrigger}
      />
    </Box>

  </Box>
)} */}
              {/* Clinical Insights */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="AI-powered analysis from patient history and dictation">Clinical Insights</SectionHeader>
                <Tabs value={contextTabIndex} onChange={(_, v) => setContextTabIndex(v)} sx={{ ...tabSx, px: 3 }}>
                  <Tab label="Patient Summary" />
                  <Tab label="Current Clinical Context" />
                  <Tab label="Medical Clinical Context" />
                  {medicalBoardPlanStatus === "visible" && <Tab label="Plans" />}
                </Tabs>
                <Box sx={{ p: { xs: 2, sm: 3 } }}>
                  {contextTabIndex === 0 && (
                    onboardingStatus === "processing"
                      ? <Box sx={{ py: 4, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Generating AI Patient Summary...</Typography></Box>
                      :<Box ref={patientSummaryRef}> 
                      <PatientSummary patientId={patientId} trigger={patientSummaryTrigger} />
                      </Box>
                  )}
                  {contextTabIndex === 1 && (
                    <Box>
                      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
                        <Tooltip title="Refresh">
                          <IconButton size="small" onClick={() => reloadSingleNode("current-clinical-context")} disabled={reloadingNode === "current-clinical-context"}
                            sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, "&:hover": { color: C.ink, background: C.ghost } }}>
                            <RefreshRounded sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <CurrentClinicalContextCard data={nodeData["current-clinical-context"]} />
                    </Box>
                  )}
                  {contextTabIndex === 2 && (
                    <Box>
                      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
                        <Tooltip title="Refresh">
                          <IconButton size="small" onClick={() => reloadSingleNode("medical-clinical-context")} disabled={reloadingNode === "medical-clinical-context"}
                            sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, "&:hover": { color: C.ink, background: C.ghost } }}>
                            <RefreshRounded sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <CurrentClinicalContextCard data={nodeData["medical-clinical-context"]} />
                    </Box>
                  )}
                  {/* Always mounted (hidden) so the plan status is known before the tab itself needs to appear */}
                  <Box sx={{ display: contextTabIndex === 3 ? "block" : "none" }}>
                    <MedicalBoardPlanTab
                      patientId={patientId}
                      doctorId={doctorId}
                      onStatusChange={setMedicalBoardPlanStatus}
                    />
                  </Box>
                </Box>
              </Box>

              {/* Dictation */}
              {/* Dictation */}
<Box sx={{ ...sectionCard }}>
  <Box sx={{
    px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 0,
    borderBottom: `1px solid ${C.fog}`,
    display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2,
  }}>
    <Box>
      <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
        Clinical Dictation
      </Typography>
      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
        {dictationMode === "auto"
          ? "Transcribe clinical notes by voice or text"
          : "Build a structured note manually using the section panels"}
      </Typography>
    </Box>

    {/* Auto / Manual toggle */}
    <Box sx={{
      display: "flex", border: `1px solid ${C.fog}`, borderRadius: "2px",
      overflow: "hidden", flexShrink: 0, mt: 0.5,
    }}>
      {["auto", "manual"].map((mode) => (
        <Box
          key={mode}
          component="button"
          type="button"
          onClick={() => setDictationMode(mode)}
          sx={{
            px: 2, py: 0.75,
            border: "none",
            background: dictationMode === mode ? C.black : C.white,
            color: dictationMode === mode ? C.white : C.ash,
            fontFamily: FONT, fontSize: 11, fontWeight: 300,
            cursor: "pointer", textTransform: "capitalize",
            letterSpacing: "0.04em",
            transition: "all 0.15s",
            "&:hover": dictationMode !== mode ? { background: C.ghost } : {},
          }}
        >
          {mode}
        </Box>
      ))}
    </Box>
  </Box>

  <Box sx={{ p: { xs: 2, sm: 3 } }}>
    <Box ref={transcriptionRef}>
      {dictationMode === "auto" ? (
        <GlassTranscriptionPanel
          onTranscribe={async ({ dictation, output_json }) => {
            if (!dictation?.trim()) return;

            setCurrentDictation(dictation);

            try {
              await fetch(`${API_BASE_URL}hms/users/orchestration/process-clinical-dictation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation }),
              });
            } catch (err) {
              console.error("❌ Failed to send dictation:", err);
            }

            const analyzedJson = output_json ?? null;
            if (analyzedJson) setAnalyzedDictation(analyzedJson);

            await runCurrentClinicalContext(dictation);

            setNodeData((prev) => {
              const updated = { ...prev };
              [
                "documentation-clinical-notes",
                "documentation-investigation-notes",
                "documentation-treatment-plan",
                "documentation-discharge-summary",
                "documentation-clinical-summary",
                "documentation-referral-letter",
              ].forEach((key) => { delete updated[key]; });
              return updated;
            });

            const medData = await runDictationFeatureWithText(
              "documentation-medication-analysis", dictation, analyzedJson
            );
            setNodeData((prev) => ({
              ...prev,
              "documentation-medication-analysis": medData,
            }));

            setDictationRun((v) => v + 1);
          }}
          doctorId={doctorId} patientId={patientId} reloadingNode={reloadingNode}
          treatmentObjective={treatmentObjective} onTreatmentObjectiveChange={setTreatmentObjective}
          externalTranscript={dictationTranscript} onTranscriptChange={setDictationTranscript}
        />
      ) : (
        <ManualPanel
        doctorId={doctorId}
          onTranscribe={async ({ dictation }) => {
            if (!dictation?.trim()) return;

            setCurrentDictation(dictation);
            setDictationTranscript(dictation);

            try {
              await fetch(`${API_BASE_URL}hms/users/orchestration/process-clinical-dictation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation }),
              });
            } catch (err) {
              console.error("❌ Failed to send manual dictation:", err);
            }

            await runCurrentClinicalContext(dictation);

            setNodeData((prev) => {
              const updated = { ...prev };
              [
                "documentation-clinical-notes",
                "documentation-investigation-notes",
                "documentation-treatment-plan",
                "documentation-discharge-summary",
                "documentation-clinical-summary",
                "documentation-referral-letter",
              ].forEach((key) => { delete updated[key]; });
              return updated;
            });

            const medData = await runDictationFeatureWithText(
              "documentation-medication-analysis", dictation, null
            );
            setNodeData((prev) => ({
              ...prev,
              "documentation-medication-analysis": medData,
            }));

            setDictationRun((v) => v + 1);
          }}
        />
      )}
    </Box>
  </Box>
</Box>
{isPainPalliativeSpecialist && (
  <PainManagementHistoryTables patientId={patientId} doctorId={doctorId} />
)}

{/* Pain Management — New / Follow Up — restricted to Onco Pain and Palliative Care */}

{isPainPalliativeSpecialist && (
  <PainManagementNewFollowUp
    doctorId={doctorId}
    patientId={patientId}
    patientName={nodeData?.["patient-profile"]?.name}
    onSave={async (payload) => {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/pain-management/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.status !== "success") {
        throw new Error(json.detail || json.message || "Failed to save pain management record");
      }
      window.dispatchEvent(new Event("refreshPainManagementHistory"));
    }}
  />
)}
{isPalliativeMedicineSpecialist && (
  <PalliativeAssessmentSummary patientId={patientId} doctorId={doctorId} />
)}
{isPalliativeMedicineSpecialist && !palliativeDataLoading && (
  <PalliativeAssessmentForm
    key={`palliative-${patientId}`}
    doctorId={doctorId}
    patientId={patientId}
    initialData={palliativeInitialData}
  />
)}
              {/* Diagnosis Analysis (Standard + Skill-Based) */}
<Box sx={{ ...sectionCard }}>
  <SectionHeader sub="Enter clinical findings for AI-assisted diagnosis — standard or skill-based">
    Diagnosis Analysis
  </SectionHeader>

  <Box sx={{ px: 3, pt: 1 }}>
    <Tabs value={diagnosisTabIndex} onChange={(_, v) => setDiagnosisTabIndex(v)} sx={tabSx}>
      <Tab label="Standard" />
      <Tab label="Skill-Based" />
    </Tabs>
  </Box>

  {/* ── Standard ── */}
  {diagnosisTabIndex === 0 && (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexDirection: { xs: "column", sm: "row" } }}>
        <textarea
          placeholder="Enter diagnosis details, symptoms, or clinical findings..."
          value={diagnosisText}
          onChange={(e) => setDiagnosisText(e.target.value)}
          style={{
            flex: 1, minHeight: "72px", padding: "10px 14px",
            border: `1px solid ${C.mist}`, borderRadius: "2px",
            background: C.white, fontFamily: FONT, fontSize: "13px",
            fontWeight: 300, color: C.ink, resize: "vertical", outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => { e.target.style.borderColor = C.charcoal; }}
          onBlur={(e) => { e.target.style.borderColor = C.mist; }}
        />
        <Box component="button" onClick={() => setOpenDiagnosis(true)}
          sx={{ ...actionButton, px: 2.5, py: 1.1, fontSize: 12, minWidth: 150, height: 44, whiteSpace: "nowrap", flexShrink: 0 }}>
          <LocalHospital sx={{ fontSize: 15 }} /> Analyse Diagnosis
        </Box>
      </Box>
    </Box>
  )}

  {/* ── Skill-Based ── */}
  {diagnosisTabIndex === 1 && (
    <Box>
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, display: "flex", justifyContent: "flex-end" }}>
        <Chip
          label="Specialized Skills"
          size="small"
          sx={{
            background: C.black, color: C.white, fontWeight: 300, fontSize: 10,
            letterSpacing: "0.04em", borderRadius: "2px", height: 22,
          }}
        />
      </Box>

      {diagnosisText && (
        <Box sx={{ mx: { xs: 2, sm: 3 }, mt: 1.5, mb: 2, p: 2, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
            Current Diagnosis Context
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>
            {diagnosisText}
          </Typography>
        </Box>
      )}

      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 3, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <Box
          component="button"
          onClick={() => {
            console.log("=".repeat(80));
            console.log("🎯 DIAGNOSIS GENERATION WITH SKILLS TRIGGERED");
            console.log("=".repeat(80));
            console.log("\n👤 PATIENT CONTEXT:");
            console.log(`   • Patient ID: ${patientId}`);
            console.log(`   • Doctor ID: ${doctorId}`);

            if (diagnosisText) {
              console.log(`\n📝 DIAGNOSIS CONTEXT INCLUDED:`);
              console.log(`   • "${diagnosisText}"`);
            } else {
              console.log(`\n📝 NO DIAGNOSIS CONTEXT PROVIDED - Using patient data only`);
            }

            console.log("\n🚀 Opening DiagnosisAnalysisskill Popup");
            console.log("=".repeat(80) + "\n");

            setOpenDiagnosisSkill(true);
          }}
          sx={{
            ...actionButton,
            px: 3, py: 1.1, fontSize: 12, minWidth: "200px", height: "42px",
            background: C.black,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            whiteSpace: "nowrap",
            "&:hover": { background: C.charcoal },
          }}
        >
          <LocalHospital sx={{ fontSize: 16, mr: 1 }} />
          Generate Diagnosis with Skills
        </Box>
      </Box>
    </Box>
  )}
</Box>

{/* AI Treatment Plan (Standard + Skill-Based) */}
<Box sx={{ ...sectionCard }}>
  <SectionHeader sub="Generate an AI-powered treatment plan — standard or skill-based">
    AI Treatment Plan Generator
  </SectionHeader>

  <Box sx={{ px: 3, pt: 1 }}>
    <Tabs value={treatmentTabIndex} onChange={(_, v) => setTreatmentTabIndex(v)} sx={tabSx}>
      <Tab label="Standard" />
      <Tab label="Skill-Based" />
    </Tabs>
  </Box>

  {/* ── Standard ── */}
  {treatmentTabIndex === 0 && (
    <Box>
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" onClick={() => setTreatmentPlanPopupOpen(true)}
          sx={{ ...actionButton, px: 2.5, py: 1, fontSize: 12, minWidth: 170, height: 38 }}>
          <LocalHospital sx={{ fontSize: 14 }} /> Generate Treatment Plan
        </Box>
      </Box>
      {diagnosisText && (
        <Box sx={{ mx: { xs: 2, sm: 3 }, my: 2, p: 2, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
            Current Diagnosis
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{diagnosisText}</Typography>
        </Box>
      )}
      <Box sx={{ pb: diagnosisText ? 0 : 2 }} />
    </Box>
  )}

  {/* ── Skill-Based ── */}
  {treatmentTabIndex === 1 && (
    <Box>
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, display: "flex", justifyContent: "flex-end" }}>
        <Chip
          label="Specialized Skills"
          size="small"
          sx={{
            background: C.black, color: C.white, fontWeight: 300, fontSize: 10,
            letterSpacing: "0.04em", borderRadius: "2px", height: 22,
          }}
        />
      </Box>

      {diagnosisSkillPrimary ? (
        <Box sx={{ mx: { xs: 2, sm: 3 }, mt: 1.5, mb: 2, p: 2, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
            Primary Diagnosis (from Skill-Based Analysis)
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400, mb: 0.5 }) }}>
            {diagnosisSkillPrimary}
          </Typography>
          {diagnosisSkillReason && (
            <>
              <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mt: 1, mb: 0.5 }) }}>
                Reason for Diagnosis
              </Typography>
              <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>
                {diagnosisSkillReason}
              </Typography>
            </>
          )}
        </Box>
      ) : (
        <Box sx={{ mx: { xs: 2, sm: 3 }, mt: 1.5, mb: 2, p: 2, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            ⚠️ No skill-based diagnosis available. Please run "Generate Diagnosis with Skills" first.
          </Typography>
        </Box>
      )}

      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 3, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <Box
          component="button"
          onClick={() => {
            console.log("=".repeat(80));
            console.log("🎯 TREATMENT PLAN GENERATION WITH SKILLS TRIGGERED");
            console.log("=".repeat(80));
            console.log("\n👤 PATIENT CONTEXT:");
            console.log(`   • Patient ID: ${patientId}`);
            console.log(`   • Doctor ID: ${doctorId}`);

            if (diagnosisSkillPrimary) {
              console.log(`\n📝 PRIMARY DIAGNOSIS (from Skill-Based Analysis):`);
              console.log(`   • Disease: ${diagnosisSkillPrimary}`);
              console.log(`   • Reason: ${diagnosisSkillReason || "Not provided"}`);
            } else {
              console.log(`\n⚠️ NO SKILL-BASED DIAGNOSIS AVAILABLE`);
              console.log(`   Please run "Generate Diagnosis with Skills" first`);
            }

            console.log("\n🚀 Opening Treatment Plan with Skills Popup");
            console.log("=".repeat(80) + "\n");

            setOpenTreatmentPlanSkill(true);
          }}
          sx={{
            ...actionButton,
            px: 3, py: 1.1, fontSize: 12, minWidth: "220px", height: "42px",
            background: C.black,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            whiteSpace: "nowrap",
            "&:hover": { background: C.charcoal },
            "&:disabled": {
              opacity: 0.4, cursor: "not-allowed",
              "&:hover": { background: C.black },
            },
          }}
          disabled={!diagnosisSkillPrimary}
        >
          <LocalHospital sx={{ fontSize: 16, mr: 1 }} />
          Generate Treatment Plan with Skills
        </Box>
      </Box>
    </Box>
  )}
</Box>

              {/* Documentation */}
              {/* Documentation */}
              <Box ref={documentationRef} sx={{ ...sectionCard }}>
                <SectionHeader sub="Auto-generated from dictation — review and edit before saving">Clinical Documentation</SectionHeader>
                <Box sx={{ px: 3, pt: 1 }}>
                  <Tabs value={docTab} onChange={handleDocTabChange} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={tabSx}>
                    {DOC_IDS.map((id) => <Tab key={id} label={DOCUMENTATION_LABELS[id]} />)}
                  </Tabs>
                </Box>
                <Box sx={{ p: { xs: 2, sm: 3 }, minHeight: 200, position: "relative" }}>
                  {loadingDoc === DOC_IDS[docTab] ? (
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 150 }}>
                      <RefreshRounded sx={{ fontSize: 28, color: C.ash, animation: "spin 1s linear infinite" }} />
                    </Box>
                  ) : (
                    <>
                      {/* Always render TreatmentPlan but hide it when not active */}
                      {/* Always render TreatmentPlan but hide it when not active */}
                      <Box sx={{ display: DOC_IDS[docTab] === "documentation-treatment-plan" ? "block" : "none" }}>
                        <TreatmentPlan 
                          ref={treatmentPlanRef} 
                          doctorId={doctorId} 
                          patientId={patientId} 
                          treatmentObjective={treatmentObjective} 
                          dictationData={nodeData["documentation-treatment-plan"]} 
                          dictationText={currentDictation} 
                          onTreatmentObjectiveChange={setTreatmentObjective} 
                          reloadTrigger={dictationRun}
                          onDataLoaded={setHasTreatmentPlanData}
                        />
                      </Box>
                      
                      {/* Render other panels normally */}
                      {DOC_IDS[docTab] !== "documentation-treatment-plan" && renderDocPanel(DOC_IDS[docTab])}
                    </>
                  )}
                </Box>
              </Box>

         
              {/* Treatment Response */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Analyze longitudinal response trends and treatment effectiveness">Treatment Response Analysis</SectionHeader>
                <Box sx={{ p: { xs: 2, sm: 3 } }}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
                      Click to open the treatment response dashboard for this patient.
                    </Typography>
                    <Box component="button" type="button" onClick={() => setTreatmentResponseOpen((p) => !p)}
                      sx={{ ...ghostButton, fontSize: 12, px: 2.5, py: 1 }}>
                      {treatmentResponseOpen ? "Hide Analysis" : "Open Analysis"}
                    </Box>
                  </Box>
                  {treatmentResponseOpen && (
                    <Box sx={{ mt: 2.5, pt: 2.5, borderTop: `1px solid ${C.fog}` }}>
                      <TreatmentResponseDashboard patientId={patientId} doctorId={doctorId} />
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* ═══ DATA TAB ════════════════════════════════════════════════════ */}
          {mainTab === "data" && (
            <Box 
            ref={dataTabRef}
            sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              
              {/* Patient Documents Section with Tabs */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="View medical records and patient images">Patient Records</SectionHeader>
                
                {/* Tabs for Medical Records and Patient Images */}
                <Box sx={{ px: 3, pt: 1 }}>
                  <Tabs 
                    value={patientDocTab} 
                    onChange={(_, v) => setPatientDocTab(v)} 
                    variant="scrollable" 
                    scrollButtons="auto" 
                    allowScrollButtonsMobile 
                    sx={tabSx}
                  >
                    <Tab label="Medical Records" />
                    <Tab label="Patient Images" />
                  </Tabs>
                </Box>
                
                <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                  {/* Medical Records Tab */}
                  {patientDocTab === 0 && (
                    <DocumentRetrieval patientId={patientId} doctorId={doctorId} />
                  )}
                  
                  {/* Patient Images Tab */}
                  {patientDocTab === 1 && (
                    <PatientImagesGallery patientId={patientId} doctorId={doctorId} />
                  )}
                </Box>
              </Box>

              <Box sx={{ ...sectionCard }}>
                <SectionHeader>Context History</SectionHeader>
                <Box sx={{ p: 3 }}><ContextHistoryPanel patientId={patientId} doctorId={doctorId} /></Box>
              </Box>

              <Box sx={{ ...sectionCard }}>
                <SectionHeader>Context History</SectionHeader>
                <Box sx={{ p: 3 }}><ContextHistoryPanel patientId={patientId} doctorId={doctorId} /></Box>
              </Box>
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Review medication, investigation, treatment, and clinical notes">Clinical Documentation</SectionHeader>
                <Box sx={{ px: 3, pt: 1 }}>
                  <Tabs value={dataDocTab} onChange={(_, v) => setDataDocTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={tabSx}>
                    {["Medication", "Investigation", "Treatment Plan", "Clinical Notes"].map((l) => <Tab key={l} label={l} />)}
                  </Tabs>
                </Box>
                <Box sx={{ p: { xs: 2, sm: 3 } }}>
                  {dataDocTab === 0 && <MedicationListPanel data={nodeData["documentation-medication-analysis"]} doctorId={doctorId} patientId={patientId} />}
                  {dataDocTab === 1 && <InvestigationListPanel data={nodeData["documentation-investigation-notes"]} doctorId={doctorId} patientId={patientId} />}
                  {dataDocTab === 2 && <TreatmentPlanPanel patientId={patientId} doctorId={doctorId} />}
                  {dataDocTab === 3 && <ClinicalNotePanel patientId={patientId} doctorId={doctorId} />}
                </Box>
              </Box>
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Real-time and historical vital signs">Vitals</SectionHeader>
                <Box sx={{ p: { xs: 2, sm: 2.5 } }}><VitalsPanel patientId={patientId} doctorId={doctorId} /></Box>
              </Box>


<PainManagementHistoryTables patientId={patientId} doctorId={doctorId} />
<PalliativeAssessmentSummary patientId={patientId} doctorId={doctorId} />

<ToxicitySurveillancePanel patientId={patientId} doctorId={doctorId} />
              <GenomicsPanel patientId={patientId} doctorId={doctorId} /> 
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="AI-assisted clinical assertion engine">Assertion Module</SectionHeader>
                <Box sx={{ p: 3 }}><AssertionNew doctorId={doctorId} patientId={patientId} /></Box>
              </Box>
               <Trend
    doctorId={doctorId}
    patientId={patientId}
  />
              
              {dicomViewerEnabled && (
                <Box sx={{ ...sectionCard }}>
                  <SectionHeader sub="Radiology images, CT, MRI, and ultrasound studies">DICOM Imaging Viewer</SectionHeader>
                  <Box sx={{ p: { xs: 2, sm: 3 }, minHeight: 500 }}><DICOMViewer patientId={patientId} doctorId={doctorId} /></Box>
                </Box>
              )}
            </Box>
          )}

          {/* ═══ PROCEDURE TAB ═══════════════════════════════════════════════ */}
       {mainTab === "procedure" && (
  <Box ref={procedureTabRef} sx={{ ...sectionCard }}>
    <SectionHeader sub="Step-by-step clinical procedure planning, execution, and documentation">Procedural Workflow</SectionHeader>
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {/* Just render this directly without the condition */}
        <ProcedureNotes
          patientId={patientId}
          doctorId={doctorId}
          doctorSpeciality={doctorSpeciality}
          patientName={nodeData?.["patient-profile"]?.name}
        />
    </Box>
  </Box>
)}


          {/* ═══ AGENTIC TAB ═════════════════════════════════════════════════ */}
          {mainTab === "agentic" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              
              <Box sx={{ ...sectionCard, overflow: "hidden" }}>
                <Predictivediseasepanel patientId={patientId} doctorId={doctorId}  />
              </Box>
            </Box>
          )}

          {/* ═══ CLINICAL REASONING TAB ══════════════════════════════════════ */}
          <Box sx={{ display: mainTab === "clinical-reasoning" ? "flex" : "none", flexDirection: "column", gap: 2.5 }}>
            <Box sx={{ ...sectionCard }}>
              <SectionHeader sub="Comprehensive AI-powered clinical analysis and decision support">Clinical Reasoning Engine</SectionHeader>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", px: 3, pb: 2 }}>
                {["Differential Diagnosis", "Risk Stratification", "Treatment Validation", "Medication Safety", "Discharge Planning"].map((c) => (
                  <Chip key={c} label={c} size="small" sx={{ fontSize: 11, background: C.ghost, color: C.smoke, border: `1px solid ${C.fog}`, ...os() }} />
                ))}
              </Box>
            </Box>
          </Box>

          {/* ═══ INSURANCE TAB ═══════════════════════════════════════════════ */}
          {mainTab === "insurance" && (
            <Box sx={{ ...sectionCard }}>
              <SectionHeader sub="Insurance eligibility, claims, approvals, and policy details">Insurance Management</SectionHeader>
              <Box sx={{ p: 3 }}><Unifiedinsurance patientId={patientId} doctorId={doctorId} /></Box>
            </Box>
          )}
          {mainTab === "pac" && isAnaesthesiologist && (
  <PreAnaesthesiaCheckup
    patientId={patientId}
    doctorId={doctorId}
    doctorName={doctorName}
  />
)}
       
          {mainTab === "anaesthesia" && isAnaesthesiologist && (
            <AnaesthesiaRecord
              patientId={patientId}
              doctorId={doctorId}
            />
          )}

          {/* ═══ LONGITUDINAL TAB ════════════════════════════════════════════ */}
          {/* {mainTab === "longitudinal" && (
            <Box sx={{ ...sectionCard }}>
              <SectionHeader sub="Time-series patient trends, vitals, treatment response, and clinical progression">Longitudinal Clinical Data</SectionHeader>
              <Box sx={{ p: { xs: 2, sm: 3 } }}><LongitudinalData patientId={patientId} doctorId={doctorId} /></Box>
            </Box>
          )} */}

          {/* ═══ TUMOR BOARD TAB ═════════════════════════════════════════════ */}
          {mainTab === "medical-board" && isOncologySpecialist && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              <TumorBoard doctorId={doctorId} patientId={patientId} doctorSpeciality={doctorSpeciality} doctorName={doctorName} />
            </Box>
          )}

                    {/* ═══ OT/ONCOLOGY RECORD TABS ═════════════════════════════════════ */}
          {mainTab === "reports" && isOncologySpecialist && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                  {doctorSpeciality === "Surgical Oncology" ? (
                      <OTRecord doctorId={doctorId} patientId={patientId} doctorName={doctorName} />
                  ) : doctorSpeciality === "Medical Oncology" ? (
                      <OPRecord doctorId={doctorId} patientId={patientId} />
                  ) : doctorSpeciality === "Radiation Oncology" ? (
                      <RadiotherapyRecord 
                          doctorId={doctorId} 
                          patientId={patientId} 
                          doctorSpeciality={doctorSpeciality} 
                          doctorName={doctorName} 
                      />
                  ) : doctorSpeciality === "Pathology" ? (
                    <OncoPathologyWorkflow 
                      doctorId={doctorId} 
                      patientId={patientId} 
                      doctorName={doctorName} 
                    />
                  ) : (
                      <Typography sx={{ p: 3, color: C.ash, ...os() }}>
                          No specific record module available for {doctorSpeciality}.
                      </Typography>
                  )}
              </Box>
          )}


        </Box>
      </Box>

      {/* ─── Save button ──────────────────────────────────────────────────── */}
      {/* ─── Save button ──────────────────────────────────────────────────── */}
      {mainTab !== "pain-management" && (
        <Box component="button" type="button" onClick={handleSave}
          sx={{ ...actionButton, position: "fixed", bottom: 20, right: 20, zIndex: 1500, px: 3, py: 1.25, fontSize: 12, borderRadius: "2px", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}>
          Save Session
        </Box>
      )}

      {/* ─── Combine Modules Menu ────────────────────────────────────────── */}
      <Menu anchorEl={tabAnchor} open={Boolean(tabAnchor)} onClose={() => setTabAnchor(null)}
        PaperProps={{ sx: { background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", minWidth: 240, maxHeight: 420 } }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>Select Modules to Combine</Typography>
        </Box>
        <Box sx={{ maxHeight: 300, overflow: "auto" }}>
          {enabledNodes.map((node) => {
            const selected = selectedTabNodes.some((n) => n.node_id === node.node_id);
            return (
              <MenuItem key={node.node_id}
                onClick={() => setSelectedTabNodes((prev) => selected ? prev.filter((n) => n.node_id !== node.node_id) : [...prev, node])}
                sx={{ py: 0.75, "&:hover": { background: C.ghost } }}>
                <Checkbox checked={selected} size="small" sx={{ color: C.mist, "&.Mui-checked": { color: C.black }, p: 0.5, mr: 1 }} />
                <ListItemText primary={<Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{node.node_name}</Typography>} />
              </MenuItem>
            );
          })}
        </Box>
        <Box sx={{ px: 2, py: 1.5, borderTop: `1px solid ${C.fog}`, display: "flex", justifyContent: "space-between", gap: 1 }}>
          <Box component="button" type="button" onClick={() => { setSelectedTabNodes([]); setActiveTabIndex(0); }}
            sx={{ ...ghostButton, fontSize: 11, px: 1.5, py: 0.6 }}>Clear</Box>
          <Box component="button" type="button" onClick={() => setTabAnchor(null)}
            sx={{ ...actionButton, fontSize: 11, px: 2, py: 0.6 }}>Apply</Box>
        </Box>
      </Menu>

      {/* ─── Quick Note (floating) ────────────────────────────────────────── */}
      {quickNoteEnabled && !isSmall && (
        <Box sx={{ position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)", zIndex: 1490 }}>
          <QuickNote onSave={(note) => alert(`Quick note saved with priority: ${note.priority}`)} />
        </Box>
      )}

      {/* ─── Quick Notes Modal ────────────────────────────────────────────── */}
      {showNotesList && (
        <>
          <Box onClick={() => setShowNotesList(false)} sx={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000 }} />
          <Box sx={{ position: "fixed", inset: 0, zIndex: 2001, display: "grid", placeItems: "center", p: 2, pointerEvents: "none" }}>
            <Box sx={{ background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 20px 40px rgba(0,0,0,0.14)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "90vh", width: "100%", maxWidth: "1100px", pointerEvents: "auto" }}>
              <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.ghost }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <MessageRounded sx={{ fontSize: 18, color: C.smoke }} />
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Quick Notes</Typography>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>View and manage all clinical notes</Typography>
                  </Box>
                </Box>
                <IconButton size="small" onClick={() => setShowNotesList(false)}
                  sx={{ color: C.ash, border: `1px solid ${C.fog}`, borderRadius: "2px", "&:hover": { background: C.fog } }}>
                  <CloseRounded sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
              <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
                {doctorId && patientId
                  ? <QuickNotesList doctorId={doctorId} patientId={patientId} refreshTrigger={showNotesList ? 1 : 0} />
                  : <Box sx={{ textAlign: "center", py: 6, opacity: 0.4 }}>
                    <Typography sx={{ ...os({ fontSize: 13 }) }}>No patient/doctor data</Typography>
                  </Box>
                }
              </Box>
              <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, display: "flex", justifyContent: "flex-end" }}>
                <Box component="button" type="button" onClick={() => setShowNotesList(false)}
                  sx={{ ...ghostButton, fontSize: 12 }}>Close</Box>
              </Box>
            </Box>
          </Box>
        </>
      )}

      {/* ─── Conditions Modal ─────────────────────────────────────────────── */}
      <Condition open={conditionsOpen} onClose={() => setConditionsOpen(false)} patientId={patientId} doctorId={doctorId} />

      {/* ─── Agentic Popup ────────────────────────────────────────────────── */}
      <AgenticPopup open={agenticOpen} onClose={() => setAgenticOpen(false)} doctorId={doctorId} patientId={patientId} trigger={agenticTrigger} onRun={() => setAgenticTrigger((v) => v + 1)} />

      {/* ─── Diagnosis Popup ─────────────────────────────────────────────── */}
      <DiagnosisAnalysis
        open={openDiagnosis} onClose={() => setOpenDiagnosis(false)}
        diagnosisText={diagnosisText} dictationTranscript={dictationTranscript}
        doctorId={doctorId} patientId={patientId}
        onApprove={(diagnosisBlock) => {
          setDiagnosisText(diagnosisBlock);
          setDictationTranscript((prev) => prev ? prev + "\n\n" + diagnosisBlock : diagnosisBlock);
          setCurrentDictation((prev) => prev ? prev + "\n\n" + diagnosisBlock : diagnosisBlock);
        }}
      />

      {/* ─── Treatment Plan Popup ─────────────────────────────────────────── */}
      <TreatmentPlanPopup
        open={treatmentPlanPopupOpen} onClose={() => setTreatmentPlanPopupOpen(false)}
        onApprove={handleTreatmentPlanApprove}
        doctorId={doctorId} patientId={patientId} diagnosisText={diagnosisText}
      />

      {/* Diagnosis Generation with Skills Popup */}
<DiagnosisAnalysisskill
  open={openDiagnosisSkill}
  onClose={() => {
    setOpenDiagnosisSkill(false);
    // Only close, don't update any states
  }}
  diagnosisText={diagnosisText}
  dictationTranscript={dictationTranscript}
  doctorId={doctorId}
  patientId={patientId}
  onApprove={(diagnosisBlock, primaryDiagnosis, reasonForDiagnosis) => {
    // ✅ ONLY update skill-based states
    if (primaryDiagnosis) {
      setDiagnosisSkillPrimary(primaryDiagnosis);
      setDiagnosisSkillReason(reasonForDiagnosis || "");
      console.log("💾 Skill-based diagnosis saved:", primaryDiagnosis);
      console.log("💾 Skill-based reason saved:", reasonForDiagnosis || "");
    }
    
    // ❌ DO NOT update these:
    // setDiagnosisText() - keep regular diagnosis text unchanged
    // setDictationTranscript() - keep regular dictation unchanged  
    // setCurrentDictation() - keep regular dictation unchanged
    
    // ✅ Close the popup
    setOpenDiagnosisSkill(false);
  }}
  onAddToTreatmentPlan={(diagnosisBlock, primaryDiagnosis, reasonForDiagnosis) => {
    console.log("📝 Adding to skill-based treatment plan:", diagnosisBlock);
    
    // ✅ ONLY update skill-based states
    if (primaryDiagnosis) {
      setDiagnosisSkillPrimary(primaryDiagnosis);
      setDiagnosisSkillReason(reasonForDiagnosis || "");
      console.log("💾 Skill-based diagnosis saved for treatment plan:", primaryDiagnosis);
      console.log("💾 Skill-based reason saved for treatment plan:", reasonForDiagnosis || "");
    }
    
    // ❌ DO NOT update regular diagnosis or dictation
    
    // ✅ Close the popup
    setOpenDiagnosisSkill(false);
  }}
/>

{/* Treatment Plan with Skills Popup */}
<TreatmentPlanSkill
  open={openTreatmentPlanSkill}
  onClose={() => setOpenTreatmentPlanSkill(false)}
  onApprove={(formattedPlan) => {
    console.log("📝 Treatment Plan with Skills approved:", formattedPlan);
    // Append to dictation
    setDictationTranscript(prev =>
      prev ? prev + "\n\n" + formattedPlan : formattedPlan
    );
    setCurrentDictation(prev =>
      prev ? prev + "\n\n" + formattedPlan : formattedPlan
    );
  }}
  doctorId={doctorId}
  patientId={patientId}
  primaryDiagnosis={diagnosisSkillPrimary}
  reasonForDiagnosis={diagnosisSkillReason}
/>

      {/* ─── Onboarding Modal ─────────────────────────────────────────────── */}
      {showOnboarding && (
        <>
          <Box onClick={() => setShowOnboarding(false)} sx={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 3000 }} />
          <Box sx={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3001 }}>
            <Box sx={{ background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 20px 40px rgba(0,0,0,0.12)", p: 4, textAlign: "center", position: "relative", width: 380, maxWidth: "90vw" }}>
              <IconButton size="small" onClick={() => setShowOnboarding(false)}
                sx={{ position: "absolute", top: 10, right: 10, color: C.ash, border: `1px solid ${C.fog}`, borderRadius: "2px", "&:hover": { background: C.ghost } }}>
                <CloseRounded sx={{ fontSize: 15 }} />
              </IconButton>
              <Typography sx={{ ...os({ fontSize: 14, color: C.ink, mb: 2 }) }}>Patient Onboarding</Typography>
              {(onboardingStatus === "processing" || onboardingStatus === "generating_summary") && (
                <>
                  <AgentLoader activeStep={currentStep} />
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
                    {onboardingStatus === "processing" ? "Processing patient records..." : "Generating AI patient summary..."}
                  </Typography>
                </>
              )}
              {onboardingStatus === "completed" && (
                <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Patient successfully onboarded.</Typography>
              )}
            </Box>
          </Box>
        </>
      )}

      {/* ─── Save Confirmation Popup ─────────────────────────────────────── */}
            {/* ─── Save Status Popup ──────────────────────────────────────────── */}
      <SaveStatusPopup
        open={savePopupOpen}
        onClose={() => {
          setSavePopupOpen(false);
          setIsSaving(false);
          setSaveSuccess(false);
          setSaveError(null);
        }}
        isSaving={isSaving}
        saveSuccess={saveSuccess}
        saveError={saveError}
        documentCount={saveDocumentCount}
      />
      <PatientEducation
  open={patientEducationOpen}
  onClose={() => setPatientEducationOpen(false)}
  patientId={patientId}
  doctorId={doctorId}
  patientName={
    nodeData?.["patient-profile"]?.name ||
    nodeData?.patient_profile?.name ||
    "Patient"
  }
/>
    </Box>
  );
}