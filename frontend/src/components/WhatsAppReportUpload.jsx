import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { UploadCloud, FileText, ArrowLeft } from "lucide-react";

// Match dashboard colors
const PRIMARY_BLUE = "#005a8b";
const ACCENT_TEAL = "#00c2a7";
const LIGHT_BG = "#f5f7fa";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const ReportUpload = () => {
  const navigate = useNavigate();
  const query = new URLSearchParams(useLocation().search);

  const doctorId = query.get("doctor_id");
  const patientId = query.get("patient_id");

  const [docType, setDocType] = useState("lab_report");
  const [reportDate, setReportDate] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  if (!doctorId || !patientId) {
    return <p style={{ padding: 20 }}>Invalid URL</p>;
  }

  const handleUpload = async (e) => {
    e.preventDefault();

    if (!file) return alert("Select a file");

    const formData = new FormData();
    formData.append("doctor_id", doctorId);
    formData.append("patient_id", patientId);
    formData.append("doc_type", docType);
    formData.append("report_date", reportDate);
    formData.append("file", file);

    try {
      setLoading(true);
      setMessage(null);

      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/proxy/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      const data = await res.json();
      setMessage(data.message || "Upload successful");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(135deg, ${LIGHT_BG}, #eef3ff)`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: "420px",
          background: "rgba(255,255,255,0.65)",
          backdropFilter: "blur(30px)",
          borderRadius: "18px",
          padding: "24px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.1)",
          border: "1px solid rgba(255,255,255,0.7)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
          <ArrowLeft
            size={18}
            style={{ cursor: "pointer", marginRight: 10 }}
            onClick={() => navigate(-1)}
          />
          <h2 style={{ margin: 0, color: PRIMARY_BLUE }}>
            Upload Medical Report
          </h2>
        </div>

        <p style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>
          Doctor ID: <b>{doctorId}</b> <br />
          Patient ID: <b>{patientId}</b>
        </p>

        <form onSubmit={handleUpload}>
          {/* Document Type */}
          <label style={labelStyle}>Document Type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            style={inputStyle}
          >
            <option value="lab_report">lab_report</option>
            <option value="ct_scan">ct_scan</option>
            <option value="x_ray">x_ray</option>
          </select>

          {/* Report Date */}
          <label style={labelStyle}>Report Date</label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            style={inputStyle}
            required
          />

          {/* File Upload */}
          <label style={labelStyle}>Upload File</label>
          <div
            style={{
              ...inputStyle,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
            }}
          >
            <UploadCloud size={18} color={ACCENT_TEAL} />
            <input
              type="file"
              onChange={(e) => setFile(e.target.files[0])}
              style={{ border: "none", flex: 1 }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              marginTop: 20,
              padding: "12px",
              borderRadius: "12px",
              border: "none",
              background: `linear-gradient(135deg, ${PRIMARY_BLUE}, ${ACCENT_TEAL})`,
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {loading ? "Uploading..." : "Upload Report"}
          </button>
        </form>

        {message && (
          <p
            style={{
              marginTop: 16,
              fontSize: 13,
              textAlign: "center",
              color: message.toLowerCase().includes("error")
                ? "#FF3B30"
                : ACCENT_TEAL,
            }}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 600,
  marginTop: "12px",
  marginBottom: "4px",
  color: PRIMARY_BLUE,
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid rgba(0,0,0,0.15)",
  outline: "none",
  fontSize: "14px",
  background: "rgba(255,255,255,0.85)",
};

export default ReportUpload;
