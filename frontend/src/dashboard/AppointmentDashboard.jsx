import React, { useState, useEffect, useMemo } from "react";
import {
  Home, LogOut, Calendar, FileText, Users, Settings,
  UserPlus, MessageCircle, RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import DateWiseAppointmentDashboard from "./DateWiseAppointmentDashboard";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── THEME (matching DoctorDashboard) ───
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
  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
  },
};

const AppointmentDashboard1 = () => {
  const navigate = useNavigate();

  // ─── Get doctor_id from URL ───
  const getDoctorIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("doctor_id") || "";
  };

  const [doctorId] = useState(getDoctorIdFromUrl());
  const [activeView, setActiveView] = useState("communication");

  // ─── Doctor info ───
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");

  // ─── Dashboard state ───
  const [viewMode, setViewMode] = useState("appointments");
  const [doctorInfo, setDoctorInfo] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [followUpsRaw, setFollowUpsRaw] = useState([]);
  const [communications, setCommunications] = useState([]);
  const [educationRecords, setEducationRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Appointment filters ───
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDate, setFilterDate] = useState("");

  // ─── Audit filters ───
  const [auditSearch, setAuditSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [channelFilter, setChannelFilter] = useState("All");
  const [appointmentFilter, setAppointmentFilter] = useState("All");
  const [followupFilter, setFollowupFilter] = useState("All");

  // ─── Follow-up panel ───
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientFollowUps, setPatientFollowUps] = useState([]);
  const [showFollowUps, setShowFollowUps] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState(null);

  // ─── Fetch doctor details ───
  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doctor_id: doctorId }),
          }
        );
        const data = await res.json();
        if (data.status === "success") {
          setDoctorName(data.doctor_name);
          setDoctorSpeciality(data.doctor_speciality);
        }
      } catch {}
    })();
  }, [doctorId]);

  // ─── Fetch all dashboard data ───
  useEffect(() => {
    if (!doctorId) {
      setError("No doctor_id parameter found in URL");
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      try {
        setLoading(true);
        setError(null);

        const [apptRes, eduRes, followRes, doctorRes] = await Promise.all([
          fetch(`${API_BASE_URL}hms/users/data/whatsapp/appointments/doctor/${doctorId}`),
          fetch(`${API_BASE_URL}hms/users/data/whatsapp/education-records?doctor_id=${doctorId}`),
          fetch(`${API_BASE_URL}hms/users/data/whatsapp/follow-ups/${doctorId}`),
          fetch(`${API_BASE_URL}hms/users/doctors/get_doctor_speciality/${doctorId}`),
        ]);

        if (!apptRes.ok || !eduRes.ok || !followRes.ok || !doctorRes.ok)
          throw new Error("One or more APIs failed");

        const apptData = await apptRes.json();
        const eduData = await eduRes.json();
        const followData = await followRes.json();
        const doctorData = await doctorRes.json();

        const appointmentsData = apptData.records || apptData;
        const educationData = eduData.records || [];

        if (doctorData.status === "success") setDoctorInfo(doctorData);

        const transformedAppointments = appointmentsData.map((item, index) => ({
          _id: `appointment-${item._id || index}-${Date.now()}`,
          hms_id: item.hms_id || "N/A",
          patient_id: item.patient_id || item.hms_id || "N/A",
          doctor_id: item.doctor_id || doctorId,
          phone_number: item.phone_number || "N/A",
          appointment_id: item.appointment_id || `APT-${Date.now()}-${index}`,
          appointment_date: item.appointment_date || "N/A",
          appointment_time: item.appointment_time || "N/A",
          created_at: item.created_at || new Date().toISOString(),
          updated_at: item.updated_at || item.created_at || new Date().toISOString(),
          patient_name: item.patient_name || "Unknown Patient",
          source: item.source,
          metadata: item.metadata,
        }));

        setAppointments(transformedAppointments);
        setFollowUpsRaw(followData);
        setEducationRecords(educationData);

        const apptNormalized = transformedAppointments.map((a, i) => ({
          id: `appt-${i}`,
          timestamp: a.created_at,
          type: "Appointment Created",
          channel: a.source?.toLowerCase() === "elevenlabs" ? "Eleven Labs" : "WhatsApp",
          trigger: "Manual",
          patient: a.patient_name,
          patient_name: a.patient_name,
          hms_id: a.hms_id,
          appointment_id: a.appointment_id,
          appointment_status: "Created",
        }));

        const eduNormalized = educationData.map((e, i) => ({
          id: `edu-${i}`,
          timestamp: e.created_at,
          type: "WhatsApp Message",
          channel: "WhatsApp",
          trigger: "Manual",
          patient: e.patient_name,
          patient_name: e.patient_name,
          hms_id: e.hms_id,
          appointment_id: e.appointment_id,
          appointment_status: e.appointment_id ? "Created" : "Not Created",
        }));

        const followNormalized = followData.map((f, i) => {
          let status = "Pending";
          if (f.reminder_sent === true) status = "Sent";
          else if (f.reminder_sent === false && f.reminded === true) status = "Failed";

          const matchingAppointment = transformedAppointments.find(
            (a) => a.patient_id === f.patient_id || a.hms_id === f.patient_id
          );
          const patientName = f.patient_name || matchingAppointment?.patient_name || "Unknown Patient";

          return {
            id: `follow-${i}`,
            timestamp: f.reminded_at || f.created_at,
            type: "Follow-up Reminder",
            channel: "WhatsApp",
            trigger: "Automatic",
            patient: patientName,
            patient_name: patientName,
            hms_id: "",
            appointment_id: f.appointment_id || "no-appointment",
            followup_type: f.reminder_type,
            followup_date: f.followup_date,
            followup_status: status,
            appointment_status: "Linked",
          };
        });

        const merged = [...apptNormalized, ...eduNormalized, ...followNormalized];
        merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setCommunications(merged);
      } catch (err) {
        setError(`API Failed: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [doctorId]);

  // ─── Patient follow-up click ───
  const handlePatientClick = async (appointment) => {
    try {
      setSelectedPatient(appointment);
      setShowFollowUps(true);
      setFollowUpLoading(true);
      setFollowUpError(null);

      const patientIdentifier = appointment.patient_id || appointment.hms_id;

      const source = followUpsRaw.length > 0
        ? followUpsRaw
        : await fetch(`${API_BASE_URL}hms/users/data/whatsapp/follow-ups/${appointment.doctor_id}`)
            .then((r) => r.json());

      const mapped = source
        .filter((f) => f.patient_id === patientIdentifier)
        .map((item) => {
          let status = "Pending";
          if (item.reminder_sent === true) status = "Sent";
          else if (item.reminder_sent === false && item.reminded === true) status = "Failed";
          const followupDate = new Date(item.followup_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return {
            id: item._id,
            type: item.reminder_type || "follow-up",
            date: item.followup_date,
            status,
            isFuture: followupDate >= today,
            patient_response: item.patient_response,
            reminded: item.reminded,
            reminded_at: item.reminded_at,
            template_variables: item.template_variables,
            patient_name: item.patient_name || appointment.patient_name,
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      setPatientFollowUps(mapped);
    } catch (err) {
      setFollowUpError(`Follow-up API Failed: ${err.message}`);
      setPatientFollowUps([]);
    } finally {
      setFollowUpLoading(false);
    }
  };

  // ─── Stats ───
  const totalAppointments = appointments.length;
  const today = new Date().toISOString().split("T")[0];
  const todayAppointments = appointments.filter((a) => a.appointment_date === today).length;
  const uniquePatients = new Set(appointments.map((a) => a.patient_name)).size;

  // ─── Filtered appointments ───
  const filteredAppointments = appointments.filter((a) => {
    const matchesSearch =
      a.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.hms_id?.toString().includes(searchTerm);
    const matchesDate = !filterDate || a.appointment_date === filterDate;
    return matchesSearch && matchesDate;
  });

  // ─── Filtered audit ───
  const filteredAudit = useMemo(() => {
    return communications.filter((c) => {
      const date = new Date(c.timestamp);
      if (fromDate && date < new Date(fromDate)) return false;
      if (toDate && date > new Date(toDate)) return false;
      if (channelFilter !== "All" && c.channel !== channelFilter) return false;
      if (appointmentFilter !== "All" && c.appointment_status !== appointmentFilter) return false;
      if (followupFilter !== "All" && c.followup_status !== followupFilter) return false;
      if (auditSearch && !c.patient?.toLowerCase().includes(auditSearch.toLowerCase())) return false;
      return true;
    });
  }, [communications, auditSearch, fromDate, toDate, channelFilter, appointmentFilter, followupFilter]);

  const groupedAudit = useMemo(() => {
    const groups = {};
    filteredAudit.forEach((c) => {
      const day = new Date(c.timestamp).toISOString().split("T")[0];
      const apptKey = c.appointment_id || "no-appointment";
      if (!groups[day]) groups[day] = {};
      if (!groups[day][apptKey]) groups[day][apptKey] = [];
      groups[day][apptKey].push(c);
    });
    return groups;
  }, [filteredAudit]);

  // ─── Helpers ───
  const formatDate = (dateString) => {
    if (!dateString || dateString === "N/A") return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch { return "Invalid Date"; }
  };

  const formatFollowUpDate = (dateString) => {
    if (!dateString) return "No date";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
    } catch { return "Invalid Date"; }
  };

  const hasSource = (a) => a.hasOwnProperty("source") && a.source && a.source !== "N/A";

  const formatPlatformName = (a) => {
    if (!hasSource(a)) return "Not specified";
    const map = {
      whatsapp: "WhatsApp", web: "Web Portal", mobile: "Mobile App",
      clinic: "Clinic Portal", voice: "Voice Call", elevenlabs: "Voice Agent",
      chat: "Chat", email: "Email", sms: "SMS", unknown: "Unknown",
    };
    return map[a.source.toLowerCase()] || a.source.charAt(0).toUpperCase() + a.source.slice(1);
  };

  const getPlatformColor = (a) => {
    if (!hasSource(a)) return "bg-gray-50 text-gray-500 border-gray-200";
    return a.source.toLowerCase() === "whatsapp"
      ? "bg-white text-black border-black"
      : "bg-gray-50 text-gray-700 border-gray-300";
  };

  const getPlatformIcon = (a) => {
    if (!hasSource(a)) return <DefaultIcon />;
    switch (a.source.toLowerCase()) {
      case "whatsapp": return <WhatsAppIcon />;
      case "web": return <WebIcon />;
      case "voice": case "elevenlabs": return <VoiceIcon />;
      case "chat": return <ChatIcon />;
      case "email": return <EmailIcon />;
      default: return <ChatIcon />;
    }
  };

  // ─── Logout ───
  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}hms/users/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      navigate("/login");
    }
  };

  // ─── Nav sections (matching DoctorDashboard exactly) ───
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
        { label: "Communication View", icon: <MessageCircle size={14} />, action: () => navigate(`/appointment-dashboard1?doctor_id=${doctorId}`), key: "communication" },
        { label: "Communication Progression", icon: <Calendar size={14} />, action: () => navigate(`/doctor-communication-dashboard?doctor_id=${doctorId}`), key: "communicationProgression" },
      ],
    },
    {
      label: "Other",
      items: [
        { label: "Patient Registration", icon: <UserPlus size={14} />, action: () => navigate(`/register-patient?doctor_id=${doctorId}`) },
      ],
    },
  ];

  // ─── Render ───
  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }

        /* Tailwind-compatible utilities used in the dashboard content */
        .min-h-screen { min-height: 100vh; }
        .bg-white { background-color: #ffffff; }
        .flex { display: flex; }
        .items-center { align-items: center; }
        .items-start { align-items: flex-start; }
        .justify-center { justify-content: center; }
        .justify-between { justify-content: space-between; }
        .flex-col { flex-direction: column; }
        .text-center { text-align: center; }
        .text-black { color: #000000; }
        .text-white { color: #ffffff; }
        .text-gray-400 { color: #9ca3af; }
        .text-gray-500 { color: #6b7280; }
        .text-gray-600 { color: #4b5563; }
        .text-gray-700 { color: #374151; }
        .text-red-600 { color: #dc2626; }
        .text-red-500 { color: #ef4444; }
        .text-xs { font-size: 0.75rem; line-height: 1rem; }
        .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
        .text-lg { font-size: 1.125rem; line-height: 1.75rem; }
        .text-xl { font-size: 1.25rem; line-height: 1.75rem; }
        .text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
        .text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
        .font-light { font-weight: 300; }
        .font-light { font-weight: 300; }
        .tracking-tight { letter-spacing: -0.025em; }
        .tracking-wider { letter-spacing: 0.05em; }
        .uppercase { text-transform: uppercase; }
        .capitalize { text-transform: capitalize; }
        .italic { font-style: italic; }
        .p-4 { padding: 1rem; }
        .p-5 { padding: 1.25rem; }
        .p-6 { padding: 1.5rem; }
        .p-8 { padding: 2rem; }
        .p-12 { padding: 3rem; }
        .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
        .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
        .px-4 { padding-left: 1rem; padding-right: 1rem; }
        .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
        .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
        .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
        .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
        .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
        .py-12 { padding-top: 3rem; padding-bottom: 3rem; }
        .mb-1 { margin-bottom: 0.25rem; }
        .mb-2 { margin-bottom: 0.5rem; }
        .mb-3 { margin-bottom: 0.75rem; }
        .mb-4 { margin-bottom: 1rem; }
        .mb-6 { margin-bottom: 1.5rem; }
        .mb-8 { margin-bottom: 2rem; }
        .mt-1 { margin-top: 0.25rem; }
        .mt-2 { margin-top: 0.5rem; }
        .mt-4 { margin-top: 1rem; }
        .ml-1 { margin-left: 0.25rem; }
        .ml-2 { margin-left: 0.5rem; }
        .ml-4 { margin-left: 1rem; }
        .mr-3 { margin-right: 0.75rem; }
        .mx-auto { margin-left: auto; margin-right: auto; }
        .gap-2 { gap: 0.5rem; }
        .gap-3 { gap: 0.75rem; }
        .gap-4 { gap: 1rem; }
        .gap-6 { gap: 1.5rem; }
        .w-4 { width: 1rem; }
        .w-5 { width: 1.25rem; }
        .w-6 { width: 1.5rem; }
        .w-8 { width: 2rem; }
        .w-10 { width: 2.5rem; }
        .w-12 { width: 3rem; }
        .w-16 { width: 4rem; }
        .w-20 { width: 5rem; }
        .w-full { width: 100%; }
        .h-4 { height: 1rem; }
        .h-5 { height: 1.25rem; }
        .h-6 { height: 1.5rem; }
        .h-8 { height: 2rem; }
        .h-10 { height: 2.5rem; }
        .h-12 { height: 3rem; }
        .h-16 { height: 4rem; }
        .h-20 { height: 5rem; }
        .rounded-full { border-radius: 9999px; }
        .border { border-width: 1px; border-style: solid; }
        .border-t { border-top-width: 1px; border-top-style: solid; }
        .border-b { border-bottom-width: 1px; border-bottom-style: solid; }
        .border-gray-100 { border-color: #f3f4f6; }
        .border-gray-200 { border-color: #e5e7eb; }
        .border-gray-300 { border-color: #d1d5db; }
        .border-black { border-color: #000000; }
        .border-red-200 { border-color: #fecaca; }
        .bg-gray-50 { background-color: #f9fafb; }
        .bg-black { background-color: #000000; }
        .overflow-hidden { overflow: hidden; }
        .overflow-x-auto { overflow-x: auto; }
        .relative { position: relative; }
        .absolute { position: absolute; }
        .right-3 { right: 0.75rem; }
        .top-3\\.5 { top: 0.875rem; }
        .inset-0 { inset: 0; }
        .grid { display: grid; }
        .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
        .flex-1 { flex: 1 1 0%; }
        .flex-shrink-0 { flex-shrink: 0; }
        .inline-flex { display: inline-flex; }
        .inline-block { display: inline-block; }
        .block { display: block; }
        .divide-y > * + * { border-top-width: 1px; border-top-style: solid; }
        .divide-gray-100 > * + * { border-top-color: #f3f4f6; }
        .first\\:border-t-0:first-child { border-top-width: 0; }
        .pt-2 { padding-top: 0.5rem; }
        .border-t { border-top-width: 1px; }

        .transition-colors { transition-property: color, background-color, border-color; transition-duration: 200ms; }
        .transition-colors.duration-200 { transition-duration: 200ms; }
        .duration-150 { transition-duration: 150ms; }
        .hover\\:bg-gray-50:hover { background-color: #f9fafb; }
        .hover\\:border-black:hover { border-color: #000000; }
        .hover\\:bg-white:hover { background-color: #ffffff; }
        .hover\\:text-black:hover { color: #000000; }
        .hover\\:bg-gray-50:hover { background-color: #f9fafb; }
        .hover\\:text-black:hover { color: #000000; }
        .focus\\:outline-none:focus { outline: none; }
        .focus\\:border-black:focus { border-color: #000000; }

        .animate-spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .border-t-2 { border-top-width: 2px; }
        .border-b-2 { border-bottom-width: 2px; }
        .border-t-2.border-black { border-top-color: #000000; }

        @media (min-width: 768px) {
          .md\\:p-8 { padding: 2rem; }
          .md\\:text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
          .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .md\\:flex-row { flex-direction: row; }
        }
        @media (min-width: 1024px) {
          .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        input::placeholder { color: #9ca3af; font-weight: 300; }
        input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.4; }
        select option { background: white; color: #1f2937; }
        table { border-collapse: collapse; }
        .min-w-600 { min-width: 600px; }
        .w-full-table { width: 100%; }
      `}</style>

      {/* ═══════════════ SIDEBAR ═══════════════ */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <span style={S.brandName}>DoctorAssist.AI</span>
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorName}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const isActive = item.key && item.key === activeView;
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

        <div style={S.sidebarFooter}>
          <button className="da-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <div style={S.main}>
        {activeView === "dateAppointments" ? (
          <DateWiseAppointmentDashboard doctorId={doctorId} />
        ) : (
          /* ── Communication View (original dashboard content) ── */
          <div className="min-h-screen bg-white p-4 md:p-8 text-black">

            {/* HEADER */}
            <div className="flex justify-between items-center mb-8">
              <div>
                {doctorInfo && (
                  <div className="text-gray-500 font-light mt-1">
                    Dr. {doctorInfo.doctor_name} — {doctorInfo.specialization}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setViewMode("appointments")}
                  className={`px-4 py-2 text-sm font-light transition-colors ${
                    viewMode === "appointments"
                      ? "bg-black text-white"
                      : "bg-white text-gray-600 hover:text-black border border-gray-200"
                  }`}
                >
                  Appointments
                </button>
                <button
                  onClick={() => setViewMode("audit")}
                  className={`px-4 py-2 text-sm font-light transition-colors ${
                    viewMode === "audit"
                      ? "bg-black text-white"
                      : "bg-white text-gray-600 hover:text-black border border-gray-200"
                  }`}
                >
                  Communication Audit
                </button>
                <button
                  onClick={() => { setLoading(true); window.location.reload(); }}
                  className="px-4 py-2 text-sm border border-gray-200 bg-white text-gray-600 font-light hover:border-black transition-colors flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
            </div>

            {/* LOADING */}
            {loading && (
              <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black mx-auto mb-4"></div>
                  <p className="text-gray-700 text-lg font-light">Loading Dashboard...</p>
                  <p className="text-gray-400 text-sm mt-2 font-light">Doctor ID: {doctorId}</p>
                </div>
              </div>
            )}

            {/* ERROR */}
            {!loading && error && (
              <div className="border border-gray-200 p-8 max-w-md text-center mx-auto">
                <h2 className="text-xl font-light text-black mb-4">Error Loading Data</h2>
                <p className="text-gray-500 font-light mb-4">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-3 border border-black bg-black text-white text-sm font-light hover:bg-white hover:text-black transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* ── APPOINTMENTS VIEW ── */}
            {!loading && !error && viewMode === "appointments" && (
              <>
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  {[
                    { label: "Total Appointments", value: totalAppointments, icon: <CalendarIcon /> },
                    { label: "Today's Appointments", value: todayAppointments, icon: <ClockIcon /> },
                    { label: "Unique Patients", value: uniquePatients, icon: <UserIcon /> },
                  ].map(({ label, value, icon }) => (
                    <div key={label} className="border border-gray-200 p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider font-light">{label}</p>
                          <p className="text-3xl font-light text-black mt-2">{value}</p>
                        </div>
                        <div className="w-12 h-12 border border-gray-200 flex items-center justify-center">
                          {icon}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Filters */}
                <div className="border border-gray-200 p-6 mb-8">
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-light text-gray-500 uppercase tracking-wider mb-2">
                        Search Patient
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search by patient name or HMS ID..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          style={{ width: "100%", padding: "0.75rem 1rem", paddingRight: "2.5rem", border: "1px solid #e5e7eb", fontSize: "0.875rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, outline: "none", color: "#374151" }}
                        />
                        <svg className="absolute right-3 top-3.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-light text-gray-500 uppercase tracking-wider mb-2">
                        Filter by Date
                      </label>
                      <input
                        type="date"
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        style={{ padding: "0.75rem 1rem", border: "1px solid #e5e7eb", fontSize: "0.875rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, outline: "none", color: "#374151" }}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => { setSearchTerm(""); setFilterDate(""); }}
                        className="px-6 py-3 border border-gray-200 bg-white text-gray-700 text-sm font-light hover:border-black transition-colors"
                      >
                        Clear Filters
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div className="border border-gray-200 overflow-hidden mb-8">
                  <div className="p-6 border-b border-gray-200">
                    <div className="flex justify-between items-center">
                      <div>
                        <h2 className="text-lg font-light text-black">Appointment List</h2>
                        <p className="text-gray-400 text-sm font-light mt-1">
                          Showing {filteredAppointments.length} of {appointments.length} appointments
                        </p>
                      </div>
                    </div>
                  </div>

                  {filteredAppointments.length === 0 ? (
                    <div className="p-12 text-center">
                      <div className="w-20 h-20 rounded-full border border-gray-200 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-light text-black mb-2">No appointments found</h3>
                      <p className="text-gray-400 font-light">
                        {searchTerm || filterDate ? "Try changing your search or filter criteria" : "No appointments available for this doctor"}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px" }}>
                        <thead style={{ backgroundColor: "#f9fafb" }}>
                          <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                            {["Patient", "HMS ID", "Date", "Time", "Created", "Platform"].map((h) => (
                              <th key={h} style={{ padding: "1rem 1.5rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 300, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280", whiteSpace: "nowrap" }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAppointments.map((a) => (
                            <tr key={a._id} style={{ borderBottom: "1px solid #f3f4f6", transition: "background 0.15s" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#f9fafb"}
                              onMouseLeave={e => e.currentTarget.style.background = ""}
                            >
                              <td style={{ padding: "1rem 1.5rem" }}>
                                <div className="flex items-center">
                                  <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "9999px", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                    <span style={{ color: "#000", fontWeight: 300 }}>{a.patient_name.charAt(0)}</span>
                                  </div>
                                  <div className="ml-4">
                                    <div
                                      onClick={() => handlePatientClick(a)}
                                      style={{ fontSize: "0.875rem", fontWeight: 300, color: "#000", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px" }}
                                    >
                                      {a.patient_name}
                                    </div>
                                    <div style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: 300 }}>{a.phone_number}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: "1rem 1.5rem" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", padding: "0.25rem 0.75rem", fontSize: "0.875rem", fontWeight: 300, border: "1px solid #e5e7eb", color: "#374151" }}>
                                  {a.hms_id}
                                </span>
                              </td>
                              <td style={{ padding: "1rem 1.5rem" }}>
                                <div style={{ fontSize: "0.875rem", color: "#374151", fontWeight: 300 }}>{a.appointment_date}</div>
                                <div style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: 300 }}>
                                  {a.appointment_date !== "N/A" ? new Date(a.appointment_date).toLocaleDateString("en-US", { weekday: "long" }) : "N/A"}
                                </div>
                              </td>
                              <td style={{ padding: "1rem 1.5rem" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", padding: "0.25rem 0.75rem", fontSize: "0.875rem", fontWeight: 300, border: "1px solid #e5e7eb", color: "#374151" }}>
                                  {a.appointment_time}
                                </span>
                              </td>
                              <td style={{ padding: "1rem 1.5rem", fontSize: "0.875rem", color: "#6b7280", fontWeight: 300 }}>
                                {formatDate(a.created_at)}
                              </td>
                              <td style={{ padding: "1rem 1.5rem" }}>
                                <div className={`inline-flex items-center px-3 py-1 text-sm font-light border ${getPlatformColor(a)}`}>
                                  {getPlatformIcon(a)}
                                  {formatPlatformName(a)}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Follow-up panel */}
                {showFollowUps && selectedPatient && (
                  <div className="border border-gray-200 p-6 mb-8">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h2 className="text-xl font-light text-black mb-1">
                          Follow-ups for {selectedPatient.patient_name}
                        </h2>
                        <p className="text-gray-500 text-sm font-light">
                          HMS ID: {selectedPatient.hms_id} • Phone: {selectedPatient.phone_number}
                        </p>
                      </div>
                      <button
                        onClick={() => { setShowFollowUps(false); setSelectedPatient(null); setPatientFollowUps([]); setFollowUpError(null); }}
                        style={{ padding: "0.5rem", background: "none", border: "none", cursor: "pointer" }}
                      >
                        <svg style={{ width: "1.25rem", height: "1.25rem", color: "#9ca3af" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {followUpLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black mr-3"></div>
                        <p className="text-gray-500 font-light">Loading follow-ups...</p>
                      </div>
                    ) : patientFollowUps.length === 0 ? (
                      <div className="text-center py-12">
                        <h3 className="text-lg font-light text-black mb-2">No follow-ups found</h3>
                        <p className="text-gray-400 font-light">This patient has no scheduled follow-ups</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {patientFollowUps.map((f) => (
                          <div key={f.id} className="border border-gray-200 p-5 hover:border-black transition-colors">
                            <div className="flex justify-between items-start mb-3">
                              <span style={{
                                padding: "0.25rem 0.75rem", fontSize: "0.75rem", fontWeight: 300, border: "1px solid",
                                borderColor: f.status === "Sent" ? "#000" : f.status === "Pending" ? "#d1d5db" : "#fecaca",
                                color: f.status === "Sent" ? "#000" : f.status === "Pending" ? "#6b7280" : "#dc2626",
                              }}>
                                {f.status}
                              </span>
                              {f.isFuture && (
                                <span className="text-xs text-gray-500 border border-gray-200 px-3 py-1 font-light">Future</span>
                              )}
                            </div>
                            <p className="text-black font-light mb-2 capitalize">{f.type?.replace(/_/g, " ") || "Follow-up"}</p>
                            <div className="flex items-center text-gray-500 text-sm font-light mb-2">
                              <svg style={{ width: "1rem", height: "1rem", marginRight: "0.375rem", color: "#9ca3af" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              {f.patient_name}
                            </div>
                            <div className="flex items-center text-gray-500 text-sm font-light">
                              <svg style={{ width: "1rem", height: "1rem", marginRight: "0.375rem", color: "#9ca3af" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {formatFollowUpDate(f.date)}
                            </div>
                            {f.patient_response && f.patient_response.will_attend !== null && (
                              <div className="mt-2 pt-2 border-t border-gray-100">
                                <span style={{ fontSize: "0.75rem", fontWeight: 300, color: f.patient_response.will_attend ? "#000" : "#6b7280" }}>
                                  {f.patient_response.will_attend ? "Will Attend" : "Will Not Attend"}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {followUpError && (
                      <div className="mt-4 p-4 bg-gray-50 border border-gray-200">
                        <p className="text-red-600 text-sm font-light">{followUpError}</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── AUDIT VIEW ── */}
            {!loading && !error && viewMode === "audit" && (
              <>
                <div className="border border-gray-200 p-6 mb-8">
                  <h2 className="text-lg font-light text-black mb-4">Filter Audit Logs</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      { label: "Search Patient", value: auditSearch, onChange: setAuditSearch, type: "text", placeholder: "Patient name..." },
                      { label: "From Date", value: fromDate, onChange: setFromDate, type: "date" },
                      { label: "To Date", value: toDate, onChange: setToDate, type: "date" },
                    ].map(({ label, value, onChange, type, placeholder }) => (
                      <div key={label}>
                        <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 300, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
                          {label}
                        </label>
                        <input
                          type={type}
                          placeholder={placeholder}
                          value={value}
                          onChange={(e) => onChange(e.target.value)}
                          style={{ width: "100%", padding: "0.75rem 1rem", border: "1px solid #e5e7eb", fontSize: "0.875rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, outline: "none", color: "#374151", boxSizing: "border-box" }}
                        />
                      </div>
                    ))}
                    {[
                      { label: "Channel", value: channelFilter, onChange: setChannelFilter, options: ["All", "WhatsApp", "Eleven Labs"] },
                      { label: "Appointment Status", value: appointmentFilter, onChange: setAppointmentFilter, options: ["All", "Created", "Not Created", "Linked"] },
                      { label: "Follow-up Status", value: followupFilter, onChange: setFollowupFilter, options: ["All", "Sent", "Pending", "Failed"] },
                    ].map(({ label, value, onChange, options }) => (
                      <div key={label}>
                        <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 300, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
                          {label}
                        </label>
                        <select
                          value={value}
                          onChange={(e) => onChange(e.target.value)}
                          style={{ width: "100%", padding: "0.75rem 1rem", border: "1px solid #e5e7eb", fontSize: "0.875rem", fontFamily: "'Open Sans', sans-serif", fontWeight: 300, outline: "none", color: "#374151", backgroundColor: "#fff", boxSizing: "border-box" }}
                        >
                          {options.map((o) => <option key={o} value={o}>{o === "All" ? `All ${label.split(" ")[0]}s` : o}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setAuditSearch(""); setFromDate(""); setToDate(""); setChannelFilter("All"); setAppointmentFilter("All"); setFollowupFilter("All"); }}
                    className="mt-4 px-6 py-3 border border-gray-200 bg-white text-gray-700 text-sm font-light hover:border-black transition-colors"
                  >
                    Clear All Filters
                  </button>
                </div>

                {Object.keys(groupedAudit).length === 0 ? (
                  <div className="border border-gray-200 p-12 text-center">
                    <h3 className="text-lg font-light text-black mb-2">No audit logs found</h3>
                    <p className="text-gray-400 font-light">Try changing your filter criteria</p>
                  </div>
                ) : (
                  Object.keys(groupedAudit)
                    .sort((a, b) => new Date(b) - new Date(a))
                    .map((date) => (
                      <div key={date} className="mb-6">
                        <h2 className="text-lg font-light text-black mb-3">
                          {new Date(date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                        </h2>
                        {Object.keys(groupedAudit[date]).map((apptId) => (
                          <div key={apptId} className="mb-4 border border-gray-200 p-4">
                            {apptId !== "no-appointment" && (
                              <div className="text-black text-sm font-light mb-3">Appointment ID: {apptId}</div>
                            )}
                            {groupedAudit[date][apptId].map((c) => (
                              <div key={c.id} style={{ borderTop: "1px solid #f3f4f6", padding: "0.75rem 0" }} className="first:border-t-0">
                                <div className="flex items-center justify-between">
                                  <span style={{
                                    padding: "0.25rem 0.5rem", fontSize: "0.75rem", fontWeight: 300, border: "1px solid",
                                    borderColor: c.type === "Appointment Created" ? "#000" : c.type === "Follow-up Reminder" ? "#d1d5db" : "#e5e7eb",
                                    color: c.type === "Appointment Created" ? "#000" : c.type === "Follow-up Reminder" ? "#4b5563" : "#6b7280",
                                  }}>
                                    {c.type}
                                  </span>
                                  <span className="text-xs text-gray-400 font-light">
                                    {new Date(c.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div className="mt-2 text-sm text-gray-700 font-light">
                                  Patient: {c.patient_name || c.patient} {c.hms_id && `(${c.hms_id})`}
                                </div>
                                <div className="mt-1 text-xs text-gray-400 font-light">
                                  Channel: {c.channel} • Trigger: {c.trigger}
                                </div>
                                {c.followup_type && (
                                  <div className="mt-1 text-xs font-light">
                                    <span className="text-gray-500">{c.followup_type} — </span>
                                    <span style={{ color: c.followup_status === "Sent" ? "#000" : c.followup_status === "Pending" ? "#6b7280" : "#ef4444" }}>
                                      {c.followup_status}
                                    </span>
                                    <span className="text-gray-400 ml-2">
                                      • Scheduled: {new Date(c.followup_date).toLocaleString()}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── SVG Icon helpers ───
const CalendarIcon = () => (
  <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const ClockIcon = () => (
  <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const UserIcon = () => (
  <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);
const DefaultIcon = () => (
  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636L16.95 7.05M18.364 18.364L16.95 16.95M21 12h-2M4 12H2M7.05 7.05L5.636 5.636M7.05 16.95L5.636 18.364M12 4V2M12 22v-2" />
  </svg>
);
const WhatsAppIcon = () => (
  <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.06.55 4.08 1.6 5.86L2 22l4.32-1.65c1.71.93 3.66 1.43 5.72 1.43 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm.01 18.05c-1.7 0-3.37-.45-4.83-1.3l-.35-.2-2.56.98.99-2.52-.22-.36c-.91-1.48-1.4-3.2-1.4-4.97 0-4.55 3.71-8.26 8.27-8.26 4.55 0 8.26 3.71 8.26 8.26 0 4.56-3.71 8.27-8.26 8.27z"/>
    <path d="M16.95 14.03c-.27-.14-1.6-.79-1.85-.88-.25-.09-.44-.14-.62.14-.18.28-.72.88-.88 1.06-.16.18-.33.2-.6.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.58-1.5-1.85-.16-.27-.02-.42.12-.55.13-.12.27-.32.4-.48.14-.16.18-.28.27-.46.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.06-.23-.56-.46-.48-.62-.49-.16-.01-.35-.01-.54-.01-.18 0-.48.07-.73.34-.25.28-.95.93-.95 2.27 0 1.34.98 2.63 1.12 2.81.14.18 1.88 2.94 4.66 4.03 2.78 1.09 2.78.73 3.28.68.5-.05 1.6-.65 1.83-1.28.23-.63.23-1.17.16-1.28-.07-.11-.25-.18-.52-.32z"/>
  </svg>
);
const WebIcon = () => (
  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4-3-9s1.34-9 3-9" />
  </svg>
);
const VoiceIcon = () => (
  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>
);
const ChatIcon = () => (
  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);
const EmailIcon = () => (
  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

export default AppointmentDashboard1;