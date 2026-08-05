import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Phone, Mail, User, Lock, BriefcaseMedical, GraduationCap, FileText, MapPin, ChevronDown, AlertCircle ,  LayoutDashboard,
  Users,
  Activity,
  Settings,
  Zap,} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function ClinicDoctorRegister() {
  const navigate = useNavigate();
  const location = useLocation();

  // Get clinic_id from URL
  const queryParams = new URLSearchParams(location.search);
  const clinicId = queryParams.get("clinic_id");

  console.log("🔍 Clinic ID from URL:", clinicId);
  console.log("🌐 Full URL:", window.location.href);

  const BLACK_PRIMARY = "#0a0a0a";
  const BLACK_SECONDARY = "#1a1a1a";
  const BLACK_ACCENT = "#2d2d2d";
  const GOLD_ACCENT = "#d4af37";
  const SILVER_ACCENT = "#c0c0c0";

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
    "General Medicine",
    "Oncology",
    "Cardiology",
    "Pulmonology",
    "Endocrinology",
    "Gastroenterology",
    "Nephrology",
  ];

  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    country_code: "ZW",
    phone_number: "",
    password: "",
    specialization: "",
    qualifications: "",
    registeration_number: "",
    address: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showSpecializationDropdown, setShowSpecializationDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const countryDropdownRef = useRef(null);
  const specializationDropdownRef = useRef(null);

  // Verify clinic authentication
  useEffect(() => {
    const verifyAuth = async () => {
      if (!clinicId) {
        console.error("❌ No clinic_id in URL");
        setMessage("Please go back to dashboard and try again.");
        setAuthChecked(true);
        return;
      }

      try {
        console.log("🔐 Verifying authentication...");
        
        const response = await fetch(
          `${API_BASE_URL}hms/users/hospitals/verify`,
          {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
            },
          }
        );

        console.log("📥 Response status:", response.status);

        if (!response.ok) {
          throw new Error(`Authentication failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Authentication successful, response:", data);
        
        // Try to find the clinic/hospital ID
        const verifiedId = 
          data.hospital?.sys_user_id || 
          data.user?.sys_user_id || 
          data.sys_user_id || 
          data.hospital_id || 
          data.clinic_id;
        
        if (!verifiedId) {
          throw new Error("No clinic ID found in verification response");
        }
        
        // Compare with URL clinic ID
        if (clinicId !== verifiedId) {
          console.warn("⚠️ ID mismatch - URL:", clinicId, "Backend:", verifiedId);
          throw new Error("Clinic ID mismatch");
        }

        console.log("🎉 SUCCESS: Clinic verified!");
        setAuthenticated(true);
        
      } catch (error) {
        console.error("❌ Authentication failed:", error);
        setMessage(`Authentication failed: ${error.message}`);
      } finally {
        setAuthChecked(true);
      }
    };

    if (clinicId) {
      verifyAuth();
    } else {
      setAuthChecked(true);
    }
  }, [clinicId, navigate]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target)) {
        setShowCountryDropdown(false);
      }
      if (specializationDropdownRef.current && !specializationDropdownRef.current.contains(event.target)) {
        setShowSpecializationDropdown(false);
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

  const handleSpecializationSelect = (specialization) => {
    setFormData({ ...formData, specialization });
    setShowSpecializationDropdown(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!authenticated) {
      setMessage("Please complete authentication first.");
      return;
    }
    
    setLoading(true);
    setMessage("Registering doctor...");

    const submitData = {
      ...formData,
      hospital_id: clinicId,
    };

    try {
      const response = await fetch(
        `${API_BASE_URL}hms/users/doctors/doctoradd`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(submitData),
        }
      );

      console.log("Registration response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed: ${errorText}`);
      }

      const data = await response.json();
      console.log("Registration successful:", data);
      
      setMessage("✅ Doctor registered successfully!");
      setTimeout(() => {
        navigate(`/clinic-dashboard?clinic_id=${clinicId}`);
      }, 1500);
      
    } catch (error) {
      console.error("Registration error:", error);
      setMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectedCountry = countryCodes.find(
    (c) => c.code === formData.country_code
  );

  // Loading state
  if (!authChecked) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#ffffff"
        }}
      >
        <div style={{ marginBottom: '20px' }}>
          <AlertCircle size={32} style={{ color: '#f59e0b' }} />
        </div>
        <div>Verifying clinic session...</div>
        <div style={{ fontSize: '12px', marginTop: '10px', color: '#888' }}>
          clinic_id: {clinicId || 'Not found'}
        </div>
      </div>
    );
  }

  // Not authenticated state
  if (!authenticated) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#ffffff"
        }}
      >
        <div style={{ marginBottom: '20px' }}>
          <AlertCircle size={32} style={{ color: '#ef4444' }} />
        </div>
        <div>Authentication failed!</div>
        <div style={{ fontSize: '14px', marginTop: '10px', color: '#888' }}>
          {message || "Please check your session and try again."}
        </div>
        <button
          onClick={() => navigate("/login")}
          style={{
            marginTop: '20px',
            padding: '10px 20px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Go to Login
        </button>
      </div>
    );
  }

  // Main form (authenticated)
  return (
          <div className="min-h-screen font-modern flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        marginLeft: "280px",
        width: "calc(100% - 280px)",
        background: `linear-gradient(135deg, ${BLACK_PRIMARY} 0%, ${BLACK_SECONDARY} 50%, #000000 100%)`,
        backgroundAttachment: 'fixed'
      }}>
      
      {/* Sidebar */}
      <div
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: "280px",
          background: "rgba(20, 20, 30, 0.95)", // Darker background
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "24px",
          boxShadow: "4px 0 24px rgba(0, 0, 0, 0.5)",
          zIndex: 1000,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "100%",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.15), transparent)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "32px",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
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

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Menu Item: Overview */}
          <div
            onClick={() => window.location.href = `/clinic-dashboard?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <LayoutDashboard size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Overview</span>
          </div>

          {/* Menu Item: Add Doctors (Current Page - Active) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "rgba(59, 130, 246, 0.2)",
              color: "#3b82f6",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
              borderLeft: "3px solid #3b82f6",
            }}
          >
            <Users size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Add Doctors</span>
          </div>

          {/* Menu Item: Clinical Engine */}
          <div
            onClick={() => window.location.href = `/login`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Activity size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Clinical Engine</span>
          </div>

          {/* Menu Item: Communication node */}
          <div
            onClick={() => {
              if (clinicId) {
                window.location.href = `/appointment-dashboard?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Users size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Communication node</span>
          </div>

          {/* Menu Item: Opd Doctor Schedule */}
          <div
            onClick={() => {
              if (clinicId) {
                window.location.href = `/opd-time-schedule-hospital?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Users size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Opd Doctor Schedule</span>
          </div>

          {/* Menu Item: Pre Screening Questions */}
          <div
            onClick={() => {
              if (clinicId) {
                window.location.href = `/pre-screening-questions?clinic_id=${clinicId}`;
              } else {
                alert("Clinic ID not found. Please refresh the page.");
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Users size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Pre Screening Questions</span>
          </div>

          {/* Menu Item: Settings */}
          <div
            onClick={() => window.location.href = `/clinic-dashboard?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Settings size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Settings</span>
          </div>
        </div>
      </div>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .font-modern {
            font-family: 'Inter', 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        .dark-glass-effect {
          background: linear-gradient(
            135deg,
            rgba(26, 26, 26, 0.9) 0%,
            rgba(15, 15, 15, 0.85) 100%
          );
          backdrop-filter: blur(20px) saturate(150%);
          -webkit-backdrop-filter: blur(20px) saturate(150%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.8),
            inset 0 1px 1px rgba(255, 255, 255, 0.05);
          position: relative;
          overflow: hidden;
          border-radius: 20px;
        }

        .dark-glass-effect::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            45deg,
            transparent 30%,
            rgba(212, 175, 55, 0.05) 50%,
            transparent 70%
          );
          animation: liquidFlowDark 10s ease-in-out infinite;
          pointer-events: none;
        }

        .dark-input {
          background: rgba(30, 30, 30, 0.8);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          padding: 10px 14px;
          height: 44px;
          font-size: 14px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          color: #ffffff;
        }

        .dark-input:focus {
          outline: none;
          border-color: ${GOLD_ACCENT};
          background: rgba(35, 35, 35, 0.9);
          box-shadow:
            0 0 0 3px rgba(212, 175, 55, 0.15),
            0 4px 12px rgba(212, 175, 55, 0.2);
        }

        .dark-input::placeholder {
          color: #666666;
          font-weight: 400;
        }

        .dark-submit-btn {
            padding: 12px 24px;
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 0.01em;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(212, 175, 55, 0.3);
            background: linear-gradient(135deg, ${GOLD_ACCENT}, ${SILVER_ACCENT});
            color: #000000;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .dark-submit-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 40px rgba(212, 175, 55, 0.5);
            background: linear-gradient(135deg, #e6c347, #d0d0d0);
        }

        .dark-submit-btn:disabled {
            box-shadow: none;
            transform: none;
            opacity: 0.6;
        }

        @keyframes liquidFlowDark {
          0%, 100% { transform: translate(-30%, -30%) rotate(0deg); opacity: 0.3; }
          50% { transform: translate(-20%, -30%) rotate(180deg); opacity: 0.15; }
        }

        @keyframes particleFloat {
          0%, 100% {
            transform: translateY(0) translateX(0) scale(1);
            opacity: 0.3;
          }
          50% {
            transform: translateY(-20px) translateX(10px) scale(1.1);
            opacity: 0.6;
          }
        }

        .particle {
          position: absolute;
          background: radial-gradient(circle, rgba(212, 175, 55, 0.4), transparent);
          border-radius: 50%;
          pointer-events: none;
          animation: particleFloat 6s ease-in-out infinite;
        }

        .country-dropdown-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .country-dropdown-scroll::-webkit-scrollbar-track {
          background: rgba(30, 30, 30, 0.5);
          border-radius: 4px;
        }

        .country-dropdown-scroll::-webkit-scrollbar-thumb {
          background: rgba(212, 175, 55, 0.4);
          border-radius: 4px;
        }

        .country-dropdown-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(212, 175, 55, 0.6);
        }
      `}</style>

      {/* Particle Background */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(15)].map((_, i) => (
          <div key={i} className="particle" />
        ))}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent via-transparent to-black/20" />
      </div>

      {/* Dark Glass Card */}
      <div className="relative z-10 w-full max-w-5xl">
        <div className="dark-glass-effect shadow-2xl">
          <div className="flex flex-col lg:flex-row">

            {/* Left Side */}
            <div className="lg:w-2/5 relative overflow-hidden rounded-l-2xl hidden lg:block">
              <img
                src="https://images.pexels.com/photos/4225880/pexels-photo-4225880.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Medical Professional"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-6">
                <div>
                  <h2 className="text-white text-2xl font-bold mb-1">Elite Medical Care</h2>
                  <p className="text-gray-300 text-sm">Empowering healthcare professionals worldwide</p>
                </div>
              </div>
            </div>

            {/* Right Side - Form */}
            <div className="lg:w-3/5 p-8">
              <div className="mb-6">
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <h1 className="text-2xl font-bold text-white">Register New Doctor</h1>
                  {authenticated && (
                    <span style={{
                      marginLeft: '10px',
                      background: '#10b981',
                      color: 'white',
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '10px'
                    }}>
                      ✅ Verified
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm">Add a medical professional to your healthcare team</p>
                <p className="text-xs text-gray-500 mt-1">
                  <strong>Clinic ID:</strong> {clinicId}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <User className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Full Name
                    </label>
                    <input
                      name="name"
                      placeholder="Dr. John Smith"
                      onChange={handleChange}
                      required
                      className="dark-input w-full"
                    />
                  </div>

                  {/* Username Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <User className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Username
                    </label>
                    <input
                      name="username"
                      placeholder="dr.johnsmith"
                      onChange={handleChange}
                      required
                      className="dark-input w-full"
                    />
                  </div>

                  {/* Email Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <Mail className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      name="email"
                      placeholder="doctor@hospital.com"
                      onChange={handleChange}
                      className="dark-input w-full"
                    />
                  </div>

                  {/* Country Code Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <Phone className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Country
                    </label>
                    <div className="relative" ref={countryDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                        className="dark-input flex items-center justify-between w-full h-11"
                      >
                        <span className="flex items-center text-sm">
                          <span className="mr-3 text-base">{selectedCountry.flag}</span>
                          <span>{selectedCountry.country} ({selectedCountry.code})</span>
                        </span>
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {showCountryDropdown && (
                        <div
                          className="absolute z-50 mt-1 w-full rounded-xl shadow-xl border overflow-hidden"
                          style={{
                            maxHeight: '320px',
                            background: 'rgba(20, 20, 20, 0.95)',
                            borderColor: 'rgba(255, 255, 255, 0.15)',
                          }}
                        >
                          <div className="overflow-y-auto country-dropdown-scroll" style={{ maxHeight: '300px' }}>
                            {countryCodes.map((country) => (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => handleCountrySelect(country.code)}
                                style={{
                                  backgroundColor: formData.country_code === country.code ? 'rgba(212, 175, 55, 0.15)' : 'transparent',
                                  borderLeft: formData.country_code === country.code ? `4px solid ${GOLD_ACCENT}` : '4px solid transparent',
                                }}
                                className="flex items-center w-full transition-colors text-white hover:bg-white/5 px-4 py-3 text-left"
                              >
                                <span className="mr-3 text-lg min-w-[32px]">{country.flag}</span>
                                <div className="flex-1">
                                  <div className="font-medium text-sm">{country.country}</div>
                                  <div className="text-xs text-gray-500">Code: {country.code}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Phone Number Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <Phone className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Phone Number
                    </label>
                    <input
                      name="phone_number"
                      placeholder="9876543210"
                      value={formData.phone_number}
                      onChange={handleChange}
                      required
                      className="dark-input w-full"
                      maxLength={15}
                    />
                    <p className="text-xs text-gray-500">Enter digits only (no country code)</p>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <Lock className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        placeholder="••••••••"
                        onChange={handleChange}
                        required
                        className="dark-input w-full pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-200"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Specialization Field - Dropdown */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <BriefcaseMedical className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Specialization
                    </label>
                    <div className="relative" ref={specializationDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowSpecializationDropdown(!showSpecializationDropdown)}
                        className="dark-input flex items-center justify-between w-full h-11 text-left"
                      >
                        <span className={formData.specialization ? "text-white" : "text-gray-500"}>
                          {formData.specialization || "Cardiology, Neurology, etc."}
                        </span>
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {showSpecializationDropdown && (
                        <div
                          className="absolute z-50 mt-1 w-full rounded-xl shadow-xl border overflow-hidden"
                          style={{
                            maxHeight: '320px',
                            background: 'rgba(20, 20, 20, 0.95)',
                            borderColor: 'rgba(255, 255, 255, 0.15)',
                          }}
                        >
                          <div className="overflow-y-auto country-dropdown-scroll" style={{ maxHeight: '300px' }}>
                            {specializations.map((specialization) => (
                              <button
                                key={specialization}
                                type="button"
                                onClick={() => handleSpecializationSelect(specialization)}
                                style={{
                                  backgroundColor: formData.specialization === specialization ? 'rgba(212, 175, 55, 0.15)' : 'transparent',
                                  borderLeft: formData.specialization === specialization ? `4px solid ${GOLD_ACCENT}` : '4px solid transparent',
                                }}
                                className="flex items-center w-full transition-colors text-white hover:bg-white/5 px-4 py-3 text-left"
                              >
                                <div className="flex-1">
                                  <div className="font-medium text-sm">{specialization}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Qualifications Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <GraduationCap className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Qualifications
                    </label>
                    <input
                      name="qualifications"
                      placeholder="MBBS, MD, MS, etc."
                      onChange={handleChange}
                      className="dark-input w-full"
                    />
                  </div>

                  {/* Registration Number Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-300">
                      <FileText className="w-3.5 h-3.5 mr-2 text-gray-400" />
                      Registration Number
                    </label>
                    <input
                      name="registeration_number"
                      placeholder="Medical Council Registration"
                      onChange={handleChange}
                      className="dark-input w-full"
                    />
                  </div>
                </div>

                {/* Address Field */}
                <div className="space-y-1.5">
                  <label className="flex items-center text-xs font-medium text-gray-300">
                    <MapPin className="w-3.5 h-3.5 mr-2 text-gray-400" />
                    Address
                  </label>
                  <textarea
                    name="address"
                    placeholder="Clinic/Hospital address..."
                    rows={2}
                    onChange={handleChange}
                    className="dark-input w-full resize-none"
                    style={{ height: '70px', paddingTop: '10px', paddingBottom: '10px' }}
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading || !clinicId || !authenticated}
                  className="w-full font-semibold dark-submit-btn disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin h-5 w-5 mr-3 text-black" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Registering...
                    </span>
                  ) : (
                    "Register Doctor"
                  )}
                </button>
              </form>

              {/* Message Display */}
              {message && (
                <div className={`mt-5 p-3 rounded-lg text-center font-medium text-sm ${
                  message.includes('✅')
                    ? 'bg-green-900/30 text-green-400 border border-green-500/30'
                    : 'bg-red-900/30 text-red-400 border border-red-500/30'
                }`}>
                  {message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClinicDoctorRegister;