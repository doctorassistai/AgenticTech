// KnowledgeGraphUpload.jsx
import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

function KnowledgeGraphUpload() {

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Read doctor_id directly from URL query params
  const doctorId = searchParams.get("doctor_id");

  const [files, setFiles] = useState([]);
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("upload");
  const fileInputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
  if (!doctorId) {
    console.error("No doctor_id found in URL params!");
    setError("Missing doctor ID. Please access this page from the correct link.");
  } else {
    console.log("Doctor ID from URL:", doctorId);
  }
}, [doctorId]);

  const handleFileSelect = (e) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
      setError(null);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const validFiles = droppedFiles.filter(
        f => f.type === "application/pdf" || 
            f.name.endsWith(".docx") || 
            f.name.endsWith(".txt") ||
            f.name.endsWith(".md")
      );
      setFiles(prev => [...prev, ...validFiles]);
      setError(null);
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (files.length === 0 && !urls.trim()) {
      setError("Please upload at least one file or enter a URL.");
      return;
    }

    setLoading(true);
    setProcessing(true);
    setError(null);
    setActiveTab("upload");

    const formData = new FormData();
    
    files.forEach(file => {
      formData.append("files", file);
    });
    
    if (urls.trim()) {
      formData.append("urls", urls);
    }

    // ADD THIS
    formData.append("doctor_id", doctorId);

    // ── DEBUG: log everything being sent ──
    console.log("=== PIPELINE SUBMIT ===");
    console.log("doctorId prop value:", doctorId);
    console.log("doctorId type:", typeof doctorId);
    console.log("Files count:", files.length);
    console.log("URLs:", urls);
    console.log("FormData entries:");
    for (let [key, value] of formData.entries()) {
      if (value instanceof File) {
        console.log(`  ${key}: [File] ${value.name} (${value.size} bytes)`);
      } else {
        console.log(`  ${key}: "${value}"`);
      }
    }
    console.log("========================");

    try {
      const response = await fetch(`${API_BASE_URL}/hms/users/ai-legacy/pipeline/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId }),
      });

      const data = await response.json();

      // ── DEBUG: log response ──
      console.log("=== PIPELINE RESPONSE ===");
      console.log("HTTP status:", response.status);
      console.log("Response data:", data);
      console.log("=========================");

      if (!response.ok) {
        throw new Error(data.detail || "Pipeline execution failed");
      }

      setResult(data);
      setActiveTab("results");
      
      // Clear form on success
      setFiles([]);
      setUrls("");
      
    } catch (err) {
      console.error("Pipeline error:", err);
      setError(err instanceof Error ? err.message : "An error occurred during processing");
    } finally {
      setLoading(false);
      setProcessing(false);
    }
  };

  const getEntityColor = (type) => {
    const colors = {
      "Disease": "#4f46e5",
      "Drug": "#0891b2",
      "Symptom": "#dc2626",
      "Procedure": "#7c3aed",
      "Biomarker": "#059669",
      "Risk Factor": "#d97706",
      "Treatment": "#0284c7",
      "Guideline": "#6d28d9",
      "Investigation": "#0d9488",
      "Outcome": "#16a34a",
      "Contraindication": "#b91c1c",
      "Specialty": "#9333ea",
      "Evidence Level": "#ca8a04",
      "Gene": "#0f766e",
      "Pathway": "#1d4ed8",
      "default": "#64748b"
    };
    return colors[type] || colors.default;
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .kg-root {
          font-family: 'Open Sans', sans-serif;
          font-weight: 300;
          background: #ffffff;
          color: #000000;
          min-height: 100vh;
          display: flex;
          -webkit-font-smoothing: antialiased;
        }

        /* ── LEFT PANEL ── */
        .kg-left {
          width: 40%;
          background: #000000;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 3rem;
          position: relative;
          overflow: hidden;
        }
        .kg-left-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .kg-left-top {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .kg-brand-name {
          font-size: 0.9rem;
          font-weight: 400;
          color: #ffffff;
          letter-spacing: -0.01em;
        }
        .kg-back-btn {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.2);
          color: #ffffff;
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          cursor: pointer;
          transition: border-color 0.2s;
          font-family: inherit;
        }
        .kg-back-btn:hover {
          border-color: rgba(255,255,255,0.5);
        }

        .kg-left-middle {
          position: relative;
          z-index: 1;
        }
        .kg-left-headline {
          font-size: clamp(1.5rem, 3vw, 2.5rem);
          font-weight: 300;
          color: #ffffff;
          letter-spacing: -0.03em;
          line-height: 1.2;
          margin-bottom: 1.25rem;
        }
        .kg-left-sub {
          font-size: 0.82rem;
          color: rgba(255,255,255,0.5);
          line-height: 1.8;
          max-width: 340px;
        }

        .kg-agent-strip {
          position: relative;
          z-index: 1;
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
          margin: 2rem 0;
        }
        .kg-agent-pill {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.8rem;
          border: 1px solid rgba(255,255,255,0.15);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(255,255,255,0.6);
        }
        .kg-agent-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10b981;
          animation: kg-pulse 2s infinite;
        }
        @keyframes kg-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .kg-left-bottom {
          position: relative;
          z-index: 1;
        }
        .kg-stat-row {
          display: flex;
          gap: 2rem;
          margin-top: 1rem;
        }
        .kg-stat {
          border-top: 1px solid rgba(255,255,255,0.15);
          padding-top: 0.75rem;
        }
        .kg-stat-number {
          font-size: 1.2rem;
          font-weight: 300;
          color: #ffffff;
        }
        .kg-stat-label {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255,255,255,0.4);
          margin-top: 0.15rem;
        }

        /* ── RIGHT PANEL ── */
        .kg-right {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 2rem 2.5rem;
          background: #ffffff;
          overflow-y: auto;
          opacity: 0;
          transform: translateX(16px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .kg-right.kg-mounted {
          opacity: 1;
          transform: translateX(0);
        }

        /* ── TABS ── */
        .kg-tabs {
          display: flex;
          gap: 2rem;
          border-bottom: 1px solid #e0e0e0;
          margin-bottom: 2rem;
        }
        .kg-tab {
          background: none;
          border: none;
          padding: 0.75rem 0;
          font-size: 0.85rem;
          font-family: 'Open Sans', sans-serif;
          font-weight: 400;
          color: #888888;
          cursor: pointer;
          position: relative;
          transition: color 0.2s;
        }
        .kg-tab.kg-active {
          color: #000000;
        }
        .kg-tab.kg-active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 1px;
          background: #000000;
        }
        .kg-tab:hover:not(.kg-active) {
          color: #444444;
        }
        .kg-tab:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── UPLOAD FORM ── */
        .kg-form {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .kg-section-label {
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: #888888;
          font-weight: 400;
          margin-bottom: 0.75rem;
          display: block;
        }

        .kg-dropzone {
          border: 2px dashed #e0e0e0;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          background: #fafafa;
        }
        .kg-dropzone.kg-drag-active {
          border-color: #000000;
          background: #f5f5f5;
        }
        .kg-dropzone-icon {
          font-size: 2rem;
          margin-bottom: 0.5rem;
        }
        .kg-dropzone-text {
          font-size: 0.85rem;
          color: #888888;
        }
        .kg-dropzone-sub {
          font-size: 0.7rem;
          color: #bbbbbb;
          margin-top: 0.5rem;
        }

        .kg-file-list {
          margin-top: 1rem;
        }
        .kg-file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid #f0f0f0;
        }
        .kg-file-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.85rem;
        }
        .kg-file-size {
          color: #bbbbbb;
          font-size: 0.7rem;
        }
        .kg-remove-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #cccccc;
          font-size: 1.2rem;
          transition: color 0.2s;
        }
        .kg-remove-btn:hover {
          color: #dc2626;
        }

        .kg-textarea {
          width: 100%;
          padding: 0.875rem;
          border: 1px solid #e0e0e0;
          font-family: 'Open Sans', sans-serif;
          font-weight: 300;
          font-size: 0.85rem;
          color: #000000;
          resize: vertical;
          background: #ffffff;
        }
        .kg-textarea:focus {
          outline: none;
          border-color: #000000;
        }
        .kg-textarea::placeholder {
          color: #bbbbbb;
        }

        .kg-submit-btn {
          width: 100%;
          height: 48px;
          background: #000000;
          color: #ffffff;
          border: 1px solid #000000;
          font-family: 'Open Sans', sans-serif;
          font-weight: 400;
          font-size: 0.875rem;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        .kg-submit-btn:hover:not(:disabled) {
          background: transparent;
          color: #000000;
        }
        .kg-submit-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .kg-spinner {
          width: 14px;
          height: 14px;
          border: 1.5px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: kg-spin 0.7s linear infinite;
        }
        @keyframes kg-spin { to { transform: rotate(360deg); } }

        /* ── RESULTS ── */
        .kg-results {
          flex: 1;
          overflow-y: auto;
        }
        .kg-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .kg-stat-card {
          padding: 1rem;
          background: #fafafa;
          border-left: 2px solid #000000;
        }
        .kg-stat-card-value {
          font-size: 1.8rem;
          font-weight: 300;
          color: #000000;
        }
        .kg-stat-card-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #888888;
          margin-top: 0.25rem;
        }

        .kg-section-title {
          font-size: 0.8rem;
          font-weight: 400;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #888888;
          margin: 1.5rem 0 1rem 0;
        }

        .kg-entity-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .kg-entity-tag {
          padding: 0.25rem 0.75rem;
          font-size: 0.75rem;
          border-radius: 0;
          color: white;
        }

        .kg-edge-list {
          max-height: 300px;
          overflow-y: auto;
        }
        .kg-edge-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
          border-bottom: 1px solid #f0f0f0;
          font-size: 0.8rem;
        }
        .kg-edge-relation {
          padding: 0.15rem 0.5rem;
          background: #f0f0f0;
          font-size: 0.7rem;
          font-weight: 400;
        }

        .kg-error {
          padding: 1rem;
          background: #fef2f2;
          border-left: 2px solid #dc2626;
          color: #dc2626;
          font-size: 0.85rem;
        }

        /* ── RESPONSIVE ── */
        @media (max-width: 860px) {
          .kg-left { display: none; }
          .kg-right { padding: 1.5rem; }
          .kg-stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="kg-root">
        {/* LEFT PANEL */}
        <div className="kg-left">
          <div className="kg-left-grid" />
          
          <div className="kg-left-top">
            <button className="kg-back-btn" onClick={() => navigate(-1)}>
              ← Back
            </button>
            <span className="kg-brand-name">Doctorassist.AI</span>
          </div>

          <div className="kg-left-middle">
            <h1 className="kg-left-headline">
              Medical Knowledge<br />Graph Pipeline
            </h1>
            <p className="kg-left-sub">
              Upload clinical documents or provide URLs to extract medical entities,
              discover relationships, and build a knowledge graph.
            </p>

            <div className="kg-agent-strip">
              <div className="kg-agent-pill">
                <span className="kg-agent-dot" />
                Disease Agent
              </div>
              <div className="kg-agent-pill">
                <span className="kg-agent-dot" />
                Drug Agent
              </div>
              <div className="kg-agent-pill">
                <span className="kg-agent-dot" />
                Biomarker Agent
              </div>
              <div className="kg-agent-pill">
                <span className="kg-agent-dot" />
                Molecular Agent
              </div>
              <div className="kg-agent-pill">
                <span className="kg-agent-dot" />
                Guidelines Agent
              </div>
            </div>
          </div>

          <div className="kg-left-bottom">
            <div className="kg-stat-row">
              <div className="kg-stat">
                <div className="kg-stat-number">5</div>
                <div className="kg-stat-label">Specialist Agents</div>
              </div>
              <div className="kg-stat">
                <div className="kg-stat-number">Neo4j</div>
                <div className="kg-stat-label">Graph Database</div>
              </div>
              <div className="kg-stat">
                <div className="kg-stat-number">LLM</div>
                <div className="kg-stat-label">Llama 3.3 70B</div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className={`kg-right ${mounted ? "kg-mounted" : ""}`}>
          <div className="kg-tabs">
            <button
              className={`kg-tab ${activeTab === "upload" ? "kg-active" : ""}`}
              onClick={() => setActiveTab("upload")}
            >
              Upload Documents
            </button>
            <button
              className={`kg-tab ${activeTab === "results" ? "kg-active" : ""}`}
              onClick={() => setActiveTab("results")}
              disabled={!result}
            >
              Extraction Results
            </button>
          </div>

          {activeTab === "upload" && (
            <form className="kg-form" onSubmit={handleSubmit}>
              <div>
                <span className="kg-section-label">📄 UPLOAD FILES</span>
                <div
                  className={`kg-dropzone ${dragActive ? "kg-drag-active" : ""}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="kg-dropzone-icon">📁</div>
                  <div className="kg-dropzone-text">
                    Drop PDF, DOCX, or TXT files here
                  </div>
                  <div className="kg-dropzone-sub">
                    or click to browse
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.doc,.txt,.md"
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                  />
                </div>
                
                {files.length > 0 && (
                  <div className="kg-file-list">
                    {files.map((file, idx) => (
                      <div key={idx} className="kg-file-item">
                        <div className="kg-file-info">
                          <span>📄</span>
                          <span>{file.name}</span>
                          <span className="kg-file-size">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <button
                          type="button"
                          className="kg-remove-btn"
                          onClick={() => removeFile(idx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <span className="kg-section-label">🔗 OR PROVIDE URLS</span>
                <textarea
                  className="kg-textarea"
                  rows={3}
                  placeholder="Enter one or more URLs (one per line)&#10;Example:&#10;https://example.com/clinical-guideline&#10;https://another-site.com/research"
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="kg-submit-btn"
                disabled={loading}
              >
                {processing && <span className="kg-spinner" />}
                {processing ? "Extracting Medical Knowledge..." : "🚀 Run Pipeline →"}
              </button>

              {error && <div className="kg-error">{error}</div>}
            </form>
          )}

          {activeTab === "results" && result && (
            <div className="kg-results">
              <div className="kg-stats-grid">
                <div className="kg-stat-card">
                  <div className="kg-stat-card-value">{result.total_nodes}</div>
                  <div className="kg-stat-card-label">Graph Nodes</div>
                </div>
                <div className="kg-stat-card">
                  <div className="kg-stat-card-value">{result.total_edges}</div>
                  <div className="kg-stat-card-label">Graph Edges</div>
                </div>
                <div className="kg-stat-card">
                  <div className="kg-stat-card-value">{result.total_entities}</div>
                  <div className="kg-stat-card-label">Entities Extracted</div>
                </div>
                <div className="kg-stat-card">
                  <div className="kg-stat-card-value">{result.sources?.length || 0}</div>
                  <div className="kg-stat-card-label">Sources Processed</div>
                </div>
              </div>

              {result.neo4j_stats && (
                <>
                  <div className="kg-section-title">📊 Neo4j Write Stats</div>
                  <div className="kg-stats-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                    <div className="kg-stat-card">
                      <div className="kg-stat-card-value">{result.neo4j_stats.nodes_created}</div>
                      <div className="kg-stat-card-label">Nodes Created</div>
                    </div>
                    <div className="kg-stat-card">
                      <div className="kg-stat-card-value">{result.neo4j_stats.nodes_merged}</div>
                      <div className="kg-stat-card-label">Nodes Merged</div>
                    </div>
                    <div className="kg-stat-card">
                      <div className="kg-stat-card-value">{result.neo4j_stats.edges_created}</div>
                      <div className="kg-stat-card-label">Edges Created</div>
                    </div>
                    <div className="kg-stat-card">
                      <div className="kg-stat-card-value">{result.neo4j_stats.edges_merged}</div>
                      <div className="kg-stat-card-label">Edges Merged</div>
                    </div>
                  </div>
                </>
              )}

              <div className="kg-section-title">🏷️ Extracted Entities</div>
              <div className="kg-entity-list">
                {(result.graph_nodes || []).slice(0, 30).map((node, idx) => (
                  <span
                    key={idx}
                    className="kg-entity-tag"
                    style={{ backgroundColor: getEntityColor(node.type) }}
                  >
                    {node.label}
                  </span>
                ))}
                {(result.graph_nodes || []).length > 30 && (
                  <span className="kg-entity-tag" style={{ backgroundColor: "#888" }}>
                    +{(result.graph_nodes || []).length - 30} more
                  </span>
                )}
              </div>

              <div className="kg-section-title">🔗 Discovered Relations</div>
              <div className="kg-edge-list">
                {(result.graph_edges || []).slice(0, 20).map((edge, idx) => (
                  <div key={idx} className="kg-edge-item">
                    <strong>{edge.source}</strong>
                    <span className="kg-edge-relation">{edge.relation}</span>
                    <strong>{edge.target}</strong>
                    <span style={{ fontSize: "0.7rem", color: "#aaa" }}>
                      (weight: {edge.weight?.toFixed(2)})
                    </span>
                  </div>
                ))}
                {(result.graph_edges || []).length > 20 && (
                  <div className="kg-edge-item" style={{ color: "#aaa" }}>
                    +{(result.graph_edges || []).length - 20} more relations
                  </div>
                )}
              </div>

              <div className="kg-section-title">📋 Pipeline ID</div>
              <div style={{ 
                fontFamily: "monospace", 
                fontSize: "0.75rem", 
                background: "#f5f5f5", 
                padding: "0.5rem",
                marginBottom: "1rem"
              }}>
                {result.pipeline_id}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default KnowledgeGraphUpload;