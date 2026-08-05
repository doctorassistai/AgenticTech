import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Eye, EyeOff, Phone, Mail, User, Lock, GraduationCap, FileText, MapPin,
  ChevronDown, Stethoscope, Users, Home, UserPlus, Calendar, LogOut,
  Building, Clipboard, BarChart3, Settings, Bell, Search, BriefcaseMedical,
  LayoutDashboard, Activity, ShoppingCart, TrendingUp, Menu, X, Zap
} from "lucide-react";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function ClinicalNurseRegister() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Get clinic_id from URL
  const queryParams = new URLSearchParams(location.search);
  const clinicId = queryParams.get("clinic_id");

  // --- DARK THEME COLORS ---
  const PRIMARY_BLUE = "#3b82f6";
  const ACCENT_PURPLE = "#8b5cf6";
  const ACCENT_TEAL = "#06b6d4";
  const DARK_BG = "#0a0a0f";
  const DARK_CARD = "rgba(20, 20, 30, 0.6)";
  // -------------------------

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

  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    country_code: "ZW",
    phone_number: "",
    password: "",
    doctor_id: "",
    qualifications: "",
    registeration_number: "",
    address: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);

  const countryDropdownRef = useRef(null);
  const doctorDropdownRef = useRef(null);

  // Menu Item Component - Exact style from ClinicDashboard
  const MenuItem = ({ icon: Icon, label, active, onClick }) => (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "12px",
        background: active ? "rgba(59, 130, 246, 0.15)" : "transparent",
        color: active ? "#3b82f6" : "rgba(255, 255, 255, 0.7)",
        cursor: "pointer",
        transition: "all 0.2s ease",
        margin: "4px 0",
      }}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
          e.currentTarget.style.color = "#fff";
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
        }
      }}
    >
      <Icon size={20} />
      {sidebarOpen && (
        <span style={{ fontSize: "15px", fontWeight: "500" }}>{label}</span>
      )}
    </div>
  );

  // 🔐 Authentication verification
  useEffect(() => {
    if (!clinicId) navigate("/login");
  }, [clinicId, navigate]);

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/hms/users/hospitals/verify`,
          { credentials: "include" }
        );

        if (!res.ok) throw new Error("Not authenticated");

        const data = await res.json();
        const verifiedClinicId = data.hospital.sys_user_id;

        if (!clinicId || clinicId !== verifiedClinicId) {
          console.warn("Clinic ID mismatch — access denied");
          navigate("/login");
          return;
        }

        setAuthenticated(true);
        fetchDoctors();
        
      } catch (err) {
        console.error("Clinic auth failed", err);
        navigate("/login");
      } finally {
        setAuthChecked(true);
      }
    };

    verifyAuth();
  }, [clinicId, navigate]);

  const fetchDoctors = async () => {
    if (!clinicId) return;
    
    setLoadingDoctors(true);
    try {
      console.log("👨‍⚕️ Fetching doctors for clinic:", clinicId);
      
      const response = await fetch(
        `${API_BASE_URL}/hms/users/data/get_doctors_list/${clinicId}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setDoctors(data.doctors || []);
        console.log("👨‍⚕️ Doctors fetched:", data.doctors?.length || 0);
      } else {
        console.error("Failed to fetch doctors, status:", response.status);
        setMessage("Could not load doctors list. Please try again.");
      }
    } catch (error) {
      console.error("Error fetching doctors:", error);
      setMessage("Error loading doctors. Please refresh the page.");
    } finally {
      setLoadingDoctors(false);
    }
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target)) {
        setShowCountryDropdown(false);
      }
      if (doctorDropdownRef.current && !doctorDropdownRef.current.contains(event.target)) {
        setShowDoctorDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "phone_number") {
      const digitsOnly = value.replace(/\D/g, '');
      setFormData({ ...formData, [name]: digitsOnly });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleCountrySelect = (code) => {
    setFormData({ ...formData, country_code: code });
    setShowCountryDropdown(false);
  };

  const handleDoctorSelect = (doctorId) => {
    setFormData({ ...formData, doctor_id: doctorId });
    setShowDoctorDropdown(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!authenticated) {
      setMessage("Please complete authentication first.");
      return;
    }

    if (!formData.doctor_id) {
      setMessage("❌ Please select an assigned doctor");
      return;
    }
    
    setLoading(true);
    setMessage("Registering nurse...");

    const submitData = {
      name: formData.name,
      username: formData.username,
      email: formData.email || null,
      country_code: formData.country_code,
      phone_number: formData.phone_number,
      password: formData.password,
      hospital_id: clinicId,
      doctor_id: formData.doctor_id,
      qualifications: formData.qualifications || null,
      registeration_number: formData.registeration_number || null,
      address: formData.address || null,
    };

    console.log("📤 Submitting nurse registration:", submitData);

    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/users/doctors/nurseadd`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(submitData),
        }
      );

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || "Registration failed on server.");
      }

      setMessage("✅ Nurse registered successfully!");
      setTimeout(
        () => navigate(`/clinic-dashboard?clinic_id=${clinicId}`),
        1200
      );
      
    } catch (error) {
      console.error("❌ Registration error:", error);
      setMessage(`❌ Registration failed: ${error.message || "Server error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/users/auth/logout`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        }
      );

      if (response.ok) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleAddDoctor = () => {
    if (!clinicId) return alert("Clinic ID missing");
    window.location.href = `/clinic-doctor-register?clinic_id=${clinicId}`;
  };

  const handleAddNurse = () => {
    if (!clinicId) return alert("Clinic ID missing");
    window.location.href = `/clinical-nurse-register?clinic_id=${clinicId}`;
  };

  const handleClinicalEngine = () => {
    window.location.href = `/login`;
  };

  const handleCommunicationNode = () => {
    if (!clinicId) return alert("Clinic ID missing");
    window.location.href = `/appointment-dashboard?clinic_id=${clinicId}`;
  };

  const handleOpdSchedule = () => {
    if (!clinicId) return alert("Clinic ID missing");
    window.location.href = `/opd-time-schedule-hospital?clinic_id=${clinicId}`;
  };

  const handlePreScreening = () => {
    if (!clinicId) return alert("Clinic ID missing");
    window.location.href = `/pre-screening-questions?clinic_id=${clinicId}`;
  };

  const selectedCountry = countryCodes.find(
    (c) => c.code === formData.country_code
  );

  const selectedDoctor = doctors.find(
    (d) => d.sys_user_id === formData.doctor_id
  );

  // Helper to convert hex to rgba
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Loading state
  if (!authChecked) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: DARK_BG,
          color: "#fff",
          fontSize: "16px",
          fontWeight: "600"
        }}
      >
        Verifying session...
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)",
        display: "flex",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Sidebar - Exact style and links from ClinicDashboard */}
      <div
        style={{
          width: sidebarOpen ? "280px" : "80px",
          background: "rgba(20, 20, 30, 0.4)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "24px",
          transition: "all 0.3s ease",
          position: "relative",
          boxShadow: "4px 0 24px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "100%",
            background: "radial-gradient(circle at top left, rgba(59, 130, 246, 0.1), transparent)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "32px",
            position: "relative",
            zIndex: 1,
          }}
        >
          {sidebarOpen && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Zap size={24} style={{ color: "#fff" }} />
              </div>
              <span
                style={{ fontSize: "20px", fontWeight: "700", color: "#fff" }}
              >
                Clinical Hub
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
              transition: "all 0.2s ease",
              marginLeft: sidebarOpen ? "0" : "auto",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
            }}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <MenuItem 
            icon={LayoutDashboard} 
            label="Overview" 
            active={false}
            onClick={() => {
              if (clinicId) {
                window.location.href = `/clinic-dashboard?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
          />
          <MenuItem 
            icon={Users} 
            label="Add Doctors" 
            active={false}
            onClick={handleAddDoctor}
          />
          <MenuItem 
            icon={Users} 
            label="Add Nurse" 
            active={true}
            onClick={handleAddNurse}
          />
          <MenuItem 
            icon={Activity} 
            label="Clinical Engine" 
            onClick={handleClinicalEngine}
          />
          <MenuItem 
            icon={Users} 
            label="Communication node" 
            onClick={handleCommunicationNode}
          />
          <MenuItem 
            icon={Users} 
            label="Opd Doctor Schedule" 
            onClick={handleOpdSchedule}
          />
          <MenuItem 
            icon={Users} 
            label="Pre Screening Questions" 
            onClick={handlePreScreening}
          />
          <MenuItem 
            icon={Settings} 
            label="Settings" 
            onClick={() => {}}
          />
        </div>

        {/* Profile Section */}
        <div style={{ position: "absolute", bottom: "24px", left: "24px", right: "24px" }}>
          <div
            style={{
              background: "rgba(255, 255, 255, 0.03)",
              padding: "16px",
              borderRadius: "16px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              marginBottom: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_PURPLE})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <User size={18} color="white" />
              </div>
              {sidebarOpen && (
                <div>
                  <p style={{ color: "#fff", fontWeight: "600", margin: 0, fontSize: "14px" }}>
                    Clinic Admin
                  </p>
                  <p style={{ color: "rgba(255, 255, 255, 0.5)", margin: 0, fontSize: "12px" }}>
                    ID: {clinicId?.substring(0, 8)}...
                  </p>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "14px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "12px",
              color: "#ef4444",
              fontSize: "15px",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
            }}
          >
            <LogOut size={18} />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Header */}
        <div
          style={{
            padding: "24px 32px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(20, 20, 30, 0.3)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h1
                style={{
                  color: "#fff",
                  fontSize: "28px",
                  fontWeight: "700",
                  margin: "0 0 4px 0",
                }}
              >
                Register New Nurse
              </h1>
              <p style={{ color: "rgba(255, 255, 255, 0.6)", margin: 0 }}>
                Add a nursing professional to your healthcare team
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Search
                  size={20}
                  style={{
                    position: "absolute",
                    left: "16px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                />
                <input
                  placeholder="Search..."
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "12px",
                    padding: "10px 16px 10px 48px",
                    color: "#fff",
                    fontSize: "14px",
                    width: "240px",
                    outline: "none",
                  }}
                />
              </div>
              <button
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "12px",
                  width: "44px",
                  height: "44px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  position: "relative",
                }}
              >
                <Bell size={20} />
                <div
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ef4444",
                  }}
                />
              </button>
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "12px",
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  color: "#fff",
                  fontSize: "14px",
                }}
              >
                <Calendar size={16} style={{ color: PRIMARY_BLUE }} />
                {new Date().toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Form Container */}
        <div style={{ padding: "32px" }}>
          <div
            style={{
              background: "rgba(20, 20, 30, 0.6)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "24px",
              overflow: "hidden",
            }}
          >
            <div className="flex flex-col lg:flex-row">
              {/* Left Side - Image */}
              <div className="lg:w-2/5 relative overflow-hidden hidden lg:block">
                <img 
                  src="https://images.pexels.com/photos/3992938/pexels-photo-3992938.jpeg?auto=compress&cs=tinysrgb&w=800" 
                  alt="Nurse Registration" 
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
                    display: "flex",
                    alignItems: "flex-end",
                    padding: "24px",
                  }}
                >
                  <div>
                    <h2 style={{ color: "#fff", fontSize: "24px", fontWeight: "700", marginBottom: "4px" }}>
                      Compassionate Care
                    </h2>
                    <p style={{ color: "rgba(255, 255, 255, 0.8)", fontSize: "14px", margin: 0 }}>
                      Join our dedicated nursing team
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Side - Form */}
              <div className="lg:w-3/5 p-8">
                <div style={{ marginBottom: "24px" }}>
                  <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "12px", margin: "4px 0 0 0" }}>
                    <strong>Clinic ID:</strong> {clinicId}
                  </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
                    {/* Name Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <User style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Full Name
                      </label>
                      <input
                        name="name"
                        placeholder="Nurse Sarah Johnson"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        className="dark-input"
                      />
                    </div>

                    {/* Username Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <User style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Username
                      </label>
                      <input
                        name="username"
                        placeholder="nurse.sarah"
                        value={formData.username}
                        onChange={handleChange}
                        required
                        className="dark-input"
                      />
                    </div>

                    {/* Email Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <Mail style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Email Address
                      </label>
                      <input
                        type="email"
                        name="email"
                        placeholder="nurse@hospital.com"
                        value={formData.email}
                        onChange={handleChange}
                        className="dark-input"
                      />
                    </div>

                    {/* Country Code Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <Phone style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Country
                      </label>
                      <div style={{ position: "relative" }} ref={countryDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                          className="dark-input"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", fontSize: "14px" }}>
                            <span style={{ marginRight: "12px", fontSize: "16px" }}>{selectedCountry.flag}</span>
                            <span style={{ color: "#fff" }}>{selectedCountry.country} ({selectedCountry.code})</span>
                          </span>
                          <ChevronDown style={{ width: "16px", height: "16px", color: "rgba(255, 255, 255, 0.5)" }} />
                        </button>
                        {showCountryDropdown && (
                          <div 
                            style={{
                              position: "absolute",
                              zIndex: 50,
                              marginTop: "4px",
                              width: "100%",
                              background: "#1a1a2e",
                              borderRadius: "12px",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              overflow: "hidden",
                              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                            }}
                          >
                            <div style={{ overflowY: "auto", maxHeight: "300px" }}>
                              {countryCodes.map((country) => (
                                <button
                                  key={country.code}
                                  type="button"
                                  onClick={() => handleCountrySelect(country.code)}
                                  style={{
                                    backgroundColor: formData.country_code === country.code ? "rgba(59, 130, 246, 0.15)" : "transparent",
                                    borderLeft: formData.country_code === country.code ? `4px solid ${PRIMARY_BLUE}` : "4px solid transparent",
                                    display: "flex",
                                    alignItems: "center",
                                    width: "100%",
                                    transition: "all 0.2s",
                                    color: "#fff",
                                    padding: "12px 16px",
                                    textAlign: "left",
                                    border: "none",
                                    cursor: "pointer",
                                  }}
                                  onMouseOver={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
                                  }}
                                  onMouseOut={(e) => {
                                    if (formData.country_code !== country.code) {
                                      e.currentTarget.style.backgroundColor = "transparent";
                                    }
                                  }}
                                >
                                  <span style={{ marginRight: "12px", fontSize: "18px", minWidth: "32px" }}>{country.flag}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: "500", fontSize: "14px" }}>{country.country}</div>
                                    <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)" }}>Code: {country.code}</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Phone Number Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <Phone style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Phone Number
                      </label>
                      <input
                        name="phone_number"
                        placeholder="9876543210"
                        value={formData.phone_number}
                        onChange={handleChange}
                        required
                        className="dark-input"
                        maxLength={15}
                      />
                      <p style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)", margin: "4px 0 0 0" }}>
                        Enter digits only (no country code)
                      </p>
                    </div>

                    {/* Password Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <Lock style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Password
                      </label>
                      <div style={{ position: "relative" }}>
                        <input
                          type={showPassword ? "text" : "password"}
                          name="password"
                          placeholder="••••••••"
                          value={formData.password}
                          onChange={handleChange}
                          required
                          className="dark-input"
                          style={{ paddingRight: "40px" }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          style={{
                            position: "absolute",
                            right: "12px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            color: "rgba(255, 255, 255, 0.5)",
                            cursor: "pointer",
                          }}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Assigned Doctor Dropdown */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", gridColumn: "span 2" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <Stethoscope style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Assigned Doctor <span style={{ color: "#ef4444", marginLeft: "4px" }}>*</span>
                      </label>
                      <div style={{ position: "relative" }} ref={doctorDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowDoctorDropdown(!showDoctorDropdown)}
                          className="dark-input"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                            cursor: loadingDoctors ? "wait" : "pointer",
                          }}
                          disabled={loadingDoctors}
                        >
                          <span style={{ display: "flex", alignItems: "center", fontSize: "14px", color: "#fff" }}>
                            <Users style={{ width: "16px", height: "16px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                            {selectedDoctor ? (
                              <>
                                <span style={{ fontWeight: "500" }}>{selectedDoctor.name}</span>
                                <span style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)", marginLeft: "8px" }}>
                                  ({selectedDoctor.specialization || 'General'})
                                </span>
                              </>
                            ) : (
                              <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>
                                {loadingDoctors ? "Loading doctors..." : "Select a doctor to assign"}
                              </span>
                            )}
                          </span>
                          <ChevronDown style={{ width: "16px", height: "16px", color: "rgba(255, 255, 255, 0.5)" }} />
                        </button>
                        {showDoctorDropdown && (
                          <div 
                            style={{
                              position: "absolute",
                              zIndex: 50,
                              marginTop: "4px",
                              width: "100%",
                              background: "#1a1a2e",
                              borderRadius: "12px",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              overflow: "hidden",
                              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                            }}
                          >
                            <div style={{ overflowY: "auto", maxHeight: "300px" }}>
                              {doctors.length > 0 ? (
                                doctors.map((doctor) => (
                                  <button
                                    key={doctor.sys_user_id}
                                    type="button"
                                    onClick={() => handleDoctorSelect(doctor.sys_user_id)}
                                    style={{
                                      backgroundColor: formData.doctor_id === doctor.sys_user_id ? "rgba(59, 130, 246, 0.15)" : "transparent",
                                      borderLeft: formData.doctor_id === doctor.sys_user_id ? `4px solid ${PRIMARY_BLUE}` : "4px solid transparent",
                                      display: "flex",
                                      alignItems: "center",
                                      width: "100%",
                                      transition: "all 0.2s",
                                      color: "#fff",
                                      padding: "12px 16px",
                                      textAlign: "left",
                                      border: "none",
                                      cursor: "pointer",
                                    }}
                                    onMouseOver={(e) => {
                                      e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
                                    }}
                                    onMouseOut={(e) => {
                                      if (formData.doctor_id !== doctor.sys_user_id) {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                      }
                                    }}
                                  >
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontWeight: "500", fontSize: "14px" }}>{doctor.name}</div>
                                      <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)" }}>
                                        {doctor.specialization || 'General Medicine'}
                                      </div>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <div style={{ padding: "12px 16px", color: "rgba(255, 255, 255, 0.5)", fontSize: "14px" }}>
                                  {loadingDoctors ? "Loading doctors..." : "No doctors available"}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Qualifications Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <GraduationCap style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Qualifications
                      </label>
                      <input
                        name="qualifications"
                        placeholder="BSN, RN, CCRN, etc."
                        value={formData.qualifications}
                        onChange={handleChange}
                        className="dark-input"
                      />
                    </div>

                    {/* Registration Number Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                        <FileText style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                        Registration Number
                      </label>
                      <input
                        name="registeration_number"
                        placeholder="Nursing Council Registration Number"
                        value={formData.registeration_number}
                        onChange={handleChange}
                        className="dark-input"
                      />
                    </div>
                  </div>

                  {/* Address Field */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "500", color: "rgba(255, 255, 255, 0.8)" }}>
                      <MapPin style={{ width: "14px", height: "14px", marginRight: "8px", color: "rgba(255, 255, 255, 0.5)" }} />
                      Address
                    </label>
                    <textarea
                      name="address"
                      placeholder="Residential or work address..."
                      rows={2}
                      value={formData.address}
                      onChange={handleChange}
                      className="dark-input"
                      style={{ height: "70px", paddingTop: "10px", paddingBottom: "10px", resize: "none" }}
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={loading || !authenticated || !formData.doctor_id}
                    style={{
                      width: "100%",
                      padding: "14px 24px",
                      fontSize: "16px",
                      fontWeight: "700",
                      borderRadius: "12px",
                      border: "none",
                      background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_PURPLE})`,
                      color: "#fff",
                      cursor: loading || !authenticated || !formData.doctor_id ? "not-allowed" : "pointer",
                      opacity: loading || !authenticated || !formData.doctor_id ? 0.6 : 1,
                      transition: "all 0.3s ease",
                      boxShadow: `0 4px 16px ${hexToRgba(PRIMARY_BLUE, 0.3)}`,
                    }}
                    onMouseOver={(e) => {
                      if (!loading && authenticated && formData.doctor_id) {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = `0 6px 20px ${hexToRgba(PRIMARY_BLUE, 0.5)}`;
                      }
                    }}
                    onMouseOut={(e) => {
                      if (!loading && authenticated && formData.doctor_id) {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = `0 4px 16px ${hexToRgba(PRIMARY_BLUE, 0.3)}`;
                      }
                    }}
                  >
                    {loading ? (
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                        <svg className="animate-spin" style={{ width: "20px", height: "20px" }} viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Registering...
                      </span>
                    ) : (
                      "Register Nurse"
                    )}
                  </button>
                </form>

                {/* Message Display */}
                {message && (
                  <div style={{
                    marginTop: "20px",
                    padding: "12px",
                    borderRadius: "8px",
                    textAlign: "center",
                    fontSize: "14px",
                    fontWeight: "500",
                    backgroundColor: message.includes('✅') ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                    color: message.includes('✅') ? "#10b981" : "#ef4444",
                    border: `1px solid ${message.includes('✅') ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                  }}>
                    {message}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CSS Styles */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        
        .dark-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 10px 14px;
          height: 44px;
          font-size: 14px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          color: #fff;
          width: 100%;
          outline: none;
        }

        .dark-input:focus {
          border-color: ${PRIMARY_BLUE};
          background: rgba(255, 255, 255, 0.1);
          box-shadow: 0 0 0 3px ${hexToRgba(PRIMARY_BLUE, 0.15)};
        }

        .dark-input::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }

        textarea.dark-input {
          font-family: inherit;
        }

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

export default ClinicalNurseRegister;