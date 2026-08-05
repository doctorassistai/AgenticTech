import React, { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Home, UserPlus, Users, Calendar, Stethoscope, LogOut, Building,
  Clipboard, BarChart3, Settings, Bell, Search, FileText, ChevronDown,
  User, ChevronRight
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching other components) ─── */
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

/* ─── STYLES (matching other components) ─── */
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

  labelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.4rem",
  },

  addButton: {
    background: "transparent",
    border: "none",
    fontSize: "1rem",
    cursor: "pointer",
    color: T.textMuted,
    padding: "0 0.25rem",
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

  selectDisabled: {
    backgroundColor: T.bgAlt,
    cursor: "not-allowed",
    opacity: 0.7,
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

  valuesSection: {
    backgroundColor: T.bgAlt,
    padding: "1rem",
    border: `1px solid ${T.border}`,
    borderRadius: "2px",
  },

  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    fontSize: "0.85rem",
    color: T.textSec,
    padding: "0.25rem 0",
  },

  checkbox: {
    accentColor: T.text,
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

  submitBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },

  generateBtn: {
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
    marginBottom: "1.5rem",
  },

  clearBtn: {
    padding: "0.5rem 0.75rem",
    background: "transparent",
    border: `1px solid ${T.border}`,
    borderRadius: "2px",
    cursor: "pointer",
    fontSize: "0.7rem",
    color: T.textMuted,
  },

  inputRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
  },
};

const ReportRuleSettings = () => {
  const [allRules, setAllRules] = useState([]);
  const [hospitalRules, setHospitalRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const hospitalId = searchParams.get("hospital_id");

  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [values, setValues] = useState([]);
  const [ruleText, setRuleText] = useState("");
  const [selectedValues, setSelectedValues] = useState([]);

  const [categoryMap, setCategoryMap] = useState({
    laboratory: [
      "blood_test", "urine_test", "core_laboratory_panels_routine", "cardiac_markers", "tumor_markers", "diabetes_markers", "hematology_specialized", "vitamins_minerals", "gi_markers",
      "sepsis_inflammation", "microbiology", "infectious_disease", "hormones_thyroid", "hormones_adrenal", "hormones_reproductive",
      "hormones_other", "immunology", "pathology_histology", "arterial_blood_gas"
    ],
    radiology: [
      "xray", "ct_scan", "Mammography", "MRI", "mri_specialized", "cardiac_imaging", "Ultrasound", "obstetric_ultrasound",
      "doppler", "nuclear_medicine", "interventional_radiology", "PET-CT", "ct_angiography", "dexa_scan"
    ],
    Speciality_Documents: [
      "Histopathology", "Cytology", "obstetrics", "Gastroenterology", "Cardiology", "gynecology", "pediatrics", "oncology", "dialysis", "rehabilitation", "psychiatry"
    ],
    functional: [
      "pulmonary", "cardiac_tests", "neurophysiology", "endoscopy_gi", "endoscopy_respiratory", "endoscopy_urological", "endoscopy_gynecological", "endoscopy_joint", "gi_manometry", "urodynamics", "sleep_studies", "audiology", "ophthalmology", "cognitive_assessment", "rehabilitation"
    ],
    Discharge_Summary: [
      "General Medicine Discharge Summary", "Onco Discharge Summary", "Gastroenterology Discharge Summary", "Cardiology Discharge Summary", "clinical_summary"
    ],
    clinical: ["admission", "progress_notes"],
    referral: ["referrals"],
    surgical: ["preoperative", "operative", "postoperative", "interventional"],
    pharmacy: ["prescriptions", "medication_admin", "pharmacy_review"],
    emergency: ["emergency_records", "critical_care"],
    administrative: ["consent_forms", "administrative_forms", "medical_legal"]
  });

  const [valueMap, setValueMap] = useState({
    // ... (keep your existing valueMap as is - too long to repeat but keep it exactly the same)
  });

  const [newCategory, setNewCategory] = useState("");
  const [newSubcategory, setNewSubcategory] = useState("");
  const [newValue, setNewValue] = useState("");

  const [showCatInput, setShowCatInput] = useState(false);
  const [showSubInput, setShowSubInput] = useState(false);
  const [showValueInput, setShowValueInput] = useState(false);
  const isManualFlow = showCatInput || showSubInput;

  // 🎤 VOICE
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const fetchRules = async () => {
      try {
        setLoadingRules(true);
        if (hospitalId) {
          const hospitalRes = await fetch(`${API_BASE_URL}hms/users/data/context/get_ReportHospitalRules/${hospitalId}`);
          const hospitalData = await hospitalRes.json();
          if (hospitalData.status === "success") {
            setHospitalRules(hospitalData.rules);
          }
        }
        const adminRes = await fetch(`${API_BASE_URL}hms/users/data/context/get_ReportAdminRules`);
        const adminData = await adminRes.json();
        if (adminData.status === "success") {
          setAllRules(adminData.data);
        }
      } catch (err) {
        console.error("Failed to fetch rules", err);
      } finally {
        setLoadingRules(false);
      }
    };
    fetchRules();
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) {
      alert("Hospital ID missing in URL");
    }
  }, [hospitalId]);

  useEffect(() => {
    if (values.length > 0) {
      setSelectedValues(values);
    } else {
      setSelectedValues([]);
    }
  }, [values]);

  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported");
      return;
    }
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.lang = "en-US";
    recognitionRef.current.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setRuleText((prev) => prev + " " + transcript);
    };
    recognitionRef.current.start();
    setListening(true);
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const getAllCategories = () => {
    const adminCategories = Object.keys(categoryMap);
    const hospitalCategories = [...new Set(hospitalRules.map(rule => rule.category))];
    return [...new Set([...adminCategories, ...hospitalCategories])];
  };

  const getValuesForSelection = (cat, sub) => {
    const hospitalMatchedRules = hospitalRules.filter(r => r.category === cat && r.subcategory === sub);
    const adminMatchedRules = allRules.filter(r => r.category === cat && r.subcategory === sub);
    const matchedRules = [...hospitalMatchedRules, ...adminMatchedRules];
    if (matchedRules.length === 0) return [];
    const allValues = matchedRules.flatMap(rule => rule.values || []);
    return Array.from(new Set(allValues));
  };

  useEffect(() => {
    if (category && subcategory && (allRules.length > 0 || hospitalRules.length > 0)) {
      const backendValues = getValuesForSelection(category, subcategory);
      setValues(backendValues);
    }
  }, [category, subcategory, allRules, hospitalRules]);

  const handleGenerateRule = () => {
    if (!category || !subcategory) {
      alert("Please select category and subcategory");
      return;
    }
    const adminMatchingRules = allRules.filter(rule => rule.category === category && rule.subcategory === subcategory);
    const hospitalMatchingRules = hospitalRules.filter(rule => rule.category === category && rule.subcategory === subcategory);
    const matchingRules = [...hospitalMatchingRules, ...adminMatchingRules];
    if (matchingRules.length === 0) {
      setRuleText("No rule available for this category and subcategory.");
      return;
    }
    const sortedRules = [...matchingRules].sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      return 0;
    });
    const latestRule = sortedRules[0] || matchingRules[matchingRules.length - 1];
    setRuleText(latestRule.rule_text);
  };

  const handleSaveRule = async () => {
    if (!hospitalId) {
      alert("Hospital ID not found");
      return;
    }
    if (!category || !subcategory || !ruleText) {
      alert("Please fill all required fields");
      return;
    }
    const payload = {
      hospital_id: hospitalId,
      category,
      subcategory,
      values: selectedValues,
      rule_text: ruleText
    };
    console.log(payload);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/save_ReportHospitalRule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === "success") {
        alert("Rule saved successfully");
      } else {
        alert(data.message || "Failed to save rule");
      }
    } catch (error) {
      console.error(error);
      alert("Server error");
    }
  };

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

  const handleHospitalStaff = () => { if (!hospitalId) return alert("Hospital ID missing"); navigate(`/hospital-admin-staff?hospital_id=${hospitalId}`); };

  const handleReportRuleSettings = () => {
    if (!hospitalId) return;
    navigate(`/report-rule-settings?hospital_id=${hospitalId}`);
  };

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
        { label: "Manage Staff", icon: <UserPlus size={14} />, action: handleHospitalStaff },
        // { label: "Departments", icon: <Building size={14} />, action: () => {} },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "ReportRule Settings", icon: <Clipboard size={14} />, action: handleReportRuleSettings, active: true },
        // { label: "Settings", icon: <Settings size={14} />, action: () => {} },
      ],
    },
  ];

  const inputFocusStyle = { borderColor: T.text, backgroundColor: T.bg };
  const inputBlurStyle = { borderColor: T.border, backgroundColor: T.bg };

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
            <p style={S.topBarTitle}>Report Rule Settings</p>
            <p style={S.topBarSub}>Configure report generation rules for your hospital</p>
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
          <span style={S.pageLabel}>Configuration</span>
          <h1 style={S.pageTitle}>Report Rule Configuration</h1>

          <div style={S.formContainer}>
            <div style={S.formInner}>
              {/* CATEGORY */}
              <div style={S.field}>
                <div style={S.labelRow}>
                  <label style={S.label}>Category</label>
                  <button
                    disabled={showCatInput || category !== ""}
                    onClick={() => setShowCatInput(true)}
                    style={{
                      ...S.addButton,
                      opacity: (showCatInput || category !== "") ? 0.3 : 1,
                      cursor: (showCatInput || category !== "") ? "not-allowed" : "pointer"
                    }}
                  >
                    ＋
                  </button>
                </div>
                {showCatInput && (
                  <div style={S.inputRow}>
                    <input
                      value={newCategory}
                      autoFocus
                      onChange={(e) => setNewCategory(e.target.value)}
                      onBlur={() => {
                        if (newCategory.trim()) {
                          setCategory(newCategory.trim());
                        }
                      }}
                      style={S.input}
                      placeholder="Enter category text"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setNewCategory("");
                        setShowCatInput(false);
                      }}
                      style={S.clearBtn}
                    >
                      🗑️ Clear
                    </button>
                  </div>
                )}
                <div style={S.inputRow}>
                  <select
                    value={category}
                    disabled={showCatInput}
                    onChange={(e) => {
                      const newCategory = e.target.value;
                      setCategory(newCategory);
                      setValues(subcategory ? getValuesForSelection(newCategory, subcategory) : []);
                    }}
                    style={{
                      ...S.select,
                      ...(showCatInput ? S.selectDisabled : {})
                    }}
                  >
                    <option value="" hidden>Select Category</option>
                    {getAllCategories().map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  {category && (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory("");
                        setSubcategory("");
                        setValues([]);
                      }}
                      style={S.clearBtn}
                    >
                      🗑️ Clear
                    </button>
                  )}
                </div>
              </div>

              {/* SUBCATEGORY */}
              <div style={S.field}>
                <div style={S.labelRow}>
                  <label style={S.label}>Subcategory</label>
                  <button
                    disabled={showSubInput || subcategory !== ""}
                    onClick={() => setShowSubInput(true)}
                    style={{
                      ...S.addButton,
                      opacity: (showSubInput || subcategory !== "") ? 0.3 : 1,
                      cursor: (showSubInput || subcategory !== "") ? "not-allowed" : "pointer"
                    }}
                  >
                    ＋
                  </button>
                </div>
                {showSubInput && (
                  <div style={S.inputRow}>
                    <input
                      value={newSubcategory}
                      autoFocus
                      onChange={(e) => setNewSubcategory(e.target.value)}
                      onBlur={() => {
                        if (newSubcategory.trim()) {
                          setSubcategory(newSubcategory.trim());
                        }
                      }}
                      style={S.input}
                      placeholder="Enter subcategory text"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setNewSubcategory("");
                        setShowSubInput(false);
                      }}
                      style={S.clearBtn}
                    >
                      🗑️ Clear
                    </button>
                  </div>
                )}
                <div style={S.inputRow}>
                  <select
                    value={subcategory}
                    disabled={showCatInput || showSubInput}
                    onChange={(e) => {
                      const sub = e.target.value;
                      setSubcategory(sub);
                      const resolvedValues = getValuesForSelection(category, sub);
                      setValues(resolvedValues);
                    }}
                    style={{
                      ...S.select,
                      ...((showCatInput || showSubInput) ? S.selectDisabled : {})
                    }}
                  >
                    <option value="" hidden>Select Subcategory</option>
                    {(() => {
                      const predefinedSubs = categoryMap[category] || [];
                      const hospitalSubs = hospitalRules.filter(rule => rule.category === category).map(rule => rule.subcategory);
                      const allSubs = [...new Set([...predefinedSubs, ...hospitalSubs])];
                      return allSubs.map((sub) => (
                        <option key={sub} value={sub}>{sub}</option>
                      ));
                    })()}
                  </select>
                  {subcategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setSubcategory("");
                        setValues([]);
                      }}
                      style={S.clearBtn}
                    >
                      🗑️ Clear
                    </button>
                  )}
                </div>
              </div>

              {/* VALUES */}
              {(subcategory || showSubInput) && (
                <div style={S.valuesSection}>
                  <div style={S.labelRow}>
                    <label style={S.label}>Values</label>
                    <button
                      onClick={() => setShowValueInput(!showValueInput)}
                      style={S.addButton}
                    >
                      ＋
                    </button>
                  </div>
                  {(showValueInput || isManualFlow) && (
                    <div style={S.inputRow}>
                      <input
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        onBlur={() => {
                          if (newValue) setValues((p) => [...p, newValue]);
                          setNewValue("");
                          if (!isManualFlow) setShowValueInput(false);
                        }}
                        style={S.input}
                        placeholder="New value"
                      />
                    </div>
                  )}
                  <div>
                    {values.map((v) => (
                      <label key={v} style={S.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={selectedValues.includes(v)}
                          onChange={(e) => {
                            setSelectedValues((prev) =>
                              e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)
                            );
                          }}
                          style={S.checkbox}
                        />
                        <span>{v}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* GENERATE RULE BUTTON */}
              {!isManualFlow && (
                <button
                  disabled={loadingRules}
                  onClick={handleGenerateRule}
                  className="h-submit-btn"
                  style={S.generateBtn}
                >
                  {loadingRules ? "Loading rules..." : "Generate Rule"}
                </button>
              )}

              {/* RULE DEFINITION */}
              <div style={S.field}>
                <div style={S.labelRow}>
                  <label style={S.label}>Rule Definition</label>
                  <div>
                    <button
                      onClick={listening ? stopVoice : startVoice}
                      style={{
                        ...S.addButton,
                        backgroundColor: listening ? T.bgAlt : "transparent",
                        padding: "4px 8px",
                        borderRadius: "2px"
                      }}
                    >
                      {listening ? "🔴 Stop" : "🎤 Voice"}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={8}
                  value={ruleText}
                  onChange={(e) => setRuleText(e.target.value)}
                  style={S.textarea}
                  onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                  onBlur={(e) => Object.assign(e.target.style, inputBlurStyle)}
                  placeholder="Enter rule definition here..."
                />
              </div>

              {/* SAVE BUTTON */}
              <button
                onClick={handleSaveRule}
                disabled={!hospitalId}
                className="h-submit-btn"
                style={{
                  ...S.submitBtn,
                  ...(!hospitalId ? S.submitBtnDisabled : {})
                }}
              >
                Save Rule
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ReportRuleSettings;