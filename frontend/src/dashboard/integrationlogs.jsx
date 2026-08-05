import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ChevronRight, ChevronDown, Search, RefreshCw, X,
} from "lucide-react";

const LOGS_URL = "https://doctorassist.ai/api/hms/users/auth/logs";

/* ─── THEME — mirrors DoctorDashboard exactly ─── */
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

const S = {
  page: {
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
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
  topBarLeft: { display: "flex", alignItems: "center", gap: "12px" },
  backBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: T.textSec,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "0.78rem",
    fontFamily: "'Open Sans', sans-serif",
    padding: "4px 0",
  },
  topBarTitle: { fontSize: "1rem", fontWeight: 400, color: T.text, letterSpacing: "-0.01em", margin: 0 },
  body: { padding: "2rem" },
  pageLabel: {
    fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em",
    color: T.textMuted, fontWeight: 400, display: "block", marginBottom: "0.25rem",
  },
  pageTitle: { fontSize: "1.4rem", fontWeight: 300, letterSpacing: "-0.02em", color: T.text, marginBottom: "1.5rem" },

  /* filters bar */
  filterBar: {
    display: "flex", gap: "12px", marginBottom: "1.5rem", flexWrap: "wrap", alignItems: "center",
  },
  filterInput: {
    flex: "1 1 180px",
    border: `1px solid ${T.border}`,
    padding: "0.5rem 0.75rem",
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    background: T.bg,
    outline: "none",
    minWidth: 0,
  },
  filterSelect: {
    border: `1px solid ${T.border}`,
    padding: "0.5rem 0.75rem",
    fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    background: T.bg,
    outline: "none",
    cursor: "pointer",
  },
  refreshBtn: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    padding: "0.5rem 0.75rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "0.72rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 400,
    color: T.textSec,
  },

  /* table */
  tableSection: { border: `1px solid ${T.border}`, marginBottom: "2rem" },
  tableHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableHeaderTitle: {
    fontSize: "0.75rem", fontWeight: 400, color: T.text,
    textTransform: "uppercase", letterSpacing: "0.1em", margin: 0,
  },
  tableHeaderMeta: { fontSize: "0.65rem", color: T.textMuted },
  tableWrap: { overflowX: "auto", WebkitOverflowScrolling: "touch", width: "100%" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: "700px" },
  th: {
    textAlign: "left", padding: "0.65rem 1rem",
    fontSize: "0.62rem", fontWeight: 400, textTransform: "uppercase",
    letterSpacing: "0.12em", color: T.textMuted,
    borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", background: T.bgAlt,
  },
  td: {
    padding: "0.75rem 1rem", fontSize: "0.78rem", fontWeight: 300,
    color: T.textSec, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
  },
  tdMono: {
    padding: "0.75rem 1rem", fontSize: "0.72rem", fontWeight: 300,
    color: T.textSec, borderBottom: `1px solid ${T.border}`,
    fontFamily: "monospace", whiteSpace: "nowrap",
  },

  badge: {
    padding: "0.2rem 0.5rem", fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.08em",
    border: `1px solid ${T.border}`, display: "inline-block",
  },

  expandBtn: {
    background: "none", border: "none", cursor: "pointer",
    color: T.textSec, display: "flex", alignItems: "center", gap: "4px",
    fontSize: "0.68rem", fontFamily: "'Open Sans', sans-serif", padding: "0.25rem 0",
  },

  /* detail panel (expanded row) */
  detailPanel: {
    background: T.bgAlt,
    borderBottom: `1px solid ${T.border}`,
    padding: "1.5rem 2rem",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1.5rem",
  },
  detailBlock: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  detailLabel: {
    fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em",
    color: T.textMuted, fontWeight: 400,
  },
  detailValue: { fontSize: "0.78rem", fontWeight: 300, color: T.text, lineHeight: 1.5 },
  jsonBox: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    padding: "1rem",
    fontSize: "0.7rem",
    fontFamily: "monospace",
    color: T.textSec,
    overflowX: "auto",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: "280px",
    overflowY: "auto",
  },

  /* pagination */
  pagination: {
    display: "flex", alignItems: "center", gap: "4px",
    padding: "1rem 1.5rem", borderTop: `1px solid ${T.border}`,
  },
  pgBtn: {
    padding: "0.35rem 0.75rem", border: `1px solid ${T.border}`,
    background: T.bg, color: T.textSec, fontSize: "0.72rem",
    cursor: "pointer", fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300, transition: "all 0.15s",
  },
  pgBtnActive: { background: T.text, color: T.bg, borderColor: T.text },

  emptyState: {
    textAlign: "center", padding: "3rem 1rem",
    color: T.textMuted, fontSize: "0.78rem",
  },
};

/* ─── STATUS BADGE ─── */
function StatusBadge({ status }) {
  const isSuccess = status === "success";
  return (
    <span style={{
      ...S.badge,
      borderColor: isSuccess ? "#000" : "#000",
      color: isSuccess ? "#000" : "#000",
      background: isSuccess ? "transparent" : T.bgTert,
      letterSpacing: "0.1em",
    }}>
      {isSuccess ? "✓ Success" : "✕ Error"}
    </span>
  );
}

/* ─── HTTP METHOD BADGE ─── */
function MethodBadge({ method }) {
  return (
    <span style={{ ...S.badge, fontFamily: "monospace", letterSpacing: "0.05em" }}>
      {method}
    </span>
  );
}

/* ─── DETAIL ROW (expanded) ─── */
function DetailRow({ log }) {
  return (
    <tr>
      <td colSpan={7} style={{ padding: 0 }}>
        <div style={S.detailPanel}>
          <div style={S.detailGrid}>

            {/* Left col */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Trace ID</span>
                <span style={{ ...S.detailValue, fontFamily: "monospace", fontSize: "0.7rem" }}>{log.trace_id}</span>
              </div>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Endpoint</span>
                <span style={{ ...S.detailValue, fontFamily: "monospace" }}>{log.endpoint}</span>
              </div>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Client IP</span>
                <span style={{ ...S.detailValue, fontFamily: "monospace", fontSize: "0.7rem" }}>{log.client_ip}</span>
              </div>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Query String</span>
                <span style={{ ...S.detailValue, fontFamily: "monospace", fontSize: "0.7rem" }}>
                  {log.query_string || "—"}
                </span>
              </div>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Duration</span>
                <span style={S.detailValue}>{log.duration_ms} ms</span>
              </div>
              {log.error_detail && (
                <div style={S.detailBlock}>
                  <span style={S.detailLabel}>Error Detail</span>
                  <span style={{ ...S.detailValue, color: "#555" }}>{log.error_detail}</span>
                </div>
              )}
            </div>

            {/* Right col */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Request Payload</span>
                <div style={S.jsonBox}>
                  {log.request_payload
                    ? JSON.stringify(log.request_payload, null, 2)
                    : "—"}
                </div>
              </div>
              <div style={S.detailBlock}>
                <span style={S.detailLabel}>Response Body</span>
                <div style={S.jsonBox}>
                  {log.response_body
                    ? JSON.stringify(log.response_body, null, 2)
                    : "—"}
                </div>
              </div>
            </div>

          </div>
        </div>
      </td>
    </tr>
  );
}

/* ─── MAIN PAGE ─── */
function IntegrationLogs() {
  const navigate = useNavigate();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  /* filters */
  const [filterHospital, setFilterHospital] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterEndpoint, setFilterEndpoint] = useState("");

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterHospital) params.set("hospital_id", filterHospital);
      if (filterDate)     params.set("date", filterDate);
      if (filterEndpoint) params.set("endpoint", filterEndpoint);
      const url = `${LOGS_URL}${params.toString() ? "?" + params.toString() : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
      setCurrentPage(1);
      setExpandedRow(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  /* client-side status filter (done on frontend since backend may not support it) */
  const filtered = logs.filter(l => {
    if (filterStatus && l.status !== filterStatus) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated  = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const formatDateTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .il-back:hover { color: #000 !important; }
        .il-refresh:hover { border-color: #000 !important; color: #000 !important; }
        .il-row:hover td { background: ${T.bgAlt} !important; }
        .il-expand:hover { color: #000 !important; }
        .il-pg-btn:hover { border-color: #000 !important; color: #000 !important; }
        .il-filter-input:focus { border-color: #000 !important; }
        @media (max-width: 767px) {
          .il-body { padding: 1rem !important; }
          .il-topbar { padding: 0.75rem 1rem !important; }
          .il-filter-bar { flex-direction: column !important; }
          .il-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── TOP BAR ── */}
      <div className="il-topbar" style={S.topBar}>
        <div style={S.topBarLeft}>
          <button className="il-back" style={S.backBtn} onClick={() => navigate(-1)}>
            <ArrowLeft size={14} /> Back
          </button>
          <span style={{ color: T.border, fontSize: "1rem" }}>|</span>
          <span style={S.topBarTitle}>Integration Request Logs</span>
        </div>
        <span style={{ fontSize: "0.65rem", color: T.textMuted }}>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── BODY ── */}
      <div className="il-body" style={S.body}>
        <span style={S.pageLabel}>Gateway / Integration</span>
        <h1 style={S.pageTitle}>Request Logs</h1>

        {/* ── FILTER BAR ── */}
        <div className="il-filter-bar" style={S.filterBar}>
          <input
            className="il-filter-input"
            style={S.filterInput}
            placeholder="Hospital ID"
            value={filterHospital}
            onChange={e => setFilterHospital(e.target.value)}
          />
          <input
            className="il-filter-input"
            style={S.filterInput}
            placeholder="Endpoint  e.g. /system/patient-demographics"
            value={filterEndpoint}
            onChange={e => setFilterEndpoint(e.target.value)}
          />
          <input
            className="il-filter-input"
            style={{ ...S.filterInput, flex: "0 0 160px" }}
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
          />
          <select
            style={S.filterSelect}
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
          <button
            className="il-refresh"
            style={S.refreshBtn}
            onClick={fetchLogs}
          >
            <RefreshCw size={13} />
            Apply
          </button>
          {(filterHospital || filterEndpoint || filterDate || filterStatus) && (
            <button
              className="il-refresh"
              style={S.refreshBtn}
              onClick={() => {
                setFilterHospital(""); setFilterEndpoint("");
                setFilterDate(""); setFilterStatus("");
              }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* ── TABLE ── */}
        <div style={S.tableSection}>
          <div style={S.tableHeader}>
            <span style={S.tableHeaderTitle}>All Requests</span>
            <span style={S.tableHeaderMeta}>
              {loading ? "Loading…" : `${filtered.length} record${filtered.length !== 1 ? "s" : ""}`}
            </span>
          </div>

          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  {["Hospital ID", "Method", "Endpoint", "Status", "HTTP Code", "Date & Time", "Details"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "3rem", color: T.textMuted }}>
                      Loading logs…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "3rem", color: T.textMuted }}>
                      Failed to load: {error}
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "3rem", color: T.textMuted }}>
                      No logs found
                    </td>
                  </tr>
                ) : paginated.map((log, i) => {
                  const globalIdx = (currentPage - 1) * itemsPerPage + i;
                  const isExpanded = expandedRow === globalIdx;
                  return (
                    <React.Fragment key={globalIdx}>
                      <tr className="il-row">
                        <td style={{ ...S.td, fontWeight: 400 }}>{log.hospital_id || "—"}</td>
                        <td style={S.td}><MethodBadge method={log.method} /></td>
                        <td style={S.tdMono}>{log.endpoint}</td>
                        <td style={S.td}><StatusBadge status={log.status} /></td>
                        <td style={S.td}>
                          <span style={{
                            ...S.badge,
                            fontFamily: "monospace",
                            borderColor: log.response_status >= 400 ? "#999" : T.border,
                          }}>
                            {log.response_status ?? "—"}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontSize: "0.72rem" }}>{formatDateTime(log.created_at)}</td>
                        <td style={S.td}>
                          <button
                            className="il-expand"
                            style={S.expandBtn}
                            onClick={() => setExpandedRow(isExpanded ? null : globalIdx)}
                          >
                            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {isExpanded ? "Hide" : "View"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && <DetailRow log={log} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── PAGINATION ── */}
          {totalPages > 1 && (
            <div style={S.pagination}>
              <button
                className="il-pg-btn"
                style={S.pgBtn}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >← Previous</button>

              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  className="il-pg-btn"
                  style={{ ...S.pgBtn, ...(currentPage === i + 1 ? S.pgBtnActive : {}) }}
                  onClick={() => setCurrentPage(i + 1)}
                >{i + 1}</button>
              ))}

              <button
                className="il-pg-btn"
                style={S.pgBtn}
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              >Next →</button>

              <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: T.textMuted }}>
                {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default IntegrationLogs;