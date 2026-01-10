import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

// Assuming these paths are correct for your project
import logoImage from "../assets/lodo_only.png";
import abstractBg from "../assets/Gemini_Generated_Image_lsd9c1lsd9c1lsd9.png"; 

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function ModernLogin() {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const navigate = useNavigate();

  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [animations, setAnimations] = useState({
    logo: false,
    heading: false,
    inputs: false,
    button: false
  });

  const formRef = useRef(null);

  // --- BRAND COLORS FROM LOGO ---
  const PRIMARY_BLUE = "#005a8b"; // Deep Navy/Indigo
  const ACCENT_TEAL = "#00c2a7";  // Bright Teal/Cyan
  const LIGHT_GRAY_BG = "#f5f7fa"; 
  // -----------------------------

  useEffect(() => {
    setMounted(true);
    
    // Trigger animations sequentially
    const animationSequence = [
      { key: 'logo', delay: 200 },
      { key: 'heading', delay: 300 },
      { key: 'inputs', delay: 400 },
      { key: 'button', delay: 500 }
    ];

    animationSequence.forEach(({ key, delay }) => {
      setTimeout(() => {
        setAnimations(prev => ({ ...prev, [key]: true }));
      }, delay);
    });
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    setMessage("");
  };
  
  const handleSubmit = async (e) => {
  e.preventDefault();
  setMessage("Attempting to log in...");

  try {
    const response = await fetch(
      `${API_BASE_URL}/hms/users/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // ✅ REQUIRED
        body: JSON.stringify({
          username: formData.email,
          password: formData.password
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.detail || "Login failed");
      return;
    }

    localStorage.setItem("user_id", data.user_id);
    localStorage.setItem("role", data.role);

    setMessage("Login successful! Redirecting...");

    setTimeout(() => {
      if (data.role === "doctor") {
        navigate(`/doctor-dashboard?doctor_id=${data.user_id}`);
      } else if (data.role === "hospital") {
        navigate(`/hospital-dashboard?hospital_id=${data.user_id}`);
      }
      else if (data.role === "system_admin") {
        navigate(`/admin-dashboard`);
      }
    }, 800);

  } catch (error) {
    console.error("Login error:", error);
    setMessage("Error: Unable to connect to server");
  }
};

  const styles = `
    /* 1. FONT IMPORT (SIMULATING ATKINSON HYPERLEGIBLE LOOK) */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    body, .font-modern { 
        font-family: 'Inter', 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        margin: 0;
        padding: 0;
        overflow-x: hidden;
    }

    /* 2. BASE BACKGROUND AND LIQUID SHAPES */
    .glass-bg { 
        background: linear-gradient(135deg, ${LIGHT_GRAY_BG} 0%, #dbe6f0 50%, #ccd7e4 100%); 
        min-height: 100vh;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem; /* Reduced padding */
        position: relative;
        overflow: hidden;
    }

    /* Background gradient shapes - LIQUID EFFECT */
    .blue-shape-1 {
        position: fixed; top: 20%; left: 0%; width: 700px; height: 700px; /* Reduced size */
        background: linear-gradient(145deg, ${PRIMARY_BLUE}aa, #ffffff11); 
        border-radius: 40% 60% 70% 30% / 40% 50% 50% 60%; 
        opacity: 0.12; filter: blur(80px); z-index: 0; pointer-events: none; /* Reduced blur/opacity */
        animation: subtleMove 15s ease-in-out infinite alternate;
    }

    .blue-shape-2 {
        position: fixed; bottom: 40%; right: 0%; width: 500px; height: 500px; /* Reduced size */
        background: linear-gradient(-45deg, ${ACCENT_TEAL}aa, ${PRIMARY_BLUE}33);
        border-radius: 70% 30% 60% 40% / 60% 70% 30% 40%; 
        opacity: 0.08; filter: blur(120px); z-index: 0; pointer-events: none; /* Reduced blur/opacity */
        animation: subtleMove 20s ease-in-out infinite alternate-reverse;
    }

    @keyframes subtleMove {
      0% { transform: translate(0, 0); }
      100% { transform: translate(40px, -40px); } /* Reduced shift */
    }

    /* Main container */
    .main-container {
      max-width: 950px; /* Reduced max width */
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2); /* Reduced shadow */
      border-radius: 28px; /* Reduced radius */
      overflow: hidden;
      position: relative;
      z-index: 1;
    }
    
    /* 3. LIQUID GLASS EFFECT */
    .apple-glass-card { 
      background: rgba(255, 255, 255, 0.4); 
      backdrop-filter: blur(35px) saturate(200%); /* Reduced blur */
      -webkit-backdrop-filter: blur(35px) saturate(200%);
      border: 1px solid rgba(255, 255, 255, 0.75); 
      box-shadow: 
        0 15px 40px rgba(31, 38, 135, 0.15), /* Reduced shadow */
        0 1px 3px rgba(0, 0, 0, 0.05),
        inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
      border-radius: 24px; /* Reduced radius */
      width: 360px; /* Reduced width */
      height: 420px; /* Reduced height */
      position: relative;
      overflow: hidden;
    }

    /* Refractive Highlight */
    .apple-glass-card::after {
        content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
        background: radial-gradient(circle at 10% 10%, rgba(255, 255, 255, 0.8) 0%, transparent 40%);
        opacity: 0.2; pointer-events: none; z-index: 10; transform: rotate(45deg); filter: blur(10px);
    }


    /* Brand card */
    .brand-card-apple {
      background: rgba(255, 255, 255, 0.5); 
      backdrop-filter: blur(30px) saturate(200%); /* Reduced blur */
      -webkit-backdrop-filter: blur(30px) saturate(200%);
      border: 1px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 8px 25px rgba(31, 38, 135, 0.1), /* Reduced shadow */
                  inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
      border-radius: 20px; /* Reduced radius */
      max-width: 300px; /* Reduced width */
      padding: 1.25rem; /* Reduced padding */
      position: relative;
    }
    .brand-card-apple::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, transparent 50%);
        pointer-events: none;
    }


    /* Right Side Panel & Blur */
    .right-panel-glass {
        position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 100%;
    }
    .right-panel-glass::before {
      content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 420px; height: 500px; /* Reduced blur area */
      background: transparent;
      backdrop-filter: blur(20px); /* Reduced blur */
      -webkit-backdrop-filter: blur(20px);
      border-radius: 28px; /* Reduced radius */
      z-index: 0;
    }

    .content-wrapper {
      position: relative; z-index: 1; width: 100%; display: flex; justify-content: center; align-items: center; padding: 1.5rem; /* Reduced padding */
    }
    
    /* 4. INPUT & BUTTON REFINEMENTS */
    .input-glass { 
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid rgba(0, 0, 0, 0.1); 
      border-radius: 8px; /* Reduced radius */
      color: #1d1d1f;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 1.0); 
      font-size: 14px; /* Reduced font size */
      padding: 12px 14px; /* Reduced padding */
      height: 44px; /* Reduced height */
      font-weight: 500;
    }
    
    /* Focus state */
    .input-glass:focus { 
      border-color: ${PRIMARY_BLUE}77; 
      box-shadow: 0 0 0 3px ${PRIMARY_BLUE}22, /* Reduced ring size */
                  0 2px 8px rgba(0, 0, 0, 0.06); /* Reduced shadow */
      outline: none;
    }

    /* Button Styling */
    .login-btn {
        box-shadow: 0 3px 10px ${PRIMARY_BLUE}55; /* Reduced shadow */
        background: linear-gradient(180deg, ${PRIMARY_BLUE} 0%, #004d7c 100%); 
        font-weight: 700;
        letter-spacing: 0.02em; 
        font-size: 15px; /* Reduced font size */
        border-radius: 8px; /* Reduced radius */
        height: 46px; /* Reduced height */
    }
    
    .login-btn:hover {
        box-shadow: 0 6px 18px ${PRIMARY_BLUE}66; /* Reduced shadow */
        transform: translateY(-1px);
        background: linear-gradient(180deg, #00669d 0%, #004570 100%); 
    }
    
    .image-overlay {
        background: linear-gradient(
          to top,
          ${PRIMARY_BLUE}30 0%, /* Slightly less intense tint */
          ${PRIMARY_BLUE}15 30%,
          transparent 60%
        );
    }
    
    /* Animation tweaks */
    .scale-in-container {
      animation: scaleInContainer 0.6s cubic-bezier(0.2, 0.7, 0.4, 1.2) forwards; /* Slightly faster animation */
    }
    
    /* Utility for tracking */
    .tracking-tight-wide {
        letter-spacing: 0.03em; /* Slightly reduced tracking */
    }

    @keyframes scaleInContainer {
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  `;

  return (
    <div className="glass-bg font-modern">
      <style>{styles}</style>
      
      {/* Background Gradient Shapes (Liquid Effect) */}
      <div className="blue-shape-1"></div>
      <div className="blue-shape-2"></div>

      <div
        className={`main-container scale-in-container ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
        style={{ height: "520px" }} // Reduced overall height
      >
        <div className="h-full flex">
          {/* Left Side - Image with Branding (Wider space) */}
          <div className="hidden lg:flex lg:w-[48%] h-full relative overflow-hidden">

            {/* Background Image */}
           <div
              className="absolute inset-0 h-full w-full bg-cover bg-center"
              style={{
                backgroundImage: `url(${abstractBg})`,
              }}
            ></div>

            {/* Gradient overlay for better text contrast */}
            <div className="absolute inset-0 image-overlay"></div>

            {/* Content container */}
            <div className="relative z-10 w-full h-full flex flex-col justify-end p-6"> {/* Reduced padding */}

              {/* Bottom Branding Card - Liquid Glass Effect */}
              <div className={`brand-card-apple px-5 py-4 rounded-[20px] transition-all duration-500 ${ // Reduced padding/radius
                animations.logo ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8' // Reduced shift
              }`}>
                <div className="flex items-center gap-3 mb-1.5"> {/* Reduced gap/margin */}
                  <img
                    src={logoImage}
                    alt="Logo"
                    className="w-9 h-9 object-contain" // Reduced logo size
                  />
                  <span
                    className="text-xl font-bold text-gray-900" // Reduced font size
                    style={{ letterSpacing: "-0.03em" }}
                  >
                    DoctorAssist.Ai
                  </span>
                </div>
                <p
                  className="text-base font-semibold mb-0.5 text-gray-900" // Reduced font size
                  style={{ letterSpacing: "-0.01em" }}
                >
                  Empowering Healthcare, Seamlessly
                </p>
                <p className="text-xs font-medium text-gray-700"> {/* Reduced font size */}
                  Your Health, Your Records, Your Control.
                </p>
              </div>
            </div>
          </div>

          {/* Right Side - Login Form (Narrows space) */}
          <div className="w-full lg:w-[52%] right-panel-glass">
            <div className="content-wrapper">
              {/* Login Card - Liquid Glass Morphism */}
              <div className="apple-glass-card p-6" style={{ height: '420px' }}> {/* Reduced padding/height */}
                <div className={`mb-5 transition-all duration-500 ${ // Reduced margin
                  animations.heading ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6' // Reduced shift
                }`}>
                  <h1
                    className="text-2xl font-bold text-gray-900 mb-1" // Reduced font size
                    style={{ letterSpacing: "-0.03em" }}
                  >
                    Sign In
                  </h1>
                  <p className="text-gray-600 text-sm font-medium"> {/* Reduced font size */}
                    Welcome back to your dashboard
                  </p>
                </div>

                <form onSubmit={handleSubmit} ref={formRef} className="space-y-4"> {/* Reduced vertical space */}
                  <div className={`transition-all duration-500 delay-100 ${
                    animations.inputs ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6' // Reduced shift
                  }`}>
                    <label
                      className="block text-gray-900 mb-1.5 text-xs font-semibold uppercase tracking-tight-wide" // Reduced margin
                    >
                      USERNAME
                    </label>
                    <input
                      type="text"
                      name="email"
                      placeholder="Enter your username"
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full input-glass focus:outline-none"
                      required
                    />
                  </div>

                  <div className={`transition-all duration-500 delay-200 ${
                    animations.inputs ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6' // Reduced shift
                  }`}>
                    <label
                      className="block text-gray-900 mb-1.5 text-xs font-semibold uppercase tracking-tight-wide"
                    >
                      PASSWORD
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        placeholder="Enter your password"
                        value={formData.password}
                        onChange={handleChange}
                        className="w-full input-glass focus:outline-none pr-10" // Reduced padding
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-800 transition-colors" // Reduced padding
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        <svg
                          className="w-4 h-4" // Reduced icon size
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          {showPassword ? (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                          ) : (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.879 16.121A9.95 9.95 0 0112 17c4.478 0 8.268-2.943 9.542-7a10.025 10.025 0 00-4.045-4.524M3 3l18 18"
                            />
                          )}
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between transition-all duration-500 delay-300 ${
                    animations.inputs ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6' // Reduced shift
                  }`}>
                    <label className="flex items-center cursor-pointer space-x-2">
                      <input
                        type="checkbox"
                        className={`w-4 h-4 rounded border-gray-300 text-[${PRIMARY_BLUE}] focus:ring-1 focus:ring-[${PRIMARY_BLUE}]`}
                      />
                      <span className="text-sm font-medium text-gray-700">
                        Remember me
                      </span>
                    </label>
                    <a
                      href="#"
                      className={`text-sm font-semibold text-[${PRIMARY_BLUE}] hover:text-[#004d7c] transition-colors`}
                    >
                      Forgot password?
                    </a>
                  </div>

                  <div className={`transition-all duration-500 delay-400 ${
                    animations.button ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6' // Reduced shift
                  }`}>
                    <button
                      type="submit"
                      className="w-full login-btn text-white mt-3" // Reduced margin
                    >
                      Sign In
                    </button>
                  </div>
                </form>

                {message && (
                  <div
                    className={`mt-4 p-3 rounded-xl text-center font-medium text-sm transition-all duration-300 ${ // Reduced margin
                      message.includes("Error") || message.includes("failed")
                        ? "bg-red-50 text-red-600 border border-red-200"
                        : message.includes("successful")
                        ? "bg-green-50 text-green-600 border border-green-200"
                        : "bg-blue-50 text-blue-600 border border-blue-200"
                    } ${message ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                  >
                    {message}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModernLogin;