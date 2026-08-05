import React, { useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, X, ArrowLeft } from "lucide-react";

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

export default function DoctorMasterUpload() {
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { status, rows, columns, ... }
  const [error, setError] = useState(null);

  /* ── helpers ── */
  const acceptedFile = (f) => {
    const ok = f && (
      f.name.endsWith(".xlsx") ||
      f.name.endsWith(".xls")
    );
    if (!ok) { setError("Only .xlsx or .xls files are accepted."); return false; }
    setError(null);
    return true;
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f && acceptedFile(f)) { setFile(f); setResult(null); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && acceptedFile(f)) { setFile(f); setResult(null); }
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!doctorId) { setError("Doctor ID is missing from the URL."); return; }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("doctor_id", doctorId);
      formData.append("file", file);

      const res = await fetch(
        `${API_BASE_URL}hms/users/speciality/upload_medication_master`,
        { method: "POST", body: formData, credentials: "include" }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || `Server error ${res.status}`);
      }

      setResult(data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  /* ── styles ── */
  const S = {
    page: {
      minHeight: "100vh",
      background: T.bg,
      fontFamily: "'Open Sans', sans-serif",
      fontWeight: 300,
      color: T.text,
      WebkitFontSmoothing: "antialiased",
    },
    topBar: {
      position: "sticky", top: 0,
      background: T.bg,
      borderBottom: `1px solid ${T.border}`,
      padding: "0.875rem 2rem",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      zIndex: 100,
    },
    backBtn: {
      background: "none", border: "none",
      cursor: "pointer", color: T.textSec,
      display: "flex", alignItems: "center", gap: "6px",
      fontSize: "0.78rem", padding: "4px 0",
      fontFamily: "'Open Sans', sans-serif",
    },
    sep: { color: T.border, fontSize: "1rem", userSelect: "none" },
    topTitle: { fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: 0 },

    body: { maxWidth: "720px", margin: "0 auto", padding: "2.5rem 2rem" },

    pageLabel: {
      fontSize: "0.6rem", textTransform: "uppercase",
      letterSpacing: "0.2em", color: T.textMuted,
      fontWeight: 400, display: "block", marginBottom: "0.25rem",
    },
    pageTitle: {
      fontSize: "1.4rem", fontWeight: 300,
      letterSpacing: "-0.02em", color: T.text, marginBottom: "0.5rem",
    },
    pageDesc: {
      fontSize: "0.78rem", color: T.textMuted,
      lineHeight: 1.6, marginBottom: "2rem",
    },

    /* drop zone */
    dropZone: (active) => ({
      border: `1.5px dashed ${active ? T.text : T.border}`,
      background: active ? T.bgAlt : T.bg,
      borderRadius: "2px",
      padding: "2.5rem 2rem",
      textAlign: "center",
      cursor: "pointer",
      transition: "all 0.2s",
      marginBottom: "1.5rem",
    }),
    dropIcon: { color: T.textMuted, marginBottom: "0.75rem" },
    dropHeading: { fontSize: "0.88rem", fontWeight: 400, color: T.text, marginBottom: "0.35rem" },
    dropSub: { fontSize: "0.72rem", color: T.textMuted, marginBottom: "1rem" },
    browseBtn: {
      display: "inline-block",
      padding: "0.4rem 1.25rem",
      border: `1px solid ${T.border}`,
      background: T.bg, color: T.text,
      fontSize: "0.72rem", cursor: "pointer",
      fontFamily: "'Open Sans', sans-serif",
      letterSpacing: "0.04em",
      transition: "all 0.15s",
    },

    /* selected file */
    fileCard: {
      border: `1px solid ${T.border}`,
      background: T.bgAlt,
      padding: "0.875rem 1.25rem",
      display: "flex", alignItems: "center", gap: "12px",
      marginBottom: "1.5rem",
    },
    fileName: { flex: 1, fontSize: "0.82rem", fontWeight: 400, color: T.text },
    fileSize: { fontSize: "0.68rem", color: T.textMuted },
    clearBtn: {
      background: "none", border: "none",
      cursor: "pointer", color: T.textMuted, padding: "2px",
      display: "flex", alignItems: "center",
    },

    /* upload btn */
    uploadBtn: (disabled) => ({
      width: "100%",
      padding: "0.75rem 1rem",
      background: disabled ? T.bgTert : T.text,
      color: disabled ? T.textMuted : T.bg,
      border: `1px solid ${disabled ? T.border : T.text}`,
      fontSize: "0.8rem", fontWeight: 400,
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "'Open Sans', sans-serif",
      letterSpacing: "0.06em",
      transition: "all 0.2s",
      display: "flex", alignItems: "center",
      justifyContent: "center", gap: "8px",
      marginBottom: "1.5rem",
    }),

    /* spinner */
    spinner: {
      width: "14px", height: "14px",
      border: "2px solid rgba(255,255,255,0.3)",
      borderTop: "2px solid #fff",
      borderRadius: "50%",
      animation: "da-spin 0.7s linear infinite",
    },

    /* error */
    errorBox: {
      border: `1px solid ${T.border}`,
      background: "#fffafa",
      padding: "0.875rem 1.25rem",
      display: "flex", alignItems: "flex-start", gap: "10px",
      marginBottom: "1.5rem",
    },
    errorText: { fontSize: "0.78rem", color: "#c00", lineHeight: 1.5, margin: 0 },

    /* result */
    resultBox: {
      border: `1px solid ${T.border}`,
      background: T.bgAlt,
      marginBottom: "1.5rem",
    },
    resultHeader: {
      padding: "0.875rem 1.25rem",
      borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: "8px",
    },
    resultTitle: { fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: 0 },
    resultGrid: {
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
      gap: "1px", background: T.border,
    },
    resultCell: {
      background: T.bg, padding: "1rem 1.25rem",
    },
    resultNum: {
      fontSize: "1.5rem", fontWeight: 300,
      letterSpacing: "-0.03em", color: T.text, margin: 0, lineHeight: 1,
    },
    resultLabel: {
      fontSize: "0.62rem", textTransform: "uppercase",
      letterSpacing: "0.1em", color: T.textMuted,
      marginTop: "0.3rem", display: "block",
    },

    colsBox: { padding: "1rem 1.25rem" },
    colsTitle: {
      fontSize: "0.62rem", textTransform: "uppercase",
      letterSpacing: "0.1em", color: T.textMuted, marginBottom: "0.75rem",
    },
    colsList: {
      display: "flex", flexWrap: "wrap", gap: "6px",
    },
    colTag: {
      border: `1px solid ${T.border}`,
      padding: "0.2rem 0.55rem",
      fontSize: "0.65rem", color: T.textSec,
      background: T.bg,
    },

    /* hint */
    hint: {
      border: `1px solid ${T.border}`,
      padding: "1rem 1.25rem",
      background: T.bgAlt,
    },
    hintTitle: {
      fontSize: "0.62rem", textTransform: "uppercase",
      letterSpacing: "0.1em", color: T.textMuted,
      marginBottom: "0.5rem",
    },
    hintList: {
      margin: 0, paddingLeft: "1rem",
      fontSize: "0.74rem", color: T.textSec, lineHeight: 1.8,
    },
  };

  const fmtSize = (b) => b < 1024 * 1024
    ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / (1024 * 1024)).toFixed(2)} MB`;

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        @keyframes da-spin { to { transform: rotate(360deg); } }
        .mmu-back:hover { color: #000 !important; }
        .mmu-browse:hover { border-color: #000 !important; background: #fafafa !important; }
        .mmu-upload:hover:not(:disabled) { background: #222 !important; }
      `}</style>

      {/* top bar */}
      <div style={S.topBar}>
        <button
          className="mmu-back"
          style={S.backBtn}
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span style={S.sep}>|</span>
        <span style={S.topTitle}>Medication Master Upload</span>
      </div>

      <div style={S.body}>
        <span style={S.pageLabel}>Clinical Data</span>
        <h1 style={S.pageTitle}>Medication Master Upload</h1>
        <p style={S.pageDesc}>
          Upload your pharmacy / formulary Excel file (.xlsx). The system will parse every row, build a semantic search index, and store it against your doctor profile for use in clinical workflows.
        </p>

        {/* ── drop zone (only if no file selected) ── */}
        {!file && !result && (
          <div
            style={S.dropZone(dragging)}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={S.dropIcon}>
              <FileSpreadsheet size={36} strokeWidth={1.2} />
            </div>
            <p style={S.dropHeading}>Drag &amp; drop your Excel file here</p>
            <p style={S.dropSub}>or click to browse · .xlsx / .xls accepted</p>
            <button
              className="mmu-browse"
              style={S.browseBtn}
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            >
              Browse File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* ── selected file card ── */}
        {file && (
          <div style={S.fileCard}>
            <FileSpreadsheet size={20} strokeWidth={1.4} color={T.textSec} />
            <span style={S.fileName}>{file.name}</span>
            <span style={S.fileSize}>{fmtSize(file.size)}</span>
            <button style={S.clearBtn} onClick={clearFile}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── error ── */}
        {error && (
          <div style={S.errorBox}>
            <AlertCircle size={15} color="#c00" style={{ flexShrink: 0, marginTop: "1px" }} />
            <p style={S.errorText}>{error}</p>
          </div>
        )}

        {/* ── upload button ── */}
        {file && (
          <button
            className="mmu-upload"
            style={S.uploadBtn(uploading)}
            disabled={uploading}
            onClick={handleUpload}
          >
            {uploading ? (
              <>
                <span style={S.spinner} />
                Processing…
              </>
            ) : (
              <>
                <Upload size={14} />
                Upload &amp; Build Index
              </>
            )}
          </button>
        )}

        {/* ── success result ── */}
        {result && result.status === "success" && (
          <div style={S.resultBox}>
            <div style={S.resultHeader}>
              <CheckCircle size={15} color="#000" />
              <p style={S.resultTitle}>Upload successful — index built</p>
            </div>

            <div style={S.resultGrid}>
              <div style={S.resultCell}>
                <p style={S.resultNum}>{result.rows ?? "—"}</p>
                <span style={S.resultLabel}>Rows Indexed</span>
              </div>
              <div style={S.resultCell}>
                <p style={S.resultNum}>{result.columns?.length ?? "—"}</p>
                <span style={S.resultLabel}>Columns</span>
              </div>
              <div style={S.resultCell}>
                <p style={S.resultNum}>{doctorId?.slice(-4) ?? "—"}</p>
                <span style={S.resultLabel}>Doctor ID (last 4)</span>
              </div>
            </div>

            {result.columns?.length > 0 && (
              <div style={S.colsBox}>
                <p style={S.colsTitle}>Detected Columns</p>
                <div style={S.colsList}>
                  {result.columns.map((col, i) => (
                    <span key={i} style={S.colTag}>{col}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── upload another after success ── */}
        {result && (
          <button
            style={{
              ...S.uploadBtn(false),
              background: T.bg, color: T.text,
              border: `1px solid ${T.border}`,
            }}
            onClick={() => { setResult(null); setError(null); }}
          >
            <Upload size={14} /> Upload Another File
          </button>
        )}

        {/* ── hints ── */}
        {!result && (
          <div style={S.hint}>
            <p style={S.hintTitle}>File Requirements</p>
            <ul style={S.hintList}>
              <li>File must be <strong>.xlsx</strong> or <strong>.xls</strong> format</li>
              <li>Column headers should be on <strong>row 3</strong> (the parser skips the first two rows)</li>
              <li>Each row represents one medication entry</li>
              <li>Empty rows and columns are automatically removed</li>
              <li>Recommended columns: Drug Name, Generic Name, Strength, Form, Route, Category</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}