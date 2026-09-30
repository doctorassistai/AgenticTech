import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/lodo_only.png";
import {
  UploadCloud,
  FileText,
  Calendar,
  X,
  CheckCircle,
  Clock,
  Image as ImageIcon,
  AlertCircle,
  Loader2,
  RefreshCw,
  Home,
  Settings,
  Bed,
  MessageCircle,
  Activity,
  LogOut,
  Search,
  UserPlus,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching DoctorDashboard exactly) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
};

const SIDEBAR_WIDTH = "248px";

/* ─── INLINE STYLES ─── */
const S = {
  layout: {
    display: "flex",
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },

  /* sidebar */
  sidebar: {
    width: SIDEBAR_WIDTH,
    minHeight: "100vh",
    position: "fixed",
    left: 0,
    top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
  },
  sidebarHeader: {
    padding: "1.5rem 1.5rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "1.25rem",
  },
  logoBox: {
    width: "32px",
    height: "32px",
    background: T.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
    fontFamily: "'Open Sans', sans-serif",
  },
  sectionLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
    fontFamily: "'Open Sans', sans-serif",
  },
  doctorNameStyle: {
    fontSize: "0.9rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
    fontFamily: "'Open Sans', sans-serif",
  },
  doctorSpec: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontFamily: "'Open Sans', sans-serif",
  },

  /* nav */
  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },
  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.5rem 0.75rem 0.25rem",
    display: "block",
    fontFamily: "'Open Sans', sans-serif",
  },
  navBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "0.55rem 1.25rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    transition: "all 0.15s",
    fontFamily: "'Open Sans', sans-serif",
    borderLeft: "2px solid transparent",
  },
  navBtnActive: {
    background: T.bgAlt,
    color: T.text,
    fontWeight: 400,
    borderLeft: `2px solid ${T.accent}`,
  },

  /* sidebar footer */
  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  logoutBtn: {
    width: "100%",
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.6rem 1rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.2s",
  },

  /* main */
  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  /* top bar */
  topBar: {
    position: "sticky",
    top: 0,
    background: T.bg,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
    fontFamily: "'Open Sans', sans-serif",
  },
  topBarSub: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
  },

  /* body */
  body: {
    padding: "2rem",
    flex: 1,
  },

  /* section block */
  tableSection: {
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
  },
  tableHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableHeaderTitle: {
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: 0,
    fontFamily: "'Open Sans', sans-serif",
  },
  tableHeaderMeta: {
    fontSize: "0.65rem",
    color: T.textMuted,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
  },

  /* table */
  th: {
    textAlign: "left",
    padding: "0.65rem 1rem",
    fontSize: "0.62rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
    background: T.bgAlt,
    fontFamily: "'Open Sans', sans-serif",
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
    fontFamily: "'Open Sans', sans-serif",
  },

  /* buttons */
  actionBtn: {
    padding: "0.35rem 0.9rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.68rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    letterSpacing: "0.04em",
  },
  outlineBtn: {
    padding: "0.35rem 0.9rem",
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    fontSize: "0.68rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },

  /* form */
  input: {
    width: "100%",
    padding: "0.5rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    fontSize: "0.78rem",
    color: T.text,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  select: {
    width: "100%",
    padding: "0.5rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    fontSize: "0.78rem",
    color: T.text,
    outline: "none",
    boxSizing: "border-box",
    cursor: "pointer",
    appearance: "auto",
  },
  label: {
    display: "block",
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    fontWeight: 400,
    marginBottom: "0.35rem",
    fontFamily: "'Open Sans', sans-serif",
  },

  /* upload zone */
  uploadZone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "2.5rem 1.25rem",
    border: `1.5px dashed ${T.border}`,
    background: T.bgAlt,
    cursor: "pointer",
    transition: "all 0.15s",
  },

  /* file preview */
  filePreview: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
  },

  /* doc card */
  docCard: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    padding: "1rem",
    position: "relative",
    cursor: "pointer",
    transition: "background 0.15s",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },

  /* mode toggle */
  modeToggleWrap: {
    display: "flex",
    border: `1px solid ${T.border}`,
    marginBottom: "1.25rem",
  },
  modeBtn: (active) => ({
    flex: 1,
    padding: "0.5rem 0.75rem",
    border: "none",
    background: active ? T.text : T.bg,
    color: active ? T.bg : T.textSec,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: active ? 400 : 300,
    fontSize: "0.72rem",
    cursor: "pointer",
    letterSpacing: "0.04em",
    transition: "all 0.15s",
  }),

  /* message banner */
  msgBanner: (type) => ({
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.6rem 0.875rem",
    border: `1px solid ${
      type === "success" ? "#c8e6c9"
      : type === "error" ? "#ffcdd2"
      : type === "warning" ? "#ffe0b2"
      : T.border}`,
    background:
      type === "success" ? "#f1f8e9"
      : type === "error" ? "#fce4ec"
      : type === "warning" ? "#fff8f0"
      : T.bgAlt,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    fontSize: "0.75rem",
    color:
      type === "success" ? "#2e7d32"
      : type === "error" ? "#c62828"
      : type === "warning" ? "#6d3a00"
      : T.textSec,
    marginTop: "0.75rem",
  }),

  /* processing bar */
  processingBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.6rem 0.875rem",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    fontSize: "0.75rem",
    color: T.textSec,
    marginTop: "0.75rem",
  },

  /* badge */
  badge: {
    padding: "0.15rem 0.45rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
    color: T.textMuted,
    fontFamily: "'Open Sans', sans-serif",
  },

  /* modal */
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    padding: "1.25rem",
  },
  modalBox: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
    padding: "1.75rem",
    width: "100%",
    maxWidth: "900px",
    maxHeight: "85vh",
    overflowY: "auto",
    position: "relative",
  },
};

/* ─── DOC & IMAGE TYPES ─── */
const DOCUMENT_TYPES = [
  { value: "lab_report", label: "Lab Report" },
  { value: "x_ray", label: "X-Ray" },
  { value: "biopsy", label: "Biopsy Report" },
  { value: "ct_scan", label: "CT Scan" },
  { value: "pet_scan", label: "PET Scan" },
  { value: "ultrasound", label: "Ultrasound" },
];

const IMAGE_TYPES = [
  { value: "x_ray", label: "X-Ray" },
  { value: "ct_scan", label: "CT Scan" },
  { value: "mri", label: "MRI" },
  { value: "pet_scan", label: "PET Scan" },
  { value: "ultrasound", label: "Ultrasound" },
  { value: "other_image", label: "Other Image" },
];
const REPORT_TYPE_CATEGORIES = [
  {
    name: "Consultation",
    subcategories: [
      "General Consultation Report",
      "Specialist Consultation Report",
      "Pre-operative Consultation Report",
      "Second Opinion Report",
      "Pre-anesthesia Consultation Report",
      "Follow-up Consultation Report",
    ],
  },
  {
    name: "Assessment",
    subcategories: [
      "Initial Assessment Report",
      "Pre-operative Assessment Report",
      "Pre-anesthesia Assessment Report",
      "Clinical Assessment Report",
      "Risk Assessment Report",
      "Functional Assessment Report",
      "Nutritional Assessment Report",
      "Psychological Assessment Report",
    ],
  },
  {
    name: "Laboratory",
    subcategories: [
      "Hematology",
      "Biochemistry",
      "Clinical Chemistry",
      "Coagulation",
      "Immunology",
      "Serology",
      "Microbiology",
      "Bacteriology",
      "Virology",
      "Parasitology",
      "Mycology",
      "Endocrinology",
      "Hormone Testing",
      "Urinalysis",
      "Stool Examination",
      "Toxicology",
      "Therapeutic Drug Monitoring",
      "Blood Bank",
      "Transfusion Medicine",
      "Genetic Testing",
      "Molecular Diagnostics",
      "Point-of-Care Testing",
    ],
  },
  {
    name: "Radiology",
    subcategories: [
      "X-Ray",
      "CT",
      "MRI",
      "Ultrasound",
      "Doppler",
      "Mammography",
      "PET-CT",
      "PET-MRI",
      "Nuclear Medicine",
      "Bone Scan",
      "Fluoroscopy",
      "Angiography",
      "Interventional Radiology",
      "Radiology Procedure",
      "Radiology Follow-up",
    ],
  },
  {
    name: "Cardiology",
    subcategories: [
      "ECG",
      "Echocardiography",
      "Stress Test",
      "Holter Monitoring",
      "Ambulatory Blood Pressure Monitoring",
      "Cardiac CT",
      "Cardiac MRI",
      "Coronary Angiography",
      "Cardiac Catheterization",
      "Electrophysiology",
      "Pacemaker Evaluation",
      "ICD Evaluation",
      "Cardiology Consultation",
      "Cardiology Follow-up",
    ],
  },
  {
    name: "Pulmonology",
    subcategories: [
      "Pulmonary Function Test",
      "Spirometry",
      "Bronchoscopy",
      "Bronchoscopy Biopsy",
      "Pleural Fluid Analysis",
      "Sleep Study",
      "Sleep Apnea Study",
      "Pulmonology Consultation",
      "Pulmonology Follow-up",
    ],
  },
  {
    name: "Neurology",
    subcategories: [
      "EEG",
      "Video EEG",
      "EMG",
      "Nerve Conduction Study",
      "Evoked Potential",
      "Neurological Assessment",
      "Neurology Consultation",
      "Neurology Follow-up",
    ],
  },
  {
    name: "Neurosurgery",
    subcategories: [
      "Neurosurgical Consultation",
      "Pre-operative Neurosurgical Assessment",
      "Neurosurgical Operative Report",
      "Post-operative Neurosurgical Report",
      "Neurosurgical Procedure Report",
      "Neurosurgical Follow-up",
    ],
  },
  {
    name: "Gastroenterology",
    subcategories: [
      "Upper GI Endoscopy",
      "Colonoscopy",
      "Sigmoidoscopy",
      "ERCP",
      "EUS",
      "Capsule Endoscopy",
      "GI Biopsy",
      "GI Procedure Report",
      "Gastroenterology Consultation",
      "Gastroenterology Follow-up",
    ],
  },
  {
    name: "Endoscopy",
    subcategories: [
      "Upper GI Endoscopy Report",
      "Colonoscopy Report",
      "Bronchoscopy Report",
      "Cystoscopy Report",
      "Hysteroscopy Report",
      "Arthroscopy Report",
      "Laryngoscopy Report",
      "ERCP Report",
      "EUS Report",
      "Endoscopic Procedure Report",
    ],
  },
  {
    name: "Pathology",
    subcategories: [
      "Surgical Pathology",
      "Histopathology",
      "Biopsy",
      "Cytology",
      "Fine Needle Aspiration",
      "Frozen Section",
      "Immunohistochemistry",
      "Molecular Pathology",
      "Molecular/Genetic Testing",
      "Biomarker Testing",
      "Tumor Grade",
      "Margin Assessment",
      "Lymph Node Pathology",
    ],
  },
  {
    name: "Surgery",
    subcategories: [
      "Operative Report",
      "Procedure Note",
      "Pre-operative Report",
      "Post-operative Report",
      "Surgical Discharge Summary",
      "Surgical Follow-up",
      "Surgical Complication Report",
      "Re-operation Report",
      "Surgical Pathology",
    ],
  },
  {
    name: "Anesthesia",
    subcategories: [
      "Pre-anesthesia Assessment",
      "Anesthesia Record",
      "Intraoperative Anesthesia Record",
      "Post-anesthesia Care Report",
      "Regional Anesthesia Report",
      "General Anesthesia Report",
      "Anesthesia Complication Report",
      "Pain Procedure Report",
    ],
  },
  {
    name: "Obstetrics",
    subcategories: [
      "Antenatal Assessment",
      "Obstetric Ultrasound",
      "Fetal Monitoring",
      "Non-Stress Test",
      "Biophysical Profile",
      "Delivery Report",
      "Cesarean Section Report",
      "Postpartum Report",
      "Obstetric Procedure Report",
    ],
  },
  {
    name: "Gynecology",
    subcategories: [
      "Gynecology Consultation",
      "Gynecological Examination",
      "Pap Smear",
      "Colposcopy",
      "Hysteroscopy",
      "Gynecological Ultrasound",
      "Gynecological Procedure",
      "Gynecology Operative Report",
      "Gynecology Follow-up",
    ],
  },
  {
    name: "Pediatrics",
    subcategories: [
      "Pediatric Consultation",
      "Pediatric Assessment",
      "Pediatric Procedure",
      "Pediatric Imaging",
      "Pediatric Follow-up",
      "Neonatal Assessment",
    ],
  },
  {
    name: "Neonatology",
    subcategories: [
      "Neonatal Assessment",
      "NICU Progress Report",
      "Neonatal Procedure Report",
      "Neonatal Discharge Summary",
      "Neonatal Follow-up",
    ],
  },
  {
    name: "Oncology",
    subcategories: [
      "Oncology Consultation",
      "Cancer Assessment",
      "Cancer Treatment Plan",
      "Chemotherapy",
      "Immunotherapy",
      "Targeted Therapy",
      "Hormonal Therapy",
      "Radiation Therapy",
      "Tumor Staging",
      "TNM Staging",
      "Treatment Response",
      "Tumor Board",
      "Cancer Follow-up",
      "Disease Progression",
      "Cancer Recurrence",
      "Remission",
      "Survivorship",
    ],
  },
  {
    name: "Radiation Therapy",
    subcategories: [
      "Radiation Treatment Planning",
      "CT Simulation",
      "Radiation Prescription",
      "EBRT",
      "IMRT",
      "VMAT",
      "IGRT",
      "SRS",
      "SBRT",
      "SABR",
      "Brachytherapy",
      "Radiation On-Treatment Visit",
      "Radiation Completion",
      "Radiation Toxicity",
      "Radiation Follow-up",
    ],
  },
  {
    name: "Chemotherapy",
    subcategories: [
      "Chemotherapy Assessment",
      "Chemotherapy Administration",
      "Treatment Cycle",
      "Chemotherapy Response",
      "Chemotherapy Toxicity",
      "Chemotherapy Follow-up",
    ],
  },
  {
    name: "Dialysis",
    subcategories: [
      "Hemodialysis Report",
      "Peritoneal Dialysis Report",
      "Dialysis Treatment Record",
      "Dialysis Access Report",
      "Dialysis Progress Report",
      "Dialysis Complication Report",
    ],
  },
  {
    name: "Nephrology",
    subcategories: [
      "Nephrology Consultation",
      "Renal Assessment",
      "Renal Function Report",
      "Kidney Biopsy Report",
      "Nephrology Procedure",
      "Nephrology Follow-up",
    ],
  },
  {
    name: "Urology",
    subcategories: [
      "Urology Consultation",
      "Cystoscopy",
      "Urodynamic Study",
      "Urology Ultrasound",
      "Urology Operative Report",
      "Urology Procedure",
      "Urology Follow-up",
    ],
  },
  {
    name: "Orthopedics",
    subcategories: [
      "Orthopedic Consultation",
      "Orthopedic Assessment",
      "Fracture Report",
      "Joint Replacement Report",
      "Arthroscopy Report",
      "Orthopedic Operative Report",
      "Orthopedic Procedure",
      "Orthopedic Follow-up",
    ],
  },
  {
    name: "Dermatology",
    subcategories: [
      "Dermatology Consultation",
      "Skin Examination",
      "Dermatology Biopsy",
      "Dermatopathology",
      "Dermatology Procedure",
      "Dermatology Follow-up",
    ],
  },
  {
    name: "Ophthalmology",
    subcategories: [
      "Eye Examination",
      "Visual Field Test",
      "OCT",
      "Fundus Photography",
      "Slit Lamp Examination",
      "Tonometry",
      "Ophthalmic Ultrasound",
      "Ophthalmology Procedure",
      "Ophthalmology Operative Report",
      "Ophthalmology Follow-up",
    ],
  },
  {
    name: "ENT",
    subcategories: [
      "ENT Consultation",
      "Audiometry",
      "Tympanometry",
      "Nasal Endoscopy",
      "Laryngoscopy",
      "ENT Procedure",
      "ENT Operative Report",
      "ENT Follow-up",
    ],
  },
  {
    name: "Dentistry",
    subcategories: [
      "Dental Examination",
      "Dental X-Ray",
      "Dental CT",
      "Dental Procedure",
      "Dental Operative Report",
      "Dental Follow-up",
    ],
  },
  {
    name: "Rehabilitation",
    subcategories: [
      "Physiotherapy Assessment",
      "Physiotherapy Progress Report",
      "Occupational Therapy Report",
      "Speech Therapy Report",
      "Physical Rehabilitation Report",
      "Rehabilitation Discharge Report",
    ],
  },
  {
    name: "Psychiatry",
    subcategories: [
      "Psychiatric Consultation",
      "Psychiatric Assessment",
      "Mental Health Assessment",
      "Psychological Assessment",
      "Psychiatric Progress Report",
      "Psychiatric Follow-up",
    ],
  },
  {
    name: "Nutrition",
    subcategories: [
      "Nutrition Assessment",
      "Dietitian Consultation",
      "Diet Plan",
      "Nutrition Follow-up",
      "Nutritional Support Report",
    ],
  },
  {
    name: "Emergency",
    subcategories: [
      "Emergency Assessment",
      "Emergency Consultation",
      "Emergency Procedure",
      "Trauma Assessment",
      "Emergency Progress Report",
      "Emergency Discharge Summary",
    ],
  },
  {
    name: "Critical Care",
    subcategories: [
      "ICU Admission Report",
      "ICU Progress Report",
      "Critical Care Assessment",
      "Ventilator Report",
      "Critical Care Procedure",
      "ICU Discharge Summary",
    ],
  },
  {
    name: "Transplantation",
    subcategories: [
      "Transplant Assessment",
      "Transplant Evaluation",
      "Transplant Procedure",
      "Transplant Surgery Report",
      "Transplant Follow-up",
      "Transplant Rejection Assessment",
    ],
  },
  {
    name: "Infectious Disease",
    subcategories: [
      "Infectious Disease Consultation",
      "Infection Assessment",
      "Culture Report",
      "Antimicrobial Susceptibility",
      "Infectious Disease Follow-up",
    ],
  },
  {
    name: "Discharge",
    subcategories: [
      "Discharge Summary",
      "Surgical Discharge Summary",
      "ICU Discharge Summary",
      "Emergency Discharge Summary",
      "Neonatal Discharge Summary",
      "Discharge Instructions",
    ],
  },
  {
    name: "Follow-up",
    subcategories: [
      "Specialist Follow-up",
      "Post-operative Follow-up",
      "Treatment Follow-up",
      "Procedure Follow-up",
      "Chronic Disease Follow-up",
    ],
  },
  {
    name: "Progress",
    subcategories: [
      "Daily Progress Note",
      "Clinical Progress Report",
      "Treatment Progress Report",
      "Specialist Progress Report",
    ],
  },
  {
    name: "Treatment Response",
    subcategories: [
      "Treatment Response Assessment",
      "Response Evaluation Report",
      "Treatment Response Imaging",
      "Therapy Response Report",
    ],
  },
  {
    name: "Complications",
    subcategories: [
      "Procedure Complication Report",
      "Surgical Complication Report",
      "Treatment Complication Report",
      "Medication Adverse Effect Report",
      "Radiation Toxicity Report",
    ],
  },
  {
    name: "Multidisciplinary Review",
    subcategories: [
      "Tumor Board",
      "Multidisciplinary Team Report",
      "Case Review",
      "Treatment Plan Recommendation",
      "Pre-treatment Case Discussion",
      "Post-treatment Case Review",
    ],
  },
  {
    name: "Palliative Care",
    subcategories: [
      "Palliative Care Consultation",
      "Pain Management",
      "Symptom Management",
      "Palliative Treatment Plan",
      "End-of-Life Care",
    ],
  },
  {
    name: "Supportive Care",
    subcategories: [
      "Pain Management",
      "Nutrition Support",
      "Psychological Support",
      "Rehabilitation",
      "Social Work Assessment",
    ],
  },
  {
    name: "Medical Records",
    subcategories: [
      "Medical History",
      "Clinical Summary",
      "Patient Summary",
      "Referral Letter",
      "Transfer Summary",
      "Case Summary",
    ],
  },
  {
    name: "Procedure",
    subcategories: [
      "Procedure Report",
      "Minor Procedure Report",
      "Interventional Procedure Report",
      "Bedside Procedure Report",
      "Procedure Follow-up",
    ],
  },
  {
    name: "Monitoring",
    subcategories: [
      "Vital Signs Monitoring",
      "Cardiac Monitoring",
      "Continuous Monitoring",
      "Post-procedure Monitoring",
      "Treatment Monitoring",
    ],
  },
  {
    name: "Staging",
    subcategories: [
      "Cancer Staging",
      "TNM Staging",
      "Disease Staging",
      "Metastatic Disease Assessment",
    ],
  },
  {
    name: "Genetic Testing",
    subcategories: [
      "Genetic Test Report",
      "Molecular Genetic Testing",
      "Cytogenetics",
      "Chromosomal Analysis",
      "Genomic Testing",
    ],
  },
  {
    name: "Disability & Functional Assessment",
    subcategories: [
      "Functional Capacity Assessment",
      "Disability Assessment",
      "Mobility Assessment",
      "Activities of Daily Living Assessment",
      "Occupational Assessment",
    ],
  },
  {
    name: "End-of-Treatment",
    subcategories: [
      "Treatment Completion Summary",
      "End-of-Treatment Report",
      "Treatment Discharge Summary",
      "Survivorship Report",
    ],
  },
  {
    name: "End-of-Life",
    subcategories: [
      "End-of-Life Care Summary",
      "Hospice Referral",
      "Hospice Summary",
      "Death Summary",
    ],
  },
  {
    name: "Endocrinology",
    subcategories: [
      "Endocrinology Consultation",
      "Diabetes Assessment",
      "Thyroid Function Assessment",
      "Adrenal Function Assessment",
      "Hormone Replacement Therapy Report",
      "Endocrinology Follow-up",
    ],
  },
  {
    name: "Rheumatology",
    subcategories: [
      "Rheumatology Consultation",
      "Joint Assessment",
      "Autoimmune Disease Assessment",
      "Rheumatology Procedure",
      "Rheumatology Follow-up",
    ],
  },
  {
    name: "Hematology (Clinical)",
    subcategories: [
      "Hematology Consultation",
      "Anemia Assessment",
      "Bleeding Disorder Assessment",
      "Bone Marrow Biopsy Report",
      "Hemoglobinopathy Assessment",
      "Hematology Follow-up",
    ],
  },
  {
    name: "Allergy & Immunology",
    subcategories: [
      "Allergy Consultation",
      "Allergy Testing Report",
      "Immunodeficiency Assessment",
      "Immunotherapy Report",
      "Allergy Follow-up",
    ],
  },
  {
    name: "Vascular Surgery",
    subcategories: [
      "Vascular Surgery Consultation",
      "Vascular Assessment",
      "Vascular Operative Report",
      "Vascular Procedure Report",
      "Vascular Surgery Follow-up",
    ],
  },
  {
    name: "Plastic Surgery",
    subcategories: [
      "Plastic Surgery Consultation",
      "Reconstructive Procedure Report",
      "Cosmetic Procedure Report",
      "Plastic Surgery Operative Report",
      "Plastic Surgery Follow-up",
    ],
  },
  {
    name: "Pain Medicine",
    subcategories: [
      "Pain Medicine Consultation",
      "Pain Assessment Report",
      "Nerve Block Procedure Report",
      "Interventional Pain Procedure",
      "Pain Medicine Follow-up",
    ],
  },
  {
    name: "Sports Medicine",
    subcategories: [
      "Sports Medicine Consultation",
      "Sports Injury Assessment",
      "Return-to-Play Assessment",
      "Sports Medicine Follow-up",
    ],
  },
  {
    name: "Geriatrics",
    subcategories: [
      "Geriatric Consultation",
      "Geriatric Assessment",
      "Fall Risk Assessment",
      "Cognitive Assessment",
      "Geriatric Follow-up",
    ],
  },
  {
    name: "Occupational Medicine",
    subcategories: [
      "Occupational Health Assessment",
      "Fitness for Duty Report",
      "Workplace Injury Report",
      "Pre-employment Medical Report",
      "Occupational Medicine Follow-up",
    ],
  },
  {
    name: "Preventive Medicine",
    subcategories: [
      "Wellness Examination Report",
      "Health Screening Report",
      "Immunization Record",
      "Executive Health Checkup Report",
      "Preventive Care Follow-up",
    ],
  },
  {
    name: "Home Health Care",
    subcategories: [
      "Home Health Assessment",
      "Home Nursing Progress Report",
      "Home Health Discharge Summary",
      "Home Health Follow-up",
    ],
  },
  {
    name: "Hospice",
    subcategories: [
      "Hospice Assessment",
      "Hospice Progress Report",
      "Hospice Discharge Summary",
      "Hospice Family Conference Note",
    ],
  },
  {
    name: "Pharmacy",
    subcategories: [
      "Medication Reconciliation Report",
      "Pharmacy Consultation",
      "Drug Interaction Report",
      "Medication Therapy Review",
      "Adverse Drug Reaction Report",
    ],
  },
  {
    name: "Wound Care",
    subcategories: [
      "Wound Assessment Report",
      "Wound Care Procedure Report",
      "Wound Progress Report",
      "Pressure Ulcer Assessment",
      "Wound Care Follow-up",
    ],
  },
  {
    name: "Sleep Medicine",
    subcategories: [
      "Sleep Medicine Consultation",
      "Polysomnography Report",
      "Sleep Apnea Titration Study",
      "Home Sleep Test Report",
      "Sleep Medicine Follow-up",
    ],
  },
  {
    name: "Reproductive Medicine",
    subcategories: [
      "Fertility Assessment",
      "IVF Procedure Report",
      "Andrology Report",
      "Reproductive Endocrinology Consultation",
      "Reproductive Medicine Follow-up",
    ],
  },
  {
    name: "Toxicology (Clinical)",
    subcategories: [
      "Poisoning Assessment",
      "Toxicology Screen Report",
      "Overdose Management Report",
      "Occupational Exposure Assessment",
    ],
  },
  {
    name: "Forensic Medicine",
    subcategories: [
      "Forensic Examination Report",
      "Medico-Legal Report",
      "Autopsy Report",
      "Sexual Assault Examination Report",
    ],
  },
  {
    name: "Insurance & Administrative",
    subcategories: [
      "Insurance Claim Report",
      "Fitness Certificate",
      "Medical-Legal Evaluation",
      "Independent Medical Examination",
      "Disability Claim Report",
    ],
  },
  {
    name: "Telemedicine",
    subcategories: [
      "Telehealth Consultation",
      "Remote Patient Monitoring Report",
      "Virtual Follow-up",
      "E-Prescription Report",
    ],
  },
];
/* ─── MAIN COMPONENT ─── */
const ReportUpload = () => {
  const navigate = useNavigate();
  const query = new URLSearchParams(useLocation().search);

  const doctorId = query.get("doctor_id");
  const patientId = query.get("patient_id");
  const appointmentId = query.get("appointment_id") || null;

  /* ── state ── */
  const [uploadMode, setUploadMode] = useState("document");
  const [documentCategory, setDocumentCategory] = useState("");
  const [docType, setDocType] = useState("");
  const [reportDate, setReportDate] = useState("2026-01-30");
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [ocrTaskId, setOcrTaskId] = useState(null);
  const [ocrStatus, setOcrStatus] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [pollingError, setPollingError] = useState(false);
  const [customDocumentTypes, setCustomDocumentTypes] = useState([]);
  const [customImageTypes, setCustomImageTypes] = useState([]);
  const [categoryKey, setCategoryKey] = useState("");
  const [subcategoryKey, setSubcategoryKey] = useState("");
  const [hospitalRules, setHospitalRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [reportTiming, setReportTiming] = useState("current");
    const [reportTypeCategory, setReportTypeCategory] = useState("");
  const [reportTypeSubcategory, setReportTypeSubcategory] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [processingStatus, setProcessingStatus] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [prevFileName, setPrevFileName] = useState("");
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [allowUpload, setAllowUpload] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [hoveredNav, setHoveredNav] = useState(null);


const [pendingInvestigations, setPendingInvestigations] = useState([]);
  const [loadingInvestigations, setLoadingInvestigations] = useState(false);
  const [investigationFiles, setInvestigationFiles] = useState({});     // { [id]: File }
  const [uploadingInvestigationId, setUploadingInvestigationId] = useState(null);
  const [investigationMessage, setInvestigationMessage] = useState(null); // { id, type, text }

  /* ── refs ── */
  const pollingIntervalRef = useRef(null);
  const processingIntervalRef = useRef(null);
  const maxRetries = 3;

  if (!doctorId || !patientId) {
    return (
      <div style={{ padding: "2.5rem", textAlign: "center", fontFamily: "'Open Sans', sans-serif", color: T.textMuted }}>
        Invalid URL parameters
      </div>
    );
  }

  /* ── data fetchers ── */
  const fetchDoctorHospital = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
      const json = await res.json();
      if (json.status === "success") {
        setHospitalId(json.doctor.hospital_id);
        fetchHospitalRules(json.doctor.hospital_id);
      }
    } catch { }
  };

  const fetchHospitalRules = async (hid) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/get_ReportHospitalRules/${hid}`);
      const data = await res.json();
      if (data.status === "success") {
        setHospitalRules(data.rules);
        setCategories([...new Set(data.rules.map((r) => r.category))]);
      }
    } catch { }
  };

  /* ── effects ── */
  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doctor_id: doctorId }),
        });
        const data = await res.json();
        if (data.status === "success") { setDoctorName(data.doctor_name); setDoctorSpeciality(data.doctor_speciality); }
      } catch { }
    })();
  }, [doctorId]);

  useEffect(() => { fetchDocuments(); fetchReportTypes(); fetchDoctorHospital(); fetchPendingInvestigations(); }, []);

  useEffect(() => {
    if (!categoryKey) { setSubcategories([]); return; }
    const subs = hospitalRules.filter((r) => r.category === categoryKey).map((r) => r.subcategory);
    setSubcategories([...new Set(subs)]);
  }, [categoryKey, hospitalRules]);

  useEffect(() => { return () => { if (processingIntervalRef.current) clearInterval(processingIntervalRef.current); }; }, []);

  useEffect(() => {
    if (alerts.length > 0) {
      const t = setTimeout(() => { setAlerts([]); setShowAlerts(false); }, 10000);
      return () => clearTimeout(t);
    }
  }, [alerts]);

  /* ── document data ── */
  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/th/patient/${patientId}`);
      if (!res.ok) return;
      const result = await res.json();
      if (result.documents && Array.isArray(result.documents)) {
        setDocuments(result.documents.map((doc, i) => ({
          id: doc.id || `${i}`,
          document_id: doc.file_name,
          display_name: doc.og_file_name || doc.file_name,
          file_name: doc.file_name,
          file_url: doc.file_url,
          created_at: doc.processing_date,
          document_date: doc.document_date,
          raw_markdown: doc.raw_markdown,
          sections: doc.sections,
          entities: doc.entities,
          document_count: doc.document_count,
        })));
      } else { setDocuments([]); }
    } catch { setDocuments([]); }
  };

const fetchPendingInvestigations = async () => {
    setLoadingInvestigations(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/orchestration/oncology-investigations/pending?patient_id=${patientId}&doctor_id=${doctorId}`
      );
      if (!res.ok) { setPendingInvestigations([]); return; }
      const json = await res.json();
      if (json.status === "success") {
        setPendingInvestigations(json.investigations || []);
      } else {
        setPendingInvestigations([]);
      }
    } catch (err) {
      console.error("❌ Failed to fetch pending investigations:", err);
      setPendingInvestigations([]);
    } finally {
      setLoadingInvestigations(false);
    }
  };

  const fetchProcessingStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/status/${patientId}/${doctorId}`);
      if (!res.ok) return;
      const data = await res.json();
      setProcessingStatus(data);
      if (data.status === "completed") {
        setIsProcessing(false);
        if (processingIntervalRef.current) { clearInterval(processingIntervalRef.current); processingIntervalRef.current = null; }
        setMessage({ type: "success", text: "All documents processed successfully 🎉" });
        fetchDocuments();
      }
    } catch { }
  };

  const startProcessingPolling = () => {
    if (processingIntervalRef.current) return;
    setIsProcessing(true);
    fetchProcessingStatus();
    processingIntervalRef.current = setInterval(fetchProcessingStatus, 10000);
  };

  const fetchReportTypes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/cm/storagehms/report-node/report-types?doctor_id=${doctorId}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.status === "success") { setCustomDocumentTypes(json.data.document_types || []); setCustomImageTypes(json.data.image_types || []); }
    } catch { }
  };

  const handleDeleteDocument = async (doc) => {
    if (!window.confirm(`Are you sure you want to delete "${doc.display_name}"?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/delete/${patientId}/${doc.document_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDocuments((prev) => prev.filter((d) => d.document_id !== doc.document_id));
      setMessage({ type: "success", text: "Document deleted successfully" });
    } catch { setMessage({ type: "error", text: "Failed to delete document" }); }
  };

  const pollOCRStatus = async (taskId) => {
    const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/task-status/${taskId}`);
    if (!res.ok) {
      const t = await res.text();
      if (t.includes("PRECONDITION_FAILED") || t.includes("delivery acknowledgement") || t.includes("timed out"))
        throw new Error("OCR processing system is temporarily unavailable. Please try again later.");
      throw new Error(`Failed to fetch OCR status: ${res.status}`);
    }
    return res.json();
  };

  const handlePollingError = (error) => {
    setPollingError(true);
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
    let msg = "OCR processing system is experiencing issues. ";
    if (error.message.includes("temporarily unavailable")) msg = error.message;
    else if (retryCount < maxRetries) msg += `Retrying... (${retryCount + 1}/${maxRetries})`;
    else msg += "Maximum retries reached. Please try uploading again.";
    setMessage({ type: "error", text: msg });
    if (retryCount < maxRetries) setTimeout(() => { setRetryCount((p) => p + 1); if (ocrTaskId) startOCRPolling(ocrTaskId); }, 5000);
  };

  const startOCRPolling = (taskId) => {
    setOcrTaskId(taskId); setPollingError(false);
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const result = await pollOCRStatus(taskId);
        if (result) {
          setOcrStatus({ status: result.status, completed: result.completed, result: result.result, alerts: result.alerts || [] });
          if (result.completed) {
            clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null;
            if (result.status === "SUCCESS") {
              setMessage({ type: "success", text: "OCR processing completed successfully!" });
              const norm = (a) => { if (!a) return []; if (Array.isArray(a)) return a; if (typeof a === "object") return [a]; return []; };
              const all = [...norm(result.alerts), ...norm(result.result?.alerts)];
              if (all.length > 0) { setAlerts(all); setShowAlerts(true); }
              fetchDocuments();
            } else { setMessage({ type: "error", text: `OCR processing failed: ${result.status}` }); }
          }
        }
      } catch (e) { handlePollingError(e); }
    }, 5000);
  };

  /* ── handlers ── */
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const name = f.name;
    if (prevFileName && prevFileName === name) { setIsDuplicate(true); setAllowUpload(false); setMessage({ type: "warning", text: "Same filename detected. You can still proceed." }); }
    else { setIsDuplicate(false); setAllowUpload(false); setMessage(null); }
    if (uploadMode === "image") {
      const exts = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"];
      if (!exts.includes(name.toLowerCase().slice(name.lastIndexOf(".")))) {
        setMessage({ type: "error", text: "Please select an image file (JPG, PNG, GIF, BMP, TIFF)" }); return;
      }
    }
    setFile(f); setFileName(name); if (!isDuplicate) setMessage(null);
  };

  const clearFile = () => { setFile(null); setFileName(""); };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) { setMessage({ type: "error", text: "Please select a file to upload" }); return; }
    if (isDuplicate && !allowUpload) { setMessage({ type: "warning", text: "Same filename detected. Click 'Proceed Anyway' to continue." }); return; }
    const formData = new FormData();
    formData.append("doctor_id", doctorId);
    formData.append("patient_id", patientId);
    formData.append("appointment_id", appointmentId);
    formData.append("hospital_id", hospitalId);
    formData.append("report_timing", reportTiming);
    if (categoryKey === "insurance" || categoryKey === "other") formData.append("doc_type", categoryKey);
    formData.append("report_date", reportDate);
    formData.append("upload_mode", uploadMode);
    formData.append("file", file);
    if (categoryKey && subcategoryKey) { formData.append("category", categoryKey); formData.append("subcategory", subcategoryKey); }
    if (reportTypeCategory) formData.append("report_category", reportTypeCategory);
    if (reportTypeSubcategory) formData.append("report_type", reportTypeSubcategory);
    try {
      setLoading(true); setMessage(null); setAlerts([]); setShowAlerts(false);
      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/proxy/upload`, { method: "POST", body: formData });
      if (!res.ok) { const t = await res.text(); setMessage({ type: "error", text: t || "Upload failed. Please try again." }); return; }
      const data = await res.json();
      setPrevFileName(file.name); setIsDuplicate(false); setAllowUpload(false);
      setDocuments((prev) => [{ id: crypto.randomUUID(), document_id: file.name, display_name: file.name, created_at: new Date().toISOString(), doc_type: "document" }, ...prev]);
      setMessage({ type: "info", text: data.message || "File uploaded successfully! Processing started..." });
      startProcessingPolling();
      setFile(null); setFileName(""); setReportDate(""); setDocType(uploadMode === "image" ? "x_ray" : "lab_report");
      setReportTypeCategory(""); setReportTypeSubcategory("");
    } catch (err) { setMessage({ type: "error", text: err.message || "Upload failed. Please try again." }); }
    finally { setLoading(false); }
  };


  const handleInvestigationFileChange = (investigationId, e) => {
    const f = e.target.files[0];
    if (!f) return;
    setInvestigationFiles((prev) => ({ ...prev, [investigationId]: f }));
    setInvestigationMessage(null);
  };

  const handleInvestigationUpload = async (investigationId) => {
    const f = investigationFiles[investigationId];
    if (!f) {
      setInvestigationMessage({ id: investigationId, type: "error", text: "Please select a file first" });
      return;
    }

    const formData = new FormData();
    formData.append("doctor_id", doctorId);
    formData.append("patient_id", patientId);
    formData.append("investigation_id", investigationId);
    formData.append("file", f);

    try {
      setUploadingInvestigationId(investigationId);
      setInvestigationMessage(null);

      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/oncology-investigations/upload-file-url`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.detail || "Upload failed");
      }

      // ✅ Success — remove this investigation from the pending list
      setPendingInvestigations((prev) => prev.filter((inv) => inv.id !== investigationId));
      setInvestigationFiles((prev) => {
        const updated = { ...prev };
        delete updated[investigationId];
        return updated;
      });

      // Optional: refresh the main document list, since the pipeline likely created a document
      fetchDocuments();

      setInvestigationMessage({ id: investigationId, type: "success", text: "Investigation processed and removed from pending list" });
    } catch (err) {
      console.error("❌ Investigation upload failed:", err);
      setInvestigationMessage({ id: investigationId, type: "error", text: err.message || "Upload failed. Please try again." });
    } finally {
      setUploadingInvestigationId(null);
    }
  };

  const handleModeChange = (mode) => {
    setUploadMode(mode);
    if (mode === "image") setDocType("x_ray");
    else if (mode === "document") setDocType(documentCategory);
    else if (mode === "handwritten") setDocType("handwritten");
    else setDocType("lab_report");
    setFile(null);
    setFileName("");
    setMessage(null);
    setReportTypeCategory("");
    setReportTypeSubcategory("");
  };;

  const handleLogout = async () => {
    try { await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: "POST", credentials: "include" }); } finally { navigate("/login"); }
  };

  /* ── derived ── */
  const filteredDocuments = documents.filter((doc) => {
    const lo = searchTerm.toLowerCase();
    const id = doc.document_id ? doc.document_id.toLowerCase() : "";
    return id.includes(lo) && (filterType === "all" || doc.doc_type === filterType);
  });

  const docTypes = ["all", ...new Set(documents.map((d) => d.doc_type || "document").filter(Boolean))];
  const availableReportTypeSubcategories =
    REPORT_TYPE_CATEGORIES.find((c) => c.name === reportTypeCategory)?.subcategories || [];
  const formatDate = (s) => {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  /* ── nav sections (same structure as DoctorDashboard) ── */
  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`) },
        { label: "Appointment", icon: <Settings size={14} />, action: () => (window.location.href = `/appointments?doctor_id=${doctorId}`) },
        { label: "Date-wise Appointments", icon: <Calendar size={14} />, action: () => navigate(`/date-appointments?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Clinical",
      items: [
        { label: "Node Settings", icon: <Settings size={14} />, action: () => (window.location.href = `/settings.html?doctor_id=${doctorId}`) },
        { label: "Clinical Context Rules", icon: <Activity size={14} />, action: () => (window.location.href = `/medical-clinical-context-rule-settings?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Communication",
      items: [
        { label: "Communication View", icon: <MessageCircle size={14} />, action: () => navigate(`/communication?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Other",
      items: [
        { label: "IPD / Ward Patients", icon: <Bed size={14} />, action: () => {} },
        { label: "Referrals", icon: <Activity size={14} />, action: () => {} },
        { label: "OPD Time Schedule", icon: <Calendar size={14} />, action: () => (window.location.href = `/opd-time-schedule?doctor_id=${doctorId}`) },
      ],
    },
  ];

  /* ── render ── */
  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .ru-spin { animation: spin 1s linear infinite; }
        .ru-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .ru-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .ru-action-btn:hover { background: transparent !important; color: ${T.text} !important; }
        .ru-outline-btn:hover { border-color: ${T.text} !important; }
        .ru-doc-card:hover { background: ${T.bgAlt} !important; }
        .ru-upload-zone:hover { border-color: ${T.text} !important; background: ${T.bgTert} !important; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ═══ SIDEBAR ═══════════════════════════════════════════════════════ */}
      <aside style={S.sidebar}>
        {/* brand */}
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            
            <span style={S.brandName}>EMR Module</span>
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorNameStyle}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        {/* nav */}
        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const key = `${si}-${ii}`;
                return (
                  <button
                    key={ii}
                    className="ru-nav-btn"
                    style={{ ...S.navBtn, ...(hoveredNav === key ? S.navBtnActive : {}) }}
                    onMouseEnter={() => setHoveredNav(key)}
                    onMouseLeave={() => setHoveredNav(null)}
                    onClick={item.action}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* logout */}
        <div style={S.sidebarFooter}>
          <button className="ru-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══ MAIN ══════════════════════════════════════════════════════════ */}
      <main style={S.main}>

        {/* top bar */}
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>Medical Reports &amp; Images</p>
            <p style={S.topBarSub}>Upload and manage patient documents and medical images</p>
          </div>
         
        </div>

        {/* body */}
        <div style={S.body}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "2rem", alignItems: "start" }}>
          {/* ── PENDING INVESTIGATIONS ───────────────────────────────── */}
          <div style={S.tableSection}>
            <div style={S.tableHeader}>
              <span style={S.tableHeaderTitle}>Pending Investigations</span>
              <span style={S.tableHeaderMeta}>
                {loadingInvestigations ? "Loading…" : `${pendingInvestigations.length} pending`}
              </span>
            </div>

            <div style={{ padding: "1.25rem 1.5rem" }}>
              {loadingInvestigations ? (
                <div style={{ textAlign: "center", padding: "2rem", color: T.textMuted }}>
                  <Loader2 size={22} className="ru-spin" style={{ marginBottom: "0.5rem" }} />
                  <p style={{ margin: 0, fontSize: "0.78rem", fontFamily: "'Open Sans', sans-serif" }}>Loading pending investigations…</p>
                </div>
              ) : pendingInvestigations.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: T.textMuted }}>
                  <FileText size={28} style={{ marginBottom: "0.5rem", opacity: 0.2 }} />
                  <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 300, fontFamily: "'Open Sans', sans-serif" }}>
                    No pending investigations
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {pendingInvestigations.map((inv) => (
                    <div key={inv.id} style={{ border: `1px solid ${T.border}`, padding: "0.875rem 1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: "200px" }}>
                          <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 400, color: T.text, fontFamily: "'Open Sans', sans-serif" }}>
                            {inv.investigation_name}
                          </p>
                          <p style={{ margin: "3px 0 0", fontSize: "0.68rem", color: T.textMuted, fontFamily: "'Open Sans', sans-serif" }}>
                            Ordered: {formatDate(inv.date_of_order)}
                          </p>
                          {inv.clinical_indication && (
                            <p style={{ margin: "3px 0 0", fontSize: "0.7rem", color: T.textSec, fontFamily: "'Open Sans', sans-serif" }}>
                              {inv.clinical_indication}
                            </p>
                          )}
                          {inv.parameters?.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.4rem" }}>
                              {inv.parameters.map((p, i) => (
                                <span key={i} style={S.badge}>{p}</span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                          <label
                            className="ru-outline-btn"
                            style={{ ...S.outlineBtn, cursor: "pointer" }}
                          >
                            <UploadCloud size={13} />
                            {investigationFiles[inv.id] ? investigationFiles[inv.id].name.slice(0, 18) : "Choose File"}
                            <input
                              type="file"
                              style={{ display: "none" }}
                              onChange={(e) => handleInvestigationFileChange(inv.id, e)}
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            />
                          </label>

                          <button
                            type="button"
                            className="ru-action-btn"
                            style={S.actionBtn}
                            disabled={uploadingInvestigationId === inv.id}
                            onClick={() => handleInvestigationUpload(inv.id)}
                          >
                            {uploadingInvestigationId === inv.id
                              ? <><Loader2 size={13} className="ru-spin" /> Uploading…</>
                              : <><UploadCloud size={13} /> Upload</>
                            }
                          </button>
                        </div>
                      </div>

                      {investigationMessage?.id === inv.id && (
                        <div style={{ ...S.msgBanner(investigationMessage.type), marginTop: "0.75rem" }}>
                          {investigationMessage.type === "success" ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                          <span>{investigationMessage.text}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
            {/* ── LEFT: document list ───────────────────────────────── */}
            <div>
              <div style={S.tableSection}>
                {/* section header */}
                <div style={S.tableHeader}>
                  <span style={S.tableHeaderTitle}>Uploaded Documents</span>
                  <span style={S.tableHeaderMeta}>{filteredDocuments.length} of {documents.length} items</span>
                </div>

                {/* search + filter */}
                <div style={{ display: "flex", gap: "0.75rem", padding: "0.875rem 1.5rem", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <Search size={13} style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: T.textMuted }} />
                    <input
                      type="text"
                      placeholder="Search documents…"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ ...S.input, paddingLeft: "2rem" }}
                      onFocus={(e) => (e.target.style.borderColor = T.text)}
                      onBlur={(e) => (e.target.style.borderColor = T.border)}
                    />
                  </div>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...S.select, width: "140px" }}>
                    {docTypes.map((t) => (
                      <option key={t} value={t}>
                        {t === "all" ? "All Types" : t === "document" ? "Document" : t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>

                {/* document grid */}
                <div style={{ padding: "1.25rem 1.5rem" }}>
                  {filteredDocuments.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem 1.25rem", color: T.textMuted }}>
                      <FileText size={36} style={{ marginBottom: "0.75rem", opacity: 0.2 }} />
                      <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 300, fontFamily: "'Open Sans', sans-serif" }}>
                        {searchTerm || filterType !== "all" ? "No items match your search" : "No documents uploaded yet"}
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
                      {filteredDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          className="ru-doc-card"
                          style={S.docCard}
                          onClick={() => { setSelectedDoc(doc); setShowModal(true); }}
                        >
                          {/* delete */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc); }}
                            style={{
                              position: "absolute", top: "0.5rem", right: "0.5rem",
                              background: "transparent", border: `1px solid ${T.border}`,
                              width: "22px", height: "22px", display: "flex",
                              alignItems: "center", justifyContent: "center",
                              cursor: "pointer", color: T.textMuted, transition: "all 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#e53935"; e.currentTarget.style.color = "#e53935"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}
                          >
                            <X size={11} />
                          </button>

                          {/* icon + badge */}
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <FileText size={14} style={{ color: T.textMuted, flexShrink: 0 }} />
                            <span style={S.badge}>Document</span>
                          </div>

                          {/* name */}
                          <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.text, margin: 0, lineHeight: 1.4, wordBreak: "break-word", paddingRight: "1.5rem", fontFamily: "'Open Sans', sans-serif" }}>
                            {doc.display_name}
                          </p>

                          {/* date */}
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            <Calendar size={11} style={{ color: T.textMuted }} />
                            <span style={{ fontSize: "0.65rem", color: T.textMuted, fontWeight: 300, fontFamily: "'Open Sans', sans-serif" }}>
                              {formatDate(doc.created_at)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── RIGHT: upload panel ───────────────────────────────── */}
            <div style={{ position: "sticky", top: "5rem" }}>
              <div style={S.tableSection}>
                <div style={S.tableHeader}>
                  <span style={S.tableHeaderTitle}>Upload File</span>
                  <span style={S.tableHeaderMeta}>{uploadMode === "image" ? "Medical image" : "Document"}</span>
                </div>

                <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>

                  {/* mode toggle */}
                  {/* mode toggle - All Docs is default */}
                  <div style={S.modeToggleWrap}>
                    {[
                      { value: "document", label: "All Docs" },
                      { value: "handwritten", label: "Handwritten" },
                      { value: "image", label: "Image" }
                    ].map((mode, i, arr) => (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => handleModeChange(mode.value)}
                        style={{
                          ...S.modeBtn(uploadMode === mode.value),
                          borderRight: i < arr.length - 1 ? `1px solid ${T.border}` : "none",
                        }}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={handleUpload}>

                    {/* category / subcategory */}
                    {uploadMode === "document" && (
                      <div style={{ marginBottom: "1rem" }}>
                        <label style={S.label}>Report Timing</label>
                        <div style={{ display: "flex", gap: "1.25rem", padding: "0.4rem 0" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name="reportTiming"
                              value="current"
                              checked={reportTiming === "current"}
                              onChange={() => setReportTiming("current")}
                            />
                            <span style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSec, fontFamily: "'Open Sans', sans-serif" }}>
                              Current Report
                            </span>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name="reportTiming"
                              value="previous"
                              checked={reportTiming === "previous"}
                              onChange={() => setReportTiming("previous")}
                            />
                            <span style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSec, fontFamily: "'Open Sans', sans-serif" }}>
                              Previous Report
                            </span>
                          </label>
                        </div>
                      </div>
                    )}
{/* optional report category + type */}
                    {uploadMode === "document" && (
                      <div style={{ marginBottom: "1rem" }}>
                        <label style={S.label}>Report Category (Optional)</label>
                        <select
                          value={reportTypeCategory}
                          onChange={(e) => { setReportTypeCategory(e.target.value); setReportTypeSubcategory(""); }}
                          style={{ ...S.select, marginBottom: reportTypeCategory ? "0.75rem" : 0 }}
                        >
                          <option value="">Select Category</option>
                          {REPORT_TYPE_CATEGORIES.map((cat) => (
                            <option key={cat.name} value={cat.name}>{cat.name}</option>
                          ))}
                        </select>

                        {reportTypeCategory && (
                          <>
                            <label style={S.label}>Report Type (Optional)</label>
                            <select
                              value={reportTypeSubcategory}
                              onChange={(e) => setReportTypeSubcategory(e.target.value)}
                              style={S.select}
                            >
                              <option value="">Select Report Type</option>
                              {availableReportTypeSubcategories.map((sub) => (
                                <option key={sub} value={sub}>{sub}</option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    )}
                    {/* file area */}
                    <div style={{ marginBottom: "1rem" }}>
                      <label style={S.label}>{uploadMode === "image" ? "Select Image" : "Select File"}</label>
                      {!file ? (
                        <label className="ru-upload-zone" style={S.uploadZone}>
                          {uploadMode === "image"
                            ? <ImageIcon size={28} style={{ color: T.textMuted, marginBottom: "0.5rem" }} />
                            : <UploadCloud size={28} style={{ color: T.textMuted, marginBottom: "0.5rem" }} />
                          }
                          <span style={{ fontSize: "0.78rem", fontWeight: 400, color: T.textSec, marginBottom: "0.25rem", fontFamily: "'Open Sans', sans-serif" }}>
                            Click to browse files
                          </span>
                          <span style={{ fontSize: "0.68rem", color: T.textMuted, fontFamily: "'Open Sans', sans-serif", fontWeight: 300 }}>
                            {uploadMode === "image" 
                              ? "JPG, PNG, GIF, BMP, TIFF — max 10MB"
                              : uploadMode === "handwritten"
                              ? "PDF, JPG, PNG — max 10MB (Handwritten)"
                              : "PDF, DOC, JPG, PNG — max 10MB"}
                          </span>
                          <input type="file" onChange={handleFileChange} style={{ display: "none" }} required
                            accept={uploadMode === "image" ? ".jpg,.jpeg,.png,.gif,.bmp,.tiff" : ".pdf,.doc,.docx,.jpg,.jpeg,.png"} />
                        </label>
                      ) : (
                        <div style={S.filePreview}>
                          {uploadMode === "image"
                            ? <ImageIcon size={15} style={{ color: T.textMuted, flexShrink: 0 }} />
                            : <FileText size={15} style={{ color: T.textMuted, flexShrink: 0 }} />
                          }
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.text, margin: 0, wordBreak: "break-word", fontFamily: "'Open Sans', sans-serif" }}>{fileName}</p>
                            <p style={{ fontSize: "0.65rem", color: T.textMuted, margin: "2px 0 0", fontFamily: "'Open Sans', sans-serif", fontWeight: 300 }}>Ready to upload</p>
                          </div>
                          <button type="button" onClick={clearFile}
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: T.textMuted, display: "flex", alignItems: "center", flexShrink: 0 }}>
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* upload btn */}
                    <button type="submit" className="ru-action-btn"
                      style={{ ...S.actionBtn, width: "100%", justifyContent: "center", padding: "0.65rem 1rem", fontSize: "0.75rem" }}>
                      {loading
                        ? <><Loader2 size={14} className="ru-spin" /> Uploading…</>
                        : uploadMode === "image"
                        ? <><ImageIcon size={14} /> Upload Image</>
                        : <><UploadCloud size={14} /> Upload Document</>
                      }
                    </button>

                    {/* processing */}
                    {isProcessing && (
                      <div style={S.processingBar}>
                        <Loader2 size={13} className="ru-spin" />
                        <span>Processing… ({processingStatus?.processed_documents || 0}/{processingStatus?.total_documents || 0})</span>
                      </div>
                    )}

                    {/* completed */}
                    {!isProcessing && processingStatus?.status === "completed" && (
                      <div style={{ ...S.processingBar, background: "#f1f8e9", borderColor: "#c8e6c9", color: "#2e7d32" }}>
                        <CheckCircle size={13} />
                        <span>Processing complete ({processingStatus?.processed_documents}/{processingStatus?.total_documents})</span>
                      </div>
                    )}

                    {/* message */}
                    {message && (
                      <>
                        <div style={S.msgBanner(message.type)}>
                          {message.type === "success" && <CheckCircle size={13} />}
                          {message.type === "error" && <X size={13} />}
                          {message.type === "warning" && <AlertCircle size={13} />}
                          {message.type === "info" && <Clock size={13} />}
                          <span>{message.text}</span>
                        </div>
                        {isDuplicate && !allowUpload && (
                          <button type="button" className="ru-outline-btn"
                            style={{ ...S.outlineBtn, width: "100%", justifyContent: "center", marginTop: "0.5rem", padding: "0.5rem 1rem", fontSize: "0.72rem" }}
                            onClick={() => { setAllowUpload(true); setMessage({ type: "info", text: "Proceed enabled. Click upload again." }); }}>
                            Proceed Anyway
                          </button>
                        )}
                      </>
                    )}
                  </form>

                  {/* tips */}
                  <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: `1px solid ${T.border}` }}>
                    <span style={{ ...S.label, marginBottom: "0.5rem" }}>
                      {uploadMode === "image" ? "Image" : "Document"} upload tips
                    </span>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.72rem", fontWeight: 300, color: T.textMuted, lineHeight: 1.8, fontFamily: "'Open Sans', sans-serif" }}>
                      {uploadMode === "image" ? (
                        <>
                          <li>Ensure image is clear and properly oriented</li>
                          <li>File size should be less than 10MB</li>
                          <li>Supported: JPG, PNG, GIF, BMP, TIFF</li>
                          <li>Include patient details if not auto-detected</li>
                        </>
                      ) : (
                        <>
                          <li>Ensure document is clear and readable</li>
                          <li>Verify report date accuracy</li>
                          <li>Max file size: 10MB</li>
                          <li>Supported: PDF, DOC, JPG, PNG</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ═══ MODAL ══════════════════════════════════════════════════════════ */}
      {showModal && selectedDoc && (
        <div style={S.modalOverlay} onClick={() => setShowModal(false)}>
          <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
            {/* close */}
            <button onClick={() => setShowModal(false)}
              style={{ position: "absolute", top: "1rem", right: "1rem", background: "transparent", border: `1px solid ${T.border}`, width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.textMuted }}>
              <X size={13} />
            </button>

            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", marginBottom: "1.25rem", paddingBottom: "1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ width: "40px", height: "40px", background: T.bgAlt, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {selectedDoc.upload_mode === "image" ? <ImageIcon size={18} style={{ color: T.textMuted }} /> : <FileText size={18} style={{ color: T.textMuted }} />}
              </div>
              <div>
                <p style={{ fontSize: "1rem", fontWeight: 400, color: T.text, margin: 0, textTransform: "capitalize", fontFamily: "'Open Sans', sans-serif" }}>
                  {(selectedDoc.doc_type || "document").replace(/_/g, " ")}
                </p>
                <p style={{ fontSize: "0.72rem", color: T.textMuted, margin: "3px 0 0", fontFamily: "'Open Sans', sans-serif", fontWeight: 300 }}>
                  {selectedDoc.file_name}
                </p>
              </div>
            </div>

            {/* meta */}
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1.5rem", paddingBottom: "1.25rem", borderBottom: `1px solid ${T.border}` }}>
              {[
                { label: "Upload Type", value: selectedDoc.upload_mode === "image" ? "Medical Image" : "Document" },
                { label: "Report Date", value: formatDate(selectedDoc.report_date) },
                { label: "Uploaded On", value: formatDate(selectedDoc.created_at) },
                { label: "Data Points", value: selectedDoc.data?.length || 0 },
              ].map((m) => (
                <div key={m.label}>
                  <span style={{ ...S.label, marginBottom: "0.25rem" }}>{m.label}</span>
                  <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: 0, fontFamily: "'Open Sans', sans-serif" }}>{m.value}</p>
                </div>
              ))}
            </div>

            <DynamicTable rows={selectedDoc.data || []} />
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── DYNAMIC TABLE ─── */
const DynamicTable = ({ rows }) => {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "2.5rem", background: T.bgAlt, border: `1px solid ${T.border}` }}>
        <FileText size={28} style={{ color: T.border, marginBottom: "0.625rem" }} />
        <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 300, color: T.textMuted, fontFamily: "'Open Sans', sans-serif" }}>
          No structured data available for this document
        </p>
      </div>
    );
  }
  const columns = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${T.border}` }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} style={{
                textAlign: "left", padding: "0.65rem 1rem", fontSize: "0.62rem", fontWeight: 400,
                textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted,
                borderBottom: `1px solid ${T.border}`, background: T.bgAlt,
                whiteSpace: "nowrap", fontFamily: "'Open Sans', sans-serif",
              }}>
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? T.bg : T.bgAlt }}>
              {columns.map((col) => (
                <td key={col} style={{ padding: "0.75rem 1rem", fontSize: "0.78rem", fontWeight: 300, color: T.textSec, borderBottom: `1px solid ${T.border}`, fontFamily: "'Open Sans', sans-serif" }}>
                  {row[col] !== null && row[col] !== undefined ? String(row[col]) : <span style={{ color: T.textMuted }}>—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ textAlign: "right", fontSize: "0.65rem", color: T.textMuted, margin: "0.5rem 0 0", fontFamily: "'Open Sans', sans-serif", fontWeight: 300 }}>
        {rows.length} row{rows.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
};

export default ReportUpload;