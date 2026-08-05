import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Phone, Mail, User, Calendar, CalendarCheck, CalendarPlus,
  GraduationCap, FileText, MapPin, Plus, UserCheck,
  Stethoscope, DollarSign, Activity, Clock, HeartPulse,
  Briefcase, Home, LogOut, BriefcaseMedical, ChevronRight,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const GENDERS        = ["Male", "Female", "Other"];
const MARITAL_STATUS = ["Single", "Married", "Divorced", "Widowed"];
const BLOOD_GROUPS   = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/* ─────────────────────────────────────────
   THEME TOKENS
───────────────────────────────────────── */
const T = {
  bg:        "#ffffff",
  bgAlt:     "#fafafa",
  bgTert:    "#f5f5f5",
  text:      "#000000",
  textSec:   "#444444",
  textMuted: "#888888",
  border:    "#e0e0e0",
  borderStr: "#000000",
  font:      "'Open Sans', sans-serif",
};

/* ─────────────────────────────────────────
   GLOBAL CSS
───────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::selection { background: #000; color: #fff; }

  .da-reg-root {
    font-family: ${T.font};
    font-weight: 300;
    background: ${T.bg};
    color: ${T.text};
    min-height: 100vh;
    display: flex;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Sidebar ── */
  .da-sidebar {
    width: 240px;
    min-height: 100vh;
    position: fixed;
    top: 0; left: 0;
    background: ${T.bg};
    border-right: 1px solid ${T.border};
    display: flex;
    flex-direction: column;
    z-index: 100;
  }
  .da-sidebar-header {
    padding: 1.5rem 1.5rem 1rem;
    border-bottom: 1px solid ${T.border};
  }
  .da-brand-row {
    display: flex; align-items: center; gap: 10px; margin-bottom: 1.25rem;
  }
  .da-logo-box {
    width: 32px; height: 32px;
    background: ${T.text};
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .da-brand-name {
    font-size: 0.9rem; font-weight: 400;
    letter-spacing: -0.01em; color: ${T.text};
  }
  .da-sidebar-nav { flex: 1; padding: 0.75rem 0; }
  .da-nav-group-label {
    font-size: 0.58rem; text-transform: uppercase;
    letter-spacing: 0.15em; color: ${T.textMuted};
    font-weight: 400; padding: 0.5rem 1.25rem 0.25rem;
    display: block;
  }
  .da-nav-btn {
    width: 100%; background: transparent; border: none;
    text-align: left; padding: 0.55rem 1.25rem;
    font-size: 0.78rem; font-weight: 300;
    color: ${T.textSec}; cursor: pointer;
    display: flex; align-items: center; gap: 10px;
    transition: all 0.15s;
    font-family: ${T.font};
    border-left: 2px solid transparent;
  }
  .da-nav-btn:hover { background: ${T.bgAlt}; color: ${T.text}; }
  .da-nav-btn.active { background: ${T.bgAlt}; color: ${T.text}; font-weight: 400; border-left-color: ${T.borderStr}; }

  /* step tracker in sidebar */
  .da-step-track { padding: 1.25rem 1.5rem; border-top: 1px solid ${T.border}; }
  .da-step-row { display: flex; align-items: center; gap: 0; margin-bottom: 0.5rem; }
  .da-step-num {
    width: 28px; height: 28px;
    border: 1px solid ${T.border};
    display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem; font-weight: 400; flex-shrink: 0;
    color: ${T.textMuted}; background: ${T.bg};
    transition: all 0.2s;
  }
  .da-step-num.active { background: ${T.text}; color: ${T.bg}; border-color: ${T.text}; }
  .da-step-num.done  { background: ${T.bgAlt}; color: ${T.text}; border-color: ${T.borderStr}; }
  .da-step-line { flex: 1; height: 1px; background: ${T.border}; margin: 0 4px; }
  .da-step-line.done { background: ${T.borderStr}; }
  .da-step-label {
    font-size: 0.65rem; color: ${T.textMuted};
    text-transform: uppercase; letter-spacing: 0.1em;
    margin-top: 0.25rem;
  }
  .da-step-label span { color: ${T.text}; font-weight: 400; }

  /* sidebar footer */
  .da-sidebar-footer {
    padding: 1rem 1.25rem;
    border-top: 1px solid ${T.border};
    flex-shrink: 0;
  }
  .da-logout-btn {
    width: 100%; background: transparent;
    border: 1px solid ${T.border}; padding: 0.6rem 1rem;
    font-size: 0.75rem; font-weight: 400; color: ${T.textSec};
    cursor: pointer; display: flex; align-items: center;
    justify-content: center; gap: 8px;
    font-family: ${T.font}; transition: all 0.2s;
  }
  .da-logout-btn:hover { border-color: ${T.borderStr}; color: ${T.text}; }

  /* ── Main content ── */
  .da-main {
    margin-left: 240px;
    flex: 1; min-width: 0;
    display: flex; flex-direction: column;
  }

  /* top bar */
  .da-topbar {
    position: sticky; top: 0; z-index: 50;
    background: ${T.bg}; border-bottom: 1px solid ${T.border};
    padding: 0.875rem 2rem;
    display: flex; justify-content: space-between; align-items: center;
  }
  .da-page-label {
    font-size: 0.6rem; text-transform: uppercase;
    letter-spacing: 0.2em; color: ${T.textMuted};
    font-weight: 400; display: block; margin-bottom: 0.15rem;
  }
  .da-page-title {
    font-size: 1rem; font-weight: 400;
    letter-spacing: -0.01em; color: ${T.text}; margin: 0;
  }
  .da-progress-pills { display: flex; gap: 1px; background: ${T.border}; }
  .da-progress-pill {
    padding: 0.4rem 0.875rem; background: ${T.bg};
    font-size: 0.65rem; font-weight: 300; color: ${T.textMuted};
    text-transform: uppercase; letter-spacing: 0.1em;
    transition: all 0.15s;
  }
  .da-progress-pill.active { background: ${T.text}; color: ${T.bg}; font-weight: 400; }
  .da-progress-pill.done  { background: ${T.bgAlt}; color: ${T.text}; }

  /* body */
  .da-body { padding: 2rem; flex: 1; }

  /* ── Form section card ── */
  .da-form-section {
    border: 1px solid ${T.border};
    margin-bottom: 1.5rem;
  }
  .da-form-section-header {
    padding: 0.875rem 1.25rem;
    background: ${T.bgAlt};
    border-bottom: 1px solid ${T.border};
    display: flex; align-items: center; gap: 8px;
  }
  .da-form-section-title {
    font-size: 0.72rem; font-weight: 400;
    text-transform: uppercase; letter-spacing: 0.12em; color: ${T.text};
  }
  .da-form-section-body {
    padding: 1.5rem;
    display: grid; gap: 1.25rem;
  }

  /* field group */
  .da-field { display: flex; flex-direction: column; gap: 0.4rem; }
  .da-label {
    font-size: 0.6rem; text-transform: uppercase;
    letter-spacing: 0.15em; color: ${T.textMuted};
    font-weight: 400; display: flex; align-items: center; gap: 5px;
  }
  .da-label .req { color: ${T.text}; font-weight: 600; margin-left: 2px; }
  .da-input {
    width: 100%; height: 42px;
    padding: 0 0.875rem;
    border: 1px solid ${T.border};
    background: ${T.bg};
    font-family: ${T.font}; font-weight: 300;
    font-size: 0.82rem; color: ${T.text};
    outline: none; border-radius: 0;
    transition: border-color 0.15s;
    appearance: none;
  }
  .da-input::placeholder { color: #bbbbbb; font-weight: 300; }
  .da-input:focus { border-color: ${T.borderStr}; }
  .da-input:hover { border-color: #c0c0c0; }
  textarea.da-input { height: auto; padding: 0.65rem 0.875rem; resize: vertical; }
  select.da-input { cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 2rem; }

  .da-input-hint { font-size: 0.65rem; color: ${T.textMuted}; margin-top: 2px; }

  /* ── Navigation buttons ── */
  .da-btn-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.25rem 0 0; border-top: 1px solid ${T.border}; gap: 0.75rem;
  }
  .da-btn-primary {
    padding: 0.65rem 1.75rem;
    background: ${T.text}; color: ${T.bg};
    border: 1px solid ${T.text};
    font-family: ${T.font}; font-size: 0.78rem; font-weight: 400;
    cursor: pointer; transition: all 0.15s;
    display: inline-flex; align-items: center; gap: 6px;
    letter-spacing: 0.04em;
  }
  .da-btn-primary:hover { background: transparent; color: ${T.text}; }
  .da-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .da-btn-outline {
    padding: 0.65rem 1.25rem;
    background: ${T.bg}; color: ${T.textSec};
    border: 1px solid ${T.border};
    font-family: ${T.font}; font-size: 0.78rem; font-weight: 300;
    cursor: pointer; transition: all 0.15s;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .da-btn-outline:hover { border-color: ${T.borderStr}; color: ${T.text}; }

  /* ── Message banner ── */
  .da-message {
    margin-top: 1rem; padding: 0.75rem 1rem;
    border-left: 2px solid ${T.borderStr};
    font-size: 0.78rem; line-height: 1.6;
    background: ${T.bgAlt};
  }
  .da-message.success { border-left-color: ${T.borderStr}; color: ${T.text}; }
  .da-message.error   { border-left-color: ${T.borderStr}; color: ${T.text}; }

  /* grid helpers */
  .da-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .da-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .da-col-3  { grid-column: span 3; }
  .da-col-2  { grid-column: span 2; }

  @media (max-width: 900px) {
    .da-sidebar { display: none; }
    .da-main    { margin-left: 0; }
    .da-grid-3  { grid-template-columns: 1fr 1fr; }
    .da-col-3   { grid-column: span 2; }
    .da-body    { padding: 1rem; }
  }
  @media (max-width: 540px) {
    .da-grid-3, .da-grid-2 { grid-template-columns: 1fr; }
    .da-col-3, .da-col-2   { grid-column: span 1; }
  }
`;

/* ─────────────────────────────────────────
   FIELD COMPONENT
───────────────────────────────────────── */
function Field({ label, required, hint, icon, children }) {
  return (
    <div className="da-field">
      <label className="da-label">
        {icon && React.cloneElement(icon, { size: 11, style: { flexShrink: 0 } })}
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {hint && <span className="da-input-hint">{hint}</span>}
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
function RegisterPatient() {
  const navigate      = useNavigate();
  const location      = useLocation();
  const params        = new URLSearchParams(location.search);
  const doctorId      = params.get("doctor_id");
  const hospitalId    = params.get("hospital_id");

  const [authChecked, setAuthChecked] = useState(false);
  const [step,        setStep]        = useState(1);
  const [loading,     setLoading]     = useState(false);
  const [message,     setMessage]     = useState({ text: "", type: "" });

  const [formData, setFormData] = useState({
    hms_id: "", name: "", email: "", phone_number: "",
    date_of_birth: "", gender: "", blood_group: "",
    marital_status: "", address: "", education: "",
    occupation: "", annual_income: "", family_history: "",
    created_at: new Date().toISOString(),
    doctor_id: doctorId, hospital_id: hospitalId,
  });

  const [apptData, setApptData] = useState({
    appointment_date: "", appointment_time: "",
    visit_type: "OPD", notes: "",
  });

  /* auth verify */
  useEffect(() => {
    const verify = async () => {
      try {
        const res  = await fetch(`${API_BASE_URL}hms/users/doctors/verify`, { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!doctorId || doctorId !== data.doctor.sys_user_id) { navigate("/login"); return; }
      } catch { navigate("/login"); }
      finally  { setAuthChecked(true); }
    };
    verify();
  }, [doctorId, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "phone_number") {
      setFormData(p => ({ ...p, [name]: value.replace(/\D/g, "").slice(0, 15) }));
    } else {
      setFormData(p => ({ ...p, [name]: value }));
    }
  };

  const handleApptChange = (e) => {
    const { name, value } = e.target;
    setApptData(p => ({ ...p, [name]: value }));
  };

  const setMsg = (text, type = "info") => setMessage({ text, type });

  const handleNext = (e) => {
    e.preventDefault();
    if (step === 1 && (!formData.hms_id || !formData.phone_number || !formData.name || !formData.date_of_birth || !formData.gender)) {
      setMsg("Please fill all required fields before continuing.", "error"); return;
    }
    setMessage({ text: "", type: "" });
    setStep(s => s + 1);
  };

  const handleBack = () => { setMessage({ text: "", type: "" }); setStep(s => s - 1); };

  const registerPatient = async () => {
    const res  = await fetch(`${API_BASE_URL}hms/users/patients/patientadd`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    return data;
  };

  const handleCompleteOnly = async () => {
    try {
      setLoading(true); setMsg("Registering patient…");
      const data = await registerPatient();
      setMsg(`Patient registered. ID: ${data.patient_id}`, "success");
      setTimeout(() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`), 1400);
    } catch (err) { setMsg(err.message, "error"); }
    finally       { setLoading(false); }
  };

  const handleSaveAppointment = async () => {
    if (!apptData.appointment_date) { setMsg("Appointment date is required.", "error"); return; }
    try {
      setLoading(true); setMsg("Registering patient and booking appointment…");
      const patientData = await registerPatient();
      const payload = {
        doctor_id: doctorId, sys_user_id: patientData.sys_user_id,
        date: apptData.appointment_date,
        scheduled_time: apptData.appointment_time || null,
        visit_type: apptData.visit_type,
        chief_complaint: apptData.notes || "",
      };
      const res  = await fetch(`${API_BASE_URL}hms/users/doctors/take_appointment`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Appointment booking failed");
      setMsg("Patient registered and appointment booked.", "success");
      setTimeout(() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`), 1400);
    } catch (err) { setMsg(err.message, "error"); }
    finally       { setLoading(false); }
  };

  if (!authChecked) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, fontWeight: 300, fontSize: "0.82rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.15em" }}>
        Verifying session…
      </div>
    );
  }

  const stepLabels = ["Identity", "Demographics", "Appointment"];

  return (
    <>
      <style>{CSS}</style>
      <div className="da-reg-root">

        {/* ══════════ SIDEBAR ══════════ */}
        <aside className="da-sidebar">
          <div className="da-sidebar-header">
            <div className="da-brand-row">
              
              <span className="da-brand-name">Doctorassist.AI</span>
            </div>
            <span className="da-page-label">Patient Registration</span>
          </div>

          <nav className="da-sidebar-nav">
            <span className="da-nav-group-label">Navigation</span>
            <button className="da-nav-btn" onClick={() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`)}>
              <Home size={14} /> Dashboard
            </button>
            <button className="da-nav-btn active">
              <Plus size={14} /> New Patient
            </button>
          </nav>

          <div className="da-step-track">
            <span className="da-nav-group-label" style={{ padding: 0, marginBottom: "0.75rem", display: "block" }}>Registration Progress</span>
            <div className="da-step-row">
              {[1, 2, 3].map((n, i) => (
                <React.Fragment key={n}>
                  <div className={`da-step-num ${step === n ? "active" : step > n ? "done" : ""}`}>{n}</div>
                  {i < 2 && <div className={`da-step-line ${step > n ? "done" : ""}`} />}
                </React.Fragment>
              ))}
            </div>
            <p className="da-step-label" style={{ marginTop: "0.5rem" }}>
              Step {step}: <span>{stepLabels[step - 1]}</span>
            </p>
          </div>

          <div className="da-sidebar-footer">
            <button className="da-logout-btn" onClick={() => navigate("/login")}>
              <LogOut size={13} /> Logout
            </button>
          </div>
        </aside>

        {/* ══════════ MAIN ══════════ */}
        <main className="da-main">

          {/* top bar */}
          <div className="da-topbar">
            <div>
              <span className="da-page-label">Patient Management</span>
              <h1 className="da-page-title">Register New Patient</h1>
            </div>
            <div className="da-progress-pills">
              {stepLabels.map((label, i) => (
                <div key={i} className={`da-progress-pill ${step === i + 1 ? "active" : step > i + 1 ? "done" : ""}`}>
                  {i + 1}. {label}
                </div>
              ))}
            </div>
          </div>

          <div className="da-body">
            <form
              onSubmit={(e) => e.preventDefault()}
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            >

              {/* ════ STEP 1 — Identity ════ */}
              {step === 1 && (
                <div className="da-form-section">
                  <div className="da-form-section-header">
                    <UserCheck size={13} color={T.textMuted} />
                    <span className="da-form-section-title">Identity & Required Details</span>
                  </div>
                  <div className="da-form-section-body da-grid-3">

                    <Field label="HMS ID (Username)" required icon={<User />}>
                      <input className="da-input" name="hms_id" placeholder="Unique patient identifier"
                        value={formData.hms_id} onChange={handleChange} />
                    </Field>

                    <Field label="Phone Number" required icon={<Phone />} hint="Used as default password.">
                      <input className="da-input" name="phone_number" type="tel"
                        placeholder="10–15 digits" maxLength={15}
                        value={formData.phone_number} onChange={handleChange} />
                    </Field>

                    <Field label="Email" icon={<Mail />}>
                      <input className="da-input" name="email" type="email"
                        placeholder="patient@example.com"
                        value={formData.email} onChange={handleChange} />
                    </Field>

                    <Field label="Full Name" required icon={<User />}>
                      <input className="da-input" name="name"
                        placeholder="Patient's legal name"
                        value={formData.name} onChange={handleChange} />
                    </Field>

                    <Field label="Date of Birth" required icon={<Calendar />}>
                      <input className="da-input" name="date_of_birth" type="date"
                        value={formData.date_of_birth} onChange={handleChange} />
                    </Field>

                    <Field label="Gender" required icon={<User />}>
                      <select className="da-input" name="gender"
                        value={formData.gender} onChange={handleChange}>
                        <option value="">Select gender</option>
                        {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </Field>

                  </div>
                </div>
              )}

              {/* ════ STEP 2 — Demographics ════ */}
              {step === 2 && (
                <div className="da-form-section">
                  <div className="da-form-section-header">
                    <HeartPulse size={13} color={T.textMuted} />
                    <span className="da-form-section-title">Medical & Socio-economic Details (Optional)</span>
                  </div>
                  <div className="da-form-section-body da-grid-3">

                    <Field label="Blood Group" icon={<HeartPulse />}>
                      <select className="da-input" name="blood_group"
                        value={formData.blood_group} onChange={handleChange}>
                        <option value="">Select group</option>
                        {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
                      </select>
                    </Field>

                    <Field label="Marital Status" icon={<UserCheck />}>
                      <select className="da-input" name="marital_status"
                        value={formData.marital_status} onChange={handleChange}>
                        <option value="">Select status</option>
                        {MARITAL_STATUS.map(ms => <option key={ms} value={ms}>{ms}</option>)}
                      </select>
                    </Field>

                    <Field label="Education" icon={<GraduationCap />}>
                      <input className="da-input" name="education"
                        placeholder="Highest level of education"
                        value={formData.education} onChange={handleChange} />
                    </Field>

                    <Field label="Occupation" icon={<Briefcase />}>
                      <input className="da-input" name="occupation"
                        placeholder="Current job / profession"
                        value={formData.occupation} onChange={handleChange} />
                    </Field>

                    <Field label="Annual Income" icon={<DollarSign />}>
                      <input className="da-input" name="annual_income" type="number"
                        placeholder="Income (optional)"
                        value={formData.annual_income} onChange={handleChange} />
                    </Field>

                    <div /> {/* spacer */}

                    <div className="da-col-3">
                      <Field label="Address" icon={<MapPin />}>
                        <textarea className="da-input" name="address" rows={3}
                          placeholder="Permanent address"
                          value={formData.address} onChange={handleChange} />
                      </Field>
                    </div>

                    <div className="da-col-3">
                      <Field label="Family History" icon={<HeartPulse />}>
                        <textarea className="da-input" name="family_history" rows={3}
                          placeholder="Relevant family medical history (diabetes, hypertension, etc.)"
                          value={formData.family_history} onChange={handleChange} />
                      </Field>
                    </div>

                  </div>
                </div>
              )}

              {/* ════ STEP 3 — Appointment ════ */}
              {step === 3 && (
                <div className="da-form-section">
                  <div className="da-form-section-header">
                    <Activity size={13} color={T.textMuted} />
                    <span className="da-form-section-title">Schedule Appointment</span>
                  </div>
                  <div className="da-form-section-body da-grid-3">

                    <Field label="Appointment Date" required icon={<Calendar />}>
                      <input className="da-input" type="date" name="appointment_date"
                        value={apptData.appointment_date} onChange={handleApptChange} />
                    </Field>

                    <Field label="Time (Optional)" icon={<Clock />}>
                      <input className="da-input" type="time" name="appointment_time"
                        value={apptData.appointment_time} onChange={handleApptChange} />
                    </Field>

                    <Field label="Visit Type" icon={<BriefcaseMedical />}>
                      <select className="da-input" name="visit_type"
                        value={apptData.visit_type} onChange={handleApptChange}>
                        <option value="OPD">Outpatient (OPD)</option>
                        <option value="Review">Review</option>
                        <option value="Consultation">Consultation</option>
                        <option value="Emergency">Emergency</option>
                      </select>
                    </Field>

                    <div className="da-col-3">
                      <Field label="Chief Complaint / Notes" icon={<FileText />}>
                        <textarea className="da-input" name="notes" rows={4}
                          placeholder="Enter symptoms, complaints, or notes…"
                          value={apptData.notes} onChange={handleApptChange} />
                      </Field>
                    </div>

                  </div>
                </div>
              )}

              {/* ── Navigation row ── */}
              <div className="da-btn-row">

                {/* left: back */}
                <div>
                  {step > 1 && (
                    <button type="button" className="da-btn-outline" onClick={handleBack}>
                      ← Back
                    </button>
                  )}
                </div>

                {/* right: actions */}
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>

                  {step === 1 && (
                    <button type="button" className="da-btn-primary" onClick={handleNext}>
                      Next →
                    </button>
                  )}

                  {step === 2 && (
                    <>
                      <button type="button" className="da-btn-outline" disabled={loading}
                        onClick={handleCompleteOnly}>
                        {loading ? "Saving…" : "Complete Without Appointment"}
                      </button>
                      <button type="button" className="da-btn-primary" onClick={() => setStep(3)}>
                        <CalendarPlus size={14} /> Take Appointment →
                      </button>
                    </>
                  )}

                  {step === 3 && (
                    <button type="button" className="da-btn-primary" disabled={loading}
                      onClick={handleSaveAppointment}>
                      {loading ? "Saving…" : <><CalendarCheck size={14} /> Save Appointment</>}
                    </button>
                  )}

                </div>
              </div>

              {/* message */}
              {message.text && (
                <div className={`da-message ${message.type}`}>
                  {message.text}
                </div>
              )}

            </form>
          </div>
        </main>

      </div>
    </>
  );
}

export default RegisterPatient;