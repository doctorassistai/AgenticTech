import React, { useState, useEffect, useRef } from "react";
import {
  Home, LogOut, Phone, Ambulance, MapPin, Activity, Bell,
  FileText, Settings, Menu, X, Clock, AlertTriangle, CheckCircle,
  Radio, Navigation, Search, Users, Hospital, ChevronRight,
  Mic, Volume2, RefreshCw, Filter, Plus, Eye, EyeOff, Edit2, Save
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const SIDEBAR_WIDTH = "248px";

const loadGoogleMaps = () => {
  return new Promise((resolve) => {
    if (window.google && window.google.maps) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=AIzaSyA3VwLT1IQxhUeGKxKstHw-dZ2uJ4Hta7w&libraries=places";
    script.async = true; script.defer = true;
    script.onload = () => { console.log("Google Maps Loaded ✅"); resolve(); };
    document.head.appendChild(script);
  });
};

const T = {
  bg: "#ffffff", bgAlt: "#fafafa", bgTert: "#f5f5f5",
  text: "#000000", textSec: "#444444", textMuted: "#888888",
  border: "#e0e0e0", borderStr: "#000000", accent: "#000000",
};

const S = {
  layout: { display: "flex", minHeight: "100vh", background: T.bg, fontFamily: "'Open Sans', sans-serif", fontWeight: 300, WebkitFontSmoothing: "antialiased", color: T.text },
  sidebar: { width: SIDEBAR_WIDTH, minHeight: "100vh", position: "fixed", left: 0, top: 0, background: T.bg, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", zIndex: 200, overflowY: "auto", transition: "transform 0.3s ease" },
  sidebarHeader: { padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}`, flexShrink: 0 },
  brandRow: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" },
  brandName: { fontWeight: 400, fontSize: "0.9rem", letterSpacing: "-0.01em", color: T.text, margin: 0 },
  sectionLabel: { fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.18em", color: T.textMuted, fontWeight: 400, display: "block", marginBottom: "0.25rem" },
  agentName: { fontSize: "0.9rem", fontWeight: 400, color: T.text, margin: 0 },
  agentRole: { fontSize: "0.72rem", color: T.textMuted, margin: "2px 0 0" },
  menuScroll: { flex: 1, overflowY: "auto", padding: "0.75rem 0" },
  navGroupLabel: { fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, fontWeight: 400, padding: "0.5rem 0.75rem 0.25rem", display: "block" },
  navBtn: { width: "100%", background: "transparent", border: "none", textAlign: "left", padding: "0.55rem 1.25rem", fontSize: "0.78rem", fontWeight: 300, color: T.textSec, cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", transition: "all 0.15s", fontFamily: "'Open Sans', sans-serif", borderLeft: "2px solid transparent" },
  navBtnActive: { background: T.bgAlt, color: T.text, fontWeight: 400, borderLeft: `2px solid ${T.accent}` },
  sidebarFooter: { padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}`, flexShrink: 0 },
  logoutBtn: { width: "100%", background: "transparent", border: `1px solid ${T.border}`, padding: "0.6rem 1rem", fontSize: "0.75rem", fontWeight: 400, color: T.textSec, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "'Open Sans', sans-serif", transition: "all 0.2s" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 199 },
  main: { flex: 1, marginLeft: SIDEBAR_WIDTH, minWidth: 0, display: "flex", flexDirection: "column", transition: "margin-left 0.3s ease" },
  topBar: { position: "sticky", top: 0, background: T.bg, borderBottom: `1px solid ${T.border}`, padding: "0.875rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 100, gap: "12px" },
  topBarLeft: { display: "flex", alignItems: "center", gap: "12px" },
  topBarTitle: { fontSize: "1rem", fontWeight: 400, color: T.text, letterSpacing: "-0.01em", margin: 0 },
  hamburger: { background: "none", border: "none", cursor: "pointer", color: T.text, padding: "4px", display: "flex", alignItems: "center" },
  body: { padding: "2rem", flex: 1 },
  pageLabel: { fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: T.textMuted, fontWeight: 400, display: "block", marginBottom: "0.25rem" },
  pageTitle: { fontSize: "1.4rem", fontWeight: 300, letterSpacing: "-0.02em", color: T.text, marginBottom: "1.5rem" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1px", border: `1px solid ${T.border}`, marginBottom: "2rem", background: T.border },
  statCell: { background: T.bg, padding: "1.25rem 1.5rem", cursor: "default", transition: "background 0.15s" },
  statNum: { fontSize: "1.8rem", fontWeight: 300, letterSpacing: "-0.04em", color: T.text, margin: 0, lineHeight: 1 },
  statLabel: { fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, marginTop: "0.35rem", display: "block" },
  section: { border: `1px solid ${T.border}`, marginBottom: "2rem" },
  sectionHeader: { padding: "1rem 1.5rem", borderBottom: `1px solid ${T.border}`, background: T.bgAlt, display: "flex", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: "0.75rem", fontWeight: 400, color: T.text, textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 },
  sectionMeta: { fontSize: "0.65rem", color: T.textMuted },
  tableWrap: { overflowX: "auto", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "700px" },
  th: { textAlign: "left", padding: "0.65rem 1rem", fontSize: "0.62rem", fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", background: T.bgAlt },
  td: { padding: "0.75rem 1rem", fontSize: "0.78rem", fontWeight: 300, color: T.textSec, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" },
  tdBold: { padding: "0.75rem 1rem", fontSize: "0.78rem", fontWeight: 400, color: T.text, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px" },
  badge: { padding: "0.2rem 0.5rem", fontSize: "0.6rem", fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.08em", border: `1px solid ${T.border}`, display: "inline-block" },
  actionBtn: { padding: "0.3rem 0.75rem", background: T.text, color: T.bg, border: `1px solid ${T.text}`, fontSize: "0.65rem", fontWeight: 400, cursor: "pointer", fontFamily: "'Open Sans', sans-serif", transition: "all 0.15s", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "5px", letterSpacing: "0.05em" },
  outlineBtn: { padding: "0.3rem 0.75rem", background: T.bg, color: T.text, border: `1px solid ${T.border}`, fontSize: "0.65rem", fontWeight: 400, cursor: "pointer", fontFamily: "'Open Sans', sans-serif", transition: "all 0.15s", display: "inline-flex", alignItems: "center", gap: "5px" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" },
  modalBox: { background: T.bg, border: `1px solid ${T.border}`, width: "100%", maxWidth: "680px", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" },
  modalHeader: { padding: "1.25rem 1.5rem", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bgAlt, flexShrink: 0, position: "sticky", top: 0 },
  modalTitle: { fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" },
  modalBody: { padding: "1.5rem", flex: 1 },
  modalFooter: { padding: "1rem 1.5rem", borderTop: `1px solid ${T.border}`, display: "flex", gap: "8px", justifyContent: "flex-end", background: T.bgAlt, flexShrink: 0, position: "sticky", bottom: 0 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" },
  formGrid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" },
  formGroup: { display: "flex", flexDirection: "column", gap: "4px", marginBottom: "0.75rem" },
  formGroupNoMb: { display: "flex", flexDirection: "column", gap: "4px" },
  label: { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, fontWeight: 400 },
  input: { padding: "0.55rem 0.75rem", border: `1px solid ${T.border}`, background: T.bg, fontSize: "0.78rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, color: T.text, outline: "none", width: "100%", transition: "border-color 0.15s", boxSizing: "border-box" },
  select: { padding: "0.55rem 0.75rem", border: `1px solid ${T.border}`, background: T.bg, fontSize: "0.78rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, color: T.text, outline: "none", width: "100%", cursor: "pointer", appearance: "none" },
  textarea: { padding: "0.55rem 0.75rem", border: `1px solid ${T.border}`, background: T.bg, fontSize: "0.78rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, color: T.text, outline: "none", width: "100%", resize: "vertical", minHeight: "80px", boxSizing: "border-box" },
  timeline: { display: "flex", flexDirection: "column", gap: 0 },
  timelineItem: { display: "flex", gap: "12px", padding: "0.875rem 1.5rem", borderBottom: `1px solid ${T.border}`, position: "relative" },
  timelineDot: { width: "8px", height: "8px", borderRadius: "50%", background: T.text, flexShrink: 0, marginTop: "4px" },
  timelineContent: { flex: 1 },
  timelineTs: { fontSize: "0.62rem", color: T.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "2px" },
  timelineText: { fontSize: "0.78rem", fontWeight: 300, color: T.textSec, lineHeight: 1.5 },
  timelineSource: { fontSize: "0.6rem", color: T.textMuted, marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.1em" },
  ambGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1px", background: T.border },
  ambCard: { background: T.bg, padding: "1.25rem", cursor: "pointer", transition: "background 0.15s" },
  ambCardSelected: { background: T.bgAlt, outline: `2px solid ${T.text}`, outlineOffset: "-2px" },
  ambId: { fontSize: "0.9rem", fontWeight: 400, color: T.text, margin: "0 0 4px" },
  ambMeta: { fontSize: "0.72rem", color: T.textMuted, margin: "1px 0" },
  hospCard: { border: `1px solid ${T.border}`, padding: "1rem 1.25rem", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", transition: "background 0.15s" },
  hospCardSelected: { border: `1px solid ${T.text}`, background: T.bgAlt },
};

const statusBadge = (status) => {
  const colors = {
    "Active": { border: "#000", color: "#000" }, "Dispatched": { border: "#000", color: "#000" },
    "On-Scene": { border: "#888", color: "#444" }, "En Route": { border: "#888", color: "#444" },
    "Closed": { border: T.border, color: T.textMuted }, "Available": { border: "#000", color: "#000" },
    "Busy": { border: T.border, color: T.textMuted }, "Critical": { border: "#000", color: "#000" },
    "Stable": { border: T.border, color: T.textMuted },
  };
  const s = colors[status] || { border: T.border, color: T.textMuted };
  return { ...S.badge, borderColor: s.border, color: s.color };
};

const triageBadge = (level) => {
  const map = {
    "Red": { border: "#000", color: "#000", bg: "#fff" }, "Yellow": { border: "#888", color: "#444", bg: "#fafafa" },
    "Green": { border: T.border, color: T.textMuted, bg: "#fff" }, "Black": { border: "#000", color: T.textMuted, bg: "#fafafa" },
  };
  const s = map[level] || map["Green"];
  return { ...S.badge, borderColor: s.border, color: s.color, background: s.bg };
};

const MOCK_INCIDENTS = [
  { id: "INC-001", caseId: "ED-2024-0412-001", callerPhone: "+91-9876543210", location: "MG Road & Brigade Junction, Bengaluru", incidentType: "Road Accident", patientStatus: "Unconscious, bleeding", victims: 2, status: "Dispatched", triage: "Red", assignedAmbulance: "AMB-007", assignedHospital: "Manipal Hospital, HAL", eta: "8 min", createdAt: "10:14 AM", timestamp: "T0" },
  { id: "INC-002", caseId: "ED-2024-0412-002", callerPhone: "+91-9012345678", location: "Koramangala 5th Block, Bengaluru", incidentType: "Cardiac Arrest", patientStatus: "Conscious, chest pain", victims: 1, status: "On-Scene", triage: "Red", assignedAmbulance: "AMB-003", assignedHospital: "Fortis, Bannerghatta", eta: "Arrived", createdAt: "10:02 AM", timestamp: "T2" },
  { id: "INC-003", caseId: "ED-2024-0412-003", callerPhone: "+91-8765432109", location: "Indiranagar 100 Feet Road, Bengaluru", incidentType: "Fall Injury", patientStatus: "Conscious, leg fracture suspected", victims: 1, status: "En Route", triage: "Yellow", assignedAmbulance: "AMB-011", assignedHospital: "St. John's Medical College", eta: "12 min", createdAt: "09:48 AM", timestamp: "T1" },
  { id: "INC-004", caseId: "ED-2024-0412-004", callerPhone: "+91-7654321098", location: "Whitefield Main Road, Bengaluru", incidentType: "Burns", patientStatus: "Conscious, partial burns on arms", victims: 1, status: "Active", triage: "Yellow", assignedAmbulance: null, assignedHospital: null, eta: null, createdAt: "10:21 AM", timestamp: "T0" },
  { id: "INC-005", caseId: "ED-2024-0412-005", callerPhone: "+91-6543210987", location: "Rajajinagar, Bengaluru", incidentType: "Stroke", patientStatus: "Semi-conscious, facial drooping", victims: 1, status: "Closed", triage: "Red", assignedAmbulance: "AMB-002", assignedHospital: "NIMHANS", eta: "Reached", createdAt: "08:55 AM", timestamp: "T3" },
];

const MOCK_AMBULANCES = [
  { id: "AMB-001", crew: "Amal / EMT Priya", distance: "1.2 km", eta: "4 min", status: "Available", facilities: ["Ventilator", "Defibrillator", "Trauma Kit"], priority: "ALS" },
  { id: "AMB-002", crew: "Vikram Singh / EMT Anand", distance: "2.1 km", eta: "7 min", status: "Available", facilities: ["Cardiac Monitor", "O2 Supply"], priority: "BLS" },
  { id: "AMB-003", crew: "Suresh Reddy / EMT Kavya", distance: "3.4 km", eta: "11 min", status: "Available", facilities: ["Trauma Kit", "Splint Set", "O2 Supply"], priority: "BLS" },
  { id: "AMB-004", crew: "Mohan Das / EMT Riya", distance: "4.0 km", eta: "13 min", status: "Available", facilities: ["Ventilator", "Cardiac Monitor", "Defibrillator"], priority: "ALS" },
  { id: "AMB-005", crew: "Arun Nair / EMT Sunita", distance: "5.2 km", eta: "17 min", status: "Available", facilities: ["O2 Supply", "Basic First Aid"], priority: "BLS" },
  { id: "AMB-006", crew: "Deepak Rao / EMT Meena", distance: "6.1 km", eta: "20 min", status: "Busy", facilities: ["Ventilator", "Trauma Kit", "Defibrillator"], priority: "ALS" },
  { id: "AMB-007", crew: "Rajesh Nair / EMT Sita", distance: "2.5 km", eta: "8 min", status: "Available", facilities: ["Ventilator", "Defibrillator", "Cardiac Monitor"], priority: "ALS" },
  { id: "AMB-008", crew: "Prakash Sharma / EMT Geeta", distance: "3.8 km", eta: "12 min", status: "Available", facilities: ["O2 Supply", "Trauma Kit"], priority: "BLS" },
  { id: "AMB-009", crew: "Ramesh Gupta / EMT Rekha", distance: "4.5 km", eta: "15 min", status: "Available", facilities: ["Defibrillator", "Cardiac Monitor"], priority: "ALS" },
  { id: "AMB-010", crew: "Sunil Kumar / EMT Anjali", distance: "5.8 km", eta: "18 min", status: "Available", facilities: ["Basic First Aid", "O2 Supply"], priority: "BLS" },
];

const MOCK_HOSPITALS = [
  { id: "HOSP-001", name: "Manipal Hospital, HAL Airport Road", distance: "3.2 km", eta: "9 min", erLoad: "Moderate", traumaLevel: "Level I", specialties: ["Trauma", "Cardiac", "Neuro"] },
  { id: "HOSP-002", name: "Fortis Hospital, Bannerghatta Road", distance: "5.1 km", eta: "14 min", erLoad: "Low", traumaLevel: "Level II", specialties: ["Cardiac", "Ortho", "Burns"] },
  { id: "HOSP-003", name: "St. John's Medical College Hospital", distance: "6.4 km", eta: "18 min", erLoad: "High", traumaLevel: "Level I", specialties: ["Trauma", "Neuro", "Cardiac"] },
  { id: "HOSP-004", name: "Sakra World Hospital", distance: "4.8 km", eta: "13 min", erLoad: "Low", traumaLevel: "Level II", specialties: ["Ortho", "Cardiac", "Trauma"] },
];

const MOCK_TIMELINE = [
  { ts: "10:14:02 AM", source: "Call Center", text: "Call received from +91-9876543210. Caller reports road accident at MG Road & Brigade Junction. 2 victims.", dot: "solid" },
  { ts: "10:14:45 AM", source: "System", text: "Case ID ED-2024-0412-001 auto-generated. Incident type: Road Accident. Triage baseline: Red.", dot: "solid" },
  { ts: "10:15:12 AM", source: "Call Center", text: "Patient data captured. Victim 1: unconscious, visible head injury. Victim 2: conscious, leg laceration. No known allergies.", dot: "solid" },
  { ts: "10:15:30 AM", source: "System", text: "Nearest 6 ambulances identified. Request broadcast sent within 5 km radius.", dot: "solid" },
  { ts: "10:15:47 AM", source: "Ambulance", text: "AMB-007 accepted dispatch request. Crew: Rajan Kumar / EMT Priya.", dot: "solid" },
  { ts: "10:16:00 AM", source: "System", text: "AMB-007 dispatched. Route optimised via Residency Road. ETA: 8 min.", dot: "solid" },
  { ts: "10:24:15 AM", source: "Ambulance — Voice", text: "Voice note from EMT Priya: 'On scene. Victim 1 unconscious, GCS 8, bleeding controlled. Victim 2 leg fracture suspected, stable vitals.'", dot: "solid" },
  { ts: "10:24:30 AM", source: "System — AI", text: "Voice analysis complete. Condition worsening detected for Victim 1. Re-evaluating hospital options. Manipal HAL confirmed as optimal — Level I Trauma, ER load Moderate, ETA 8 min.", dot: "solid" },
  { ts: "10:26:05 AM", source: "Ambulance — Voice", text: "Voice note: 'Victim 1 BP dropping — 90/60. Requesting reroute check.'", dot: "solid" },
  { ts: "10:26:20 AM", source: "System — AI", text: "Condition critical. Reroute analysis: Current target Manipal HAL remains optimal. No closer Level I facility. Maintain route. Pre-arrival alert sent to Manipal ER.", dot: "solid" },
];

function CustomerDashboard() {
  const navigate = useNavigate();

  const [authChecked] = useState(true);
  const [activeView, setActiveView] = useState("dashboard");
  const [allPatients, setAllPatients] = useState([]); // full unfiltered list
const [dateFilter, setDateFilter] = useState('today'); // 'today' | 'yesterday' | 'week' | 'custom'
const [customDate, setCustomDate] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);

  const [completedStatuses, setCompletedStatuses] = useState({});
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [registeredAmbulances, setRegisteredAmbulances] = useState([]);
  const [loadingAmbulances, setLoadingAmbulances] = useState(false);

const [agentData, setAgentData] = useState({
  name: "",
  role: "",
  email: "",
  department: "",
  loading: true
});
  // SUPERADMIN STATE - Add these 4 lines
// SUPERADMIN STATE - Add these lines
const [superadminData, setSuperadminData] = useState(null);
const [zenzoSuperadminData, setZenzoSuperadminData] = useState(null);
const [loadingSuperadmin, setLoadingSuperadmin] = useState(false);
const [loadingZenzoSuperadmin, setLoadingZenzoSuperadmin] = useState(false);
const [showSuperadminInfo, setShowSuperadminInfo] = useState(false);
  // ── Patient edit states ──
  const [showEditPatient, setShowEditPatient] = useState(false);
  const [editPatientData, setEditPatientData] = useState(null);
  const [savingPatient, setSavingPatient] = useState(false);

  // ── Credentials modal password visibility ──
  const [showCredPassword, setShowCredPassword] = useState(false);

  const [activeRegTab, setActiveRegTab] = useState('patient');
  const [patientInfo, setPatientInfo] = useState({ id: '', fullName: '', age: '', gender: '', phoneNumber: '', address: '' });
const [accidentDetails, setAccidentDetails] = useState({ accidentDate: new Date().toLocaleDateString('en-CA'), accidentTime: '', location: '', accidentType: '', condition: '' });  const [emergencyContact, setEmergencyContact] = useState({ name: '', relationship: '', phoneNumber: '' });

  const [showNewIncident, setShowNewIncident] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showHospitalModal, setShowHospitalModal] = useState(false);
  const [showAmbulanceAssignment, setShowAmbulanceAssignment] = useState(false);
  const [registeredPatientData, setRegisteredPatientData] = useState(null);
  const [selectedAmbulanceForPatient, setSelectedAmbulanceForPatient] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [driverList] = useState([
    { id: "DRV-001", name: "Amal", phone: "+91-9876543210", available: true },
    { id: "DRV-002", name: "Vikram Singh", phone: "+91-9876543211", available: true },
    { id: "DRV-003", name: "Suresh Reddy", phone: "+91-9876543212", available: true },
    { id: "DRV-004", name: "Mohan Das", phone: "+91-9876543213", available: true },
    { id: "DRV-005", name: "Rajesh Nair", phone: "+91-9876543214", available: true },
  ]);

  const [showDriverRegistration, setShowDriverRegistration] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState({ username: '', password: '', driverName: '', driverId: '' });
  const [driverForm, setDriverForm] = useState({
    driverId: '', fullName: '', dateOfBirth: '', gender: '', currentAddress: '', permanentAddress: '', phoneNumber: '',
    aadhaarNumber: '', panNumber: '', drivingLicenseNumber: '', licenseIssueDate: '', licenseExpiryDate: '', issuingRTOAuthority: '',
    employmentType: '', yearsOfExperience: '', ambulanceDrivingExperience: '', assignedAmbulanceVehicleNumber: '', shiftTiming: '',
  });

  const [showDriverList] = useState(false);
  const [registeredDrivers, setRegisteredDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [selectedDriverDetails, setSelectedDriverDetails] = useState(null);
const [editingDriverId, setEditingDriverId] = useState(null);
const [editDriverData, setEditDriverData] = useState({
  fullName: '', phoneNumber: '', gender: '', licenseExpiryDate: '',
  yearsOfExperience: '', employmentType: '', shiftTiming: ''
});
const [savingDriver, setSavingDriver] = useState(false);
  const [showAmbulanceRegistration, setShowAmbulanceRegistration] = useState(false);
  const [editingAmbulanceId, setEditingAmbulanceId] = useState(null);
const [editAmbulanceData, setEditAmbulanceData] = useState({
  vehicleRegNumber: '', vehicleMake: '', vehicleModel: '', manufacturingYear: ''
});
const [savingAmbulance, setSavingAmbulance] = useState(false);
const [ambulanceMapInstance, setAmbulanceMapInstance] = useState(null);
const ambulanceMapRef = useRef(null);
const ambulanceMarkerRef = useRef(null);
// Map loading states for patient registration
const [mapLoading, setMapLoading] = useState(false);
const [mapError, setMapError] = useState(null);
const [ambulanceForm, setAmbulanceForm] = useState({
  registrationNumber: '',
  type: 'basic',
  address: '',
  latitude: '',
  longitude: '',
  password: '',
organization: '68c3e6a6ef64cafc435d90ad',
  make: '',
  model: '',
  year: ''
});

  const [incidentForm, setIncidentForm] = useState({ callerPhone: "", callerName: "", location: "", incidentType: "Road Accident", victims: "1", patientStatus: "", consciousness: "Conscious", breathing: "Normal", bleeding: "None", allergies: "", medHistory: "", notes: "" });

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const searchInputRef = useRef(null);
  const markerRef = useRef(null);
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);

  const [selectedAmbulance, setSelectedAmbulance] = useState(null);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [incidents, setIncidents] = useState(MOCK_INCIDENTS);
  const [ambulances] = useState(MOCK_AMBULANCES);
  const [hospitals] = useState(MOCK_HOSPITALS);
  const [activeTimeline] = useState(MOCK_TIMELINE);
  const [filterStatus] = useState("All");

  useEffect(() => {
    const onResize = () => { const mobile = window.innerWidth < 768; setIsMobile(mobile); if (!mobile) setSidebarOpen(false); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

useEffect(() => {
  if (!showNewIncident) {
    // Reset map when modal closes
    if (mapInstance.current) {
      mapInstance.current = null;
    }
    return;
  }
  
  if (activeRegTab !== "accident") return;
  
  // Only load map if it hasn't been loaded yet
  if (!mapInstance.current && mapRef.current) {
    loadMapManually();
  }
}, [showNewIncident, activeRegTab]);
// Map picker for ambulance registration
useEffect(() => {
  if (!showAmbulanceRegistration) return;
  
  const loadMap = async () => {
    await loadGoogleMaps();
    
    if (!ambulanceMapRef.current) return;
    
   if (!ambulanceMapInstance) {
  const map = new window.google.maps.Map(ambulanceMapRef.current, {
    center: { lat: 12.9716, lng: 77.5946 },
    zoom: 13
  });
  setAmbulanceMapInstance(map);
      
      map.addListener("click", (e) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        
        if (ambulanceMarkerRef.current) ambulanceMarkerRef.current.setMap(null);
        const marker = new window.google.maps.Marker({ position: e.latLng, map: map, draggable: true });
        ambulanceMarkerRef.current = marker;
        
        setAmbulanceForm(prev => ({ ...prev, latitude: lat.toString(), longitude: lng.toString() }));
        
        marker.addListener("dragend", (dragEvent) => {
          setAmbulanceForm(prev => ({ 
            ...prev, 
            latitude: dragEvent.latLng.lat().toString(), 
            longitude: dragEvent.latLng.lng().toString() 
          }));
        });
      });
    }
  };
  
  loadMap();
}, [showAmbulanceRegistration, ambulanceMapInstance]);
// Add this function to get URL parameters
const getUrlParameter = (name) => {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(name);
};
  useEffect(() => {
const fetchAgentData = async () => {
  try {
    let sysUserId = null;
    
    // FIRST: Try to get agent_id from URL parameter
    const urlAgentId = getUrlParameter('agent_id');
    if (urlAgentId) {
      sysUserId = urlAgentId;
      console.log("📌 Found agent_id in URL:", sysUserId);
    }
    
    // SECOND: If not in URL, try localStorage
    if (!sysUserId) {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try { 
          const userData = JSON.parse(storedUser); 
          sysUserId = userData.sys_user_id || userData.id; 
          console.log("📌 Found in localStorage user object:", sysUserId);
        } catch (e) {}
      }
    }
    
    // THIRD: Try from JWT token
    if (!sysUserId) {
      const token = localStorage.getItem('access_token');
      if (token) {
        try { 
          const payload = JSON.parse(atob(token.split('.')[1])); 
          sysUserId = payload.sub || payload.sys_user_id || payload.user_id; 
          console.log("📌 Found in JWT payload:", sysUserId);
        } catch (e) {}
      }
    }
    
    // FOURTH: Try direct localStorage
    if (!sysUserId) {
      sysUserId = localStorage.getItem('sys_user_id');
      console.log("📌 Found in direct storage:", sysUserId);
    }
    
    console.log("🔍 Final Agent sys_user_id:", sysUserId);
    
    if (!sysUserId) {
      console.log("⚠️ No agent ID found, using default");
      setAgentData({
        name: "Agent",
        role: "Customer Care",
        email: "",
        department: "",
        loading: false
      });
      return;
    }
    
    const token = localStorage.getItem('access_token');
    const response = await fetch(`${API_BASE_URL}/hms/users/customercare/get-agent/${sysUserId}`, { 
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '' 
      }, 
      credentials: 'include' 
    });
    
    console.log("📡 API Response status:", response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log("📦 Agent data received:", data);
      
      if (data.status === 'success' && data.agent) {
        let roleText = data.agent.shift_timing || "Customer Care";
        if (roleText === "rotational") roleText = "Rotational Shift";
        else if (roleText === "morning") roleText = "Morning Shift";
        else if (roleText === "night") roleText = "Night Shift";
        
        setAgentData({ 
          name: data.agent.full_name || data.agent.username || "Agent", 
          role: roleText,
          email: data.agent.email || "",
          department: data.agent.department || "Emergency Response",
          loading: false 
        });
        
        console.log("✅ Agent data set:", {
          name: data.agent.full_name || data.agent.username,
          email: data.agent.email,
          department: data.agent.department
        });
      } else {
        console.log("⚠️ No agent data in response");
        setAgentData({
          name: "Agent",
          role: "Customer Care",
          email: "",
          department: "",
          loading: false
        });
      }
    } else {
      console.error("❌ API Error:", response.status);
      // Try to get agent data from URL as fallback
      if (urlAgentId) {
        setAgentData({
          name: `Agent ${urlAgentId}`,
          role: "Customer Care",
          email: "",
          department: "Emergency Response",
          loading: false
        });
      } else {
        setAgentData({
          name: "Agent",
          role: "Customer Care",
          email: "",
          department: "",
          loading: false
        });
      }
    }
  } catch (error) { 
    console.error("❌ Error fetching agent:", error);
    setAgentData({
      name: "Agent",
      role: "Customer Care",
      email: "",
      department: "",
      loading: false
    });
  }
};
    fetchAgentData();
  }, []);

useEffect(() => { fetchTodayPatients(); }, []);
  useEffect(() => { fetchRegisteredAmbulances(); }, []);

  useEffect(() => {
    fetchTodayPatients();
  }, [dateFilter, customDate]);
  // SUPERADMIN FETCH - Add this useEffect and function
useEffect(() => { 
  fetchSuperadminData();        // Your backend
  fetchZenzoSuperadminData();   // External ZENZO API
  // fetchCustomerCareExternalData(); // Comment this out if not needed
}, []);

// ADD THIS NEW FUNCTION after fetchSuperadminData function (around line 300-320)
// ADD THIS NEW FUNCTION for ZENZO Superadmin
const fetchZenzoSuperadminData = async () => {
  setLoadingZenzoSuperadmin(true);
  try {
   
    
    // Use the credentials from your response
    const zenzoCredentials = {
      email: "superadmin@ambulance.med",
      password: "admin@2025"  // ⚠️ You need to set the actual password!
    };
    
    // Call YOUR backend endpoint that will proxy to ZENZO
    const response = await fetch(`${API_BASE_URL}hms/users/customercare/zenzo-superadmin-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      },
      body: JSON.stringify(zenzoCredentials)
    });
    
    const data = await response.json();
   
    
    if (data.success && data.user) {
      setZenzoSuperadminData(data.user);
      localStorage.setItem('zenzoSuperadminData', JSON.stringify(data.user));

    } else {
      
    }
    
  } catch (error) {
    console.error('❌ Error calling ZENZO superadmin API:', error);
  } finally {
    setLoadingZenzoSuperadmin(false);
  }
};

  const fetchSuperadminData = async () => {
    setLoadingSuperadmin(true);
    try {
      const token = localStorage.getItem('access_token');
      
      
      // Using your existing backend URL structure
      const response = await fetch(`${API_BASE_URL}hms/users/customercare/superadmin/profile`, {
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': token ? `Bearer ${token}` : '' 
        },
        credentials: 'include'
      });
      
      
      
      if (response.ok) { 
        const data = await response.json(); 
    
        if (data.success && data.user) {
          setSuperadminData(data.user);
      
        } else if (data.status === 'success' && data.user) {
          setSuperadminData(data.user);
         
        } else {
       
        }
      } else {

        // Fallback to mock data for testing

        setSuperadminData({
          id: "SUPERADMIN_001",
          fullName: "Super Admin",
          email: "superadmin@ambulance.med",
          role: "superadmin",
          status: "active"
        });
      }
    } catch (error) { 
      console.error('❌ Error fetching superadmin:', error);
      // Fallback mock data
      setSuperadminData({
        id: "SUPERADMIN_001",
        fullName: "Super Admin",
        email: "superadmin@ambulance.med",
        role: "superadmin",
        status: "active"
      });
    } finally { 
      setLoadingSuperadmin(false);
   
    }
  };
  const buildDateQuery = (filter, custom) => {
  const ist = new Date(); // fine for date-only comparison
  const todayStr = ist.toLocaleDateString('en-CA');
  if (filter === 'today') return `date=${todayStr}`;
  if (filter === 'yesterday') {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return `date=${y.toLocaleDateString('en-CA')}`;
  }
  if (filter === 'week') {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    return `start_date=${weekAgo.toLocaleDateString('en-CA')}&end_date=${todayStr}`;
  }
  if (filter === 'custom' && custom) return `date=${custom}`;
  return `date=${todayStr}`;
};

const fetchTodayPatients = async () => {
  setLoadingPatients(true);
  try {
    const token = localStorage.getItem('access_token');
    const response = await fetch(`${API_BASE_URL}hms/users/emergencypatients/get_today_patients-with-timestamp-and-withotut-limit?${buildDateQuery(dateFilter, customDate)}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });

    if (response.ok) {
      const data = await response.json();
      const patients = data.patients || [];
      setAllPatients(patients);

      const idsToCheck = patients.map((p) => p.patient_id);
      let statusMap = {};
      if (idsToCheck.length > 0) {
        try {
          const statusResponse = await fetch(
            `${API_BASE_URL}hms/users/ambulance/ambulance/get-completed-incidents-batch`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ patient_ids: idsToCheck }),
            }
          );
          const statusData = await statusResponse.json();
          statusMap = statusData.status === "success" ? (statusData.statuses || {}) : {};
        } catch (error) {
          idsToCheck.forEach((id) => { statusMap[id] = "active"; });
        }
      }
      setCompletedStatuses(statusMap);
    } else {
      console.error('Failed to fetch patients');
      setAllPatients([]);
    }
  } catch (error) {
    console.error('Error fetching patients:', error);
    setAllPatients([]);
  } finally {
    setLoadingPatients(false);
  }
};

  const fetchRegisteredAmbulances = async () => {
    setLoadingAmbulances(true);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/list`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success' && data.ambulances) {
          setRegisteredAmbulances(data.ambulances.map(amb => ({ ...amb, status: amb.status || 'Available' })));
        } else setRegisteredAmbulances([]);
      } else setRegisteredAmbulances([]);
    } catch (error) { setRegisteredAmbulances([]); }
    finally { setLoadingAmbulances(false); }
  };
const handleEditAmbulanceClick = (amb) => {
    setEditingAmbulanceId(amb.vehicleId);
    setEditAmbulanceData({
      vehicleRegNumber: amb.vehicleRegNumber || '',
      vehicleMake: amb.vehicleMake || '',
      vehicleModel: amb.vehicleModel || '',
      manufacturingYear: amb.manufacturingYear || ''
    });
  };

  const handleCancelEditAmbulance = () => {
    setEditingAmbulanceId(null);
    setEditAmbulanceData({ vehicleRegNumber: '', vehicleMake: '', vehicleModel: '', manufacturingYear: '' });
  };

  const handleSaveAmbulance = async (vehicleId) => {
    setSavingAmbulance(true);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulancemanagementupdate/${vehicleId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
  body: JSON.stringify(editAmbulanceData)
});
      const responseText = await response.text();
      let result;
      try { result = JSON.parse(responseText); } catch (e) { result = { detail: responseText }; }
      if (response.ok) {
        alert(result?.message || 'Ambulance updated successfully!');
        setEditingAmbulanceId(null);
        fetchRegisteredAmbulances();
      } else {
        alert(result?.detail || result?.message || 'Failed to update ambulance');
      }
    } catch (error) {
      alert('Network error. Please try again.');
    } finally {
      setSavingAmbulance(false);
    }
  };

  const handleDeleteAmbulance = async (vehicleId) => {
    if (!window.confirm('Are you sure you want to delete this ambulance?')) return;
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulancemanagementdelete/${vehicleId}`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }
});
      if (response.ok) {
        setRegisteredAmbulances(prev => prev.filter(a => a.vehicleId !== vehicleId));
      } else {
        const responseText = await response.text();
        let result;
        try { result = JSON.parse(responseText); } catch (e) { result = { detail: responseText }; }
        alert(result?.detail || result?.message || 'Failed to delete ambulance');
      }
    } catch (error) {
      alert('Network error. Please try again.');
    }
  };


  const fetchRegisteredDrivers = async () => {
    setLoadingDrivers(true);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/drivers/list`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success' && data.drivers) setRegisteredDrivers(data.drivers);
        else setRegisteredDrivers([]);
      } else setRegisteredDrivers([]);
    } catch (error) { setRegisteredDrivers([]); }
    finally { setLoadingDrivers(false); }
  };

  // ── EDIT PATIENT ──
const handleEditPatient = (patient) => {
  console.log('Editing patient:', patient);
  
  // Clean up latitude/longitude - ensure they are valid numbers or undefined
  let latitude = patient.accidentDetails?.latitude;
  let longitude = patient.accidentDetails?.longitude;
  
  // Convert to number if they exist and are valid
  if (latitude !== undefined && latitude !== null && latitude !== '') {
    const numLat = parseFloat(latitude);
    latitude = isNaN(numLat) ? undefined : numLat;
  } else {
    latitude = undefined;
  }
  
  if (longitude !== undefined && longitude !== null && longitude !== '') {
    const numLng = parseFloat(longitude);
    longitude = isNaN(numLng) ? undefined : numLng;
  } else {
    longitude = undefined;
  }
  
  setEditPatientData({
    id: patient.patient_id,
    fullName: patient.fullName || '',
    age: patient.age || '',
    gender: patient.gender || '',
    phoneNumber: patient.phoneNumber || '',
    address: patient.address || '',
    accidentDetails: {
      accidentDate: patient.accidentDetails?.accidentDate || '',
      accidentTime: patient.accidentDetails?.accidentTime || '',
      location: patient.accidentDetails?.location || '',
      accidentType: patient.accidentDetails?.accidentType || '',
      condition: patient.accidentDetails?.condition || '',
      ...(latitude !== undefined && { latitude }),
      ...(longitude !== undefined && { longitude })
    },
    emergencyContact: {
      name: patient.emergencyContact?.name || '',
      relationship: patient.emergencyContact?.relationship || '',
      phoneNumber: patient.emergencyContact?.phoneNumber || '',
    },
    registrationDate: patient.registrationDate || new Date().toISOString().split('T')[0],
    status: patient.status || 'registered'
  });
  setShowEditPatient(true);
};

const handleSavePatient = async () => {
  if (!editPatientData) {
    console.error('No edit patient data');
    return;
  }
  
  // Get the patient ID correctly
  const patientId = editPatientData.id;  // Use 'id' field, not 'patient_id'
  
  if (!patientId) {
    console.error('No patient ID found', editPatientData);
    alert('Patient ID is missing');
    return;
  }
  
  setSavingPatient(true);
  try {
    const token = localStorage.getItem('access_token');
    
    // Create a clean copy of the data to send
    const cleanData = {
      id: editPatientData.id,
      fullName: editPatientData.fullName,
      age: editPatientData.age,
      gender: editPatientData.gender,
      phoneNumber: editPatientData.phoneNumber,
      address: editPatientData.address,
      accidentDetails: {
        accidentDate: editPatientData.accidentDetails.accidentDate,
        accidentTime: editPatientData.accidentDetails.accidentTime,
        location: editPatientData.accidentDetails.location,
        accidentType: editPatientData.accidentDetails.accidentType,
        condition: editPatientData.accidentDetails.condition
      },
      emergencyContact: {
        name: editPatientData.emergencyContact.name,
        relationship: editPatientData.emergencyContact.relationship,
        phoneNumber: editPatientData.emergencyContact.phoneNumber
      },
      registrationDate: editPatientData.registrationDate,
      status: editPatientData.status
    };
    
    // ONLY add latitude and longitude if they exist and are valid numbers
    const lat = editPatientData.accidentDetails.latitude;
    const lng = editPatientData.accidentDetails.longitude;
    
    if (lat !== undefined && lat !== null && lat !== '' && !isNaN(parseFloat(lat))) {
      cleanData.accidentDetails.latitude = parseFloat(lat);
    }
    
    if (lng !== undefined && lng !== null && lng !== '' && !isNaN(parseFloat(lng))) {
      cleanData.accidentDetails.longitude = parseFloat(lng);
    }
    
    console.log('Updating patient:', patientId);
    console.log('Clean data being sent:', cleanData);
    
    const response = await fetch(`${API_BASE_URL}hms/users/emergencypatients/patient/${patientId}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': token ? `Bearer ${token}` : '' 
      },
      body: JSON.stringify(cleanData),
    });
    
    const responseText = await response.text();

    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse response:', e);
      result = { detail: responseText };
    }
    
    if (response.ok) {
      alert(result.message || 'Patient updated successfully!');
      setShowEditPatient(false);
      setEditPatientData(null);
      fetchTodayPatients(); // Refresh the list
    } else {
      // Handle validation errors
      if (response.status === 422) {
        console.error('Validation error:', result);
        let errorMessage = 'Validation error: ';
        if (result.detail && Array.isArray(result.detail)) {
          errorMessage += result.detail.map(err => `${err.loc.join('.')}: ${err.msg}`).join(', ');
        } else {
          errorMessage += JSON.stringify(result.detail || result);
        }
        alert(errorMessage);
      } else {
        alert(result.detail || result.message || 'Failed to update patient');
      }
    }
  } catch (error) { 
    console.error('Update error:', error);
    alert('Network error. Please try again.'); 
  } finally { 
    setSavingPatient(false); 
  }
};
const placeMarker = (location) => {
  // Remove old marker
  if (markerRef.current) {
    markerRef.current.setMap(null);
  }

  // Create new marker
  const marker = new window.google.maps.Marker({
    position: location,
    map: mapInstance.current,
    draggable: true
  });

  markerRef.current = marker;

  // Get coordinates safely
  const latitude =
    typeof location.lat === "function"
      ? location.lat()
      : location.lat;

  const longitude =
    typeof location.lng === "function"
      ? location.lng()
      : location.lng;
console.log("LAT:", latitude);
console.log("LNG:", longitude);
  // Update state
  setLat(latitude);
  setLng(longitude);

  setAccidentDetails(prev => ({
    ...prev,
    latitude,
    longitude
  }));

  // Drag marker support
  marker.addListener("dragend", (e) => {
    const newLat = e.latLng.lat();
    const newLng = e.latLng.lng();

    setLat(newLat);
    setLng(newLng);

    setAccidentDetails(prev => ({
      ...prev,
      latitude: newLat,
      longitude: newLng
    }));
  });
};


  // Manual map loader function
const loadMapManually = async () => {
  setMapLoading(true);
  setMapError(null);
  
  try {
    await loadGoogleMaps();
    
    if (!mapRef.current) {
      console.error("Map ref not found");
      setMapError("Map container not found");
      setMapLoading(false);
      return;
    }
    
    // Destroy existing map instance if it exists
    if (mapInstance.current) {
      mapInstance.current = null;
    }
    
    // Clear the map container
    while (mapRef.current.firstChild) {
      mapRef.current.removeChild(mapRef.current.firstChild);
    }
    
    // Create new map
    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: 12.9716, lng: 77.5946 },
      zoom: 13,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true
    });
    
    mapInstance.current = map;
    
    map.addListener("click", (e) => {
      placeMarker(e.latLng);
    });
    
    // Re-attach autocomplete
    if (searchInputRef.current) {
      const autocomplete = new window.google.maps.places.Autocomplete(searchInputRef.current);
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) return;
        
        const loc = place.geometry.location;
        mapInstance.current.setCenter(loc);
        mapInstance.current.setZoom(16);
        placeMarker(loc);
        
        setAccidentDetails(prev => ({
          ...prev,
          location: place.formatted_address || place.name,
          latitude: loc.lat(),
          longitude: loc.lng()
        }));
      });
    }
    
    setMapLoading(false);
    console.log("✅ Map loaded manually");
  } catch (error) {
    
    setMapLoading(false);
  }
};

const getTodayDate = () => new Date().toLocaleDateString('en-CA');

  const handlePatientRegistration = async () => {
   if (!patientInfo.id || patientInfo.id.trim() === '') {
  alert('Incident ID is required!');
  setActiveRegTab('patient');
  return;
}

if (!patientInfo.fullName || patientInfo.fullName.trim() === '') {
  alert('First Name is required!');
  setActiveRegTab('patient');
  return;
}

if (!patientInfo.age || patientInfo.age.trim() === '') {
  alert('Age is required!');
  setActiveRegTab('patient');
  return;
}

if (!patientInfo.gender || patientInfo.gender.trim() === '') {
  alert('Gender is required!');
  setActiveRegTab('patient');
  return;
}

if (!patientInfo.phoneNumber || patientInfo.phoneNumber.trim() === '') {
  alert('Phone Number is required!');
  setActiveRegTab('patient');
  return;
}
if (!/^\d{10}$/.test(patientInfo.phoneNumber)) {
  alert('Phone Number must be exactly 10 digits!');
  setActiveRegTab('patient');
  return;
}
    const today = new Date();
    const registrationDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
   
   
    const requestData = {
      id: patientInfo.id, fullName: patientInfo.fullName || 'Unknown', age: patientInfo.age || '',
      gender: patientInfo.gender || '', phoneNumber: patientInfo.phoneNumber || '', address: patientInfo.address || '',
      accidentDetails: { accidentDate: accidentDetails.accidentDate || '', accidentTime: accidentDetails.accidentTime || '', location: accidentDetails.location || '',  // ✅ ADD THESE
  latitude: accidentDetails.latitude || null,
  longitude: accidentDetails.longitude || null, accidentType: accidentDetails.accidentType || '', condition: accidentDetails.condition || '' },
      emergencyContact: { name: emergencyContact.name || '', relationship: emergencyContact.relationship || '', phoneNumber: emergencyContact.phoneNumber || '' },
      registrationDate, status: 'registered'
    };console.log("====================================");
console.log("PATIENT REGISTRATION DATA");
console.log("====================================");

console.log("Patient Info:", patientInfo);

console.log("Accident Details:", accidentDetails);

console.log("Emergency Contact:", emergencyContact);

console.log("Final Request Data:", requestData);

console.log("Latitude:", accidentDetails.latitude);

console.log("Longitude:", accidentDetails.longitude);

console.log("Registration Date:", registrationDate);

console.log("====================================");
    try {
      const response = await fetch(`${API_BASE_URL}/hms/users/emergencypatients/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(requestData) });
      const responseText = await response.text();
      let result;
      if (responseText && responseText.length > 0) { try { result = JSON.parse(responseText); } catch (e) { throw new Error('Server returned invalid JSON'); } }
      if (response.ok) {
        alert(result?.message || 'Patient registered successfully!');
        setRegisteredPatientData({ ...requestData, registration_id: result?.registration_id, sys_user_id: result?.sys_user_id });
        setShowNewIncident(false); setShowAmbulanceAssignment(true);
        setPatientInfo({ id: '', fullName: '', age: '', gender: '', phoneNumber: '', address: '' });
        setAccidentDetails({ accidentDate: getTodayDate(), accidentTime: '', location: '', accidentType: '', condition: '' });
        setEmergencyContact({ name: '', relationship: '', phoneNumber: '' });
        setActiveRegTab('patient');
        fetchTodayPatients();
      } else if (response.status === 400) { alert(result?.detail || 'Patient with this Incident ID already exists.'); }
      else { alert(result?.detail || result?.message || 'Failed to register patient'); }
    } catch (error) { alert(error.message || 'Network error. Please check your connection.'); }
  };

  const handleLogout = () => navigate("/login");
  const handleNewIncident = () => { setIncidentForm({ callerPhone: "", callerName: "", location: "", incidentType: "Road Accident", victims: "1", patientStatus: "", consciousness: "Conscious", breathing: "Normal", bleeding: "None", allergies: "", medHistory: "", notes: "" }); setShowNewIncident(true); };
  const handleDispatch = (inc) => { setSelectedIncident(inc); setSelectedAmbulance(null); setShowDispatch(true); };
  const handleConfirmDispatch = () => {
    if (!selectedAmbulance) return;
    setIncidents((prev) => prev.map((i) => i.id === selectedIncident.id ? { ...i, status: "Dispatched", assignedAmbulance: selectedAmbulance.id } : i));
    setShowDispatch(false); setSelectedIncident(null);
  };
  const handleHospitalModal = (inc) => { setSelectedIncident(inc); setSelectedHospital(null); setShowHospitalModal(true); };
  const handleConfirmHospital = () => {
    if (!selectedHospital) return;
    setIncidents((prev) => prev.map((i) => i.id === selectedIncident.id ? { ...i, assignedHospital: selectedHospital.name } : i));
    setShowHospitalModal(false); setSelectedIncident(null);
  };

const handleAmbulanceRegistration = async () => {
  // Validate required fields
  if (!ambulanceForm.registrationNumber || !ambulanceForm.make || !ambulanceForm.model || !ambulanceForm.year) {
    alert('Registration Number, Make, Model, and Year are required!');
    return;
  }

  // Validate organization ID format (MongoDB ObjectId is 24 hex characters)
  const orgId = ambulanceForm.organization;
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(orgId);
  
  if (!orgId) {
    alert('Organization ID is required!');
    return;
  }
  
  if (!isValidObjectId) {
    alert('Invalid Organization ID format. It must be a 24-character hex string (e.g., 68c3e6a6ef64cafc435d90ad)');
    return;
  }

  // Additional validation for location
  if (!ambulanceForm.latitude || !ambulanceForm.longitude) {
    alert('Please select location on map (latitude and longitude are required)!');
    return;
  }

  try {
    const token = localStorage.getItem('access_token');
    
    // Build location object dynamically
    const locationData = {
      address: ambulanceForm.address || 'Address not provided'
    };
    
    if (ambulanceForm.latitude && ambulanceForm.longitude) {
      locationData.coordinates = [
        parseFloat(ambulanceForm.longitude), 
        parseFloat(ambulanceForm.latitude)
      ];
    }
    
    const requestBody = {
      registrationNumber: ambulanceForm.registrationNumber,
      type: ambulanceForm.type || 'basic',
      location: locationData,
      password: ambulanceForm.password || '123456',
      organization: orgId,  // Use the validated organization ID
      make: ambulanceForm.make,
      model: ambulanceForm.model,
      year: parseInt(ambulanceForm.year)
    };
    
    console.log('📝 Sending ambulance registration with dynamic data:', requestBody);
    // =====================================
// STEP 1: LOGIN TO ZENZO SUPERADMIN
// =====================================

const zenzoLoginResponse = await fetch(
  `${API_BASE_URL}hms/users/customercare/zenzo-superadmin-login`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: "superadmin@ambulance.med",
      password: "admin@2025"
    })
  }
);

const zenzoLoginData =
  await zenzoLoginResponse.json();

let zenzoEnabled = true;

if (!zenzoLoginResponse.ok) {

  console.log("⚠️ ZENZO LOGIN FAILED");

  zenzoEnabled = false;
}

const zenzoAccessToken =
  zenzoLoginData.accessToken ||
  zenzoLoginData.token ||
  zenzoLoginData.access_token;

if (!zenzoAccessToken) {

  console.log("⚠️ ZENZO TOKEN MISSING");

  zenzoEnabled = false;
}
console.log(
  "✅ ZENZO SUPERADMIN LOGIN SUCCESS"
);
    // ========== 1. CALL YOUR BACKEND FIRST ==========
    const response = await fetch(`${API_BASE_URL}hms/users/ambulance/ambulance/register/v2`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      alert(data.message || data.detail || 'Failed to register ambulance');
      return;
    }
    
    console.log('✅ Backend registration successful:', data);
    alert('Ambulance registered to your backend successfully!');
    
    // ========== 2. CALL ZENZO EXTERNAL API with SAME dynamic data ==========



try {
  // =========================
  // VALIDATE ORGANIZATION ID
  // =========================
  const cleanedOrgId = ambulanceForm.organization?.trim();

  const objectIdRegex = /^[a-f\d]{24}$/i;

  if (!cleanedOrgId || !objectIdRegex.test(cleanedOrgId)) {
    alert(
      'Invalid Organization ID format. It must be a 24-character hex string.'
    );
    return;
  }

 


  // =========================
  // BUILD ZENZO PAYLOAD
  // =========================
  const zenzoPayload = {
    registrationNumber: ambulanceForm.registrationNumber?.trim(),

    type: ambulanceForm.type || 'basic',

    location: {
      address: ambulanceForm.address || 'City',

      // Mongo GeoJSON format = [longitude, latitude]
      coordinates: [
        parseFloat(ambulanceForm.longitude),
        parseFloat(ambulanceForm.latitude)
      ]
    },

    password: ambulanceForm.password || '123456',

    organization: "68c3e6a6ef64cafc435d90ad",

    make: ambulanceForm.make?.trim(),

    model: ambulanceForm.model?.trim(),

    year: parseInt(ambulanceForm.year),

    // SEND TOKEN INSIDE PAYLOAD
  accessToken: zenzoAccessToken
  };



  // =========================
  // CALL BACKEND PROXY
  // =========================
  const zenzoResponse = await fetch(
    `${API_BASE_URL}hms/users/ambulance/zenzo-ambulance-register`,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify(zenzoPayload)
    }
  );

 

  // =========================
  // PARSE RESPONSE SAFELY
  // =========================
  let zenzoData = {};

  try {
    zenzoData = await zenzoResponse.json();
    console.log("✅ ZENZO API Response Data:", zenzoData);
  } catch (jsonError) {
    console.error(
      '❌ Failed to parse JSON response:',
      jsonError
    );
  }



  // =========================
  // HANDLE SUCCESS
  // =========================
  if (zenzoResponse.ok) {

    

    alert(
      'Ambulance also registered to ZENZO successfully!'
    );

    if (zenzoData.data) {

      localStorage.setItem(
        `zenzo_ambulance_${ambulanceForm.registrationNumber}`,
        JSON.stringify(zenzoData.data)
      );
    }
  }

  // =========================
  // HANDLE FAILURE
  // =========================
  else {

    console.warn(
      '⚠️ ZENZO API registration failed:',
      zenzoData
    );

    alert(
      `Backend registration successful, but ZENZO registration failed: ${
        zenzoData.error ||
        zenzoData.message ||
        zenzoData.details ||
        'Unknown error'
      }`
    );
  }

} catch (error) {

  console.error(
    '❌ ZENZO Registration Error:',
    error
  );

  alert(
    `Backend registration successful, but ZENZO request failed: ${error.message}`
  );
}
    
    // ========== 3. REFRESH AND RESET ==========
    setShowAmbulanceRegistration(false);
    fetchRegisteredAmbulances();
    
    setAmbulanceForm({
      registrationNumber: '', 
      type: 'basic', 
      address: '', 
      latitude: '', 
      longitude: '',
      password: '', 
      organization: '68c3e6a6ef64cafc435d90ad',
      make: '', 
      model: '', 
      year: ''
    });
    
    if (ambulanceMarkerRef.current) {
      ambulanceMarkerRef.current.setMap(null);
      ambulanceMarkerRef.current = null;
    }
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    alert('Network error. Please try again.');
  }
};
  const handleDriverRegistration = async () => {
    if (!driverForm.driverId || driverForm.driverId.trim() === '') { alert('Crew ID is required!'); return; }
    if (!driverForm.fullName || driverForm.fullName.trim() === '') { alert('Full Name is required!'); return; }
    const cleanDriverId = driverForm.driverId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const generatedUsername = `DRIVER${cleanDriverId}`;
    const generatedPassword = `${cleanDriverId.toLowerCase()}@123`;
    try {
      const requestData = {
        driverId: driverForm.driverId, fullName: driverForm.fullName, dateOfBirth: driverForm.dateOfBirth || null,
        gender: driverForm.gender || null, currentAddress: driverForm.currentAddress || null, permanentAddress: driverForm.permanentAddress || null,
        phoneNumber: driverForm.phoneNumber || null, aadhaarNumber: driverForm.aadhaarNumber || null, panNumber: driverForm.panNumber || null,
        drivingLicenseNumber: driverForm.drivingLicenseNumber || null, licenseIssueDate: driverForm.licenseIssueDate || null,
        licenseExpiryDate: driverForm.licenseExpiryDate || null, issuingRTOAuthority: driverForm.issuingRTOAuthority || null,
        employmentType: driverForm.employmentType || null, yearsOfExperience: driverForm.yearsOfExperience || null,
        ambulanceDrivingExperience: driverForm.ambulanceDrivingExperience || null, assignedAmbulanceVehicleNumber: driverForm.assignedAmbulanceVehicleNumber || null,
        shiftTiming: driverForm.shiftTiming || null, latitude: null, longitude: null, patient: null,
        username: generatedUsername, password: generatedPassword
      };
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/driver/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify(requestData) });
      if (response.ok) {
        setGeneratedCredentials({ username: generatedUsername, password: generatedPassword, driverName: driverForm.fullName, driverId: driverForm.driverId });
        setShowCredPassword(false);
        setShowCredentialsModal(true);
        setShowDriverRegistration(false);
        setDriverForm({ driverId: '', fullName: '', dateOfBirth: '', gender: '', currentAddress: '', permanentAddress: '', phoneNumber: '', aadhaarNumber: '', panNumber: '', drivingLicenseNumber: '', licenseIssueDate: '', licenseExpiryDate: '', issuingRTOAuthority: '', employmentType: '', yearsOfExperience: '', ambulanceDrivingExperience: '', assignedAmbulanceVehicleNumber: '', shiftTiming: '' });
      } else { const error = await response.json(); alert(error.message || error.detail || 'Failed to register driver'); }
    } catch (error) { alert('Network error. Please try again.'); }
  };
const handleEditDriverClick = (driver) => {
    setEditingDriverId(driver.driverId);
    setEditDriverData({
      fullName: driver.fullName || '',
      phoneNumber: driver.phoneNumber || '',
      gender: driver.gender || '',
      licenseExpiryDate: driver.licenseExpiryDate ? driver.licenseExpiryDate.split('T')[0] : '',
      yearsOfExperience: driver.yearsOfExperience || '',
      employmentType: driver.employmentType || '',
      shiftTiming: driver.shiftTiming || ''
    });
  };

  const handleCancelEditDriver = () => {
    setEditingDriverId(null);
    setEditDriverData({ fullName: '', phoneNumber: '', gender: '', licenseExpiryDate: '', yearsOfExperience: '', employmentType: '', shiftTiming: '' });
  };

  const handleSaveDriver = async (driverId) => {
    setSavingDriver(true);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/drivermanagementupdate/${driverId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify(editDriverData)
      });
      const responseText = await response.text();
      let result;
      try { result = JSON.parse(responseText); } catch (e) { result = { detail: responseText }; }
      if (response.ok) {
        alert(result?.message || 'Driver updated successfully!');
        setEditingDriverId(null);
        fetchRegisteredDrivers();
      } else {
        alert(result?.detail || result?.message || 'Failed to update driver');
      }
    } catch (error) {
      alert('Network error. Please try again.');
    } finally {
      setSavingDriver(false);
    }
  };

  const handleDeleteDriver = async (driverId) => {
    if (!window.confirm('Are you sure you want to delete this driver?')) return;
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/drivermanagementdelete/${driverId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }
      });
      if (response.ok) {
        setRegisteredDrivers(prev => prev.filter(d => d.driverId !== driverId));
      } else {
        const responseText = await response.text();
        let result;
        try { result = JSON.parse(responseText); } catch (e) { result = { detail: responseText }; }
        alert(result?.detail || result?.message || 'Failed to delete driver');
      }
    } catch (error) {
      alert('Network error. Please try again.');
    }
  };
  const statsCount = (status) => incidents.filter((i) => i.status === status).length;

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, key: "dashboard", action: () => setActiveView("dashboard") },
        { label: "Ambulance Fleet", icon: <Radio size={14} />, key: "fleet", action: () => setActiveView("fleet") },
        { label: "Ambulance Crew Management", icon: <Users size={14} />, key: "drivers", action: () => { setActiveView("drivers"); fetchRegisteredDrivers(); } },
       
      ],
    }
  
  
  ];

  if (!authChecked) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.85rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Verifying session…</div>;
  }
const getDateStr = (d) => d.toLocaleDateString('en-CA');

const todayPatients = allPatients; // backend already filtered by dateFilter/customDate

const dateFilterLabel = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 Days",
  custom: customDate ? new Date(customDate).toLocaleDateString() : "Custom Date",
}[dateFilter];

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .cc-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .cc-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .cc-action-btn:hover { background: transparent !important; color: ${T.text} !important; border-color: ${T.text} !important; }
        .cc-outline-btn:hover { border-color: ${T.text} !important; }
        .cc-stat-cell:hover { background: ${T.bgAlt} !important; }
        .cc-tbl-row:hover td { background: ${T.bgAlt} !important; }
        .cc-amb-card:hover { background: ${T.bgAlt} !important; }
        .cc-hosp-card:hover { background: ${T.bgAlt} !important; }
        .cc-menu-scroll::-webkit-scrollbar { display: none; }
        .cc-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .cc-input:focus { border-color: ${T.text} !important; }
        .edit-btn:hover { background: ${T.bgAlt} !important; border-color: ${T.text} !important; }
        @media (max-width: 767px) {
          .cc-main { margin-left: 0 !important; }
          .cc-desktop-only { display: none !important; }
          .cc-hamburger { display: flex !important; }
          .cc-body { padding: 1rem !important; }
          .cc-top-bar { padding: 0.75rem 1rem !important; }
          .cc-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .cc-amb-grid { grid-template-columns: 1fr !important; }
          .cc-form-grid { grid-template-columns: 1fr !important; }
        }
        @media (min-width: 768px) { .cc-hamburger { display: none !important; } }
      `}</style>

      {isMobile && sidebarOpen && <div style={S.overlay} onClick={() => setSidebarOpen(false)} />}

      {/* ═══ SIDEBAR ═══ */}
      <aside style={{ ...S.sidebar, transform: isMobile && !sidebarOpen ? "translateX(-100%)" : "translateX(0)" }}>
               <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <span style={S.brandName}>Emergency Dispatch</span>
            {isMobile && <button onClick={() => setSidebarOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.text, padding: "2px" }}><X size={16} /></button>}
          </div>
          <span style={S.sectionLabel}>Customer Care</span>
          <p style={S.agentName}>{agentData.loading ? "Loading..." : agentData.name}</p>
          <p style={S.agentRole}>{agentData.loading ? "..." : agentData.role}</p>
          
          {/* SUPERADMIN SECTION - Add these lines */}
          {/* SUPERADMIN SECTION - Show both data sources */}
<div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px solid ${T.border}` }}>
  

</div>
        </div>
        <div style={{ padding: "0.75rem 1.5rem", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#000", display: "inline-block" }} />
          <span style={{ fontSize: "0.68rem", color: T.textSec, fontWeight: 400, letterSpacing: "0.05em" }}>System Live — {incidents.filter(i => ["Active", "Dispatched", "On-Scene", "En Route"].includes(i.status)).length} active cases</span>
        </div>
        <div className="cc-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const isActive = item.key === activeView;
                return (
                  <button key={ii} className="cc-nav-btn" style={{ ...S.navBtn, ...(isActive ? S.navBtnActive : {}) }} onClick={() => { item.action(); if (isMobile) setSidebarOpen(false); }}>
                    {item.icon}<span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={S.sidebarFooter}>
          <button className="cc-logout" style={S.logoutBtn} onClick={handleLogout}><LogOut size={13} /><span>Logout</span></button>
        </div>
      </aside>

      {/* ═══ MAIN ═══ */}
      <main className="cc-main" style={{ ...S.main, marginLeft: isMobile ? 0 : SIDEBAR_WIDTH }}>
    <div className="cc-top-bar" style={S.topBar}>
  <div style={S.topBarLeft}>
    <button className="cc-hamburger" style={S.hamburger} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={S.topBarTitle}>Emergency Dispatch</span>
      
      {agentData.loading && (
        <div style={{ fontSize: "0.65rem", color: T.textMuted }}>Loading agent details...</div>
      )}
    </div>
  </div>
  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
    <span style={{ fontSize: "0.72rem", color: T.textMuted, fontFamily: "'Open Sans', sans-serif" }}>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
    <Bell size={16} color={T.textMuted} style={{ cursor: "pointer" }} />
  </div>
</div>

        {/* ─── DASHBOARD ─── */}
        {activeView === "dashboard" && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>Command Overview</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
              <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Fleet Management Dashboard</h1>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="cc-outline-btn" style={S.outlineBtn} onClick={fetchTodayPatients}><RefreshCw size={12} /> Refresh</button>
                <button className="cc-action-btn" style={S.actionBtn} onClick={handleNewIncident}><Plus size={12} /> New Incident</button>
              </div>
            </div>

          
            {/* Fleet Status — from ambulance_collection endpoint */}
   <div style={S.section}>
  <div style={S.sectionHeader}>
    <span style={S.sectionTitle}>Fleet Status</span>
    <span style={{ fontSize: "0.72rem", color: T.textMuted }}>
      {registeredAmbulances.filter(a => a.status === "Available").length} of {registeredAmbulances.length} available
    </span>
  </div>
  <div style={{ padding: "1rem 1.5rem", display: "flex", gap: "8px", flexWrap: "wrap" }}>
    {loadingAmbulances ? (
      <span style={{ fontSize: "0.72rem", color: T.textMuted }}>Loading fleet…</span>
    ) : registeredAmbulances.length === 0 ? (
      <span style={{ fontSize: "0.72rem", color: T.textMuted }}>No ambulances registered yet.</span>
    ) : registeredAmbulances.map((amb) => (
      <div key={amb.vehicleId} style={{ padding: "0.5rem 0.875rem", border: `1px solid ${amb.status === "Available" ? T.text : T.border}`, fontSize: "0.72rem", fontWeight: amb.status === "Available" ? 400 : 300, color: amb.status === "Available" ? T.text : T.textMuted, display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: amb.status === "Available" ? "#000" : "#ccc", display: "inline-block" }} />
        {amb.vehicleRegNumber || amb.vehicleId}  {/* 👈 CHANGED: Shows registration number first, falls back to vehicleId */}
        <span style={{ fontSize: "0.6rem", color: T.textMuted, marginLeft: "2px" }}>{amb.ambulanceType || '—'}</span>
      </div>
    ))}
  </div>
</div>

            <div style={S.section}>
              <div style={S.sectionHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={S.sectionTitle}>Registered Patients — {dateFilterLabel}</span>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    style={{ ...S.select, width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.68rem" }}
                  >
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="week">Last 7 Days</option>
                    <option value="custom">Custom Date</option>
                  </select>
                  {dateFilter === 'custom' && (
                    <input
                      type="date"
                      value={customDate}
                      max={getDateStr(new Date())}
                      onChange={(e) => setCustomDate(e.target.value)}
                      style={{ ...S.input, width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.68rem" }}
                    />
                  )}
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <RefreshCw size={12} color={T.textMuted} style={{ cursor: "pointer" }} onClick={fetchTodayPatients} />
                  <span style={S.sectionMeta}>{loadingPatients ? "Loading..." : `${todayPatients.length} patient(s)`}</span>
                </div>
              </div>
              <div style={S.tableWrap}>
                <table style={{ ...S.table, minWidth: "900px" }}>
                  <thead>
                    <tr>
                      {["Patient ID", "Patient Name", "Phone", "Age", "Gender", "Location", "Incident Type", "Emergency Contact", "Actions" ,"Status"].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingPatients ? (
                      <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>Loading today's patients...</td></tr>
                    ) : todayPatients.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>No patients registered today</td></tr>
                    ) : todayPatients.map((patient, i) => (
                      <tr key={i} className="cc-tbl-row">
<td style={S.tdBold} onClick={() => {

  
  navigate("/patient-details", { state: { patient } });
}}>{patient.patient_id}</td>
                        <td style={S.tdBold} onClick={() => navigate("/patient-details", { state: { patient } })}>{patient.fullName || 'Unknown'}</td>
                        <td style={S.td}>{patient.phoneNumber || '—'}</td>
                        <td style={S.td}>{patient.age || '—'}</td>
                        <td style={S.td}>{patient.gender || '—'}</td>
                       <td style={S.td}>
  {patient.accidentDetails?.latitude && patient.accidentDetails?.longitude
    ? `${patient.accidentDetails.latitude}, ${patient.accidentDetails.longitude}`
    : "-"
  }
</td>
                        <td style={S.td}>
                          <span style={statusBadge(patient.accidentDetails?.accidentType || 'Emergency')}>{patient.accidentDetails?.accidentType || 'Emergency'}</span>
                        </td>
                        <td style={S.td}>
                          {patient.emergencyContact?.name ? (
                            <div>
                              <div style={{ fontSize: "0.72rem", fontWeight: 400 }}>{patient.emergencyContact.name}</div>
                              <div style={{ fontSize: "0.6rem", color: T.textMuted }}>{patient.emergencyContact.phoneNumber || ''}</div>
                              <div style={{ fontSize: "0.6rem", color: T.textMuted }}>({patient.emergencyContact.relationship || 'Contact'})</div>
                            </div>
                          ) : '—'}
                        </td>
                        <td style={S.td}>
                          <button
                            className="edit-btn"
                            style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.6rem", gap: "4px" }}
                            onClick={() => handleEditPatient(patient)}
                          >
                            <Edit2 size={11} /> Edit
                          </button>

                        </td>
                        <td style={S.td}>
  <span
    style={{
      color:
        completedStatuses[patient.patient_id] === "completed"
          ? "green"
          : "red",
      fontWeight: "600"
    }}
  >
    {completedStatuses[patient.patient_id] === "completed"
      ? "Completed"
      : "Active"}
  </span>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          
          </div>
        )}

        {/* ─── DETAIL VIEW ─── */}
        {activeView === "detail" && selectedIncident && (
          <div className="cc-body" style={S.body}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1.5rem" }}>
              <button className="cc-outline-btn" style={{ ...S.outlineBtn, fontSize: "0.7rem" }} onClick={() => setActiveView("dashboard")}>← Back</button>
              <span style={{ ...S.pageLabel, margin: 0 }}>Incident Detail</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
              <div>
                <h1 style={{ ...S.pageTitle, marginBottom: "2px" }}>{selectedIncident.caseId}</h1>
                <span style={{ fontSize: "0.72rem", color: T.textMuted }}>{selectedIncident.incidentType} · {selectedIncident.location}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={triageBadge(selectedIncident.triage)}>{selectedIncident.triage}</span>
                <span style={statusBadge(selectedIncident.status)}>{selectedIncident.status}</span>
              </div>
            </div>
            <div style={{ ...S.section, marginBottom: "1.5rem" }}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>Patient & Scene Data</span><span style={S.sectionMeta}>Timestamp: {selectedIncident.timestamp}</span></div>
              <div style={{ padding: "1.25rem 1.5rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1px", background: T.border, border: `1px solid ${T.border}` }}>
                  {[
                    { label: "Caller Phone", val: selectedIncident.callerPhone }, { label: "Victims", val: selectedIncident.victims },
                    { label: "Patient Status", val: selectedIncident.patientStatus }, { label: "Created At", val: selectedIncident.createdAt },
                    { label: "Assigned Ambulance", val: selectedIncident.assignedAmbulance || "Not assigned" }, { label: "Assigned Hospital", val: selectedIncident.assignedHospital || "Not assigned" },
                    { label: "ETA", val: selectedIncident.eta || "N/A" }, { label: "Triage Level", val: selectedIncident.triage },
                  ].map((f, i) => (
                    <div key={i} style={{ background: T.bg, padding: "0.875rem 1rem" }}>
                      <span style={S.statLabel}>{f.label}</span>
                      <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 400, color: T.text, marginTop: "2px" }}>{f.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ ...S.section, marginBottom: "1.5rem" }}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>Hospital Recommendations</span></div>
              <div style={{ padding: "1rem 1.5rem" }}>
                {hospitals.map((h, i) => (
                  <div key={i} className="cc-hosp-card" style={{ ...S.hospCard, ...(selectedIncident.assignedHospital === h.name ? S.hospCardSelected : {}) }}>
                    <div>
                      <div style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, marginBottom: "2px" }}>{h.name}</div>
                      <div style={{ fontSize: "0.68rem", color: T.textMuted }}>{h.distance} · ETA {h.eta} · ER Load: {h.erLoad} · {h.traumaLevel}</div>
                      <div style={{ marginTop: "4px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        {h.specialties.map((sp) => <span key={sp} style={{ ...S.badge, fontSize: "0.58rem" }}>{sp}</span>)}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.72rem", color: T.textMuted }}>{i === 0 ? "★ Best Match" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={S.section}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>Incident Timeline</span><span style={S.sectionMeta}>{activeTimeline.length} events</span></div>
              <div style={S.timeline}>
                {activeTimeline.map((item, i) => (
                  <div key={i} style={S.timelineItem}>
                    <div style={{ ...S.timelineDot, border: `1px solid ${T.text}`, background: item.source.includes("Voice") ? T.text : T.border }} />
                    <div style={S.timelineContent}>
                      <div style={S.timelineTs}>{item.ts}</div>
                      <div style={S.timelineText}>{item.text}</div>
                      <div style={S.timelineSource}>{item.source}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {selectedIncident.status === "Active" && (
              <div style={{ display: "flex", gap: "8px", marginTop: "1rem" }}>
                <button className="cc-action-btn" style={S.actionBtn} onClick={() => handleDispatch(selectedIncident)}>Dispatch Ambulance →</button>
              </div>
            )}
            {["Dispatched", "On-Scene", "En Route"].includes(selectedIncident.status) && (
              <div style={{ display: "flex", gap: "8px", marginTop: "1rem" }}>
                <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => handleHospitalModal(selectedIncident)}>Reroute / Change Hospital</button>
                <button className="cc-outline-btn" style={S.outlineBtn}>Send Clinical Guidance</button>
              </div>
            )}
          </div>
        )}

        {/* ─── FLEET VIEW ─── */}
        {activeView === "fleet" && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>Operations</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
              <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Ambulance Fleet</h1>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <button className="cc-action-btn" style={S.actionBtn} onClick={() => setShowAmbulanceRegistration(true)}><Plus size={12} /> Register New Ambulance</button>
                <button className="cc-outline-btn" style={S.outlineBtn} onClick={fetchRegisteredAmbulances}><RefreshCw size={12} /> Refresh</button>
                <span style={{ fontSize: "0.72rem", color: T.textMuted }}>{registeredAmbulances.length} total units</span>
              </div>
            </div>
            <div style={S.section}>
              <div style={S.sectionHeader}>
                <span style={S.sectionTitle}>All Registered Units</span>
                <span style={S.sectionMeta}>{loadingAmbulances ? 'Loading...' : `${registeredAmbulances.length} units registered`}</span>
              </div>
             <div style={{ ...S.tableWrap, overflowX: 'auto' }}>
                <table style={{ ...S.table, minWidth: '1500px' }}>
                  <thead>
                    <tr>
                      {["Vehicle ID", "Ambulance Number", "Reg Number", "Make", "Model", "Year", "Ambulance Type", "Action"].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingAmbulances ? (
                      <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>Loading ambulances...</td></tr>
                    ) : registeredAmbulances.length === 0 ? (
                      <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>No ambulances registered yet.</td></tr>
                    ) : registeredAmbulances.map((amb, i) => {
                      const isEditing = editingAmbulanceId === amb.vehicleId;
                      return (
                      <tr key={i} className="cc-tbl-row">
                        <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{amb.vehicleId || '—'}</td>
                        <td style={S.td}>{amb.ambulanceNumber || '—'}</td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '110px' }}
                              value={editAmbulanceData.vehicleRegNumber}
                              onChange={(e) => setEditAmbulanceData({ ...editAmbulanceData, vehicleRegNumber: e.target.value })}
                            />
                          ) : (amb.vehicleRegNumber || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '90px' }}
                              value={editAmbulanceData.vehicleMake}
                              onChange={(e) => setEditAmbulanceData({ ...editAmbulanceData, vehicleMake: e.target.value })}
                            />
                          ) : (amb.vehicleMake || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '90px' }}
                              value={editAmbulanceData.vehicleModel}
                              onChange={(e) => setEditAmbulanceData({ ...editAmbulanceData, vehicleModel: e.target.value })}
                            />
                          ) : (amb.vehicleModel || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              type="number"
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '80px' }}
                              value={editAmbulanceData.manufacturingYear}
                              onChange={(e) => setEditAmbulanceData({ ...editAmbulanceData, manufacturingYear: e.target.value })}
                            />
                          ) : (amb.manufacturingYear || '—')}
                        </td>
                        <td style={S.td}>
                          <span style={{ ...S.badge, background: amb.ambulanceType === 'ALS' ? '#fafafa' : 'transparent', borderColor: amb.ambulanceType === 'ALS' ? '#000' : '#e0e0e0' }}>{amb.ambulanceType || '—'}</span>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: "4px" }}>
                            {isEditing ? (
                              <>
                                <button
                                  className="cc-action-btn"
                                  style={{ ...S.actionBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem", opacity: savingAmbulance ? 0.6 : 1 }}
                                  onClick={() => handleSaveAmbulance(amb.vehicleId)}
                                  disabled={savingAmbulance}
                                >
                                  <Save size={11} /> {savingAmbulance ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  className="cc-outline-btn"
                                  style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }}
                                  onClick={handleCancelEditAmbulance}
                                  disabled={savingAmbulance}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="cc-outline-btn"
                                  style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }}
                                  onClick={() => handleEditAmbulanceClick(amb)}
                                >
                                  <Edit2 size={11} /> Edit
                                </button>
                                <button
                                  className="cc-outline-btn"
                                  style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem", borderColor: "#000", color: "#000" }}
                                  onClick={() => handleDeleteAmbulance(amb.vehicleId)}
                                >
                                  <X size={11} /> Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── DRIVER MANAGEMENT ─── */}
        {activeView === "drivers" && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>Operations</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
              <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Ambulance Crew Management</h1>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <button className="cc-outline-btn" style={S.outlineBtn} onClick={fetchRegisteredDrivers}><RefreshCw size={12} /> Refresh</button>
                <button className="cc-action-btn" style={S.actionBtn} onClick={() => setShowDriverRegistration(true)}><Plus size={12} /> Register New Driver</button>
              </div>
            </div>
            <div style={S.section}>
              <div style={S.sectionHeader}>
                <span style={S.sectionTitle}>All Registered Drivers</span>
                <span style={S.sectionMeta}>{loadingDrivers ? 'Loading...' : `${registeredDrivers.length} drivers registered`}</span>
              </div>
              <div style={{ ...S.tableWrap, overflowX: 'auto' }}>
                <table style={{ ...S.table, minWidth: '1400px' }}>
                  <thead>
                    <tr>
                      {["Crew ID", "Full Name", "Phone Number", "Gender", "License Expiry", "Experience", "Employment Type", "Shift Timing", "Credentials", "Action"].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingDrivers ? (
                      <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>Loading drivers...</td></tr>
                    ) : registeredDrivers.length === 0 ? (
                      <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>No drivers registered yet.</td></tr>
                    ) : registeredDrivers.map((driver, i) => {
                      const isEditing = editingDriverId === driver.driverId;
                      return (
                      <tr key={i} className="cc-tbl-row">
                        <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{driver.driverId}</td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '110px' }}
                              value={editDriverData.fullName}
                              onChange={(e) => setEditDriverData({ ...editDriverData, fullName: e.target.value })}
                            />
                          ) : (driver.fullName || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '110px' }}
                              value={editDriverData.phoneNumber}
                              onChange={(e) => setEditDriverData({ ...editDriverData, phoneNumber: e.target.value })}
                            />
                          ) : (driver.phoneNumber || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <select
                              style={{ ...S.select, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '90px' }}
                              value={editDriverData.gender}
                              onChange={(e) => setEditDriverData({ ...editDriverData, gender: e.target.value })}
                            >
                              <option value="">Select</option>
                              <option>Male</option><option>Female</option><option>Other</option>
                            </select>
                          ) : (driver.gender || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              type="date"
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '130px' }}
                              value={editDriverData.licenseExpiryDate}
                              onChange={(e) => setEditDriverData({ ...editDriverData, licenseExpiryDate: e.target.value })}
                            />
                          ) : (driver.licenseExpiryDate ? new Date(driver.licenseExpiryDate).toLocaleDateString() : '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <input
                              type="number"
                              style={{ ...S.input, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '70px' }}
                              value={editDriverData.yearsOfExperience}
                              onChange={(e) => setEditDriverData({ ...editDriverData, yearsOfExperience: e.target.value })}
                            />
                          ) : (driver.yearsOfExperience || '—')}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <select
                              style={{ ...S.select, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '100px' }}
                              value={editDriverData.employmentType}
                              onChange={(e) => setEditDriverData({ ...editDriverData, employmentType: e.target.value })}
                            >
                              <option value="">Select</option>
                              <option>Full-time</option><option>Contract</option>
                            </select>
                          ) : (
                            <span style={statusBadge(driver.employmentType === 'Full-time' ? 'Active' : 'Available')}>{driver.employmentType || '—'}</span>
                          )}
                        </td>
                        <td style={S.td}>
                          {isEditing ? (
                            <select
                              style={{ ...S.select, fontSize: '0.72rem', padding: '0.3rem 0.5rem', minWidth: '100px' }}
                              value={editDriverData.shiftTiming}
                              onChange={(e) => setEditDriverData({ ...editDriverData, shiftTiming: e.target.value })}
                            >
                              <option value="">Select</option>
                              <option>Day</option><option>Night</option><option>Rotational</option>
                            </select>
                          ) : (driver.shiftTiming || '—')}
                        </td>
                        <td style={S.td}>
                          <button className="cc-outline-btn" style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }}
   disabled={isEditing}
 onClick={() => {
    setSelectedDriverDetails(driver);
    setShowCredPassword(false);
    setShowCredentialsModal(true);
    setGeneratedCredentials({ 
      username: driver.username || '', 
      password: driver.password || '••••••••',  // ✅ Use the actual password from driver object
      driverName: driver.fullName, 
      driverId: driver.driverId 
    });
  }}>
  <Eye size={11} /> View Credentials
</button>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: "4px" }}>
                            {isEditing ? (
                              <>
                                <button
                                  className="cc-action-btn"
                                  style={{ ...S.actionBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem", opacity: savingDriver ? 0.6 : 1 }}
                                  onClick={() => handleSaveDriver(driver.driverId)}
                                  disabled={savingDriver}
                                >
                                  <Save size={11} /> {savingDriver ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  className="cc-outline-btn"
                                  style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }}
                                  onClick={handleCancelEditDriver}
                                  disabled={savingDriver}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="cc-outline-btn"
                                  style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }}
                                  onClick={() => handleEditDriverClick(driver)}
                                >
                                  <Edit2 size={11} /> Edit
                                </button>
                                <button
                                  className="cc-outline-btn"
                                  style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem", borderColor: "#000", color: "#000" }}
                                  onClick={() => handleDeleteDriver(driver.driverId)}
                                >
                                  <X size={11} /> Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── HOSPITALS ─── */}
        {activeView === "hospitals" && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>Operations</span>
            <div style={{ marginBottom: "1.5rem" }}><h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Hospital Network</h1></div>
            <div style={S.section}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>Partner Hospitals</span><span style={S.sectionMeta}>{hospitals.length} active</span></div>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead><tr>{["Hospital", "Distance", "ETA", "ER Load", "Trauma Level", "Specialties"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {hospitals.map((h, i) => (
                      <tr key={i} className="cc-tbl-row">
                        <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{h.name}</td>
                        <td style={S.td}>{h.distance}</td>
                        <td style={S.td}>{h.eta}</td>
                        <td style={S.td}><span style={statusBadge(h.erLoad === "Low" ? "Available" : h.erLoad === "High" ? "Critical" : "Stable")}>{h.erLoad}</span></td>
                        <td style={S.td}><span style={S.badge}>{h.traumaLevel}</span></td>
                        <td style={S.td}><div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>{h.specialties.map((sp) => <span key={sp} style={{ ...S.badge, fontSize: "0.58rem" }}>{sp}</span>)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── VOICE LOGS ─── */}
        {activeView === "voice" && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>Communication</span>
            <div style={{ marginBottom: "1.5rem" }}><h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Voice Logs</h1></div>
            <div style={S.section}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>On-Scene Voice Notes — INC-001</span><span style={S.sectionMeta}>AI processed</span></div>
              {[
                { ts: "T1 — 10:24:15 AM", crew: "EMT Priya / AMB-007", text: "On scene. Victim 1 unconscious, GCS 8, bleeding controlled. Victim 2 leg fracture suspected, stable vitals.", analysis: "Worsening — Victim 1 condition declined from T0 baseline. Triage confirmed Red.", action: "Hospital route confirmed: Manipal HAL" },
                { ts: "T2 — 10:26:05 AM", crew: "EMT Priya / AMB-007", text: "Victim 1 BP dropping — 90/60. Requesting reroute check.", analysis: "Critical deterioration. BP 90/60 = haemodynamic instability. Reroute analysis triggered.", action: "Current hospital maintained — no closer Level I available. Pre-arrival alert sent." },
              ].map((v, i) => (
                <div key={i} style={{ padding: "1.25rem 1.5rem", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                    <Mic size={13} color={T.textMuted} />
                    <span style={{ fontSize: "0.68rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>{v.ts}</span>
                    <span style={{ fontSize: "0.68rem", color: T.textMuted }}>·</span>
                    <span style={{ fontSize: "0.68rem", color: T.textMuted }}>{v.crew}</span>
                  </div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 300, color: T.text, marginBottom: "8px", fontStyle: "italic" }}>"{v.text}"</div>
                  <div style={{ padding: "0.75rem", background: T.bgAlt, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted, marginBottom: "4px" }}>AI Analysis</div>
                    <div style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSec, marginBottom: "4px" }}>{v.analysis}</div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 400, color: T.text }}>Action: {v.action}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── TRIAGE ─── */}
        {activeView === "triage" && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>Communication</span>
            <div style={{ marginBottom: "1.5rem" }}><h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Triage Records</h1></div>
            <div style={S.section}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>Today's Triage Summary</span><span style={S.sectionMeta}>{incidents.length} cases</span></div>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead><tr>{["Case ID", "Type", "Triage", "Best Care", "Insurance", "Condition Trend", "Status"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {incidents.map((inc, i) => (
                      <tr key={i} className="cc-tbl-row">
                        <td style={{ ...S.td, fontWeight: 400, color: T.text }}>{inc.caseId}</td>
                        <td style={S.td}>{inc.incidentType}</td>
                        <td style={S.td}><span style={triageBadge(inc.triage)}>{inc.triage}</span></td>
                        <td style={S.td}>{inc.incidentType === "Cardiac Arrest" ? "Cardiology" : inc.incidentType === "Stroke" ? "Neurology" : inc.incidentType === "Burns" ? "Burns Unit" : "Trauma Surgery"}</td>
                        <td style={S.td}><span style={{ ...S.badge, borderColor: T.border, color: T.textMuted }}>Pending</span></td>
                        <td style={S.td}><span style={statusBadge(inc.status === "Closed" ? "Stable" : "Active")}>{inc.status === "Closed" ? "Stable" : "Monitoring"}</span></td>
                        <td style={S.td}><span style={statusBadge(inc.status)}>{inc.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── INCIDENTS / HISTORY ─── */}
        {(activeView === "incidents" || activeView === "history") && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>{activeView === "incidents" ? "Operations" : "Records"}</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
              <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>{activeView === "incidents" ? "Active Incidents" : "Incident History"}</h1>
              {activeView === "incidents" && <button className="cc-action-btn" style={S.actionBtn} onClick={handleNewIncident}><Plus size={12} /> New Incident</button>}
            </div>
            <div style={S.section}>
              <div style={S.sectionHeader}><span style={S.sectionTitle}>{activeView === "incidents" ? "Open Cases" : "All Cases"}</span><span style={S.sectionMeta}>{incidents.length} records</span></div>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead><tr>{["Case ID", "Type", "Location", "Victims", "Triage", "Status", "Ambulance", "Hospital", "Created", "Actions"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {incidents.map((inc, i) => (
                      <tr key={i} className="cc-tbl-row">
                        <td style={S.tdBold} onClick={() => { setSelectedIncident(inc); setActiveView("detail"); }}>{inc.caseId}</td>
                        <td style={S.td}>{inc.incidentType}</td>
                        <td style={{ ...S.td, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>{inc.location}</td>
                        <td style={S.td}>{inc.victims}</td>
                        <td style={S.td}><span style={triageBadge(inc.triage)}>{inc.triage}</span></td>
                        <td style={S.td}><span style={statusBadge(inc.status)}>{inc.status}</span></td>
                        <td style={S.td}>{inc.assignedAmbulance || "—"}</td>
                        <td style={{ ...S.td, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis" }}>{inc.assignedHospital || "—"}</td>
                        <td style={S.td}>{inc.createdAt}</td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: "4px" }}>
                            {inc.status === "Active" && <button className="cc-action-btn" style={{ ...S.actionBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }} onClick={() => handleDispatch(inc)}>Dispatch</button>}
                            <button className="cc-outline-btn" style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem" }} onClick={() => { setSelectedIncident(inc); setActiveView("detail"); }}><Eye size={11} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {(activeView === "map" || activeView === "settings") && (
          <div className="cc-body" style={S.body}>
            <span style={S.pageLabel}>{activeView}</span>
            <h1 style={S.pageTitle}>{activeView === "map" ? "Live Map" : "Agent Settings"}</h1>
            <div style={{ border: `1px solid ${T.border}`, padding: "3rem", textAlign: "center", color: T.textMuted, fontSize: "0.82rem" }}>
              {activeView === "map" ? "Live map integration — connect Google Maps / Leaflet API" : "Agent preferences and system configuration"}
            </div>
          </div>
        )}
      </main>

      {/* ═══════ PATIENT REGISTRATION MODAL ═══════ */}
      {showNewIncident && (
        <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowNewIncident(false); }}>
          <div style={{ ...S.modalBox, maxWidth: '760px' }}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>Patient Registration</span>
            <button onClick={() => {
  setShowNewIncident(false);
  // Reset map state when closing modal
  setMapError(null);
  setMapLoading(false);
  if (mapInstance.current) {
    mapInstance.current = null;
  }
}} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
  <X size={16} />
</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}` }}>
              {['patient', 'accident', 'contact'].map((tab) => (
                <button key={tab} onClick={() => setActiveRegTab(tab)} style={{ flex: 1, padding: '12px 8px', borderBottom: `2px solid ${activeRegTab === tab ? T.text : 'transparent'}`, background: 'none', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer', color: activeRegTab === tab ? T.text : T.textMuted, fontFamily: "'Open Sans', sans-serif", fontWeight: activeRegTab === tab ? 400 : 300 }}>
                  {tab === 'patient' ? 'Patient Information' : tab === 'accident' ? 'Emergency / Incident' : 'Emergency Contact'}
                </button>
              ))}
            </div>

            <div style={{ ...S.modalBody, overflowY: 'auto' }}>

              {/* Tab 1: Patient Information — 2-column grid */}
              {activeRegTab === 'patient' && (
                <div>
                  <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr' }}>
                    <div style={S.formGroupNoMb}>
                      <label style={S.label}>Incident ID <span style={{ color: 'red' }}>*</span></label>
                      <input style={S.input} value={patientInfo.id} onChange={(e) => setPatientInfo({ ...patientInfo, id: e.target.value })} placeholder="Enter Incident ID (required)" />
                    </div>
                    <div style={S.formGroupNoMb}>
                     <label style={S.label}>
  Full Name <span style={{ color: 'red' }}>*</span>
</label>
                      <input style={S.input}  required
  value={patientInfo.fullName} onChange={(e) => setPatientInfo({ ...patientInfo, fullName: e.target.value })} placeholder="Enter full name" />
                    </div>
                  </div>
                  <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '1rem' }}>
                    <div style={S.formGroupNoMb}>
     <label style={S.label}>
  Age <span style={{ color: 'red' }}>*</span>
</label>
                      <input style={S.input} type="number"required value={patientInfo.age} onChange={(e) => setPatientInfo({ ...patientInfo, age: e.target.value })} placeholder="Age" />
                    </div>
                    <div style={S.formGroupNoMb}>
                   <label style={S.label}>
  Gender <span style={{ color: 'red' }}>*</span>
</label>
                      <select style={S.select} required  value={patientInfo.gender} onChange={(e) => setPatientInfo({ ...patientInfo, gender: e.target.value })}>
                        <option value="">Select</option>
                        <option>Male</option><option>Female</option><option>Other</option>
                      </select>
                    </div>
                    <div style={S.formGroupNoMb}>
                  <label style={S.label}>
  Phone Number <span style={{ color: 'red' }}>*</span>
</label>
                      <input style={S.input} required  value={patientInfo.phoneNumber} onChange={(e) => {
  const value = e.target.value.replace(/\D/g, "");

  if (value.length <= 10) {
    setPatientInfo({
      ...patientInfo,
      phoneNumber: value
    });
  }
}} placeholder="+91-XXXXXXXXXX" />
                    </div>
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Address</label>
                    <textarea style={{ ...S.textarea, minHeight: '64px' }} value={patientInfo.address} onChange={(e) => setPatientInfo({ ...patientInfo, address: e.target.value })} placeholder="Full address" />
                  </div>
                </div>
              )}

              {/* Tab 2: Accident Details */}
             {/* Tab 2: Accident Details */}
{activeRegTab === 'accident' && (
  <div>
    <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr', marginBottom: '1rem' }}>
      <div style={S.formGroupNoMb}>
        <label style={S.label}>Incident Date</label>
        <input type="date" style={S.input} value={accidentDetails.accidentDate} onChange={(e) => setAccidentDetails({ ...accidentDetails, accidentDate: e.target.value })} />
      </div>
      <div style={S.formGroupNoMb}>
        <label style={S.label}>Incidentt Time</label>
        <input type="time" style={S.input} value={accidentDetails.accidentTime} onChange={(e) => setAccidentDetails({ ...accidentDetails, accidentTime: e.target.value })} />
      </div>
    </div>
    
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <label style={{ ...S.label, display: 'block' }}>Location</label>
        <button
          type="button"
          onClick={loadMapManually}
          style={{ ...S.outlineBtn, fontSize: "0.6rem", padding: "0.2rem 0.5rem", gap: "4px" }}
          disabled={mapLoading}
        >
          <RefreshCw size={12} style={{ animation: mapLoading ? "spin 1s linear infinite" : "none" }} />
          {mapLoading ? "Loading..." : "Reload Map"}
        </button>
      </div>
      
      <input
        ref={searchInputRef}
        id="location-search"
        style={{ ...S.input, marginBottom: '8px' }}
        placeholder="Search location on map..."
      />
      
      {/* Map Container with loading state */}
      <div style={{ position: "relative", minHeight: "260px" }}>
        <div 
          ref={mapRef} 
          style={{ 
            height: "260px", 
            width: "100%", 
            border: `1px solid ${T.border}`,
            background: "#f5f5f5",
            display: mapLoading ? "none" : "block"
          }} 
        />
        
        {mapLoading && (
          <div style={{
            height: "260px",
            width: "100%",
            border: `1px solid ${T.border}`,
            background: T.bgAlt,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "12px"
          }}>
            <RefreshCw size={24} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: "0.75rem", color: T.textMuted }}>Loading map...</span>
          </div>
        )}
        
        {mapError && !mapLoading && (
          <div style={{
            height: "260px",
            width: "100%",
            border: `1px solid ${T.border}`,
            background: "#fff3f3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "8px",
            padding: "16px",
            textAlign: "center"
          }}>
            <AlertTriangle size={24} color="#d32f2f" />
            <span style={{ fontSize: "0.7rem", color: "#d32f2f" }}>{mapError}</span>
            <button
              onClick={loadMapManually}
              style={{ ...S.actionBtn, marginTop: "8px" }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
      
      <input 
  style={{ ...S.input, marginTop: "8px", background: T.bgAlt, color: T.textMuted }} 
  value={
    accidentDetails.latitude && accidentDetails.longitude 
      ? `${Number(accidentDetails.latitude).toFixed(6)}, ${Number(accidentDetails.longitude).toFixed(6)}`
      : ""
  } 
  readOnly 
  placeholder="Lat, Long will appear after selecting on map" 
/>
    </div>
    
    <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr', marginBottom: '1rem' }}>
      <div style={S.formGroupNoMb}>
        <label style={S.label}>Incident Type</label>
        <select style={S.select} value={accidentDetails.accidentType} onChange={(e) => setAccidentDetails({ ...accidentDetails, accidentType: e.target.value })}>
          <option value="">Select</option>
          <option>Road Traffic</option><option>Fall</option><option>Burn</option><option>Drowning</option><option>Other</option>
        </select>
      </div>
      <div style={S.formGroupNoMb}>
        <label style={S.label}>Patient Condition</label>
        <input style={S.input} value={accidentDetails.condition} onChange={(e) => setAccidentDetails({ ...accidentDetails, condition: e.target.value })} placeholder="Describe condition" />
      </div>
    </div>
  </div>
)}

              {/* Tab 3: Emergency Contact */}
              {activeRegTab === 'contact' && (
                <div>
                  <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr', marginBottom: '1rem' }}>
                    <div style={S.formGroupNoMb}>
                      <label style={S.label}>Contact Name</label>
                      <input style={S.input} value={emergencyContact.name} onChange={(e) => setEmergencyContact({ ...emergencyContact, name: e.target.value })} placeholder="Full name" />
                    </div>
                    <div style={S.formGroupNoMb}>
                      <label style={S.label}>Relationship</label>
                      <input style={S.input} value={emergencyContact.relationship} onChange={(e) => setEmergencyContact({ ...emergencyContact, relationship: e.target.value })} placeholder="e.g. Spouse, Parent" />
                    </div>
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Phone Number</label>
                    <input style={{ ...S.input, maxWidth: '50%' }} value={emergencyContact.phoneNumber} onChange={(e) => setEmergencyContact({ ...emergencyContact, phoneNumber: e.target.value })} placeholder="+91-XXXXXXXXXX" />
                  </div>
                </div>
              )}
            </div>

            <div style={S.modalFooter}>
              {activeRegTab !== 'patient' && (
                <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => { if (activeRegTab === 'accident') setActiveRegTab('patient'); if (activeRegTab === 'contact') setActiveRegTab('accident'); }}>← Back</button>
              )}
              {activeRegTab === 'patient' && (
                <button className="cc-action-btn" style={S.actionBtn} onClick={() => { if (!patientInfo.id || patientInfo.id.trim() === '') { alert('Incident ID is required!'); return; } setActiveRegTab('accident'); }}>Next →</button>
              )}
              {activeRegTab === 'accident' && (
                <button className="cc-action-btn" style={S.actionBtn} onClick={() => setActiveRegTab('contact')}>Next →</button>
              )}
              {activeRegTab === 'contact' && (
                <button className="cc-action-btn" style={S.actionBtn} onClick={handlePatientRegistration}>Register Patient →</button>
              )}
              <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => setShowNewIncident(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ EDIT PATIENT MODAL ═══════ */}
      {showEditPatient && editPatientData && (
        <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowEditPatient(false); }}>
          <div style={{ ...S.modalBox, maxWidth: '760px' }}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>Edit Patient — {editPatientData.patient_id}</span>
              <button onClick={() => setShowEditPatient(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ ...S.modalBody, overflowY: 'auto' }}>

              {/* Patient Info */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted, fontWeight: 400, marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${T.border}` }}>Patient Information</div>
                <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr' }}>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Full Name</label>
                    <input style={S.input} value={editPatientData.fullName} onChange={(e) => setEditPatientData({ ...editPatientData, fullName: e.target.value })} />
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Phone Number</label>
                    <input style={S.input} value={editPatientData.phoneNumber} onChange={(e) => setEditPatientData({ ...editPatientData, phoneNumber: e.target.value })} />
                  </div>
                </div>
                <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '1rem' }}>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Age</label>
                    <input style={S.input} type="number" value={editPatientData.age} onChange={(e) => setEditPatientData({ ...editPatientData, age: e.target.value })} />
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Gender</label>
                    <select style={S.select} value={editPatientData.gender} onChange={(e) => setEditPatientData({ ...editPatientData, gender: e.target.value })}>
                      <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
                    </select>
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Address</label>
                    <input style={S.input} value={editPatientData.address} onChange={(e) => setEditPatientData({ ...editPatientData, address: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* Accident Details */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted, fontWeight: 400, marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${T.border}` }}>Accident Details</div>
                <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr' }}>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Accident Date</label>
                    <input type="date" style={S.input} value={editPatientData.accidentDetails.accidentDate} onChange={(e) => setEditPatientData({ ...editPatientData, accidentDetails: { ...editPatientData.accidentDetails, accidentDate: e.target.value } })} />
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Accident Time</label>
                    <input type="time" style={S.input} value={editPatientData.accidentDetails.accidentTime} onChange={(e) => setEditPatientData({ ...editPatientData, accidentDetails: { ...editPatientData.accidentDetails, accidentTime: e.target.value } })} />
                  </div>
                </div>
                <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr', marginBottom: '1rem' }}>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Location</label>
                    <input style={S.input} value={editPatientData.accidentDetails.location} onChange={(e) => setEditPatientData({ ...editPatientData, accidentDetails: { ...editPatientData.accidentDetails, location: e.target.value } })} />
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Incident Type</label>
                    <select style={S.select} value={editPatientData.accidentDetails.accidentType} onChange={(e) => setEditPatientData({ ...editPatientData, accidentDetails: { ...editPatientData.accidentDetails, accidentType: e.target.value } })}>
                      <option value="">Select</option>
                      <option>Road Traffic</option><option>Fall</option><option>Burn</option><option>Drowning</option><option>Other</option>
                    </select>
                  </div>
                </div>
                <div style={S.formGroupNoMb}>
                  <label style={S.label}>Patient Condition</label>
                  <textarea style={{ ...S.textarea, minHeight: '60px' }} value={editPatientData.accidentDetails.condition} onChange={(e) => setEditPatientData({ ...editPatientData, accidentDetails: { ...editPatientData.accidentDetails, condition: e.target.value } })} />
                </div>
              </div>

              {/* Emergency Contact */}
              <div>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: T.textMuted, fontWeight: 400, marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: `1px solid ${T.border}` }}>Emergency Contact</div>
                <div style={{ ...S.formGrid, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 0 }}>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Contact Name</label>
                    <input style={S.input} value={editPatientData.emergencyContact.name} onChange={(e) => setEditPatientData({ ...editPatientData, emergencyContact: { ...editPatientData.emergencyContact, name: e.target.value } })} />
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Relationship</label>
                    <input style={S.input} value={editPatientData.emergencyContact.relationship} onChange={(e) => setEditPatientData({ ...editPatientData, emergencyContact: { ...editPatientData.emergencyContact, relationship: e.target.value } })} />
                  </div>
                  <div style={S.formGroupNoMb}>
                    <label style={S.label}>Phone Number</label>
                    <input style={S.input} value={editPatientData.emergencyContact.phoneNumber} onChange={(e) => setEditPatientData({ ...editPatientData, emergencyContact: { ...editPatientData.emergencyContact, phoneNumber: e.target.value } })} />
                  </div>
                </div>
              </div>
            </div>
            <div style={S.modalFooter}>
              <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => { setShowEditPatient(false); setEditPatientData(null); }}>Cancel</button>
              <button className="cc-action-btn" style={{ ...S.actionBtn, opacity: savingPatient ? 0.6 : 1 }} onClick={handleSavePatient} disabled={savingPatient}>
                <Save size={12} /> {savingPatient ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ DISPATCH MODAL ═══════ */}
      {showDispatch && selectedIncident && (
        <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowDispatch(false); }}>
          <div style={S.modalBox}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>Ambulance Dispatch — {selectedIncident.caseId}</span>
              <button onClick={() => setShowDispatch(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.text, padding: "2px" }}><X size={16} /></button>
            </div>
            <div style={S.modalBody}>
              <div style={{ marginBottom: "1.25rem", padding: "0.625rem 0.875rem", background: T.bgAlt, border: `1px solid ${T.border}`, fontSize: "0.72rem", color: T.textSec }}>
                <strong style={{ fontWeight: 400 }}>Phase B:</strong> Best ambulance suggestions based on availability, priority, facilities & proximity.
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <span style={{ ...S.sectionTitle, display: "block", marginBottom: "0.5rem" }}>Incident Summary</span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <span style={S.badge}>{selectedIncident.incidentType}</span>
                  <span style={triageBadge(selectedIncident.triage)}>{selectedIncident.triage}</span>
                  <span style={{ ...S.badge, borderColor: T.border, color: T.textMuted }}>{selectedIncident.victims} victim(s)</span>
                </div>
              </div>
              <div style={{ marginBottom: "0.75rem", marginTop: "1.25rem" }}>
                <span style={S.sectionTitle}>Select Ambulance</span>
                <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "4px 0 0" }}>Scored on: distance · facilities · availability · priority level</p>
              </div>
              <div className="cc-amb-grid" style={S.ambGrid}>
                {ambulances.filter(a => a.status === "Available").map((amb, i) => (
                  <div key={amb.id} className="cc-amb-card" style={{ ...S.ambCard, ...(selectedAmbulance?.id === amb.id ? S.ambCardSelected : {}), position: "relative" }} onClick={() => setSelectedAmbulance(amb)}>
                    {i === 0 && <span style={{ ...S.badge, fontSize: "0.58rem", borderColor: T.text, position: "absolute", top: "10px", right: "10px" }}>Best Match</span>}
                    <p style={S.ambId}>{amb.id} <span style={{ fontSize: "0.65rem", fontWeight: 300, color: T.textMuted }}>({amb.priority})</span></p>
                    <p style={S.ambMeta}>{amb.crew}</p>
                    <p style={S.ambMeta}>{amb.distance} · ETA {amb.eta}</p>
                    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginTop: "8px" }}>
                      {amb.facilities.map((f) => <span key={f} style={{ ...S.badge, fontSize: "0.58rem" }}>{f}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={S.modalFooter}>
              <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => setShowDispatch(false)}>Cancel</button>
              <button className="cc-action-btn" style={{ ...S.actionBtn, opacity: selectedAmbulance ? 1 : 0.5, cursor: selectedAmbulance ? "pointer" : "not-allowed" }} onClick={handleConfirmDispatch} disabled={!selectedAmbulance}>Broadcast Dispatch Request →</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ HOSPITAL REROUTE MODAL ═══════ */}
      {showHospitalModal && selectedIncident && (
        <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowHospitalModal(false); }}>
          <div style={S.modalBox}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>Hospital Routing — {selectedIncident.caseId}</span>
              <button onClick={() => setShowHospitalModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.text, padding: "2px" }}><X size={16} /></button>
            </div>
            <div style={S.modalBody}>
              <div style={{ marginBottom: "1.25rem", padding: "0.625rem 0.875rem", background: T.bgAlt, border: `1px solid ${T.border}`, fontSize: "0.72rem", color: T.textSec }}>
                <strong style={{ fontWeight: 400 }}>Phase D–F:</strong> AI-ranked hospitals based on triage level, trauma capability, ER load, and patient transport tolerance.
              </div>
              {hospitals.map((h, i) => (
                <div key={h.id} className="cc-hosp-card" style={{ ...S.hospCard, ...(selectedHospital?.id === h.id ? S.hospCardSelected : {}) }} onClick={() => setSelectedHospital(h)}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                      <span style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>{h.name}</span>
                      {i === 0 && <span style={{ ...S.badge, fontSize: "0.58rem", borderColor: T.text }}>Recommended</span>}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: T.textMuted, marginBottom: "6px" }}>{h.distance} · ETA {h.eta} · ER: {h.erLoad} · {h.traumaLevel}</div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>{h.specialties.map((sp) => <span key={sp} style={{ ...S.badge, fontSize: "0.58rem" }}>{sp}</span>)}</div>
                  </div>
                  {selectedIncident.assignedHospital === h.name && <span style={{ fontSize: "0.68rem", color: T.textMuted }}>Current</span>}
                </div>
              ))}
            </div>
            <div style={S.modalFooter}>
              <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => setShowHospitalModal(false)}>Cancel</button>
              <button className="cc-action-btn" style={{ ...S.actionBtn, opacity: selectedHospital ? 1 : 0.5, cursor: selectedHospital ? "pointer" : "not-allowed" }} onClick={handleConfirmHospital} disabled={!selectedHospital}>Confirm & Send Pre-arrival Alert →</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ AMBULANCE REGISTRATION MODAL ═══════ */}
{/* ═══════ AMBULANCE REGISTRATION MODAL ═══════ */}
{showAmbulanceRegistration && (
  <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowAmbulanceRegistration(false); }}>
    <div style={{ ...S.modalBox, maxWidth: '600px', maxHeight: '90vh' }}>
      <div style={S.modalHeader}>
        <span style={S.modalTitle}>Ambulance Registration</span>
        <button onClick={() => setShowAmbulanceRegistration(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
      </div>
      <div style={{ ...S.modalBody, maxHeight: 'calc(90vh - 120px)', overflowY: 'auto' }}>
        
        {/* Required Fields */}
        <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${T.border}` }}>
          Required Information
        </div>
        
        <div style={{ ...S.formGrid, marginBottom: '1.25rem' }}>
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Registration Number *</label>
            <input style={S.input} value={ambulanceForm.registrationNumber} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, registrationNumber: e.target.value })} 
              placeholder="KA01AB1234" />
          </div>
          
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Ambulance Type *</label>
            <select style={S.select} value={ambulanceForm.type} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, type: e.target.value })}>
              <option value="basic">Basic</option>
             
            </select>
          </div>
          
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Make *</label>
            <input style={S.input} value={ambulanceForm.make} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, make: e.target.value })} 
              placeholder="Toyota" />
          </div>
          
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Model *</label>
            <input style={S.input} value={ambulanceForm.model} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, model: e.target.value })} 
              placeholder="Hiace" />
          </div>
          
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Year *</label>
            <input style={S.input} value={ambulanceForm.year} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, year: e.target.value })} 
              placeholder="2024" type="number" />
          </div>
        </div>
        
        {/* Location */}
        <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${T.border}` }}>
          Location Information
        </div>
        
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Address</label>
            <textarea style={{ ...S.textarea, minHeight: '60px' }} value={ambulanceForm.address} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, address: e.target.value })} 
              placeholder="Full address of ambulance base" />
          </div>
          
          <div style={{ ...S.formGrid, marginTop: '0.5rem' }}>
            <div style={S.formGroupNoMb}>
              <label style={S.label}>Latitude</label>
              <input style={S.input} value={ambulanceForm.latitude} 
                onChange={(e) => setAmbulanceForm({ ...ambulanceForm, latitude: e.target.value })} 
                placeholder="12.9716" type="number" step="any" />
            </div>
            
            <div style={S.formGroupNoMb}>
              <label style={S.label}>Longitude</label>
              <input style={S.input} value={ambulanceForm.longitude} 
                onChange={(e) => setAmbulanceForm({ ...ambulanceForm, longitude: e.target.value })} 
                placeholder="77.5946" type="number" step="any" />
            </div>
          </div>
           {/* 👇 ADD THIS MAP DIV HERE - RIGHT AFTER THE LONGITUDE INPUT */}
  <div ref={ambulanceMapRef} style={{ height: "200px", width: "100%", marginTop: "8px", border: `1px solid ${T.border}` }} />
  <small style={{ fontSize: "0.6rem", color: T.textMuted, display: "block", marginTop: "4px" }}>
    Click on map to set coordinates
  </small>
</div>
       
        
        {/* Optional Fields */}
        <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${T.border}` }}>
          Optional Information
        </div>
        
        <div style={{ ...S.formGrid, marginBottom: '0.5rem' }}>
          <div style={S.formGroupNoMb}>
            <label style={S.label}>Password (default: 123456)</label>
            <input style={S.input} type="password" value={ambulanceForm.password} 
              onChange={(e) => setAmbulanceForm({ ...ambulanceForm, password: e.target.value })} 
              placeholder="123456" />
          </div>
          
          <div style={S.formGroupNoMb}>
  <label style={S.label}>Organization ID *</label>
  <input
  type="text"
  value="68c3e6a6ef64cafc435d90ad"
  readOnly
  className="bg-gray-100 cursor-not-allowed"
/>
  
</div>
        </div>
        
      </div>
      <div style={S.modalFooter}>
        <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => setShowAmbulanceRegistration(false)}>Cancel</button>
        <button className="cc-action-btn" style={S.actionBtn} onClick={handleAmbulanceRegistration}>Register Ambulance</button>
      </div>
    </div>
  </div>
)}

      {/* ═══════ DRIVER REGISTRATION MODAL ═══════ */}
      {showDriverRegistration && (
        <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setShowDriverRegistration(false); }}>
          <div style={{ ...S.modalBox, maxWidth: '900px', maxHeight: '90vh' }}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>Driver Registration</span>
              <button onClick={() => setShowDriverRegistration(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ ...S.modalBody, maxHeight: 'calc(90vh - 120px)', overflowY: 'auto' }}>

              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${T.border}` }}>Personal Details</div>
              <div style={{ ...S.formGrid, marginBottom: '1.25rem' }}>
                <div style={S.formGroupNoMb}><label style={S.label}>Crew ID <span style={{ color: 'red' }}>*</span></label><input style={S.input} value={driverForm.driverId} onChange={(e) => setDriverForm({ ...driverForm, driverId: e.target.value })} placeholder="e.g., DRV-001" /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>Full Name <span style={{ color: 'red' }}>*</span></label><input style={S.input} value={driverForm.fullName} onChange={(e) => setDriverForm({ ...driverForm, fullName: e.target.value })} /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>Date of Birth</label><input type="date" style={S.input} value={driverForm.dateOfBirth} onChange={(e) => setDriverForm({ ...driverForm, dateOfBirth: e.target.value })} /></div>
                <div style={S.formGroupNoMb}>
                  <label style={S.label}>Gender</label>
                  <select style={S.select} value={driverForm.gender} onChange={(e) => setDriverForm({ ...driverForm, gender: e.target.value })}>
                    <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                <div style={S.formGroupNoMb}><label style={S.label}>Phone Number</label><input style={S.input} value={driverForm.phoneNumber} onChange={(e) => setDriverForm({ ...driverForm, phoneNumber: e.target.value })} placeholder="+91-XXXXXXXXXX" /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>Current Address</label><textarea style={{ ...S.textarea, minHeight: '60px' }} value={driverForm.currentAddress} onChange={(e) => setDriverForm({ ...driverForm, currentAddress: e.target.value })} rows={2} /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>Permanent Address</label><textarea style={{ ...S.textarea, minHeight: '60px' }} value={driverForm.permanentAddress} onChange={(e) => setDriverForm({ ...driverForm, permanentAddress: e.target.value })} rows={2} /></div>
              </div>

              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${T.border}` }}>Identity Proof Details</div>
              <div style={{ ...S.formGrid, marginBottom: '1.25rem' }}>
                <div style={S.formGroupNoMb}><label style={S.label}>Aadhaar Number</label><input style={S.input} value={driverForm.aadhaarNumber} onChange={(e) => setDriverForm({ ...driverForm, aadhaarNumber: e.target.value })} placeholder="12-digit number" /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>PAN Card Number (optional)</label><input style={S.input} value={driverForm.panNumber} onChange={(e) => setDriverForm({ ...driverForm, panNumber: e.target.value })} placeholder="ABCDE1234F" /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>Driving License Number</label><input style={S.input} value={driverForm.drivingLicenseNumber} onChange={(e) => setDriverForm({ ...driverForm, drivingLicenseNumber: e.target.value })} /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>License Issue Date</label><input type="date" style={S.input} value={driverForm.licenseIssueDate} onChange={(e) => setDriverForm({ ...driverForm, licenseIssueDate: e.target.value })} /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>License Expiry Date</label><input type="date" style={S.input} value={driverForm.licenseExpiryDate} onChange={(e) => setDriverForm({ ...driverForm, licenseExpiryDate: e.target.value })} /></div>
                <div style={S.formGroupNoMb}><label style={S.label}>Issuing RTO Authority</label><input style={S.input} value={driverForm.issuingRTOAuthority} onChange={(e) => setDriverForm({ ...driverForm, issuingRTOAuthority: e.target.value })} placeholder="e.g., Koramangala RTO" /></div>
              </div>

              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${T.border}` }}>Professional Details</div>
              <div style={{ ...S.formGrid, marginBottom: '0.5rem' }}>
                <div style={S.formGroupNoMb}>
                  <label style={S.label}>Employment Type</label>
                  <select style={S.select} value={driverForm.employmentType} onChange={(e) => setDriverForm({ ...driverForm, employmentType: e.target.value })}>
                    <option value="">Select</option><option>Full-time</option><option>Contract</option>
                  </select>
                </div>
                <div style={S.formGroupNoMb}><label style={S.label}>Years of Driving Experience</label><input type="number" style={S.input} value={driverForm.yearsOfExperience} onChange={(e) => setDriverForm({ ...driverForm, yearsOfExperience: e.target.value })} placeholder="Years" /></div>
                <div style={S.formGroupNoMb}>
                  <label style={S.label}>Ambulance Driving Experience</label>
                  <select style={S.select} value={driverForm.ambulanceDrivingExperience} onChange={(e) => setDriverForm({ ...driverForm, ambulanceDrivingExperience: e.target.value })}>
                    <option value="">Select</option><option>Yes</option><option>No</option>
                  </select>
                </div>
                
                <div style={S.formGroupNoMb}>
                  <label style={S.label}>Shift Timing</label>
                  <select style={S.select} value={driverForm.shiftTiming} onChange={(e) => setDriverForm({ ...driverForm, shiftTiming: e.target.value })}>
                    <option value="">Select</option><option>Day</option><option>Night</option><option>Rotational</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={S.modalFooter}>
              <button className="cc-outline-btn" style={S.outlineBtn} onClick={() => setShowDriverRegistration(false)}>Cancel</button>
              <button className="cc-action-btn" style={S.actionBtn} onClick={handleDriverRegistration}>Register Driver →</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ CREDENTIALS MODAL — with Eye icon + real copy ═══════ */}
      {showCredentialsModal && (
        <div style={S.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) { setShowCredentialsModal(false); setShowCredPassword(false); } }}>
          <div style={{ ...S.modalBox, maxWidth: '500px' }}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>Ambulance Crew Registered Successfully</span>
              <button onClick={() => { setShowCredentialsModal(false); setShowCredPassword(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={S.modalBody}>
              <div style={{ border: '1px solid #000', padding: '1.5rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 400, marginBottom: '1rem', color: '#000', textAlign: 'center' }}>
                  Ambulance Crew <strong>{generatedCredentials.driverName}</strong> (Crew ID: {generatedCredentials.driverId}) has been successfully registered.
                </div>
                <div style={{ borderTop: '1px solid #000', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#000', marginBottom: '0.75rem', fontWeight: 400 }}>Login Credentials</div>

                  {/* Username row */}
                  <div style={{ border: '1px solid #000', padding: '0.75rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: '#666', marginBottom: '0.25rem' }}>Username</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, fontFamily: 'monospace', color: '#000' }}>{generatedCredentials.username}</div>
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(generatedCredentials.username); alert('Username copied!'); }}
                      style={{ background: '#fff', border: '1px solid #000', padding: '0.3rem 0.75rem', fontSize: '0.65rem', cursor: 'pointer', color: '#000', fontFamily: "'Open Sans', sans-serif" }}
                    >Copy</button>
                  </div>

                  {/* Password row — with eye toggle */}
                  <div style={{ border: '1px solid #000', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: '#666', marginBottom: '0.25rem' }}>Password</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, fontFamily: 'monospace', color: '#000', letterSpacing: showCredPassword ? 'normal' : '0.1em' }}>
                        {showCredPassword ? generatedCredentials.password : '•'.repeat(Math.max(8, (generatedCredentials.password || '').length))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {/* Eye toggle */}
                      <button
                        onClick={() => setShowCredPassword(v => !v)}
                        title={showCredPassword ? 'Hide password' : 'Show password'}
                        style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '0.3rem 0.5rem', fontSize: '0.65rem', cursor: 'pointer', color: '#000', display: 'flex', alignItems: 'center' }}
                      >
                        {showCredPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      {/* Copy — copies the ACTUAL password */}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedCredentials.password);
                          alert('Password copied!');
                        }}
                        style={{ background: '#fff', border: '1px solid #000', padding: '0.3rem 0.75rem', fontSize: '0.65rem', cursor: 'pointer', color: '#000', fontFamily: "'Open Sans', sans-serif" }}
                      >Copy</button>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#666', textAlign: 'center', padding: '0.75rem', border: '1px solid #e0e0e0', marginTop: '0.75rem' }}>
                Please save these credentials and share them with the driver securely.
              </div>
            </div>
            <div style={S.modalFooter}>
              <button className="cc-action-btn" style={{ ...S.actionBtn, background: '#000', color: '#fff', border: '1px solid #000' }} onClick={() => { setShowCredentialsModal(false); setShowCredPassword(false); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerDashboard;