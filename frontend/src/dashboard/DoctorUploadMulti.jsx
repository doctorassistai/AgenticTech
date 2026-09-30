import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileSpreadsheet, Home, UserPlus, Users, Calendar, LogOut,
  FileText, Bell, Search, ChevronRight, X, CheckCircle2, Clock, AlertCircle
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching other components) ─── */
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

/* ─── STYLES (matching other components) ─── */
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

  singleCol: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "1.5rem",
    width: "100%",
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
    padding: "5rem 2rem",
    minHeight: "320px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.15s",
    background: T.bgAlt,
  },

  uploadAreaDragging: {
    borderColor: T.text,
    background: T.bgTert,
    transform: "scale(1.02)",
  },

  uploadIcon: {
    marginBottom: "1.25rem",
    color: T.textMuted,
  },

  uploadText: {
    fontSize: "1rem",
    color: T.textSec,
    marginBottom: "0.4rem",
  },

  uploadSubtext: {
    fontSize: "0.8rem",
    color: T.textMuted,
  },

  fileList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    marginTop: "1rem",
    maxHeight: "220px",
    overflowY: "auto",
  },

  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "0.6rem 0.75rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
  },

  fileRowInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  fileRowName: {
    fontSize: "0.78rem",
    color: T.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  fileRowMeta: {
    fontSize: "0.65rem",
    color: T.textMuted,
    marginTop: "1px",
  },

  fileRemoveBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: T.textMuted,
    display: "flex",
    alignItems: "center",
    padding: "4px",
    flexShrink: 0,
  },

  statusPill: {
    fontSize: "0.62rem",
    padding: "2px 8px",
    border: `1px solid ${T.border}`,
    color: T.textMuted,
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
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

  submitBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
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
    maxHeight: "460px",
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

  summaryRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "1px",
    background: T.border,
    border: `1px solid ${T.border}`,
    marginBottom: "1.5rem",
  },

  summaryCell: {
    background: T.bg,
    padding: "1rem 1.25rem",
  },

  summaryNum: {
    fontSize: "1.3rem",
    fontWeight: 300,
    color: T.text,
  },

  summaryLabel: {
    fontSize: "0.65rem",
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginTop: "2px",
  },
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_ICON = {
  queued: <Clock size={11} />,
  processed: <CheckCircle2 size={11} />,
  error: <AlertCircle size={11} />,
};

function DoctorUploadMulti() {
  const [searchParams] = useSearchParams();
  const hospitalId = searchParams.get("hospital_id");

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]); // { id, file, status: 'queued'|'processed'|'error', error? }
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSummary, setUploadSummary] = useState(null); // { total_uploaded, total_errors }
  const [uploadError, setUploadError] = useState(null); // top-level request failure

  const fileInputRef = useRef(null);

  const addFiles = (fileListLike) => {
    const incoming = Array.from(fileListLike).filter(
      (f) => f.name.toLowerCase().endsWith('.xlsx') || f.name.toLowerCase().endsWith('.xls') || f.name.toLowerCase().endsWith('.csv')
    );

    if (incoming.length) {
      const withIds = incoming.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: 'queued',
      }));
      setFiles((prev) => [...prev, ...withIds]);
    }
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
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = '';
  };

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
    setUploadSummary(null);
    setUploadError(null);
  };

  // ── REAL BACKEND CALL — hms/users/speciality/insurance/upload ──
  const handleUpload = async () => {
    if (!files.length) return;

    if (!hospitalId) {
      setUploadError("Hospital ID missing in URL");
      return;
    }

    setIsProcessing(true);
    setUploadError(null);
    setUploadSummary(null);

    try {
      const formData = new FormData();
      formData.append('hospital_id', hospitalId);
      files.forEach((entry) => {
        formData.append('files', entry.file);
      });

      const response = await fetch(
        `${API_BASE_URL}hms/users/speciality/insurance/upload`,
        {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }

      const result = await response.json();

      const successNames = new Set((result.uploaded_files || []).map((f) => f.filename));
      const errorNames = new Set((result.errors || []).map((e) => e.filename));
      const errorMap = {};
      (result.errors || []).forEach((e) => {
        errorMap[e.filename] = e.error;
      });

      setFiles((prev) =>
        prev.map((entry) => {
          if (successNames.has(entry.file.name)) {
            return { ...entry, status: 'processed' };
          }
          if (errorNames.has(entry.file.name)) {
            return { ...entry, status: 'error', error: errorMap[entry.file.name] };
          }
          return entry;
        })
      );

      setUploadSummary({
        total_uploaded: result.total_uploaded ?? successNames.size,
        total_errors: result.total_errors ?? errorNames.size,
      });
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
      setFiles((prev) => prev.map((entry) => ({ ...entry, status: 'error' })));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogout = () => {};

  const navSections = [
    {
      label: "Overview",
      items: [
        { label: "Dashboard", icon: <Home size={14} />, action: () => {} },
        { label: "Patients", icon: <Users size={14} />, action: () => {} },
      ],
    },
    {
      label: "Management",
      items: [
        { label: "Add Doctor", icon: <UserPlus size={14} />, action: () => {} },
        { label: "Add Nurse", icon: <UserPlus size={14} />, action: () => {} },
        { label: "Add Doctors via Excel", icon: <FileText size={14} />, action: () => {}, active: true },
        { label: "Manage Staff", icon: <UserPlus size={14} />, action: () => {} },
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
          .h-submit-btn:hover { background: transparent !important; color: ${T.text} !important; }
          .h-menu-scroll::-webkit-scrollbar { display: none; }
          .h-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          .h-file-remove:hover { color: ${T.text} !important; }

          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .animate-spin {
            animation: spin 1s linear infinite;
          }
        `}
      </style>

      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}>
            <div>
              <p style={S.brandName}>EMR Module</p>
              <p style={S.brandSub}>Hospital Admin — Demo</p>
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

      {/* Main Content */}
      <main style={S.main}>
        <div style={S.topBar}>
          <div>
            <p style={S.topBarTitle}>Insurance Records — Batch Upload</p>
            <p style={S.topBarSub}>Upload multiple Excel files to process insurance documents (demo)</p>
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
          <h1 style={S.pageTitle}>Insurance Document Upload (Multiple Files)</h1>

          <div style={S.formContainer}>
            <div style={S.formInner}>
              <div style={S.singleCol}>
                {/* Upload Panel */}
                <div>
                  <div style={S.field}>
                    <label style={S.label}>Insurance Files (.xlsx, .xls, .csv — multiple allowed)</label>
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
                        accept=".xlsx,.xls,.csv"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: "none" }}
                      />
                      <div style={S.uploadIcon}>
                        <FileSpreadsheet size={44} />
                      </div>
                      <p style={S.uploadText}>
                        {isDragging ? "Drop files here" : "Drop Excel files here"}
                      </p>
                      <p style={S.uploadSubtext}>or click to browse — multiple files supported</p>
                    </div>
                  </div>

                  {files.length > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
                        <label style={S.label}>Queue ({files.length})</label>
                        <button
                          onClick={clearAll}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: T.textMuted,
                            fontSize: "0.68rem",
                            cursor: "pointer",
                            textDecoration: "underline",
                            fontFamily: "'Open Sans', sans-serif",
                          }}
                        >
                          Clear all
                        </button>
                      </div>
                      <div style={S.fileList}>
                        {files.map((entry) => (
                          <div key={entry.id} style={S.fileRow} title={entry.error || ''}>
                            <FileSpreadsheet size={16} color={T.textMuted} style={{ flexShrink: 0 }} />
                            <div style={S.fileRowInfo}>
                              <span style={S.fileRowName}>{entry.file.name}</span>
                              <span style={S.fileRowMeta}>{formatBytes(entry.file.size)}</span>
                            </div>
                            <span
                              style={{
                                ...S.statusPill,
                                ...(entry.status === 'processed' ? { color: "#226644", borderColor: "#226644" } : {}),
                                ...(entry.status === 'error' ? { color: "#cc3333", borderColor: "#cc3333" } : {}),
                              }}
                            >
                              {STATUS_ICON[entry.status]}
                              {entry.status}
                            </span>
                            {!isProcessing && (
                              <button
                                className="h-file-remove"
                                style={S.fileRemoveBtn}
                                onClick={() => removeFile(entry.id)}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <button
                    onClick={handleUpload}
                    disabled={!files.length || isProcessing}
                    className="h-submit-btn"
                    style={{
                      ...S.submitBtn,
                      marginTop: "1.25rem",
                      ...(!files.length || isProcessing ? S.submitBtnDisabled : {}),
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
                        Processing Batch...
                      </span>
                    ) : (
                      <>
                        Upload and Process {files.length ? `(${files.length})` : ''}
                        <ChevronRight size={14} />
                      </>
                    )}
                  </button>

                  {uploadError && (
                    <p style={{ fontSize: "0.72rem", color: "#cc3333", marginTop: "0.75rem" }}>
                      ✗ {uploadError}
                    </p>
                  )}

                  {uploadSummary && !uploadError && (
                    <p style={{ fontSize: "0.72rem", color: T.textSec, marginTop: "0.75rem" }}>
                      {uploadSummary.total_uploaded} file(s) uploaded
                      {uploadSummary.total_errors > 0 ? `, ${uploadSummary.total_errors} failed` : ''}.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default DoctorUploadMulti;