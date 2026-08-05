import React, { useState, useEffect } from "react";
import {
  Activity,
  Calendar,
  UserPlus,
  Users,
  FileText,
  Stethoscope,
  LogOut,
  Home,
  TrendingUp,
  Clock,
  CheckCircle,
  Settings,
  Bell,
  Search,
  ChevronRight,
  Building,
  User,
  Pill,
  Clipboard,
  HeartPulse,
  Thermometer,
  Eye,
  BarChart3,
  ChevronDown,
  Database,
  Key,
  Shield,
  Server,
  Save,
  AlertCircle,
  Copy,
  EyeOff,
  Eye as EyeOpen,
  Info,
  RefreshCw,
  X,
  Upload,
  FileJson,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching DoctorDashboard) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  accent: "#000000",
  success: "#2e7d32",
  error: "#c62828",
  warning: "#ed6c02",
  info: "#0288d1",
};

const SIDEBAR_WIDTH = "248px";

/* ─── STYLES (identical to HospitalDashboard) ─── */
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
    marginBottom: "0.5rem",
  },
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },
  brandSub: {
    fontSize: "0.68rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
  },
  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.75rem 1.25rem 0.25rem",
    display: "block",
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
  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },
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
  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
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
    gap: "12px",
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },
  topBarSub: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
  },
  dateBadge: {
    fontSize: "0.72rem",
    color: T.textMuted,
    fontWeight: 300,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "0.45rem 0.75rem",
    border: `1px solid ${T.border}`,
  },
  body: {
    padding: "2rem",
    flex: 1,
  },
  pageLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  pageTitle: {
    fontSize: "1.4rem",
    fontWeight: 300,
    letterSpacing: "-0.02em",
    color: T.text,
    marginBottom: "1.5rem",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1px",
    border: `1px solid ${T.border}`,
    background: T.border,
    marginBottom: "2rem",
  },
  card: {
    background: T.bg,
    padding: "1.5rem",
  },
  cardTitle: {
    fontSize: "0.75rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.text,
    marginBottom: "1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    justifyContent: "space-between",
  },
  inputGroup: {
    marginBottom: "1rem",
  },
  label: {
    fontSize: "0.68rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    display: "block",
    marginBottom: "0.35rem",
  },
  input: {
    width: "100%",
    padding: "0.65rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    outline: "none",
    transition: "border-color 0.15s",
  },
  button: {
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    padding: "0.6rem 1.2rem",
    fontSize: "0.7rem",
    fontWeight: 400,
    letterSpacing: "0.08em",
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  },
  buttonOutline: {
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    padding: "0.6rem 1.2rem",
    fontSize: "0.7rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  },
  credentialsBox: {
    marginTop: "1.25rem",
    padding: "1rem",
    background: T.bgAlt,
    border: `1px solid ${T.border}`,
  },
  credentialRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 0",
    borderBottom: `1px solid ${T.border}`,
    fontSize: "0.75rem",
  },
  credentialLabel: {
    fontWeight: 400,
    color: T.textSec,
  },
  credentialValue: {
    fontFamily: "monospace",
    fontSize: "0.7rem",
    color: T.text,
    wordBreak: "break-all",
  },
  warningBox: {
    marginTop: "1rem",
    padding: "0.75rem",
    background: "#fff8e1",
    borderLeft: `3px solid ${T.warning}`,
    fontSize: "0.7rem",
    color: "#b76e00",
  },
  infoBox: {
    marginTop: "1rem",
    padding: "0.75rem",
    background: "#e3f2fd",
    borderLeft: `3px solid ${T.info}`,
    fontSize: "0.7rem",
    color: T.info,
  },
  alertSuccess: {
    padding: "0.75rem",
    background: "#e8f5e9",
    borderLeft: `3px solid ${T.success}`,
    fontSize: "0.7rem",
    color: T.success,
    marginBottom: "1rem",
  },
  alertError: {
    padding: "0.75rem",
    background: "#ffebee",
    borderLeft: `3px solid ${T.error}`,
    fontSize: "0.7rem",
    color: T.error,
    marginBottom: "1rem",
  },
  alertInfo: {
    padding: "0.75rem",
    background: "#e3f2fd",
    borderLeft: `3px solid ${T.info}`,
    fontSize: "0.7rem",
    color: T.info,
    marginBottom: "1rem",
  },
  divider: {
    height: "1px",
    background: T.border,
    margin: "1.5rem 0",
  },
  flexBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  iconButton: {
    background: "none",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    color: T.textMuted,
    padding: "0.25rem",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    width: "90%",
    maxWidth: "500px",
    maxHeight: "80vh",
    overflow: "auto",
    position: "relative",
  },
  modalHeader: {
    padding: "1.25rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: "0.85rem",
    fontWeight: 400,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    margin: 0,
  },
  modalBody: {
    padding: "1.5rem",
  },
  closeIcon: {
    cursor: "pointer",
    color: T.textMuted,
  },
  dropzone: {
    border: `1.5px dashed ${T.border}`,
    background: T.bgAlt,
    padding: "2rem 1.5rem",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.15s",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
  },
  dropzoneActive: {
    borderColor: T.text,
    background: "#f0f0f0",
  },
  dropzoneIconWrap: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: T.bg,
    border: `1px solid ${T.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "0.25rem",
  },
  dropzoneText: {
    fontSize: "0.75rem",
    color: T.textSec,
    fontWeight: 400,
  },
  dropzoneSubtext: {
    fontSize: "0.65rem",
    color: T.textMuted,
  },
  dropzoneLink: {
    color: T.text,
    fontWeight: 400,
    textDecoration: "underline",
  },
  filePreviewRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "0.65rem 0.85rem",
    fontSize: "0.72rem",
  },
  filePreviewLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: T.textSec,
    minWidth: 0,
  },
  filePreviewName: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};

function IntegrationDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const hospitalId = queryParams.get("hospital_id");

  // Auth & UI state
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  // Credentials generation state
  const [credForm, setCredForm] = useState({
    hospital_username: "",
    integrator_name: "",
    integrator_email: "",
  });
  const [generatedCreds, setGeneratedCreds] = useState(null);
  const [credError, setCredError] = useState(null);
  const [credSuccess, setCredSuccess] = useState(null);
  const [showClientSecret, setShowClientSecret] = useState(false);
  
  // Handle already_integrated response
  const [existingIntegration, setExistingIntegration] = useState(null);

  // Save API state
  const [saveApiUrl, setSaveApiUrl] = useState("");
  const [saveApiStatus, setSaveApiStatus] = useState(null);
  const [saveApiMessage, setSaveApiMessage] = useState("");
  const [loadingSaveApi, setLoadingSaveApi] = useState(false);
  const [existingSaveApi, setExistingSaveApi] = useState("");

    // Transcription format upload state
  const [transcriptFile, setTranscriptFile] = useState(null);
  const [transcriptStatus, setTranscriptStatus] = useState(null);
  const [transcriptMessage, setTranscriptMessage] = useState("");
const [loadingTranscriptUpload, setLoadingTranscriptUpload] = useState(false);
  const [isDraggingTranscript, setIsDraggingTranscript] = useState(false);
  // Recover Credentials Modal state
  const [isRecoverModalOpen, setIsRecoverModalOpen] = useState(false);
  const [recoverForm, setRecoverForm] = useState({
    hospital_sys_user_id: "",
    email: "",
    hospital_username: "",
  });
  const [recoveredCreds, setRecoveredCreds] = useState(null);
  const [recoverError, setRecoverError] = useState(null);
  const [recoverSuccess, setRecoverSuccess] = useState(null);
  const [loadingRecover, setLoadingRecover] = useState(false);
  const [showRecoveredSecret, setShowRecoveredSecret] = useState(false);

  // Helper: fetch existing save API on load
  const fetchSaveApi = async () => {
    if (!hospitalId) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/system/get_save_api/${hospitalId}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.save_api) {
          setExistingSaveApi(data.save_api);
          setSaveApiUrl(data.save_api);
        }
      }
    } catch (err) {
      console.warn("Could not fetch save API", err);
    }
  };

  // Verify authentication (same as original)
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/hospitals/verify`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Not authenticated");
        const data = await res.json();
        const verifiedHospitalId = data.hospital.sys_user_id;
        if (hospitalId && hospitalId !== verifiedHospitalId) {
          navigate("/login");
          return;
        }
        setAuthenticated(true);
        fetchSaveApi();
      } catch {
        navigate("/login");
      } finally {
        setAuthChecked(true);
      }
    };
    if (hospitalId) verifyAuth();
    else navigate("/login");
  }, [hospitalId, navigate]);

  // Handle credential generation POST
  const handleGenerateCredentials = async (e) => {
    e.preventDefault();
    setCredError(null);
    setCredSuccess(null);
    setGeneratedCreds(null);
    setExistingIntegration(null);

    if (!credForm.hospital_username || !credForm.integrator_name || !credForm.integrator_email) {
      setCredError("All fields are required.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/integrators/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospital_username: credForm.hospital_username,
          integrator_name: credForm.integrator_name,
          integrator_email: credForm.integrator_email,
        }),
      });

      const data = await response.json();
      console.log("Credential generation response:", data);
      
      // Check if the hospital is already integrated
      if (data.status === "already_integrated") {
        setExistingIntegration({
          integrator_name: data.integrator_name,
          hospital_id: data.hospital_id,
          message: data.message,
        });
        setCredError(null);
        setCredSuccess(null);
        setGeneratedCreds(null);
        return;
      }
      
      if (!response.ok) {
        throw new Error(data.message || "Failed to generate credentials");
      }

      setGeneratedCreds({
        client_id: data.client_id || data.clientId,
        client_secret: data.client_secret || data.clientSecret,
      });
      setCredSuccess("Credentials generated successfully! Store them securely.");
      setExistingIntegration(null);
      setCredForm({ hospital_username: "", integrator_name: "", integrator_email: "" });
    } catch (err) {
      setCredError(err.message);
      setExistingIntegration(null);
    } finally {
      setLoading(false);
    }
  };

  // Handle credential recovery
  const handleRecoverCredentials = async (e) => {
    e.preventDefault();
    setRecoverError(null);
    setRecoverSuccess(null);
    setRecoveredCreds(null);

    if (!recoverForm.hospital_sys_user_id || !recoverForm.email || !recoverForm.hospital_username) {
      setRecoverError("All fields are required to recover credentials.");
      return;
    }

    setLoadingRecover(true);
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/system/verify_integration_credentials`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospital_id: recoverForm.hospital_sys_user_id,
          email: recoverForm.email,
          hospital_username: recoverForm.hospital_username,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || "Failed to verify credentials. Please check your details.");
      }

      // Check if credentials were found
      if (data.client_id && data.client_secret) {
        setRecoveredCreds({
          hospital_id: data.hospital_id,
          client_id: data.client_id,
          client_secret: data.client_secret,
        });
        setRecoverSuccess("Credentials recovered successfully!");
        setRecoverError(null);
      } else {
        setRecoverError("No credentials found for the provided information.");
      }
    } catch (err) {
      setRecoverError(err.message);
      setRecoveredCreds(null);
    } finally {
      setLoadingRecover(false);
    }
  };

  // Handle Save API endpoint submission
  const handleSaveApi = async (e) => {
    e.preventDefault();
    if (!hospitalId) {
      setSaveApiStatus("error");
      setSaveApiMessage("Hospital ID missing. Please log in again.");
      return;
    }
    if (!saveApiUrl.trim()) {
      setSaveApiStatus("error");
      setSaveApiMessage("Save API endpoint is required.");
      return;
    }

    setLoadingSaveApi(true);
    setSaveApiStatus(null);
    setSaveApiMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/system/integrator_save_api`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sys_user_id: hospitalId,
          save_api: saveApiUrl.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to save API endpoint");
      }

      setSaveApiStatus("success");
      setSaveApiMessage("Save API endpoint updated successfully.");
      setExistingSaveApi(saveApiUrl.trim());
    } catch (err) {
      setSaveApiStatus("error");
      setSaveApiMessage(err.message);
    } finally {
      setLoadingSaveApi(false);
    }
  };

  const validateAndSetTranscriptFile = (file) => {
    setTranscriptStatus(null);
    setTranscriptMessage("");
    if (!file) return;
    const isJson = file.type === "application/json" || file.name.toLowerCase().endsWith(".json");
    if (!isJson) {
      setTranscriptStatus("error");
      setTranscriptMessage("Please select a valid .json file.");
      setTranscriptFile(null);
      return;
    }
    setTranscriptFile(file);
  };

  const handleTranscriptFileChange = (e) => {
    const file = e.target.files[0];
    validateAndSetTranscriptFile(file);
  };

  const handleTranscriptDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingTranscript(true);
  };

  const handleTranscriptDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingTranscript(false);
  };

  const handleTranscriptDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingTranscript(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    validateAndSetTranscriptFile(file);
  };

  const removeTranscriptFile = () => {
    setTranscriptFile(null);
    const fileInput = document.getElementById("transcript-file-input");
    if (fileInput) fileInput.value = "";
  };

  const handleTranscriptUpload = async (e) => {
    e.preventDefault();
    if (!hospitalId) {
      setTranscriptStatus("error");
      setTranscriptMessage("Hospital ID missing. Please log in again.");
      return;
    }
    if (!transcriptFile) {
      setTranscriptStatus("error");
      setTranscriptMessage("Please select a JSON file to upload.");
      return;
    }

    setLoadingTranscriptUpload(true);
    setTranscriptStatus(null);
    setTranscriptMessage("");

    try {
      const formData = new FormData();
      formData.append("file", transcriptFile);
      formData.append("hospital_id", hospitalId);

      const response = await fetch(
        `${API_BASE_URL}hms/users/data/system/upload_transcription_format`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to upload transcription format.");
      }

      setTranscriptStatus("success");
      setTranscriptMessage(data.message || "Transcription format uploaded and stored successfully.");
      setTranscriptFile(null);
      const fileInput = document.getElementById("transcript-file-input");
      if (fileInput) fileInput.value = "";
    } catch (err) {
      setTranscriptStatus("error");
      setTranscriptMessage(err.message);
    } finally {
      setLoadingTranscriptUpload(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (response.ok) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Copy to clipboard helper
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const openRecoverModal = () => {
    setIsRecoverModalOpen(true);
    setRecoveredCreds(null);
    setRecoverError(null);
    setRecoverSuccess(null);
    setRecoverForm({
      hospital_sys_user_id: hospitalId || "",
      email: "",
      hospital_username: "",
    });
  };

  const closeRecoverModal = () => {
    setIsRecoverModalOpen(false);
    setRecoveredCreds(null);
    setRecoverError(null);
    setRecoverSuccess(null);
    setShowRecoveredSecret(false);
  };

  // Sidebar navigation
  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, path: `/hospital-dashboard?hospital_id=${hospitalId}` },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, path: `/register-doctor?hospital_id=${hospitalId}` },
        { label: "Add Nurse", icon: <UserPlus size={14} />, path: `/nurse-register?hospital_id=${hospitalId}` },
        { label: "Manage Staff", icon: <UserPlus size={14} />, path: `/hospital-admin-staff?hospital_id=${hospitalId}` },
        { label: "Add Doctor via Excel", icon: <FileText size={14} />, path: `/upload-excel?hospital_id=${hospitalId}` },
        { label: "Integration Settings", icon: <Database size={14} />, active: true },
      ],
    },
  ];

  const handleNavigation = (path) => {
    if (path) navigate(path);
  };

  if (!authChecked) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.78rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .h-input:focus { border-color: ${T.text} !important; outline: none; }
        .h-button-primary:hover { background: transparent !important; color: ${T.text} !important; }
        .h-button-outline:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
      `}</style>

      {/* SIDEBAR */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <div>
              <p style={S.brandName}>DoctorAssist</p>
              <p style={S.brandSub}>Integration Admin</p>
            </div>
          </div>
        </div>

        <div className="h-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => (
                <button
                  key={ii}
                  className="h-nav-btn"
                  style={{ ...S.navBtn, ...(item.active ? S.navBtnActive : {}) }}
                  onClick={() => handleNavigation(item.path)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div style={S.sidebarFooter}>
          <button className="h-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>Integration Settings</p>
            <p style={S.topBarSub}>Manage API credentials and data forwarding endpoints</p>
          </div>
          <div style={S.dateBadge}>
            <Calendar size={12} color={T.textMuted} />
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>

        <div style={S.body}>
          <span style={S.pageLabel}>System Integration</span>
          <h1 style={S.pageTitle}>Integration Dashboard</h1>

          {/* Two column card layout: Generate Credentials + Save API */}
          <div style={S.cardGrid}>
            {/* LEFT CARD: Generate Integration Credentials */}
            <div style={S.card}>
              <div style={S.cardTitle}>
                <Key size={14} />
                Generate Integration Credentials
                <button
                  onClick={openRecoverModal}
                  style={{ ...S.buttonOutline, padding: "0.3rem 0.8rem", fontSize: "0.6rem" }}
                  className="h-button-outline"
                >
                  <RefreshCw size={12} />
                  Recover Credentials
                </button>
              </div>

              {credSuccess && <div style={S.alertSuccess}>{credSuccess}</div>}
              {credError && <div style={S.alertError}>{credError}</div>}
              
              {/* Show existing integration info if already integrated */}
              {existingIntegration && (
                <div style={S.alertInfo}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <Info size={14} />
                    <strong>{existingIntegration.message}</strong>
                  </div>
                  <div style={{ fontSize: "0.7rem", marginTop: "8px" }}>
                    <div>This hospital is already integrated with the following details:</div>
                    <div style={{ marginTop: "8px" }}>
                      <strong>Integrator Name:</strong> {existingIntegration.integrator_name}<br />
                      <strong>Hospital ID:</strong> <code>{existingIntegration.hospital_id}</code>
                    </div>
                    <div style={{ marginTop: "8px", color: T.warning }}>
                      Note: New credentials cannot be generated for an already integrated hospital.
                      Please use the existing integration or contact support.
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleGenerateCredentials}>
                <div style={S.inputGroup}>
                  <label style={S.label}>Hospital Username *</label>
                  <input
                    type="text"
                    style={S.input}
                    className="h-input"
                    value={credForm.hospital_username}
                    onChange={(e) => setCredForm({ ...credForm, hospital_username: e.target.value })}
                    placeholder="e.g., hospital"
                    required
                    disabled={existingIntegration !== null}
                  />
                </div>
                <div style={S.inputGroup}>
                  <label style={S.label}>Integrator Name *</label>
                  <input
                    type="text"
                    style={S.input}
                    className="h-input"
                    value={credForm.integrator_name}
                    onChange={(e) => setCredForm({ ...credForm, integrator_name: e.target.value })}
                    placeholder="e.g., integrator"
                    required
                    disabled={existingIntegration !== null}
                  />
                </div>
                <div style={S.inputGroup}>
                  <label style={S.label}>Integrator Email *</label>
                  <input
                    type="email"
                    style={S.input}
                    className="h-input"
                    value={credForm.integrator_email}
                    onChange={(e) => setCredForm({ ...credForm, integrator_email: e.target.value })}
                    placeholder="integrator@integrator.com"
                    required
                    disabled={existingIntegration !== null}
                  />
                </div>
                <button 
                  type="submit" 
                  style={S.button} 
                  className="h-button-primary" 
                  disabled={loading || existingIntegration !== null}
                >
                  {loading ? "Generating..." : "Generate Credentials"}
                  <Shield size={14} />
                </button>
              </form>

              {generatedCreds && (
                <div style={S.credentialsBox}>
                  <div style={S.credentialRow}>
                    <span style={S.credentialLabel}>Client ID:</span>
                    <div style={S.flexBetween}>
                      <code style={S.credentialValue}>{generatedCreds.client_id}</code>
                      <button
                        style={S.iconButton}
                        onClick={() => copyToClipboard(generatedCreds.client_id)}
                        title="Copy Client ID"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  <div style={S.credentialRow}>
                    <span style={S.credentialLabel}>Client Secret:</span>
                    <div style={S.flexBetween}>
                      <code style={S.credentialValue}>
                        {showClientSecret ? generatedCreds.client_secret : "••••••••••••••••"}
                      </code>
                      <button
                        style={S.iconButton}
                        onClick={() => setShowClientSecret(!showClientSecret)}
                        title={showClientSecret ? "Hide secret" : "Show secret"}
                      >
                        {showClientSecret ? <EyeOff size={12} /> : <EyeOpen size={12} />}
                      </button>
                      <button
                        style={S.iconButton}
                        onClick={() => copyToClipboard(generatedCreds.client_secret)}
                        title="Copy Secret"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  <div style={S.warningBox}>
                    <AlertCircle size={12} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />
                    <span style={{ fontSize: "0.68rem" }}>
                      ⚠️ Store these credentials safely. If lost, recovery is extremely difficult. You will need to regenerate new credentials.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT CARD: Save API Endpoint */}
            <div style={S.card}>
              <div style={S.cardTitle}>
                <Server size={14} />
                Save API Configuration
              </div>
              <p style={{ fontSize: "0.7rem", color: T.textMuted, marginBottom: "1rem" }}>
                Provide your server endpoint where we will POST clinical data.
              </p>

              {saveApiStatus === "success" && <div style={S.alertSuccess}>{saveApiMessage}</div>}
              {saveApiStatus === "error" && <div style={S.alertError}>{saveApiMessage}</div>}

              {existingSaveApi && !saveApiUrl && (
                <div style={{ marginBottom: "1rem", fontSize: "0.7rem", background: T.bgAlt, padding: "0.5rem", border: `1px solid ${T.border}` }}>
                  Currently saved API: <code>{existingSaveApi}</code>
                </div>
              )}

              <form onSubmit={handleSaveApi}>
                <div style={S.inputGroup}>
                  <label style={S.label}>Your Save API Endpoint *</label>
                  <input
                    type="url"
                    style={S.input}
                    className="h-input"
                    value={saveApiUrl}
                    onChange={(e) => setSaveApiUrl(e.target.value)}
                    placeholder="https://your-hospital.com/api/webhook"
                    required
                  />
                  <div style={{ fontSize: "0.6rem", color: T.textMuted, marginTop: "4px" }}>
                    This endpoint will receive appointment & patient data pushes.
                  </div>
                </div>
                <button type="submit" style={S.button} className="h-button-primary" disabled={loadingSaveApi}>
                  {loadingSaveApi ? "Saving..." : "Save Endpoint"}
                  <Save size={14} />
                </button>
              </form>

              <div style={S.divider} />

              <div style={{ marginTop: "0.5rem" }}>
                <div style={S.cardTitle}><Activity size={14} /> Integration Info</div>
                <div style={{ fontSize: "0.7rem", color: T.textSec }}>
                  <p>• Hospital ID: <strong>{hospitalId || "—"}</strong></p>
                  <p>• After saving, your endpoint will receive POST requests for new appointments, patient updates, etc.</p>
                  <p>• Use the generated Client ID + Secret to authenticate outgoing API calls from our system to yours.</p>
                </div>
              </div>
            </div>
         </div>

          {/* Return Format For The Transcription Data */}
          <div style={{ border: `1px solid ${T.border}`, padding: "1.5rem", marginBottom: "2rem" }}>
            <div style={S.cardTitle}>
              <FileJson size={14} />
              Return Format For The Transcription Data
            </div>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, marginBottom: "1rem" }}>
              Upload a JSON file showing the exact return format you want your transcription
              data delivered in. This format will be stored and used as the reference schema.
            </p>

            {transcriptStatus === "success" && <div style={S.alertSuccess}>{transcriptMessage}</div>}
            {transcriptStatus === "error" && <div style={S.alertError}>{transcriptMessage}</div>}

            <form onSubmit={handleTranscriptUpload}>
              <div style={S.inputGroup}>
                <label style={S.label}>Transcription Format JSON *</label>

                <input
                  id="transcript-file-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={handleTranscriptFileChange}
                  style={{ display: "none" }}
                />

                {!transcriptFile ? (
                  <div
                    style={{
                      ...S.dropzone,
                      ...(isDraggingTranscript ? S.dropzoneActive : {}),
                    }}
                    onClick={() => document.getElementById("transcript-file-input").click()}
                    onDragOver={handleTranscriptDragOver}
                    onDragLeave={handleTranscriptDragLeave}
                    onDrop={handleTranscriptDrop}
                  >
                    <div style={S.dropzoneIconWrap}>
                      <FileJson size={18} color={T.textMuted} />
                    </div>
                    <div style={S.dropzoneText}>
                      Drag & drop your JSON file here, or{" "}
                      <span style={S.dropzoneLink}>click to browse</span>
                    </div>
                    <div style={S.dropzoneSubtext}>Only .json files are accepted</div>
                  </div>
                ) : (
                  <div style={S.filePreviewRow}>
                    <div style={S.filePreviewLeft}>
                      <FileJson size={16} color={T.text} />
                      <span style={S.filePreviewName}>{transcriptFile.name}</span>
                      <span style={{ color: T.textMuted, flexShrink: 0 }}>
                        ({(transcriptFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      style={S.iconButton}
                      onClick={removeTranscriptFile}
                      title="Remove file"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                style={S.button}
                className="h-button-primary"
                disabled={loadingTranscriptUpload || !transcriptFile}
              >
                {loadingTranscriptUpload ? "Uploading..." : "Upload Format"}
                <Upload size={14} />
              </button>
            </form>
          </div>

          {/* Recover Credentials Modal */}
          {isRecoverModalOpen && (
            <div style={S.modalOverlay} onClick={closeRecoverModal}>
              <div style={S.modal} onClick={(e) => e.stopPropagation()}>
                <div style={S.modalHeader}>
                  <h3 style={S.modalTitle}>
                    <Key size={14} style={{ display: "inline", marginRight: "8px" }} />
                    Recover Integration Credentials
                  </h3>
                  <X size={18} style={S.closeIcon} onClick={closeRecoverModal} />
                </div>
                <div style={S.modalBody}>
                  {recoverSuccess && <div style={S.alertSuccess}>{recoverSuccess}</div>}
                  {recoverError && <div style={S.alertError}>{recoverError}</div>}

                  {!recoveredCreds ? (
                    <form onSubmit={handleRecoverCredentials}>
                      <div style={S.inputGroup}>
                        <label style={S.label}>Hospital System User ID *</label>
                        <input
                          type="text"
                          style={S.input}
                          className="h-input"
                          value={recoverForm.hospital_sys_user_id}
                          onChange={(e) => setRecoverForm({ ...recoverForm, hospital_sys_user_id: e.target.value })}
                          placeholder="Enter hospital ID"
                          required
                        />
                      </div>
                      <div style={S.inputGroup}>
                        <label style={S.label}>Email Address *</label>
                        <input
                          type="email"
                          style={S.input}
                          className="h-input"
                          value={recoverForm.email}
                          onChange={(e) => setRecoverForm({ ...recoverForm, email: e.target.value })}
                          placeholder="integrator@hospital.com"
                          required
                        />
                      </div>
                      <div style={S.inputGroup}>
                        <label style={S.label}>Hospital Username *</label>
                        <input
                          type="text"
                          style={S.input}
                          className="h-input"
                          value={recoverForm.hospital_username}
                          onChange={(e) => setRecoverForm({ ...recoverForm, hospital_username: e.target.value })}
                          placeholder="Hospital username"
                          required
                        />
                      </div>
                      <button type="submit" style={{ ...S.button, width: "100%" }} disabled={loadingRecover}>
                        {loadingRecover ? "Verifying..." : "Verify & Recover Credentials"}
                        <RefreshCw size={14} />
                      </button>
                    </form>
                  ) : (
                    <div>
                      <div style={S.credentialsBox}>
                        <div style={S.credentialRow}>
                          <span style={S.credentialLabel}>Hospital ID:</span>
                          <code style={S.credentialValue}>{recoveredCreds.hospital_id}</code>
                        </div>
                        <div style={S.credentialRow}>
                          <span style={S.credentialLabel}>Client ID:</span>
                          <div style={S.flexBetween}>
                            <code style={S.credentialValue}>{recoveredCreds.client_id}</code>
                            <button
                              style={S.iconButton}
                              onClick={() => copyToClipboard(recoveredCreds.client_id)}
                              title="Copy Client ID"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                        <div style={S.credentialRow}>
                          <span style={S.credentialLabel}>Client Secret:</span>
                          <div style={S.flexBetween}>
                            <code style={S.credentialValue}>
                              {showRecoveredSecret ? recoveredCreds.client_secret : "••••••••••••••••"}
                            </code>
                            <button
                              style={S.iconButton}
                              onClick={() => setShowRecoveredSecret(!showRecoveredSecret)}
                              title={showRecoveredSecret ? "Hide secret" : "Show secret"}
                            >
                              {showRecoveredSecret ? <EyeOff size={12} /> : <EyeOpen size={12} />}
                            </button>
                            <button
                              style={S.iconButton}
                              onClick={() => copyToClipboard(recoveredCreds.client_secret)}
                              title="Copy Secret"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div style={S.warningBox}>
                        <AlertCircle size={12} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />
                        <span style={{ fontSize: "0.68rem" }}>
                          ⚠️ Store these credentials safely. If lost again, you will need to contact support to regenerate them.
                        </span>
                      </div>
                      <button
                        onClick={closeRecoverModal}
                        style={{ ...S.button, width: "100%", marginTop: "1rem" }}
                      >
                        Close
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Additional documentation / tips section */}
          <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "1.5rem", marginTop: "0.5rem" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <Clipboard size={18} color={T.textMuted} />
              <div>
                <h4 style={{ fontSize: "0.75rem", fontWeight: 400, letterSpacing: "0.1em", marginBottom: "0.5rem" }}>INTEGRATION NOTES</h4>
                <ul style={{ fontSize: "0.7rem", color: T.textSec, marginLeft: "1rem", lineHeight: 1.5 }}>
                  <li>Credentials are one-time display. Store them in a password manager.</li>
                  <li>If a hospital is already integrated, you cannot generate new credentials. Please use the existing integration.</li>
                  <li>Use the "Recover Credentials" button if you have lost your credentials but know your hospital ID, email, and username.</li>
                  <li>The Save API endpoint should be able to accept JSON payloads with authentication headers using your Client ID/Secret.</li>
                  <li>We will automatically retry failed deliveries (exponential backoff).</li>
                  <li>To update the Save API, simply enter a new endpoint and click save again — the old configuration will be replaced.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default IntegrationDashboard;