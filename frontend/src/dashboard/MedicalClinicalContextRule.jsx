import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/lodo_only.png";
import { 
  Home, Settings, Bed, MessageCircle, Calendar, Activity, 
  LogOut, Search, Bell, UserPlus 
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// --- BRAND COLORS AND CONFIG ---
const PRIMARY_BLUE = "#005a8b";
const ACCENT_TEAL = "#00c2a7";
const ACCENT_PURPLE = "#5856D6";
const LIGHT_BG = "#f5f7fa";
const MAX_WIDTH = "1700px";

// Helper to convert hex to rgba
const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/* ================= STYLES ================= */
const getStyles = () => {
  const liquidGlassBase = {
    background: "rgba(255, 255, 255, 0.6)",
    backdropFilter: "blur(35px) saturate(180%)",
    WebkitBackdropFilter: "blur(35px) saturate(180%)",
    border: "1px solid rgba(255, 255, 255, 0.85)",
    borderRadius: "18px",
    boxShadow: `
      0 10px 30px rgba(0, 0, 0, 0.06),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.7)
    `,
    position: "relative",
    overflow: "hidden"
  };

  return {
    // --- GLOBAL LAYOUT & FONT ---
    layout: {
      display: "flex",
      minHeight: "100vh",
      background: `linear-gradient(135deg, ${LIGHT_BG} 0%, #f0f4ff 50%, #e8edff 100%)`,
      fontFamily: "'Inter', 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      position: "relative",
      overflow: "hidden",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale"
    },
    pageContent: {
      flex: 1,
      padding: "1.5rem",
      zIndex: 1,
      maxWidth: MAX_WIDTH,
      margin: '0 auto',
      marginLeft: '260px',
    },

    // --- LIQUID BACKGROUND EFFECTS ---
    blueShape1: {
      position: "fixed", top: "10%", left: "0%", width: "600px", height: "600px",
      background: `linear-gradient(145deg, ${PRIMARY_BLUE}aa, #ffffff11)`, 
      borderRadius: "40% 60% 70% 30% / 40% 50% 50% 60%", 
      opacity: 0.1, filter: "blur(70px)", zIndex: 0,
      animation: "subtleMove 15s ease-in-out infinite alternate",
    },
    blueShape2: {
      position: "fixed", bottom: "10%", right: "0%", width: "400px", height: "400px",
      background: `linear-gradient(-45deg, ${ACCENT_TEAL}aa, ${PRIMARY_BLUE}33)`,
      borderRadius: "70% 30% 60% 40% / 60% 70% 30% 40%",
      opacity: 0.08, filter: "blur(100px)", zIndex: 0,
      animation: "subtleMove 20s ease-in-out infinite alternate-reverse",
    },

    // --- SIDEBAR (Fixed and branded) ---
    sidebar: {
      ...liquidGlassBase,
      width: "240px",
      minHeight: '100vh',
      margin: "0",
      position: 'fixed',
      left: 0,
      top: 0,
      borderRadius: "0 18px 18px 0",
      padding: "1.25rem",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      zIndex: 10,
      overflow: 'hidden',
    },
    
    brandContainer: {
      display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem", paddingBottom: "1rem",
      borderBottom: "1px solid rgba(0, 0, 0, 0.08)"
    },
    logoIcon: { width: "28px", height: "28px", borderRadius: "14px", overflow: "hidden" },
    logoImage: { width: "100%", height: "100%", objectFit: "cover" },
    brand: { fontWeight: "700", fontSize: "18px", margin: 0, color: PRIMARY_BLUE, letterSpacing: "-0.03em" },
    
    menu: { display: "flex", flexDirection: "column", gap: "6px" },

    menuScrollContainer: {
      height: '470px',
      overflowY: 'auto',
      marginBottom: '1rem',
      scrollbarWidth: 'none',
    },

    menuItem: {
      background: "transparent", border: "none", textAlign: "left", fontSize: "14px", color: hexToRgba(PRIMARY_BLUE, 0.8), cursor: "pointer",
      padding: "12px", borderRadius: "12px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", alignItems: "center", gap: "10px",
      fontWeight: "600",
    },
    menuItemActive: {
      background: `linear-gradient(135deg, ${hexToRgba(PRIMARY_BLUE, 0.15)}, ${hexToRgba(ACCENT_TEAL, 0.1)})`,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.25)}`, color: PRIMARY_BLUE, padding: "12px", borderRadius: "12px",
      display: "flex", alignItems: "center", gap: "10px", fontWeight: "700",
      boxShadow: "0 4px 12px rgba(0, 90, 139, 0.15)"
    },

    profileSection: {
      display: "flex", flexDirection: 'column', gap: "8px", marginBottom: "0.5rem",
    },
    profileInfo: { fontSize: '15px', fontWeight: '600', color: PRIMARY_BLUE },
    profileSubtext: { fontSize: '13px', color: hexToRgba(PRIMARY_BLUE, 0.7) },

    logoutBtn: {
      padding: "12px", borderRadius: "12px", border: "1px solid rgba(255, 59, 48, 0.25)",
      background: "linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 149, 0, 0.08))", color: "#FF3B30", cursor: "pointer",
      fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", width: "100%",
    },

    // --- HEADER ---
    headerContainer: {
      ...liquidGlassBase,
      padding: '1rem 1.5rem',
      marginBottom: '1.5rem',
      borderRadius: '16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
    headerTitle: {
      fontWeight: "800", fontSize: "24px", margin: 0, color: PRIMARY_BLUE, letterSpacing: "-0.03em"
    },
    searchContainer: {
      display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', 
      borderRadius: '12px', background: 'rgba(255, 255, 255, 0.8)', 
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}`
    },
    searchInput: { border: 'none', background: 'transparent', outline: 'none', flex: 1, padding: '0 10px', fontSize: '14px' },
  };
};

const MedicalClinicalContextRule = () => {
  const styles = getStyles();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Fix the URL decoding issue - handle spaces and encoding properly
  const queryParams = new URLSearchParams(location.search);
  let doctorId = queryParams.get("doctor_id");
  
  // If doctorId is not found in query params, try to extract from pathname
  if (!doctorId) {
    // Check if there's a URL-encoded space issue
    const pathParts = location.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    
    // Try to extract doctor_id from the path if it contains %20 or spaces
    if (lastPart.includes('%20') || lastPart.includes(' ')) {
      console.warn("URL encoding issue detected, attempting to fix...");
      // You might want to redirect to the correct URL format
      const fixedPath = lastPart.replace(/%20/g, '').replace(/ /g, '');
      // Extract doctor_id from query string if present in path
      const queryMatch = location.search.match(/doctor_id=([^&]+)/);
      if (queryMatch) {
        doctorId = queryMatch[1];
      }
    }
  }

  const [medicalCategoriesList, setMedicalCategoriesList] = useState([]);
  const [currentCategoriesList, setCurrentCategoriesList] = useState([]);
  const [showNewMedicalInput, setShowNewMedicalInput] = useState(false);
  const [showNewCurrentInput, setShowNewCurrentInput] = useState(false);
  const [newMedicalCategory, setNewMedicalCategory] = useState("");
  const [newCurrentCategory, setNewCurrentCategory] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [searchTerm, setSearchTerm] = useState('');
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    specialty: "",
    medicalContextRule: "",
    currentContextRule: "",
    medicalOutputCategories: [],
    currentOutputCategories: [],
    isActive: false
  });

  const [focusedField, setFocusedField] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [selectAllMedical, setSelectAllMedical] = useState(false);
  const [selectAllCurrent, setSelectAllCurrent] = useState(false);

  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // Authentication check
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/doctors/verify`,
          { credentials: "include" }
        );

        if (!res.ok) throw new Error("Not authenticated");

        const data = await res.json();
        const verifiedDoctorId = data.doctor.sys_user_id;

        if (doctorId && doctorId !== verifiedDoctorId) {
          console.warn("Doctor ID mismatch — blocking page");
          navigate("/login");
          return;
        }

        setAuthenticated(true);
      } catch (err) {
        navigate("/login");
      } finally {
        setAuthChecked(true);
      }
    };

    if (doctorId) {
      verifyAuth();
    } else {
      // If no doctorId, try to redirect to login
      navigate("/login");
    }
  }, [navigate, doctorId]);

  // Fetch doctor details
  useEffect(() => {
    if (!doctorId) return;

    const fetchDoctorDetails = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doctor_id: doctorId })
          }
        );

        const data = await res.json();

        if (data.status === "success") {
          setDoctorName(data.doctor_name);
          setDoctorSpeciality(data.doctor_speciality);
        }
      } catch (err) {
        console.error("Failed to load doctor details", err);
      }
    };

    fetchDoctorDetails();
  }, [doctorId]);

  // Fetch doctor and rules
useEffect(() => {
  if (!doctorId) return;

  const loadRules = async () => {
    try {
      // First try doctor rule
      const doctorRes = await fetch(
        `${API_BASE_URL}hms/users/data/context/get_ContextAdminDoctorRule/${doctorId}`,
        { credentials: "include" }
      );

      const doctorData = await doctorRes.json();

      if (doctorData.status === "success") {
        const rule = doctorData.data;

        setMedicalCategoriesList(rule.medical_context_categories || []);
        setCurrentCategoriesList(rule.current_context_categories || []);

        setFormData({
          specialty: rule.speciality || "",
          medicalContextRule: rule.medical_context_rule || "",
          currentContextRule: rule.current_context_rule || "",
          medicalOutputCategories: rule.medical_context_categories || [],
          currentOutputCategories: rule.current_context_categories || [],
          isActive: rule.is_active ?? true
        });

        return; // stop here
      }

      // If no doctor rule → load admin rule
      const adminRes = await fetch(
        `${API_BASE_URL}hms/users/data/context/get_ContextAdminRules`,
        { credentials: "include" }
      );

      const adminData = await adminRes.json();

      if (adminData.status === "success") {
        const matchedRule = adminData.data.find(
          (r) => r.speciality === doctorSpeciality
        );

        if (!matchedRule) return;

        setMedicalCategoriesList(matchedRule.medical_context_categories || []);
        setCurrentCategoriesList(matchedRule.current_context_categories || []);

        setFormData({
          specialty: matchedRule.speciality || "",
          medicalContextRule: matchedRule.medical_context_rule || "",
          currentContextRule: matchedRule.current_context_rule || "",
          medicalOutputCategories: matchedRule.medical_context_categories || [],
          currentOutputCategories: matchedRule.current_context_categories || [],
          isActive: matchedRule.is_active ?? true
        });
      }

    } catch (error) {
      console.error(error);
    }
  };

  loadRules();
}, [doctorId, doctorSpeciality]);

  const handleLogout = async () => {
    try {
      await fetch(
        `${API_BASE_URL}hms/users/auth/logout`,
        {
          method: "POST",
          credentials: "include",
        }
      );
    } finally {
      navigate("/login");
    }
  };

  const handleSearch = async (value) => {
    setSearchTerm(value);

    if (!doctorId) return;

    if (value.length < 2) {
      setPatients([]);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE_URL}hms/users/doctors/search?term=${encodeURIComponent(value)}&doctor_id=${doctorId}`
      );
      const data = await response.json();

      if (data.status === "success") {
        setPatients(data.patients);
      } else {
        setPatients([]);
      }
    } catch (err) {
      console.error("Search error:", err);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterPatient = () => {
    if (!doctorId) return alert("Doctor ID missing");
    navigate(`/register-patient?doctor_id=${doctorId}`);
  };

  // Handlers
  const handleInputChange = (field) => (e) => {
    setFormData(prev => ({
      ...prev,
      [field]: e.target.value
    }));
  };

  const handleAddMedicalCategory = () => {
    if (newMedicalCategory.trim()) {
      setMedicalCategoriesList(prev => [...prev, newMedicalCategory.trim()]);
      setFormData(prev => ({
        ...prev,
        medicalOutputCategories: [...prev.medicalOutputCategories, newMedicalCategory.trim()]
      }));
      setNewMedicalCategory("");
      setShowNewMedicalInput(false);
      setSelectAllMedical(formData.medicalOutputCategories.length + 1 === medicalCategoriesList.length + 1);
    }
  };

  const handleAddCurrentCategory = () => {
    if (newCurrentCategory.trim()) {
      setCurrentCategoriesList(prev => [...prev, newCurrentCategory.trim()]);
      setFormData(prev => ({
        ...prev,
        currentOutputCategories: [...prev.currentOutputCategories, newCurrentCategory.trim()]
      }));
      setNewCurrentCategory("");
      setShowNewCurrentInput(false);
      setSelectAllCurrent(formData.currentOutputCategories.length + 1 === currentCategoriesList.length + 1);
    }
  };

  const handleMedicalCategoryChange = (category) => {
    setFormData(prev => {
      const updated = prev.medicalOutputCategories.includes(category)
        ? prev.medicalOutputCategories.filter(c => c !== category)
        : [...prev.medicalOutputCategories, category];
      
      setSelectAllMedical(updated.length === medicalCategoriesList.length);
      
      return {
        ...prev,
        medicalOutputCategories: updated
      };
    });
  };

  const handleCurrentCategoryChange = (category) => {
    setFormData(prev => {
      const updated = prev.currentOutputCategories.includes(category)
        ? prev.currentOutputCategories.filter(c => c !== category)
        : [...prev.currentOutputCategories, category];
      
      setSelectAllCurrent(updated.length === currentCategoriesList.length);
      
      return {
        ...prev,
        currentOutputCategories: updated
      };
    });
  };

  const handleSelectAllMedical = () => {
    if (selectAllMedical) {
      setFormData(prev => ({
        ...prev,
        medicalOutputCategories: []
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        medicalOutputCategories: [...medicalCategoriesList]
      }));
    }
    setSelectAllMedical(!selectAllMedical);
  };

  const handleSelectAllCurrent = () => {
    if (selectAllCurrent) {
      setFormData(prev => ({
        ...prev,
        currentOutputCategories: []
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        currentOutputCategories: [...currentCategoriesList]
      }));
    }
    setSelectAllCurrent(!selectAllCurrent);
  };

  const handleToggle = () => {
    setFormData(prev => ({
      ...prev,
      isActive: !prev.isActive
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const payload = {
        doctor_id: doctorId,
        speciality: formData.specialty,
        medical_context_categories: formData.medicalOutputCategories,
        medical_context_rule: formData.medicalContextRule,
        current_context_categories: formData.currentOutputCategories,
        current_context_rule: formData.currentContextRule,
        is_active: formData.isActive
      };

      const response = await fetch(
        `${API_BASE_URL}hms/users/data/context/save_ContextAdminDoctorRule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();

      if (response.ok) {
        alert("✅ Configuration saved successfully!");
        console.log("Saved:", data);
      } else {
        alert("❌ Failed to save configuration");
        console.error(data);
      }

    } catch (error) {
      console.error("Save Error:", error);
      alert("❌ Something went wrong!");
    }
  };

  if (!authChecked) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: "600"
      }}>
        Verifying session...
      </div>
    );
  }

  if (!doctorId) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: "600",
        color: "#FF3B30"
      }}>
        Doctor ID is missing. Please login again.
      </div>
    );
  }

  // Stats data
  const stats = [
    {
      icon: "📋",
      label: "Medical Rules",
      value: formData.medicalContextRule ? 1 : 0,
      bgColor: "#e0f2fe",
      iconColor: "#0369a1",
    },
    {
      icon: "⚡",
      label: "Current Rules",
      value: formData.currentContextRule ? 1 : 0,
      bgColor: "#fef9c3",
      iconColor: "#854d0e",
    },
    {
      icon: "📊",
      label: "Categories",
      value: formData.medicalOutputCategories.length + formData.currentOutputCategories.length,
      bgColor: "#dcfce7",
      iconColor: "#166534",
    },
    {
      icon: "✅",
      label: "Status",
      value: formData.isActive ? "Active" : "Inactive",
      bgColor: "#f1f5f9",
      iconColor: "#475569",
    },
  ];

  return (
    <div style={styles.layout}>
      <style>{`
        @keyframes subtleMove {
          0% { transform: translate(0, 0); }
          100% { transform: translate(40px, -40px); }
        }
        .menu-scroll::-webkit-scrollbar {
          display: none;
        }
        .menu-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        * {
          transition: background-color 0.3s ease, border-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
        }
      `}</style>
      
      {/* Background Elements */}
      <div style={styles.blueShape1}></div>
      <div style={styles.blueShape2}></div>

      {/* ================= LEFT SIDEBAR (FIXED) ================= */}
      <aside style={styles.sidebar}>
        <div>
          {/* Branding */}
          <div style={styles.brandContainer}>
            <div style={styles.logoIcon}>
              <img
                src={logo}
                alt="DoctorAssist Logo"
                style={styles.logoImage}
              />
            </div>
            <span style={styles.brand}>DoctorAssist.AI</span>
          </div>

          {/* Profile Info */}
          <div style={styles.profileSection}>
            <div style={{ padding: '1px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <p style={styles.profileInfo}>
                {doctorName || "Loading..."}
              </p>
              <p style={styles.profileSubtext}>
                {doctorSpeciality || "Loading speciality..."}
              </p>
            </div>
          </div>

          {/* Scrollable Menu Container */}
{/* Scrollable Menu Container */}
<div className="menu-scroll" style={styles.menuScrollContainer}>
  <div style={styles.menu}>
    <button
      style={styles.menuItem}  // Changed from sidebarStyles.menuItem
      onClick={() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`)}
    >
      <Home size={18} />
      <span>Dashboard</span>
    </button>

    <button
      style={styles.menuItem}  // Changed from sidebarStyles.menuItem
      onClick={() => window.location.href = `/appointments?doctor_id=${doctorId}`}
    >
      <Settings size={18} />
      <span>Appointment</span>
    </button>
    
    <button style={styles.menuItem}>  {/* Changed from sidebarStyles.menuItem */}
      <Bed size={18} />
      <span>IPD/Ward Patients</span>
    </button>
    
    <button
      style={styles.menuItem}  // Changed from sidebarStyles.menuItem
      onClick={() => navigate(`/communication?doctor_id=${doctorId}`)}
    >
      <MessageCircle size={18} />
      <span>Communication View</span>
    </button>
    
    <button
      style={styles.menuItem}  // Changed from sidebarStyles.menuItem
      onClick={() => navigate(`/date-appointments?doctor_id=${doctorId}`)}
    >
      <Calendar size={18} />
      <span>Date-wise Appointments</span>
    </button>

    <button style={styles.menuItem}>  {/* Changed from sidebarStyles.menuItem */}
      <Activity size={18} />
      <span>Referrals</span>
    </button>
    
    <button
      style={styles.menuItem}  // Changed from sidebarStyles.menuItem
      onClick={() => window.location.href = `/opd-time-schedule?doctor_id=${doctorId}`}
    >
      <Calendar size={18} />
      <span>OPD Time Schedule</span>
    </button>
    
    <button
      style={{...styles.menuItem, ...styles.menuItemActive}}  // This was correct
      onClick={() => window.location.href = `/medical-clinical-context-rule-settings?doctor_id=${doctorId}`}
    >
      <Calendar size={18} />
      <span>Medical Clinical Context Rule Settings</span>
    </button>
    
    <button
      style={styles.menuItem}  // Changed from sidebarStyles.menuItem
      onClick={() => window.location.href = `/settings.html?doctor_id=${doctorId}`}
    >
      <Settings size={18} />
      <span>Node Settings</span>
    </button>
  </div>
</div>
        </div>

        {/* Logout Button */}
        <button style={styles.logoutBtn} onClick={handleLogout}>
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </aside>

      {/* ================= MAIN CONTENT AREA ================= */}
      <div style={styles.pageContent}>
        {/* Header with Search */}
        <div style={styles.headerContainer}>
          <h1 style={styles.headerTitle}>Medical Clinical Context Rule Settings</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            
            {searchTerm.length >= 2 && (
              <div style={{
                position: "absolute",
                top: "70px",
                right: "32px",
                width: "340px",
                background: "white",
                borderRadius: "12px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
                zIndex: 1000,
                overflow: "hidden"
              }}>
                {loading ? (
                  <div style={{ padding: "12px", textAlign: "center" }}>Searching...</div>
                ) : patients.length === 0 ? (
                  <div style={{ padding: "12px", textAlign: "center", color: "#999" }}>
                    No patients found
                  </div>
                ) : (
                  patients.map(p => (
                    <div
                      key={p.sys_user_id}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        borderBottom: "1px solid #eee"
                      }}
                      onClick={() => {
                        window.location.href = `/patients/${p.patient_id}`;
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: "12px", color: "#666" }}>
                        {p.hms_id} • {p.phone_number}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
           
          </div>
        </div>

        {/* Main Content */}
        <div style={{
          background: "rgba(255, 255, 255, 0.6)",
          backdropFilter: "blur(35px) saturate(180%)",
          WebkitBackdropFilter: "blur(35px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.85)",
          borderRadius: "18px",
          padding: "28px",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.06)",
        }}>
          {/* Stats Cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "20px",
            marginBottom: "30px",
          }}>
            {stats.map((stat, index) => (
              <div
                key={index}
                style={{
                  background: "white",
                  borderRadius: "16px",
                  padding: "20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "15px",
                  boxShadow: "0 4px 15px rgba(0, 0, 0, 0.03)",
                  border: "1px solid #eef2f6",
                  transition: "all 0.3s ease",
                  transform: hoveredCard === index ? "translateY(-5px)" : "none",
                  boxShadow: hoveredCard === index ? "0 20px 30px rgba(0, 0, 0, 0.1)" : "0 4px 15px rgba(0, 0, 0, 0.03)",
                }}
                onMouseEnter={() => setHoveredCard(index)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={{
                  width: "50px",
                  height: "50px",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                  background: stat.bgColor,
                  color: stat.iconColor,
                }}>
                  {stat.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 5px 0", fontWeight: "500" }}>
                    {stat.label}
                  </p>
                  <p style={{ fontSize: "24px", fontWeight: "700", color: "#1e293b", margin: "0", lineHeight: "1.2" }}>
                    {stat.value}
                    {typeof stat.value === "number" && stat.label === "Categories" && (
                      <span style={{ fontSize: "14px", color: "#94a3b8", fontWeight: "400", marginLeft: "5px" }}>selected</span>
                    )}
                    {typeof stat.value === "number" && stat.label !== "Categories" && (
                      <span style={{ fontSize: "14px", color: "#94a3b8", fontWeight: "400", marginLeft: "5px" }}>rules</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Main Form */}
          <form onSubmit={handleSubmit}>
            {/* Two Column Grid for Medical Context */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "25px",
              marginBottom: "25px",
            }}>
              {/* Medical Output Categories */}
              <div
                style={{
                  background: "white",
                  borderRadius: "24px",
                  padding: "28px",
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)",
                  border: "1px solid #f1f5f9",
                  transition: "all 0.3s ease",
                  transform: hoveredCard === "medicalOutput" ? "translateY(-3px)" : "none",
                }}
                onMouseEnter={() => setHoveredCard("medicalOutput")}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "24px",
                  paddingBottom: "16px",
                  borderBottom: "2px solid #f8fafc",
                }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    background: "#f1f5f9",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                    color: "#2563eb",
                  }}>📋</div>
                  <div>
                    <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", margin: "0" }}>
                      Medical Output Categories
                    </h2>
                    <p style={{ fontSize: "14px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                      Select output categories for medical context
                    </p>
                  </div>
                </div>
                
                <div style={{ marginBottom: "20px" }}>
                  <div style={{
                    border: "2px solid #e2e8f0",
                    borderRadius: "12px",
                    backgroundColor: "#fafcff",
                    padding: "16px",
                  }}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0 8px 12px 8px",
                      borderBottom: "2px solid #e2e8f0",
                      marginBottom: "12px",
                    }}>
                      <span style={{ fontWeight: "600", color: "#1e293b" }}>
                        Available Categories ({medicalCategoriesList.length})
                      </span>
                      <button
                        type="button"
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2563eb",
                          fontSize: "14px",
                          fontWeight: "600",
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          transition: "all 0.2s ease",
                        }}
                        onClick={handleSelectAllMedical}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#e2e8f0"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                      >
                        {selectAllMedical ? "Deselect All" : "Select All"}
                      </button>
                    </div>
                    
                    <div style={{
                      maxHeight: "250px",
                      overflowY: "auto",
                      marginBottom: "16px",
                    }}>
                      {medicalCategoriesList.map((category, index) => (
                        <div
                          key={index}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "10px 12px",
                            margin: "4px 0",
                            borderRadius: "8px",
                            transition: "background-color 0.2s ease",
                            cursor: "pointer",
                            background: formData.medicalOutputCategories.includes(category) 
                              ? "#eff6ff" 
                              : "transparent",
                          }}
                          onClick={() => handleMedicalCategoryChange(category)}
                        >
                          <input
                            type="checkbox"
                            checked={formData.medicalOutputCategories.includes(category)}
                            onChange={() => {}}
                            style={{
                              width: "20px",
                              height: "20px",
                              marginRight: "12px",
                              cursor: "pointer",
                              accentColor: "#2563eb",
                            }}
                          />
                          <span style={{
                            fontSize: "15px",
                            color: "#334155",
                            cursor: "pointer",
                            flex: 1,
                          }}>{category}</span>
                        </div>
                      ))}
                    </div>

                    {/* Add Category Section */}
                    <div style={{
                      marginTop: "16px",
                      borderTop: "2px dashed #e2e8f0",
                      paddingTop: "16px",
                    }}>
                      {!showNewMedicalInput ? (
                        <button
                          type="button"
                          style={{
                            background: "#2563eb",
                            border: "none",
                            borderRadius: "8px",
                            padding: "12px 16px",
                            color: "white",
                            fontSize: "14px",
                            fontWeight: "600",
                            cursor: "pointer",
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            transition: "all 0.2s ease",
                            boxShadow: "0 4px 6px rgba(37, 99, 235, 0.2)",
                          }}
                          onClick={() => setShowNewMedicalInput(true)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#1d4ed8";
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.boxShadow = "0 6px 12px rgba(37, 99, 235, 0.3)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "#2563eb";
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow = "0 4px 6px rgba(37, 99, 235, 0.2)";
                          }}
                        >
                          <span style={{ fontSize: "18px" }}>➕</span>
                          Add New Category
                        </button>
                      ) : (
                        <div>
                          <input
                            type="text"
                            value={newMedicalCategory}
                            onChange={(e) => setNewMedicalCategory(e.target.value)}
                            placeholder="Enter new category name..."
                            style={{
                              width: "100%",
                              padding: "12px 16px",
                              fontSize: "14px",
                              border: "2px solid #2563eb",
                              borderRadius: "8px",
                              marginBottom: "12px",
                              outline: "none",
                              backgroundColor: "white",
                              boxSizing: "border-box",
                            }}
                            autoFocus
                          />
                          <div style={{
                            display: "flex",
                            gap: "8px",
                            justifyContent: "flex-end",
                          }}>
                            <button
                              type="button"
                              style={{
                                background: "#ef4444",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: "6px",
                                fontSize: "14px",
                                fontWeight: "500",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                              }}
                              onClick={() => {
                                setShowNewMedicalInput(false);
                                setNewMedicalCategory("");
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = "#dc2626"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "#ef4444"}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              style={{
                                background: "#10b981",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: "6px",
                                fontSize: "14px",
                                fontWeight: "500",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                              }}
                              onClick={handleAddMedicalCategory}
                              onMouseEnter={(e) => e.currentTarget.style.background = "#059669"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "#10b981"}
                            >
                              Add Category
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div style={{
                    fontSize: "14px",
                    color: "#64748b",
                    marginTop: "12px",
                    padding: "8px 12px",
                    background: "#f1f5f9",
                    borderRadius: "8px",
                    display: "inline-block",
                  }}>
                    Selected: {formData.medicalOutputCategories.length} categories
                  </div>
                  
                  <span style={{
                    fontSize: "13px",
                    color: "#94a3b8",
                    marginTop: "12px",
                    display: "block",
                  }}>
                    Check the categories that will be used for medical context classification
                  </span>
                </div>
              </div>

              {/* Medical Context Rule */}
              <div
                style={{
                  background: "white",
                  borderRadius: "24px",
                  padding: "28px",
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)",
                  border: "1px solid #f1f5f9",
                  transition: "all 0.3s ease",
                  transform: hoveredCard === "medicalRule" ? "translateY(-3px)" : "none",
                }}
                onMouseEnter={() => setHoveredCard("medicalRule")}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "24px",
                  paddingBottom: "16px",
                  borderBottom: "2px solid #f8fafc",
                }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    background: "#f1f5f9",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                    color: "#2563eb",
                  }}>📝</div>
                  <div>
                    <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", margin: "0" }}>
                      Medical Context Rule
                    </h2>
                    <p style={{ fontSize: "14px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                      Define medical context rules and conditions
                    </p>
                  </div>
                </div>
                
                <div style={{ marginBottom: "20px" }}>
                  <label style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: "600",
                    color: "#334155",
                    marginBottom: "8px",
                  }}>Rule Definition</label>
                  <textarea
                    value={formData.medicalContextRule}
                    onChange={handleInputChange("medicalContextRule")}
                    onFocus={() => setFocusedField("medicalRule")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="IF diagnosis = 'hypertension' AND age > 60 THEN&#10;  priority = 'high'&#10;  monitoring = 'weekly'&#10;  medications = ['ACE inhibitors', 'CCB']&#10;END IF"
                    rows="8"
                    style={{
                      width: "100%",
                      padding: "14px 16px",
                      fontSize: "15px",
                      fontFamily: "inherit",
                      border: "2px solid #e2e8f0",
                      borderRadius: "12px",
                      backgroundColor: "#fafcff",
                      color: "#1e293b",
                      resize: "vertical",
                      transition: "all 0.2s ease",
                      boxSizing: "border-box",
                      lineHeight: "1.5",
                      ...(focusedField === "medicalRule" ? {
                        borderColor: "#2563eb",
                        backgroundColor: "#ffffff",
                        boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.1)",
                        outline: "none",
                      } : {}),
                    }}
                  />
                  <span style={{
                    fontSize: "13px",
                    color: "#94a3b8",
                    marginTop: "12px",
                    display: "block",
                  }}>
                    Use conditional logic to define medical context rules
                  </span>
                </div>
              </div>
            </div>

            {/* Two Column Grid for Current Context */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "25px",
              marginBottom: "25px",
            }}>
              {/* Current Output Categories */}
              <div
                style={{
                  background: "white",
                  borderRadius: "24px",
                  padding: "28px",
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)",
                  border: "1px solid #f1f5f9",
                  transition: "all 0.3s ease",
                  transform: hoveredCard === "currentOutput" ? "translateY(-3px)" : "none",
                }}
                onMouseEnter={() => setHoveredCard("currentOutput")}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "24px",
                  paddingBottom: "16px",
                  borderBottom: "2px solid #f8fafc",
                }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    background: "#f1f5f9",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                    color: "#2563eb",
                  }}>🎯</div>
                  <div>
                    <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", margin: "0" }}>
                      Current Output Categories
                    </h2>
                    <p style={{ fontSize: "14px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                      Select output categories for current context
                    </p>
                  </div>
                </div>
                
                <div style={{ marginBottom: "20px" }}>
                  <div style={{
                    border: "2px solid #e2e8f0",
                    borderRadius: "12px",
                    backgroundColor: "#fafcff",
                    padding: "16px",
                  }}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0 8px 12px 8px",
                      borderBottom: "2px solid #e2e8f0",
                      marginBottom: "12px",
                    }}>
                      <span style={{ fontWeight: "600", color: "#1e293b" }}>
                        Available Categories ({currentCategoriesList.length})
                      </span>
                      <button
                        type="button"
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2563eb",
                          fontSize: "14px",
                          fontWeight: "600",
                          cursor: "pointer",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          transition: "all 0.2s ease",
                        }}
                        onClick={handleSelectAllCurrent}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#e2e8f0"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                      >
                        {selectAllCurrent ? "Deselect All" : "Select All"}
                      </button>
                    </div>
                    
                    <div style={{
                      maxHeight: "250px",
                      overflowY: "auto",
                      marginBottom: "16px",
                    }}>
                      {currentCategoriesList.map((category, index) => (
                        <div
                          key={index}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "10px 12px",
                            margin: "4px 0",
                            borderRadius: "8px",
                            transition: "background-color 0.2s ease",
                            cursor: "pointer",
                            background: formData.currentOutputCategories.includes(category) 
                              ? "#eff6ff" 
                              : "transparent",
                          }}
                          onClick={() => handleCurrentCategoryChange(category)}
                        >
                          <input
                            type="checkbox"
                            checked={formData.currentOutputCategories.includes(category)}
                            onChange={() => {}}
                            style={{
                              width: "20px",
                              height: "20px",
                              marginRight: "12px",
                              cursor: "pointer",
                              accentColor: "#2563eb",
                            }}
                          />
                          <span style={{
                            fontSize: "15px",
                            color: "#334155",
                            cursor: "pointer",
                            flex: 1,
                          }}>{category}</span>
                        </div>
                      ))}
                    </div>

                    {/* Add Category Section */}
                    <div style={{
                      marginTop: "16px",
                      borderTop: "2px dashed #e2e8f0",
                      paddingTop: "16px",
                    }}>
                      {!showNewCurrentInput ? (
                        <button
                          type="button"
                          style={{
                            background: "#2563eb",
                            border: "none",
                            borderRadius: "8px",
                            padding: "12px 16px",
                            color: "white",
                            fontSize: "14px",
                            fontWeight: "600",
                            cursor: "pointer",
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            transition: "all 0.2s ease",
                            boxShadow: "0 4px 6px rgba(37, 99, 235, 0.2)",
                          }}
                          onClick={() => setShowNewCurrentInput(true)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#1d4ed8";
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.boxShadow = "0 6px 12px rgba(37, 99, 235, 0.3)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "#2563eb";
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow = "0 4px 6px rgba(37, 99, 235, 0.2)";
                          }}
                        >
                          <span style={{ fontSize: "18px" }}>➕</span>
                          Add New Category
                        </button>
                      ) : (
                        <div>
                          <input
                            type="text"
                            value={newCurrentCategory}
                            onChange={(e) => setNewCurrentCategory(e.target.value)}
                            placeholder="Enter new category name..."
                            style={{
                              width: "100%",
                              padding: "12px 16px",
                              fontSize: "14px",
                              border: "2px solid #2563eb",
                              borderRadius: "8px",
                              marginBottom: "12px",
                              outline: "none",
                              backgroundColor: "white",
                              boxSizing: "border-box",
                            }}
                            autoFocus
                          />
                          <div style={{
                            display: "flex",
                            gap: "8px",
                            justifyContent: "flex-end",
                          }}>
                            <button
                              type="button"
                              style={{
                                background: "#ef4444",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: "6px",
                                fontSize: "14px",
                                fontWeight: "500",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                              }}
                              onClick={() => {
                                setShowNewCurrentInput(false);
                                setNewCurrentCategory("");
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = "#dc2626"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "#ef4444"}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              style={{
                                background: "#10b981",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: "6px",
                                fontSize: "14px",
                                fontWeight: "500",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                              }}
                              onClick={handleAddCurrentCategory}
                              onMouseEnter={(e) => e.currentTarget.style.background = "#059669"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "#10b981"}
                            >
                              Add Category
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div style={{
                    fontSize: "14px",
                    color: "#64748b",
                    marginTop: "12px",
                    padding: "8px 12px",
                    background: "#f1f5f9",
                    borderRadius: "8px",
                    display: "inline-block",
                  }}>
                    Selected: {formData.currentOutputCategories.length} categories
                  </div>
                  
                  <span style={{
                    fontSize: "13px",
                    color: "#94a3b8",
                    marginTop: "12px",
                    display: "block",
                  }}>
                    Check the categories for current patient context and status
                  </span>
                </div>
              </div>

              {/* Current Context Rule */}
              <div
                style={{
                  background: "white",
                  borderRadius: "24px",
                  padding: "28px",
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)",
                  border: "1px solid #f1f5f9",
                  transition: "all 0.3s ease",
                  transform: hoveredCard === "currentRule" ? "translateY(-3px)" : "none",
                }}
                onMouseEnter={() => setHoveredCard("currentRule")}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "24px",
                  paddingBottom: "16px",
                  borderBottom: "2px solid #f8fafc",
                }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    background: "#f1f5f9",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                    color: "#2563eb",
                  }}>⚡</div>
                  <div>
                    <h2 style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", margin: "0" }}>
                      Current Context Rule
                    </h2>
                    <p style={{ fontSize: "14px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                      Define current context rules and conditions
                    </p>
                  </div>
                </div>
                
                <div style={{ marginBottom: "20px" }}>
                  <label style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: "600",
                    color: "#334155",
                    marginBottom: "8px",
                  }}>Rule Definition</label>
                  <textarea
                    value={formData.currentContextRule}
                    onChange={handleInputChange("currentContextRule")}
                    onFocus={() => setFocusedField("currentRule")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="IF symptoms = 'chest pain' AND vitals = 'unstable' THEN&#10;  priority = 'emergency'&#10;  action = 'immediate consultation'&#10;  department = 'cardiology'&#10;END IF"
                    rows="8"
                    style={{
                      width: "100%",
                      padding: "14px 16px",
                      fontSize: "15px",
                      fontFamily: "inherit",
                      border: "2px solid #e2e8f0",
                      borderRadius: "12px",
                      backgroundColor: "#fafcff",
                      color: "#1e293b",
                      resize: "vertical",
                      transition: "all 0.2s ease",
                      boxSizing: "border-box",
                      lineHeight: "1.5",
                      ...(focusedField === "currentRule" ? {
                        borderColor: "#2563eb",
                        backgroundColor: "#ffffff",
                        boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.1)",
                        outline: "none",
                      } : {}),
                    }}
                  />
                  <span style={{
                    fontSize: "13px",
                    color: "#94a3b8",
                    marginTop: "12px",
                    display: "block",
                  }}>
                    Define rules based on current patient context
                  </span>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div style={{
              background: "white",
              borderRadius: "20px",
              padding: "24px 28px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "20px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)",
              border: "1px solid #f1f5f9",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "15px",
              }}>
                <span style={{
                  fontSize: "15px",
                  fontWeight: "600",
                  color: "#334155",
                }}>Rule Status:</span>
                <div style={{
                  position: "relative",
                  width: "56px",
                  height: "30px",
                }}>
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={handleToggle}
                    style={{
                      opacity: 0,
                      width: 0,
                      height: 0,
                      position: "absolute",
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      cursor: "pointer",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: formData.isActive ? "#2563eb" : "#cbd5e1",
                      transition: "0.3s",
                      borderRadius: "30px",
                    }}
                    onClick={handleToggle}
                  >
                    <span
                      style={{
                        position: "absolute",
                        height: "26px",
                        width: "26px",
                        left: formData.isActive ? "28px" : "2px",
                        bottom: "2px",
                        backgroundColor: "white",
                        transition: "0.3s",
                        borderRadius: "50%",
                        boxShadow: "0 2px 5px rgba(0, 0, 0, 0.2)",
                      }}
                    />
                  </span>
                </div>
                <span
                  style={{
                    padding: "6px 14px",
                    borderRadius: "100px",
                    fontSize: "14px",
                    fontWeight: "600",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: formData.isActive ? "#dcfce7" : "#fee2e2",
                    color: formData.isActive ? "#166534" : "#991b1b",
                  }}
                >
                  <span>●</span>
                  {formData.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}>
                <button
                  type="submit"
                  style={{
                    padding: "12px 24px",
                    borderRadius: "12px",
                    fontSize: "15px",
                    fontWeight: "600",
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "all 0.3s ease",
                    background: "linear-gradient(145deg, #2563eb, #1d4ed8)",
                    color: "white",
                    boxShadow: "0 8px 16px rgba(37, 99, 235, 0.2)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 12px 20px rgba(37, 99, 235, 0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 8px 16px rgba(37, 99, 235, 0.2)";
                  }}
                >
                  <span>💾</span>
                  Save Configuration
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default MedicalClinicalContextRule;