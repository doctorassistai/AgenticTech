import React, { useState, useEffect } from "react";
import Select from 'react-select';
import countryList from 'react-select-country-list';
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// Particle Background Component
const ParticleBackground = () => {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    const particlesArray = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      speed: Math.random() * 0.5 + 0.2,
      color: i % 3 === 0 ? '#3b82f6' : i % 3 === 1 ? '#8b5cf6' : '#10b981',
      opacity: Math.random() * 0.4 + 0.1
    }));
    setParticles(particlesArray);

    const interval = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p,
        y: (p.y + p.speed) % 100,
        x: (p.x + Math.sin(Date.now() * 0.001 + p.id) * 0.1) % 100
      })));
    }, 50);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {particles.map(particle => (
        <motion.div
          key={particle.id}
          className="absolute rounded-full"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            backgroundColor: particle.color,
            opacity: particle.opacity,
          }}
          animate={{
            y: [0, -20],
            opacity: [particle.opacity, particle.opacity * 0.5, particle.opacity],
          }}
          transition={{
            duration: 2 + Math.random() * 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />

      {/* Animated grid */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '50px 50px',
          }}
        />
      </div>
    </div>
  );
};

// Pulse Animation Component
const PulseRing = () => {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute border-2 border-blue-500/30 rounded-full"
          style={{
            width: '100px',
            height: '100px',
          }}
          animate={{
            scale: [1, 2],
            opacity: [0.3, 0],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            delay: i * 1,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
};

// Main Clinic Login Component
const ClinicLogin = () => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    email: "",
    clinicName: "",
    phoneNumber: "",
    headquarters: "",
    address: "",
    staffCount: "",
    bedCount: "",
    countryCode: "IN",
    termsAccepted: false,
  });

  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [refSource, setRefSource] = useState("");
  const [isValidRef, setIsValidRef] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  // Extract ref from URL on component mount - REQUIRED parameter
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const ref = queryParams.get('ref');

    if (!ref) {
      // Ref is required - show error
      setIsValidRef(false);
      setMessage("Error: Access denied. Valid reference parameter is required.");
      console.error("No ref parameter found in URL");
    } else {
      setRefSource(ref);
      setIsValidRef(true);
      setMessage(""); // Clear any previous error messages
      console.log("Ref source detected:", ref);
    }
  }, [location]);

  const countryOptions = countryList().getData();
  const [selectedCountry, setSelectedCountry] = useState(
    countryOptions.find(option => option.value === 'IN')
  );

  const handleCountryChange = (selectedOption) => {
    setSelectedCountry(selectedOption);
    setFormData(prevData => ({
      ...prevData,
      countryCode: selectedOption ? selectedOption.value : 'IN'
    }));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === 'staffCount' || name === 'bedCount') {
      const numValue = value === '' ? '' : parseInt(value);
      setFormData(prevData => ({
        ...prevData,
        [name]: numValue
      }));
    } else {
      setFormData(prevData => ({
        ...prevData,
        [name]: value
      }));
    }
    setMessage("");
  };

  const handleCheckboxChange = () => {
    setFormData(prevData => ({
      ...prevData,
      termsAccepted: !prevData.termsAccepted
    }));
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();

    // Double-check that ref exists before submitting
    if (!refSource) {
      setMessage("Error: Missing reference source. Please access this page with a valid reference.");
      return;
    }

    setMessage("Attempting to log in...");
    setIsLoading(true);

    try {
      // Prepare login data with required source parameter
      const loginData = {
        username: formData.username,
        password: formData.password,
        source: refSource // Always include source as it's required
      };

      const res = await fetch(`${API_BASE_URL}hms/users/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(loginData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Login failed");
      }

      localStorage.setItem("user_id", data.user_id);
      localStorage.setItem("role", data.role);

      // Store source in localStorage for analytics
      localStorage.setItem("user_source", refSource);

      setMessage("Login successful! Redirecting...");

      setTimeout(() => {
        const role = data.role.toLowerCase();

        switch (role) {
          case "clinic":
          case "clinical_user":
          case "clinical":
            navigate(`/clinic-dashboard?clinic_id=${data.user_id}&source=${refSource}`);
            break;

          case "hospital":
          case "hms_integration":
          case "da_user":
          case "iframe_user":
            navigate(`/hospital-dashboard?hospital_id=${data.user_id}&source=${refSource}`);
            break;

          case "doctor":
          case "physician":
          case "md":
            navigate(`/doctor-dashboard?doctor_id=${data.user_id}&source=${refSource}`);
            break;

          case "system_admin":
          case "admin":
          case "administrator":
            navigate(`/admin-dashboard?source=${refSource}`);
            break;

          case "patient":
            navigate(`/patient-dashboard?patient_id=${data.user_id}&source=${refSource}`);
            break;

          case "nurse":
          case "staff":
            navigate(`/staff-dashboard?staff_id=${data.user_id}&source=${refSource}`);
            break;

          default:
            setMessage(`Unknown user role: ${data.role}. Contact administrator.`);
            console.warn(`Unknown role received: ${data.role}`);
        }
      }, 800);

    } catch (err) {
      console.error("Login error:", err);
      setMessage(err.message || "An error occurred during login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();

    // Double-check that ref exists before submitting
    if (!refSource) {
      setMessage("Error: Missing reference source. Please access this page with a valid reference.");
      return;
    }

    if (!formData.termsAccepted) {
      setMessage("Please accept the terms and conditions");
      return;
    }

    if (!formData.staffCount || formData.staffCount <= 0) {
      setMessage("Please enter a valid staff count (minimum 1)");
      return;
    }

    if (!formData.bedCount || formData.bedCount <= 0) {
      setMessage("Please enter a valid bed count (minimum 1)");
      return;
    }

    setIsLoading(true);

    const submissionData = {
      name: formData.clinicName,
      address: formData.address || null,
      headquarters: formData.headquarters || null,
      username: formData.username,
      password: formData.password,
      email: formData.email,
      phone_number: formData.phoneNumber,
      no_of_staff: parseInt(formData.staffCount),
      no_of_beds: parseInt(formData.bedCount),
      country_code: formData.countryCode,
      hospital_user_type: "clinical_user",
      source: refSource // Always include source as it's required
    };

    console.log("Registering clinic with source:", refSource, submissionData);

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/hospitals/clinicaluseradd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Error registering clinic");
      }

      setMessage(data.message || "Clinic registered successfully!");

      setFormData({
        username: "",
        password: "",
        email: "",
        clinicName: "",
        phoneNumber: "",
        headquarters: "",
        address: "",
        staffCount: "",
        bedCount: "",
        countryCode: "IN",
        termsAccepted: false,
      });
      setSelectedCountry(countryOptions.find(option => option.value === 'IN'));

      setTimeout(() => {
        setIsRegistering(false);
        setMessage("");
      }, 2000);

    } catch (err) {
      setMessage(err.message || "An error occurred during registration");
    } finally {
      setIsLoading(false);
    }
  };

  // Render error state if ref is missing
  const renderErrorState = () => {
    if (!isValidRef) {
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md"
        >
          <div className="backdrop-blur-xl bg-gradient-to-br from-red-500/10 to-red-500/5 border border-red-500/30 rounded-2xl p-8 shadow-2xl shadow-black/50 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/25">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Access Denied</h2>
            <p className="text-red-200/80 mb-6">
              {message || "Valid reference parameter is required to access this page."}
            </p>
            <p className="text-white/40 text-sm">
              Please use the correct URL with a reference parameter.
            </p>
          </div>
        </motion.div>
      );
    }
    return null;
  };

  const customSelectStyles = {
    control: (base) => ({
      ...base,
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      minHeight: '48px',
      color: 'white',
      boxShadow: 'none',
      '&:hover': {
        borderColor: 'rgba(255, 255, 255, 0.3)',
      },
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: '#0a0a0a',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      overflow: 'hidden',
      backdropFilter: 'blur(10px)',
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected ? 'rgba(59, 130, 246, 0.3)' :
        state.isFocused ? 'rgba(255, 255, 255, 0.1)' :
          'transparent',
      color: 'white',
      cursor: 'pointer',
      '&:active': {
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
      }
    }),
    singleValue: (base) => ({
      ...base,
      color: 'white',
    }),
    input: (base) => ({
      ...base,
      color: 'white',
    }),
    placeholder: (base) => ({
      ...base,
      color: 'rgba(255, 255, 255, 0.5)',
    }),
  };

  const inputClassName = "w-full bg-white/5 text-white border border-white/10 rounded-xl py-3 px-5 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 placeholder:text-white/40 backdrop-blur-sm transition-all duration-300";

  const buttonClassName = "w-full py-3 px-6 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 shadow-lg";

  return (
    <div className="flex w-full flex-col min-h-screen bg-black relative overflow-hidden">
      {/* Background */}
      <ParticleBackground />

      {/* Animated Gradient Orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full blur-3xl"
        animate={{
          x: [0, 50, 0],
          y: [0, 30, 0],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 rounded-full blur-3xl"
        animate={{
          x: [0, -50, 0],
          y: [0, -30, 0],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 5
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        {/* Show error state if ref is missing, otherwise show the login/register form */}
        {!isValidRef ? (
          renderErrorState()
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-full max-w-md"
          >
            {/* Glass Card */}
            <motion.div
              className="backdrop-blur-xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/50"
              whileHover={{ scale: 1.005 }}
              transition={{ duration: 0.3 }}
            >

              {/* Header */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={isRegistering ? "register" : "login"}
                  initial={{ opacity: 0, x: isRegistering ? 50 : -50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: isRegistering ? -50 : 50 }}
                  transition={{ duration: 0.3 }}
                  className="text-center mb-8"
                >
                  <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 mb-6 shadow-lg shadow-blue-500/25">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <PulseRing />
                  </div>
                  <h1 className="text-3xl font-bold text-white mb-3 bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                    {isRegistering ? "Register Organization" : "Welcome Back"}
                  </h1>
                  <p className="text-white/60 text-sm">
                    {isRegistering ? "Create your Organization account" : "Sign in to your Organization dashboard"}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Message */}
              <AnimatePresence>
                {message && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`mb-6 p-4 rounded-xl text-center text-sm backdrop-blur-sm ${message.includes("successfully")
                      ? "bg-gradient-to-r from-green-500/20 to-emerald-500/10 border border-green-500/30 text-green-400"
                      : message.includes("Error") || message.includes("failed") || message.includes("Please") || message.includes("Access")
                        ? "bg-gradient-to-r from-red-500/20 to-rose-500/10 border border-red-500/30 text-red-400"
                        : message.includes("Unknown")
                          ? "bg-gradient-to-r from-yellow-500/20 to-amber-500/10 border border-yellow-500/30 text-yellow-400"
                          : "bg-gradient-to-r from-blue-500/20 to-cyan-500/10 border border-blue-500/30 text-blue-400"
                      }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      {message.includes("successfully") ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : message.includes("Error") || message.includes("failed") || message.includes("Access") ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : null}
                      {message}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form */}
              <form onSubmit={isRegistering ? handleRegisterSubmit : handleLoginSubmit} className="space-y-5">
                <AnimatePresence mode="wait">
                  {!isRegistering ? (
                    <motion.div
                      key="login-form"
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -50 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-5"
                    >
                      {/* Username */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Username</label>
                        <div className="relative">
                          <input
                            type="text"
                            name="username"
                            value={formData.username}
                            onChange={handleInputChange}
                            className={inputClassName}
                            placeholder="Enter your username"
                            required
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </span>
                        </div>
                      </motion.div>

                      {/* Password */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Password</label>
                        <div className="relative">
                          <input
                            type={showPassword ? "text" : "password"}
                            name="password"
                            value={formData.password}
                            onChange={handleInputChange}
                            className={inputClassName}
                            placeholder="Enter your password"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
                          >
                            {showPassword ? (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </motion.div>

                      {/* Remember & Forgot */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="flex items-center justify-between text-sm"
                      >
                        <label className="flex items-center gap-2 text-white/60 cursor-pointer group">
                          <div className="relative">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                            />
                            <div className="w-4 h-4 rounded border border-white/20 bg-white/5 peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-all duration-200 flex items-center justify-center">
                              <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                          <span className="group-hover:text-white/80 transition-colors">Remember me</span>
                        </label>
                        <motion.a
                          href="#"
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Forgot password?
                        </motion.a>
                      </motion.div>

                      {/* Login Button */}
                      <motion.button
                        type="submit"
                        disabled={isLoading}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`${buttonClassName} bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-lg shadow-blue-500/25 relative overflow-hidden group`}
                      >
                        <span className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                        {isLoading ? (
                          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <>
                            Sign In
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                          </>
                        )}
                      </motion.button>

                      {/* Register Link */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="text-center text-white/60 text-sm pt-4"
                      >
                        Don't have a Organization account?{" "}
                        <motion.button
                          type="button"
                          onClick={() => {
                            setIsRegistering(true);
                            setMessage("");
                          }}
                          className="text-green-400 hover:text-green-300 font-semibold transition-colors"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Register Organization
                        </motion.button>
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="register-form"
                      initial={{ opacity: 0, x: 50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 50 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-5 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar"
                    >
                      {/* Clinic Name */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Organization Name *</label>
                        <input
                          type="text"
                          name="clinicName"
                          value={formData.clinicName}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="Enter clinic name"
                          required
                        />
                      </motion.div>

                      {/* Email */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Email Address *</label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="orgname@example.com"
                          required
                        />
                      </motion.div>

                      {/* Phone */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Phone Number *</label>
                        <input
                          type="tel"
                          name="phoneNumber"
                          value={formData.phoneNumber}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="+91 98765 43210"
                          required
                        />
                      </motion.div>

                      {/* Headquarters */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Headquarters</label>
                        <input
                          type="text"
                          name="headquarters"
                          value={formData.headquarters}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="City, State"
                        />
                      </motion.div>

                      {/* Address */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Address</label>
                        <input
                          type="text"
                          name="address"
                          value={formData.address}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="Full address"
                        />
                      </motion.div>

                      {/* Staff & Bed Count */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 }}
                        className="grid grid-cols-2 gap-4"
                      >
                        <div>
                          <label className="block text-white/70 text-sm mb-2 ml-1">Staff Count *</label>
                          <input
                            type="number"
                            name="staffCount"
                            value={formData.staffCount}
                            onChange={handleInputChange}
                            className={inputClassName}
                            placeholder="10"
                            required
                            min="1"
                          />
                        </div>
                        <div>
                          <label className="block text-white/70 text-sm mb-2 ml-1">Bed Count *</label>
                          <input
                            type="number"
                            name="bedCount"
                            value={formData.bedCount}
                            onChange={handleInputChange}
                            className={inputClassName}
                            placeholder="20"
                            required
                            min="1"
                          />
                        </div>
                      </motion.div>

                      {/* Country */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Country *</label>
                        <Select
                          options={countryOptions}
                          value={selectedCountry}
                          onChange={handleCountryChange}
                          styles={customSelectStyles}
                          isSearchable
                          placeholder="Select country"
                        />
                      </motion.div>

                      {/* Username */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.45 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Username *</label>
                        <input
                          type="text"
                          name="username"
                          value={formData.username}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="Choose a username"
                          required
                        />
                      </motion.div>

                      {/* Password */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                      >
                        <label className="block text-white/70 text-sm mb-2 ml-1">Password *</label>
                        <input
                          type="password"
                          name="password"
                          value={formData.password}
                          onChange={handleInputChange}
                          className={inputClassName}
                          placeholder="Create a password"
                          required
                        />
                      </motion.div>

                      {/* Terms */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.55 }}
                      >
                        <label className="flex items-start gap-3 cursor-pointer group">
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={formData.termsAccepted}
                              onChange={handleCheckboxChange}
                              className="sr-only peer"
                            />
                            <div className="mt-1 w-4 h-4 rounded border border-white/20 bg-white/5 peer-checked:bg-green-500 peer-checked:border-green-500 transition-all duration-200 flex items-center justify-center">
                              <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                          <span className="text-white/60 text-sm group-hover:text-white/80 transition-colors">
                            I accept the <a href="#" className="text-blue-400 hover:underline">terms and conditions</a>
                          </span>
                        </label>
                      </motion.div>

                      {/* Register Button */}
                      <motion.button
                        type="submit"
                        disabled={isLoading}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`${buttonClassName} bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-500/25 relative overflow-hidden group`}
                      >
                        <span className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                        {isLoading ? (
                          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <>
                            Register Organization
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </>
                        )}
                      </motion.button>

                      {/* Login Link */}
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.65 }}
                        className="text-center text-white/60 text-sm pt-2"
                      >
                        Already have an account?{" "}
                        <motion.button
                          type="button"
                          onClick={() => {
                            setIsRegistering(false);
                            setMessage("");
                          }}
                          className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          Login here
                        </motion.button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
            </motion.div>

            {/* Footer */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-center text-white/30 text-xs mt-6"
            >
              © 2024 Doctor Assist AI. All rights reserved.
            </motion.p>
          </motion.div>
        )}
      </div>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #3b82f6, #8b5cf6);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, #2563eb, #7c3aed);
        }
      `}</style>
    </div>
  );
};

export default ClinicLogin;