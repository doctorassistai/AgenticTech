
import { useState, useEffect, useCallback, useRef } from "react";
import ClaimVerificationStep from "../components/doctor_review/ClaimVerificationStep";
import DocumentVerificationStep from "../components/doctor_review/DocumentVerificationStep";
import AgentStep from "../components/doctor_review/AgentStep";
// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_BACKEND_URL;

const STATUS_META = {
  VERIFIED:        { label: "Verified",       bg: "#DBEAFE", color: "#1E40AF" },
  DOCTOR_APPROVED: { label: "Approved",       bg: "#DCFCE7", color: "#166534" },
  DOCTOR_REJECTED: { label: "Rejected",       bg: "#FEE2E2", color: "#991B1B" },
  INFO_REQUESTED:  { label: "Info Requested", bg: "#FEF9C3", color: "#854D0E" },
  PARTIAL:         { label: "Partial",        bg: "#FEF9C3", color: "#854D0E" },
  PENDING:         { label: "Pending",        bg: "#F3F4F6", color: "#6B7280" },
  COMPLETED:       { label: "Completed",      bg: "#DCFCE7", color: "#166534" },
  ALLOCATED:       { label: "Allocated",      bg: "#EDE9FE", color: "#5B21B6" },
};

const PRIORITY_COLOR = {
  Critical: "#DC2626", High: "#EA580C", Urgent: "#BE185D", Normal: "#6B7280",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
const sm  = (s) => STATUS_META[s] || STATUS_META.PENDING;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}hms/app/doctor${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) { window.location.href = "/"; return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Verification state hook ────────────────────────────────────────────────────

function useVerificationState(caseId) {
  const [state, setState] = useState({ fields: {}, documents: {} });
  const pendingRef  = useRef({});
  const flushTimer  = useRef(null);

  const reset = useCallback((serverVerif) => {
    setState({
      fields:    serverVerif?.fields    || {},
      documents: serverVerif?.documents || {},
    });
    pendingRef.current = {};
  }, []);

  const toggle = useCallback((key, kind, nextVal) => {
    setState(prev => {
      const section = kind === "field" ? "fields" : "documents";
      const updated = { ...prev[section] };
      if (nextVal === null || nextVal === undefined) delete updated[key];
      else updated[key] = nextVal;
      return { ...prev, [section]: updated };
    });

    pendingRef.current[`${kind}:${key}`] = { key, kind, verified: nextVal ?? null };
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const batch = Object.values(pendingRef.current);
      if (!batch.length || !caseId) return;
      pendingRef.current = {};
      apiFetch(`/claims/${caseId}/verify/bulk`, {
        method: "POST",
        body: JSON.stringify({ verifications: batch }),
      }).catch(() => {});
    }, 600);
  }, [caseId]);

  const getVal = useCallback((key, kind) =>
    kind === "field" ? state.fields[key] : state.documents[key], [state]);

  return { toggle, getVal, state, reset };
}

// ── Tiny shared UI ─────────────────────────────────────────────────────────────

function Badge({ status, size = "sm" }) {
  const m = sm(status);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: size === "xs" ? "2px 6px" : "3px 9px",
      borderRadius: 99, fontSize: size === "xs" ? 10 : 11,
      fontWeight: 700, background: m.bg, color: m.color, whiteSpace: "nowrap",
    }}>{m.label}</span>
  );
}

function Spinner({ size = 18, color = "#374151" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid #E5E7EB`, borderTopColor: color,
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

// ── Step breadcrumb ────────────────────────────────────────────────────────────

function StepBreadcrumb({ step, isCritical }) {
  const steps = isCritical
    ? [{ n: 1, label: "Claim Data" }]
    : [
        { n: 1, label: "Claim Data" },
        { n: 2, label: "Documents" },
        { n: 3, label: "Agent" },
      ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 20px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
            </svg>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800,
              background: step === s.n
                ? "linear-gradient(135deg,#1D4ED8,#7C3AED)"
                : step > s.n ? "#DCFCE7" : "#E2E8F0",
              color: step === s.n ? "#fff" : step > s.n ? "#166534" : "#94A3B8",
            }}>
              {step > s.n ? "✓" : s.n}
            </div>
            <span style={{
              fontSize: 11, fontWeight: step === s.n ? 700 : 500,
              color: step === s.n ? "#1D4ED8" : step > s.n ? "#166534" : "#94A3B8",
            }}>{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Sidebar claim card ─────────────────────────────────────────────────────────

function ClaimCard({ claim, selected, onClick }) {
  const pc = PRIORITY_COLOR[claim.priority] || "#6B7280";
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "12px 14px",
        background: selected ? "#EFF6FF" : "transparent",
        borderLeft: selected ? "3px solid #2563EB" : "3px solid transparent",
        border: "none", borderBottom: "1px solid #F3F4F6", cursor: "pointer",
      }}
      onMouseEnter={e => !selected && (e.currentTarget.style.background = "#F9FAFB")}
      onMouseLeave={e => !selected && (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", fontFamily: "monospace" }}>{claim.id}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {claim.disputedCount > 0 && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: "#FEE2E2", color: "#991B1B" }}>✗ {claim.disputedCount}</span>
          )}
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: pc }} />
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 2 }}>{claim.claimantName}</div>
      <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>{claim.type}</div>
      <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 6 }}>{claim.insurer} · {fmt(claim.claimedAmount)}</div>
      <div style={{ height: 3, background: "#E5E7EB", borderRadius: 99, overflow: "hidden", marginBottom: 6 }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${claim.docsTotal > 0 ? Math.round((claim.docsSubmitted / claim.docsTotal) * 100) : 0}%`, background: "#3B82F6" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Badge status={claim.status} size="xs" />
        {claim.priority === "Critical" && (
          <span style={{ fontSize: 9, fontWeight: 800, color: "#DC2626", padding: "1px 6px", background: "#FEE2E2", borderRadius: 99 }}>⚡ Critical</span>
        )}
      </div>
    </button>
  );
}

// ── Main claim header (top of right panel) ─────────────────────────────────────

function ClaimHeader({ detail }) {
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #E2E8F0", padding: "14px 20px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", fontFamily: "monospace" }}>{detail.id}</span>
            <Badge status={detail.status} />
            {detail.priority && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                background: detail.priority === "Critical" ? "#FEE2E2" : "#FEF3C7",
                color: PRIORITY_COLOR[detail.priority] || "#6B7280",
              }}>{detail.priority}</span>
            )}
            {detail.tags?.map(t => (
              <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "#F1F5F9", color: "#64748B", fontWeight: 600 }}>{t}</span>
            ))}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", marginBottom: 3 }}>{detail.claimantName}</div>
          <div style={{ fontSize: 12, color: "#64748B", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{detail.type}</span>
            <span style={{ color: "#CBD5E1" }}>·</span>
            <span>{detail.insurer}</span>
            <span style={{ color: "#CBD5E1" }}>·</span>
            <span style={{ fontWeight: 700, color: "#0F172A" }}>{fmt(detail.claimedAmount)}</span>
            {detail.sumInsured && (
              <><span style={{ color: "#CBD5E1" }}>·</span><span style={{ fontSize: 11, color: "#94A3B8" }}>SI: {fmt(detail.sumInsured)}</span></>
            )}
          </div>
          {detail.qcRemarks && (
            <div style={{ marginTop: 7, fontSize: 11, color: "#1D4ED8", background: "#EFF6FF", borderRadius: 7, padding: "5px 10px", display: "inline-flex", gap: 6, border: "1px solid #BFDBFE" }}>
              <span style={{ fontWeight: 700 }}>QC:</span> {detail.qcRemarks}
            </div>
          )}
          {detail.doctorDecision && (
            <div style={{
              marginTop: 7, padding: "7px 11px", borderRadius: 7, fontSize: 11, display: "inline-flex", gap: 6,
              background: detail.doctorDecision.action === "APPROVE" ? "#F0FDF4" : detail.doctorDecision.action === "REJECT" ? "#FEF2F2" : "#FAF5FF",
              border: `1px solid ${detail.doctorDecision.action === "APPROVE" ? "#BBF7D0" : detail.doctorDecision.action === "REJECT" ? "#FECACA" : "#DDD6FE"}`,
            }}>
              <span style={{ fontWeight: 700, color: "#374151" }}>Previous:</span>
              <span style={{ color: detail.doctorDecision.action === "APPROVE" ? "#16A34A" : detail.doctorDecision.action === "REJECT" ? "#DC2626" : "#7C3AED", fontWeight: 700 }}>
                {detail.doctorDecision.action}
              </span>
              {(detail.doctorDecision.diagnosis || detail.doctorDecision.reason || detail.doctorDecision.message) && (
                <span style={{ color: "#64748B" }}> — {detail.doctorDecision.diagnosis || detail.doctorDecision.reason || detail.doctorDecision.message}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>
            {detail.docsSubmitted}<span style={{ fontSize: 13, color: "#94A3B8", fontWeight: 400 }}>/{detail.docsTotal}</span>
          </div>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 1 }}>docs received</div>
          {detail.verifiedAt && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>QC: {detail.verifiedAt}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Main DoctorReview ──────────────────────────────────────────────────────────

export default function DoctorReview() {
  const [doctor, setDoctor]           = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [claims, setClaims]           = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch]           = useState("");
  const searchTimer                   = useRef(null);
  const [selectedId, setSelectedId]   = useState(null);
  const [detail, setDetail]           = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Multi-step flow state
  const [step, setStep]               = useState(1);  // 1 | 2 | 3
  const [submitting, setSubmitting]   = useState(false);
  const [toast, setToast]             = useState(null);

  const verif = useVerificationState(selectedId);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Auth check
  useEffect(() => {
    apiFetch("/me").then(data => {
      if (data) { setDoctor(data); setAuthChecked(true); }
    }).catch(() => { window.location.href = "/"; });
  }, []);

  const loadClaims = useCallback(async (q = "") => {
    setLoadingList(true);
    try {
      const data = await apiFetch(`/claims${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      setClaims(data?.claims || []);
    } catch (e) { showToast(`Failed to load claims: ${e.message}`, "error"); }
    finally { setLoadingList(false); }
  }, []);

  useEffect(() => { if (authChecked) loadClaims(); }, [authChecked, loadClaims]);

  const loadDetail = useCallback(async (id) => {
    setLoadingDetail(true);
    setDetail(null);
    setStep(1);
    try {
      const data = await apiFetch(`/claims/${id}`);
      setDetail(data);
      const serverFields = {};
      const serverDocs   = {};
      for (const f of data.claimFields || []) {
        if (f.verified !== null && f.verified !== undefined) serverFields[f.key] = f.verified;
      }
      for (const [, inv] of Object.entries(data.investigations || {})) {
        for (const doc of inv.docs || []) {
          if (doc.verified !== null && doc.verified !== undefined) serverDocs[doc.doc_key] = doc.verified;
        }
      }
      verif.reset({ fields: serverFields, documents: serverDocs });
    } catch (e) { showToast(`Failed to load claim: ${e.message}`, "error"); }
    finally { setLoadingDetail(false); }
  }, []);

  const selectClaim = (id) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const handleSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadClaims(v), 350);
  };

  // Flush any pending verifications immediately before proceeding
  const flushVerif = async () => {
    // The debounced flush inside useVerificationState handles persistence.
    // Here we just do a final bulk save of the current state.
    const verifications = [];
    for (const [key, val] of Object.entries(verif.state.fields || {})) {
      verifications.push({ key, kind: "field", verified: val });
    }
    for (const [key, val] of Object.entries(verif.state.documents || {})) {
      verifications.push({ key, kind: "document", verified: val });
    }
    if (!verifications.length || !selectedId) return;
    try {
      await apiFetch(`/claims/${selectedId}/verify/bulk`, {
        method: "POST",
        body: JSON.stringify({ verifications }),
      });
    } catch (e) {
      // non-fatal
    }
  };

  // Step 1 submit (Critical — final)
  const handleStep1Submit = async () => {
    setSubmitting(true);
    await flushVerif();
    setSubmitting(false);
    showToast("Verification saved successfully");
    loadClaims(search);
  };

  // Step 1 → 2
  const handleStep1Continue = async () => {
    setSubmitting(true);
    await flushVerif();
    setSubmitting(false);
    setStep(2);
  };

  // Step 2 → 3
  const handleStep2Continue = async () => {
    setSubmitting(true);
    await flushVerif();
    setSubmitting(false);
    setStep(3);
  };

  const isCritical = detail?.priority === "Critical";

  if (!authChecked) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, fontFamily: "'DM Sans', sans-serif", color: "#9CA3AF" }}>
        <Spinner size={28} /><div style={{ fontSize: 13 }}>Verifying session...</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 99px; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        button, textarea, input { font-family: 'DM Sans', sans-serif; }
        label { cursor: pointer; }
      `}</style>

      <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', sans-serif", background: "#F1F5F9" }}>

        {/* ── SIDEBAR ── */}
        <div style={{ width: 268, flexShrink: 0, background: "#fff", borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", height: "100vh" }}>
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #E5E7EB" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #3B82F6, #1D4ED8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#111827" }}>Doctor Portal</div>
                <div style={{ fontSize: 10, color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doctor?.full_name || doctor?.username || "—"}
                </div>
              </div>
              <a href="/" style={{ border: "1px solid #E5E7EB", borderRadius: 7, background: "#F9FAFB", padding: "5px 7px", cursor: "pointer", color: "#9CA3AF", display: "flex", alignItems: "center", textDecoration: "none" }} title="Sign out">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                  <polyline points="16,17 21,12 16,7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </a>
            </div>
            <div style={{ fontSize: 10, color: "#9CA3AF" }}>{claims.length} assigned claim{claims.length !== 1 ? "s" : ""}</div>
          </div>

          <div style={{ padding: "10px 10px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#F3F4F6", borderRadius: 8, padding: "7px 10px" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search ID or name..." style={{ border: "none", background: "transparent", fontSize: 12, color: "#111827", outline: "none", width: "100%" }} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingList ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spinner /></div>
            ) : claims.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#9CA3AF" }}>No claims assigned</div>
            ) : (
              claims.map(c => (
                <ClaimCard
                  key={c.id}
                  claim={c}
                  selected={c.id === selectedId}
                  onClick={() => selectClaim(c.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── MAIN PANEL ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>

          {!selectedId ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "#9CA3AF" }}>
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
              <div style={{ fontSize: 15, color: "#64748B", fontWeight: 600 }}>Select a claim to review</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", maxWidth: 280, textAlign: "center", lineHeight: 1.6 }}>
                Verify claim data, review investigator submissions, then run the AI agent analysis
              </div>
            </div>

          ) : loadingDetail ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#9CA3AF" }}>
              <Spinner size={28} /><div style={{ fontSize: 13 }}>Loading claim...</div>
            </div>

          ) : detail ? (
            <>
              {/* Sticky claim info header */}
              <ClaimHeader detail={detail} />

              {/* Step breadcrumb */}
              <StepBreadcrumb step={step} isCritical={isCritical} />

              {/* Step content — fills remaining height */}
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {step === 1 && (
                  <ClaimVerificationStep
                    detail={detail}
                    verifState={verif.state}
                    onToggle={verif.toggle}
                    onSubmit={handleStep1Submit}
                    onSubmitContinue={handleStep1Continue}
                    submitting={submitting}
                  />
                )}
                {step === 2 && (
                  <DocumentVerificationStep
                    detail={detail}
                    verifState={verif.state}
                    onToggle={verif.toggle}
                    onBack={() => setStep(1)}
                    onSubmitContinue={handleStep2Continue}
                    submitting={submitting}
                  />
                )}
                {step === 3 && (
                  <AgentStep
                    detail={detail}
                    verifState={verif.state}
                    onBack={() => setStep(2)}
                  />
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 999,
          padding: "12px 18px", borderRadius: 10,
          background: toast.type === "error" ? "#DC2626" : "#16A34A",
          color: "#fff", fontSize: 13, fontWeight: 600,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)", maxWidth: 360,
          animation: "slideUp 0.2s ease",
        }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}