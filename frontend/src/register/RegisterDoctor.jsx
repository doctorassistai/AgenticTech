import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Eye, EyeOff, Phone, Mail, User, Lock, BriefcaseMedical, GraduationCap,
  FileText, MapPin, ChevronDown, Home, UserPlus, Users, Calendar, Stethoscope,
  LogOut, Building, Clipboard, BarChart3, Settings, Bell, Search, ChevronRight
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching HospitalDashboard) ─── */
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

/* ─── STYLES (matching HospitalDashboard) ─── */
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

  formContainer: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    marginBottom: "2rem",
  },

  formInner: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    padding: "2rem",
  },

  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
  },

  gridFull: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "1.5rem",
  },

  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },

  label: {
    fontSize: "0.68rem",
    fontWeight: 600,
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },

  input: {
    padding: "0.7rem 0.875rem",
    border: `1px solid ${T.border}`,
    backgroundColor: T.bg,
    fontSize: "0.85rem",
    color: T.text,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s, background-color 0.15s",
    borderRadius: "2px",
  },

  textarea: {
    padding: "0.7rem 0.875rem",
    border: `1px solid ${T.border}`,
    backgroundColor: T.bg,
    fontSize: "0.85rem",
    color: T.text,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s, background-color 0.15s",
    borderRadius: "2px",
    resize: "vertical",
  },

  select: {
    padding: "0.7rem 0.875rem",
    border: `1px solid ${T.border}`,
    backgroundColor: T.bg,
    fontSize: "0.85rem",
    color: T.text,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    borderRadius: "2px",
    cursor: "pointer",
  },

  countryBtn: {
    padding: "0.7rem 0.875rem",
    border: `1px solid ${T.border}`,
    backgroundColor: T.bg,
    fontSize: "0.85rem",
    color: T.text,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    cursor: "pointer",
    borderRadius: "2px",
  },

  countryDropdown: {
    position: "absolute",
    zIndex: 50,
    marginTop: "4px",
    width: "100%",
    backgroundColor: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: "2px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
    maxHeight: "280px",
    overflow: "hidden",
  },

  countryOption: (isSelected) => ({
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "0.6rem 0.875rem",
    textAlign: "left",
    backgroundColor: isSelected ? T.bgAlt : "transparent",
    borderLeft: isSelected ? `2px solid ${T.accent}` : "2px solid transparent",
    fontSize: "0.8rem",
    color: T.text,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
  }),

  passwordWrapper: {
    position: "relative",
    width: "100%",
  },

  passwordToggle: {
    position: "absolute",
    right: "0.75rem",
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: T.textMuted,
    padding: 0,
    display: "flex",
    alignItems: "center",
  },

  submitBtn: {
    width: "100%",
    padding: "0.85rem",
    backgroundColor: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.8rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderRadius: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  },

  messageBox: (isError) => ({
    marginTop: "1rem",
    padding: "0.875rem 1rem",
    border: `1px solid ${T.border}`,
    borderLeft: `3px solid ${isError ? "#cc3333" : "#22aa66"}`,
    backgroundColor: isError ? "#fff8f8" : "#f6fdf9",
    fontSize: "0.78rem",
    color: isError ? "#aa2222" : "#226644",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "2px",
  }),

  loadingBox: {
    padding: "3rem",
    textAlign: "center",
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
    background: T.bgAlt,
    color: T.textMuted,
    fontSize: "0.78rem",
    fontWeight: 300,
  },
};

const countryCodes = [
  { code: "ZW", country: "Zimbabwe", flag: "🇿🇼" },
  { code: "IN", country: "India", flag: "🇮🇳" },
  { code: "US", country: "USA", flag: "🇺🇸" },
  { code: "GB", country: "UK", flag: "🇬🇧" },
  { code: "AU", country: "Australia", flag: "🇦🇺" },
  { code: "ZA", country: "South Africa", flag: "🇿🇦" },
  { code: "KE", country: "Kenya", flag: "🇰🇪" },
  { code: "NG", country: "Nigeria", flag: "🇳🇬" },
  { code: "CA", country: "Canada", flag: "🇨🇦" },
  { code: "AE", country: "UAE", flag: "🇦🇪" },
];

const specializations = [
  "General Medicine", "Emergency", "Cardiology", "Pulmonology", "Endocrinology",
  "Gastroenterology", "Nephrology", "Medical Oncology", "Chemotherapy", "Immunotherapy",
  "Targeted therapy", "Hormone therapy", "Precision oncology", "Radiation Oncology",
  "External beam radiotherapy", "Brachytherapy", "Stereotactic radiosurgery",
  "Surgical Oncology", "Curative surgery", "Cytoreductive surgery", "Reconstructive surgery",
  "Breast Oncology", "Thoracic Oncology", "Gastrointestinal Oncology", "Gynecologic Oncology",
  "Urologic Oncology", "Head and Neck Oncology", "Neuro-oncology", "Pediatric Oncology",
  "Hematologic Oncology", "Imaging Oncology", "Pathology", "Histopathology", "Cytology",
  "Molecular pathology", "Molecular Oncology", "Biomarker Analysis", "Nuclear Medicine",
  "Interventional Oncology", "Ablation therapies", "Embolization", "Research Oncology",
  "Palliative Oncology", "Pain Management", "Rehabilitation Oncology", "Nutritional Oncology",
  "Psycho-oncology", "Preventive Oncology", "Cancer Screening Programs", "Genetic Counseling","Diabetic foot","Anesthesiology","Onco Pain and Palliative Care","Palliative Medicine"
];

function RegisterDoctor() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const hospitalId = queryParams.get("hospital_id");

  const [formData, setFormData] = useState({
    name: "", username: "", email: "", country_code: "ZW", phone_number: "",
    password: "", specialization: "", qualifications: "", registeration_number: "", address: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const countryDropdownRef = useRef(null);

  useEffect(() => {
    if (!hospitalId) navigate("/login");
  }, [hospitalId, navigate]);

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/hospitals/verify`, { credentials: "include" });
        if (!res.ok) throw new Error("Not authenticated");
        const data = await res.json();
        const verifiedHospitalId = data.hospital.sys_user_id;
        if (!hospitalId || hospitalId !== verifiedHospitalId) {
          navigate("/login");
          return;
        }
        setAuthChecked(true);
      } catch (err) {
        console.error("Hospital auth failed", err);
        navigate("/login");
      }
    };
    verifyAuth();
  }, [hospitalId, navigate]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target)) {
        setShowCountryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "phone_number") {
      setFormData({ ...formData, [name]: value.replace(/\D/g, '') });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleCountrySelect = (code) => {
    setFormData({ ...formData, country_code: code });
    setShowCountryDropdown(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("Registering doctor...");

    const submitData = {
      ...formData,
      hospital_id: hospitalId,
      country_code: formData.country_code,
      phone_number: formData.phone_number
    };

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/doctors/doctoradd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Registration failed on server.");
      setMessage("✅ Doctor registered successfully");
      setTimeout(() => navigate(`/hospital-dashboard?hospital_id=${hospitalId}`), 1200);
    } catch (err) {
      console.error("Registration error:", err);
      setMessage(`❌ Registration failed: ${err.message || "Server error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }
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
    if (!hospitalId) return alert("Hospital ID missing");
    navigate(`/register-doctor?hospital_id=${hospitalId}`);
  };

  const handleAddNurse = () => {
    if (!hospitalId) return alert("Hospital ID missing");
    navigate(`/nurse-register?hospital_id=${hospitalId}`);
  };
  const handleHospitalStaff = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/hospital-admin-staff?hospital_id=${hospitalId}`); };

  // const handleReportRuleSettings = () => {
  //   if (!hospitalId) return alert("Hospital ID missing");
  //   navigate(`/report-rule-settings?hospital_id=${hospitalId}`);
  // };

  const handleAddExcel = () => {
    if (!hospitalId) return alert("Hospital ID missing");
    navigate(`/upload-excel?hospital_id=${hospitalId}`);
  };

  const selectedCountry = countryCodes.find(c => c.code === formData.country_code);

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: () => navigate(`/hospital-dashboard?hospital_id=${hospitalId}`) },
        // { label: "Patients", icon: <Users size={14} />, action: () => {} },
        // { label: "Appointments", icon: <Calendar size={14} />, action: () => {} },
        // { label: "Reports & Analytics", icon: <BarChart3 size={14} />, action: () => {} },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, action: handleAddDoctor, active: true },
        { label: "Add Nurse", icon: <UserPlus size={14} />, action: handleAddNurse },
        { label: "Add Doctor via Excel", icon: <FileText size={14} />, action: handleAddExcel },
        { label: "Manage Staff", icon: <UserPlus size={14} />, action: handleHospitalStaff },
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

  if (!authChecked) {
    return <div style={S.loadingBox}>Verifying session...</div>;
  }

  const inputFocusStyle = { borderColor: T.text, backgroundColor: T.bg };
  const inputBlurStyle = { borderColor: T.border, backgroundColor: T.bg };

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .h-country-opt:hover { background: ${T.bgAlt} !important; }
        .h-submit-btn:hover { background: transparent !important; color: ${T.text} !important; }
        .h-menu-scroll::-webkit-scrollbar { display: none; }
        .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

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
            <p style={S.topBarTitle}>Register New Doctor</p>
            <p style={S.topBarSub}>Add a medical professional to your healthcare team</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={S.searchWrap}>
              <Search size={13} color={T.textMuted} />
              <input type="text" placeholder="Search…" style={S.searchInput} />
            </div>
            <Bell size={16} color={T.textMuted} style={{ cursor: "pointer", flexShrink: 0 }} />
            <div style={S.dateBadge}>
              <Calendar size={12} color={T.textMuted} />
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>
        </div>

        <div style={S.body}>
          <span style={S.pageLabel}>Staff Management</span>
          <h1 style={S.pageTitle}>Doctor Registration</h1>

          <div style={S.formContainer}>
            <form onSubmit={handleSubmit}>
              <div style={S.formInner}>
                <div style={S.grid2}>
                  <div style={S.field}>
                    <label style={S.label}>Full Name *</label>
                    <input
                      name="name"
                      placeholder="Dr. John Smith"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      style={S.input}
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                    />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Username *</label>
                    <input
                      name="username"
                      placeholder="dr.johnsmith"
                      value={formData.username}
                      onChange={handleChange}
                      required
                      style={S.input}
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                    />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Email Address</label>
                    <input
                      type="email"
                      name="email"
                      placeholder="doctor@hospital.com"
                      value={formData.email}
                      onChange={handleChange}
                      style={S.input}
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                    />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Country *</label>
                    <div style={{ position: "relative" }} ref={countryDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                        style={S.countryBtn}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span>{selectedCountry?.flag}</span>
                          <span>{selectedCountry?.country} ({selectedCountry?.code})</span>
                        </span>
                        <ChevronDown size={14} />
                      </button>
                      {showCountryDropdown && (
                        <div style={S.countryDropdown}>
                          <div style={{ maxHeight: "260px", overflowY: "auto" }}>
                            {countryCodes.map((country) => (
                              <button
                                key={country.code}
                                type="button"
                                className="h-country-opt"
                                onClick={() => handleCountrySelect(country.code)}
                                style={S.countryOption(formData.country_code === country.code)}
                              >
                                <span style={{ marginRight: "8px", fontSize: "1.1rem" }}>{country.flag}</span>
                                <span>{country.country}</span>
                                <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: T.textMuted }}>{country.code}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Phone Number *</label>
                    <input
                      name="phone_number"
                      placeholder="9876543210"
                      value={formData.phone_number}
                      onChange={handleChange}
                      required
                      maxLength={15}
                      style={S.input}
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                    />
                    <span style={{ fontSize: "0.6rem", color: T.textMuted, marginTop: "2px" }}>Digits only (no country code)</span>
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Password *</label>
                    <div style={S.passwordWrapper}>
                      <input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        placeholder="••••••••"
                        value={formData.password}
                        onChange={handleChange}
                        required
                        style={{ ...S.input, paddingRight: "2rem" }}
                        onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                        onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} style={S.passwordToggle}>
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Specialization *</label>
                    <select
                      name="specialization"
                      value={formData.specialization}
                      onChange={handleChange}
                      required
                      style={S.select}
                    >
                      <option value="">Select Specialization</option>
                      {specializations.map((spec, idx) => (
                        <option key={idx} value={spec}>{spec}</option>
                      ))}
                    </select>
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Qualifications</label>
                    <input
                      name="qualifications"
                      placeholder="MBBS, MD, MS, etc."
                      value={formData.qualifications}
                      onChange={handleChange}
                      style={S.input}
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                    />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Registration Number</label>
                    <input
                      name="registeration_number"
                      placeholder="Medical Council Registration"
                      value={formData.registeration_number}
                      onChange={handleChange}
                      style={S.input}
                      onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                      onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                    />
                  </div>
                </div>

                <div style={S.field}>
                  <label style={S.label}>Address</label>
                  <textarea
                    name="address"
                    placeholder="Clinic/Hospital address..."
                    rows={3}
                    value={formData.address}
                    onChange={handleChange}
                    style={S.textarea}
                    onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                    onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                  />
                </div>

                <button type="submit" disabled={loading} className="h-submit-btn" style={S.submitBtn}>
                  {loading ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                      </svg>
                      Registering...
                    </span>
                  ) : (
                    <>
                      Register Doctor
                      <ChevronRight size={14} />
                    </>
                  )}
                </button>

                {message && (
                  <div style={S.messageBox(message.includes('✅'))}>
                    {message.includes('✅') ? (
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {message}
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default RegisterDoctor;