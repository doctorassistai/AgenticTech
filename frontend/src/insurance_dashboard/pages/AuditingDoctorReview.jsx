import "./Dashboard.css";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useExtractionEvents } from "./ExtractionNotifications";

const BASE_URL = import.meta.env.VITE_BACKEND_URL;
const b = (BASE_URL || "").replace(/\/$/, "");

const PRIORITY_COLOR = { Normal: "gray", High: "amber", Urgent: "red", Critical: "red" };
const STATUS_COLOR = {
  ALLOCATED: "blue", IN_PROGRESS: "amber", EVIDENCE_COLLECTION: "amber",
  UNDER_REVIEW: "purple", QC_PENDING: "teal", COMPLETED: "green", CLOSED: "gray", DRAFT: "gray",
};

function fmtAmount(n) {
  if (!n && n !== 0) return "—";
  return "₹" + Number(n).toLocaleString("en-IN");
}
function fmtStatus(s) {
  return (s || "").replaceAll("_", " ");
}
// Whichever timestamp the case carries for "when it landed with this doctor" —
// falls back through the likely field names so the "Today" stat still works
// regardless of which one the my-cases endpoint actually returns.
function getAllocatedDate(c) {
  return c.assignedAt || c.allocatedAt || c.allocationDate || c.createdAt || null;
}
function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/* ─── Supporting-document status row — no actions except retry-on-failure.
   Extraction is queued automatically at upload time (in the supervisor's
   Case Document Upload panel), so by the time the doctor opens a case each
   Supporting Document is already Processing / Extracted / Failed — nothing
   here requires the doctor to pick pages or click Extract. ─── */
function SupportingDocStatusRow({ task, doctorId, onRetried }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  const status = task.status; // "queued" | "processing" | "success" | "failed" | "rejected"
  const isProcessing = status === "queued" || status === "processing";
  const isFailed = status === "failed";
  const isDone = status === "success";

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError("");
    try {
      const resp = await fetch(`${b}/insurance/web/advanced-upload/retry/${task.task_id}`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null);
        throw new Error(errBody?.detail || `Retry failed: ${resp.status}`);
      }
      onRetried();
    } catch (err) {
      console.error("Retry error", err);
      setRetryError(err.message || "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const accent = isDone ? "var(--green)" : isFailed ? "var(--red)" : "var(--amber)";

  return (
    <div
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, padding: "10px 14px", marginBottom: 8,
        border: "1px solid var(--border)", borderLeft: `3px solid ${accent}`,
        borderRadius: "var(--radius-sm, 8px)", background: "var(--bg)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="td-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {task.display_label || task.file_name}
        </div>
        <div className="td-sub" style={{ marginTop: 2 }}>
          {isDone && `${task.result?.fields_found ?? 0} field(s) merged into the claim.`}
          {isFailed && (retryError || task.error || "Extraction failed.")}
          {isProcessing && `${task.total_pages || 1} page(s) · parsing & extracting…`}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {isProcessing && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--amber)", fontWeight: 700 }}>
            <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid var(--amber)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
            Processing
          </span>
        )}
        {isDone && <span className="badge green">Extracted</span>}
        {isFailed && (
          <button className="btn btn-sm" onClick={handleRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "↺ Retry"}
          </button>
        )}
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
      <div className="sh">Recent Extraction Activity</div>
      {events.map((ev) => {
        const isSuccess = ev.status === "success";
        return (
          <div
            key={ev.task_id}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: 10, padding: "8px 12px", marginBottom: 6,
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${isSuccess ? "var(--green)" : "var(--red)"}`,
              borderRadius: "var(--radius-sm, 8px)", background: "var(--bg)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="td-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ev.display_label || ev.file_name}
              </div>
              <div className="td-sub" style={{ marginTop: 2 }}>
                {isSuccess ? `${ev.fields_found ?? 0} field(s) merged into the claim.` : (ev.error || "Extraction failed.")}
              </div>
            </div>
            <span className={`badge ${isSuccess ? "green" : "red"}`}>
              {isSuccess ? "Extracted" : "Failed"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Doctor Document Review — status-only, no page selection anywhere.
   Extraction was already queued the moment the Supporting Document was
   uploaded (supervisor side); this just shows where each one stands. ─── */
function DoctorDocumentReview({ caseId, doctorId, onClose }) {
  const [caseHeader, setCaseHeader] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchAll = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const [caseResp, statusResp] = await Promise.all([
        fetch(`${b}/insurance/web/doctor/case/${caseId}`, {
          credentials: "include",
        }),
        fetch(`${b}/insurance/web/advanced-upload/case-status/${caseId}`, {
          credentials: "include",
        }),
      ]);
      const caseData = await caseResp.json();
      setCaseHeader(caseData.case || null);

      if (statusResp.ok) {
        const statusData = await statusResp.json();
        setTasks(statusData.tasks || []);
      } else {
        setTasks([]);
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

  if (loading && !caseHeader) {
    return (
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
          <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        </div>
      </div>
    );
  }

  if (!caseHeader) return null;

  // Defense in depth alongside the backend filter: never let a
  // findings-only task (task_type === "findings") count toward "documents
  // still processing" here — that's a distinct background job and must
  // not disable "Review the case" for a case whose real documents are
  // already extracted.
  // doc_id, not task_type, is the reliable signal — some legacy findings
  // rows predate the task_type field entirely and would slip past a
  // task_type check.
  const processingCount = tasks.filter(
    (t) =>
      (t.status === "queued" || t.status === "processing") && t.doc_id != null
  ).length;
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <div className="dot" style={{ background: "var(--accent)" }} />
          {caseHeader.claimantName || "—"}
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>
            {caseHeader.caseId}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => navigate(`/insurance/doctor/pdf-editor/${caseId}`)}
            disabled={processingCount > 0}
            style={{
              padding: "7px 16px", background: "var(--accent)", color: "#fff",
              border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700,
              fontFamily: "inherit", whiteSpace: "nowrap",
              opacity: processingCount > 0 ? 0.5 : 1,
              cursor: processingCount > 0 ? "not-allowed" : "pointer",
            }}
          >
            {processingCount > 0 ? `Waiting on ${processingCount} document(s)…` : "Review the case"}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px", background: "transparent", color: "var(--muted)",
              border: "1px solid var(--border)", borderRadius: 6, fontSize: 12,
              fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      <div className="panel-body">
        {/* Persistent success/failure log — survives leaving and returning to
            this case, or navigating to "Review the case" and coming back. */}
        <RecentExtractionActivity caseId={caseId} />

        <div style={{ marginBottom: 12 }}>
          <div className="sh">Supporting Documents</div>
          <div className="td-sub">
            Uploaded by the allocation team for this case. Extraction is queued automatically — nothing to select here.
          </div>
        </div>

        {tasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 8px)", background: "var(--bg3)" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
            <div className="td-sub">No supporting documents for this case yet.</div>
          </div>
        ) : (
          tasks.map((task) => (
            <SupportingDocStatusRow key={task.task_id} task={task} doctorId={doctorId} onRetried={fetchAll} />
          ))
        )}
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

  // Extraction state (active + finished) comes from the shared, app-root
  // mounted context — it keeps polling regardless of which page is mounted,
  // so the per-row "Extracting…" / "Extracted" / "Failed" badge stays
  // accurate even if the doctor left this page and came back.
  const { activeCaseIds, eventsByCaseId } = useExtractionEvents();
  const [creditWarning, setCreditWarning] = useState(null);

  useEffect(() => {
    const checkCredits = () => {
      fetch(`${b}/insurance/web/llama-credit-status`)
        .then((r) => r.json())
        .then((d) => setCreditWarning(d.warning ? d : null))
        .catch(() => {});
    };
    checkCredits();
    const interval = setInterval(checkCredits, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}insurance/web/doctor/my-cases`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setCases(d.cases || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

  // A case counts as "extracted" if we have a live success event for it, OR
  // (when there's no live event at all — e.g. it was extracted in an earlier
  // session before this page was open) if the case itself already carries
  // extracted content. Live "failed"/"processing" events always take
  // priority over that persisted flag.
  const isCaseExtracted = useCallback(
    (c) => {
      const event = eventsByCaseId[c.caseId];
      if (event) return event.status === "success";
      return !!c.has_markdown;
    },
    [eventsByCaseId]
  );

  // Row-wise stats, same visual language as the allocation team's dashboard.
  const stats = useMemo(() => {
    const todayCount = cases.filter((c) => isToday(getAllocatedDate(c))).length;
    const extractedCount = cases.filter((c) => isCaseExtracted(c)).length;
    const failedCount = cases.filter((c) => eventsByCaseId[c.caseId]?.status === "failed").length;
    return [
      { label: "Total Cases", value: cases.length, color: "blue" },
      { label: "Allocated Today", value: todayCount, color: "purple" },
      { label: "Extracted", value: extractedCount, color: "green" },
      { label: "Extraction Failed", value: failedCount, color: "amber" },
    ];
  }, [cases, eventsByCaseId, isCaseExtracted]);

  const selectedCase = selected ? cases.find((c) => c.caseId === selected) : null;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .doctor-topbar {
          background: var(--bg); border-bottom: 1px solid var(--border);
          padding: 0 20px; height: 52px; display: flex; align-items: center;
          justify-content: space-between; position: sticky; top: 0; z-index: 100;
        }
        .doctor-mark {
          width: 28px; height: 28px; border-radius: 7px; background: var(--accent);
          display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px;
        }
        .doctor-case-row:hover { background: var(--bg3); }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg2, var(--bg3))" }}>
        {/* Top bar */}
        <div className="doctor-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div className="doctor-mark">⚕</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Auditing Doctor Portal</div>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Case Review Dashboard
              </div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              localStorage.clear();
              navigate("/login");
            }}
          >
            Sign Out
          </button>
        </div>

        {creditWarning && (
          <div
            style={{
              padding: "8px 20px", fontSize: 12, fontWeight: 600,
              background: "color-mix(in srgb, var(--amber) 12%, transparent)",
              borderBottom: "1px solid color-mix(in srgb, var(--amber) 35%, transparent)",
              color: "var(--amber)",
            }}
          >
            ⚠️ Document parsing credits running low ({creditWarning.credits_used}/{creditWarning.credit_budget} used, {creditWarning.percent_used}%). Extraction may fail until the next reset.
          </div>
        )}

        <div className="page-content">
          {/* Stats */}
          <div className="stats-grid">
            {stats.map((s) => (
              <div key={s.label} className={`stat-card ${s.color}`}>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{loading ? "—" : s.value}</div>
              </div>
            ))}
          </div>

          {/* Cases panel — row-wise table, same as the allocation team's dashboard */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <div className="dot" style={{ background: "var(--accent)" }} />
                Assigned Cases
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Search name, case ID, insurer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 240 }}
                />
                <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} style={{ width: "auto" }}>
                  {priorities.map((p) => (
                    <option key={p} value={p}>{p === "All" ? "All Priorities" : p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 16 }}>Insurer Ref</th>
                    <th>Claimant</th>
                    <th>Hospital</th>
                    <th>Insurer</th>
                    <th>Amount</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Extraction</th>
                    <th style={{ width: 220, textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>Loading…</td></tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>
                      {search ? "No cases match your search." : "No cases assigned yet."}
                    </td></tr>
                  )}
                  {!loading && filtered.map((c) => {
                    const extracting = activeCaseIds.has(c.caseId);
                    const event = eventsByCaseId[c.caseId];
                    const isFailed = !extracting && event?.status === "failed";
                    const isDone = !extracting && !isFailed && isCaseExtracted(c);
                    const isSelected = selected === c.caseId;

                    return (
                      <tr
                        key={c.caseId}
                        className="doctor-case-row"
                        onClick={() => setSelected((prev) => (prev === c.caseId ? null : c.caseId))}
                        style={{ cursor: "pointer", background: isSelected ? "var(--bg3)" : "" }}
                      >
                        <td style={{ paddingLeft: 16 }}>
                          <span className="td-mono">{c.insurerRef || "—"}</span>
                        </td>
                        <td>
                          <div className="td-name">{c.claimantName || "—"}</div>
                        </td>
                        <td>
                          <div>{c.hospitalDetails?.name || "—"}</div>
                        </td>
                        <td>
                          <span className="badge gray">{c.insurer || "—"}</span>
                        </td>
                        <td>{fmtAmount(c.claimedAmount)}</td>
                        <td>
                          <span className={`badge ${PRIORITY_COLOR[c.claimPriority] || "gray"}`}>
                            {c.claimPriority || "Normal"}
                          </span>
                        </td>
                        <td>
                          {c.status
                            ? <span className={`badge ${STATUS_COLOR[c.status] || "gray"}`}>{fmtStatus(c.status)}</span>
                            : <span className="badge gray">—</span>}
                        </td>
                        <td>
                          {extracting && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--amber)" }}>
                              <span style={{ display: "inline-block", width: 8, height: 8, border: "2px solid var(--amber)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                              Extracting
                            </span>
                          )}
                          {isDone && <span className="badge green">✓ Extracted</span>}
                          {isFailed && <span className="badge red">✕ Failed</span>}
                          {!extracting && !isDone && !isFailed && <span className="badge gray">—</span>}
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                            <button
                              disabled={extracting}
                              title={extracting ? "Waiting for extraction to finish" : "Open this case in the PDF editor"}
                              onClick={() => navigate(`/insurance/doctor/pdf-editor/${c.caseId}`)}
                              style={{
                                padding: "6px 14px",
                                background: "var(--accent)",
                                color: "#fff",
                                border: "none",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: "inherit",
                                whiteSpace: "nowrap",
                                opacity: extracting ? 0.5 : 1,
                                cursor: extracting ? "not-allowed" : "pointer",
                              }}
                            >
                              Review the case
                            </button>
                            {isFailed && (
                              <button
                                title="View documents and retry the failed extraction"
                                onClick={() => setSelected(c.caseId)}
                                style={{
                                  padding: "6px 12px",
                                  background: "transparent",
                                  color: "var(--red)",
                                  border: "1px solid var(--red)",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  fontFamily: "inherit",
                                  whiteSpace: "nowrap",
                                  cursor: "pointer",
                                }}
                              >
                                ↺ Retry
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail drawer — supporting documents & per-document retry, same
              pattern as Dashboard.jsx's selected-case panel. */}
          {selectedCase && (
            <DoctorDocumentReview caseId={selectedCase.caseId} doctorId={doctorId} onClose={() => setSelected(null)} />
          )}
        </div>
      </div>
    </>
  );
}