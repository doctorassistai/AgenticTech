import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { 
  Activity, 
  Calendar, 
  UserPlus, 
  Users, 
  FileText, 
  Stethoscope,
  LogOut,
  Home,
  TrendingUp,
  Clock,
  CheckCircle,
  Settings,
  Bell,
  Search,
  ChevronRight,
  Building,
  User,
  Pill,
  Clipboard,
  HeartPulse,
  Thermometer,
  Eye
} from "lucide-react";
import { useEffect, useState } from "react";

// ================= COMPONENTS (ACCEPTING 'styles' PROP) ================= 

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const LiquidGlassCard = ({ title, value, change, icon, color, styles }) => (
  <div style={styles.liquidCard}>
    {/* Inner card wrapper for the main content */}
    <div style={styles.liquidCardInner}>
      <div style={styles.cardIcon}>
        {/* Clone the icon to ensure color is applied */}
        {React.cloneElement(icon, { color })} 
      </div>
      <p style={styles.muted}>{title}</p>
      <div style={styles.valueRow}>
        <h2 style={{ color, margin: 0, fontSize: '28px', fontWeight: '700', letterSpacing: '-0.02em' }}>{value}</h2> {/* Reduced size */}
        <span style={{
          ...styles.changeBadge,
          color: change.startsWith('+') ? '#34C759' : '#FF3B30',
          background: change.startsWith('+') ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 59, 48, 0.15)'
        }}>
          <TrendingUp size={14} style={{ marginRight: '4px' }} />
          {change}
        </span>
      </div>
    </div>
  </div>
);

const ActivityCard = ({ icon, label, value, color, styles }) => (
  <div style={styles.activityCard}>
    <div style={{...styles.activityCardIcon, background: `rgba(${hexToRgb(color)}, 0.12)`}}>
      {React.cloneElement(icon, { color })}
    </div>
    <div>
      <h3 style={{ margin: 0, color, fontSize: '20px', fontWeight: '700', letterSpacing: '-0.02em' }}>{value}</h3> {/* Reduced size */}
      <p style={styles.muted}>{label}</p>
    </div>
  </div>
);


// ================= MAIN COMPONENT =================

function HospitalDashboard() {
  const location = useLocation();
  const navigate = useNavigate();

  const queryParams = new URLSearchParams(location.search);
  const hospitalId = queryParams.get("hospital_id");
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

    // 🔐 VERIFY JWT + HOSPITAL ID (ANTI-IMPERSONATION)
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

          // 🚫 BLOCK Hospital A opening Hospital B dashboard
          if (hospitalId && hospitalId !== verifiedHospitalId) {
            console.warn("Hospital ID mismatch — access denied");
            navigate("/login");
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
    }, [hospitalId, navigate]);



  // --- STYLES DEFINITION ---
  const styles = getStyles();

  const handleLogout = async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/users/auth/logout`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        }
      );

      if (response.ok) {
        localStorage.removeItem("token");
        localStorage.removeItem("user_id");
        localStorage.removeItem("role");
        window.location.href = "http://68.183.82.95:5173/login";
      } else {
        alert("Logout failed");
      }
    } catch {
      alert("Logout error");
    }
  };

  const handleAddDoctor = () => {
    if (!hospitalId) return alert("Hospital ID missing");
    navigate(`/register-doctor?hospital_id=${hospitalId}`);
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
      {/* Background Gradient Shapes */}
      <div style={styles.blueShape1}></div>
      <div style={styles.blueShape2}></div>
      <div style={styles.liquidEffect}></div>

      {/* ================= LEFT SIDEBAR ================= */}
      <aside style={styles.sidebar}>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={styles.brandContainer}>
              <div style={styles.logoIcon}>
                <div style={styles.logoGradient}>
                  <Stethoscope size={22} color="white" /> {/* Reduced size */}
                </div>
              </div>
              <div>
                <h2 style={styles.brand}>DoctorAssist</h2>
                <p style={styles.brandSubtitle}>AI Healthcare</p>
              </div>
            </div>

            <div style={styles.menu}>
              <button style={styles.menuItemActive}>
                <Home size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Dashboard</span>
              </button>

              <button style={styles.menuItem} onClick={handleAddDoctor}>
                <UserPlus size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Add Doctor</span>
              </button>
              
              <button style={styles.menuItem}>
                <Users size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Patients</span>
              </button>
              
              <button style={styles.menuItem}>
                <Calendar size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Appointments</span>
              </button>
              
              <button style={styles.menuItem}>
                <Building size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Departments</span>
              </button>
              
              <button style={styles.menuItem}>
                <FileText size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Reports & Analytics</span>
              </button>
              
              <button style={styles.menuItem}>
                <Settings size={18} style={styles.menuIcon} /> {/* Reduced size */}
                <span>Settings</span>
              </button>
            </div>
          </div>
        </div>

        <div>
          <div style={styles.profileSection}>
            <div style={styles.profileAvatar}>
              <div style={styles.profileGradient}>
                <User size={16} color="white" /> {/* Reduced size */}
              </div>
            </div>
            <div>
              <p style={styles.profileName}>Hospital Admin</p>
              <p style={styles.profileId}>ID: {hospitalId || "N/A"}</p>
            </div>
          </div>
          
          <button style={styles.logoutBtn} onClick={handleLogout}>
            <div style={styles.logoutIcon}>
              <LogOut size={16} /> {/* Reduced size */}
            </div>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ================= MAIN CONTENT ================= */}
      <main style={styles.page}>
        {/* Header */}
        <header style={styles.header}>
          <div>
            <h1 style={styles.headerTitle}>Hospital Dashboard</h1>
            <p style={styles.headerSubtitle}>
              Welcome back! Here's what's happening today.
            </p>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.searchBar}>
              <Search size={16} color="rgba(0, 90, 139, 0.8)" /> {/* Reduced size */}
              <input 
                type="text" 
                placeholder="Search patients, doctors, reports..." 
                style={styles.searchInput}
              />
            </div>
            <div style={styles.notificationBadge}>
              <div style={styles.notificationIcon}>
                <Bell size={18} color="rgba(0, 90, 139, 0.8)" /> {/* Reduced size */}
                <span style={styles.notificationDot}></span>
              </div>
            </div>
            <div style={styles.dateBadge}>
              <Calendar size={14} color="rgba(0, 90, 139, 0.8)" /> {/* Reduced size */}
              {new Date().toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                year: 'numeric'
              })}
            </div>
          </div>
        </header>

        {/* Stats */}
        <section style={styles.statsGrid}>
          {/* Passing the styles object to helper components */}
          <LiquidGlassCard 
            title="Total Appointments" 
            value="142" 
            change="+12%"
            icon={<Calendar size={22} color="#005a8b" />}
            color="#005a8b"
            styles={styles} // <-- Passing styles
          />
          <LiquidGlassCard 
            title="Pending" 
            value="23" 
            change="-3%"
            icon={<Clock size={22} color="#FF9500" />}
            color="#FF9500"
            styles={styles} // <-- Passing styles
          />
          <LiquidGlassCard 
            title="Completed Today" 
            value="89" 
            change="+8%"
            icon={<CheckCircle size={22} color="#34C759" />}
            color="#34C759"
            styles={styles} // <-- Passing styles
          />
          <LiquidGlassCard 
            title="Total Patients" 
            value="698" 
            change="+15%"
            icon={<Users size={22} color="#AF52DE" />}
            color="#AF52DE"
            styles={styles} // <-- Passing styles
          />
        </section>

        {/* Main Content */}
        <section style={styles.mainGrid}>
          <div style={styles.cardLarge}>
            <div style={styles.cardHeader}>
              <div>
                <h3 style={styles.cardTitle}>Patients Treated Overview</h3>
                <p style={styles.muted}>
                  Monthly appointment activity and patient growth trends
                </p>
              </div>
              <div style={styles.selectContainer}>
                <select style={styles.select}>
                  <option>Last 7 days</option>
                  <option>Last 30 days</option>
                  <option>Last 90 days</option>
                </select>
              </div>
            </div>

            <div style={styles.chartContainer}>
              <div style={styles.chartGrid}>
                {[80, 60, 90, 70, 85, 95, 75, 65, 88, 92, 78, 82].map((height, index) => (
                  <div key={index} style={styles.chartBarContainer}>
                    <div 
                      style={{
                        ...styles.chartBar,
                        height: `${height}%`,
                        background: index % 2 === 0 
                          ? 'linear-gradient(to top, #005a8b, rgba(0, 90, 139, 0.6))' 
                          : 'linear-gradient(to top, #00c2a7, rgba(0, 194, 167, 0.6))'
                      }}
                    />
                    <span style={styles.chartLabel}>
                      {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][index]}
                    </span>
                  </div>
                ))}
              </div>
              <div style={styles.chartLegend}>
                <div style={styles.legendItem}>
                  <div style={{...styles.legendColor, background: '#005a8b'}}></div>
                  <span>Patients Treated</span>
                </div>
                <div style={styles.legendItem}>
                  <div style={{...styles.legendColor, background: '#00c2a7'}}></div>
                  <span>New Patients</span>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Quick Actions</h3>
            <p style={styles.muted}>Manage your hospital efficiently</p>
            
            <button style={styles.primaryBtn} onClick={handleAddDoctor}>
              <UserPlus size={18} />
              <span>Add New Doctor</span>
            </button>
            
            <button style={styles.secondaryBtn}>
              <Calendar size={18} />
              <span>Schedule Appointment</span>
            </button>
            
            <button style={styles.secondaryBtn}>
              <FileText size={18} />
              <span>Generate Report</span>
            </button>
            
            <button style={styles.secondaryBtn}>
              <TrendingUp size={18} />
              <span>View Analytics</span>
            </button>
          </div>
        </section>

        {/* Doctors + Activity */}
        <section style={styles.grid2}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h3 style={styles.cardTitle}>Available Doctors</h3>
                <p style={styles.muted}>5 doctors currently active</p>
              </div>
              <span style={styles.badge}>5 Active</span>
            </div>
            
            {[
              { name: "Dr. Rekha", specialty: "Pediatrics", status: "Available", icon: <HeartPulse size={16} color="white" /> },
              { name: "Dr. Sharma", specialty: "Cardiology", status: "Available", icon: <Activity size={16} color="white" /> },
              { name: "Dr. Patel", specialty: "Orthopedics", status: "In Surgery", icon: <Thermometer size={16} color="white" /> },
              { name: "Dr. Kumar", specialty: "General", status: "Available", icon: <Stethoscope size={16} color="white" /> },
              { name: "Dr. Singh", specialty: "Dermatology", status: "On Leave", icon: <Eye size={16} color="white" /> }
            ].map((doctor, index) => (
              <div key={index} style={styles.doctorRow}>
                <div style={{
                  ...styles.avatar,
                  background: index % 2 === 0 
                    ? 'linear-gradient(135deg, #005a8b, #00c2a7)' 
                    : 'linear-gradient(135deg, #00c2a7, #005a8b)'
                }}>
                  <div style={styles.avatarIcon}>
                    {doctor.icon}
                  </div>
                </div>
                <div style={styles.doctorInfo}>
                  <p style={styles.name}>{doctor.name}</p>
                  <p style={styles.muted}>{doctor.specialty}</p>
                </div>
                <span style={{
                  ...styles.statusBadge,
                  // FIX 1: Corrected ternary structure for background color
                  background: doctor.status === 'Available' 
                    ? 'rgba(52, 199, 89, 0.15)' 
                    : doctor.status === 'In Surgery'
                    ? 'rgba(255, 149, 0, 0.15)'
                    : 'rgba(255, 59, 48, 0.15)',
                  // FIX 2: Corrected ternary structure for text color
                  color: doctor.status === 'Available' 
                    ? '#34C759' 
                    : doctor.status === 'In Surgery'
                    ? '#FF9500'
                    : '#FF3B30'
                }}>
                  {doctor.status}
                </span>
              </div>
            ))}
            
            <button style={styles.viewAllBtn}>
              <span>View All Doctors</span>
              <ChevronRight size={18} />
            </button>
          </div>

          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h3 style={styles.cardTitle}>Today's Activity</h3>
                <p style={styles.muted}>Real-time hospital activity</p>
              </div>
              <div style={styles.liveBadge}>
                <div style={styles.liveDot}></div>
                Live
              </div>
            </div>
            <div style={styles.activityRow}>
              {/* Passing the styles object to helper components */}
              <ActivityCard icon={<Users size={20} />} label="Appointments" value="12" color="#005a8b" styles={styles} />
              <ActivityCard icon={<Clipboard size={20} />} label="Investigations" value="8" color="#00c2a7" styles={styles} />
              <ActivityCard icon={<Pill size={20} />} label="Prescriptions" value="24" color="#AF52DE" styles={styles} />
              <ActivityCard icon={<FileText size={20} />} label="Reports" value="15" color="#FF9500" styles={styles} />
            </div>
            
            <div style={styles.recentActivity}>
              <h4 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: styles.cardTitle.color }}> {/* Reduced size */}
                <Activity size={18} color={styles.cardTitle.color} />
                Recent Activity
              </h4>
              {[
                { time: "10:30 AM", text: "Dr. Sharma completed surgery", icon: <CheckCircle size={14} color="#34C759" /> },
                { time: "09:15 AM", text: "New patient registration", icon: <UserPlus size={14} color="#005a8b" /> },
                { time: "08:45 AM", text: "Lab reports uploaded", icon: <FileText size={14} color="#FF9500" /> },
                { time: "08:00 AM", text: "Morning rounds completed", icon: <Users size={14} color="#AF52DE" /> }
              ].map((activity, index) => (
                <div key={index} style={styles.activityItem}>
                  <div style={styles.activityIcon}>
                    {activity.icon}
                  </div>
                  <div style={styles.activityContent}>
                    <div style={styles.activityText}>{activity.text}</div>
                    <div style={styles.activityTime}>{activity.time}</div>
                  </div>
                  <ChevronRight size={16} color="rgba(60, 60, 67, 0.3)" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// ================= HELPER FUNCTIONS & STYLES =================

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` 
    : '0, 90, 139';
};

const getStyles = () => {
  // Brand Colors
  const BRAND_BLUE = "#005a8b"; // Deep Navy/Indigo
  const BRAND_TEAL = "#00c2a7";  // Bright Teal/Cyan
  const ACCENT_COLOR = "#5856D6"; // Purple

  // Reduced border radius for a slightly tighter feel
  const BASE_BORDER_RADIUS = "20px";

  const liquidGlassBase = {
    background: "rgba(255, 255, 255, 0.6)",
    backdropFilter: "blur(35px) saturate(180%)", // Reduced blur slightly
    WebkitBackdropFilter: "blur(35px) saturate(180%)",
    border: "1px solid rgba(255, 255, 255, 0.85)",
    borderRadius: BASE_BORDER_RADIUS,
    boxShadow: `
      0 15px 40px rgba(0, 0, 0, 0.08),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.7),
      0 0 0 1px rgba(255, 255, 255, 0.4)
    `,
    position: "relative",
    overflow: "hidden"
  };

  const dashboardStyles = {
    layout: {
      display: "flex",
      minHeight: "100vh",
      background: "linear-gradient(135deg, #f5f7ff 0%, #f0f4ff 50%, #e8edff 100%)",
      fontFamily: "'Inter', 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      position: "relative",
      overflow: "hidden",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale"
    },

    // --- LIQUID BACKGROUND EFFECTS (kept subtle) ---
    blueShape1: {
      position: "fixed", top: "20%", left: "0%", width: "700px", height: "700px", // Reduced size
      background: `linear-gradient(145deg, ${BRAND_BLUE}aa, #ffffff11)`, 
      borderRadius: "40% 60% 70% 30% / 40% 50% 50% 60%", 
      opacity: 0.12, filter: "blur(80px)", zIndex: 0, // Reduced opacity and blur
      animation: "subtleMove 15s ease-in-out infinite alternate",
    },
    blueShape2: {
      position: "fixed", bottom: "40%", right: "0%", width: "500px", height: "500px", // Reduced size
      background: `linear-gradient(-45deg, ${BRAND_TEAL}aa, ${BRAND_BLUE}33)`,
      borderRadius: "70% 30% 60% 40% / 60% 70% 30% 40%",
      opacity: 0.08, filter: "blur(120px)", zIndex: 0, // Reduced opacity and blur
      animation: "subtleMove 20s ease-in-out infinite alternate-reverse",
    },
    liquidEffect: {
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: "none",
      background: `
        radial-gradient(circle at 10% 25%, rgba(${hexToRgb(BRAND_BLUE)}, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 85%, rgba(${hexToRgb(BRAND_TEAL)}, 0.08) 0%, transparent 40%)
      `,
    },

    // --- SIDEBAR ---
    sidebar: {
      ...liquidGlassBase,
      width: "260px", // REDUCED WIDTH
      margin: "1.5rem", // REDUCED MARGIN
      padding: "1.25rem", // REDUCED PADDING
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      zIndex: 1,
      borderRight: "1px solid rgba(255, 255, 255, 0.9)",
      borderRadius: BASE_BORDER_RADIUS, 
    },

    brandContainer: {
      display: "flex", alignItems: "center", gap: "12px", marginBottom: "2rem", paddingBottom: "1.25rem", // Reduced spacing
      borderBottom: "1px solid rgba(0, 0, 0, 0.08)"
    },
    logoIcon: { width: "48px", height: "48px", borderRadius: "14px", overflow: "hidden" }, // Reduced size
    logoGradient: {
      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "14px",
      background: `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_TEAL})`,
      boxShadow: "0 8px 25px rgba(0, 90, 139, 0.3)"
    },
    brand: { fontWeight: "800", fontSize: "20px", margin: 0, color: "#1D1D1F", letterSpacing: "-0.03em" }, // Reduced font size
    brandSubtitle: { fontSize: "12px", color: "rgba(60, 60, 67, 0.65)", margin: "3px 0 0 0", fontWeight: "600", letterSpacing: "0.02em" },

    menu: { display: "flex", flexDirection: "column", gap: "8px" }, // Reduced gap
    menuItem: {
      background: "transparent", border: "none", textAlign: "left", fontSize: "15px", color: "rgba(60, 60, 67, 0.85)", cursor: "pointer", // Reduced font size
      padding: "14px", borderRadius: "14px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", alignItems: "center", gap: "12px", // Reduced padding/radius
      fontWeight: "600", letterSpacing: "-0.01em",
      '&:hover': { background: `rgba(${hexToRgb(BRAND_BLUE)}, 0.08)`, color: BRAND_BLUE, transform: "translateX(8px)" } // Reduced shift
    },
    menuItemActive: {
      background: `linear-gradient(135deg, rgba(${hexToRgb(BRAND_BLUE)}, 0.15), rgba(${hexToRgb(ACCENT_COLOR)}, 0.1))`,
      border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.25)`, color: BRAND_BLUE, padding: "14px", borderRadius: "14px", // Reduced padding/radius
      display: "flex", alignItems: "center", gap: "12px", fontWeight: "700", letterSpacing: "-0.01em",
      boxShadow: "0 6px 20px rgba(0, 90, 139, 0.15)" // Reduced shadow
    },
    menuIcon: { opacity: 0.9 },

    profileSection: {
      ...liquidGlassBase,
      background: "rgba(250, 250, 252, 0.7)",
      padding: "14px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", // Reduced padding/gap
      boxShadow: "0 8px 15px rgba(0, 0, 0, 0.05)"
    },
    profileAvatar: { width: "40px", height: "40px", borderRadius: "12px" }, // Reduced size
    profileGradient: { width: "100%", height: "100%", background: `linear-gradient(135deg, ${BRAND_BLUE}, ${ACCENT_COLOR})`, borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" },
    profileName: { fontWeight: "700", margin: 0, fontSize: "15px", color: "#1D1D1F", letterSpacing: "-0.01em" }, // Reduced font size
    profileId: { fontSize: "13px", color: "rgba(60, 60, 67, 0.6)", margin: "2px 0 0 0", letterSpacing: "0.01em" }, // Reduced font size
    
    logoutBtn: {
      padding: "14px", borderRadius: "16px", border: "1px solid rgba(255, 59, 48, 0.25)", // Reduced padding/radius
      background: "linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 149, 0, 0.08))", color: "#FF3B30", cursor: "pointer",
      fontSize: "15px", fontWeight: "700", display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center", // Reduced size/gap
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", letterSpacing: "-0.01em",
      '&:hover': { background: "rgba(255, 59, 48, 0.15)", transform: "translateY(-2px)", boxShadow: "0 8px 20px rgba(255, 59, 48, 0.15)" }
    },
    logoutIcon: { opacity: 0.9 },

    // --- MAIN CONTENT ---
    page: { flex: 1, padding: "1.5rem", zIndex: 1, position: "relative" }, // Reduced padding

    header: {
      ...liquidGlassBase,
      padding: "1.25rem 1.5rem", // Reduced padding
      display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", // Reduced margin
      borderRadius: BASE_BORDER_RADIUS,
    },

    headerTitle: { fontWeight: "800", fontSize: "30px", margin: 0, color: "#1D1D1F", letterSpacing: "-0.04em", background: "linear-gradient(135deg, #1D1D1F, #424245)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }, // Reduced font size
    headerSubtitle: { fontSize: "15px", color: "rgba(60, 60, 67, 0.75)", margin: "6px 0 0 0", letterSpacing: "-0.01em" }, // Reduced font size
    headerRight: { display: "flex", alignItems: "center", gap: "16px" }, // Reduced gap

    searchBar: { display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderRadius: "16px", background: "rgba(255, 255, 255, 0.8)", border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.15)`, minWidth: "280px", backdropFilter: "blur(20px)" }, // Reduced padding/radius/width
    searchInput: { border: "none", background: "transparent", fontSize: "15px", color: "#1D1D1F", width: "100%", outline: "none", letterSpacing: "-0.01em", '&::placeholder': { color: "rgba(60, 60, 67, 0.4)" } }, // Reduced font size

    notificationBadge: { ...liquidGlassBase, padding: "12px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.8)", cursor: "pointer", transition: "all 0.3s ease", boxShadow: "0 6px 15px rgba(0, 0, 0, 0.05)", border: '1px solid rgba(255, 255, 255, 0.9)', }, // Reduced padding/radius
    notificationIcon: { position: "relative", display: "flex", alignItems: "center", justifyContent: "center" },
    notificationDot: { position: "absolute", top: "0px", right: "0px", width: "8px", height: "8px", borderRadius: "50%", background: "#FF3B30", border: "1.5px solid white", boxShadow: "0 2px 8px rgba(255, 59, 48, 0.3)" }, // Reduced size

    dateBadge: {
      background: `linear-gradient(135deg, rgba(${hexToRgb(BRAND_BLUE)}, 0.15), rgba(${hexToRgb(ACCENT_COLOR)}, 0.1))`,
      padding: "12px 18px", borderRadius: "16px", fontSize: "14px", color: BRAND_BLUE, display: "flex", alignItems: "center", gap: "10px", // Reduced padding/font size/radius
      fontWeight: "700", border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.25)`, letterSpacing: "-0.01em", backdropFilter: "blur(20px)"
    },

    statsGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "1.5rem" }, // Reduced gap

    liquidCard: {
      ...liquidGlassBase,
      padding: "2px", borderRadius: "20px", background: "linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.7))", 
      transition: "transform 0.3s ease, box-shadow 0.3s ease",
      '&:hover': { transform: "translateY(-4px)", boxShadow: "0 20px 50px rgba(0, 0, 0, 0.15)" } // Reduced shift
    },
    liquidCardInner: { background: "rgba(255, 255, 255, 0.7)", backdropFilter: "blur(30px)", borderRadius: "18px", padding: "20px" }, // Reduced padding/radius

    card: {
      ...liquidGlassBase,
      padding: "24px", borderRadius: "20px", transition: "transform 0.3s ease, box-shadow 0.3s ease", // Reduced padding/radius
      '&:hover': { transform: "translateY(-4px)", boxShadow: "0 20px 50px rgba(0, 0, 0, 0.15)" }
    },
    cardLarge: { ...liquidGlassBase, padding: "24px", minHeight: "350px", borderRadius: "20px" }, // Reduced padding/radius/height

    cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }, // Reduced margin
    cardTitle: { fontWeight: "700", fontSize: "20px", margin: 0, color: "#1D1D1F", letterSpacing: "-0.02em" }, // Reduced font size

    cardIcon: {
      width: "56px", height: "56px", borderRadius: "16px", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", // Reduced size
      background: "rgba(255, 255, 255, 0.8)", boxShadow: "0 8px 20px rgba(0, 0, 0, 0.08)", backdropFilter: "blur(20px)",
      border: "1px solid rgba(0, 0, 0, 0.05)"
    },

    valueRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px" }, // Reduced margin
    changeBadge: { fontSize: "13px", padding: "6px 12px", borderRadius: "16px", fontWeight: "700", display: "flex", alignItems: "center", gap: "4px", letterSpacing: "-0.01em", backdropFilter: "blur(20px)" }, // Reduced size
    badge: { fontSize: "13px", padding: "8px 16px", borderRadius: "16px", background: `linear-gradient(135deg, rgba(${hexToRgb(BRAND_BLUE)}, 0.15), rgba(${hexToRgb(ACCENT_COLOR)}, 0.1))`, color: BRAND_BLUE, fontWeight: "700", border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.25)`, letterSpacing: "-0.01em", backdropFilter: "blur(20px)" }, // Reduced size

    mainGrid: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px", marginBottom: "1.5rem" }, // Reduced gap
    grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "20px" }, // Reduced minmax
    muted: { fontSize: "14px", color: "rgba(60, 60, 67, 0.65)", margin: "6px 0", letterSpacing: "-0.01em" }, // Reduced font size
    
    selectContainer: { position: "relative" },
    select: {
      padding: "10px 16px 10px 40px", borderRadius: "14px", border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.25)`, background: "rgba(255, 255, 255, 0.85)",
      fontSize: "14px", color: "#1D1D1F", outline: "none", fontWeight: "600", letterSpacing: "-0.01em", backdropFilter: "blur(20px)", appearance: "none",
      backgroundImage: `url("data:image/svg+xml,%3Csvg width='14' height='9' viewBox='0 0 14 9' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L7 7.5L13 1.5' stroke='%23005A8B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat", backgroundPosition: "16px center",
      '&:focus': { borderColor: BRAND_BLUE, boxShadow: `0 0 0 3px rgba(${hexToRgb(BRAND_BLUE)}, 0.15)` }
    },
    
    chartGrid: { display: "flex", alignItems: "flex-end", gap: "16px", height: "220px", padding: "0 16px 30px 0", borderBottom: "1px solid rgba(0, 0, 0, 0.08)" }, // Reduced size/padding
    chartBarContainer: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" },
    chartBar: { width: "24px", borderRadius: "12px 12px 0 0", transition: "height 0.5s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: `0 8px 20px rgba(${hexToRgb(BRAND_BLUE)}, 0.25)`, position: "relative", overflow: "hidden" }, // Reduced size
    chartLabel: { fontSize: "12px", color: "rgba(60, 60, 67, 0.65)", marginTop: "12px", fontWeight: "600", letterSpacing: "0.02em" }, // Reduced font size
    chartLegend: { display: "flex", gap: "24px", marginTop: "20px" }, // Reduced gap
    legendItem: { display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#1D1D1F", fontWeight: "600" }, // Reduced size
    legendColor: { width: "14px", height: "14px", borderRadius: "4px", boxShadow: "0 3px 10px rgba(0, 0, 0, 0.1)" }, // Reduced size

    // Quick Actions
    primaryBtn: {
      ...liquidGlassBase, background: `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_TEAL})`, color: "#FFFFFF", cursor: "pointer", width: "100%", 
      marginTop: "16px", padding: "16px", borderRadius: "16px", border: 'none', fontSize: "15px", fontWeight: "700", display: "flex", 
      alignItems: "center", justifyContent: "center", gap: "12px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", letterSpacing: "-0.01em",
      boxShadow: `0 10px 30px rgba(${hexToRgb(BRAND_BLUE)}, 0.35)`, position: "relative", overflow: "hidden",
      '&:hover': { transform: "translateY(-3px)", boxShadow: `0 20px 40px rgba(${hexToRgb(BRAND_BLUE)}, 0.45)` }
    },
    secondaryBtn: {
      ...liquidGlassBase, background: "rgba(255, 255, 255, 0.7)", border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.2)`, color: BRAND_BLUE, 
      marginTop: "12px", padding: "14px", borderRadius: "16px", fontSize: "15px", fontWeight: "700", display: "flex", alignItems: "center", 
      justifyContent: "center", gap: "12px", transition: "all 0.3s ease", letterSpacing: "-0.01em",
      '&:hover': { background: `rgba(${hexToRgb(BRAND_BLUE)}, 0.1)`, borderColor: `rgba(${hexToRgb(BRAND_BLUE)}, 0.4)`, transform: "translateY(-2px)", boxShadow: `0 8px 20px rgba(${hexToRgb(BRAND_BLUE)}, 0.15)` }
    },

    // Doctor List
    doctorRow: {
      ...liquidGlassBase, background: "rgba(250, 250, 252, 0.7)", padding: "14px", borderRadius: "16px", display: "flex", gap: "14px", alignItems: "center", marginTop: "12px", // Reduced padding/margin
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 6px 15px rgba(0, 0, 0, 0.05)",
      '&:hover': { background: "rgba(255, 255, 255, 0.9)", transform: "translateX(8px)", boxShadow: "0 15px 40px rgba(0, 0, 0, 0.1)" }
    },
    avatar: { width: "48px", height: "48px", borderRadius: "14px", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", boxShadow: "0 8px 20px rgba(0, 0, 0, 0.15)" }, // Reduced size
    doctorInfo: { flex: 1 },
    name: { fontWeight: "700", margin: 0, fontSize: "16px", color: "#1D1D1F", letterSpacing: "-0.01em" }, // Reduced size
    statusBadge: { fontSize: "12px", padding: "6px 14px", borderRadius: "16px", fontWeight: "700", letterSpacing: "0.02em", backdropFilter: "blur(20px)" }, // Reduced size
    viewAllBtn: { marginTop: "20px", padding: "12px", borderRadius: "14px", border: `1px solid rgba(${hexToRgb(BRAND_BLUE)}, 0.25)`, background: "transparent", color: BRAND_BLUE, cursor: "pointer", width: "100%", fontSize: "14px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", transition: "all 0.3s ease", '&:hover': { background: `rgba(${hexToRgb(BRAND_BLUE)}, 0.1)`, borderColor: `rgba(${hexToRgb(BRAND_BLUE)}, 0.4)` } }, // Reduced size
    
    // Activity
    liveBadge: { fontSize: "13px", padding: "6px 14px", borderRadius: "16px", background: "linear-gradient(135deg, rgba(255, 59, 48, 0.18), rgba(255, 149, 0, 0.1))", color: "#FF3B30", fontWeight: "700", border: "1px solid rgba(255, 59, 48, 0.25)", display: "flex", alignItems: "center", gap: "6px", letterSpacing: "0.02em", backdropFilter: "blur(20px)" }, // Reduced size
    liveDot: { width: "7px", height: "7px", borderRadius: "50%", background: "#FF3B30", animation: "pulse 2s infinite" }, // Reduced size
    activityRow: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", marginTop: "20px", marginBottom: "24px" }, // Reduced gap
    activityCard: { ...liquidGlassBase, background: "rgba(250, 250, 252, 0.7)", padding: "16px", borderRadius: "18px", display: "flex", alignItems: "center", gap: "16px", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", border: '1px solid rgba(255, 255, 255, 0.9)', '&:hover': { background: "rgba(255, 255, 255, 0.9)", transform: "translateY(-3px)", boxShadow: "0 15px 40px rgba(0, 0, 0, 0.1)" } }, // Reduced padding/radius
    activityCardIcon: { width: "48px", height: "48px", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255, 255, 255, 0.9)", boxShadow: "0 6px 15px rgba(0, 0, 0, 0.08)" }, // Reduced size
    
    recentActivity: { marginTop: "24px" },
    activityItem: {
      ...liquidGlassBase, background: "rgba(250, 250, 252, 0.7)", padding: "14px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "14px", marginBottom: "10px", // Reduced padding/margin/radius
      transition: "all 0.3s ease", boxShadow: "0 6px 15px rgba(0, 0, 0, 0.05)",
      '&:hover': { background: "rgba(255, 255, 255, 0.9)", transform: "translateX(8px)", boxShadow: "0 15px 40px rgba(0, 0, 0, 0.1)" }
    },
    activityIcon: { width: "36px", height: "36px", borderRadius: "12px", background: "rgba(255, 255, 255, 0.9)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(0, 0, 0, 0.05)", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.06)" }, // Reduced size
    activityContent: { flex: 1 },
    activityText: { fontSize: "14px", color: "#1D1D1F", fontWeight: "600", marginBottom: "4px", letterSpacing: "-0.01em" }, // Reduced size
    activityTime: { fontSize: "12px", color: "rgba(60, 60, 67, 0.5)", fontWeight: "500" } // Reduced size
  };
  
  return dashboardStyles;
};

// Add CSS animation and global font imports
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  /* Atkinson Hyperlegible Font Stack Simulation */
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  
  @keyframes subtleMove {
    0% { transform: translate(0, 0); }
    100% { transform: translate(40px, -40px); } /* Reduced shift */
  }

  @keyframes pulse {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.1); } /* Reduced scale */
    100% { opacity: 1; transform: scale(1); }
  }
  
  /* Reset and Transitions */
  * {
    transition: background-color 0.3s ease, border-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
  }
`;
document.head.appendChild(styleSheet);

export default HospitalDashboard;