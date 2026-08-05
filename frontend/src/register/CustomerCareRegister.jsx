import React, { useState, useMemo } from "react";
import Select from 'react-select';
import countryList from 'react-select-country-list';
import { UserPlus, Mail, Lock, Phone, Globe, Briefcase, Calendar, Languages, Shield, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import logoImage from "../assets/lodo_only.png";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching doctorassist.ai website & DoctorDashboard) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
};

/* ─── INLINE STYLES (matching DoctorDashboard) ─── */
const S = {
  layout: {
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  container: {
    width: "100%",
    maxWidth: "1280px",
    margin: "0 auto",
    background: T.bg,
    border: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  /* two column layout */
  twoCol: {
    display: "flex",
    flexWrap: "wrap",
  },
  leftPanel: {
    flex: "1.2",
    background: T.bgAlt,
    borderRight: `1px solid ${T.border}`,
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
  },
  rightPanel: {
    flex: "2",
    padding: "2rem",
    overflowY: "auto",
    maxHeight: "90vh",
  },
  logoArea: {
    marginBottom: "2rem",
    borderBottom: `1px solid ${T.border}`,
    paddingBottom: "1.5rem",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "0.75rem",
  },
  logoBox: {
    width: "32px",
    height: "32px",
    background: T.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },
  sectionLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.5rem",
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
    marginBottom: "0.5rem",
  },
  description: {
    fontSize: "0.78rem",
    color: T.textSec,
    marginBottom: "2rem",
    lineHeight: 1.5,
  },
  statCard: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    padding: "1.25rem",
    marginBottom: "1rem",
  },
  statNum: {
    fontSize: "1.8rem",
    fontWeight: 300,
    letterSpacing: "-0.04em",
    color: T.text,
    margin: 0,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    marginTop: "0.35rem",
    display: "block",
  },
  /* form elements */
  formGroup: {
    marginBottom: "1.25rem",
  },
  label: {
    display: "block",
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    marginBottom: "0.5rem",
    fontWeight: 400,
  },
  input: {
    width: "100%",
    padding: "0.7rem 0.875rem",
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    background: T.bg,
    border: `1px solid ${T.border}`,
    outline: "none",
    transition: "all 0.15s",
  },
  inputFocus: {
    borderColor: T.text,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1rem",
  },
  /* button styles matching dashboard */
  actionBtn: {
    padding: "0.7rem 1.5rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.7rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  outlineBtn: {
    padding: "0.5rem 0.875rem",
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    fontSize: "0.65rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
  },
  /* shift/department buttons */
  buttonGroup: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "0.5rem",
  },
  buttonGroup2: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "0.5rem",
  },
  toggleBtn: {
    padding: "0.6rem 0.5rem",
    background: T.bg,
    border: `1px solid ${T.border}`,
    fontSize: "0.7rem",
    fontWeight: 300,
    fontFamily: "'Open Sans', sans-serif",
    cursor: "pointer",
    transition: "all 0.15s",
    color: T.textSec,
    textAlign: "center",
  },
  toggleBtnActive: {
    background: T.text,
    color: T.bg,
    borderColor: T.text,
  },
  /* password wrapper */
  passwordWrapper: {
    position: "relative",
  },
  passwordToggle: {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: T.textMuted,
    padding: 0,
    display: "flex",
    alignItems: "center",
  },
  /* checkbox */
  checkboxWrap: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    margin: "1.25rem 0",
  },
  checkbox: {
    width: "16px",
    height: "16px",
    cursor: "pointer",
    accentColor: T.text,
  },
  checkboxLabel: {
    fontSize: "0.72rem",
    color: T.textSec,
  },
  link: {
    color: T.text,
    textDecoration: "underline",
    textUnderlineOffset: "3px",
    fontSize: "0.72rem",
  },
  messageBox: {
    marginTop: "1rem",
    padding: "0.75rem 1rem",
    fontSize: "0.72rem",
    textAlign: "center",
    border: `1px solid ${T.border}`,
  },
  messageError: {
    color: "#d32f2f",
    borderColor: "#d32f2f",
    background: "#fff5f5",
  },
  messageSuccess: {
    color: T.text,
    borderColor: T.text,
    background: T.bgAlt,
  },
  footer: {
    marginTop: "2rem",
    paddingTop: "1.5rem",
    borderTop: `1px solid ${T.border}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "1rem",
  },
  footerText: {
    fontSize: "0.65rem",
    color: T.textMuted,
  },
  /* badge */
  badge: {
    padding: "0.2rem 0.5rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
  },
};

/* ─── CUSTOM REACT-SELECT STYLES (matching theme) ─── */
const selectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: T.bg,
    borderColor: T.border,
    borderWidth: "1px",
    borderRadius: "0",
    boxShadow: "none",
    minHeight: "auto",
    padding: "0.2rem 0",
    fontFamily: "'Open Sans', sans-serif",
    fontSize: "0.78rem",
    fontWeight: 300,
    "&:hover": { borderColor: T.text },
  }),
  input: (base) => ({
    ...base,
    fontFamily: "'Open Sans', sans-serif",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.text,
  }),
  placeholder: (base) => ({
    ...base,
    color: T.textMuted,
    fontSize: "0.78rem",
    fontWeight: 300,
  }),
  singleValue: (base) => ({
    ...base,
    color: T.text,
    fontSize: "0.78rem",
    fontWeight: 300,
  }),
  menu: (base) => ({
    ...base,
    borderRadius: "0",
    border: `1px solid ${T.border}`,
    boxShadow: "none",
    backgroundColor: T.bg,
    zIndex: 10,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? T.bgAlt : T.bg,
    color: T.text,
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    padding: "0.5rem 0.875rem",
    cursor: "pointer",
    "&:active": { backgroundColor: T.bgTert },
  }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: T.bgAlt,
    border: `1px solid ${T.border}`,
    borderRadius: "0",
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: T.text,
    fontSize: "0.7rem",
    fontWeight: 300,
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: T.textMuted,
    "&:hover": { backgroundColor: T.border, color: T.text },
  }),
};

function CustomerCareRegister() {
  const [formData, setFormData] = useState({
    full_name: "",
    username: "",
    email: "",
    password: "",
    confirm_password: "",
    phone_number: "",
    employee_id: "",
    shift_timing: "rotational",
    department: "emergency_response",
    country_code: "IN",
    language_skills: [],
    experience_years: "",
    certification_id: "",
  });

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const countryOptions = useMemo(() => countryList().getData(), []);
  const [selectedCountry, setSelectedCountry] = useState(
    countryOptions.find(option => option.value === 'IN')
  );

  const languageOptions = [
    { value: 'english', label: 'English' },
    { value: 'hindi', label: 'Hindi' },
    { value: 'tamil', label: 'Tamil' },
    { value: 'telugu', label: 'Telugu' },
    { value: 'kannada', label: 'Kannada' },
    { value: 'malayalam', label: 'Malayalam' },
    { value: 'marathi', label: 'Marathi' },
    { value: 'gujarati', label: 'Gujarati' },
    { value: 'bengali', label: 'Bengali' },
    { value: 'punjabi', label: 'Punjabi' },
  ];

  const handleCountryChange = (selectedOption) => {
    setSelectedCountry(selectedOption);
    setFormData(prev => ({ ...prev, country_code: selectedOption ? selectedOption.value : 'IN' }));
  };

  const handleLanguageChange = (selectedOptions) => {
    setFormData(prev => ({ ...prev, language_skills: selectedOptions ? selectedOptions.map(opt => opt.value) : [] }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'experience_years') {
      setFormData(prev => ({ ...prev, [name]: value === '' ? '' : parseInt(value) }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleShiftChange = (shift) => {
    setFormData(prev => ({ ...prev, shift_timing: shift }));
  };

  const handleDepartmentChange = (dept) => {
    setFormData(prev => ({ ...prev, department: dept }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setMessageType("");

    if (!termsAccepted) {
      setMessage("Please accept the terms and conditions");
      setMessageType("error");
      return;
    }

    if (formData.password !== formData.confirm_password) {
      setMessage("Passwords do not match");
      setMessageType("error");
      return;
    }

    if (formData.password.length < 6) {
      setMessage("Password must be at least 6 characters long");
      setMessageType("error");
      return;
    }

    if (!formData.full_name || !formData.username || !formData.email || !formData.phone_number) {
      setMessage("Please fill all required fields");
      setMessageType("error");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setMessage("Please enter a valid email address");
      setMessageType("error");
      return;
    }

    if (formData.phone_number.length < 8) {
      setMessage("Please enter a valid phone number");
      setMessageType("error");
      return;
    }

    const submissionData = {
      full_name: formData.full_name,
      username: formData.username,
      email: formData.email,
      password: formData.password,
      phone_number: formData.phone_number,
      employee_id: formData.employee_id || null,
      shift_timing: formData.shift_timing,
      department: formData.department,
      country_code: formData.country_code,
      language_skills: formData.language_skills,
      experience_years: formData.experience_years ? parseInt(formData.experience_years) : 0,
      certification_id: formData.certification_id || null,
      user_type: "customer_care",
    };

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/customercare/customercareregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Error registering customer care agent");
      }

      setMessage(data.message || "Customer Care Agent registered successfully!");
      setMessageType("success");

      // Reset form
      setFormData({
        full_name: "",
        username: "",
        email: "",
        password: "",
        confirm_password: "",
        phone_number: "",
        employee_id: "",
        shift_timing: "rotational",
        department: "emergency_response",
        country_code: "IN",
        language_skills: [],
        experience_years: "",
        certification_id: "",
      });
      setSelectedCountry(countryOptions.find(option => option.value === 'IN'));
      setTermsAccepted(false);
      setShowPassword(false);
      setShowConfirmPassword(false);
    } catch (err) {
      setMessage(err.message || "An error occurred during registration");
      setMessageType("error");
    }
  };

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-input:focus { border-color: ${T.text} !important; }
        .da-btn-primary:hover { background: transparent !important; color: ${T.text} !important; }
        .da-toggle-btn:hover { background: ${T.bgAlt} !important; border-color: ${T.text} !important; }
        .da-link:hover { color: ${T.text} !important; }
        @media (max-width: 768px) {
          .da-two-col { flex-direction: column; }
          .da-left-panel { border-right: none; border-bottom: 1px solid ${T.border}; }
          .da-row { grid-template-columns: 1fr !important; }
          .da-btn-group { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      <div style={S.container} className="da-two-col">
        <div style={S.twoCol}>
          {/* LEFT PANEL - Brand & Info */}
          <div style={S.leftPanel} className="da-left-panel">
            <div style={S.logoArea}>
              <div style={S.brandRow}>
               
                <span style={S.brandName}>DoctorAssist.AI</span>
              </div>
              <span style={S.sectionLabel}>Customer Care</span>
              <h2 style={S.pageTitle}>Join Our Response Team</h2>
              <p style={S.description}>
                Be the first point of contact in emergencies. Make a difference every day.
              </p>
            </div>

            <div style={S.statCard}>
              <p style={S.statNum}>24/7</p>
              <span style={S.statLabel}>Emergency Support</span>
            </div>
            <div style={S.statCard}>
              <p style={S.statNum}>Multi-lingual</p>
              <span style={S.statLabel}>Patient Communication</span>
            </div>
            <div style={S.statCard}>
              <p style={S.statNum}>Critical</p>
              <span style={S.statLabel}>Response Training</span>
            </div>

            <div style={{ marginTop: "auto", paddingTop: "2rem" }}>
              <div style={{ ...S.badge, width: "100%", textAlign: "center" }}>
                Emergency Response Team
              </div>
              <p style={{ fontSize: "0.6rem", color: T.textMuted, textAlign: "center", marginTop: "1rem" }}>
                Compassionate care • Trained professionals • Life-saving coordination
              </p>
            </div>
          </div>

          {/* RIGHT PANEL - Registration Form */}
          <div style={S.rightPanel}>
            <div>
              <span style={S.pageLabel}>Registration Form</span>
              <h1 style={S.pageTitle}>Customer Care Agent</h1>
              <p style={S.description}>Complete the form below to register as a customer care representative.</p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="da-row" style={S.row}>
                {/* Left column */}
                <div>
                  <div style={S.formGroup}>
                    <label style={S.label}>Full Name *</label>
                    <input
                      type="text"
                      name="full_name"
                      value={formData.full_name}
                      onChange={handleChange}
                      placeholder="Enter full name"
                      className="da-input"
                      style={S.input}
                      onFocus={(e) => e.target.style.borderColor = T.text}
                      onBlur={(e) => e.target.style.borderColor = T.border}
                      required
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Username *</label>
                    <input
                      type="text"
                      name="username"
                      value={formData.username}
                      onChange={handleChange}
                      placeholder="Choose a username"
                      className="da-input"
                      style={S.input}
                      required
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Email Address *</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="agent@company.com"
                      className="da-input"
                      style={S.input}
                      required
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Phone Number *</label>
                    <input
                      type="tel"
                      name="phone_number"
                      value={formData.phone_number}
                      onChange={handleChange}
                      placeholder="Phone number"
                      className="da-input"
                      style={S.input}
                      required
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Country Code *</label>
                    <Select
                      options={countryOptions}
                      value={selectedCountry}
                      onChange={handleCountryChange}
                      styles={selectStyles}
                      isSearchable
                      placeholder="Select country"
                    />
                  </div>
                </div>

                {/* Right column */}
                <div>
                  <div style={S.formGroup}>
                    <label style={S.label}>Employee ID</label>
                    <input
                      type="text"
                      name="employee_id"
                      value={formData.employee_id}
                      onChange={handleChange}
                      placeholder="EMP-XXXX"
                      className="da-input"
                      style={S.input}
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Experience (Years)</label>
                    <input
                      type="number"
                      name="experience_years"
                      value={formData.experience_years}
                      onChange={handleChange}
                      placeholder="Years of experience"
                      className="da-input"
                      style={S.input}
                      min="0"
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Certification ID</label>
                    <input
                      type="text"
                      name="certification_id"
                      value={formData.certification_id}
                      onChange={handleChange}
                      placeholder="Emergency response certification"
                      className="da-input"
                      style={S.input}
                    />
                  </div>

                  <div style={S.formGroup}>
                    <label style={S.label}>Languages Known *</label>
                    <Select
                      options={languageOptions}
                      isMulti
                      onChange={handleLanguageChange}
                      styles={selectStyles}
                      placeholder="Select languages"
                    />
                  </div>
                </div>
              </div>

              {/* Shift Timing */}
              <div style={S.formGroup}>
                <label style={S.label}>Shift Preference *</label>
                <div className="da-btn-group" style={S.buttonGroup}>
                  {[
                    { value: "morning", label: "Morning", sub: "6AM-2PM" },
                    { value: "evening", label: "Evening", sub: "2PM-10PM" },
                    { value: "night", label: "Night", sub: "10PM-6AM" },
                    { value: "rotational", label: "Rotational", sub: "" },
                  ].map((shift) => (
                    <button
                      key={shift.value}
                      type="button"
                      onClick={() => handleShiftChange(shift.value)}
                      className="da-toggle-btn"
                      style={{
                        ...S.toggleBtn,
                        ...(formData.shift_timing === shift.value ? S.toggleBtnActive : {}),
                      }}
                    >
                      {shift.label}
                      {shift.sub && <div style={{ fontSize: "0.55rem", opacity: 0.7 }}>{shift.sub}</div>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Department */}
              <div style={S.formGroup}>
                <label style={S.label}>Department *</label>
                <div className="da-btn-group" style={S.buttonGroup2}>
                  {[
                    { value: "emergency_response", label: "Emergency Response" },
                    { value: "dispatch", label: "Dispatch Center" },
                    { value: "triage_support", label: "Triage Support" },
                    { value: "patient_followup", label: "Patient Follow-up" },
                  ].map((dept) => (
                    <button
                      key={dept.value}
                      type="button"
                      onClick={() => handleDepartmentChange(dept.value)}
                      className="da-toggle-btn"
                      style={{
                        ...S.toggleBtn,
                        ...(formData.department === dept.value ? S.toggleBtnActive : {}),
                      }}
                    >
                      {dept.icon} {dept.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password Fields */}
              <div className="da-row" style={S.row}>
                <div style={S.formGroup}>
                  <label style={S.label}>Password *</label>
                  <div style={S.passwordWrapper}>
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Create a secure password"
                      className="da-input"
                      style={S.input}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={S.passwordToggle}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>Confirm Password *</label>
                  <div style={S.passwordWrapper}>
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      name="confirm_password"
                      value={formData.confirm_password}
                      onChange={handleChange}
                      placeholder="Confirm your password"
                      className="da-input"
                      style={S.input}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={S.passwordToggle}
                    >
                      {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Terms */}
              <div style={S.checkboxWrap}>
                <input
                  type="checkbox"
                  id="terms"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  style={S.checkbox}
                />
                <label htmlFor="terms" style={S.checkboxLabel}>
                  I accept the{" "}
                  <a href="#" className="da-link" style={S.link}>Terms and Conditions</a>{" "}
                  &{" "}
                  <a href="#" className="da-link" style={S.link}>Privacy Policy</a>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="da-btn-primary"
                style={S.actionBtn}
                onMouseEnter={(e) => { e.currentTarget.style.background = T.bg; e.currentTarget.style.color = T.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = T.text; e.currentTarget.style.color = T.bg; }}
              >
                <UserPlus size={14} /> Register as Customer Care Agent
              </button>
            </form>

            {/* Message Display */}
            {message && (
              <div style={{
                ...S.messageBox,
                ...(messageType === "error" ? S.messageError : S.messageSuccess),
              }}>
                {messageType === "error" ? <AlertCircle size={14} style={{ display: "inline", marginRight: "6px" }} /> : <CheckCircle size={14} style={{ display: "inline", marginRight: "6px" }} />}
                {message}
              </div>
            )}

            {/* Footer */}
            <div style={S.footer}>
            
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomerCareRegister;