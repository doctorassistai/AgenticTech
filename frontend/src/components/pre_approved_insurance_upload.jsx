import React, { useState, useRef } from "react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

function PreApprovedInsuranceUpload() {
  const [file, setFile] = useState(null);
  const [logs, setLogs] = useState([
    "> System initialized...",
    "> Waiting for Excel upload",
  ]);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);

  /* ---------------- UTIL ---------------- */

  const log = (msg) =>
    setLogs((prev) => [...prev, `> ${msg}`]);

  const validateExcel = (file) => {
    if (!file) return false;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      log("❌ Invalid file format. Only .xlsx allowed");
      return false;
    }
    return true;
  };

  /* ---------------- FILE HANDLERS ---------------- */

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (validateExcel(droppedFile)) {
      setFile(droppedFile);
      log(`📄 File selected: ${droppedFile.name}`);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (validateExcel(selectedFile)) {
      setFile(selectedFile);
      log(`📄 File selected: ${selectedFile.name}`);
    }
  };

  /* ---------------- UPLOAD ---------------- */

  const handleUpload = async () => {
    if (!file) {
      log("❌ Please select an Excel file first");
      return;
    }

    setLoading(true);
    log("⏳ Upload started...");
    log("📤 Sending file to server...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `${API_BASE_URL}/insurance/pre-approved/upload-excel`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json();

      if (!res.ok) {
        log(`❌ Upload failed: ${data.detail || "Server error"}`);
        setLoading(false);
        return;
      }

      log("✅ Upload successful");
      log(`🏥 Hospital ID: ${data.hospital_id || "N/A"}`);

      if (data.inserted_count !== undefined)
        log(`📥 Records inserted: ${data.inserted_count}`);

      if (data.skipped_count !== undefined)
        log(`⚠️ Duplicates skipped: ${data.skipped_count}`);

      if (data.message) log(`ℹ️ ${data.message}`);

      setFile(null);
    } catch (err) {
      log(`❌ Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- STYLES ---------------- */

  const styles = {
    container: {
      minHeight: "100vh",
      background: "linear-gradient(to bottom, #f8fafc, #f1f5f9)",
      padding: "48px 16px",
      fontFamily: "system-ui",
    },
    wrapper: { maxWidth: "900px", margin: "0 auto" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" },
    dropzone: {
      border: "2px dashed #cbd5e1",
      borderRadius: "12px",
      padding: "48px 24px",
      textAlign: "center",
      cursor: "pointer",
      background: "#fff",
      transition: "all 0.2s",
    },
    button: {
      width: "100%",
      height: "48px",
      marginTop: "16px",
      background: "#0d9488",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: 600,
      cursor: "pointer",
      opacity: loading || !file ? 0.6 : 1,
    },
    terminal: {
      background: "#020617",
      color: "#22c55e",
      borderRadius: "12px",
      padding: "16px",
      fontFamily: "monospace",
      height: "300px",
      overflowY: "auto",
    },
    log: { marginBottom: "6px" },
  };

  /* ---------------- UI ---------------- */

  return (
    <div style={styles.container}>
      <div style={styles.wrapper}>
        <h2 style={{ marginBottom: "24px" }}>
          📊 Pre-Approved Insurance Excel Upload
        </h2>

        <div style={styles.grid}>
          {/* Upload Area */}
          <div>
            <div
              style={{
                ...styles.dropzone,
                borderColor: isDragging || file ? "#14b8a6" : "#cbd5e1",
                background: isDragging ? "#f0fdfa" : "#fff",
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />

              <p style={{ fontSize: "16px", fontWeight: 500 }}>
                {file ? file.name : "Drop Excel file here or click to browse"}
              </p>
              <p style={{ fontSize: "14px", color: "#64748b" }}>
                Only .xlsx files supported
              </p>
            </div>

            <button
              style={styles.button}
              disabled={loading || !file}
              onClick={handleUpload}
            >
              {loading ? "Uploading..." : "Upload & Process"}
            </button>
          </div>

          {/* Terminal */}
          <div style={styles.terminal}>
            {logs.map((l, i) => (
              <div key={i} style={styles.log}>{l}</div>
            ))}
            <span style={{ opacity: 0.6 }}>█</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PreApprovedInsuranceUpload;
