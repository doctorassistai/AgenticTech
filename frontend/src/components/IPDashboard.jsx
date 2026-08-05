import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import LocalHospitalIcon from "@mui/icons-material/LocalHospital";
import { Modal, CircularProgress } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
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
  Tooltip,
  Paper,
  Grid,
} from "@mui/material";
import { WarningAmberRounded } from "@mui/icons-material";
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
import GlassTranscriptionPanel from "./GlassTranscriptionPanel";
import Condition from "./Condition";
import DischargeSummaryPanels from "./DischargeSummaryPanels";
import DischargeValidationPanel from "./DischargeValidationPanel"
import Dischargesummaryreportpanel from './Dischargesummaryreportpanel'
import QuickNote from "./QuickNote";
import DiagnosisAnalysis from "./DiagnosisAnalysis";
import AgenticWorkspace from "./AgenticWorkspace";
import QuickNotesList from "./QuickNotesList";
import DocumentRetrieval from "./DocumentRetrieval";
import IPPatientSummary from "./IPPatientSummary";
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
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const LogoSource = "frontend/src/assets/lodo only.png";
import TumorBoard from "./TumorBoard";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

// Monochrome palette
const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
  accent: "#1a1a1a",   // black accent
  accentHover: "#2e2e2e",
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
  "documentation-discharge-summary": "Discharge Summary",
  "documentation-clinical-summary": "Clinical Summary",
  "documentation-referral-letter": "Referral Letter",
  "structured-note": "Structured Clinical Note",
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
  "documentation-discharge-summary", "documentation-clinical-summary",
  "documentation-referral-letter", "structured-note",
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
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [showNotesList, setShowNotesList] = useState(false);
  const [quickNoteEnabled, setQuickNoteEnabled] = useState(true);
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
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [treatmentPlanPopupOpen, setTreatmentPlanPopupOpen] = useState(false);
  const treatmentPlanRef = useRef(null);
  const [loadingDoc, setLoadingDoc] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
    const [showIPOnboarding, setShowIPOnboarding] = useState(false);
  const prognosisRef = useRef(null);
  const pageReloadExecutedRef = useRef(new Set());
  const [contextTabIndex, setContextTabIndex] = useState(0);
  const [isOncologySpecialist, setIsOncologySpecialist] = useState(false);
    const [ipOnboardingStatus, setIpOnboardingStatus] = useState(null);
    const [ipSummaryData, setIpSummaryData] = useState(null);
    const [isLoadingIP, setIsLoadingIP] = useState(false);
const patientProfileRef = useRef(null);
const patientSummaryRef = useRef(null);
const transcriptionRef = useRef(null);
const documentationRef = useRef(null);
const dataTabRef = useRef(null);
const procedureTabRef = useRef(null);
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
        } catch (error) { console.error("Failed to fetch doctor info:", error); }
      }
    };
    checkOncologySpecialist();
  }, [doctorId, doctorSpeciality]);

  const handleTreatmentPlanApprove = (formattedPlan) => {
    setDictationTranscript((prev) => prev && prev.trim() ? prev + formattedPlan : formattedPlan);
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
    try {
      await fetch(`${API_BASE_URL}hms/users/data/context/context/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, current_clinical_context: nodeData["current-clinical-context"], medical_clinical_context: nodeData["medical-clinical-context"] }) });
    } catch (err) { console.error("❌ Context save failed:", err); }
  };

const fetchPatientProfileDefinition = async (doctorId) => {
  try {
    if (!doctorId) return [];

    const url = `${API_BASE_URL}hms/users/orchestration/doctor_patient_features/${doctorId}`;
    console.log("Fetching:", url);

    const res = await fetch(url);

    if (!res.ok) {
      console.warn("❌ API failed:", res.status);
      return []; // ✅ prevent breaking UI
    }

    const json = await res.json();
    return json?.features || [];
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return [];
  }
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
const navigateToSection = (tab, ref = null) => {
  setMainTab(tab);

  setTimeout(() => {
    if (ref?.current) {
      const yOffset = -80;
      const y =
        ref.current.getBoundingClientRect().top +
        window.pageYOffset +
        yOffset;

      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }, 150);
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

  const runDictationFeatureWithText = async (nodeId, dictationText, analyzedJson) => {
    const node = enabledNodes.find((n) => n.node_id === nodeId);
    if (!node) return null;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/orchestration/generate_documentation_with_suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, feature_id: nodeId, dictation: dictationText, output_json: analyzedJson ?? analyzedDictation ?? null, objectives: nodeId === "documentation-treatment-plan" ? treatmentObjective : null }) });
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
      if (!diagnosis) { alert("⚠️ Diagnosis is required. If no diagnosis, please enter 'Nil'."); return; }
      if (diagnosis.length < 2 && diagnosis.toLowerCase() !== "nil") { alert("⚠️ Please enter a valid diagnosis or 'Nil'."); return; }
      await saveDiagnosis();
      const documents = [];
      if (treatmentPlanRef.current) { const doc = treatmentPlanRef.current.saveTreatmentPlanData(); if (doc) documents.push(doc); }
      const otherDocs = enabledNodes.filter((n) => n.requires_dictation && n.node_id !== "documentation-treatment-plan" && nodeData[n.node_id]).map((n) => ({ status: "success", feature_id: n.node_id, feature_name: n.node_name, display_method: n.components?.[0]?.type || "text", finaloutput: nodeData[n.node_id], metadata: { doctor_id: doctorId, patient_id: patientId, saved_from: "doctor-dashboard" } }));
      documents.push(...otherDocs);
      if (nodeData["documentation-clinical-summary"]) documents.push({ status: "success", feature_id: "documentation-clinical-summary", feature_name: "Clinical Summary", display_method: "manual", finaloutput: nodeData["documentation-clinical-summary"], metadata: { doctor_id: doctorId, patient_id: patientId, saved_from: "doctor-dashboard" } });
      if (!documents.length) { alert("No documentation available to save"); return; }
      if (prognosisRef.current?.savePrognosisData) { try { await prognosisRef.current.savePrognosisData(); } catch { } }
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/save_documentation_features_bulk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents }) });
      const json = await res.json();
      if (!res.ok) { alert(`Failed to save: ${json.message || "Unknown error"}`); return; }
      alert(`✅ Saved ${documents.length} documents successfully`);
      await completeAppointment();
    } catch (err) { console.error("Save error:", err); alert("Unexpected error while saving"); }
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
  const renderDocPanel = (activeId) => {
    const node = enabledNodes.find((n) => n.node_id === activeId);
    const setDoc = (payload) => setNodeData((prev) => ({ ...prev, [activeId]: payload }));
    if (activeId === "documentation-medication-analysis") return <MedicationPanel data={nodeData[activeId]} metadata={{ patient_id: patientId, doctor_id: doctorId }} diagnosisText={diagnosisText} onSave={(p) => setDoc({ prescriptions: p.prescriptions })} />;
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
  <ListItemButton onClick={() => scrollToSection(patientProfileRef)}>
    <ListItemText
      primary="Patient Profile"
      primaryTypographyProps={{
        ...os({ fontSize: 12, color: C.charcoal }),
      }}
    />
  </ListItemButton>

  <ListItemButton onClick={() => scrollToSection(patientSummaryRef)}>
    <ListItemText
      primary="Patient Summary"
      primaryTypographyProps={{
        ...os({ fontSize: 12, color: C.charcoal }),
      }}
    />
  </ListItemButton>

  <ListItemButton onClick={() => scrollToSection(transcriptionRef)}>
    <ListItemText
      primary="Transcription"
      primaryTypographyProps={{
        ...os({ fontSize: 12, color: C.charcoal }),
      }}
    />
  </ListItemButton>

  <ListItemButton onClick={() => scrollToSection(documentationRef)}>
    <ListItemText
      primary="Clinical Documentation"
      primaryTypographyProps={{
        ...os({ fontSize: 12, color: C.charcoal }),
      }}
    />
  </ListItemButton>
   <ListItemButton onClick={() => navigateToSection("data", dataTabRef)}>
    <ListItemText primary="Data (Documents & Vitals)" primaryTypographyProps={{ ...os({ fontSize: 12 }) }} />
  </ListItemButton>

  {/* PROCEDURE TAB */}
  <ListItemButton onClick={() => navigateToSection("procedure", procedureTabRef)}>
    <ListItemText primary="Procedures" primaryTypographyProps={{ ...os({ fontSize: 12 }) }} />
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
    { label: "Discharge", value: "discharge" },
    ...(isOncologySpecialist ? [{ label: "Tumor Board", value: "tumor-board" }] : []),
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box sx={{ height: "100vh", display: "flex", overflow: "hidden", background: C.ghost, fontFamily: FONT, fontWeight: FW }}>
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
            {/* Title */}
            <Box>
              <Typography sx={{ ...os({ fontSize: { xs: 14, sm: 16 }, color: C.ink, letterSpacing: "0.02em" }) }}>
                DoctorAssist.AI
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                {selectedTabNodes.length > 0 ? `${selectedTabNodes.length} modules combined` : " DoctorAssist.AI's -Doctor's Workspace"}
              </Typography>
            </Box>

            {/* Action icons */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
<Tooltip title="IP Onboarding">
  <IconButton
    onClick={async () => {
      if (isLoadingIP) return;

      setIsLoadingIP(true);
      setShowIPOnboarding(true);
      setIpOnboardingStatus("processing");

      try {
        const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/internal/run-ip-onboarding`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            specialty: doctorSpeciality || "oncology",
            include_intermediates: false
          })
        });

const json = await res.json();

console.log("IP API RESPONSE:", json); // keep this

if (res.ok && json?.ip_onboarding_summary) {
  setIpSummaryData(json);
  setIpOnboardingStatus("completed");
} else {
  setIpOnboardingStatus("failed");
}
      } catch (err) {
          console.error("IP Onboarding error:", err);
      } finally {
        setIsLoadingIP(false);
      }
    }}
    size="small"
    sx={{
      width: 32,
      height: 32,
      borderRadius: "2px",
      border: `1px solid ${C.fog}`,
      color: C.smoke,
      "&:hover": { background: C.ghost, color: C.ink }
    }}
  >
    <LocalHospitalIcon sx={{ fontSize: 15 }} />
  </IconButton>
</Tooltip>

{showIPOnboarding && (
  <>
    {/* Overlay */}
    <Box
      onClick={() => setShowIPOnboarding(false)}
      sx={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 3000
      }}
    />

    {/* Modal */}
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3001
      }}
    >
      <Box
        sx={{
          background: C.white,
          border: `1px solid ${C.fog}`,
          borderRadius: "4px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
          p: 4,
          textAlign: "center",
          position: "relative",
          width: 380,
          maxWidth: "90vw"
        }}
      >
        {/* Close */}
        <IconButton
          size="small"
          onClick={() => setShowIPOnboarding(false)}
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            color: C.ash,
            border: `1px solid ${C.fog}`,
            borderRadius: "2px",
            "&:hover": { background: C.ghost }
          }}
        >
          <CloseRounded sx={{ fontSize: 15 }} />
        </IconButton>

        <Typography sx={{ ...os({ fontSize: 14, color: C.ink, mb: 2 }) }}>
          IP Onboarding
        </Typography>

        {ipOnboardingStatus === "processing" && (
          <>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              style={{
                width: 40,
                height: 40,
                margin: "16px auto",
                borderRadius: "50%",
                border: `2px solid ${C.mist}`,
                borderTopColor: C.charcoal
              }}
            />

            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
              Processing IP records...
            </Typography>
          </>
        )}

        {ipOnboardingStatus === "completed" && (
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
            IP onboarding completed successfully.
          </Typography>
        )}

        {ipOnboardingStatus === "failed" && (
          <Typography sx={{ ...os({ fontSize: 13, color: "#dc2626" }) }}>
            Failed to generate IP summary.
          </Typography>
        )}
      </Box>
    </Box>
  </>
)}
              <Tooltip title="Clinical Workspace">
                <IconButton size="small" onClick={() => { setAgenticOpen(true); setAgenticTrigger((v) => v + 1); }}
                  sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.smoke, "&:hover": { background: C.ghost, color: C.ink } }}>
                  <PsychologyRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
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
{/* 🔴 TRIAGE SECTION */}
{/* 🔴 TRIAGE SECTION */}
{/* 🔴 TRIAGE SECTION */}
{visitType && visitType.toLowerCase().includes("emergency") && (
  <Box sx={{
    background: C.white,
    border: `1px solid ${C.fog}`,
    borderRadius: "4px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
    mb: 2,
  }}>

    {/* Header */}
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

    {/* Content */}
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
)}
              {/* Clinical Insights */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="AI-powered analysis from patient history and dictation">Clinical Insights</SectionHeader>
                <Tabs value={contextTabIndex} onChange={(_, v) => setContextTabIndex(v)} sx={{ ...tabSx, px: 3 }}>
       <Tab label="IP Patient Summary" />
                  <Tab label="Current Clinical Context" />
                  <Tab label="Medical Clinical Context" />
                </Tabs>
                <Box sx={{ p: { xs: 2, sm: 3 } }}>
{contextTabIndex === 0 && (
  <>
    {/* Processing state */}
    {ipOnboardingStatus === "processing" && (
      <Box
        sx={{
          background: C.white,
          border: `1px solid ${C.fog}`,
          borderRadius: "4px",
          p: 4,
          textAlign: "center"
        }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          style={{
            width: 30,
            height: 30,
            margin: "0 auto",
            borderRadius: "50%",
            border: `2px solid ${C.mist}`,
            borderTopColor: C.charcoal
          }}
        />
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mt: 2 }) }}>
          Processing IP records...
        </Typography>
      </Box>
    )}

    {/* Empty/Generate state */}
    {ipOnboardingStatus !== "processing" && (!ipOnboardingStatus === "completed" || !ipSummaryData) && (
      <Box
        sx={{
          textAlign: "center",
          py: 6,
          border: `1px dashed ${C.mist}`,
          borderRadius: "2px",
          cursor: "pointer",
          "&:hover": { background: C.ghost }
        }}
        onClick={() => {
          const btn = document.querySelector('[title="IP Onboarding"] button');
          if (btn) btn.click();
        }}
      >
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
          Generate IP Patient Summary
        </Typography>
      </Box>
    )}

    {/* Completed state - render IPPatientSummary directly without wrapper */}
    {ipOnboardingStatus === "completed" && ipSummaryData && (
      <IPPatientSummary
        patientId={patientId}
        doctorId={doctorId}
        specialty={doctorSpeciality}
        initialData={ipSummaryData}
      />
    )}
  </>
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
                  {contextTabIndex === 2&& (
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
                </Box>
              </Box>

              {/* Dictation */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Transcribe clinical notes by voice or text">Clinical Dictation</SectionHeader>
                <Box sx={{ p: { xs: 2, sm: 3 } }}>
                  <Box ref={transcriptionRef}>
                  <GlassTranscriptionPanel
                    onTranscribe={async ({ dictation, output_json }) => {
                      if (!dictation?.trim()) return;

                      setCurrentDictation(dictation);

                      try {
                        await fetch(`${API_BASE_URL}hms/users/orchestration/process-clinical-dictation`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            doctor_id: doctorId,
                            patient_id: patientId,
                            dictation,
                          }),
                        });
                      } catch (err) {
                        console.error("❌ Failed to send dictation:", err);
                      }

                      const analyzedJson = output_json ?? null;
                      if (analyzedJson) setAnalyzedDictation(analyzedJson);

                      // ✅ Run current clinical context
                      await runCurrentClinicalContext(dictation);

                      // 🧹 CLEAR old documentation data
                      setNodeData((prev) => {
                        const updated = { ...prev };

                        [
                          "documentation-clinical-notes",
                          "documentation-investigation-notes",
                          "documentation-treatment-plan",
                          "documentation-discharge-summary",
                          "documentation-clinical-summary",
                          "documentation-referral-letter",
                        ].forEach((key) => {
                          delete updated[key];
                        });

                        return updated;
                      });

                      // ✅ Run ONLY medication analysis
                      const medData = await runDictationFeatureWithText(
                        "documentation-medication-analysis",
                        dictation,
                        analyzedJson
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
                  </Box>
                </Box>
              </Box>

              {/* Diagnosis Analysis */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Enter clinical findings for AI-assisted diagnosis">Diagnosis Analysis</SectionHeader>
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
              </Box>

              {/* AI Treatment Plan */}
              <Box sx={{ ...sectionCard }}>
                <SectionHeader
                  sub="Generate an AI-powered treatment plan based on patient data and clinical context"
                  action={
                    <Box component="button" onClick={() => setTreatmentPlanPopupOpen(true)}
                      sx={{ ...actionButton, px: 2.5, py: 1, fontSize: 12, minWidth: 170, height: 38 }}>
                      <LocalHospital sx={{ fontSize: 14 }} /> Generate Treatment Plan
                    </Box>
                  }
                >
                  AI Treatment Plan Generator
                </SectionHeader>
                {diagnosisText && (
                  <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Current Diagnosis</Typography>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{diagnosisText}</Typography>
                  </Box>
                )}
              </Box>

              {/* Documentation */}
              <Box ref={documentationRef} sx={{ ...sectionCard }}>
                <SectionHeader sub="Auto-generated from dictation — review and edit before saving">Clinical Documentation</SectionHeader>
                <Box sx={{ px: 3, pt: 1 }}>
                  <Tabs value={docTab} onChange={handleDocTabChange} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={tabSx}>
                    {DOC_IDS.map((id) => <Tab key={id} label={DOCUMENTATION_LABELS[id]} />)}
                  </Tabs>
                </Box>
                <Box sx={{ p: { xs: 2, sm: 3 }, minHeight: 200 }}>
  {loadingDoc === DOC_IDS[docTab] ? (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 150,
      }}
    >
      <RefreshRounded
        sx={{
          fontSize: 28,
          color: C.ash,
          animation: "spin 1s linear infinite",
        }}
      />
    </Box>
  ) : (
    renderDocPanel(DOC_IDS[docTab])
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
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="View lab reports, imaging, clinical notes, and structured records">Patient Documents</SectionHeader>
                <Box sx={{ p: { xs: 2, sm: 2.5 } }}><DocumentRetrieval patientId={patientId} doctorId={doctorId} /></Box>
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
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="AI-assisted clinical assertion engine">Assertion Module</SectionHeader>
                <Box sx={{ p: 3 }}><AssertionNew doctorId={doctorId} patientId={patientId} /></Box>
              </Box>
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Previous consultation records and reports">Consultation Reports</SectionHeader>
                <Box sx={{ p: 3 }}><ConsultationDataTab patientId={patientId} doctorId={doctorId} /></Box>
              </Box>
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
              <Box sx={{ p: { xs: 2, sm: 3 } }}><ProcedureNotes patientId={patientId} doctorId={doctorId} /></Box>
            </Box>
          )}

          {/* ═══ AGENTIC TAB ═════════════════════════════════════════════════ */}
          {mainTab === "agentic" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              <Box sx={{ ...sectionCard }}>
                <SectionHeader sub="Autonomous reasoning, task execution, and decision support">Clinical Review Engines</SectionHeader>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", px: 3, pb: 2 }}>
                  {["Autonomous Agents", "Multi-Agent System", "Real-time Analysis"].map((c) => (
                    <Chip key={c} label={c} size="small" sx={{ fontSize: 11, background: C.ghost, color: C.smoke, border: `1px solid ${C.fog}`, ...os() }} />
                  ))}
                </Box>
              </Box>
              <Box sx={{ ...sectionCard, overflow: "hidden" }}>
                <AgenticWorkspace patientId={patientId} doctorId={doctorId} trigger={agenticTrigger} />
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

          {/* ═══ LONGITUDINAL TAB ════════════════════════════════════════════ */}
          {mainTab === "discharge" && (
            <Box sx={{ ...sectionCard }}>
              <SectionHeader sub="Discharge summary">Discharge Summary</SectionHeader>
              <Box sx={{ p: { xs: 2, sm: 3 } }}><DischargeSummaryPanels
  doctorId={doctorId}
  patientId={patientId}
  specialty={doctorSpeciality}
/></Box>
<Box sx={{ p: { xs: 2, sm: 3 } }}><DischargeValidationPanel
  doctorId={doctorId}
  patientId={patientId}
  specialty={doctorSpeciality}
/></Box>
<Box sx={{ p: { xs: 2, sm: 3 } }}><Dischargesummaryreportpanel
  doctorId={doctorId}
  patientId={patientId}
  specialty={doctorSpeciality}
/></Box>
            </Box>
          )}

          {/* ═══ TUMOR BOARD TAB ═════════════════════════════════════════════ */}
          {mainTab === "tumor-board" && isOncologySpecialist && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              <TumorBoard doctorId={doctorId} patientId={patientId} doctorSpeciality={doctorSpeciality} doctorName={doctorName} />
            </Box>
          )}
        </Box>
      </Box>

      {/* ─── Save button ──────────────────────────────────────────────────── */}
      <Box component="button" type="button" onClick={handleSave}
        sx={{ ...actionButton, position: "fixed", bottom: 20, right: 20, zIndex: 1500, px: 3, py: 1.25, fontSize: 12, borderRadius: "2px", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}>
        Save Session
      </Box>

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
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    style={{ width: 40, height: 40, margin: "16px auto", borderRadius: "50%", border: `2px solid ${C.mist}`, borderTopColor: C.charcoal }}
                  />
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
    </Box>
  );
}