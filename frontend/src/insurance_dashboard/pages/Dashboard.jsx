import './Dashboard.css'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_BASE = '/api/hms/app' // used for case detail + tracking list (relative, matches old FieldTracking page)

const STATUS_FLOW = [
  "ALLOCATED","IN_PROGRESS","EVIDENCE_COLLECTION","UNDER_REVIEW","QC_PENDING","COMPLETED"
]
const STATUS_COLOR = {
  ALLOCATED:'blue', IN_PROGRESS:'amber', EVIDENCE_COLLECTION:'amber',
  UNDER_REVIEW:'purple', QC_PENDING:'teal', COMPLETED:'green', CLOSED:'gray', DRAFT:'gray',
}
const PRIORITY_COLOR = { Normal:'gray', High:'amber', Urgent:'red', Critical:'red' }
const TAG_COLOR = { Accident:'amber', Death:'red', 'Critical Illness':'purple', Normal:'gray' }

const STATUS_DOT = {
  done:    "var(--green)",
  partial: "var(--amber)",
  pending: "var(--border)",
}

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 350

function fmtAmount(n) {
  if (!n && n !== 0) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}
function fmtDate(d) {
  if (!d) return '—'
  let s = String(d).trim()
  // Backend only normalises dateOfIncident/dateOfIntimation to ISO — targetDate
  // is stored exactly as sent, often "DD/MM/YYYY". Convert that case here too.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/')
    s = `${yyyy}-${mm}-${dd}`
  }
  const dt = new Date(s)
  if (isNaN(dt.getTime())) return s || '—' // unparseable — show raw value instead of "Invalid Date"
  return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
}
function fmtStatus(s) { return (s || '').replaceAll('_', ' ') }

function getInvestigatorNames(investigations) {
  if (!investigations) return '—'
  const names = new Set()
  Object.values(investigations).forEach(arr => {
    if (Array.isArray(arr)) arr.forEach(a => { if (a.investigatorName) names.add(a.investigatorName) })
  })
  if (names.size === 0) return '—'
  const arr = [...names]
  if (arr.length <= 2) return arr.join(', ')
  return `${arr[0]}, ${arr[1]} +${arr.length - 2}`
}
function getInvTypes(investigations) {
  if (!investigations) return []
  return Object.entries(investigations)
    .filter(([, arr]) => Array.isArray(arr) && arr.length > 0)
    .map(([key]) => key)
}

// Same rule FieldTracking uses to flag assignments needing attention:
// declined, or no response after 2 hours.
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

// Compact page-number list with ellipses, e.g. 1 … 4 5 [6] 7 8 … 20
function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, current, current - 1, current + 1])
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b)
  const withGaps = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) withGaps.push('…')
    withGaps.push(p)
  })
  return withGaps
}

// ── Icons ────────────────────────────────────────────────────────────────────
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  )
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteConfirmModal({ count, caseIds, onConfirm, onCancel, loading }) {
  const label = count === 1 ? `case ${caseIds[0]}` : `${count} cases`
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:2000,
      background:'rgba(0,0,0,0.5)', backdropFilter:'blur(3px)',
      display:'flex', alignItems:'center', justifyContent:'center',
    }}>
      <div style={{
        background:'var(--bg,#fff)', border:'1px solid var(--border,#e5e7eb)',
        borderRadius:14, padding:'28px 28px 24px',
        maxWidth:420, width:'90vw',
        boxShadow:'0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{
          width:44, height:44, borderRadius:'50%',
          background:'color-mix(in srgb,var(--red,#dc2626) 12%,transparent)',
          border:'1px solid color-mix(in srgb,var(--red,#dc2626) 25%,transparent)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:20, marginBottom:16,
        }}>
          <TrashIcon />
        </div>
        <div style={{ fontWeight:700, fontSize:15, color:'var(--text)', marginBottom:8 }}>
          Delete {count > 1 ? `${count} Cases` : 'Case'}?
        </div>
        <div style={{ fontSize:13, color:'var(--muted)', lineHeight:1.6, marginBottom:6 }}>
          This will permanently delete{' '}
          <span style={{ fontWeight:700, color:'var(--text)' }}>{label}</span>{' '}
          and all associated documents, voice notes, and extracted data.
        </div>
        {count > 1 && (
          <div style={{
            fontSize:11, color:'var(--muted)', fontFamily:'monospace',
            background:'var(--bg3)', borderRadius:7, padding:'8px 12px',
            marginBottom:12, maxHeight:80, overflowY:'auto',
          }}>
            {caseIds.join(', ')}
          </div>
        )}
        <div style={{
          fontSize:12, color:'var(--red,#dc2626)', fontWeight:600,
          background:'color-mix(in srgb,var(--red,#dc2626) 8%,transparent)',
          border:'1px solid color-mix(in srgb,var(--red,#dc2626) 20%,transparent)',
          borderRadius:7, padding:'8px 12px', marginBottom:20,
        }}>
          ⚠ This action cannot be undone.
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={loading} style={{ minWidth:80 }}>
            Cancel
          </button>
          <button
            onClick={onConfirm} disabled={loading}
            style={{
              minWidth:140, padding:'9px 18px',
              background:'var(--red,#dc2626)', color:'#fff',
              border:'none', borderRadius:8, fontWeight:700, fontSize:13,
              cursor:loading ? 'not-allowed' : 'pointer', opacity:loading ? 0.6 : 1,
              display:'flex', alignItems:'center', gap:7, justifyContent:'center',
            }}
          >
            {loading ? (
              <>
                <span style={{ display:'inline-block', width:12, height:12, border:'2px solid #fff', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
                Deleting…
              </>
            ) : (
              <><TrashIcon /> Delete {count > 1 ? `${count} Cases` : 'Permanently'}</>
            )}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Reassign modal (ported from FieldTracking, unchanged behaviour) ────────
function ReassignModal({ modal, onClose, onDone, BACKEND }) {
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

// ── Case Detail Modal (ported from FieldTracking, fetches rich detail) ─────
function CaseDetailModal({ caseId, onClose, onReassign, onRefetch, BACKEND }) {
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

// ── Pagination bar ─────────────────────────────────────────────────────────
function PaginationBar({ page, totalPages, totalCount, onPageChange }) {
  if (totalPages <= 1) return null
  const pages = getPageNumbers(page, totalPages)

  const pageBtn = (active) => ({
    minWidth: 30, height: 30, padding: '0 6px', borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'var(--bg)',
    color: active ? '#fff' : 'var(--text)',
    fontSize: 12, fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  })

  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'12px 16px', borderTop:'1px solid var(--border)', flexWrap:'wrap', gap:10,
    }}>
      <div style={{ fontSize:12, color:'var(--muted)' }}>
        Page {page} of {totalPages}{typeof totalCount === 'number' && <span> · {totalCount} cases</span>}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        <button
          className="btn btn-ghost btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Prev
        </button>
        {pages.map((p, i) => p === '…' ? (
          <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--muted)', fontSize: 12 }}>…</span>
        ) : (
          <button key={p} style={pageBtn(p === page)} onClick={() => onPageChange(p)}>
            {p}
          </button>
        ))}
        <button
          className="btn btn-ghost btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || ''

  const [cases,        setCases]        = useState([])
  const [totalCount,   setTotalCount]   = useState(null) // null = backend didn't return a total → fall back to client pagination
  const [loading,      setLoading]      = useState(true)

  const [search,         setSearch]         = useState('')       // raw input, updates instantly
  const [debouncedSearch, setDebouncedSearch] = useState('')      // drives the actual fetch
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTag,    setFilterTag]    = useState('')
  const [page,          setPage]        = useState(1)
  const [refreshKey,    setRefreshKey]  = useState(0)

  // Separate lightweight stats (accurate across ALL cases, not just this page)
  const [stats, setStats] = useState({ total: null, active: null, today: null, completed: null })
  const [statsLoading, setStatsLoading] = useState(true)

  // Multi-select state
  const [selected,     setSelected]     = useState(new Set())   // Set of caseIds
  const [deleteTarget, setDeleteTarget] = useState(null)        // Array of caseIds to delete
  const [deleting,     setDeleting]     = useState(false)

  // Case detail / reassign modal state (ported from FieldTracking)
  const [detailCaseId, setDetailCaseId]     = useState(null)
  const [reassignModal, setReassignModal]   = useState(null)

  // doctor_assigned on a case is a sys_user_id, not a name — resolve once via /web/doctors
  const [doctorNames, setDoctorNames] = useState({})

  const refetch = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    fetch(`${BASE_URL}/insurance/web/doctors`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const map = {}
        ;(data.doctors || []).forEach(d => { map[d.sys_user_id] = d.full_name })
        setDoctorNames(map)
      })
      .catch(() => { if (!cancelled) setDoctorNames({}) })
    return () => { cancelled = true }
  }, [BASE_URL])

  // Debounce search → debouncedSearch
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 1 whenever filters/search change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filterStatus, filterTag])

  // Main cases fetch — server-side paginated, with client-side fallback if
  // the backend response has no numeric `total` (e.g. an older deployment).
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams()
    params.set('limit', PAGE_SIZE)
    params.set('skip', (page - 1) * PAGE_SIZE)
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (filterStatus)    params.set('status', filterStatus)
    if (filterTag)       params.set('tag', filterTag)

    fetch(`${BASE_URL}/insurance/web/cases?${params}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const arr = Array.isArray(data) ? data : (data.cases || [])
        setCases(arr)
        setTotalCount(typeof data.total === 'number' ? data.total : null)

        // Edge case: deleted the last row on a page that no longer exists
        if (arr.length === 0 && page > 1) {
          setPage(p => Math.max(1, p - 1))
        }
      })
      .catch(() => { if (!cancelled) { setCases([]); setTotalCount(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [BASE_URL, page, debouncedSearch, filterStatus, filterTag, refreshKey])

  // Stats fetch — independent of pagination/filters, always reflects all cases
  useEffect(() => {
    let cancelled = false
    setStatsLoading(true)
    fetch(`${BASE_URL}/insurance/web/cases/stats`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setStats(data) })
      .catch(() => { if (!cancelled) setStats({ total: null, active: null, today: null, completed: null }) })
      .finally(() => { if (!cancelled) setStatsLoading(false) })
    return () => { cancelled = true }
  }, [BASE_URL, refreshKey])

  const isServerPaginated = totalCount !== null

  // If the backend fell back to non-paginated behavior, slice client-side.
  const visibleCases = isServerPaginated
    ? cases
    : cases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totalPages = isServerPaginated
    ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    : Math.max(1, Math.ceil(cases.length / PAGE_SIZE))

  // ── Selection helpers ───────────────────────────────────────────────────
  // Note: "select all" now applies to the current page only (standard
  // pagination UX), not every case matching the filter across all pages.
  const toggleSelect = (e, caseId) => {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      next.has(caseId) ? next.delete(caseId) : next.add(caseId)
      return next
    })
  }

  const visibleIds = visibleCases.map(c => c.caseId)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected(prev => { const next = new Set(prev); visibleIds.forEach(id => next.delete(id)); return next })
    } else {
      setSelected(prev => { const next = new Set(prev); visibleIds.forEach(id => next.add(id)); return next })
    }
  }

  // ── Delete handler ──────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget?.length) return
    setDeleting(true)
    try {
      await Promise.all(deleteTarget.map(caseId =>
        Promise.all([
          fetch(`${BASE_URL}/insurance/web/cases/${caseId}`, { method:'DELETE' }),
          fetch(`${BASE_URL}/insurance/web/case-documents/${caseId}`, { method:'DELETE' }),
        ])
      ))
      setSelected(prev => { const next = new Set(prev); deleteTarget.forEach(id => next.delete(id)); return next })
      if (deleteTarget.includes(detailCaseId)) setDetailCaseId(null)
      setDeleteTarget(null)
      refetch() // re-fetch current page + stats so counts/rows stay correct
    } catch {
      alert('Network error during deletion.')
    } finally {
      setDeleting(false)
    }
  }

  const handleEdit = (e, caseId) => {
    e.stopPropagation()
    navigate(`/insurance/new-case?edit=${caseId}`)
  }

  const statCards = [
    { label:'Total Cases', value: stats.total,     color:'blue' },
    { label:'Active',      value: stats.active,    color:'amber' },
    { label:'Today',       value: stats.today,     color:'purple' },
    { label:'Completed',   value: stats.completed, color:'green' },
  ]

  return (
    <div className="page-content">
      <style>{`
        .action-btn {
          display:inline-flex; align-items:center; justify-content:center;
          width:30px; height:30px; border-radius:7px;
          border:1px solid var(--border); background:none;
          cursor:pointer; transition:all 0.15s; color:var(--muted);
        }
        .action-btn:hover { background:var(--bg3); border-color:var(--accent2); color:var(--text); }
        .action-btn.edit:hover { color:var(--accent); border-color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,transparent); }
        .action-btn.del:hover  { color:var(--red,#dc2626); border-color:var(--red,#dc2626); background:color-mix(in srgb,var(--red,#dc2626) 8%,transparent); }
        .row-cb { width:16px; height:16px; cursor:pointer; accent-color:var(--accent); }
      `}</style>

      {deleteTarget && (
        <DeleteConfirmModal
          count={deleteTarget.length}
          caseIds={deleteTarget}
          loading={deleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => !deleting && setDeleteTarget(null)}
        />
      )}

      <CaseDetailModal
        caseId={detailCaseId}
        onClose={() => setDetailCaseId(null)}
        onReassign={(m) => setReassignModal(m)}
        onRefetch={refetch}
        BACKEND={BASE_URL}
      />

      <ReassignModal
        modal={reassignModal}
        onClose={() => setReassignModal(null)}
        onDone={refetch}
        BACKEND={BASE_URL}
      />

      {/* Stats */}
      <div className="stats-grid">
        {statCards.map(s => (
          <div key={s.label} className={`stat-card ${s.color}`}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{statsLoading || s.value == null ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Cases panel */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <div className="dot" style={{ background:'var(--accent)' }} />
            Cases
            {selected.size > 0 && (
              <span style={{
                marginLeft:8, fontSize:11, fontWeight:700,
                background:'color-mix(in srgb,var(--accent) 12%,transparent)',
                color:'var(--accent)',
                border:'1px solid color-mix(in srgb,var(--accent) 30%,transparent)',
                borderRadius:20, padding:'2px 10px',
              }}>
                {selected.size} selected
              </span>
            )}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {/* Bulk delete button — shows when any selected */}
            {selected.size > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => setDeleteTarget([...selected])}
                style={{
                  display:'flex', alignItems:'center', gap:6,
                  background:'color-mix(in srgb,var(--red,#dc2626) 10%,transparent)',
                  color:'var(--red,#dc2626)',
                  border:'1px solid color-mix(in srgb,var(--red,#dc2626) 30%,transparent)',
                  borderRadius:8, padding:'6px 14px', fontWeight:700, fontSize:12, cursor:'pointer',
                }}
              >
                <TrashIcon /> Delete {selected.size} selected
              </button>
            )}
            <input
              type="text"
              placeholder="Search by case ID, claimant, insurer..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width:260 }}
            />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width:'auto' }}>
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              {STATUS_FLOW.map(s => <option key={s} value={s}>{fmtStatus(s)}</option>)}
            </select>
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)} style={{ width:'auto' }}>
              <option value="">All Tags</option>
              {['Normal','Accident','Death','Critical Illness'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width:36, paddingLeft:16 }}>
                  <input
                    type="checkbox"
                    className="row-cb"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    title="Select all on this page"
                  />
                </th>
                <th>Insurer Ref</th>
                <th>Insurer</th>
                <th>Claimant</th>
                <th>Hospital</th>
                <th>Assigned Doctor</th>
                <th>Tag</th>
                <th>Amount</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Investigators</th>
                <th>Target</th>
                <th>Flags</th>
                <th style={{ width:80, textAlign:'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={14} style={{ textAlign:'center', color:'var(--muted)', padding:32 }}>Loading…</td></tr>
              )}
              {!loading && visibleCases.length === 0 && (
                <tr><td colSpan={14} style={{ textAlign:'center', color:'var(--muted)', padding:32 }}>No cases found</td></tr>
              )}
              {!loading && visibleCases.map(c => {
                const isSelected = selected.has(c.caseId)
                const unapproved = getUnapprovedAssignments(c)
                return (
                  <tr
                    key={c.caseId}
                    onClick={() => setDetailCaseId(prev => prev === c.caseId ? null : c.caseId)}
                    style={{
                      cursor:'pointer',
                      background: isSelected
                        ? 'color-mix(in srgb,var(--accent) 6%,transparent)'
                        : detailCaseId === c.caseId ? 'var(--bg3)' : '',
                    }}
                  >
                    {/* Checkbox */}
                    <td style={{ paddingLeft:16 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="row-cb"
                        checked={isSelected}
                        onChange={e => toggleSelect(e, c.caseId)}
                      />
                    </td>

                    <td>
                      <span className="td-mono">{c.insurerRef || '—'}</span>
                      <div className="td-sub">{fmtDate(c.createdAt)}</div>
                    </td>
                    <td>
                      <div className="td-name">{c.insurer || '—'}</div>
                      <div className="td-sub">{c.policyNumber || '—'}</div>
                    </td>
                    <td>
                      <div className="td-name">{c.claimantName || '—'}</div>
                      <div className="td-sub">{c.claimantMobile || '—'}</div>
                    </td>
                    <td>
                      <div>{c.hospitalDetails?.name || '—'}</div>
                      <div className="td-sub">{c.hospitalDetails?.type || ''}</div>
                    </td>
                    <td>
                      {c.doctor_assigned
                        ? (doctorNames[c.doctor_assigned] || c.doctor_assigned)
                        : <span style={{ color:'var(--muted)' }}>Unassigned</span>}
                    </td>
                    <td>
                      {(c.tags || []).length > 0
                        ? (c.tags || []).map(t => (
                            <span key={t} className={`badge ${TAG_COLOR[t] || 'gray'}`} style={{ marginRight:4 }}>{t}</span>
                          ))
                        : <span className="badge gray">—</span>
                      }
                    </td>
                    <td>{fmtAmount(c.claimedAmount)}</td>
                    <td>
                      <span className={`badge ${PRIORITY_COLOR[c.claimPriority] || 'gray'}`}>
                        {c.claimPriority || 'Normal'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_COLOR[c.status] || 'gray'}`}>
                        {fmtStatus(c.status)}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize:12 }}>{getInvestigatorNames(c.investigations)}</div>
                      <div className="td-sub">{getInvTypes(c.investigations).join(', ')}</div>
                    </td>
                    <td>
                      <div style={{ fontSize:12 }}>{fmtDate(c.targetDate)}</div>
                    </td>
                    <td>
                      {unapproved.length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(239,68,68,.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 4, padding: "2px 7px" }}>
                          ⚠ {unapproved.length}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td onClick={e => e.stopPropagation()} style={{ textAlign:'center' }}>
                      <div style={{ display:'flex', gap:5, justifyContent:'center' }}>
                        <button
                          className="action-btn edit"
                          title="Edit case"
                          onClick={e => handleEdit(e, c.caseId)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          className="action-btn del"
                          title="Delete case"
                          onClick={e => { e.stopPropagation(); setDeleteTarget([c.caseId]) }}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalCount={isServerPaginated ? totalCount : cases.length}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}