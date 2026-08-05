import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import logoImage from "../assets/lodo_only.png";
import logoImage_af from "../assets/econet-removebg-preview.png";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function Login() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [message, setMessage] = useState({ text: "", type: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setMessage({ text: "", type: "" });
  };

const handleSubmit = async (e) => {
  e.preventDefault();

  setLoading(true);
  setMessage({
    text: "Verifying credentials…",
    type: "info"
  });

  try {

    // ==============================
    // LOGIN TO YOUR BACKEND
    // ==============================
    const response = await fetch(
      `${API_BASE_URL}hms/users/auth/login`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
       
        body: JSON.stringify({
          username: formData.email,
          password: formData.password,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {

      setMessage({
        text:
          data.detail ||
          "Login failed. Please check your credentials.",
        type: "error"
      });

      setLoading(false);
      return;
    }

    console.log("✅ Backend Login Success:", data);

    // ======================================
    // CLEAR OLD TOKENS
    // ======================================
    localStorage.removeItem("access_token");

    // ======================================
    // SAVE BASIC USER INFO
    // ======================================
    localStorage.setItem("user_id", data.user_id);
    localStorage.setItem("role", data.role);
    if (data.role === "doctor") {

  // Remove previous theme
  localStorage.removeItem("theme");

  const themeResponse = await fetch(
    `${API_BASE_URL}hms/users/data/context/doctor/theme/${data.user_id}`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  if (themeResponse.ok) {
    const themeData = await themeResponse.json();

    localStorage.setItem(
      "theme",
      themeData.theme_name || "BlackWhite"
    );
  } else {
    localStorage.setItem("theme", "BlackWhite");
  }

} else {

  // For all non-doctor roles
  localStorage.removeItem("theme");
}
    // ======================================
    // CUSTOMER CARE → LOGIN TO ZENZO
    // ======================================
 

    // ======================================
    // SUCCESS
    // ======================================
    setMessage({
      text: "Authenticated. Redirecting…",
      type: "success"
    });

    setTimeout(() => {

      const routes = {
        doctor: `/doctor-dashboard?doctor_id=${data.user_id}`,
        hospital: `/hospital-dashboard?hospital_id=${data.user_id}`,
        system_admin: `/admin-dashboard`,
        communication_admin: `/communication-dashboard`,
        quality_admin: `/QualityCheckerRegistration`,
        "quality-checker": `/Qualitychecker?qc_id=${data.user_id}`,
        nurse: `/nurse-dashboard?nurse_id=${data.user_id}`,
        customer_care: `/customer-care-dashboard?agent_id=${data.user_id}`,
        monitoring_admin: `/monitoring-dashboard`,
        patient: `/patient-dashboard?patient_id=${data.user_id}`,
        "auditing-doctor-new": `/insurance/doctor-review-new`,
        supervisor: `/insurance/dashboard?user_id=${data.user_id}`,
      };

      navigate(routes[data.role] || "/");

    }, 800);

  } catch (err) {

    console.error("Login error:", err);

    setMessage({
      text:
        "Unable to connect to server. Please try again.",
      type: "error"
    });

  } finally {

    setLoading(false);
  }
};
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .da-login-root {
          font-family: 'Open Sans', sans-serif;
          font-weight: 300;
          background: #ffffff;
          color: #000000;
          min-height: 100vh;
          display: flex;
          -webkit-font-smoothing: antialiased;
        }

        /* ── LEFT PANEL ── */
        .da-left {
          width: 48%;
          background: #000000;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 3rem;
          position: relative;
          overflow: hidden;
        }
        .da-left-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .da-left-top {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .da-logo-mark {
          width: 36px;
          height: 36px;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .da-logo-mark img {
          width: 24px;
          height: 24px;
          object-fit: contain;
          filter: invert(1);
        }
        .da-brand-name {
  font-size: 2rem;
  font-weight: 300;
  font-family: 'Open Sans', sans-serif;
  color: #ffffff;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

        .da-left-middle {
          position: relative;
          z-index: 1;
        }
        .da-left-headline {
          font-size: clamp(1.8rem, 3.2vw, 2.8rem);
          font-weight: 300;
          color: #ffffff;
          letter-spacing: -0.03em;
          line-height: 1.1;
          margin-bottom: 1.25rem;
        }
        .da-left-sub {
          font-size: 0.82rem;
          color: rgba(255,255,255,0.5);
          line-height: 1.8;
          max-width: 340px;
        }

        .da-left-bottom {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .da-stat-row {
          display: flex;
          gap: 1.5rem;
        }
        .da-stat {
          border-top: 1px solid rgba(255,255,255,0.15);
          padding-top: 0.75rem;
        }
        .da-stat-number {
          font-size: 1.4rem;
          font-weight: 300;
          color: #ffffff;
          letter-spacing: -0.04em;
        }
        .da-stat-label {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255,255,255,0.4);
          margin-top: 0.15rem;
        }

        /* ── RIGHT PANEL ── */
        .da-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3rem 2rem;
          background: #ffffff;
          opacity: 0;
          transform: translateX(16px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .da-right.da-mounted {
          opacity: 1;
          transform: translateX(0);
        }

        .da-form-wrap {
          width: 100%;
          max-width: 380px;
        }

        .da-form-header {
          margin-bottom: 2.5rem;
        }
        .da-section-label {
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: #888888;
          font-weight: 400;
          margin-bottom: 0.75rem;
          display: block;
        }
        .da-form-title {
          font-size: clamp(1.4rem, 2.5vw, 1.9rem);
          font-weight: 300;
          letter-spacing: -0.025em;
          line-height: 1.15;
          color: #000000;
          margin-bottom: 0.5rem;
        }
        .da-form-subtitle {
          font-size: 0.82rem;
          color: #888888;
          line-height: 1.7;
        }

        /* ── FORM FIELDS ── */
        .da-field {
          margin-bottom: 1.25rem;
        }
        .da-field label {
          display: block;
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: #444444;
          font-weight: 400;
          margin-bottom: 0.5rem;
        }
        .da-input-wrap {
          position: relative;
        }
        .da-input {
          width: 100%;
          height: 44px;
          padding: 0 0.875rem;
          border: 1px solid #e0e0e0;
          background: #ffffff;
          font-family: 'Open Sans', sans-serif;
          font-weight: 300;
          font-size: 0.875rem;
          color: #000000;
          outline: none;
          border-radius: 0;
          transition: border-color 0.2s;
          appearance: none;
        }
        .da-input::placeholder {
          color: #bbbbbb;
          font-weight: 300;
        }
        .da-input:focus {
          border-color: #000000;
        }
        .da-input.da-has-toggle {
          padding-right: 2.75rem;
        }

        .da-toggle-btn {
          position: absolute;
          right: 0;
          top: 0;
          height: 44px;
          width: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          cursor: pointer;
          color: #888888;
          padding: 0;
        }
        .da-toggle-btn:hover { color: #000000; }
        .da-toggle-btn svg { width: 16px; height: 16px; }

        /* ── OPTIONS ROW ── */
        .da-options-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 2rem;
        }
        .da-remember {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
        }
        .da-remember input[type="checkbox"] {
          width: 14px;
          height: 14px;
          border: 1px solid #e0e0e0;
          border-radius: 0;
          accent-color: #000000;
          cursor: pointer;
        }
        .da-remember span {
          font-size: 0.78rem;
          color: #444444;
        }
        .da-forgot {
          font-size: 0.78rem;
          color: #444444;
          text-decoration: none;
          border-bottom: 1px solid transparent;
          transition: border-color 0.2s, color 0.2s;
        }
        .da-forgot:hover {
          color: #000000;
          border-bottom-color: #000000;
        }

        /* ── SUBMIT BUTTON ── */
        .da-submit {
          width: 100%;
          height: 48px;
          background: #000000;
          color: #ffffff;
          border: 1px solid #000000;
          font-family: 'Open Sans', sans-serif;
          font-weight: 400;
          font-size: 0.875rem;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
          border-radius: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        .da-submit:hover:not(:disabled) {
          background: transparent;
          color: #000000;
        }
        .da-submit:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .da-spinner {
          width: 14px;
          height: 14px;
          border: 1.5px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: da-spin 0.7s linear infinite;
          flex-shrink: 0;
        }
        @keyframes da-spin { to { transform: rotate(360deg); } }

        /* ── MESSAGE BANNER ── */
        .da-message {
          margin-top: 1rem;
          padding: 0.75rem 1rem;
          font-size: 0.78rem;
          border-left: 2px solid #000000;
          line-height: 1.6;
        }
        .da-message.info  { border-left-color: #000000; color: #444444; background: #fafafa; }
        .da-message.success { border-left-color: #000000; color: #000000; background: #fafafa; }
        .da-message.error { border-left-color: #000000; color: #000000; background: #fafafa; }

        /* ── DIVIDER / FOOTER ── */
        .da-form-footer {
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid #e0e0e0;
          display: flex;
          gap: 1.5rem;
          flex-wrap: wrap;
        }
        .da-footer-link {
          font-size: 0.72rem;
          color: #888888;
          text-decoration: none;
          transition: color 0.2s;
        }
        .da-footer-link:hover { color: #000000; }

        /* ── AGENT STATUS STRIP ── */
        .da-agent-strip {
          display: flex;
          gap: 0.875rem;
          margin-bottom: 2rem;
          flex-wrap: wrap;
        }
        .da-agent-pill {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.3rem 0.65rem;
          border: 1px solid #e0e0e0;
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #888888;
        }
        .da-agent-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #000000;
          animation: da-pulse 2s infinite;
          flex-shrink: 0;
        }
        @keyframes da-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* ── RESPONSIVE ── */
        @media (max-width: 860px) {
          .da-left { display: none; }
          .da-right { padding: 2rem 1.5rem; }
        }
          .da-brand-logo {
            height: 62px;
            width: auto;
            object-fit: contain;
            filter: brightness(0) invert(1); /* keeps logo white on black bg */
          }
      `}</style>

      <div className="da-login-root">

        {/* ── LEFT ── */}
        <div className="da-left">
          <div className="da-left-grid" />

          <div className="da-left-top">
           
            <span className="da-brand-name">DoctorAssist.AI</span>
            {/* <img
              src={logoImage_af}
              alt="DoctorAssist AI"
              className="da-brand-logo"
            /> */}
          </div>

          <div className="da-left-middle">
            <h1 className="da-left-headline">
              Clinical intelligence<br />that thinks<br />like you do.
            </h1>
            <p className="da-left-sub">
              A team of specialist agents that monitor, reason, and act — continuously.
              Transforming patient data into real-time diagnoses and research-backed insights.
            </p>
          </div>

          
        </div>

        {/* ── RIGHT ── */}
        <div className={`da-right ${mounted ? "da-mounted" : ""}`}>
          <div className="da-form-wrap">

            <div className="da-form-header">
              <span className="da-section-label">Clinical Interface</span>
              <h2 className="da-form-title">Sign in to your account.</h2>
              <p className="da-form-subtitle">
                Access your clinical workspace. All sessions are encrypted and HIPAA-compliant.
              </p>
            </div>

            {/* Agent status pills */}
            <div className="da-agent-strip">
              <div className="da-agent-pill"><span className="da-agent-dot" />5 agents active</div>
              <div className="da-agent-pill">EHR synced</div>
              <div className="da-agent-pill">HIPAA compliant</div>
            </div>

            <form onSubmit={handleSubmit} noValidate>

              <div className="da-field">
                <label htmlFor="da-email">Username</label>
                <div className="da-input-wrap">
                  <input
                    id="da-email"
                    className="da-input"
                    type="text"
                    name="email"
                    placeholder="Enter your username"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="da-field">
                <label htmlFor="da-password">Password</label>
                <div className="da-input-wrap">
                  <input
                    id="da-password"
                    className={`da-input da-has-toggle`}
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="da-toggle-btn"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.879 16.121A9.95 9.95 0 0112 17c4.478 0 8.268-2.943 9.542-7a10.025 10.025 0 00-4.045-4.524M3 3l18 18" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="da-options-row">
                <label className="da-remember">
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
                <a href="#" className="da-forgot">Forgot password?</a>
              </div>

                            <button
                type="submit"
                className="da-submit"
                disabled={loading}
              >
                {loading && <span className="da-spinner" />}
                {loading ? "Authenticating…" : "Sign In →"}
              </button>

              {/* Register Institution Link */}
              <div style={{ textAlign: "center", marginTop: "1rem" }}>
                <a 
                  href="https://doctorassist.ai/hospital-register"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "0.78rem",
                    color: "#888888",
                    textDecoration: "none",
                    borderBottom: "1px solid #e0e0e0",
                    transition: "color 0.2s, border-color 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.color = "#000000";
                    e.target.style.borderBottomColor = "#000000";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.color = "#888888";
                    e.target.style.borderBottomColor = "#e0e0e0";
                  }}
                >
                  Register your institution →
                </a>
              </div>
                    
            </form>

            {message.text && (
              <div className={`da-message ${message.type}`}>
                {message.text}
              </div>
            )}

            <div className="da-form-footer">
              <a href="#" className="da-footer-link">Privacy Policy</a>
              <a href="#" className="da-footer-link">Terms of Service</a>
              <a href="#" className="da-footer-link">Contact Support</a>
            </div>

          </div>
        </div>

      </div>
    </>
  );
}

export default Login;