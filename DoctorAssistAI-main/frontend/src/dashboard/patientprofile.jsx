import React, { useState } from "react";
import { 
  User, 
  FileText, 
  Activity, 
  PieChart, 
  AlertTriangle, 
  Pill,
  ChevronRight,
  Stethoscope
} from "lucide-react";
import PatientDemographics from './PatientDemographics';
import ActiveMed from './Activemedication';
import Cds from './cds.jsx';
import PatternAnalysis from './PatternAnalysis.jsx'; // Adjust path as needed
export default function Canvas() {
  const [items, setItems] = useState([]);
  const [activeMenu, setActiveMenu] = useState("Patient Data");

  const onDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("nodeType");
    if (!type) return;

    setItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        type,
        x: e.clientX,
        y: e.clientY,
      },
    ]);
  };

  const onDragOver = (e) => e.preventDefault();

  const removeItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const menuItems = [
    { id: "patient", label: "Patient Data", icon: <User size={20} /> },
    { id: "retrieval", label: "Data Retrieval", icon: <FileText size={20} /> },
    { id: "cds", label: "Clinical Decision Support", icon: <Activity size={20} /> },
    { id: "analysis", label: "Pattern Analysis", icon: <PieChart size={20} /> },
    { id: "risk", label: "Risk Score", icon: <AlertTriangle size={20} /> },
    { id: "meds", label: "Active Medications", icon: <Pill size={20} /> },
  ];

  return (
    <div style={styles.container}>
      {/* Left Side Glass Menu */}
      <div style={styles.sidebar}>
        {/* Profile Section */}
        <div style={styles.profileSection}>
          <div style={styles.profileImage}>
            <User size={48} color="#ffffff" />
          </div>
          <div style={styles.profileInfo}>
            <h3 style={styles.profileName}>Dr. Alex Morgan</h3>
            <p style={styles.profileRole}>Senior Physician</p>
          </div>
        </div>

        {/* Dashboard Title */}
        <div style={styles.dashboardHeader}>
          <div style={styles.headerIcon}>
            <Stethoscope size={22} color="#3a8ffe" />
          </div>
          <div style={styles.headerText}>
            <p style={styles.headerSubtitle}>Clinical Intelligence</p>
            <h2 style={styles.headerTitle}>Dashboard</h2>
          </div>
        </div>

        {/* Menu Items */}
        <div style={styles.menuList}>
          {menuItems.map((item) => (
            <div
              key={item.id}
              style={{
                ...styles.menuItem,
                ...(activeMenu === item.label ? styles.activeMenuItem : {}),
              }}
              onClick={() => setActiveMenu(item.label)}
            >
              <div style={styles.menuIcon}>{item.icon}</div>
              <span style={styles.menuLabel}>{item.label}</span>
              <ChevronRight 
                size={18} 
                style={styles.chevron}
                color={activeMenu === item.label ? "#3a8ffe" : "#888"}
              />
            </div>
          ))}
        </div>

        {/* Status Indicator */}
        <div style={styles.statusBar}>
          <div style={styles.statusDot} />
          <span style={styles.statusText}>System Active</span>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={styles.canvas} onDrop={onDrop} onDragOver={onDragOver}>
        {/* Background Blobs */}
        <div style={styles.blueShape1} />
        <div style={styles.blueShape2} />

        {/* Full-cover Grid */}
        {/* Full-cover Grid */}
<div style={styles.gridContainer}>
  <div style={styles.glassCard}>
 {activeMenu === "Patient Data" ? (
  <div style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(500px, 1fr))",
    gap: "24px",
    justifyItems: "center",  // centers items horizontally in their grid cell
    alignItems: "start",     // align top edges
  }}>
    <PatientDemographics />
    <ActiveMed />
    <Cds />
    <PatternAnalysis/>
  </div>
) : (
  <div style={styles.canvasHeader}>
    <h1 style={styles.canvasTitle}>Clinical Workflow Canvas</h1>
    <p style={styles.canvasSubtitle}>
      Drag and drop clinical modules to build patient care pathways
    </p>
  </div>
)}

  </div>
</div>


        {/* Dropped Nodes */}
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              ...styles.node,
              left: item.x - 80,
              top: item.y - 40,
            }}
          >
            <span>{item.type}</span>
            <button
              style={styles.removeBtn}
              onClick={() => removeItem(item.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==================== STYLES ==================== */

const styles = {
   container: {
    display: "flex",
    minHeight: "100vh",
    width: "100%",
    fontFamily: "'SF Pro Display', 'Segoe UI', 'Roboto', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#222", // soft text color
  },

  /* ===== SIDEBAR STYLES ===== */
   sidebar: {
    width: "280px",
    minHeight: "100vh",
    padding: "24px 16px",
    background: "rgba(255, 255, 255, 0.12)", // softer glass
    backdropFilter: "blur(22px) saturate(180%)",
    WebkitBackdropFilter: "blur(22px) saturate(180%)",
    borderRight: "1px solid rgba(255, 255, 255, 0.15)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    zIndex: 30,
  },

  /* Profile Section */
  profileSection: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "32px",
    paddingBottom: "24px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
  },

  profileImage: {
    width: "64px",
    height: "64px",
    borderRadius: "50%",
    background: "rgba(74, 111, 255, 0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  profileName: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 400,
    color: "#111",
  },

  profileRole: {
    margin: "4px 0 0 0",
    fontSize: "12px",
    color: "#555",
    fontWeight: 400,
  },

  dashboardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "32px",
    padding: "16px",
    background: "rgba(255, 255, 255, 0.15)",
    borderRadius: "16px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
  },

  headerText: {
    flex: 1,
  },
    headerSubtitle: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 400,
    color: "#3a8ffe",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  headerTitle: {
    margin: "4px 0 0 0",
    fontSize: "18px",
    fontWeight: 400,
    color: "#222",
    letterSpacing: "-0.3px",
  },

  menuList: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },

  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 14px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontWeight: 400,
    color: "#222",
    fontSize: "14px",
  },

  activeMenuItem: {
    background: "rgba(58, 143, 254, 0.08)",
    border: "1px solid rgba(58, 143, 254, 0.2)",
    boxShadow: "0 2px 8px rgba(58, 143, 254, 0.1)",
  },

  menuIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.8,
  },

  chevron: {
    opacity: 0.5,
  },

  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    marginTop: "20px",
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
    fontSize: "12px",
    color: "#555",
    fontWeight: 400,
  },

  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#4ade80",
  },

  /* Canvas styles */
  canvas: {
    position: "relative",
    flex: 1,
    minHeight: "100vh",
    overflowY: "auto",
    overflowX: "hidden",
    padding: "40px 20px",
    fontWeight: 400,
    color: "#222",
  },

  /* ===== CANVAS STYLES ===== */
canvas: {
  position: "relative",
  flex: 1,
  minHeight: "100vh",
  overflowY: "auto", // ✅ allow vertical scroll
  overflowX: "hidden",
  padding: "40px 20px",
}
,

  /* Background Blobs */
  blueShape1: {
    position: "fixed",
    top: "30%",
    left: "5%",
    width: "700px",
    height: "700px",
    background: "linear-gradient(135deg, #9fccf3ff, #7fb7e8ff )",
    borderRadius: "50%",
    opacity: 0.2,
    filter: "blur(60px)",
    zIndex: 0,
  },

  blueShape2: {
    position: "fixed",
    bottom: "50%",
    right: "5%",
    width: "500px",
    height: "500px",
    background: "linear-gradient(135deg, #667eea, #75ec98ff)",
    borderRadius: "50%",
    opacity: 0.2,
    filter: "blur(100px)",
    zIndex: 0,
  },

  /* Full Background Grid */
 gridContainer: {
  position: "relative", // ✅ change from absolute
  width: "100%",
  minHeight: "100%",
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  paddingBottom: "40px",
}
,

  /* Glass Card */
  glassCard: {
    width: "95%",
   minHeight: "95vh",
    padding: "28px",
    borderRadius: "26px",
    background: "rgba(255, 255, 255, 0.20)",
    backdropFilter: "blur(34px) saturate(220%)",
    WebkitBackdropFilter: "blur(34px) saturate(220%)",
    border: "1px solid rgba(255, 255, 255, 0.9)",
    boxShadow:
      "0 40px 80px rgba(0, 80, 200, 0.18), " +
      "inset 0 1px 0 rgba(255, 255, 255, 0.95), " +
      "inset 0 -1px 0 rgba(255, 255, 255, 0.45)",
    color: "#111",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
      alignItems: "stretch", 
  },

  /* Canvas Header */
  canvasHeader: {
    textAlign: "center",
    padding: "40px 20px",
    maxWidth: "800px",
  },

  canvasTitle: {
    fontSize: "48px",
    fontWeight: 800,
    color: "#111",
    margin: 0,
    letterSpacing: "-1.5px",
    lineHeight: "1.1",
    background: "linear-gradient(135deg, #3a8ffe, #667eea)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },

  canvasSubtitle: {
    fontSize: "18px",
    fontWeight: 400,
    color: "#666",
    margin: "16px 0 0 0",
    lineHeight: "1.5",
    maxWidth: "600px",
  },

  /* Dropped Nodes (Glass) */
  node: {
    position: "absolute",
    minWidth: "160px",
    padding: "14px 18px",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.35)",
    backdropFilter: "blur(30px) saturate(200%)",
    WebkitBackdropFilter: "blur(30px) saturate(200%)",
    border: "1px solid rgba(255, 255, 255, 0.85)",
    boxShadow:
      "0 20px 40px rgba(0, 80, 200, 0.14), " +
      "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "move",
    zIndex: 20,
  },

  removeBtn: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    border: "1px solid rgba(255, 255, 255, 0.8)",
    background: "rgba(255, 255, 255, 0.6)",
    cursor: "pointer",
    fontWeight: "bold",
  },
contentStack: {
  width: "100%",
  display: "flex",
  flexDirection: "row", // ← horizontal now
  gap: "24px",           // space between the two components
  alignItems: "flex-start", // optional: align top edges
},

};