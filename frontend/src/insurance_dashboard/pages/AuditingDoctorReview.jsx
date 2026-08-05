import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useExtractionEvents } from "./ExtractionNotifications";

const BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME (matches DoctorDashboard) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  accent: "#000000",
  success: "#2e7d32",
  warning: "#ed6c02",
  error: "#d32f2f",
  purple: "#7c3aed",
};

const b = (BASE_URL || "").replace(/\/$/, "");

/* ─── Status pill ─── */
function StatusPill({ color, spin, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color, fontWeight: 600 }}>
      {spin
        ? <span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        : <span>●</span>}
      {children}
    </span>
  );
}

/* ─── Page checklist (no thumbnails — plain numbered checkboxes) ─── */
function PageChecklist({ pageCount, selected, onToggle, onSelectAll, onClearAll }) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px", background: T.bgAlt, border: `1px solid ${T.border}`,
        borderBottom: "none",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.text }}>
          Select pages ({selected.size}/{pageCount})
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onSelectAll} style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: T.text, cursor: "pointer", textDecoration: "underline", padding: 0 }}>All</button>
          <button type="button" onClick={onClearAll} style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: T.textMuted, cursor: "pointer", textDecoration: "underline", padding: 0 }}>None</button>
        </div>
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 6, flex: 1, overflowY: "auto",
        padding: 10, border: `1px solid ${T.border}`, background: "#fff",
      }}>
        {pages.map(p => {
          const isSel = selected.has(p);
          return (
            <label key={p} style={{
              display: "flex", alignItems: "center", gap: 4, fontSize: 11,
              padding: "3px 8px", cursor: "pointer",
              border: `1px solid ${isSel ? T.text : T.border}`,
              background: isSel ? T.text : "#fff",
              color: isSel ? "#fff" : T.textSec, fontWeight: isSel ? 700 : 400,
            }}>
              <input type="checkbox" checked={isSel} onChange={() => onToggle(p)} style={{ margin: 0 }} />
              {p}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ─── One staged Supporting Document — PDF viewer + page picker + extract ─── */
function StagedDocumentCard({ doc, doctorId, caseId, onExtracted }) {
  const pageCount = doc.page_count || 1;
  const [selected, setSelected] = useState(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
  const [status, setStatus] = useState("idle"); // idle | queued | polling | done | error
  const [errorMsg, setErrorMsg] = useState("");

  const toggle = (p) => setSelected(prev => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });
  const selectAll = () => setSelected(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
  const clearAll  = () => setSelected(new Set());

  const pollStatus = async (taskId) => {
    const start = Date.now();
    while (Date.now() - start < 5 * 60 * 1000) {
      const resp = await fetch(`${b}/insurance/web/advanced-upload/status/${taskId}`, {
        headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
      });
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      const data = await resp.json();
      if (data.status === "success") return data.result;
      if (data.status === "failed") throw new Error(data.error || "Extraction failed");
      if (data.status === "rejected") throw new Error(data.error || "This file is already being processed.");
      await new Promise(r => setTimeout(r, 2500));
    }
    throw new Error("Extraction is taking longer than expected — check back shortly.");
  };

  const handleExtract = async () => {
    if (selected.size === 0) return;
    setStatus("queued");
    setErrorMsg("");
    try {
      const resp = await fetch(`${b}/insurance/web/advanced-upload/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        body: JSON.stringify({
          case_id: caseId,
          doc_id: doc.doc_id,
          pages: Array.from(selected).sort((a, c) => a - c),
          email_text: "",
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null);
        throw new Error(errBody?.detail || `Extraction failed: ${resp.status}`);
      }
      const queued = await resp.json();
      if (!queued.task_id) throw new Error("No task_id returned");

      setStatus("polling");
      const result = await pollStatus(queued.task_id);
      if (!result || !result.success) throw new Error("Extraction returned empty result");

      setStatus("done");
      onExtracted(doc.doc_id, result);
    } catch (err) {
      console.error("Extraction error", err);
      setErrorMsg(err.message || "Extraction failed");
      setStatus("error");
    }
  };

  if (status === "done") return null; // removed from staged list once extracted —
  // its outcome lives on in the "Recent extraction activity" section below,
  // driven by the shared extraction context, so it's visible even after
  // navigating away and back.

  return (
    <div style={{ border: `1px solid ${T.border}`, marginBottom: 16 }}>
      <div style={{
        padding: "8px 14px", background: T.bgAlt, borderBottom: `1px solid ${T.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{doc.file_name}</div>
          <div style={{ fontSize: 10, color: T.textMuted }}>
            {doc.display_label} · {pageCount} page{pageCount !== 1 ? "s" : ""}
          </div>
        </div>
        {status === "idle" && <StatusPill color={T.textMuted}>Awaiting review</StatusPill>}
        {status === "queued" && <StatusPill color={T.warning} spin>Queuing…</StatusPill>}
        {status === "polling" && <StatusPill color={T.warning} spin>Parsing & extracting…</StatusPill>}
        {status === "error" && <StatusPill color={T.error}>Failed</StatusPill>}
      </div>

      <div style={{ display: "flex", gap: 16, padding: 14, alignItems: "stretch", height: 720 }}>
        <div style={{ flex: "1 1 50%", minWidth: 340, display: "flex", flexDirection: "column" }}>
          <div style={{
            padding: "8px 14px", background: T.bgAlt, border: `1px solid ${T.border}`, borderBottom: "none",
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.text }}>
              Document preview
            </span>
          </div>
          {doc.stored_url ? (
            <iframe
              src={doc.stored_url}
              title={doc.file_name}
              style={{ width: "100%", flex: 1, border: `1px solid ${T.border}` }}
            />
          ) : (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: T.textMuted, fontSize: 12, border: `1px solid ${T.border}`,
            }}>Preview not available</div>
          )}
        </div>

        <div style={{ flex: "1 1 50%", minWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
          <PageChecklist
            pageCount={pageCount}
            selected={selected}
            onToggle={toggle}
            onSelectAll={selectAll}
            onClearAll={clearAll}
          />

          {errorMsg && (
            <div style={{ fontSize: 11, color: T.error }}>{errorMsg}</div>
          )}

          <button
            onClick={handleExtract}
            disabled={selected.size === 0 || status === "queued" || status === "polling"}
            style={{
              padding: "9px 14px", background: T.text, color: "#fff", border: "none",
              fontSize: 11, fontWeight: 700, cursor: selected.size === 0 ? "not-allowed" : "pointer",
              opacity: (selected.size === 0 || status === "queued" || status === "polling") ? 0.5 : 1,
              letterSpacing: "0.04em", textTransform: "uppercase",
            }}
          >
            {status === "queued" || status === "polling"
              ? "Extracting…"
              : status === "error"
                ? `Retry Extraction (${selected.size}/${pageCount})`
                : `Extract Selected (${selected.size}/${pageCount})`}
          </button>

          <div style={{ fontSize: 10, color: T.textMuted }}>
            Only the pages you check are sent for parsing & extraction. Extracted fields override
            existing values on this claim.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Recent extraction activity — persistent success/failure log for this
   case, sourced from the shared extraction context. Unlike the staged-list
   (which drops a document the moment extraction is queued, success or
   failure), this stays populated as long as the backend's event window
   covers it — so it survives switching cases, navigating to the PDF editor
   and back, or a full page reload. ─── */
function RecentExtractionActivity({ caseId }) {
  const { eventsByDocId } = useExtractionEvents();
  const events = Object.values(eventsByDocId)
    .filter((e) => e.case_id === caseId)
    .sort((a, c) => new Date(c.completed_at) - new Date(a.completed_at));

  if (events.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text, marginBottom: 8 }}>
        Recent Extraction Activity
      </div>
      {events.map((ev) => {
        const isSuccess = ev.status === "success";
        return (
          <div
            key={ev.task_id}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: 10, padding: "8px 12px", marginBottom: 6,
              border: `1px solid ${T.border}`,
              borderLeft: `3px solid ${isSuccess ? T.success : T.error}`,
              background: T.bg,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ev.display_label || ev.file_name}
              </div>
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                {isSuccess
                  ? `${ev.fields_found ?? 0} field(s) merged into the claim.`
                  : (ev.error || "Extraction failed.")}
              </div>
            </div>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 8px", whiteSpace: "nowrap",
              background: isSuccess ? T.success : T.error, color: "#fff",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              {isSuccess ? "Extracted" : "Failed"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Doctor Document Review — replaces the old field-display CaseDetail ─── */
function DoctorDocumentReview({ caseId, doctorId }) {
  const [caseHeader, setCaseHeader] = useState(null);
  const [staged, setStaged] = useState([]);
  const [loading, setLoading] = useState(false);
  const [justExtracted, setJustExtracted] = useState([]);
  const navigate = useNavigate();

  const fetchAll = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const [caseResp, stagedResp] = await Promise.all([
        fetch(`${b}/insurance/web/doctor/case/${caseId}`, {
          headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        }),
        fetch(`${b}/insurance/web/advanced-upload/staged-list/${caseId}`, {
          headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        }),
      ]);
      const caseData = await caseResp.json();
      setCaseHeader(caseData.case || null);

      if (stagedResp.ok) {
        const stagedData = await stagedResp.json();
        setStaged(stagedData.documents || []);
      } else {
        setStaged([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [caseId, doctorId]);

useEffect(() => {
  fetchAll();
  const interval = setInterval(fetchAll, 6000);
  return () => clearInterval(interval);
}, [fetchAll]);

  const handleExtracted = (docId, result) => {
    setStaged(prev => prev.filter(d => d.doc_id !== docId));
    setJustExtracted(prev => [
      { docId, label: result.display_label, fieldsFound: result.fields_found || 0 },
      ...prev,
    ]);
  };

  if (loading && !caseHeader) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
        <div style={{ width: 24, height: 24, border: `2px solid ${T.border}`, borderTopColor: T.text, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      </div>
    );
  }

  if (!caseHeader) return null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{
        background: T.text, padding: "16px 20px", marginBottom: 20,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 300, color: "#fff" }}>{caseHeader.claimantName || "—"}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2, fontFamily: "monospace" }}>
            {caseHeader.caseId}
          </div>
        </div>
        <button
          onClick={() => navigate(`/insurance/doctor/pdf-editor/${caseId}`)}
          style={{
            padding: "5px 14px", background: "#fff", border: "1px solid rgba(255,255,255,0.4)",
            color: "#000", fontSize: 10, fontWeight: 600, cursor: "pointer",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}
        >
          Review the case
        </button>
      </div>

      {justExtracted.length > 0 && (
        <div style={{
          marginBottom: 16, padding: "10px 14px",
          background: "color-mix(in srgb, #16a34a 8%, transparent)",
          border: "1px solid color-mix(in srgb, #16a34a 25%, transparent)",
        }}>
          {justExtracted.map((j, i) => (
            <div key={i} style={{ fontSize: 12, color: T.success }}>
              ✓ {j.label || "Document"} extracted — {j.fieldsFound} field(s) merged into the claim.
            </div>
          ))}
        </div>
      )}

      {/* Persistent success/failure log — survives leaving and returning to
          this case, or navigating to "Review the case" and coming back. */}
      <RecentExtractionActivity caseId={caseId} />

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text }}>
          Supporting Documents Awaiting Review
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
          Uploaded by the allocation team for this case. Open each document, pick the relevant pages, and run extraction.
        </div>
      </div>

      {staged.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", border: `1px solid ${T.border}`, background: T.bgAlt }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
          <div style={{ fontSize: 12, color: T.textMuted }}>No supporting documents pending review for this case.</div>
        </div>
      ) : (
        staged.map(doc => (
          <StagedDocumentCard
            key={doc.doc_id}
            doc={doc}
            doctorId={doctorId}
            caseId={caseId}
            onExtracted={handleExtracted}
          />
        ))
      )}
    </div>
  );
}

/* ─── Case Card Component ─── */
function CaseCard({ c, onSelect, selected, extracting, extractionEvent }) {
  const priorityColors = {
    Critical: { bg: "#000", text: "#fff" },
    Urgent: { bg: "#333", text: "#fff" },
    High: { bg: "#555", text: "#fff" },
    Normal: { bg: T.bgTert, text: T.textSec },
  };
  const pc = priorityColors[c.claimPriority] || priorityColors.Normal;

  // extracting (server-confirmed, in-flight) always wins visually over a
  // stale finished event for the same case.
  const showFinished = !extracting && extractionEvent;
  const finishedIsSuccess = showFinished && extractionEvent.status === "success";

  return (
    <div
      onClick={() => onSelect(c.caseId)}
      style={{
        padding: "12px 14px",
        cursor: "pointer",
        borderBottom: `1px solid ${T.border}`,
        background: selected ? T.bgAlt : T.bg,
        borderLeft: selected ? `3px solid ${T.text}` : "3px solid transparent",
        transition: "all 0.12s",
      }}
    >
     <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{ fontWeight: 400, fontSize: 13, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {c.claimantName || "—"}
    </div>
    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2, fontFamily: "monospace" }}>{c.insurerRef || "—"}</div>
  </div>
  <span
    style={{
            fontSize: 9,
            fontWeight: 400,
            padding: "2px 7px",
            background: pc.bg,
            color: pc.text,
            border: `1px solid ${T.border}`,
            whiteSpace: "nowrap",
            marginLeft: 8,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {c.claimPriority || "Normal"}
        </span>
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, padding: "2px 7px", background: T.bgTert, color: T.textSec, border: `1px solid ${T.border}` }}>
          {c.insurer || "—"}
        </span>
        <span style={{ fontSize: 9, padding: "2px 7px", background: T.bgTert, color: T.textSec, border: `1px solid ${T.border}` }}>
          {c.claimMode || "—"}
        </span>
        {c.has_markdown && (
          <span style={{ fontSize: 9, padding: "2px 7px", background: "#000", color: "#fff", border: "none" }}>📄 Doc</span>
        )}
        {extracting && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, color: T.warning }}>
            <span style={{
              display: "inline-block", width: 7, height: 7, border: `2px solid ${T.warning}`,
              borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite",
            }} />
            Extracting
          </span>
        )}
        {showFinished && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700,
            color: finishedIsSuccess ? T.success : T.error,
          }}>
            {finishedIsSuccess ? "✓ Extracted" : "✕ Extraction failed"}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 5 }}>
        {c.hospitalDetails?.name || "—"} &nbsp;·&nbsp; ₹{(c.claimedAmount || 0).toLocaleString("en-IN")}
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function AuditingDoctorReview() {
  const navigate = useNavigate();
  const doctorId = localStorage.getItem("user_id") || "";
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("All");

  // Extraction state (active + finished) now comes from the shared,
  // app-root-mounted context — it keeps polling regardless of which page is
  // mounted, so "Extracting…" and the finished ✓/✕ badge both stay accurate
  // even if the doctor left this page and came back.
  const { activeCaseIds, eventsByCaseId } = useExtractionEvents();

  useEffect(() => {
    fetch(`${BASE_URL}insurance/web/doctor/my-cases`, {
      headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
    })
      .then((r) => r.json())
      .then((d) => setCases(d.cases || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [doctorId]);

  const filtered = cases.filter((c) => {
    const matchSearch =
      !search ||
      (c.claimantName || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.caseId || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.insurer || "").toLowerCase().includes(search.toLowerCase());
    const matchPriority = filterPriority === "All" || c.claimPriority === filterPriority;
    return matchSearch && matchPriority;
  });

  const priorities = ["All", "Critical", "Urgent", "High", "Normal"];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Open Sans', sans-serif; font-weight: 300; background: ${T.bgTert}; color: ${T.text}; -webkit-font-smoothing: antialiased; }
        ::selection { background: #000; color: #fff; }
        .case-card:hover { background: ${T.bgAlt} !important; }
        .prio-btn:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; }
        ::-webkit-scrollbar-thumb:hover { background: ${T.textMuted}; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bgTert }}>
        {/* Top bar */}
        <div
          style={{
            background: T.bg,
            borderBottom: `1px solid ${T.border}`,
            padding: "0 20px",
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            zIndex: 100,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 28, height: 28, background: T.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 13 }}>⚕</span>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 400, color: T.text, letterSpacing: "-0.01em" }}>Auditing Doctor Portal</div>
              <div style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Case Review Dashboard</div>
            </div>
          </div>
          <button
            onClick={() => {
              localStorage.clear();
              navigate("/login");
            }}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              color: T.textSec,
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "'Open Sans', sans-serif",
              fontWeight: 300,
              letterSpacing: "0.04em",
            }}
          >
            Sign Out
          </button>
        </div>

        <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
          {/* Left panel */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              background: T.bg,
              borderRight: `1px solid ${T.border}`,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "12px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 400, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Assigned Cases
                </span>
                <span style={{ fontSize: 10, color: T.textMuted }}>{cases.length}</span>
              </div>
              <input
                type="text"
                placeholder="Search name, case ID, insurer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  border: `1px solid ${T.border}`,
                  fontSize: 11,
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 300,
                  color: T.text,
                  background: T.bgAlt,
                  outline: "none",
                  borderRadius: 0,
                }}
              />
            </div>

            <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {priorities.map((p) => (
                <button
                  key={p}
                  className="prio-btn"
                  onClick={() => setFilterPriority(p)}
                  style={{
                    fontSize: 9,
                    padding: "2px 8px",
                    border: `1px solid ${filterPriority === p ? T.text : T.border}`,
                    background: filterPriority === p ? T.text : "transparent",
                    color: filterPriority === p ? "#fff" : T.textMuted,
                    cursor: "pointer",
                    fontFamily: "'Open Sans', sans-serif",
                    fontWeight: 300,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    transition: "all 0.12s",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      border: `2px solid ${T.border}`,
                      borderTopColor: T.text,
                      borderRadius: "50%",
                      margin: "0 auto 10px",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Loading…</div>
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{search ? "No cases match your search." : "No cases assigned yet."}</div>
                </div>
              ) : (
                filtered.map((c) => (
                  <CaseCard
                    key={c.caseId}
                    c={c}
                    selected={selected === c.caseId}
                    onSelect={setSelected}
                    extracting={activeCaseIds.has(c.caseId)}
                    extractionEvent={eventsByCaseId[c.caseId]}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right panel */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {selected ? (
              <DoctorDocumentReview caseId={selected} doctorId={doctorId} />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 40 }}>🔍</div>
                <div style={{ fontSize: 14, fontWeight: 300, color: T.textSec, letterSpacing: "-0.01em" }}>Select a case to review</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>Click any case from the list to view supporting documents.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}