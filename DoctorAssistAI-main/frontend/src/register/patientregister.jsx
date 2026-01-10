import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Phone, Mail, User, Lock, BriefcaseMedical, GraduationCap, FileText, MapPin, ChevronDown, Plus, UserCheck, Stethoscope, Hospital, DollarSign, Activity, Clock, HeartPulse, Briefcase, Calendar, Home, Settings, LogOut } from "lucide-react";

// --- BRAND COLORS AND CONFIG ---
const PRIMARY_BLUE = "#005a8b"; // Deep Navy/Indigo
const ACCENT_TEAL = "#00c2a7";  // Bright Teal/Cyan
const ACCENT_PURPLE = "#5856D6";
// -------------------------------

// Helper to convert hex to rgba
const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// Dummy data for dropdowns
const GENDERS = ["Male", "Female", "Other"];
const MARITAL_STATUS = ["Single", "Married", "Divorced", "Widowed"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const VISIT_TYPES = ["OPD", "Review", "Consultation", "Emergency"];


// ================= REUSABLE COMPONENTS =================
const FormGroup = ({ label, children, required, icon }) => ( 
    <div className="flex flex-col space-y-2">
        <label className="text-xs font-semibold uppercase text-gray-700 flex items-center">
            {icon || null}
            {label}
            {required && <span className="required-asterisk">*</span>}
        </label>
        {children}
    </div>
);

// ================= MAIN COMPONENT =================

function RegisterPatient() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  
  const doctorId = queryParams.get("doctor_id") ;
  const hospitalId = queryParams.get("hospital_id") ;
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);


  const [step, setStep] = useState(1); // State for multi-step form

  const [formData, setFormData] = useState({
    hms_id: "",
    name: "",
    email: "",
    phone_number: "",
    date_of_birth: "",
    gender: "",
    blood_group: "",
    marital_status: "",
    address: "",
    education: "",
    occupation: "",
    annual_income: "",
    family_history: "",
     created_at: new Date().toISOString(),
    doctor_id: doctorId, 
    hospital_id: hospitalId,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showAppointment, setShowAppointment] = useState(false);

  useEffect(() => {
    // Initial check or setup based on URL params
  }, [doctorId, navigate]);

  useEffect(() => {
  const verifyAuth = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/hms/users/doctors/verify`,
        { credentials: "include" }
      );

      if (!res.ok) throw new Error("Not authenticated");

      const data = await res.json();
      const verifiedDoctorId = data.doctor.sys_user_id;

      // 🔐 BLOCK doctor_id mismatch
      if (!doctorId || doctorId !== verifiedDoctorId) {
        console.warn("Doctor ID mismatch or missing");
        navigate("/login");
        return;
      }

      setAuthenticated(true);
    } catch (err) {
      console.error("Auth verification failed", err);
      navigate("/login");
    } finally {
      setAuthChecked(true);
    }
  };

  verifyAuth();
}, [doctorId, navigate]);


  const handleChange = (e) => {
    const { name, value } = e.target;
    
    if (name === "phone_number") {
      const digitsOnly = value.replace(/\D/g, '');
      setFormData({ ...formData, [name]: digitsOnly.slice(0, 15) });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleLogout = () => {
    alert("Logging out...");
    // Clear tokens and redirect to login
  };

 const handleNext = (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (
    step === 1 &&
    (!formData.hms_id ||
      !formData.phone_number ||
      !formData.name ||
      !formData.date_of_birth ||
      !formData.gender)
  ) {
    setMessage("❌ Please fill all required fields in this section.");
    return;
  }

  setMessage("");
  setStep((prev) => prev + 1);
};


  const handleBack = () => {
    setMessage("");
    setStep(step - 1);
  };


  const handleSubmit = async (e) => {
    e.preventDefault();
      if (step !== 3) {
    return; // 🚫 Prevent early submit
  }
    setLoading(true);
    setMessage("Registering patient and creating user...");

    // Final validation before API call
    if (!formData.hms_id || !formData.phone_number || !formData.name || !formData.date_of_birth || !formData.gender) {
        setLoading(false);
        return setMessage("❌ Error: Essential demographic details are missing.");
    }
    console.log("Submitting form data:", formData);
    try {
      
      
      const res = await fetch(
        `${API_BASE_URL}/hms/users/patients/patientadd`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
         
          },
          body: JSON.stringify(formData),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.message );

      setMessage(`✅ Patient registered successfully! ID: ${data.patient_id}`);
      
      setTimeout(() => {
        navigate(`/doctor-dashboard?doctor_id=${doctorId}`); 
      }, 1500);

    } catch (err) {
      console.error("Registration error:", err);
      setMessage(`❌ Registration failed: ${err.message }`);
    } finally {
      setLoading(false);
    }
  };

  // --- JSX FOR EACH STEP ---
  const stepContent = {
    1: (
        // Identity & Required Demographics
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <h2 className="text-xl font-bold mb-6 col-span-3 flex items-center" style={{ color: PRIMARY_BLUE }}>
                <UserCheck className="w-6 h-6 mr-3" /> 1. Identity & Required Details
            </h2>
            
            {/* Row 1 */}
            <FormGroup label="HMS ID (Username)" icon={<User className="w-4 h-4 mr-2" />} required={true}>
                <input name="hms_id" placeholder="Unique patient identifier" onChange={handleChange} value={formData.hms_id} className="glass-input" required />
            </FormGroup>
            <FormGroup label="Phone Number" icon={<Phone className="w-4 h-4 mr-2" />} required={true}>
                <input name="phone_number" type="tel" placeholder="Enter 10-15 digits" onChange={handleChange} value={formData.phone_number} className="glass-input" required maxLength={15} />
                <p className="text-xs text-gray-500 mt-1">Used as default password.</p>
            </FormGroup>
            <FormGroup label="Email" icon={<Mail className="w-4 h-4 mr-2" />}>
                <input name="email" type="email" placeholder="patient@example.com" onChange={handleChange} value={formData.email} className="glass-input" />
            </FormGroup>

            {/* Row 2 */}
            <FormGroup label="Full Name" icon={<User className="w-4 h-4 mr-2" />} required={true}>
                <input name="name" placeholder="Patient's legal name" onChange={handleChange} value={formData.name} className="glass-input" required />
            </FormGroup>
            <FormGroup label="Date of Birth" icon={<Calendar className="w-4 h-4 mr-2" />} required={true}>
                <input name="date_of_birth" type="date" onChange={handleChange} value={formData.date_of_birth} className="glass-input" required />
            </FormGroup>
            <FormGroup label="Gender" icon={<User className="w-4 h-4 mr-2" />} required={true}>
                <div className="select-wrapper">
                    <select name="gender" onChange={handleChange} value={formData.gender} className="glass-input" required>
                        <option value="" disabled>Select Gender</option>
                        {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                </div>
            </FormGroup>
        </div>
    ),
    2: (
        // Optional Demographics and Socio-economic
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <h2 className="text-xl font-bold mb-6 col-span-3 flex items-center" style={{ color: PRIMARY_BLUE }}>
                <HeartPulse className="w-6 h-6 mr-3" /> 2. Medical & Socio-economic Details (Optional)
            </h2>

            <FormGroup label="Blood Group" icon={<HeartPulse className="w-4 h-4 mr-2" />}>
                <div className="select-wrapper">
                    <select name="blood_group" onChange={handleChange} value={formData.blood_group} className="glass-input">
                        <option value="">Select Group</option>
                        {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                </div>
            </FormGroup>
            <FormGroup label="Marital Status" icon={<UserCheck className="w-4 h-4 mr-2" />}>
                <div className="select-wrapper">
                    <select name="marital_status" onChange={handleChange} value={formData.marital_status} className="glass-input">
                        <option value="">Select Status</option>
                        {MARITAL_STATUS.map(ms => <option key={ms} value={ms}>{ms}</option>)}
                    </select>
                </div>
            </FormGroup>
            <FormGroup label="Education" icon={<GraduationCap className="w-4 h-4 mr-2" />}>
                <input name="education" placeholder="Highest level of education" onChange={handleChange} value={formData.education} className="glass-input" />
            </FormGroup>

            <FormGroup label="Occupation" icon={<Briefcase className="w-4 h-4 mr-2" />}>
                <input name="occupation" placeholder="Current job/profession" onChange={handleChange} value={formData.occupation} className="glass-input" />
            </FormGroup>
            <FormGroup label="Annual Income" icon={<DollarSign className="w-4 h-4 mr-2" />}>
                <input name="annual_income" type="number" placeholder="Income (optional)" onChange={handleChange} value={formData.annual_income} className="glass-input" />
            </FormGroup>
            
            {/* Empty space filler for cleaner grid layout */}
            <div className="hidden md:block"></div> 

            {/* Address */}
            <div className="col-span-1 md:col-span-3">
                <FormGroup label="Address" icon={<MapPin className="w-4 h-4 mr-2" />}>
                    <textarea name="address" placeholder="Permanent Address" onChange={handleChange} value={formData.address} rows={3} className="glass-input resize-none min-h-[100px]" />
                </FormGroup>
            </div>
            
            {/* Family History */}
            <div className="col-span-1 md:col-span-3">
                <FormGroup label="Family History" icon={<HeartPulse className="w-4 h-4 mr-2" />}>
                    <textarea name="family_history" placeholder="Relevant family medical history (e.g., diabetes, hypertension)" onChange={handleChange} value={formData.family_history} rows={3} className="glass-input resize-none min-h-[100px]" />
                </FormGroup>
            </div>
        </div>
    ),
    3: (
        // Initial Appointment
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <h2 className="text-xl font-bold mb-6 col-span-3 flex items-center" style={{ color: PRIMARY_BLUE }}>
                <Activity className="w-6 h-6 mr-3" /> 3. Initial Appointment (Optional)
            </h2>
            
           

            {/* Doctor ID (Display Only - Pre-filled) */}
            <div className="col-span-1 md:col-span-2">
                <FormGroup label="Assigned Doctor ID" icon={<Hospital className="w-4 h-4 mr-2" />}>
                    <input value={doctorId} readOnly className="glass-input bg-gray-100 cursor-not-allowed" />
                </FormGroup>
            </div>
        </div>
    )
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



  return (
    <div className="min-h-screen font-modern flex" 
      style={{
        background: `linear-gradient(135deg, ${hexToRgba(PRIMARY_BLUE, 0.08)}, ${hexToRgba(ACCENT_TEAL, 0.05)}, ${hexToRgba(ACCENT_PURPLE, 0.03)}, #f8f8fa)`,
        backgroundAttachment: 'fixed'
      }}>
      <style>{`
        /* Import Inter Font */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        .font-modern { 
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* Enhanced Glass Effect */
        .glass-effect {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.85) 0%,
            rgba(255, 255, 255, 0.75) 100%
          );
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 
            0 20px 60px rgba(0, 0, 0, 0.1),
            inset 0 1px 1px rgba(255, 255, 255, 0.8);
          border-radius: 24px;
          position: relative;
          overflow: hidden;
        }

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
            rgba(255, 255, 255, 0.2) 50%,
            transparent 70%
          );
          animation: liquidFlow 8s ease-in-out infinite;
          pointer-events: none;
        }

        @keyframes liquidFlow {
          0%, 100% { transform: translate(-30%, -30%) rotate(0deg); opacity: 0.3; }
          50% { transform: translate(-20%, -30%) rotate(180deg); opacity: 0.2; }
        }

        /* Enhanced Form Input Styles */
        .glass-input {
          background: rgba(255, 255, 255, 0.95);
          border: 1.5px solid rgba(0, 0, 0, 0.08);
          border-radius: 12px;
          padding: 14px 16px;
          font-size: 15px;
          width: 100%;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          color: #1f2937;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        }

        .glass-input:focus {
          outline: none;
          border-color: ${PRIMARY_BLUE};
          background: rgba(255, 255, 255, 1);
          box-shadow: 
            0 0 0 4px ${hexToRgba(PRIMARY_BLUE, 0.1)},
            0 4px 20px rgba(0, 0, 0, 0.08);
          transform: translateY(-1px);
        }
        
        .glass-input::placeholder {
            color: #9ca3af;
            font-weight: 400;
        }

        .glass-input:hover {
          border-color: rgba(0, 0, 0, 0.15);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
        }

        /* Dropdown Styling */
        .select-wrapper {
            position: relative;
        }
        .select-wrapper::after {
            content: "▼";
            position: absolute;
            top: 50%;
            right: 18px;
            transform: translateY(-50%) scale(0.8);
            pointer-events: none;
            color: ${PRIMARY_BLUE};
            font-weight: 700;
            opacity: 0.7;
        }

        /* Enhanced Submit Button */
        .liquid-submit-btn {
            padding: 16px 32px;
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 0.02em;
            border-radius: 14px;
            box-shadow: 
              0 10px 30px ${hexToRgba(PRIMARY_BLUE, 0.3)},
              0 2px 4px rgba(0, 0, 0, 0.1);
            background: linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL});
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            color: white;
            border: none;
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }

        .liquid-submit-btn::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
          transition: left 0.6s;
        }

        .liquid-submit-btn:hover {
            transform: translateY(-3px) scale(1.02);
            box-shadow: 
              0 15px 40px ${hexToRgba(PRIMARY_BLUE, 0.4)},
              0 4px 8px rgba(0, 0, 0, 0.15);
            background: linear-gradient(135deg, #004d7c, #00b29a);
        }

        .liquid-submit-btn:hover::before {
          left: 100%;
        }

        .liquid-submit-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
            box-shadow: 0 5px 15px ${hexToRgba(PRIMARY_BLUE, 0.2)};
        }

        .required-asterisk {
            color: #FF3B30;
            font-weight: 700;
            margin-left: 4px;
        }

        /* Enhanced Step Indicator */
        .step-indicator {
            display: flex;
            align-items: center;
            margin-bottom: 24px;
        }
        .step-circle {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 16px;
            margin-right: 8px;
            transition: all 0.4s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .step-line {
            height: 3px;
            flex-grow: 1;
            margin: 0 12px;
            transition: all 0.4s ease;
            border-radius: 2px;
        }
        .step-active .step-circle {
            background: ${PRIMARY_BLUE};
            color: white;
            box-shadow: 0 6px 16px ${hexToRgba(PRIMARY_BLUE, 0.3)};
            transform: scale(1.1);
        }
        .step-completed .step-circle {
            background: ${ACCENT_TEAL};
            color: white;
            box-shadow: 0 6px 16px ${hexToRgba(ACCENT_TEAL, 0.3)};
        }
        .step-inactive .step-circle {
            background: rgba(255, 255, 255, 0.8);
            color: ${PRIMARY_BLUE};
            border: 2px solid ${hexToRgba(PRIMARY_BLUE, 0.2)};
        }
        .step-line-active {
            background: linear-gradient(90deg, ${hexToRgba(ACCENT_TEAL, 0.8)}, ${PRIMARY_BLUE});
        }
        .step-line-inactive {
            background: ${hexToRgba(PRIMARY_BLUE, 0.15)};
        }
        .step-line-completed {
            background: ${ACCENT_TEAL};
        }

        /* Left Menu Styles - FIXED */
        .left-menu {
            width: 280px;
            height: 100vh;
            position: fixed;
            top: 0;
            left: 0;
            padding: 28px 20px;
            border-right: 1px solid rgba(255, 255, 255, 0.3);
            background: linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.9) 0%,
              rgba(255, 255, 255, 0.8) 100%
            );
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            z-index: 10;
            box-shadow: 10px 0 30px rgba(0, 0, 0, 0.05);
        }

        .menu-item {
            padding: 14px 18px;
            border-radius: 14px;
            font-size: 15px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 14px;
            color: ${PRIMARY_BLUE};
            cursor: pointer;
            transition: all 0.3s ease;
            background: transparent;
            border: none;
            text-align: left;
            width: 100%;
            margin-bottom: 8px;
        }

        .menu-item:hover {
            background: linear-gradient(135deg, ${hexToRgba(PRIMARY_BLUE, 0.1)}, ${hexToRgba(ACCENT_TEAL, 0.05)});
            transform: translateX(5px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .menu-item.active {
            background: linear-gradient(135deg, ${hexToRgba(ACCENT_TEAL, 0.15)}, ${hexToRgba(PRIMARY_BLUE, 0.1)});
            color: ${PRIMARY_BLUE};
            box-shadow: 0 4px 12px ${hexToRgba(ACCENT_TEAL, 0.2)};
            transform: translateX(5px);
        }

        /* Main content area - FULL WIDTH outside left nav */
        .main-content-area {
            flex: 1;
            margin-left: 280px; /* Same as left menu width */
            padding: 40px;
            display: flex;
            max-width: calc(100vw - 280px);
            width: 100%;
        }

        /* Full width form container */
        .form-container {
            width: 100%;
            max-width: none;
            display: flex;
            flex-direction: column;
        }

        .glass-effect {
            flex: 1;
            padding: 40px;
            display: flex;
            flex-direction: column;
            min-height: calc(100vh - 80px);
        }

        /* Form content container */
        .form-content-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: visible;
        }

        /* Step content area */
        .step-content {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 24px;
            padding-right: 10px;
        }

        /* Custom scrollbar */
        .step-content::-webkit-scrollbar {
            width: 8px;
        }
        .step-content::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
        }
        .step-content::-webkit-scrollbar-thumb {
            background: linear-gradient(to bottom, ${hexToRgba(PRIMARY_BLUE, 0.4)}, ${hexToRgba(ACCENT_TEAL, 0.4)});
            border-radius: 4px;
        }
        .step-content::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(to bottom, ${hexToRgba(PRIMARY_BLUE, 0.6)}, ${hexToRgba(ACCENT_TEAL, 0.6)});
        }

        /* Responsive adjustments */
        @media (max-width: 1024px) {
            .left-menu {
                width: 240px;
            }
            .main-content-area {
                margin-left: 240px;
                max-width: calc(100vw - 240px);
            }
        }

        @media (max-width: 768px) {
            .left-menu {
                display: none;
            }
            .main-content-area {
                margin-left: 0;
                padding: 20px;
                max-width: 100vw;
            }
            .glass-effect {
                padding: 24px;
                min-height: calc(100vh - 40px);
            }
        }

        /* Background elements */
        .bg-sphere {
            position: fixed;
            border-radius: 50%;
            filter: blur(60px);
            opacity: 0.15;
            pointer-events: none;
            z-index: 0;
        }
      `}</style>
      
      {/* Background Elements */}
      <div className="fixed top-0 left-0 bottom-0 right-0 z-0 pointer-events-none">
          <div className="bg-sphere -top-40 -left-40 w-96 h-96" style={{ background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_PURPLE})` }} />
          <div className="bg-sphere -bottom-40 -right-40 w-96 h-96" style={{ background: `linear-gradient(135deg, ${ACCENT_TEAL}, ${PRIMARY_BLUE})` }} />
          <div className="bg-sphere top-1/2 left-1/4 w-80 h-80" style={{ background: `linear-gradient(135deg, ${ACCENT_PURPLE}, ${ACCENT_TEAL})` }} />
      </div>

      {/* LEFT FIXED MENU */}
      <div className="left-menu glass-effect">
          <div className="flex-1">
              <div className="flex items-center gap-4 mb-10 pb-6 border-b border-gray-100">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL})` }}>
                      <Stethoscope size={24} color="white" />
                  </div>
                  <div>
                      <span className="text-2xl font-bold block" style={{ color: PRIMARY_BLUE }}>Dr. Assist</span>
                      <span className="text-sm text-gray-600 font-medium">Patient Registration</span>
                  </div>
              </div>
              
              <button className="menu-item" onClick={() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`)}>
                  <Home size={20} /> Doctor Dashboard
              </button>
              <button className="menu-item active">
                  <Plus size={20} /> New Patient
              </button>
              
              <div className="mt-12">
                  <h3 className="text-xs uppercase font-bold mb-6 tracking-wider" style={{ color: hexToRgba(PRIMARY_BLUE, 0.7) }}>Registration Steps</h3>
                  
                  <div className="step-indicator">
                      <div className={`step-circle ${step === 1 ? 'step-active' : step > 1 ? 'step-completed' : 'step-inactive'}`}>1</div>
                      <div className={`step-line ${step === 2 ? 'step-line-active' : step > 1 ? 'step-line-completed' : 'step-line-inactive'}`}></div>
                      <div className={`step-circle ${step === 2 ? 'step-active' : step > 2 ? 'step-completed' : 'step-inactive'}`}>2</div>
                      <div className={`step-line ${step === 3 ? 'step-line-active' : step > 2 ? 'step-line-completed' : 'step-line-inactive'}`}></div>
                      <div className={`step-circle ${step === 3 ? 'step-active' : step > 3 ? 'step-completed' : 'step-inactive'}`}>3</div>
                  </div>
                  <p className="text-base font-semibold mt-4" style={{ color: PRIMARY_BLUE }}>
                    Step {step}: {step === 1 ? 'Identity' : step === 2 ? 'Demographics' : 'Appointment'}
                  </p>
              </div>
          </div>
          
          <div className="mt-auto pt-8 border-t border-gray-100">
              <button className="menu-item" onClick={handleLogout} style={{ color: '#FF3B30' }}>
                  <LogOut size={20} /> Logout
              </button>
          </div>
      </div>


      {/* MAIN CONTENT AREA - Takes full remaining space */}
      <div className="main-content-area">
          <div className="form-container">
            <div className="glass-effect">
              
              <div className="form-content-container">
                  <div className="mb-8 border-b pb-6 border-gray-100">
                    <h1 className="text-3xl font-extrabold mb-3 bg-gradient-to-r from-blue-900 to-teal-600 bg-clip-text text-transparent">
                      Patient Registration - Multi-Step
                    </h1>
                    <p className="text-gray-600 text-lg font-medium">
                      Complete all steps to finalize patient record creation.
                    </p>
                  </div>

                  <form
  onSubmit={handleSubmit}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  }}
  className="flex flex-col h-full"
>
                    
                    {/* DYNAMIC STEP CONTENT */}
                    <div className="step-content">
                        {stepContent[step]}
                    </div>
                    
                    {/* NAVIGATION BUTTONS */}
                    <div className="flex justify-between items-center pt-8 border-t border-gray-100 mt-auto">
                        {step > 1 && (
                            <button type="button" onClick={handleBack} className="px-6 py-3 rounded-xl font-semibold text-gray-700 hover:bg-gray-100 transition-all duration-300 border border-gray-200 hover:border-gray-300 hover:shadow-md">
                                &larr; Back
                            </button>
                        )}

                        {step < 3 ? (
                          <button
  type="button"
  onClick={(e) => handleNext(e)}
  className="liquid-submit-btn ml-auto px-10"
>
  Next →
</button>

                        ) : (
                            <button type="submit" disabled={loading} className="liquid-submit-btn ml-auto px-12">
                                {loading ? (
                                    <span className="flex items-center justify-center">
                                        <svg className="animate-spin h-6 w-6 mr-3 text-white" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        Registering...
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center">
                                        <Plus className="w-6 h-6 mr-3" /> Complete Registration
                                    </span>
                                )}
                            </button>
                        )}
                    </div>

                    {/* Message Display */}
                    {message && (
                        <div className={`mt-6 p-4 rounded-xl text-center font-medium text-base ${message.includes('✅') ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 border border-green-200' : 'bg-gradient-to-r from-red-50 to-rose-50 text-red-800 border border-red-200'}`}>
                            {message}
                        </div>
                    )}

                  </form>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

export default RegisterPatient;