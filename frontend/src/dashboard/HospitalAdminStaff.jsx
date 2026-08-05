import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Stethoscope,
  Activity,
  Shield,
  Search,
  X,
  Mail,
  Phone,
  Edit,
  Lock,
  Unlock,
  User,
  UserCog,
  Briefcase,
  AlertCircle,
  CheckCircle,
  Loader2,
  Eye,
  EyeOff,
  Hospital,
  Save,
  Home,
  Calendar,
  Building,
  Clipboard,
  BarChart3,
  Settings,
  Bell,
  LogOut,
  ChevronRight,
  FileText,
  UserPlus
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  accent: "#000000",
};

const SIDEBAR_WIDTH = "248px";

/* ─── STYLES ─── */
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

  profileRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "0.75rem",
    padding: "0.75rem",
    background: T.bgAlt,
    border: `1px solid ${T.border}`,
  },

  profileAvatar: {
    width: "32px",
    height: "32px",
    background: T.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: "2px",
  },

  profileName: {
    fontWeight: 400,
    margin: 0,
    fontSize: "0.78rem",
    color: T.text,
  },

  profileId: {
    fontSize: "0.65rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
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

  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0.45rem 0.875rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    maxWidth: "260px",
    flex: 1,
  },

  searchInput: {
    border: "none",
    background: "transparent",
    outline: "none",
    flex: 1,
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    minWidth: 0,
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

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1rem",
    marginBottom: "1.5rem",
  },

  statCard: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "1rem",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },

  statIconWrapper: (color) => ({
    width: "48px",
    height: "48px",
    background: T.bgAlt,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: color,
  }),

  statDetails: {
    flex: 1,
  },

  statLabel: {
    fontSize: "0.65rem",
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },

  statValue: {
    fontSize: "1.5rem",
    fontWeight: 400,
    color: T.text,
  },

  filtersCard: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "1rem",
    marginBottom: "1.5rem",
  },

  filtersHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "1rem",
  },

  tabsContainer: {
    display: "flex",
    gap: "0.25rem",
    background: T.bgAlt,
    padding: "0.25rem",
  },

  tab: (isActive) => ({
    padding: "0.5rem 1rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    fontFamily: "'Open Sans', sans-serif",
    background: isActive ? T.bg : "transparent",
    border: isActive ? `1px solid ${T.border}` : "none",
    color: isActive ? T.text : T.textMuted,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    transition: "all 0.15s",
  }),

  filterActions: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },

  select: {
    padding: "0.5rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    color: T.text,
    cursor: "pointer",
    minWidth: "200px",
  },

  searchWrapper: {
    position: "relative",
  },

  searchIcon: {
    position: "absolute",
    left: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    color: T.textMuted,
  },

  searchInputField: {
    padding: "0.5rem 0.75rem 0.5rem 2rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    color: T.text,
    width: "250px",
    outline: "none",
  },

  clearSearch: {
    position: "absolute",
    right: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: T.textMuted,
    display: "flex",
    alignItems: "center",
  },

  activeFilters: {
    display: "flex",
    gap: "0.5rem",
    marginTop: "1rem",
    flexWrap: "wrap",
  },

  filterBadge: {
    background: T.bgAlt,
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    border: `1px solid ${T.border}`,
  },

  resultsInfo: {
    fontSize: "0.7rem",
    color: T.textMuted,
    marginBottom: "1rem",
  },

  tableCard: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    overflowX: "auto",
  },

  usersTable: {
    width: "100%",
    borderCollapse: "collapse",
  },

  th: {
    textAlign: "left",
    padding: "0.75rem 1rem",
    fontSize: "0.65rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
  },

  td: {
    padding: "1rem",
    fontSize: "0.75rem",
    borderBottom: `1px solid ${T.border}`,
    color: T.textSec,
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

  modalCard: {
    background: T.bg,
    width: "600px",
    maxWidth: "95%",
    maxHeight: "90vh",
    overflow: "hidden",
    border: `1px solid ${T.border}`,
  },

  modalHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: T.bg,
  },

  modalTitle: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },

  modalIcon: {
    color: T.text,
  },

  modalTitleText: {
    fontSize: "1rem",
    fontWeight: 400,
    margin: 0,
    color: T.text,
  },

  modalClose: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: T.textMuted,
    display: "flex",
    alignItems: "center",
    padding: "0.25rem",
  },

  modalBody: {
    padding: "1.5rem",
    maxHeight: "calc(90vh - 120px)",
    overflowY: "auto",
  },

  modalFooter: {
    padding: "1rem 1.5rem",
    borderTop: `1px solid ${T.border}`,
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem",
    background: T.bgAlt,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1rem",
  },

  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },

  formGroupFull: {
    gridColumn: "span 2",
  },

  formLabel: {
    fontSize: "0.65rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
  },

  formInput: {
    padding: "0.5rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    color: T.text,
    outline: "none",
  },

  formSelect: {
    padding: "0.5rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    color: T.text,
    cursor: "pointer",
  },

  passwordWrapper: {
    position: "relative",
  },

  passwordToggle: {
    position: "absolute",
    right: "0.5rem",
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: T.textMuted,
  },

  btnPrimary: {
    padding: "0.5rem 1rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.7rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },

  btnSecondary: {
    padding: "0.5rem 1rem",
    background: "transparent",
    color: T.textSec,
    border: `1px solid ${T.border}`,
    fontSize: "0.7rem",
    fontFamily: "'Open Sans', sans-serif",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },

  actionBtn: {
    width: "28px",
    height: "28px",
    background: "transparent",
    border: `1px solid ${T.border}`,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: T.textSec,
    marginRight: "0.25rem",
  },

  statusBadge: (status) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.25rem 0.5rem",
    fontSize: "0.65rem",
    background: status === 'active' ? T.bgAlt : T.bgTert,
    color: status === 'active' ? T.text : T.textMuted,
    border: `1px solid ${T.border}`,
  }),

  roleTag: (role) => ({
    display: "inline-block",
    padding: "0.2rem 0.4rem",
    fontSize: "0.6rem",
    background: T.bgAlt,
    color: T.textSec,
    border: `1px solid ${T.border}`,
    marginRight: "0.25rem",
  }),

  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "400px",
    gap: "1rem",
  },

  spinner: {
    animation: "spin 1s linear infinite",
  },

  errorContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "400px",
  },

  errorCard: {
    textAlign: "center",
    padding: "2rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
  },
};

const HospitalAdminStaff = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedDoctor, setSelectedDoctor] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const specializations = [
    "General Medicine",
    "Oncology",
    "Cardiology",
    "Pulmonology",
    "Endocrinology",
    "Gastroenterology",
    "Nephrology",
  ];

  const nurseRoles = [
    "nurse",
    "senior",
    "head"
  ];

  const getHospitalIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('hospital_id');
  };

  const hospitalId = getHospitalIdFromUrl();

  // Navigation handlers
  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" }
      });
      if (response.ok) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleAddDoctor = () => {
    if (!hospitalId) return;
    navigate(`/register-doctor?hospital_id=${hospitalId}`);
  };

  const handleAddNurse = () => {
    if (!hospitalId) return;
    navigate(`/nurse-register?hospital_id=${hospitalId}`);
  };

  // const handleReportRuleSettings = () => {
  //   if (!hospitalId) return;
  //   navigate(`/report-rule-settings?hospital_id=${hospitalId}`);
  // };

  const handleAddExcel = () => {
    if (!hospitalId) return;
    navigate(`/upload-excel?hospital_id=${hospitalId}`);
  };

  const handleDashboard = () => {
    if (!hospitalId) return;
    navigate(`/hospital-dashboard?hospital_id=${hospitalId}`);
  };

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: handleDashboard },
        // { label: "Patients", icon: <Users size={14} />, action: () => {} },
        // { label: "Appointments", icon: <Calendar size={14} />, action: () => {} },
        // { label: "Reports & Analytics", icon: <BarChart3 size={14} />, action: () => {} },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, action: handleAddDoctor },
        { label: "Add Nurse", icon: <UserPlus size={14} />, action: handleAddNurse },
        { label: "Add Doctor via Excel", icon: <FileText size={14} />, action: handleAddExcel },
        { label: "Manage Staff", icon: <Users size={14} />, action: () => {}, active: true },
        // { label: "Departments", icon: <Building size={14} />, action: () => {} },
      ],
    },
    // {
    //   label: "Settings",
    //   items: [
    //     { label: "ReportRule Settings", icon: <Clipboard size={14} />, action: handleReportRuleSettings },
    //     // { label: "Settings", icon: <Settings size={14} />, action: () => {} },
    //   ],
    // },
  ];

  useEffect(() => {
    const fetchData = async () => {
      if (!hospitalId) {
        setError('Hospital ID not found in URL');
        setLoading(false);
        return;
      }

      setLoading(true);
      
      let nursesData = [];
      let doctorsData = [];
      let hasNurses = false;
      let hasDoctors = false;

      try {
        try {
          const nursesResponse = await fetch(
            `${API_BASE_URL}hms/users/data/context/get_nurses_by_hospital/${hospitalId}`
          );
          if (nursesResponse.ok) {
            nursesData = await nursesResponse.json();
            hasNurses = true;
          }
        } catch (err) {
          console.error('Error fetching nurses:', err);
        }

        try {
          const doctorsResponse = await fetch(
            `${API_BASE_URL}hms/users/data/context/get_doctors_by_hospital/${hospitalId}`
          );
          if (doctorsResponse.ok) {
            doctorsData = await doctorsResponse.json();
            hasDoctors = true;
          }
        } catch (err) {
          console.error('Error fetching doctors:', err);
        }

        if (hasDoctors) {
          setDoctors(doctorsData);

          const doctorMap = {};
          doctorsData.forEach(doctor => {
            doctorMap[doctor.sys_user_id] = doctor;
          });

          const combinedUsers = [];

          combinedUsers.push(...doctorsData.map(doctor => {
            let status = 'active';
            if (doctor.is_blocked === true || doctor.blocked === true || doctor.status === 'blocked' || doctor.is_blocked === 1 || doctor.blocked === 1) {
              status = 'blocked';
            }
            return {
              ...doctor,
              role: 'doctor',
              status: status,
              is_blocked: status === 'blocked',
              display_specialty: doctor.specialization || 'Specialty not specified'
            };
          }));

          if (hasNurses) {
            combinedUsers.push(...nursesData.map(nurse => {
              const assignedDoctor = nurse.doctor_id ? doctorMap[nurse.doctor_id] : null;
              let status = 'active';
              if (nurse.is_blocked === true || nurse.blocked === true || nurse.status === 'blocked' || nurse.is_blocked === 1 || nurse.blocked === 1) {
                status = 'blocked';
              }
              return {
                ...nurse,
                role: 'nurse',
                status: status,
                is_blocked: status === 'blocked',
                doctor_details: assignedDoctor,
                doctor_specialty: assignedDoctor ? assignedDoctor.specialization : null,
                doctor_name: assignedDoctor ? assignedDoctor.name : null,
                display_specialty: assignedDoctor
                  ? `Dr. ${assignedDoctor.name} (${assignedDoctor.specialization || 'No specialty'})`
                  : 'Unassigned',
                nurse_role: nurse.role || 'nurse'
              };
            }));
          }

          setUsers(combinedUsers);
          setError(null);
        } else {
          setError('Unable to load staff data. Please try again later.');
        }
      } catch (err) {
        setError('Failed to fetch data. Please try again.');
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [hospitalId]);

  const handleBlockToggle = async (userId, currentStatus) => {
    setActionLoading(prev => ({ ...prev, [userId]: true }));

    try {
      const endpoint = currentStatus === 'active'
        ? `${API_BASE_URL}hms/users/data/context/block_user/${userId}`
        : `${API_BASE_URL}hms/users/data/context/activate_user/${userId}`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to ${currentStatus === 'active' ? 'block' : 'activate'} user`);
      }

      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.sys_user_id === userId
            ? { 
                ...user, 
                status: user.status === 'active' ? 'blocked' : 'active',
                is_blocked: user.status === 'active'
              }
            : user
        )
      );
    } catch (error) {
      console.error('Error toggling user status:', error);
      alert(`Failed to ${currentStatus === 'active' ? 'block' : 'activate'} user. Please try again.`);
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleEdit = (user) => {
    setEditingUser({
      ...user,
      originalValues: {
        name: user.name,
        username: user.username,
        email: user.email,
        phone_number: user.phone_number,
        specialization: user.specialization,
        doctor_id: user.doctor_id,
        nurse_role: user.nurse_role
      }
    });
    setPasswordValue('');
    setConfirmPassword('');
    setPasswordError('');
    setUpdateSuccess(false);
    setUpdateError('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setShowEditModal(true);
  };

  const validatePassword = () => {
    if (passwordValue || confirmPassword) {
      if (passwordValue !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return false;
      }
      if (passwordValue.length < 6) {
        setPasswordError('Password must be at least 6 characters long');
        return false;
      }
    }
    setPasswordError('');
    return true;
  };

  const prepareUpdatePayload = () => {
    if (!editingUser) return null;

    const payload = {
      sys_user_id: editingUser.sys_user_id
    };

    if (editingUser.name !== editingUser.originalValues.name) {
      payload.full_name = editingUser.name;
    }

    if (editingUser.username !== editingUser.originalValues.username) {
      payload.username = editingUser.username;
    }

    if (editingUser.email !== editingUser.originalValues.email) {
      payload.email = editingUser.email;
    }

    if (editingUser.phone_number !== editingUser.originalValues.phone_number) {
      payload.phone_number = editingUser.phone_number;
    }

    if (passwordValue && validatePassword()) {
      payload.password = passwordValue;
    }

    if (editingUser.role === 'doctor') {
      if (editingUser.specialization !== editingUser.originalValues.specialization) {
        payload.specialization = editingUser.specialization;
      }
    } else if (editingUser.role === 'nurse') {
      if (editingUser.doctor_id !== editingUser.originalValues.doctor_id) {
        payload.doctor_id = editingUser.doctor_id;
      }
      if (editingUser.nurse_role !== editingUser.originalValues.nurse_role) {
        payload.role = editingUser.nurse_role;
      }
    }

    return payload;
  };

  const handleSaveEdit = async () => {
    if (passwordValue || confirmPassword) {
      if (!validatePassword()) {
        return;
      }
    }

    if (!editingUser) return;

    const payload = prepareUpdatePayload();

    if (Object.keys(payload).length === 1) {
      setShowEditModal(false);
      setEditingUser(null);
      return;
    }

    setSaveLoading(true);
    setUpdateError('');

    try {
      const endpoint = editingUser.role === 'doctor' 
        ? `${API_BASE_URL}hms/users/data/context/update-doctor-info`
        : `${API_BASE_URL}hms/users/data/context/update-nurse-info`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || 'Failed to update user information');
      }

      const updatedData = await response.json();

      setUsers(prevUsers =>
        prevUsers.map(user => {
          if (user.sys_user_id === editingUser.sys_user_id) {
            const updatedUser = { ...user };

            if (payload.full_name) updatedUser.name = payload.full_name;
            if (payload.username) updatedUser.username = payload.username;
            if (payload.email) updatedUser.email = payload.email;
            if (payload.phone_number) updatedUser.phone_number = payload.phone_number;

            if (editingUser.role === 'doctor') {
              if (payload.specialization) {
                updatedUser.specialization = payload.specialization;
                updatedUser.display_specialty = payload.specialization || 'Specialty not specified';
              }
            } else if (editingUser.role === 'nurse') {
              if (payload.doctor_id !== undefined) {
                const assignedDoctor = doctors.find(d => d.sys_user_id === payload.doctor_id);
                updatedUser.doctor_id = payload.doctor_id;
                updatedUser.doctor_details = assignedDoctor;
                updatedUser.doctor_name = assignedDoctor?.name;
                updatedUser.doctor_specialty = assignedDoctor?.specialization;
                updatedUser.display_specialty = assignedDoctor
                  ? `Dr. ${assignedDoctor.name} (${assignedDoctor.specialization || 'No specialty'})`
                  : 'Unassigned';
              }
              if (payload.role) {
                updatedUser.nurse_role = payload.role;
              }
            }

            return updatedUser;
          }
          return user;
        })
      );

      setUpdateSuccess(true);

      setTimeout(() => {
        setShowEditModal(false);
        setEditingUser(null);
        setPasswordValue('');
        setConfirmPassword('');
        setUpdateSuccess(false);
      }, 1500);

    } catch (error) {
      console.error('Error updating user:', error);
      setUpdateError(error.message || 'Failed to update user. Please try again.');
    } finally {
      setSaveLoading(false);
    }
  };

  const getFilteredUsers = () => {
    let filtered = users;

    if (activeTab === 'doctors') {
      filtered = filtered.filter(user => user.role === 'doctor');
    } else if (activeTab === 'nurses') {
      filtered = filtered.filter(user => user.role === 'nurse');
    }

    if (selectedDoctor !== 'all' && activeTab === 'nurses') {
      filtered = filtered.filter(user =>
        user.role === 'nurse' && user.doctor_id === selectedDoctor
      );
    }

    if (searchTerm) {
      filtered = filtered.filter(user =>
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.display_specialty?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.role === 'nurse' && user.doctor_name?.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    return filtered;
  };

  const getUniqueDoctors = () => {
    if (!doctors || doctors.length === 0) return [];
    const unique = doctors.filter((doc, index, self) =>
      index === self.findIndex(d => d.sys_user_id === doc.sys_user_id)
    );
    return unique;
  };

  const hasNurses = users.some(user => user.role === 'nurse');
  const filteredUsers = getFilteredUsers();
  const uniqueDoctors = getUniqueDoctors();

  if (!hospitalId) {
    return (
      <div style={S.errorContainer}>
        <div style={S.errorCard}>
          <div><Hospital size={48} color={T.textMuted} /></div>
          <h3>Hospital ID Not Found</h3>
          <p>Please ensure the URL contains a valid hospital_id parameter.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={S.loadingContainer}>
        <div><Loader2 size={50} style={S.spinner} /></div>
        <p>Loading clinical staff data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={S.errorContainer}>
        <div style={S.errorCard}>
          <div><AlertCircle size={48} color={T.textMuted} /></div>
          <h3>Error Loading Data</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
          * { box-sizing: border-box; }
          .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
          .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
          .h-submit-btn:hover { background: transparent !important; color: ${T.text} !important; }
          .h-menu-scroll::-webkit-scrollbar { display: none; }
          .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .animate-spin {
            animation: spin 1s linear infinite;
          }
        `}
      </style>

      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <div>
              <p style={S.brandName}>DoctorAssist</p>
              <p style={S.brandSub}>Hospital Admin</p>
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
                  onClick={item.action}
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

      {/* Main Content */}
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>Staff Management</p>
            <p style={S.topBarSub}>Manage doctors, nurses, and their assignments efficiently</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={S.searchWrap}>
              <Search size={13} color={T.textMuted} />
              <input type="text" placeholder="Search..." style={S.searchInput} />
            </div>
            <Bell size={16} color={T.textMuted} style={{ cursor: "pointer", flexShrink: 0 }} />
            <div style={S.dateBadge}>
              <Calendar size={12} color={T.textMuted} />
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        <div style={S.body}>
          <span style={S.pageLabel}>Clinical Operations</span>
          <h1 style={S.pageTitle}>Manage Staff</h1>

          {/* Stats Cards */}
          <div style={S.statsGrid}>
            <div style={S.statCard}>
              <div style={S.statIconWrapper(T.text)}><Stethoscope size={24} /></div>
              <div style={S.statDetails}>
                <span style={S.statLabel}>Total Doctors</span>
                <span style={S.statValue}>{users.filter(u => u.role === 'doctor').length}</span>
              </div>
            </div>
            {hasNurses && (
              <div style={S.statCard}>
                <div style={S.statIconWrapper(T.text)}><User size={24} /></div>
                <div style={S.statDetails}>
                  <span style={S.statLabel}>Total Nurses</span>
                  <span style={S.statValue}>{users.filter(u => u.role === 'nurse').length}</span>
                </div>
              </div>
            )}
            <div style={S.statCard}>
              <div style={S.statIconWrapper(T.text)}><CheckCircle size={24} /></div>
              <div style={S.statDetails}>
                <span style={S.statLabel}>Active Users</span>
                <span style={S.statValue}>{users.filter(u => u.status === 'active').length}</span>
              </div>
            </div>
            <div style={S.statCard}>
              <div style={S.statIconWrapper(T.text)}><Shield size={24} /></div>
              <div style={S.statDetails}>
                <span style={S.statLabel}>Blocked Users</span>
                <span style={S.statValue}>{users.filter(u => u.status === 'blocked').length}</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div style={S.filtersCard}>
            <div style={S.filtersHeader}>
              <div style={S.tabsContainer}>
                <button style={S.tab(activeTab === 'all')} onClick={() => setActiveTab('all')}>
                  <Users size={14} /> All Staff
                </button>
                <button style={S.tab(activeTab === 'doctors')} onClick={() => setActiveTab('doctors')}>
                  <Stethoscope size={14} /> Doctors
                </button>
                {hasNurses && (
                  <button style={S.tab(activeTab === 'nurses')} onClick={() => setActiveTab('nurses')}>
                    <User size={14} /> Nurses
                  </button>
                )}
              </div>

              <div style={S.filterActions}>
                {activeTab === 'nurses' && hasNurses && (
                  <select
                    style={S.select}
                    value={selectedDoctor}
                    onChange={(e) => setSelectedDoctor(e.target.value)}
                  >
                    <option value="all">All Doctors</option>
                    {uniqueDoctors.map(doctor => (
                      <option key={doctor.sys_user_id} value={doctor.sys_user_id}>
                        Dr. {doctor.name} - {doctor.specialization || 'No specialty'}
                      </option>
                    ))}
                  </select>
                )}

                <div style={S.searchWrapper}>
                  <Search size={14} style={S.searchIcon} />
                  <input
                    type="text"
                    placeholder="Search by name, email, doctor..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={S.searchInputField}
                  />
                  {searchTerm && (
                    <button style={S.clearSearch} onClick={() => setSearchTerm('')}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={S.activeFilters}>
              {activeTab !== 'all' && (
                <span style={S.filterBadge}>
                  {activeTab === 'doctors' ? 'Doctors' : 'Nurses'}
                  <button onClick={() => setActiveTab('all')}><X size={12} /></button>
                </span>
              )}
              {selectedDoctor !== 'all' && activeTab === 'nurses' && hasNurses && (
                <span style={S.filterBadge}>
                  Doctor: {doctors.find(d => d.sys_user_id === selectedDoctor)?.name}
                  <button onClick={() => setSelectedDoctor('all')}><X size={12} /></button>
                </span>
              )}
              {searchTerm && (
                <span style={S.filterBadge}>
                  Search: "{searchTerm}"
                  <button onClick={() => setSearchTerm('')}><X size={12} /></button>
                </span>
              )}
            </div>
          </div>

          <div style={S.resultsInfo}>
            Showing {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
          </div>

          {/* Users Table */}
          <div style={S.tableCard}>
            <table style={S.usersTable}>
              <thead>
                <tr>
                  <th style={S.th}>Name & Role</th>
                  <th style={S.th}>Specialty / Assigned Doctor</th>
                  <th style={S.th}>Contact Information</th>
                  <th style={S.th}>Username</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length > 0 ? (
                  filteredUsers.map(user => (
                    <tr key={user.sys_user_id} style={{ opacity: user.status === 'blocked' ? 0.6 : 1 }}>
                      <td style={S.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={S.profileAvatar}>
                            {user.role === 'doctor' ? <Stethoscope size={14} color="#fff" /> : <User size={14} color="#fff" />}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500 }}>{user.name}</div>
                            <div>
                              <span style={S.roleTag(user.role)}>
                                {user.role === 'doctor' ? 'Doctor' : 'Nurse'}
                              </span>
                              {user.role === 'nurse' && user.nurse_role && user.nurse_role !== 'nurse' && (
                                <span style={S.roleTag('nurse')}>{user.nurse_role}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={S.td}>
                        {user.role === 'doctor' ? (
                          <span style={S.roleTag('doctor')}>{user.specialization || 'Not specified'}</span>
                        ) : (
                          user.doctor_details ? (
                            <div>
                              <div>Dr. {user.doctor_details.name}</div>
                              <div style={{ fontSize: "0.65rem", color: T.textMuted }}>{user.doctor_details.specialization || 'No specialty'}</div>
                            </div>
                          ) : (
                            <span style={{ color: T.textMuted }}>Unassigned</span>
                          )
                        )}
                      </td>
                      <td style={S.td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            <Mail size={12} color={T.textMuted} />
                            <a href={`mailto:${user.email}`} style={{ color: T.textSec, textDecoration: "none" }}>{user.email}</a>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            <Phone size={12} color={T.textMuted} />
                            <span>{user.phone_number}</span>
                          </div>
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>@{user.username}</span>
                      </td>
                      <td style={S.td}>
                        <span style={S.statusBadge(user.status)}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: user.status === 'active' ? T.text : T.textMuted }}></span>
                          {user.status === 'active' ? 'Active' : 'Blocked'}
                        </span>
                      </td>
                      <td style={S.td}>
                        <button style={S.actionBtn} onClick={() => handleEdit(user)} title="Edit User">
                          <Edit size={12} />
                        </button>
                        <button style={S.actionBtn} onClick={() => handleBlockToggle(user.sys_user_id, user.status)} title={user.status === 'active' ? 'Block User' : 'Activate User'}>
                          {actionLoading[user.sys_user_id] ? <Loader2 size={12} className="animate-spin" /> : (user.status === 'active' ? <Lock size={12} /> : <Unlock size={12} />)}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "3rem" }}>
                      <div>
                        <Search size={48} color={T.textMuted} />
                        <h3>No {activeTab === 'all' ? 'staff' : activeTab} found</h3>
                        <p>Try adjusting your filters or search criteria</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Edit Modal */}
      {showEditModal && editingUser && (
        <div style={S.modalOverlay}>
          <div style={S.modalCard}>
            <div style={S.modalHeader}>
              <div style={S.modalTitle}>
                <UserCog size={20} style={S.modalIcon} />
                <h3 style={S.modalTitleText}>Edit {editingUser.role === 'doctor' ? 'Doctor' : 'Nurse'}</h3>
              </div>
              <button style={S.modalClose} onClick={() => setShowEditModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div style={S.modalBody}>
              {updateSuccess ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <CheckCircle size={48} color={T.text} />
                  <h3>Update Successful!</h3>
                  <p>User information has been updated successfully.</p>
                </div>
              ) : (
                <div style={S.formGrid}>
                  <div style={S.formGroup}>
                    <label style={S.formLabel}>Full Name</label>
                    <input
                      type="text"
                      value={editingUser.name || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                      style={S.formInput}
                    />
                  </div>
                  <div style={S.formGroup}>
                    <label style={S.formLabel}>Username</label>
                    <input
                      type="text"
                      value={editingUser.username || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                      style={S.formInput}
                    />
                  </div>
                  <div style={S.formGroup}>
                    <label style={S.formLabel}>Phone Number</label>
                    <input
                      type="tel"
                      value={editingUser.phone_number || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, phone_number: e.target.value })}
                      style={S.formInput}
                    />
                  </div>
                  <div style={S.formGroupFull}>
                    <label style={S.formLabel}>Email Address</label>
                    <input
                      type="email"
                      value={editingUser.email || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                      style={S.formInput}
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.formLabel}>New Password</label>
                    <div style={S.passwordWrapper}>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={passwordValue}
                        onChange={(e) => {
                          setPasswordValue(e.target.value);
                          setPasswordError('');
                        }}
                        style={{ ...S.formInput, width: "100%" }}
                      />
                      <button type="button" style={S.passwordToggle} onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div style={S.formGroup}>
                    <label style={S.formLabel}>Confirm Password</label>
                    <div style={S.passwordWrapper}>
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setPasswordError('');
                        }}
                        style={{ ...S.formInput, width: "100%" }}
                      />
                      <button type="button" style={S.passwordToggle} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                        {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {passwordError && (
                    <div style={S.formGroupFull}>
                      <div style={{ color: "#cc3333", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <AlertCircle size={12} /> {passwordError}
                      </div>
                    </div>
                  )}

                  {updateError && (
                    <div style={S.formGroupFull}>
                      <div style={{ color: "#cc3333", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <AlertCircle size={12} /> {updateError}
                      </div>
                    </div>
                  )}

                  {editingUser.role === 'doctor' && (
                    <div style={S.formGroupFull}>
                      <label style={S.formLabel}>Specialty</label>
                      <select
                        value={editingUser.specialization || ''}
                        onChange={(e) => setEditingUser({ ...editingUser, specialization: e.target.value })}
                        style={S.formSelect}
                      >
                        <option value="">Select specialty</option>
                        {specializations.map(specialty => (
                          <option key={specialty} value={specialty}>{specialty}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {editingUser.role === 'nurse' && (
                    <>
                      <div style={S.formGroupFull}>
                        <label style={S.formLabel}>Nurse Role</label>
                        <select
                          value={editingUser.nurse_role || 'nurse'}
                          onChange={(e) => setEditingUser({ ...editingUser, nurse_role: e.target.value })}
                          style={S.formSelect}
                        >
                          {nurseRoles.map(role => (
                            <option key={role} value={role}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={S.formGroupFull}>
                        <label style={S.formLabel}>Assign to Doctor</label>
                        <select
                          value={editingUser.doctor_id || ''}
                          onChange={(e) => {
                            const selectedDocId = e.target.value;
                            const selectedDoc = doctors.find(d => d.sys_user_id === selectedDocId);
                            setEditingUser({
                              ...editingUser,
                              doctor_id: selectedDocId,
                              doctor_details: selectedDoc,
                              doctor_name: selectedDoc?.name,
                              doctor_specialty: selectedDoc?.specialization
                            });
                          }}
                          style={S.formSelect}
                        >
                          <option value="">Unassigned</option>
                          {doctors.map(doctor => (
                            <option key={doctor.sys_user_id} value={doctor.sys_user_id}>
                              Dr. {doctor.name} - {doctor.specialization || 'No specialty'}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={S.modalFooter}>
              <button style={S.btnSecondary} onClick={() => setShowEditModal(false)}>Cancel</button>
              <button
                style={S.btnPrimary}
                onClick={handleSaveEdit}
                disabled={saveLoading || updateSuccess}
              >
                {saveLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HospitalAdminStaff;