import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Phone, Mail, User, Lock, BriefcaseMedical, GraduationCap, FileText, MapPin, ChevronDown } from "lucide-react";
import doctorRegisterBg from "../assets/Gemini_Generated_Image_lsd9c1lsd9c1lsd9.png";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function RegisterDoctor() {
  const navigate = useNavigate();
  const location = useLocation();

  const queryParams = new URLSearchParams(location.search);
  const hospitalId = queryParams.get("hospital_id");

  // --- BRAND COLORS ---
  const PRIMARY_BLUE = "#005a8b"; // Deep Navy/Indigo
  const ACCENT_TEAL = "#00c2a7";  // Bright Teal/Cyan
  const ACCENT_PURPLE = "#5856D6"; // Secondary Accent (for contrast)
  // --------------------

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
    specialization: "",
    qualifications: "",
    registeration_number: "",
    address: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);


  const countryDropdownRef = useRef(null);

  useEffect(() => {
    if (!hospitalId) navigate("/login");
  }, [hospitalId, navigate]);

  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/hms/users/hospitals/verify`,
          { credentials: "include" }
        );

        if (!res.ok) throw new Error("Not authenticated");

        const data = await res.json();
        const verifiedHospitalId = data.hospital.sys_user_id;

        // 🔐 Prevent hospital impersonation
        if (!hospitalId || hospitalId !== verifiedHospitalId) {
          console.warn("Hospital ID mismatch — access denied");
          navigate("/login");
          return;
        }

        setAuthenticated(true);
      } catch (err) {
        console.error("Hospital auth failed", err);
        navigate("/login");
      } finally {
        setAuthChecked(true);
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
    
      
      const res = await fetch(
        `${API_BASE_URL}/hms/users/doctors/doctoradd`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
           
          },
          body: JSON.stringify(submitData),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Registration failed on server.");

      setMessage("✅ Doctor registered successfully");
      setTimeout(
        () => navigate(`/hospital-dashboard?hospital_id=${hospitalId}`),
        1200
      );
    } catch (err) {
      console.error("Registration error:", err);
      setMessage(`❌ Registration failed: ${err.message || "Server error"}`);
    } finally {
      setLoading(false);
    }
  };

  const selectedCountry = countryCodes.find(
    (c) => c.code === formData.country_code
  );
  
  // Helper to convert hex to rgba for use in CSS/JSX styles
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  if (!authChecked) {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: "600"
      }}
    >
      Verifying session...
    </div>
  );
}
  if (!authChecked) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "16px",
          fontWeight: "600"
        }}
      >
        Verifying session...
      </div>
    );
  }


  return (
    <div className="min-h-screen font-modern flex items-center justify-center p-4 relative overflow-hidden" 
      style={{
        backgroundImage: `linear-gradient(135deg, ${hexToRgba(PRIMARY_BLUE, 0.05)}, ${hexToRgba(ACCENT_TEAL, 0.03)}, #f8f8fa)`,
        backgroundAttachment: 'fixed'
      }}>
      <style jsx global>{`
        /* 1. FONT IMPORT (SIMULATING ATKINSON HYPERLEGIBLE LOOK) */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .font-modern { 
            font-family: 'Inter', 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        /* 2. BASE GLASS CARD */
        .glass-effect {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.7) 0%,
            rgba(255, 255, 255, 0.5) 100%
          );
          backdrop-filter: blur(20px) saturate(200%);
          -webkit-backdrop-filter: blur(20px) saturate(200%);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 
            0 15px 40px rgba(0, 0, 0, 0.1),
            inset 0 1px 1px rgba(255, 255, 255, 0.6);
          position: relative;
          overflow: hidden;
          border-radius: 20px;
        }

        /* LIQUID EFFECT SHINE ON CARD */
        .glass-effect::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            45deg,
            transparent 30%,
            rgba(255, 255, 255, 0.15) 50%,
            transparent 70%
          );
          animation: liquidFlow 8s ease-in-out infinite;
          pointer-events: none;
        }

        /* 3. INPUT STYLES */
        .glass-input {
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(8px) saturate(180%);
          -webkit-backdrop-filter: blur(8px) saturate(180%);
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 10px;
          padding: 10px 14px;
          height: 44px;
          font-size: 14px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          color: #374151;
        }

        .glass-input:focus {
          outline: none;
          border-color: ${hexToRgba(PRIMARY_BLUE, 0.6)};
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 
            0 0 0 3px ${hexToRgba(PRIMARY_BLUE, 0.15)},
            0 4px 12px rgba(0, 0, 0, 0.05);
          transform: translateY(0);
        }

        .glass-input::placeholder {
          color: #9ca3af;
          font-weight: 400;
        }
        
        /* 4. BUTTON STYLES (Liquid Gradient) */
        .liquid-submit-btn {
            padding: 12px 24px;
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 0.01em;
            border-radius: 12px;
            box-shadow: 0 10px 25px ${hexToRgba(PRIMARY_BLUE, 0.3)};
            background: linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL});
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .liquid-submit-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 35px ${hexToRgba(PRIMARY_BLUE, 0.4)};
            background: linear-gradient(135deg, #004d7c, #00b29a);
        }
        
        .liquid-submit-btn:disabled {
            box-shadow: none;
            transform: none;
        }

        /* 5. BACKGROUND AND ANIMATIONS */
        @keyframes liquidFlow {
          0%, 100% { transform: translate(-30%, -30%) rotate(0deg); opacity: 0.3; }
          50% { transform: translate(-20%, -30%) rotate(180deg); opacity: 0.2; }
        }

        /* Subtle pulsing background spheres using brand colors */
        .bg-sphere-1 {
          background: linear-gradient(to right, ${hexToRgba(PRIMARY_BLUE, 0.5)}, ${hexToRgba(ACCENT_TEAL, 0.4)});
          opacity: 0.2;
          blur: 40px;
        }
        .bg-sphere-2 {
          background: linear-gradient(to right, ${hexToRgba(ACCENT_PURPLE, 0.5)}, ${hexToRgba(PRIMARY_BLUE, 0.4)});
          opacity: 0.15;
          blur: 40px;
        }
        .bg-sphere-3 {
          background: linear-gradient(to right, ${hexToRgba(ACCENT_TEAL, 0.5)}, ${hexToRgba(PRIMARY_BLUE, 0.4)});
          opacity: 0.1;
          blur: 40px;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }

        /* Custom scrollbar for country dropdown */
        .country-dropdown-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .country-dropdown-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }

        .country-dropdown-scroll::-webkit-scrollbar-thumb {
          background: rgba(0, 90, 139, 0.4);
          border-radius: 4px;
        }

        .country-dropdown-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 90, 139, 0.6);
        }
      `}</style>

      {/* Background Elements (Using refined classes) */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Sphere 1 - Top Left */}
        <div className="absolute -top-32 -left-32 w-72 h-72 rounded-full blur-3xl animate-pulse bg-sphere-1" />
        {/* Sphere 2 - Bottom Right */}
        <div className="absolute -bottom-32 -right-32 w-72 h-72 rounded-full blur-3xl animate-pulse delay-1000 bg-sphere-2" />
        {/* Sphere 3 - Center */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full blur-3xl animate-pulse delay-500 bg-sphere-3" />
      </div>

      {/* Glass Card - Reduced Size */}
      <div className="relative z-10 w-full max-w-5xl"> {/* Reduced max width */}
        <div className="glass-effect shadow-2xl">
          <div className="flex flex-col lg:flex-row">
            
            {/* Left Side - Image (Slightly narrower proportion) */}
            <div className="lg:w-2/5 relative overflow-hidden rounded-l-2xl hidden lg:block">
              <img 
                src={doctorRegisterBg} 
                alt="Doctor Registration" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent flex items-end p-6"> {/* Reduced padding */}
                <div>
                  <h2 className="text-white text-2xl font-bold mb-1">Medical Excellence</h2> {/* Reduced font size */}
                  <p className="text-white/80 text-sm">Join our network of healthcare professionals</p> {/* Reduced font size */}
                </div>
              </div>
            </div>

            {/* Right Side - Form (Slightly wider proportion) */}
            <div className="lg:w-3/5 p-8"> {/* Reduced padding */}
              <div className="mb-6"> {/* Reduced margin */}
                <h1 className="text-2xl font-bold text-gray-800 mb-1">Register New Doctor</h1> {/* Reduced font size */}
                <p className="text-gray-600 text-sm">Add a medical professional to your healthcare team</p> {/* Reduced font size */}
              </div>

              <form onSubmit={handleSubmit} className="space-y-5"> {/* Reduced spacing */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> {/* Reduced gap */}
                  {/* Name Field */}
                  <div className="space-y-1.5"> {/* Reduced spacing */}
                    <label className="flex items-center text-xs font-medium text-gray-700"> {/* Reduced font size */}
                      <User className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Full Name
                    </label>
                    <input
                      name="name"
                      placeholder="Dr. John Smith"
                      onChange={handleChange}
                      required
                      className="glass-input w-full"
                    />
                  </div>

                  {/* Username Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <User className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Username
                    </label>
                    <input
                      name="username"
                      placeholder="dr.johnsmith"
                      onChange={handleChange}
                      required
                      className="glass-input w-full"
                    />
                  </div>

                  {/* Email Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <Mail className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      name="email"
                      placeholder="doctor@hospital.com"
                      onChange={handleChange}
                      className="glass-input w-full"
                    />
                  </div>

                  {/* Country Code Field - COMPLETELY FIXED */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <Phone className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Country
                    </label>
                    <div className="relative" ref={countryDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                        className="glass-input flex items-center justify-between w-full h-11" // Reduced height
                      >
                        <span className="flex items-center text-sm">
                          <span className="mr-3 text-base">{selectedCountry.flag}</span>
                          <span>{selectedCountry.country} ({selectedCountry.code})</span>
                        </span>
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      {showCountryDropdown && (
                        <div 
                          className="absolute z-50 mt-1 w-full bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden"
                          style={{ 
                            maxHeight: '320px', // Increased height for better visibility
                          }}
                        >
                          <div className="overflow-y-auto country-dropdown-scroll" style={{ maxHeight: '300px' }}>
                            {countryCodes.map((country) => (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => handleCountrySelect(country.code)}
                                style={{
                                  backgroundColor: formData.country_code === country.code ? hexToRgba(PRIMARY_BLUE, 0.08) : 'transparent',
                                  borderLeft: formData.country_code === country.code ? `4px solid ${PRIMARY_BLUE}` : '4px solid transparent',
                                }}
                                className="flex items-center w-full transition-colors text-gray-800 hover:bg-gray-50 px-4 py-3 text-left"
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
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <Phone className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Phone Number
                    </label>
                    <input
                      name="phone_number"
                      placeholder="9876543210"
                      value={formData.phone_number}
                      onChange={handleChange}
                      required
                      className="glass-input w-full"
                      maxLength={15}
                    />
                    <p className="text-xs text-gray-500">Enter digits only (no country code)</p>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <Lock className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        placeholder="••••••••"
                        onChange={handleChange}
                        required
                        className="glass-input w-full pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {/* Reduced size */}
                      </button>
                    </div>
                  </div>

                  {/* Specialization Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <BriefcaseMedical className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Specialization
                    </label>
                    <input
                      name="specialization"
                      placeholder="Cardiology, Neurology, etc."
                      onChange={handleChange}
                      required
                      className="glass-input w-full"
                    />
                  </div>

                  {/* Qualifications Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <GraduationCap className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Qualifications
                    </label>
                    <input
                      name="qualifications"
                      placeholder="MBBS, MD, MS, etc."
                      onChange={handleChange}
                      className="glass-input w-full"
                    />
                  </div>

                  {/* Registration Number Field */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-gray-700">
                      <FileText className="w-3.5 h-3.5 mr-2 text-gray-500" />
                      Registration Number
                    </label>
                    <input
                      name="registeration_number"
                      placeholder="Medical Council Registration"
                      onChange={handleChange}
                      className="glass-input w-full"
                    />
                  </div>
                </div>

                {/* Address Field */}
                <div className="space-y-1.5">
                  <label className="flex items-center text-xs font-medium text-gray-700">
                    <MapPin className="w-3.5 h-3.5 mr-2 text-gray-500" />
                    Address
                  </label>
                  <textarea
                    name="address"
                    placeholder="Clinic/Hospital address..."
                    rows={2} /* Reduced rows */
                    onChange={handleChange}
                    className="glass-input w-full resize-none"
                    style={{ height: '70px', paddingTop: '10px', paddingBottom: '10px' }} /* Fixed medium height */
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full text-white font-semibold liquid-submit-btn disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
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
                <div className={`mt-5 p-3 rounded-lg text-center font-medium text-sm ${message.includes('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
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

export default RegisterDoctor;