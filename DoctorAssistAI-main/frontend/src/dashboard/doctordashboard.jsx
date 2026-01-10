
import React, { useState, useEffect } from "react";
import logo from "../assets/lodo_only.png";


import { 
  Home, Stethoscope, FileText, User, Lock, LogOut, 
  Users, Calendar, Activity, CheckCircle, Clock, 
  Search, Bell, ChevronRight, Bed, XCircle, HeartPulse, Clipboard, UserPlus,Settings
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

// --- BRAND COLORS AND CONFIG ---
const PRIMARY_BLUE = "#005a8b"; // Deep Navy/Indigo from your logo
const ACCENT_TEAL = "#00c2a7";  // Bright Teal/Cyan from your logo
const ACCENT_PURPLE = "#5856D6"; // Secondary Accent
const LIGHT_BG = "#f5f7fa";
const MAX_WIDTH = "1700px"; // Slightly wider to accommodate new layout
// -------------------------------

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// Helper to convert hex to rgba for use in CSS/JSX styles
const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};


/* ================= STYLES ================= */

const getStyles = () => {
  const liquidGlassBase = {
    background: "rgba(255, 255, 255, 0.6)",
    backdropFilter: "blur(35px) saturate(180%)",
    WebkitBackdropFilter: "blur(35px) saturate(180%)",
    border: "1px solid rgba(255, 255, 255, 0.85)",
    borderRadius: "18px", // Medium radius
    boxShadow: `
      0 10px 30px rgba(0, 0, 0, 0.06),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.7)
    `,
    position: "relative",
    overflow: "hidden"
  };

  return {
    // --- GLOBAL LAYOUT & FONT ---
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
      padding: "1.5rem", // Medium padding
      zIndex: 1,
      maxWidth: MAX_WIDTH,
      margin: '0 auto',
      marginLeft: '260px', // Offset for fixed sidebar
    },

    // --- LIQUID BACKGROUND EFFECTS (Subtle Brand Hues) ---
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

    // --- SIDEBAR (Fixed and branded) ---
    sidebar: {
      ...liquidGlassBase,
      width: "240px", // Fixed medium width
      minHeight: '100vh',
      margin: "0",
      position: 'fixed', // Key: Fixed position
      left: 0,
      top: 0,
      borderRadius: "0 18px 18px 0", // Rounded only on right side
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
    logoIcon: { width: "28px", height: "28px", borderRadius: "14px", overflow: "hidden" }, // Reduced size
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

    // --- HEADER AND STATS ---
    headerContainer: {
        ...liquidGlassBase, // Floating Header card
        padding: '1rem 1.5rem',
        marginBottom: '1.5rem',
        borderRadius: '16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
    headerTitle: {
      fontWeight: "800", fontSize: "24px", margin: 0, color: PRIMARY_BLUE, letterSpacing: "-0.03em"
    },
    
    // Stats Container - Unique T-Grid
    statsTGrid: {
        display: "grid", 
        gridTemplateColumns: "1fr 2fr", // Unique proportion
        gridTemplateRows: "1fr 1fr",
        gap: "16px", 
        marginBottom: "1.5rem"
    },
    statCard: {
        ...liquidGlassBase,
        padding: "16px",
        borderRadius: "14px",
        display: 'flex', flexDirection: 'column',
        transition: 'transform 0.2s',
        minHeight: '80px',
        justifyContent: 'center',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 15px 30px rgba(0, 0, 0, 0.1)' }
    },
    statValue: { fontSize: '24px', fontWeight: '800', color: PRIMARY_BLUE, margin: 0 },
    statTitle: { fontSize: '14px', fontWeight: '600', color: hexToRgba(PRIMARY_BLUE, 0.7), marginTop: '4px' },
    
    // Patient Registration Block (Tall feature card)
    registrationCard: {
        ...liquidGlassBase,
        gridRow: 'span 2', // Spans both rows in the T-Grid
        padding: '10px',
        borderRadius: '14px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: `linear-gradient(145deg, ${hexToRgba(ACCENT_TEAL, 0.15)}, ${hexToRgba(PRIMARY_BLUE, 0.1)})`,
        border: `1px solid ${hexToRgba(ACCENT_TEAL, 0.3)}`,
        cursor: 'pointer',
        transition: 'transform 0.3s',
        '&:hover': { transform: 'scale(1.02)' }
    },

    // --- MAIN TABLES ---
    card: {
        ...liquidGlassBase,
        padding: "20px",
        borderRadius: "18px",
    },
    cardHeader: {
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px",
        borderBottom: "1px solid rgba(0, 0, 0, 0.05)", paddingBottom: "12px",
    },
    cardTitle: { fontWeight: "700", fontSize: "18px", color: PRIMARY_BLUE, margin: 0 },
    viewAll: { fontSize: "13px", color: ACCENT_TEAL, cursor: "pointer", fontWeight: "600" },

    // Table Styles
    table: {
        width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px', marginTop: '8px'
    },
    th: {
        textAlign: 'left', padding: '10px 12px', fontSize: '13px', fontWeight: '700', color: hexToRgba(PRIMARY_BLUE, 0.8), 
        borderBottom: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}`
    },
    td: {
        padding: '12px', fontSize: '14px', color: '#1D1D1F', borderTop: '1px solid rgba(0, 0, 0, 0.05)'
    },
    tableRow: {
        borderRadius: '10px',
        background: 'rgba(255, 255, 255, 0.85)',
        transition: 'background 0.2s',
        '&:hover': { background: hexToRgba(PRIMARY_BLUE, 0.05) }
    },
    searchContainer: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px',
        padding: '10px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.9)',
        border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.1)}`
    },
    searchInput: { border: 'none', background: 'transparent', outline: 'none', flex: 1, padding: '0 10px', fontSize: '14px' },
    resetButton: {
        background: ACCENT_TEAL, color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', transition: 'background 0.2s',
        '&:hover': { background: PRIMARY_BLUE }
    },

    // Status Badges
    statusBadge: {
      padding: '6px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '700',
      display: 'inline-block', textAlign: 'center',
    },
    reportButton: {
        background: PRIMARY_BLUE, color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', transition: 'background 0.2s',
        '&:hover': { background: ACCENT_TEAL }
    },
    pagination: {
        display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1rem', gap: '8px'
    },
    pageButton: {
        background: hexToRgba(PRIMARY_BLUE, 0.1), color: PRIMARY_BLUE, border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', transition: 'background 0.2s'
    },
    activePage: {
        background: PRIMARY_BLUE, color: 'white',
    }
  };
};

/* ================= DUMMY DATA (based on screenshot) ================= */

const dummyIpoData = [
    
];

/* ================= HELPER COMPONENTS ================= */

const TableRow = ({ data, styles }) => {
    // Determine background/text color for Care Level Badge
    const getCareLevelStyle = (level) => {
        switch (level) {
            case 'GENERAL': return { background: hexToRgba(PRIMARY_BLUE, 0.1), color: PRIMARY_BLUE };
            case 'ER': return { background: hexToRgba(ACCENT_TEAL, 0.1), color: ACCENT_TEAL };
            default: return { background: hexToRgba('#999999', 0.1), color: '#999999' };
        }
    };
    
    // Determine background/text color for Status Badge
    const getStatusStyle = (status) => {
        if (status === 'Discharge') {
            return { background: hexToRgba(ACCENT_PURPLE, 0.1), color: ACCENT_PURPLE };
        }
        return { background: hexToRgba('#34C759', 0.1), color: '#34C759' };
    };

    return (
        <tr style={styles.tableRow}>
            <td style={{ ...styles.td, width: '15%' }}>
                {data.id.substring(0, 15)}...
            </td>
            <td style={{ ...styles.td, fontWeight: '600', width: '15%' }}>{data.name}</td>
            <td style={{ ...styles.td, width: '10%' }}>
                <span style={{ ...styles.statusBadge, ...getCareLevelStyle(data.careLevel) }}>
                    {data.careLevel}
                </span>
            </td>
            <td style={styles.td}>{data.admDate}</td>
            <td style={styles.td}>
                <span style={{ ...styles.statusBadge, ...getStatusStyle(data.status) }}>
                    {data.status}
                </span>
            </td>
            <td style={styles.td}>
                <span style={{ ...styles.statusBadge, background: data.surgeryScheduled ? hexToRgba('#34C759', 0.1) : hexToRgba('#FF3B30', 0.1), color: data.surgeryScheduled ? '#34C759' : '#FF3B30' }}>
                    {data.surgeryScheduled ? 'Yes' : 'No'}
                </span>
            </td>
            <td style={styles.td}>
                <button style={styles.reportButton}>
                    {data.report}
                </button>
            </td>
        </tr>
    );
};

/* ================= MAIN DASHBOARD COMPONENT ================= */



function DoctorDashboard() {
  const styles = getStyles();

  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // const handleLogout = () => {
  //   alert("Logging out...");
  //   // navigate("/login");
  // };

  const handleLogout = async () => {
    try {
      await fetch(
        `${API_BASE_URL}/hms/users/auth/logout`,
        {
          method: "POST",
          credentials: "include",
        }
      );
    } finally {
      navigate("/login");
    }
  };

    const location = useLocation();
  const navigate = useNavigate();

  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [doctorName, setDoctorName] = useState("");
const [doctorSpeciality, setDoctorSpeciality] = useState("");
const [searchTerm, setSearchTerm] = useState('');
const [patients, setPatients] = useState([]);
const [loading, setLoading] = useState(false);
const handleSearch = async (value) => {
    setSearchTerm(value);

    if (!doctorId) return;   // 🔒 prevent broken calls

    if (value.length < 2) {
        setPatients([]);
        return;
    }

    try {
        setLoading(true);

        const response = await fetch(
          `${API_BASE_URL}/hms/users/doctors/search?term=${encodeURIComponent(value)}&doctor_id=${doctorId}`
        );

        const data = await response.json();
        console.log("Search data:", data);

        if (data.status === "success") {
            setPatients(data.patients);
        } else {
            setPatients([]);
        }
    } catch (err) {
        console.error("Search error:", err);
        setPatients([]);
    } finally {
        setLoading(false);
    }
};

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

      // 🔐 BLOCK mismatched doctor_id
      if (doctorId && doctorId !== verifiedDoctorId) {
        console.warn("Doctor ID mismatch — blocking page");
        navigate("/login"); // or /unauthorized
        return;
      }

      setAuthenticated(true);
    } catch (err) {
      navigate("/login");
    } finally {
      setAuthChecked(true);
    }
  };

  verifyAuth();
}, [navigate, doctorId]);

  

  useEffect(() => {
    if (!doctorId) return;
    console.log("Doctor ID:", doctorId);
    const fetchTodayAppointments = async () => {
      try {
        setLoadingAppointments(true);

        const res = await fetch(
          `${API_BASE_URL}/hms/users/doctors/doctor_today_appointments/${doctorId}`
        );

        const data = await res.json();

        if (data.status === "success") {
          setTodayAppointments(data.appointments || []);
        } else {
          setTodayAppointments([]);
        }
      } catch (err) {
        console.error("Error loading today's appointments", err);
        setTodayAppointments([]);
      } finally {
        setLoadingAppointments(false);
      }
    };

    fetchTodayAppointments();
  }, [doctorId]);
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

  const handleRegisterPatient = () => {
    if (!doctorId) return alert("Doctor ID missing");
    navigate(`/register-patient?doctor_id=${doctorId}`);
  };


  if (!authChecked) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: "600"
      }}>
        Verifying session...
      </div>
    );
  }

  

  
  return (
    <div style={styles.layout}>
        <style>{`
            @keyframes subtleMove {
                0% { transform: translate(0, 0); }
                100% { transform: translate(40px, -40px); }
            }
            .status-general { color: ${PRIMARY_BLUE}; background: ${hexToRgba(PRIMARY_BLUE, 0.1)}; }
            .status-er { color: ${ACCENT_TEAL}; background: ${hexToRgba(ACCENT_TEAL, 0.1)}; }
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
                     <img
      src={logo}
      alt="DoctorAssist Logo"
      style={styles.logoImage}
    />
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
                    <button style={styles.menuItemActive}>
                        <Home size={18} />
                        <span>Dashboard</span>
                    </button>
                     <button
  style={styles.menuItem}
  
  onClick={() =>
   window.location.href =
  `/appointments?doctor_id=${doctorId}`

  }
>
  <Settings size={18} />
  <span>Appointment</span>
</button>
                    <button style={styles.menuItem}>
                        <Bed size={18} />
                        <span>IPD/Ward Patients</span>
                    </button>
                    <button style={styles.menuItem}>
                        <Users size={18} />
                        <span>Patient Records</span>
                    </button>
                   
                    <button style={styles.menuItem}>
                        <Activity size={18} />
                        <span>Referrals</span>
                    </button>
                    
            <button
  style={styles.menuItem}
  onClick={() =>
   window.location.href =
  `/settings.html?doctor_id=${doctorId}`

  }
>
  <Settings size={18} />
  <span>Node Settings</span>
</button>
 <button
  style={styles.menuItem}
  onClick={() =>
   window.location.href =
  `/pre-consultancy.html?doctor_id=${doctorId}`

  }
>
  <Settings size={18} />
  <span>pre consultancy</span>
</button>
 <button
  style={styles.menuItem}
  onClick={() =>
   window.location.href =
  `/during-consultancy.html?doctor_id=${doctorId}`

  }
>
  <Settings size={18} />
  <span>During consultancy</span>
</button>
 <button
  style={styles.menuItem}
  onClick={() =>
   window.location.href =
  `/post-consultancy.html?doctor_id=${doctorId}`

  }
>
  <Settings size={18} />
  <span>post consultancy</span>
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
            
            {/* 1. Floating Header/Search Bar */}
            <div style={styles.headerContainer}>
                <h1 style={styles.headerTitle}>Dashboard Overview</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.8)', border: `1px solid ${hexToRgba(PRIMARY_BLUE, 0.2)}` }}>
                        <Search size={16} color={PRIMARY_BLUE} />
                        <input
    type="text"
    placeholder="Search by HMS ID or Mobile"
    value={searchTerm}
    onChange={(e) => handleSearch(e.target.value)}
    style={styles.searchInput}
/>

                    </div>
                    {searchTerm.length >= 2 && (
    <div style={{
        position: "absolute",
        top: "70px",
        right: "32px",
        width: "340px",
        background: "white",
        borderRadius: "12px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
        zIndex: 1000,
        overflow: "hidden"
    }}>
        {loading ? (
            <div style={{ padding: "12px", textAlign: "center" }}>Searching...</div>
        ) : patients.length === 0 ? (
            <div style={{ padding: "12px", textAlign: "center", color: "#999" }}>
                No patients found
            </div>
        ) : (
            patients.map(p => (
                <div
                    key={p.sys_user_id}
                    style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        borderBottom: "1px solid #eee"
                    }}
                    onClick={() => {
                        window.location.href = `/patients/${p.patient_id}`;
                    }}
                >
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: "12px", color: "#666" }}>
                        {p.hms_id} • {p.phone_number}
                    </div>
                </div>
            ))
        )}
    </div>
)}

                    <Bell size={20} color={PRIMARY_BLUE} style={{ cursor: 'pointer' }} />
                </div>
            </div>

            {/* 2. STATS GRID (UNIQUE T-GRID LAYOUT) */}
            <section style={styles.statsTGrid}>
                
                {/* Row 1: OP/IP Appointments */}
                <div style={{...styles.statCard, background: hexToRgba(PRIMARY_BLUE, 0.05)}}>
                    <p style={styles.statTitle}>OP Appointments</p>
                    <h2 style={{ ...styles.statValue, color: ACCENT_TEAL }}>0</h2>
                </div>
                <div style={{...styles.statCard, background: hexToRgba(ACCENT_TEAL, 0.05)}}>
                    <p style={styles.statTitle}>IP Appointments</p>
                    <h2 style={{ ...styles.statValue, color: PRIMARY_BLUE }}>0</h2>
                </div>
                
                {/* Row 2: Operations / Wards / ICU / DISCHARGE (4 items in a 2fr column) */}
                <div style={{
                    gridColumn: 'span 2', // Spans both columns for the main stats strip
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: '16px',
                    width: '100%'
                }}>
                    <div style={{...styles.statCard}}>
                        <p style={styles.statTitle}>Operations</p>
                        <h2 style={{ ...styles.statValue, color: ACCENT_PURPLE }}>0</h2>
                    </div>
                    <div style={{...styles.statCard}}>
                        <p style={styles.statTitle}>WARD Patients</p>
                        <h2 style={{ ...styles.statValue, color: PRIMARY_BLUE }}>0</h2>
                    </div>
                    <div style={{...styles.statCard}}>
                        <p style={styles.statTitle}>ICU Patients</p>
                        <h2 style={{ ...styles.statValue, color: ACCENT_TEAL }}>0</h2>
                    </div>
                    <div style={{...styles.statCard}}>
                        <p style={styles.statTitle}>Room Patients</p>
                        <h2 style={{ ...styles.statValue, color: '#FF9500' }}>0</h2>
                    </div>
                    <div style={{...styles.statCard}}>
                        <p style={styles.statTitle}>Discharge</p>
                        <h2 style={{ ...styles.statValue, color: '#FF3B30' }}>0</h2>
                    </div>
                </div>

                {/* Patient Registration Block (Feature Card - Spans 2 rows) */}
                <div onClick={handleRegisterPatient} style={styles.registrationCard}>
                    <UserPlus size={40} color={PRIMARY_BLUE} style={{ margin: '0 auto 10px' }} />
                    <p style={{ ...styles.statTitle, color: PRIMARY_BLUE, fontSize: '15px' }}>PATIENT REGISTRATION</p>
                    <p style={{ ...styles.statTitle, fontSize: '12px', marginTop: '2px', color: hexToRgba(PRIMARY_BLUE, 0.7) }}>Click to register new patient</p>
                </div>
            </section>
            
            {/* 3. MAIN TABLES */}
            
            {/* APPOINTMENT LISTING */}
            <section style={{ ...styles.card, marginBottom: '1.5rem' }}>
                <div style={styles.cardHeader}>
                    <h3 style={styles.cardTitle}>Today's Appointment Listing</h3>
                    {/* <span style={styles.viewAll}>View All <ChevronRight size={14} style={{ display: 'inline-block', verticalAlign: 'middle' }} /></span> */}
                </div>

             

                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={styles.th}>Patient Name</th>
                            <th style={styles.th}>Mobile</th>
                            <th style={styles.th}>Age</th>
                            <th style={styles.th}>Appointment Time</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Chief Complaint</th>
                            <th style={styles.th}>Report/Upload</th>
                            <th style={styles.th}>Dicom Upload</th>
                            <th style={styles.th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
  {loadingAppointments ? (
    <tr>
      <td colSpan="8" style={{ ...styles.td, textAlign: "center" }}>
        Loading appointments...
      </td>
    </tr>
  ) : todayAppointments.length === 0 ? (
    <tr>
      <td colSpan="8" style={{ ...styles.td, textAlign: "center" }}>
        No appointments found for today
      </td>
    </tr>
  ) : (
    todayAppointments.map((appt, index) => (
      <tr key={index} style={styles.tableRow}>
       <td
  style={{
    ...styles.td,
    fontWeight: "600",
    color: ACCENT_TEAL,
    cursor: "pointer",
    textDecoration: "underline"
  }}
  onClick={() => {
    if (!doctorId) return alert("Doctor ID missing");

    window.location.href = `/dashboard?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`;
  }}
>
  {appt.patient_name}
</td>

        <td style={styles.td}>{appt.patient_phone}</td>
        <td style={styles.td}>
  {(() => {
    const dob = new Date(appt.patient_dob);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    const dayDiff = today.getDate() - dob.getDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--;
    return age;
  })()}
</td>
        <td style={styles.td}>{appt.scheduled_time}</td>
        <td style={styles.td}>
          <span
            style={{
              ...styles.statusBadge,
              background: hexToRgba(ACCENT_TEAL, 0.1),
              color: ACCENT_TEAL
            }}
          >
            Scheduled
          </span>
        </td>
        <td style={styles.td}>
          {appt.chief_complaint || "-"}
        </td>
       <td style={styles.td}>
  <button
    style={styles.reportButton}
    onClick={() => {
      if (!doctorId) return alert("Doctor ID missing");

      window.location.href = `http://68.183.82.95:5173/patient_reports_document_upload.html?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`;
    }}
  >
    Upload
  </button>
</td>
<td style={styles.td}>
  <button
    style={styles.reportButton}
    onClick={() => {
      if (!doctorId) return alert("Doctor ID missing");

      window.location.href = `/upload.html?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`;
    }}
  >
    Upload
  </button>
</td>
       <td style={styles.td}>
  <button
    style={{
      ...styles.reportButton,
      background: PRIMARY_BLUE
    }}
    onClick={() => {
      if (!doctorId) return alert("Doctor ID missing");
      window.location.href = `/screen.html?doctor_id=${doctorId}&patient_id=${appt.sys_user_id}`;
    }}
  >
    Start
  </button>

        </td>
      </tr>
    ))
  )}
</tbody>

                </table>
            </section>
            
            {/* IPD LISTING */}
            <section style={{ ...styles.card, marginBottom: '1.5rem' }}>
                <div style={styles.cardHeader}>
                    <h3 style={styles.cardTitle}>IPD Patient Listing</h3>
                    <span style={styles.viewAll}>View All <ChevronRight size={14} style={{ display: 'inline-block', verticalAlign: 'middle' }} /></span>
                </div>

                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={styles.th}>Patient Id</th>
                            <th style={styles.th}>Patient Name</th>
                            <th style={styles.th}>Care Level</th>
                            <th style={styles.th}>Admission Date</th>
                            <th style={styles.th}>Estimated Discharge</th>
                            <th style={styles.th}>Surgery Scheduled</th>
                            <th style={styles.th}>Report/Upload</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dummyIpoData.map((data, index) => (
                            // Note: Removed Chief Complaint column from TableRow props
                            <TableRow key={index} data={data} styles={styles} />
                        ))}
                    </tbody>
                </table>
                <div style={styles.pagination}>
                    <button style={styles.pageButton}>Previous</button>
                    <button style={{ ...styles.pageButton, ...styles.activePage }}>1</button>
                    <button style={styles.pageButton}>2</button>
                    <button style={styles.pageButton}>Next</button>
                    <span style={{ fontSize: '13px', color: hexToRgba(PRIMARY_BLUE, 0.7), marginLeft: '12px' }}>
                        Showing 1-10 of 19 patients
                    </span>
                </div>
            </section>

            {/* REFERRAL LISTING */}
            <section style={styles.card}>
                <div style={styles.cardHeader}>
                    <h3 style={styles.cardTitle}>Referral Listing</h3>
                    <span style={styles.viewAll}>View All <ChevronRight size={14} style={{ display: 'inline-block', verticalAlign: 'middle' }} /></span>
                </div>
                
                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={styles.th}>Doctor ID</th>
                            <th style={styles.th}>Refering Doctor Name</th>
                            <th style={styles.th}>Patient Id</th>
                            <th style={styles.th}>Patient Name</th>
                            <th style={styles.th}>Mobile Number</th>
                            <th style={styles.th}>Referral Doctor ID</th>
                            <th style={styles.th}>Appointment</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td colSpan="7" style={{ ...styles.td, textAlign: 'center', paddingTop: '20px', paddingBottom: '20px', color: hexToRgba('#FF3B30', 0.8) }}>
                                
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div style={styles.pagination}>
                    <button style={styles.pageButton}>Previous</button>
                    <button style={{ ...styles.pageButton, ...styles.activePage }}>1</button>
                    <button style={styles.pageButton}>Next</button>
                </div>
            </section>
        </div>
    </div>
  );
}

// Add CSS animation for liquid effect
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes subtleMove {
        0% { transform: translate(0, 0); }
        100% { transform: translate(40px, -40px); }
    }
    
    /* Global Transitions */
    * {
        transition: background-color 0.3s ease, border-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
    }
`;
document.head.appendChild(styleSheet);

export default DoctorDashboard;