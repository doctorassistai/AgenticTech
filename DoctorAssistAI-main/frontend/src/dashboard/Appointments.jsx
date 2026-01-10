import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { 
  Search, User, Calendar, Clock, FileText, Save, 
  ChevronLeft, UserPlus, Bell, Stethoscope,
  Home, Users, Bed, Activity, Settings, LogOut
} from "lucide-react";

/* ======= BRAND CONFIG (MATCH DASHBOARD) ======= */
const PRIMARY_BLUE = "#005a8b";
const ACCENT_TEAL = "#00c2a7";
const ACCENT_PURPLE = "#5856D6";
const LIGHT_BG = "#f5f7fa";
const MAX_WIDTH = "1700px";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
function to12HourFormat(time24) {
  if (!time24) return "";

  let [hours, minutes] = time24.split(":").map(Number);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

// Define liquidGlassBase as a constant that can be used anywhere
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

const getStyles = () => {
  return {
    // Global Layout
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

    // Background Shapes
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

    // Sidebar (Fixed)
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
    },
    
    brandContainer: {
      display: "flex", alignItems: "center", gap: "10px", marginBottom: "2rem", paddingBottom: "1rem",
      borderBottom: "1px solid rgba(0, 0, 0, 0.08)"
    },
    logoIcon: { width: "40px", height: "40px", borderRadius: "10px", overflow: "hidden" },
    logoGradient: {
      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "10px",
      background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL})`,
      boxShadow: "0 6px 15px rgba(0, 90, 139, 0.3)"
    },
    brand: { fontWeight: "700", fontSize: "18px", margin: 0, color: PRIMARY_BLUE, letterSpacing: "-0.03em" },
    
    menu: { display: "flex", flexDirection: "column", gap: "6px" },
    menuItem: {
      background: "transparent", border: "none", textAlign: "left", fontSize: "14px", color: hexToRgba(PRIMARY_BLUE, 0.8), cursor: "pointer",
      padding: "12px", borderRadius: "12px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", alignItems: "center", gap: "10px",
      fontWeight: "600",
      '&:hover': { background: hexToRgba(PRIMARY_BLUE, 0.08), color: PRIMARY_BLUE, transform: "translateX(4px)" }
    },
    menuItemActive: {
      background: `linear-gradient(135deg, ${hexToRgba(PRIMARY_BLUE, 0.15)}, ${hexToRgba(ACCENT_TEAL, 0.1)})`,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.25)}`, color: PRIMARY_BLUE, padding: "12px", borderRadius: "12px",
      display: "flex", alignItems: "center", gap: "10px", fontWeight: "700",
      boxShadow: "0 4px 12px rgba(0, 90, 139, 0.15)"
    },

    profileSection: {
      display: "flex", flexDirection: 'column', gap: "8px", marginBottom: "1rem", paddingTop: '1rem',
      borderTop: "1px solid rgba(0, 0, 0, 0.08)"
    },
    profileInfo: { fontSize: '15px', fontWeight: '600', color: PRIMARY_BLUE },
    profileSubtext: { fontSize: '13px', color: hexToRgba(PRIMARY_BLUE, 0.7) },

    logoutBtn: {
      padding: "12px", borderRadius: "12px", border: "1px solid rgba(255, 59, 48, 0.25)",
      background: "linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 149, 0, 0.08))", color: "#FF3B30", cursor: "pointer",
      fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", width: "100%",
      '&:hover': { background: "rgba(255, 59, 48, 0.15)", transform: "translateY(-1px)" }
    },

    // Header
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
    backButton: {
      background: PRIMARY_BLUE, color: 'white', border: 'none', padding: '10px 20px', borderRadius: '12px', 
      cursor: 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px',
      transition: 'all 0.3s ease',
      '&:hover': { background: ACCENT_TEAL, transform: 'translateY(-2px)' }
    },

    // Search Container
    searchContainer: {
      ...liquidGlassBase,
      padding: '12px 16px',
      marginBottom: '1.5rem',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    searchInput: {
      border: 'none',
      background: 'transparent',
      outline: 'none',
      flex: 1,
      fontSize: '14px',
      color: PRIMARY_BLUE,
      fontWeight: '500',
      '&::placeholder': {
        color: hexToRgba(PRIMARY_BLUE, 0.5)
      }
    },

    // Patient Card
    patientCard: {
      ...liquidGlassBase,
      padding: '16px',
      marginBottom: '12px',
      cursor: 'pointer',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      border: '1px solid rgba(0, 0, 0, 0.05)',
      '&:hover': {
        transform: 'translateY(-4px)',
        boxShadow: '0 15px 35px rgba(0, 0, 0, 0.1)',
        borderColor: hexToRgba(ACCENT_TEAL, 0.3)
      }
    },
    patientCardSelected: {
      border: `2px solid ${ACCENT_TEAL}`,
      background: `linear-gradient(135deg, ${hexToRgba(ACCENT_TEAL, 0.05)}, ${hexToRgba(PRIMARY_BLUE, 0.02)})`
    },

    // Appointment Form Card
    appointmentCard: {
      ...liquidGlassBase,
      padding: '1.5rem',
      marginTop: '1.5rem',
      background: `linear-gradient(135deg, ${hexToRgba(PRIMARY_BLUE, 0.03)}, ${hexToRgba(ACCENT_TEAL, 0.02)})`
    },
    sectionTitle: {
      fontWeight: '700',
      fontSize: '18px',
      color: PRIMARY_BLUE,
      margin: '0 0 16px 0',
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px',
      marginBottom: '20px'
    },
    formInput: {
      ...liquidGlassBase,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.15)}`,
      padding: '12px 16px',
      fontSize: '14px',
      color: PRIMARY_BLUE,
      background: 'rgba(255, 255, 255, 0.9)',
      borderRadius: '12px',
      outline: 'none',
      transition: 'all 0.3s ease',
      '&:focus': {
        borderColor: ACCENT_TEAL,
        boxShadow: `0 0 0 3px ${hexToRgba(ACCENT_TEAL, 0.2)}`
      }
    },
    selectInput: {
      ...liquidGlassBase,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.15)}`,
      padding: '12px 16px',
      fontSize: '14px',
      color: PRIMARY_BLUE,
      background: 'rgba(255, 255, 255, 0.9)',
      borderRadius: '12px',
      outline: 'none',
      cursor: 'pointer',
      appearance: 'none',
      '&:focus': {
        borderColor: ACCENT_TEAL
      }
    },
    textarea: {
      ...liquidGlassBase,
      width: '100%',
      minHeight: '100px',
      padding: '16px',
      fontSize: '14px',
      color: PRIMARY_BLUE,
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.15)}`,
      borderRadius: '12px',
      outline: 'none',
      resize: 'vertical',
      background: 'rgba(255, 255, 255, 0.9)',
      transition: 'all 0.3s ease',
      '&:focus': {
        borderColor: ACCENT_TEAL,
        boxShadow: `0 0 0 3px ${hexToRgba(ACCENT_TEAL, 0.2)}`
      }
    },
    submitButton: {
      background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL})`,
      color: 'white',
      border: 'none',
      padding: '14px 28px',
      borderRadius: '12px',
      fontSize: '15px',
      fontWeight: '700',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      marginTop: '20px',
      width: '100%',
      '&:hover': {
        transform: 'translateY(-3px)',
        boxShadow: `0 10px 25px ${hexToRgba(ACCENT_TEAL, 0.4)}`
      },
      '&:active': {
        transform: 'translateY(-1px)'
      }
    },
    messageBox: {
      marginTop: '16px',
      padding: '12px 16px',
      borderRadius: '10px',
      fontSize: '14px',
      fontWeight: '600',
      textAlign: 'center'
    },
    successMessage: {
      background: hexToRgba('#34C759', 0.1),
      color: '#34C759',
      border: `1px solid ${hexToRgba('#34C759', 0.2)}`
    },
    errorMessage: {
      background: hexToRgba('#FF3B30', 0.1),
      color: '#FF3B30',
      border: `1px solid ${hexToRgba('#FF3B30', 0.2)}`
    },

    // Patient Info
    patientInfoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px',
      marginBottom: '20px'
    },
    infoItem: {
      padding: '12px',
      background: 'rgba(255, 255, 255, 0.7)',
      borderRadius: '10px',
      border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.1)}`
    },
    infoLabel: {
      fontSize: '12px',
      color: hexToRgba(PRIMARY_BLUE, 0.6),
      fontWeight: '600',
      marginBottom: '4px'
    },
    infoValue: {
      fontSize: '14px',
      color: PRIMARY_BLUE,
      fontWeight: '600'
    },

    // Empty State Card
    emptyStateCard: {
      ...liquidGlassBase,
      padding: '40px',
      textAlign: 'center',
      marginTop: '20px'
    },
    searchEmptyStateCard: {
      ...liquidGlassBase,
      padding: '40px',
      textAlign: 'center',
      marginTop: '20px',
      background: `linear-gradient(135deg, ${hexToRgba(ACCENT_TEAL, 0.05)}, ${hexToRgba(PRIMARY_BLUE, 0.02)})`,
      border: `1px dashed ${hexToRgba(ACCENT_TEAL, 0.3)}`
    }
  };
};

const API = `${API_BASE_URL}/hms/users/doctors`;

export default function Appointments() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");
  
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [term, setTerm] = useState("");
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [visitType, setVisitType] = useState("OP");
  const [complaint, setComplaint] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success" or "error"
  const [loading, setLoading] = useState(false);

  const styles = getStyles();

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

        // 🔒 Doctor ID mismatch protection
        if (!doctorId || doctorId !== verifiedDoctorId) {
          console.warn("Doctor ID mismatch — blocking access");
          navigate("/login");
          return;
        }
      } catch (err) {
        console.error("Auth failed", err);
        navigate("/login");
      }
    };

    verifyAuth();
  }, [doctorId, navigate]);


  useEffect(() => {
    if (!doctorId) return;

    const fetchDoctorDetails = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/hms/users/speciality/users/patient/get_doctor_details`,
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

  const handleLogout = () => {
    alert("Logging out...");
    navigate("/login");
  };

  async function searchPatients(value) {
    setTerm(value);
    if (value.length < 2) {
      setPatients([]);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${API}/search?term=${value}&doctor_id=${doctorId}`);
      const data = await res.json();
      if (data.status === "success") setPatients(data.patients);
    } catch (error) {
      console.error("Search error:", error);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }

  async function submitAppointment() {
    if (!selectedPatient) {
      setMessage("Please select a patient");
      setMessageType("error");
      return;
    }
    
    if (!date) {
      setMessage("Please select a date");
      setMessageType("error");
      return;
    }

    const payload = {
      doctor_id: doctorId,
      sys_user_id: selectedPatient.sys_user_id,
      date,
      scheduled_time: to12HourFormat(time),
      visit_type: visitType,
      chief_complaint: complaint
    };

    try {
      const res = await fetch(`${API}/take_appointment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.status === "success") {
        setMessage("Appointment saved successfully!");
        setMessageType("success");
        // Reset form
        setSelectedPatient(null);
        setDate("");
        setTime("");
        setVisitType("OP");
        setComplaint("");
        setPatients([]);
        setTerm("");
      } else {
        setMessage("Failed to save appointment. Please try again.");
        setMessageType("error");
      }
    } catch (error) {
      console.error("Appointment error:", error);
      setMessage("Network error. Please try again.");
      setMessageType("error");
    }
  }

  return (
    <div style={styles.layout}>
      <style>{`
        @keyframes subtleMove {
          0% { transform: translate(0, 0); }
          100% { transform: translate(40px, -40px); }
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
              <div style={styles.logoGradient}>
                <Stethoscope size={20} color="white" />
              </div>
            </div>
            <span style={styles.brand}>DoctorAssist.AI</span>
          </div>

          {/* Profile Info */}
          <div style={styles.profileSection}>
            <div style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <p style={styles.profileInfo}>
                {doctorName || "Loading..."}
              </p>
              <p style={styles.profileSubtext}>
                {doctorSpeciality || "Loading speciality..."}
              </p>
            </div>
          </div>

          {/* Menu */}
          <div style={styles.menu}>
            <button 
              style={styles.menuItem}
              onClick={() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`)}
            >
              <Home size={18} />
              <span>Dashboard</span>
            </button>
            <button style={styles.menuItemActive}>
              <Calendar size={18} />
              <span>Appointments</span>
            </button>
            <button style={styles.menuItem}>
              <Bed size={18} />
              <span>IPD/Ward Patients</span>
            </button>
            
            <button style={styles.menuItem}>
              <Activity size={18} />
              <span>Referrals</span>
            </button>
           
          </div>
        </div>

        <button style={styles.logoutBtn} onClick={handleLogout}>
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </aside>

      {/* ================= MAIN CONTENT AREA ================= */}
      <div style={styles.pageContent}>
        {/* Header */}
        <div style={styles.headerContainer}>
          <h1 style={styles.headerTitle}>Schedule Appointment</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Bell size={20} color={PRIMARY_BLUE} style={{ cursor: 'pointer' }} />
            
          </div>
        </div>

        {/* Search Section */}
        <div style={styles.searchContainer}>
          <Search size={18} color={PRIMARY_BLUE} />
          <input
            type="text"
            value={term}
            onChange={e => searchPatients(e.target.value)}
            placeholder="Search patient by HMS ID / Name / Phone"
            style={styles.searchInput}
          />
          {loading && (
            <div style={{ fontSize: '12px', color: hexToRgba(PRIMARY_BLUE, 0.7) }}>
              Searching...
            </div>
          )}
        </div>

        {/* Search Results */}
        {patients.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ color: PRIMARY_BLUE, fontSize: '16px', marginBottom: '12px' }}>
              Select Patient ({patients.length} found)
            </h3>
            {patients.map(patient => (
              <div
                key={patient.sys_user_id}
                onClick={() => setSelectedPatient(patient)}
                style={{
                  ...styles.patientCard,
                  ...(selectedPatient?.sys_user_id === patient.sys_user_id ? styles.patientCardSelected : {})
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: PRIMARY_BLUE, fontSize: '15px' }}>{patient.name}</strong>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                      <span style={{ fontSize: '13px', color: hexToRgba(PRIMARY_BLUE, 0.7) }}>
                        📞 {patient.phone_number}
                      </span>
                      <span style={{ fontSize: '13px', color: hexToRgba(PRIMARY_BLUE, 0.7) }}>
                        🆔 {patient.hms_id}
                      </span>
                      {patient.email && (
                        <span style={{ fontSize: '13px', color: hexToRgba(PRIMARY_BLUE, 0.7) }}>
                          ✉️ {patient.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    background: hexToRgba(ACCENT_TEAL, 0.1),
                    color: ACCENT_TEAL,
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    Select
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Appointment Form */}
        {selectedPatient && (
          <div style={styles.appointmentCard}>
            {/* Patient Details */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={styles.sectionTitle}>
                <User size={18} />
                Patient Details
              </h3>
              <div style={styles.patientInfoGrid}>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Full Name</div>
                  <div style={styles.infoValue}>{selectedPatient.name}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>Phone Number</div>
                  <div style={styles.infoValue}>{selectedPatient.phone_number}</div>
                </div>
                <div style={styles.infoItem}>
                  <div style={styles.infoLabel}>HMS ID</div>
                  <div style={styles.infoValue}>{selectedPatient.hms_id}</div>
                </div>
                {selectedPatient.email && (
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>Email</div>
                    <div style={styles.infoValue}>{selectedPatient.email}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Appointment Form */}
            <div>
              <h3 style={styles.sectionTitle}>
                <Calendar size={18} />
                Schedule Appointment
              </h3>
              
              <div style={styles.formGrid}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: PRIMARY_BLUE, fontWeight: '600', fontSize: '13px' }}>
                    Appointment Date *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    style={styles.formInput}
                    required
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: PRIMARY_BLUE, fontWeight: '600', fontSize: '13px' }}>
                    Time (Optional)
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    style={styles.formInput}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: PRIMARY_BLUE, fontWeight: '600', fontSize: '13px' }}>
                    Visit Type
                  </label>
                  <select
                    value={visitType}
                    onChange={e => setVisitType(e.target.value)}
                    style={styles.selectInput}
                  >
                    <option value="OP">Outpatient (OP)</option>
                    <option value="IP">Inpatient (IP)</option>
                    <option value="Emergency">Emergency</option>
                    <option value="Follow-up">Follow-up</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: PRIMARY_BLUE, fontWeight: '600', fontSize: '13px' }}>
                  Chief Complaint / Notes
                </label>
                <textarea
                  placeholder="Enter chief complaint, symptoms, or any additional notes..."
                  value={complaint}
                  onChange={e => setComplaint(e.target.value)}
                  style={styles.textarea}
                  rows={4}
                />
              </div>

              <button
                onClick={submitAppointment}
                style={styles.submitButton}
              >
                <Save size={18} />
                Save Appointment
              </button>

              {message && (
                <div style={{
                  ...styles.messageBox,
                  ...(messageType === 'success' ? styles.successMessage : styles.errorMessage)
                }}>
                  {message}
                </div>
              )}
            </div>
          </div>
        )}

        {/* No Patient Selected State */}
        {!selectedPatient && patients.length === 0 && term.length >= 2 && !loading && (
          <div style={styles.emptyStateCard}>
            <User size={48} color={hexToRgba(PRIMARY_BLUE, 0.3)} style={{ marginBottom: '16px' }} />
            <h3 style={{ color: PRIMARY_BLUE, marginBottom: '8px' }}>No Patients Found</h3>
            <p style={{ color: hexToRgba(PRIMARY_BLUE, 0.7) }}>
              Try searching with different terms or register a new patient
            </p>
          </div>
        )}

        {/* Initial State */}
        {!selectedPatient && patients.length === 0 && term.length < 2 && (
          <div style={styles.searchEmptyStateCard}>
            <Search size={48} color={hexToRgba(PRIMARY_BLUE, 0.3)} style={{ marginBottom: '16px' }} />
            <h3 style={{ color: PRIMARY_BLUE, marginBottom: '8px' }}>Search for Patients</h3>
            <p style={{ color: hexToRgba(PRIMARY_BLUE, 0.7), maxWidth: '600px', margin: '0 auto' }}>
              Enter at least 2 characters to search for existing patients by name, phone number, or HMS ID
            </p>
          </div>
        )}
      </div>
    </div>
  );
}