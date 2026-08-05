import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, Terminal, CheckCircle, Home, UserPlus, Users,
  Calendar, LogOut, Clipboard, BarChart3, Settings,
  Bell, Search, FileText, User, ChevronRight, Clock
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  accent: "#000000",
};

const SIDEBAR_WIDTH = "248px";

const S = {
  layout: {
    display: "flex",
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    minHeight: "100vh",
    position: "fixed",
    left: 0,
    top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
  },
  sidebarHeader: {
    padding: "1.5rem 1.5rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "0.5rem",
  },
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },
  brandSub: {
    fontSize: "0.68rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
  },
  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.75rem 1.25rem 0.25rem",
    display: "block",
  },
  navBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "0.55rem 1.25rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    transition: "all 0.15s",
    fontFamily: "'Open Sans', sans-serif",
    borderLeft: "2px solid transparent",
  },
  navBtnActive: {
    background: T.bgAlt,
    color: T.text,
    fontWeight: 400,
    borderLeft: `2px solid ${T.accent}`,
  },
  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },
  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  logoutBtn: {
    width: "100%",
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.6rem 1rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.2s",
  },
  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    position: "sticky",
    top: 0,
    background: T.bg,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
    gap: "12px",
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },
  topBarSub: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
    fontWeight: 300,
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0.45rem 0.875rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    maxWidth: "260px",
    flex: 1,
  },
  searchInput: {
    border: "none",
    background: "transparent",
    outline: "none",
    flex: 1,
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    minWidth: 0,
  },
  dateBadge: {
    fontSize: "0.72rem",
    color: T.textMuted,
    fontWeight: 300,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "0.45rem 0.75rem",
    border: `1px solid ${T.border}`,
  },
  body: {
    padding: "2rem",
    flex: 1,
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
    marginBottom: "1.5rem",
  },
  formContainer: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    marginBottom: "2rem",
  },
  formInner: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    padding: "2rem",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  label: {
    fontSize: "0.68rem",
    fontWeight: 600,
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  uploadArea: {
    border: `2px dashed ${T.border}`,
    borderRadius: "2px",
    padding: "3rem 2rem",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.15s",
    background: T.bgAlt,
    marginBottom: "1rem",
  },
  uploadAreaDragging: {
    borderColor: T.text,
    background: T.bgTert,
    transform: "scale(1.02)",
  },
  uploadIcon: {
    marginBottom: "1rem",
    color: T.textMuted,
  },
  uploadText: {
    fontSize: "0.85rem",
    color: T.textSec,
    marginBottom: "0.25rem",
  },
  uploadSubtext: {
    fontSize: "0.72rem",
    color: T.textMuted,
  },
  submitBtn: {
    width: "100%",
    padding: "0.85rem",
    backgroundColor: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.8rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderRadius: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  },
  terminal: {
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    borderRadius: "2px",
    overflow: "hidden",
  },
  terminalHeader: {
    padding: "0.75rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bg,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  terminalTitle: {
    fontSize: "0.72rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    margin: 0,
  },
  terminalContent: {
    padding: "1rem",
    fontFamily: "'Courier New', monospace",
    fontSize: "0.72rem",
    color: T.textSec,
    maxHeight: "400px",
    overflowY: "auto",
    lineHeight: 1.5,
  },
  terminalLog: {
    marginBottom: "0.25rem",
  },
  terminalLogError: {
    color: "#cc3333",
  },
  terminalLogSuccess: {
    color: "#226644",
  },
  terminalCursor: {
    display: "inline-block",
    width: "6px",
    height: "12px",
    backgroundColor: T.text,
    animation: "blink 1s infinite",
    marginLeft: "4px",
  },
  infoBox: {
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    padding: "1rem 1.25rem",
    marginBottom: "1rem",
    borderRadius: "2px",
  },
  infoBoxTitle: {
    fontSize: "0.68rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    marginBottom: "0.5rem",
  },
  infoBoxText: {
    fontSize: "0.75rem",
    color: T.textSec,
    lineHeight: 1.6,
    margin: 0,
  },
};

function DoctorUploadWithTimings() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const hospitalId = searchParams.get("hospital_id");
  const [terminalLogs, setTerminalLogs] = useState([
    '> System initialized...',
    '> Ready to process doctor records with timings',
  ]);
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef(null);
  const terminalRef = useRef(null);

  const addLog = (message) => {
    setTerminalLogs((prev) => [...prev, `> ${message}`]);
    setTimeout(() => {
      terminalRef.current?.scrollTo({
        top: terminalRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }, 100);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setSelectedFile(file);
      addLog(`File selected: ${file.name}`);
    } else {
      addLog('ERROR: Invalid file type. Please upload .xlsx or .xls files only.');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      addLog(`File selected: ${file.name}`);
    }
  };

  const handleUpload = async () => {
    if (!hospitalId) {
      addLog("ERROR: Hospital ID missing in URL");
      return;
    }
    if (!selectedFile) {
      addLog('ERROR: No file selected');
      return;
    }

    setIsProcessing(true);
    addLog('Uploading file to server...');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(
        `${API_BASE_URL}hms/users/data/system/upload_doctors_excel_with_timings?hospital_id=${hospitalId}`,
        {
          method: 'POST',
          body: formData,
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();

      addLog(`✓ Received ${result.all_data?.length ?? 0} records from backend`);
      addLog('✓ Upload with timings completed successfully!');
      addLog('-------------------------------------');

      result.all_data?.forEach((doctor, index) => {
        const info = Object.entries(doctor)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        addLog(`Record ${index + 1}: ${info}`);
      });

      addLog('-------------------------------------');
    } catch (error) {
      addLog(`✗ ERROR: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" }
      });
      if (response.ok) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleAddDoctor = () => { if (!hospitalId) return; navigate(`/register-doctor?hospital_id=${hospitalId}`); };
  const handleAddNurse = () => { if (!hospitalId) return; navigate(`/nurse-register?hospital_id=${hospitalId}`); };
  const handleHospitalStaff = () => { if (!hospitalId) return; navigate(`/hospital-admin-staff?hospital_id=${hospitalId}`); };
  const handleAddExcel = () => { if (!hospitalId) return; navigate(`/upload-excel?hospital_id=${hospitalId}`); };
  const handleAddExcelWithTimings = () => { if (!hospitalId) return; navigate(`/upload-excel-timings?hospital_id=${hospitalId}`); };
  const handleDashboard = () => { if (!hospitalId) return; navigate(`/hospital-dashboard?hospital_id=${hospitalId}`); };

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: handleDashboard },
        { label: "Patients", icon: <Users size={14} />, action: () => {} },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, action: handleAddDoctor },
        { label: "Add Nurse", icon: <UserPlus size={14} />, action: handleAddNurse },
        { label: "Add Doctor via Excel", icon: <FileText size={14} />, action: handleAddExcel },
        { label: "Add Doctor via Excel + Timings", icon: <Clock size={14} />, action: handleAddExcelWithTimings, active: true },
        { label: "Manage Staff", icon: <UserPlus size={14} />, action: handleHospitalStaff },
      ],
    },
  ];

  return (
    <div style={S.layout}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
          * { box-sizing: border-box; }
          .h-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
          .h-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
          .h-submit-btn:hover:not(:disabled) { background: transparent !important; color: ${T.text} !important; }
          .h-menu-scroll::-webkit-scrollbar { display: none; }
          .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
          @keyframes spin { to { transform: rotate(360deg); } }
          .animate-spin { animation: spin 1s linear infinite; }
        `}
      </style>

      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <div>
              <p style={S.brandName}>DoctorAssist</p>
              <p style={S.brandSub}>Hospital Admin</p>
            </div>
          </div>
        </div>
        <div className="h-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => (
                <button
                  key={ii}
                  className="h-nav-btn"
                  style={{ ...S.navBtn, ...(item.active ? S.navBtnActive : {}) }}
                  onClick={item.action}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div style={S.sidebarFooter}>
          <button className="h-logout" style={S.logoutBtn} onClick={handleLogout}>
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>Doctor Records Upload — With Timings</p>
            <p style={S.topBarSub}>Upload Excel files including doctor schedule timings</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={S.searchWrap}>
              <Search size={13} color={T.textMuted} />
              <input type="text" placeholder="Search..." style={S.searchInput} />
            </div>
            <Bell size={16} color={T.textMuted} style={{ cursor: "pointer", flexShrink: 0 }} />
            <div style={S.dateBadge}>
              <Calendar size={12} color={T.textMuted} />
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        <div style={S.body}>
          <span style={S.pageLabel}>Data Management</span>
          <h1 style={S.pageTitle}>Bulk Doctor Upload with Timings</h1>

          <div style={S.infoBox}>
            <p style={S.infoBoxTitle}>About this upload</p>
            <p style={S.infoBoxText}>
              This page processes Excel files that include doctor availability timings alongside
              standard doctor details. Ensure your spreadsheet contains columns for schedule
              start time, end time, and available days in addition to the usual doctor fields.
            </p>
          </div>

          <div style={S.formContainer}>
            <div style={S.formInner}>
              <div style={S.grid2}>
                {/* Upload Panel */}
                <div>
                  <div style={S.field}>
                    <label style={S.label}>Excel File (with Timings)</label>
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        ...S.uploadArea,
                        ...(isDragging ? S.uploadAreaDragging : {}),
                      }}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileSelect}
                        style={{ display: "none" }}
                      />
                      <div style={S.uploadIcon}>
                        <FileSpreadsheet size={32} />
                      </div>
                      <p style={S.uploadText}>
                        {isDragging ? "Drop file here" : "Drop Excel file here"}
                      </p>
                      <p style={S.uploadSubtext}>or click to browse · .xlsx / .xls only</p>
                      {selectedFile && (
                        <p style={{ ...S.uploadSubtext, marginTop: "8px", color: T.text }}>
                          Selected: {selectedFile.name}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile || isProcessing}
                    className="h-submit-btn"
                    style={{
                      ...S.submitBtn,
                      ...(!selectedFile || isProcessing ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                    }}
                  >
                    {isProcessing ? (
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <svg
                          className="animate-spin"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeLinecap="round" />
                        </svg>
                        Processing...
                      </span>
                    ) : (
                      <>
                        <Clock size={14} />
                        Upload with Timings
                        <ChevronRight size={14} />
                      </>
                    )}
                  </button>
                </div>

                {/* Terminal Panel */}
                <div style={S.terminal}>
                  <div style={S.terminalHeader}>
                    <Terminal size={14} color={T.textMuted} />
                    <h3 style={S.terminalTitle}>Processing Log</h3>
                  </div>
                  <div ref={terminalRef} style={S.terminalContent}>
                    {terminalLogs.map((log, i) => {
                      let logStyle = S.terminalLog;
                      if (log.includes('ERROR') || log.includes('✗')) {
                        logStyle = { ...logStyle, ...S.terminalLogError };
                      } else if (log.includes('✓')) {
                        logStyle = { ...logStyle, ...S.terminalLogSuccess };
                      }
                      return (
                        <div key={i} style={logStyle}>
                          {log}
                        </div>
                      );
                    })}
                    <div style={S.terminalCursor} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default DoctorUploadWithTimings;