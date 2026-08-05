import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ChevronDown,
  ChevronUp,
  Send,
  X,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  Phone,
  Users,
  BookOpen,
  RefreshCw,
  Bell,
  FileText,
  LogOut,
  Home,
  Settings,
  UserPlus,
  MessageCircle,
  Mic,
  Pause,
  Activity,
  Bed,
} from 'lucide-react';
import { useLocation, useNavigate } from "react-router-dom";

// ─── COMPANY THEME (matching DoctorDashboard) ───
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
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
import AppointmentDashboard from "./AppointmentDashboard";
import DateWiseAppointmentDashboard from "./DateWiseAppointmentDashboard";

// ─── SIDEBAR STYLES (exact from DoctorDashboard) ───
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
    left: 0, top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
    transition: "transform 0.3s ease",
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
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },
  sectionLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  doctorName: {
    fontSize: "0.9rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
  },
  doctorSpec: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
  },
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
    padding: "0.5rem 1.25rem 0.25rem",
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
};

// ─── PAGE-LEVEL STYLES ───
const P = {
  pageContent: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    padding: "1.5rem 2rem",
    minWidth: 0,
  },
  headerContainer: {
    padding: "1.25rem 1.5rem",
    marginBottom: "1.5rem",
    backgroundColor: T.bg,
    border: `1px solid ${T.border}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerMeta: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: T.textMuted,
    marginBottom: "0.35rem",
    display: "block",
  },
  headerTitle: {
    fontWeight: 300,
    fontSize: "1.4rem",
    margin: 0,
    color: T.text,
    letterSpacing: "-0.02em",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1px",
    marginBottom: "1.5rem",
    border: `1px solid ${T.border}`,
    backgroundColor: T.border,
  },
  statCard: {
    padding: "1.25rem",
    backgroundColor: T.bg,
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  statIconBox: {
    width: "36px",
    height: "36px",
    backgroundColor: T.accent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statLabel: {
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    margin: "0 0 0.25rem 0",
  },
  statValue: {
    fontSize: "1.6rem",
    fontWeight: 300,
    color: T.text,
    margin: 0,
    letterSpacing: "-0.04em",
    lineHeight: 1,
  },
  filterBar: {
    padding: "1rem 1.25rem",
    marginBottom: "1.5rem",
    backgroundColor: T.bg,
    border: `1px solid ${T.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
  },
  searchContainer: {
    flex: 1,
    minWidth: "240px",
    position: "relative",
  },
  searchIcon: {
    position: "absolute",
    left: "0.875rem",
    top: "50%",
    transform: "translateY(-50%)",
  },
  searchInput: {
    width: "100%",
    padding: "0.6rem 1rem 0.6rem 2.5rem",
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    fontSize: "0.82rem",
    outline: "none",
    fontFamily: "'Open Sans', sans-serif",
    color: T.text,
    backgroundColor: T.bgAlt,
    boxSizing: "border-box",
  },
  filterActions: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  filterSelect: {
    padding: "0.6rem 1rem",
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    fontSize: "0.78rem",
    color: T.textSec,
    backgroundColor: T.bgAlt,
    cursor: "pointer",
    outline: "none",
    fontFamily: "'Open Sans', sans-serif",
  },
  refreshButton: {
    padding: "0.6rem",
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    backgroundColor: T.bg,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
  },
  patientList: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    backgroundColor: T.border,
    border: `1px solid ${T.border}`,
  },
  patientCard: {
    backgroundColor: T.bg,
    overflow: "hidden",
  },
  patientCardHeader: {
    padding: "1rem 1.25rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    transition: "background-color 0.15s ease",
  },
  patientCardLeft: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    flex: 1,
  },
  patientAvatar: {
    width: "38px",
    height: "38px",
    backgroundColor: T.accent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.9rem",
    fontWeight: "600",
    color: T.bg,
    flexShrink: 0,
    fontFamily: "'Open Sans', sans-serif",
  },
  patientCardName: {
    fontSize: "0.9rem",
    fontWeight: "600",
    color: T.text,
    margin: "0 0 0.2rem 0",
  },
  patientMetrics: {
    display: "flex",
    gap: "1rem",
    fontSize: "0.75rem",
  },
  metric: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    color: T.textMuted,
  },
  patientCardRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  statusBadges: {
    display: "flex",
    gap: "0.4rem",
  },
  badge: {
    padding: "0.15rem 0.6rem",
    borderRadius: 0,
    fontSize: "0.62rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: "'Open Sans', sans-serif",
  },
  messageButton: {
    padding: "0.4rem 0.7rem",
    border: `1px solid ${T.borderStr}`,
    backgroundColor: T.accent,
    borderRadius: 0,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
  },
  expandedContent: {
    padding: "1.25rem",
    borderTop: `1px solid ${T.border}`,
    backgroundColor: T.bgAlt,
  },
  tabBar: {
    display: "flex",
    gap: 0,
    borderBottom: `1px solid ${T.border}`,
    marginBottom: "1.25rem",
  },
  tab: {
    padding: "0.6rem 1.25rem",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.textMuted,
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    borderBottom: "2px solid transparent",
    marginBottom: "-1px",
    fontFamily: "'Open Sans', sans-serif",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    transition: "all 0.15s ease",
  },
  activeTab: {
    color: T.text,
    borderBottomColor: T.accent,
    fontWeight: 700,
  },
  tabContent: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  followupCard: {
    backgroundColor: T.bg,
    padding: "1rem",
    border: `1px solid ${T.border}`,
    transition: "border-color 0.15s ease",
  },
  followupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.75rem",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  followupStatus: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  followupDates: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    fontSize: "0.72rem",
    color: T.textMuted,
    flexWrap: "wrap",
  },
  dateItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  followupDetails: {
    display: "flex",
    gap: "1rem",
    fontSize: "0.78rem",
    color: T.textSec,
    flexWrap: "wrap",
    marginBottom: "0.5rem",
  },
  detailItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  responseBox: {
    marginTop: "0.75rem",
    padding: "0.75rem",
    backgroundColor: T.bgAlt,
    borderLeft: `3px solid ${T.accent}`,
  },
  responseHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.4rem",
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    fontWeight: 600,
  },
  responseTime: {
    marginLeft: "auto",
    color: T.textMuted,
  },
  responseText: {
    margin: 0,
    fontSize: "0.82rem",
    color: T.textSec,
    fontStyle: "italic",
    lineHeight: 1.6,
  },
  educationCard: {
    backgroundColor: T.bg,
    padding: "1rem",
    border: `1px solid ${T.border}`,
  },
  educationHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.75rem",
    fontSize: "0.72rem",
    color: T.textMuted,
  },
  educationMeta: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  questionBox: {
    backgroundColor: T.bgAlt,
    padding: "0.75rem",
    marginBottom: "0.5rem",
    borderLeft: `3px solid ${T.textMuted}`,
  },
  questionLabel: {
    fontSize: "0.6rem",
    fontWeight: 700,
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    display: "block",
    marginBottom: "0.25rem",
  },
  questionText: {
    margin: 0,
    fontSize: "0.82rem",
    color: T.textSec,
    lineHeight: 1.6,
  },
  answerBox: {
    backgroundColor: T.bgTert,
    padding: "0.75rem",
    borderLeft: `3px solid ${T.accent}`,
  },
  answerLabel: {
    fontSize: "0.6rem",
    fontWeight: 700,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    display: "block",
    marginBottom: "0.25rem",
  },
  answerText: {
    margin: 0,
    fontSize: "0.82rem",
    color: T.textSec,
    lineHeight: 1.6,
  },
  loadingState: {
    padding: "3rem",
    textAlign: "center",
    color: T.textMuted,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    backgroundColor: T.bg,
    border: `1px solid ${T.border}`,
  },
  spinner: {
    width: "2rem",
    height: "2rem",
    border: `2px solid ${T.border}`,
    borderTopColor: T.accent,
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  emptyState: {
    padding: "3rem",
    textAlign: "center",
    color: T.textMuted,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.75rem",
    backgroundColor: T.bg,
    border: `1px solid ${T.border}`,
  },
  modalOverlay: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    zIndex: 50,
  },
  modal: {
    backgroundColor: T.bg,
    maxWidth: "500px",
    width: "100%",
    maxHeight: "90vh",
    overflow: "auto",
    border: `1px solid ${T.borderStr}`,
    boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
  },
  modalHeader: {
    padding: "1.25rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    margin: 0,
    fontSize: "0.9rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    letterSpacing: "-0.01em",
  },
  modalClose: {
    padding: "0.35rem",
    border: `1px solid ${T.border}`,
    background: "none",
    cursor: "pointer",
    borderRadius: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: {
    padding: "1.5rem",
  },
  patientInfo: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1.25rem",
    padding: "1rem",
    backgroundColor: T.bgAlt,
    border: `1px solid ${T.border}`,
  },
  patientName: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: T.text,
    margin: "0 0 0.2rem 0",
  },
  patientContact: {
    fontSize: "0.78rem",
    color: T.textMuted,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  messageInput: {
    width: "100%",
    padding: "0.875rem 1rem",
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    minHeight: "140px",
    fontSize: "0.82rem",
    resize: "vertical",
    fontFamily: "'Open Sans', sans-serif",
    color: T.text,
    backgroundColor: T.bgAlt,
    outline: "none",
    boxSizing: "border-box",
  },
  messageStatus: {
    marginTop: "0.75rem",
    padding: "0.75rem",
    fontSize: "0.82rem",
    fontFamily: "'Open Sans', sans-serif",
    borderLeft: "3px solid",
  },
  modalFooter: {
    padding: "1.25rem 1.5rem",
    borderTop: `1px solid ${T.border}`,
    backgroundColor: T.bgAlt,
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.75rem",
  },
  cancelButton: {
    padding: "0.6rem 1.25rem",
    border: `1px solid ${T.border}`,
    borderRadius: 0,
    backgroundColor: T.bg,
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 400,
    fontFamily: "'Open Sans', sans-serif",
    color: T.textSec,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  sendButton: {
    padding: "0.6rem 1.25rem",
    border: `1px solid ${T.borderStr}`,
    borderRadius: 0,
    backgroundColor: T.accent,
    color: T.bg,
    fontSize: "0.75rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontFamily: "'Open Sans', sans-serif",
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  buttonSpinner: {
    width: "0.875rem",
    height: "0.875rem",
    border: `2px solid ${T.bg}`,
    borderTopColor: "transparent",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
};

const DoctorCommunicationDashboard = () => {
  const navigate = useNavigate();

  const getDoctorIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('doctor_id');
  };

  const [doctorId] = useState(getDoctorIdFromUrl());
  const [followups, setFollowups] = useState([]);
  const [educationRecords, setEducationRecords] = useState([]);
  const [loading, setLoading] = useState({ followups: true, education: true });
  const [error, setError] = useState({ followups: null, education: null });
  const [expandedPatient, setExpandedPatient] = useState(null);
  const [selectedPatientForMessage, setSelectedPatientForMessage] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageStatus, setMessageStatus] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [doctorName, setDoctorName] = useState('');
  const [doctorSpeciality, setDoctorSpeciality] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [messageHistory, setMessageHistory] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // ── Auth ──
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/doctors/verify`, { credentials: 'include' });
        if (!res.ok) throw new Error('Not authenticated');
        const data = await res.json();
        const verifiedDoctorId = data.doctor.sys_user_id;
        if (doctorId && doctorId !== verifiedDoctorId) { navigate('/login'); return; }
      } catch { navigate('/login'); }
      finally { setAuthChecked(true); }
    };
    verifyAuth();
  }, [navigate, doctorId]);

  // ── Doctor details ──
  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doctor_id: doctorId }),
        });
        const data = await res.json();
        if (data.status === 'success') { setDoctorName(data.doctor_name); setDoctorSpeciality(data.doctor_speciality); }
      } catch { }
    })();
  }, [doctorId]);

  useEffect(() => {
    if (doctorId) { fetchFollowups(); fetchEducationRecords(); fetchMessageHistory(); }
  }, [doctorId]);

  const fetchFollowups = async () => {
    setLoading(prev => ({ ...prev, followups: true }));
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/whatsapp/doctor-followups/${doctorId}`);
      if (!response.ok) throw new Error('Failed to fetch followups');
      const data = await response.json();
      const sortedData = (Array.isArray(data) ? data : []).sort((a, b) => new Date(b.reminded_at || b.created_at) - new Date(a.reminded_at || a.created_at));
      setFollowups(sortedData);
      setError(prev => ({ ...prev, followups: null }));
    } catch (err) { setError(prev => ({ ...prev, followups: err.message })); setFollowups([]); }
    finally { setLoading(prev => ({ ...prev, followups: false })); }
  };

  const fetchEducationRecords = async () => {
    setLoading(prev => ({ ...prev, education: true }));
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/whatsapp/education-records?doctor_id=${doctorId}`);
      if (!response.ok) throw new Error('Failed to fetch education records');
      const data = await response.json();
      let records = [];
      if (Array.isArray(data)) records = data;
      else if (data && typeof data === 'object') {
        if (Array.isArray(data.data)) records = data.data;
        else if (Array.isArray(data.records)) records = data.records;
        else records = [data];
      }
      setEducationRecords(records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      setError(prev => ({ ...prev, education: null }));
    } catch (err) { setError(prev => ({ ...prev, education: err.message })); setEducationRecords([]); }
    finally { setLoading(prev => ({ ...prev, education: false })); }
  };

  const fetchMessageHistory = async () => {
    setLoadingMessages(true);
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/whatsapp/get_messages_by_doctor/${doctorId}`);
      if (!response.ok) throw new Error('Failed to fetch message history');
      const data = await response.json();
      setMessageHistory((Array.isArray(data) ? data : []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (err) { console.error('Error fetching message history:', err); }
    finally { setLoadingMessages(false); }
  };

  const sendMessageToPatient = async (patientId) => {
    if (!messageText.trim()) return;
    setSendingMessage(true); setMessageStatus(null);
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/whatsapp/doctor-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, message: messageText.trim() }),
        credentials: 'include',
      });
      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.message || 'Failed to send message');
      setMessageStatus({ type: 'success', text: responseData.message || 'Message sent successfully!' });
      setMessageText('');
      await fetchMessageHistory();
      setTimeout(() => { setMessageStatus(null); setSelectedPatientForMessage(null); }, 2000);
    } catch (err) { setMessageStatus({ type: 'error', text: err.message || 'Failed to send message.' }); }
    finally { setSendingMessage(false); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorderRef.current.onstop = processAudio;
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setMessageStatus({ type: 'info', text: 'Recording started. Speak now...' });
    } catch { setMessageStatus({ type: 'error', text: 'Microphone permission is required.' }); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const processAudio = async () => {
    if (audioChunksRef.current.length === 0) { setMessageStatus({ type: 'warning', text: 'No audio recorded!' }); return; }
    try {
      setIsProcessingVoice(true);
      setMessageStatus({ type: 'info', text: 'Processing audio transcription...' });
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, 'recording.webm');
      const response = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(`Transcription failed: ${response.status}`);
      const data = await response.json();
      const transcribedText = data?.text || '';
      if (transcribedText.trim()) {
        setMessageText(prev => prev + (prev ? ' ' : '') + transcribedText);
        setMessageStatus({ type: 'success', text: 'Voice transcribed and added to message!' });
        setTimeout(() => setMessageStatus(null), 2000);
      } else { setMessageStatus({ type: 'warning', text: 'No speech detected in audio' }); }
    } catch { setMessageStatus({ type: 'error', text: 'Transcription failed. Please try again.' }); }
    finally { setIsProcessingVoice(false); }
  };

  const toggleRecording = () => { if (isRecording) stopRecording(); else startRecording(); };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.code === 'Space' && selectedPatientForMessage) { e.preventDefault(); if (!isProcessingVoice) toggleRecording(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, isProcessingVoice, selectedPatientForMessage]);

  const handleLogout = async () => {
    try { await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: 'POST', credentials: 'include' }); }
    finally { navigate('/login'); }
  };

  const getPatientsData = () => {
    const patientMap = new Map();
    followups.forEach(followup => {
      const patientId = followup.patient_id;
      const patientName = followup.template_variables?.patient_name || 'Unknown Patient';
      if (!patientMap.has(patientId)) patientMap.set(patientId, { id: patientId, name: patientName, phone: followup.patient_response?.from_number || followup.session_id, followups: [], education: [], messages: [], lastActivity: followup.reminded_at || followup.created_at || followup.response_time, status: 'active' });
      patientMap.get(patientId).followups.push(followup);
    });
    educationRecords.forEach(record => {
      const patientId = record.patient_id;
      if (!patientMap.has(patientId)) patientMap.set(patientId, { id: patientId, name: record.patient_name || 'Unknown Patient', phone: record.phone_number, followups: [], education: [], messages: [], lastActivity: record.created_at, status: 'active' });
      patientMap.get(patientId).education.push(record);
    });
    messageHistory.forEach(message => {
      const patientId = message.patient_id;
      if (!patientMap.has(patientId)) patientMap.set(patientId, { id: patientId, name: message.patient_name || 'Unknown Patient', phone: message.phone_number, followups: [], education: [], messages: [], lastActivity: message.created_at, status: 'active' });
      patientMap.get(patientId).messages.push(message);
    });
    return Array.from(patientMap.values())
      .filter(patient => patient.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  };

  const patients = getPatientsData();

  const stats = {
    totalPatients: patients.length,
    totalFollowups: followups.length,
    totalMessages: messageHistory.length,
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDateOnly = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // ── Nav sections (exact from DoctorDashboard) ──
  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`), key: "dashboard" },
        { label: "Appointment", icon: <Settings size={14} />, action: () => navigate(`/appointments?doctor_id=${doctorId}`) },
        { label: "Date-wise Appointments", icon: <Calendar size={14} />, action: () => navigate(`/date-wise-appointment-dashboard?doctor_id=${doctorId}`) },
        { label: "Patient Listing", icon: <Users size={14} />, action: () => navigate(`/patient-listing?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Clinical",
      items: [
        { label: "Skills Settings", icon: <FileText size={14} />, action: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`) },
        { label: "Node Settings", icon: <Settings size={14} />, action: () => (window.location.href = `/settings.html?doctor_id=${doctorId}`) },
      ],
    },
    {
      label: "Communication",
      items: [
        { label: "Communication View", icon: <MessageCircle size={14} />, action: () => navigate(`/appointment-dashboard1?doctor_id=${doctorId}`) },
        { label: "Communication Progression", icon: <Calendar size={14} />, action: () => navigate(`/doctor-communication-dashboard?doctor_id=${doctorId}`), key: "communication", active: true },
      ],
    },
    {
      label: "Other",
      items: [
        { label: "Patient Registration", icon: <UserPlus size={14} />, action: () => navigate(`/register-patient?doctor_id=${doctorId}`) },
      ],
    },
  ];

  if (!authChecked) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.85rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Verifying session…
      </div>
    );
  }

  if (!doctorId) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Open Sans', sans-serif", backgroundColor: T.bgAlt }}>
        <div style={{ backgroundColor: T.bg, padding: "2rem", border: `1px solid ${T.borderStr}`, textAlign: "center", maxWidth: "400px" }}>
          <h2 style={{ color: T.text, margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 600 }}>Doctor ID Required</h2>
          <p style={{ color: T.textMuted, margin: "0 0 1rem", fontSize: "0.85rem" }}>Please add your doctor ID to the URL:</p>
          <code style={{ backgroundColor: T.bgTert, padding: "0.75rem", fontSize: "0.78rem", fontFamily: "monospace", border: `1px solid ${T.border}`, color: T.textSec, display: "block" }}>?doctor_id=YOUR_DOCTOR_ID</code>
        </div>
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .patient-card-hover:hover { background-color: ${T.bgAlt} !important; }
        .followup-card-hover:hover { border-color: ${T.borderStr} !important; }
        .refresh-btn-hover:hover { background-color: ${T.bgAlt} !important; border-color: ${T.borderStr} !important; }
        .msg-btn-hover:hover { background-color: ${T.textSec} !important; }
        .modal-close-hover:hover { background-color: ${T.bgAlt} !important; }
        input::placeholder { color: ${T.textMuted}; }
        textarea::placeholder { color: ${T.textMuted}; }
        select option { background: ${T.bg}; color: ${T.text}; }
      `}</style>

      {/* ═══════════════ SIDEBAR ═══════════════ */}
      <aside style={S.sidebar}>
        {/* brand */}
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <span style={S.brandName}>DoctorAssist.AI</span>
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorName}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        {/* nav */}
        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const isActive = item.active === true;
                return (
                  <button
                    key={ii}
                    className="da-nav-btn"
                    style={{ ...S.navBtn, ...(isActive ? S.navBtnActive : {}) }}
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
          <button className="da-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div style={P.pageContent}>
        {/* Header */}
        <div style={P.headerContainer}>
          <div>
            <span style={P.headerMeta}>Doctor Dashboard</span>
            <h1 style={P.headerTitle}>Communication Dashboard</h1>
          </div>
          <button
            className="refresh-btn-hover"
            style={P.refreshButton}
            onClick={() => { fetchFollowups(); fetchEducationRecords(); fetchMessageHistory(); }}
          >
            <RefreshCw size={17} color={T.textMuted} />
          </button>
        </div>

        {/* Stats */}
        <div style={P.statsGrid}>
          {[
            { label: 'Total Patients', value: stats.totalPatients, icon: Users },
            { label: 'Total Follow-ups', value: stats.totalFollowups, icon: Calendar },
            { label: 'Messages Sent', value: stats.totalMessages, icon: MessageSquare },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} style={P.statCard}>
              <div style={P.statIconBox}>
                <Icon size={18} color={T.bg} />
              </div>
              <div>
                <p style={P.statLabel}>{label}</p>
                <h3 style={P.statValue}>{value}</h3>
              </div>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div style={P.filterBar}>
          <div style={P.searchContainer}>
            <Search size={16} color={T.textMuted} style={P.searchIcon} />
            <input
              type="text"
              placeholder="Search patients by name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={P.searchInput}
            />
          </div>
          <div style={P.filterActions}>
            <select style={P.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="pending">Pending Response</option>
              <option value="confirmed">Confirmed</option>
              <option value="declined">Declined</option>
            </select>
            <select style={P.filterSelect} value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
            <button className="refresh-btn-hover" style={P.refreshButton} onClick={() => { fetchFollowups(); fetchEducationRecords(); }}>
              <RefreshCw size={16} color={T.textMuted} />
            </button>
          </div>
        </div>

        {/* Patient List */}
        {loading.followups || loading.education ? (
          <div style={P.loadingState}>
            <div style={P.spinner} />
            <p style={{ margin: 0, fontSize: '0.82rem' }}>Loading patient data...</p>
          </div>
        ) : patients.length === 0 ? (
          <div style={P.emptyState}>
            <Users size={40} color={T.border} />
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: '600', color: T.textSec }}>No Patients Found</p>
            <p style={{ margin: 0, fontSize: '0.78rem' }}>{searchTerm ? 'Try adjusting your search term' : 'No patient data available'}</p>
          </div>
        ) : (
          <div style={P.patientList}>
            {patients.map(patient => (
              <PatientCard
                key={patient.id}
                patient={patient}
                isExpanded={expandedPatient === patient.id}
                onToggle={() => setExpandedPatient(expandedPatient === patient.id ? null : patient.id)}
                onMessage={() => setSelectedPatientForMessage(patient)}
                styles={P}
                formatDate={formatDate}
                formatDateOnly={formatDateOnly}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Message Modal ── */}
      {selectedPatientForMessage && (
        <div style={P.modalOverlay} onClick={() => { if (isRecording) stopRecording(); setSelectedPatientForMessage(null); }}>
          <div style={P.modal} onClick={e => e.stopPropagation()}>
            <div style={P.modalHeader}>
              <h3 style={P.modalTitle}>
                <MessageSquare size={16} color={T.text} />
                Send Message — {selectedPatientForMessage.name}
              </h3>
              <button
                className="modal-close-hover"
                onClick={() => { if (isRecording) stopRecording(); setSelectedPatientForMessage(null); }}
                style={P.modalClose}
              >
                <X size={16} />
              </button>
            </div>

            <div style={P.modalBody}>
              <div style={P.patientInfo}>
                <div style={{ ...P.patientAvatar, width: '34px', height: '34px', fontSize: '0.8rem' }}>
                  {selectedPatientForMessage.name?.charAt(0).toUpperCase() || '?'}
                </div>
                <div>
                  <p style={P.patientName}>{selectedPatientForMessage.name}</p>
                  <p style={P.patientContact}>
                    <Phone size={12} color={T.textMuted} />
                    {selectedPatientForMessage.phone || 'No phone number'}
                  </p>
                </div>
              </div>

              <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type your message here or use voice input (Ctrl+Space)..."
                  style={{ ...P.messageInput, paddingRight: '60px' }}
                />
                <div style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isProcessingVoice && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: T.bgAlt, padding: '3px 8px', border: `1px solid ${T.border}`, fontSize: '0.65rem', color: T.textMuted }}>
                      <div style={{ ...P.buttonSpinner, border: `2px solid ${T.border}`, borderTopColor: T.accent }} />
                      <span>Transcribing...</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={isProcessingVoice}
                    title={isRecording ? 'Stop recording (Ctrl+Space)' : 'Start recording (Ctrl+Space)'}
                    style={{
                      width: '36px', height: '36px',
                      border: `1px solid ${isRecording ? T.text : T.border}`,
                      backgroundColor: isRecording ? T.accent : T.bgAlt,
                      color: isRecording ? T.bg : T.textMuted,
                      cursor: isProcessingVoice ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: isProcessingVoice ? 0.4 : 1,
                      animation: isRecording ? 'pulse 1.5s infinite' : 'none',
                      transition: 'all 0.2s ease',
                      borderRadius: 0,
                    }}
                  >
                    {isRecording ? <Pause size={15} /> : <Mic size={15} />}
                  </button>
                </div>
              </div>

              {messageStatus && (
                <div style={{
                  ...P.messageStatus,
                  backgroundColor: messageStatus.type === 'success' ? T.bgAlt : messageStatus.type === 'error' ? '#fff8f8' : T.bgTert,
                  borderLeftColor: messageStatus.type === 'success' ? T.accent : messageStatus.type === 'error' ? '#cc0000' : T.textMuted,
                  color: messageStatus.type === 'error' ? '#cc0000' : T.textSec,
                }}>
                  {messageStatus.text}
                </div>
              )}
            </div>

            <div style={P.modalFooter}>
              <button
                onClick={() => { if (isRecording) stopRecording(); setSelectedPatientForMessage(null); setMessageText(''); setMessageStatus(null); }}
                style={P.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={() => sendMessageToPatient(selectedPatientForMessage.id)}
                disabled={sendingMessage || !messageText.trim() || isRecording || isProcessingVoice}
                style={{ ...P.sendButton, opacity: (sendingMessage || !messageText.trim() || isRecording || isProcessingVoice) ? 0.4 : 1, cursor: (sendingMessage || !messageText.trim() || isRecording || isProcessingVoice) ? 'not-allowed' : 'pointer' }}
              >
                {sendingMessage ? (
                  <><div style={P.buttonSpinner} />Sending...</>
                ) : (
                  <><Send size={14} />Send Message</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Patient Card Component ──
const PatientCard = ({ patient, isExpanded, onToggle, onMessage, styles, formatDate, formatDateOnly }) => {
  const availableTabs = [];
  if (patient.followups?.length > 0) availableTabs.push({ id: 'followups', label: 'Follow-ups', icon: Calendar, count: patient.followups.length });
  if (patient.education?.length > 0) availableTabs.push({ id: 'education', label: 'Education', icon: BookOpen, count: patient.education.length });
  if (patient.messages?.length > 0) availableTabs.push({ id: 'messages', label: 'Messages', icon: MessageSquare, count: patient.messages.length });

  const [activeTab, setActiveTab] = useState(availableTabs[0]?.id || 'followups');

  const pendingCount = patient.followups?.filter(f => f.reminder_sent && !f.response_received).length || 0;
  const confirmedCount = patient.followups?.filter(f => f.response_type === 'yes').length || 0;

  const getStatusIcon = (followup) => {
    if (!followup.reminder_sent) return <Bell size={14} color={T.textMuted} />;
    if (!followup.response_received) return <Clock size={14} color="#c07000" />;
    if (followup.response_type === 'yes') return <CheckCircle size={14} color="#1a7a1a" />;
    return <XCircle size={14} color="#cc0000" />;
  };

  const getStatusText = (followup) => {
    if (!followup.reminder_sent) return 'Not sent';
    if (!followup.response_received) return 'Pending';
    if (followup.response_type === 'yes') return 'Confirmed';
    return 'Declined';
  };

  const getStatusColor = (followup) => {
    if (!followup.reminder_sent) return T.textMuted;
    if (!followup.response_received) return '#c07000';
    if (followup.response_type === 'yes') return '#1a7a1a';
    return '#cc0000';
  };

  return (
    <div style={styles.patientCard}>
      <div className="patient-card-hover" style={styles.patientCardHeader} onClick={onToggle}>
        <div style={styles.patientCardLeft}>
          <div style={styles.patientAvatar}>
            {patient.name ? patient.name.charAt(0).toUpperCase() : '?'}
          </div>
          <div>
            <h3 style={styles.patientCardName}>{patient.name || 'Unknown Patient'}</h3>
            <div style={styles.patientMetrics}>
              <span style={styles.metric}><Calendar size={12} color={T.textMuted} />{patient.followups?.length || 0} follow-ups</span>
              <span style={styles.metric}><BookOpen size={12} color={T.textMuted} />{patient.education?.length || 0} interactions</span>
              <span style={styles.metric}><MessageSquare size={12} color={T.textMuted} />{patient.messages?.length || 0} messages</span>
            </div>
          </div>
        </div>

        <div style={styles.patientCardRight}>
          <div style={styles.statusBadges}>
            {pendingCount > 0 && (
              <span style={{ ...styles.badge, backgroundColor: T.bgTert, color: '#c07000', border: `1px solid #e0c040` }}>
                {pendingCount} pending
              </span>
            )}
            {confirmedCount > 0 && (
              <span style={{ ...styles.badge, backgroundColor: T.bgAlt, color: '#1a7a1a', border: `1px solid #b0d0b0` }}>
                {confirmedCount} confirmed
              </span>
            )}
          </div>

          <button className="msg-btn-hover" onClick={(e) => { e.stopPropagation(); onMessage(); }} style={styles.messageButton}>
            <MessageSquare size={15} color={T.bg} />
          </button>

          {isExpanded ? <ChevronUp size={18} color={T.textMuted} /> : <ChevronDown size={18} color={T.textMuted} />}
        </div>
      </div>

      {isExpanded && (
        <div style={styles.expandedContent}>
          {availableTabs.length > 0 && (
            <div style={styles.tabBar}>
              {availableTabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{ ...styles.tab, ...(activeTab === tab.id ? styles.activeTab : {}) }}
                  >
                    <Icon size={13} />
                    {tab.label} ({tab.count})
                  </button>
                );
              })}
            </div>
          )}

          <div style={styles.tabContent}>
            {activeTab === 'followups' && patient.followups?.map((followup, index) => (
              <div key={index} className="followup-card-hover" style={styles.followupCard}>
                <div style={styles.followupHeader}>
                  <div style={{ ...styles.followupStatus, color: getStatusColor(followup) }}>
                    {getStatusIcon(followup)}
                    <span>{getStatusText(followup)}</span>
                  </div>
                  <div style={styles.followupDates}>
                    {followup.followup_date && (
                      <span style={styles.dateItem}><Calendar size={12} color={T.textMuted} />Follow-up: {formatDateOnly(followup.followup_date)}</span>
                    )}
                    {(followup.reminded_at || followup.created_at) && (
                      <span style={styles.dateItem}><Clock size={12} color={T.textMuted} />Sent: {formatDate(followup.reminded_at || followup.created_at)}</span>
                    )}
                  </div>
                </div>
                <div style={styles.followupDetails}>
                  <div style={styles.detailItem}><FileText size={13} color={T.textMuted} /><span>Dr. {followup.doctor_name_used || 'Unknown'}</span></div>
                  {followup.reminder_type && (
                    <div style={styles.detailItem}><Bell size={13} color={T.textMuted} /><span>{followup.reminder_type.replace(/_/g, ' ')}</span></div>
                  )}
                </div>
                {followup.patient_response && (
                  <div style={styles.responseBox}>
                    <div style={styles.responseHeader}>
                      <MessageSquare size={12} color={T.textMuted} />
                      <span>Patient Response</span>
                      <span style={styles.responseTime}>{followup.response_time_formatted || formatDate(followup.response_time)}</span>
                    </div>
                    <p style={styles.responseText}>"{followup.patient_response.text || followup.patient_response}"</p>
                  </div>
                )}
              </div>
            ))}

            {activeTab === 'education' && patient.education?.map((record, index) => (
              <div key={index} style={styles.educationCard}>
                <div style={styles.educationHeader}>
                  <div style={styles.educationMeta}><Calendar size={13} color={T.textMuted} /><span>{formatDate(record.created_at)}</span></div>
                  {record.phone_number && (
                    <div style={styles.educationMeta}><Phone size={13} color={T.textMuted} /><span>{record.phone_number}</span></div>
                  )}
                </div>
                <div style={styles.questionBox}>
                  <span style={styles.questionLabel}>Question</span>
                  <p style={styles.questionText}>{record.question}</p>
                </div>
                <div style={styles.answerBox}>
                  <span style={styles.answerLabel}>Answer</span>
                  <p style={styles.answerText}>{record.answer}</p>
                </div>
              </div>
            ))}

            {activeTab === 'messages' && patient.messages?.map((message, index) => (
              <div key={index} className="followup-card-hover" style={styles.followupCard}>
                <div style={styles.followupHeader}>
                  <div style={{ ...styles.followupStatus, color: message.delivery_status === 'delivered' ? '#1a7a1a' : T.textMuted }}>
                    <MessageSquare size={14} color={message.delivery_status === 'delivered' ? '#1a7a1a' : T.textMuted} />
                    <span style={{ textTransform: 'capitalize' }}>{message.delivery_status || 'sent'}</span>
                  </div>
                  <div style={styles.followupDates}>
                    <span style={styles.dateItem}><Clock size={12} color={T.textMuted} />{formatDate(message.created_at)}</span>
                  </div>
                </div>
                <div style={styles.followupDetails}>
                  <div style={styles.detailItem}><FileText size={13} color={T.textMuted} /><span>Dr. {message.doctor_name || 'Unknown'}</span></div>
                  {message.phone_number && <div style={styles.detailItem}><Phone size={13} color={T.textMuted} /><span>{message.phone_number}</span></div>}
                  {message.message_sid && <div style={styles.detailItem}><FileText size={13} color={T.textMuted} /><span>ID: {message.message_sid.substring(0, 8)}...</span></div>}
                </div>
                <div style={styles.responseBox}>
                  <div style={styles.responseHeader}>
                    <MessageSquare size={12} color={T.textMuted} />
                    <span>Message Content</span>
                  </div>
                  <p style={styles.responseText}>"{message.message_content}"</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DoctorCommunicationDashboard;