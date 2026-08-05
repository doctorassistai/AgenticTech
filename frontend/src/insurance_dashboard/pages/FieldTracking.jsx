import { useState, useEffect, useMemo } from "react";

const API_BASE = '/api/hms/app';
const BACKEND = import.meta.env.VITE_BACKEND_URL;

const PAGE_SIZE = 20;

const STATUS_DOT = {
  done:    "var(--green)",
  partial: "var(--amber)",
  pending: "var(--border)",
};

const STATUS_LABEL = {
  COMPLETED:   { label: "Completed",   cls: "green" },
  IN_PROGRESS: { label: "In Progress", cls: "blue" },
  ALLOCATED:   { label: "Allocated",   cls: "gray" },
  PARTIAL:     { label: "Partial",     cls: "amber" },
};

function getUnapprovedAssignments(caseItem) {
  const results = []
  const now = Date.now()
  const TWO_HOURS = 2 * 60 * 60 * 1000
  const investigations = caseItem.investigations || {}

  for (const [inv_type, invList] of Object.entries(investigations)) {
    if (!Array.isArray(invList)) continue
    for (const entry of invList) {
      if (!entry?.investigatorId) continue
      const response = entry.assignmentResponse
      const allocatedAt = entry.reassignedAt || caseItem.createdAt
      const ageMs = allocatedAt ? now - new Date(allocatedAt).getTime() : 0
      if (response === "declined" || (response == null && ageMs > TWO_HOURS)) {
        results.push({ inv_type, entry, reason: response === "declined" ? "declined" : "no_response" })
      }
    }
  }
  return results
}

/* ---------------------------------------------------------------------- */
/* Reassign modal (unchanged behaviour, kept as-is)                       */
/* ---------------------------------------------------------------------- */

function ReassignModal({ modal, onClose, onDone }) {
  const [officers, setOfficers]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState(null)
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    if (!modal) return
    setLoading(true)
    setSelected(null)

    const { inv_type, pincode } = modal
    const needsPin = inv_type === "HVI" || inv_type === "MV"
    const url = needsPin && pincode
      ? `${BACKEND}/insurance/app/availability/officers?pincode=${pincode}&inv_type=${inv_type}`
      : `${BACKEND}/insurance/api/hms/users/field-officers`

    fetch(url, { headers: { "X-User-Id": "web-user", "X-User-Role": "supervisor" } })
      .then(r => r.json())
      .then(data => {
        const list = data.officers
          ? data.officers.map(o => ({ id: o.userId, name: o.fullName, pin: o.pincode, status: o.status, matchType: o.matchType }))
          : (data.data || []).map(o => ({ id: o.sys_user_id, name: o.full_name, pin: null, status: o.status, matchType: "exact" }))
        setOfficers(list)
      })
      .catch(() => setOfficers([]))
      .finally(() => setLoading(false))
  }, [modal])

  const handleReassign = async () => {
    if (!selected || !modal) return
    setSaving(true)
    try {
      const res = await fetch(
        `${BACKEND}/insurance/web/cases/${modal.caseId}/reassign-investigation`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-User-Id": "web-user", "X-User-Role": "supervisor" },
          body: JSON.stringify({
            inv_type:              modal.inv_type,
            old_investigator_id:   modal.old_investigator_id,
            new_investigator_id:   selected.id,
            new_investigator_name: selected.name,
          }),
        }
      )
      if (!res.ok) throw new Error("Reassign failed")
      onDone()
      onClose()
    } catch (e) {
      console.error(e)
      alert("Reassign failed: " + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!modal) return null

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", width: 420, maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 16px 48px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Reassign — {modal.inv_type}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {modal.caseId}
              {modal.pincode && <span style={{ marginLeft: 8 }}>📍 PIN {modal.pincode}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--muted)" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 13 }}>Loading officers…</div>
          ) : officers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 13 }}>
              No available officers found for PIN {modal.pincode}<br />
              <span style={{ fontSize: 11 }}>Officers must check in via mobile app</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {officers.map(o => {
                const isSel = selected?.id === o.id
                return (
                  <div key={o.id} onClick={() => setSelected(o)} style={{ padding: "10px 12px", borderRadius: 7, cursor: "pointer", border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`, background: isSel ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "var(--bg3)", display: "flex", alignItems: "center", gap: 10, transition: "all 0.12s" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: isSel ? "var(--accent)" : "var(--bg2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: isSel ? "#fff" : "var(--muted)", flexShrink: 0 }}>
                      {o.name?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{o.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, marginTop: 1 }}>
                        {o.pin && <span>📍 {o.pin}</span>}
                        {o.matchType === "district" && <span style={{ color: "var(--amber)" }}>⚠ Nearby</span>}
                        {o.status && <span style={{ color: o.status === "Available" ? "var(--green)" : "var(--muted)" }}>● {o.status}</span>}
                      </div>
                    </div>
                    {isSel && <span style={{ color: "var(--accent)", fontSize: 16 }}>✓</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px 0", borderRadius: 6, background: "none", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={handleReassign} disabled={!selected || saving} style={{ flex: 2, padding: "9px 0", borderRadius: 6, background: selected && !saving ? "var(--accent)" : "var(--bg3)", border: "none", color: selected && !saving ? "#fff" : "var(--muted)", cursor: selected && !saving ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
            {saving ? "Reassigning…" : `Reassign to ${selected?.name || "—"}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Case Detail Modal — replaces the old slow inline "View Details" expand */
/* ---------------------------------------------------------------------- */

function CaseDetailModal({ caseId, onClose, onReassign, onRefetch }) {
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!caseId) return
    setLoading(true)
    setError(null)
    setDetail(null)

    fetch(`${API_BASE}/tracking/cases/${caseId}`)
      .then(async r => {
        const text = await r.text()
        if (!r.ok) throw new Error(`Server error ${r.status}: ${text}`)
        return JSON.parse(text)
      })
      .then(data => {
        if (data.status === "success" || data.success) {
          setDetail(data.data)
        } else {
          setError("Failed to load case details")
        }
      })
      .catch(err => setError("Error: " + err.message))
      .finally(() => setLoading(false))
  }, [caseId])

  if (!caseId) return null

  const c = detail
  const unapproved = c ? getUnapprovedAssignments(c) : []

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", width: "min(900px, 100%)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 16px 48px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--accent2)" }}>
              {c?.insurerRef ? `INS-REF ${c.insurerRef}` : "Case Details"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c?.caseId || caseId}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--muted)" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          {loading && (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading case details…</div>
          )}

          {error && (
            <div style={{ padding: "20px", color: "var(--red)" }}>{error}</div>
          )}

          {!loading && !error && c && (
            <div className="three-col">
              <div>
                {unapproved.length > 0 && (
                  <div style={{ marginBottom: 14, fontSize: 11, fontWeight: 700, background: "rgba(239,68,68,.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 6, padding: "6px 10px", display: "inline-block" }}>
                    ⚠ {unapproved.length} UNCONFIRMED ASSIGNMENT{unapproved.length > 1 ? "S" : ""}
                  </div>
                )}

                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "16px" }}>
                  {[
                    ["Insurer Ref", c.insurerRef || "—"],
                    ["Case ID", c.caseId],
                    ["Allocated", c.allocated || "—"],
                    ["Claimant", c.claimant],
                    ["Assigned Doctor", c.doctorAssigned || "Unassigned"],
                    ["Claim Mode", c.claimMode],
                    ["Insurer", c.insurer],
                    ["Hospital", c.hospital ? `📍 ${c.hospital}` : "—"],
                    ["Claimed", c.claimedAmount != null ? `₹${c.claimedAmount.toLocaleString("en-IN")}` : "—"],
                    ["Target Date", c.targetDate || "—"],
                    ["Investigators", c.investigators?.join(", ") || "—"],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="stat-label">{label}</div>
                      <div style={{ fontWeight: 500, marginTop: 4 }}>
                        {label === "Assigned Doctor" && val === "Unassigned" ? (
                          <span style={{ color: "var(--muted)", fontWeight: 400 }}>Unassigned</span>
                        ) : val}
                      </div>
                    </div>
                  ))}
                </div>

                {Object.entries(c.investigations || {}).some(([, list]) =>
                  Array.isArray(list) && list.some(e => e?.investigatorId)
                ) && (
                  <div style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ background: "var(--bg3)", padding: "8px 14px", fontSize: 11, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Assigned Officers
                    </div>
                    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                      {Object.entries(c.investigations || {}).flatMap(([inv_type, list]) =>
                        (Array.isArray(list) ? list : [])
                          .filter(e => e?.investigatorId)
                          .map(e => {
                            const pincode = inv_type === "HVI"
                              ? (c.hospitalPincode || "")
                              : inv_type === "MV"
                                ? (c.pinCode || "")
                                : ""
                            const responseColor =
                              e.assignmentResponse === "accepted" ? "var(--green)" :
                              e.assignmentResponse === "declined" ? "var(--red)" : "var(--amber)"
                            const responseLabel =
                              e.assignmentResponse === "accepted" ? "✓ Accepted" :
                              e.assignmentResponse === "declined" ? "✕ Declined" : "⏱ Pending"

                            return (
                              <div key={inv_type + e.investigatorId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: "var(--bg2)", border: "1px solid var(--border)" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "var(--bg3)", color: "var(--text)", flexShrink: 0 }}>{inv_type}</span>
                                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{e.investigatorName}</span>
                                <span style={{ fontSize: 10, fontWeight: 600, color: responseColor }}>{responseLabel}</span>
                                <button
                                  onClick={() => onReassign({ caseId: c.caseId, inv_type, old_investigator_id: e.investigatorId, pincode })}
                                  style={{ padding: "4px 10px", borderRadius: 5, background: "var(--accent)", color: "#fff", border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                                >
                                  Reassign
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Remove ${e.investigatorName} from ${inv_type}?`)) return
                                    try {
                                      const res = await fetch(
                                        `${BACKEND}/insurance/web/cases/${c.caseId}/remove-investigation`,
                                        {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json", "X-User-Id": "web-user", "X-User-Role": "supervisor" },
                                          body: JSON.stringify({ inv_type, investigator_id: e.investigatorId }),
                                        }
                                      )
                                      if (!res.ok) throw new Error("Remove failed")
                                      onRefetch()
                                    } catch (err) {
                                      alert("Remove failed: " + err.message)
                                    }
                                  }}
                                  style={{ padding: "4px 10px", borderRadius: 5, background: "none", color: "var(--red)", border: "1px solid var(--red)", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                                >
                                  Remove
                                </button>
                              </div>
                            )
                          })
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <div className="sh" style={{ marginBottom: 8 }}>SLA Status</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                    <span>{c.sla}h elapsed</span>
                    <span style={{ color: c.sla > c.slaMax ? "var(--red)" : "var(--muted)" }}>{Math.max(0, c.slaMax - c.sla)}h remaining</span>
                  </div>
                  <div className="sla-bar">
                    <div className="sla-fill" style={{ width: `${Math.min(100, (c.sla / c.slaMax) * 100)}%`, background: c.sla > c.slaMax * 0.9 ? "var(--red)" : c.sla > c.slaMax * 0.7 ? "var(--amber)" : "var(--green)" }} />
                  </div>
                </div>

                {c.tags?.length > 0 && (
                  <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {c.tags.map((tag, i) => <span key={i} className="badge gray">{tag}</span>)}
                  </div>
                )}
              </div>

              <div>
                <div className="sh">Investigation Timeline</div>
                <div className="timeline">
                  {(c.timeline || []).map((t, i) => (
                    <div className="tl-item" key={i}>
                      <div className="tl-left">
                        <div className="tl-dot" style={{ background: STATUS_DOT[t.status] || "var(--border)" }} />
                        <div className="tl-line" />
                      </div>
                      <div className="tl-body">
                        <div className="tl-action">{t.action}</div>
                        <div className="tl-meta">{t.meta}{t.time !== "—" && <span> · {t.time}</span>}</div>
                        {t.docs_collected?.length > 0 && (
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {t.docs_collected.map((doc, di) => (
                              <span key={di} style={{ fontSize: 10, padding: "2px 6px", backgroundColor: "rgba(0,212,160,0.1)", border: "1px solid rgba(0,212,160,0.2)", borderRadius: 4, color: "var(--green)" }}>✓ {doc.replace(/_/g, " ")}</span>
                            ))}
                          </div>
                        )}
                        {t.docs_required?.length > 0 && t.status !== "done" && (
                          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {t.docs_required.filter(d => !t.docs_collected?.includes(d.toLowerCase().replace(/[^a-z0-9]/g, "_"))).map((doc, di) => (
                              <span key={di} style={{ fontSize: 10, padding: "2px 6px", backgroundColor: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 4, color: "var(--amber)" }}>⏳ {doc}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Main component                                                         */
/* ---------------------------------------------------------------------- */

export default function FieldTracking() {
  const [cases, setCases]             = useState([]);
  const [totalCount, setTotalCount]   = useState(null); // null = backend doesn't support server pagination
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [invFilter, setInvFilter]     = useState("All");
  const [doctorFilter, setDoctorFilter] = useState("All");
  const [investigators, setInvestigators] = useState([]);
  const [doctors, setDoctors]         = useState([]);
  const [page, setPage]               = useState(1);
  const [sortKey, setSortKey]         = useState(null);
  const [sortDir, setSortDir]         = useState("asc");
  const [detailCaseId, setDetailCaseId] = useState(null);
  const [reassignModal, setReassignModal] = useState(null);

  const [refreshKey, setRefreshKey] = useState(0);
const refetch = () => setRefreshKey(k => k + 1);

useEffect(() => {
  setPage(1);
}, [search, statusFilter, invFilter, doctorFilter]);

useEffect(() => {
  let cancelled = false;
  setLoading(true);
  setError(null);

  const params = new URLSearchParams();
  if (search)                 params.set("search", search);
  if (statusFilter !== "All") params.set("status", statusFilter);
  if (invFilter    !== "All") params.set("investigator", invFilter);
  if (doctorFilter !== "All") params.set("doctor", doctorFilter);
  params.set("page", page);
  params.set("limit", PAGE_SIZE);

  fetch(`${API_BASE}/tracking/cases?${params}`)
    .then(async res => {
      const text = await res.text();
      if (!res.ok) throw new Error(`Server error ${res.status}: ${text}`);
      return JSON.parse(text);
    })
    .then(data => {
      if (cancelled) return;
      if (data.status === "success") {
        setCases(data.data);
        setInvestigators(data.meta?.investigators || []);
        setDoctors(data.meta?.doctors || []);
        setTotalCount(typeof data.meta?.total === "number" ? data.meta.total : null);
      } else {
        setError("Failed to load cases: " + JSON.stringify(data));
      }
    })
    .catch(err => { if (!cancelled) setError("Error: " + err.message); })
    .finally(() => { if (!cancelled) setLoading(false); });

  return () => { cancelled = true; };
}, [page, search, statusFilter, invFilter, doctorFilter, refreshKey]);

  // When the backend doesn't paginate server-side (no meta.total), slice
  // and sort client-side over the full result set it returned.
  const isServerPaginated = totalCount !== null;

  const sortedCases = useMemo(() => {
    if (!sortKey) return cases;
    const copy = [...cases];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [cases, sortKey, sortDir]);

  const visibleCases = isServerPaginated
    ? sortedCases
    : sortedCases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalPages = isServerPaginated
    ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    : Math.max(1, Math.ceil(cases.length / PAGE_SIZE));

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ label, sortField }) => (
    <th
      onClick={() => sortField && toggleSort(sortField)}
      style={{ cursor: sortField ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label}
      {sortField && (
        <span style={{ marginLeft: 4, fontSize: 10, color: sortKey === sortField ? "var(--accent)" : "var(--muted)" }}>
          {sortKey === sortField ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      )}
    </th>
  );

  const COLSPAN = 12; // total column count (was 11, +1 for Assigned Doctor)

  return (
    <div className="page-content">
      <ReassignModal
        modal={reassignModal}
        onClose={() => setReassignModal(null)}
        onDone={refetch}
      />

      <CaseDetailModal
        caseId={detailCaseId}
        onClose={() => setDetailCaseId(null)}
        onReassign={(m) => setReassignModal(m)}
        onRefetch={refetch}
      />

      <div className="filter-row">
        <input
          type="text"
          placeholder="Search by case ID, insurer ref, or claimant..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { setPage(1); refetch(); } }}
        />
        <select style={{ width: "auto" }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="ALLOCATED">Allocated</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
        </select>
        <select style={{ width: "auto" }} value={invFilter} onChange={e => setInvFilter(e.target.value)}>
          <option value="All">All Investigators</option>
          {investigators.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <select style={{ width: "auto" }} value={doctorFilter} onChange={e => setDoctorFilter(e.target.value)}>
          <option value="All">All Doctors</option>
          {doctors.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => { setPage(1); refetch(); }}>Apply</button>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg3)", textAlign: "left" }}>
                <SortHeader label="Insurer Ref" sortField="insurerRef" />
                <SortHeader label="Case ID" sortField="caseId" />
                <SortHeader label="Allocated" sortField="allocated" />
                <SortHeader label="Claimant" sortField="claimant" />
                <SortHeader label="Assigned Doctor" sortField="doctorAssigned" />
                <th>Claim Mode</th>
                <SortHeader label="Type" sortField="type" />
                <SortHeader label="Status" sortField="status" />
                <SortHeader label="Priority" sortField="priority" />
                <SortHeader label="SLA" sortField="sla" />
                <th>Flags</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
  <>
    <tr>
      <td colSpan={COLSPAN} style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
        Loading cases…
      </td>
    </tr>
    {Array.from({ length: 8 }).map((_, i) => (
      <tr key={`sk-${i}`}>
        {Array.from({ length: COLSPAN }).map((__, j) => (
          <td key={j} style={{ padding: "10px 14px" }}>
            <div style={{ height: 12, borderRadius: 4, background: "var(--bg3)", opacity: 0.6 }} />
          </td>
        ))}
      </tr>
    ))}
  </>
)}

              {!loading && error && (
                <tr><td colSpan={COLSPAN} style={{ padding: 20, color: "var(--red)" }}>{error}</td></tr>
              )}

              {!loading && !error && visibleCases.length === 0 && (
                <tr><td colSpan={COLSPAN} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>No cases found.</td></tr>
              )}

              {!loading && !error && visibleCases.map(c => {
                const slaColor = c.sla > c.slaMax * 0.9 ? "var(--red)" : c.sla > c.slaMax * 0.7 ? "var(--amber)" : "var(--green)";
                const statusInfo = STATUS_LABEL[c.status] || { label: c.status, cls: "gray" };
                const unapproved = getUnapprovedAssignments(c);

                return (
                  <tr
                    key={c.id}
                    onClick={() => setDetailCaseId(c.id)}
                    style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "10px 14px", fontFamily: "var(--mono)" }}>{c.insurerRef || "—"}</td>
                    <td style={{ padding: "10px 14px", fontFamily: "var(--mono)", color: "var(--accent2)" }}>{c.caseId || c.id}</td>
                    <td style={{ padding: "10px 14px", color: "var(--muted)", whiteSpace: "nowrap" }}>{c.allocated || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>{c.claimant}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {c.doctorAssigned && c.doctorAssigned !== "Unassigned" ? (
                        c.doctorAssigned
                      ) : (
                        <span style={{ color: "var(--muted)" }}>Unassigned</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textTransform: "capitalize" }}>{c.claimMode || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>{c.type}</td>
                    <td style={{ padding: "10px 14px" }}><span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span></td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className={`badge ${c.priority === "Urgent" || c.priority === "High" ? "red" : c.priority === "Medium" ? "amber" : "gray"}`}>{c.priority}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ color: slaColor, fontWeight: 600 }}>{c.sla}h</span>
                      <span style={{ color: "var(--muted)" }}> / {c.slaMax}h</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {unapproved.length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(239,68,68,.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 4, padding: "2px 7px" }}>
                          ⚠ {unapproved.length}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); setDetailCaseId(c.id); }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg3)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Page {page} of {totalPages}
            {isServerPaginated && <span> · {totalCount} cases</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
            <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}