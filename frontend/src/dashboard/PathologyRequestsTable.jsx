import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStrong: "#000000",
};

const S = {
  tableSection: {
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
  },
  tableHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableHeaderTitle: {
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  tableHeaderMeta: {
    fontSize: "0.65rem",
    color: T.textMuted,
  },
  tableWrap: {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    width: "100%",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "760px",
  },
  th: {
    textAlign: "left",
    padding: "0.65rem 1rem",
    fontSize: "0.62rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
    background: T.bgAlt,
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
  },
  badge: {
    padding: "0.2rem 0.5rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "capitalize",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
  },
  actionBtn: {
    padding: "0.3rem 0.75rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.65rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
    letterSpacing: "0.05em",
  },
  outlineBtn: {
    padding: "0.3rem 0.75rem",
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    fontSize: "0.65rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
  },
};

const formatLabel = (value) => String(value || "")
  .replace(/_/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (!value.length) return "-";
    return value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))
      ? value.join(", ")
      : JSON.stringify(value, null, 2);
  }
  return String(value);
};

const formatDate = (value, includeTime = false) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
};

function RequestToast({ message, type, onClose }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onClose, 4500);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;
  const isError = type === "error";

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: T.bg,
      border: `1px solid ${T.borderStrong}`,
      padding: "0.75rem 1rem",
      fontSize: "0.78rem",
      fontWeight: 300,
      color: T.text,
      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      maxWidth: 360,
      fontFamily: "'Open Sans', sans-serif",
    }}>
      {isError ? <AlertCircle size={13} /> : <Check size={13} />}
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} title="Close" style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
        <X size={12} />
      </button>
    </div>
  );
}

function DetailGroup({ data }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.75rem" }}>
      {Object.entries(data).map(([key, value]) => {
        const nested = value && typeof value === "object" && !Array.isArray(value);
        if (nested) {
          return (
            <div key={key} style={{ gridColumn: "1 / -1", borderTop: `1px solid ${T.border}`, paddingTop: "0.75rem" }}>
              <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, display: "block", marginBottom: "0.5rem" }}>
                {formatLabel(key)}
              </span>
              <DetailGroup data={value} />
            </div>
          );
        }

        return (
          <div key={key}>
            <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted, display: "block", marginBottom: "0.2rem" }}>
              {formatLabel(key)}
            </span>
            <p style={{ fontSize: "0.78rem", color: T.textSec, margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {formatValue(value)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function RequestModal({ request, loading, error, onClose, onContinue, onDecline }) {
  if (!request) return null;

  const activeCase = request.active_case;
  const canContinue = !loading && !error && !activeCase;
  const summary = {
    patient: request.patient_name || request.patient_id,
    patient_id: request.patient_id,
    request_type: request.request_type,
    referring_department: request.referring_department,
    requester: request.requester_doctor_name || request.requester_doctor_id,
    source_specialization: request.source_specialization,
    priority: request.priority || "Routine",
    status: request.status || "pending",
    requested_at: formatDate(request.created_at, true),
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: T.bg,
          border: `1px solid ${T.borderStrong}`,
          width: "100%",
          maxWidth: 820,
          maxHeight: "90vh",
          overflowY: "auto",
          fontFamily: "'Open Sans', sans-serif",
          fontWeight: 300,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", padding: "1.1rem 1.5rem", borderBottom: `1px solid ${T.border}` }}>
          <div>
            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.18em", color: T.textMuted, display: "block", marginBottom: "0.2rem" }}>
              Pathology Request
            </span>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: 0 }}>
              {request.patient_name || request.patient_id || "Request details"}
            </h2>
          </div>
          <button onClick={onClose} title="Close" style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "4px", display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem" }}>
          {loading && (
            <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.75rem", color: T.textMuted }}>
              Loading complete request details...
            </div>
          )}
          {error && (
            <div style={{ border: `1px solid ${T.borderStrong}`, padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.75rem", color: T.text }}>
              {error}
            </div>
          )}
          {activeCase && (
            <div style={{ border: `1px solid ${T.borderStrong}`, background: T.bgAlt, padding: "0.9rem 1rem", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
                <AlertCircle size={14} />
                <span style={{ fontSize: "0.78rem", fontWeight: 400 }}>This request cannot be continued</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: T.textSec, margin: 0 }}>
                An active pathology case has not been signed out: {activeCase.accession_id || activeCase.case_id || "Active case"} / {activeCase.status || "Active"}.
              </p>
            </div>
          )}

          <section style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "1rem", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, display: "block", marginBottom: "0.75rem" }}>
              Request Summary
            </span>
            <DetailGroup data={summary} />
          </section>

          <section style={{ border: `1px solid ${T.border}`, padding: "1rem", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, display: "block", marginBottom: "0.75rem" }}>
              Clinical Context
            </span>
            <DetailGroup data={request.clinical_context || {}} />
          </section>

          {request.details && Object.keys(request.details).length > 0 && (
            <section style={{ border: `1px solid ${T.border}`, padding: "1rem", marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, display: "block", marginBottom: "0.75rem" }}>
                Source Details
              </span>
              <DetailGroup data={request.details} />
            </section>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.625rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ ...S.outlineBtn, padding: "0.5rem 1rem" }}>Close</button>
            <button onClick={() => onDecline(request)} style={{ ...S.outlineBtn, padding: "0.5rem 1rem" }}>Decline</button>
            <button
              onClick={() => canContinue && onContinue(request)}
              disabled={!canContinue}
              title={activeCase ? "The active pathology case must be signed out before this request can continue." : ""}
              style={{
                ...S.actionBtn,
                padding: "0.5rem 1.25rem",
                cursor: canContinue ? "pointer" : "not-allowed",
                opacity: canContinue ? 1 : 0.4,
              }}
            >
              Continue to Workflow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PathologyRequestsTable({ doctorId }) {
  const navigate = useNavigate();
  const detailTokenRef = useRef(0);
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [toast, setToast] = useState({ message: "", type: "" });

  const fetchRequests = useCallback(async () => {
    if (!doctorId) {
      setRequests([]);
      return;
    }
    try {
      setLoadingRequests(true);
      const res = await fetch(`${API_BASE_URL}hms/users/data/onco-pathology/pathology-requests?doctor_id=${encodeURIComponent(doctorId)}`);
      const data = await res.json();
      setRequests(data.status === "success" ? data.requests || [] : []);
    } catch {
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, [doctorId]);

  useEffect(() => {
    fetchRequests();
    const refresh = () => fetchRequests();
    window.addEventListener("pathologyRequestChanged", refresh);
    return () => window.removeEventListener("pathologyRequestChanged", refresh);
  }, [fetchRequests]);

  useEffect(() => () => {
    detailTokenRef.current += 1;
  }, []);

  const closeRequest = () => {
    detailTokenRef.current += 1;
    setSelectedRequest(null);
    setLoadingDetail(false);
    setDetailError("");
  };

  const viewRequest = async (request) => {
    const requestToken = detailTokenRef.current + 1;
    detailTokenRef.current = requestToken;
    setSelectedRequest(request);
    setLoadingDetail(true);
    setDetailError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/onco-pathology/pathology-requests/${encodeURIComponent(request.request_id)}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.detail || data.message || "Unable to load pathology request");
      if (detailTokenRef.current === requestToken) setSelectedRequest(data.request || request);
    } catch (err) {
      if (detailTokenRef.current === requestToken) setDetailError(err.message || "Unable to load pathology request.");
    } finally {
      if (detailTokenRef.current === requestToken) setLoadingDetail(false);
    }
  };

  const continueRequest = (request) => {
    if (!doctorId || !request?.patient_id || !request?.request_id || request.active_case) return;
    navigate(`/dashboard?doctor_id=${encodeURIComponent(doctorId)}&patient_id=${encodeURIComponent(request.patient_id)}&pathology_request_id=${encodeURIComponent(request.request_id)}`);
  };

  const declineRequest = async (request) => {
    const reason = window.prompt("Reason for declining this pathology request (required):", "");
    if (!reason || !reason.trim()) {
      setToast({ message: "A decline reason is required.", type: "error" });
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/onco-pathology/pathology-request/${encodeURIComponent(request.request_id)}/decline`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.detail || data.message || "Unable to decline request");
      setToast({ message: "Pathology request declined.", type: "success" });
      closeRequest();
      fetchRequests();
    } catch (err) {
      setToast({ message: err.message || "Unable to decline request.", type: "error" });
    }
  };

  return (
    <>
      <div style={S.tableSection}>
        <div style={S.tableHeader}>
          <span style={S.tableHeaderTitle}>Pending Pathology Requests</span>
          <span style={S.tableHeaderMeta}>{requests.length} request{requests.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                {["Patient", "Request Type", "Referring Department", "Requester", "Priority / Date", "Status", "Actions"].map((heading) => (
                  <th key={heading} style={S.th}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingRequests ? (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>Loading pathology requests...</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: "2rem", color: T.textMuted }}>No pending pathology requests</td></tr>
              ) : requests.map((request) => (
                <tr key={request.request_id} className="da-tbl-row">
                  <td style={S.td}>{request.patient_name || request.patient_id || "-"}</td>
                  <td style={S.td}>{request.request_type || "-"}</td>
                  <td style={S.td}>{request.referring_department || "-"}</td>
                  <td style={S.td}>{request.requester_doctor_name || request.requester_doctor_id || "-"}</td>
                  <td style={S.td}>{request.priority || "Routine"} / {formatDate(request.created_at)}</td>
                  <td style={S.td}><span style={S.badge}>{request.status || "pending"}</span></td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    <button className="da-action-btn" style={S.actionBtn} onClick={() => viewRequest(request)}>View</button>
                    <button className="da-outline-btn" style={{ ...S.outlineBtn, marginLeft: 6 }} onClick={() => declineRequest(request)}>Decline</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRequest && (
        <RequestModal
          request={selectedRequest}
          loading={loadingDetail}
          error={detailError}
          onClose={closeRequest}
          onContinue={continueRequest}
          onDecline={declineRequest}
        />
      )}

      <RequestToast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: "", type: "" })}
      />
    </>
  );
}
