import './Dashboard.css'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const STATUS_FLOW = [
  "ALLOCATED","IN_PROGRESS","EVIDENCE_COLLECTION","UNDER_REVIEW","QC_PENDING","COMPLETED"
]
const STATUS_COLOR = {
  ALLOCATED:'blue', IN_PROGRESS:'amber', EVIDENCE_COLLECTION:'amber',
  UNDER_REVIEW:'purple', QC_PENDING:'teal', COMPLETED:'green', CLOSED:'gray', DRAFT:'gray',
}
const PRIORITY_COLOR = { Normal:'gray', High:'amber', Urgent:'red', Critical:'red' }
const TAG_COLOR = { Accident:'amber', Death:'red', 'Critical Illness':'purple', Normal:'gray' }

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 350

function fmtAmount(n) {
  if (!n && n !== 0) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
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
function generateTimeline(caseData) {
  if (!caseData?.status) return []
  const idx = STATUS_FLOW.indexOf(caseData.status)
  if (idx === -1) return [{ status: caseData.status, date: caseData.createdAt, done: false, current: true }]
  return STATUS_FLOW.slice(0, idx + 1).map((status, i) => ({
    status, date: caseData.createdAt, done: i < idx, current: i === idx,
  }))
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
  const [selectedCase, setSelectedCase] = useState(null)

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

  const refetch = () => setRefreshKey(k => k + 1)

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
      if (deleteTarget.includes(selectedCase?.caseId)) setSelectedCase(null)
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
                <th>Tag</th>
                <th>Amount</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Investigators</th>
                <th>Target</th>
                <th style={{ width:80, textAlign:'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={12} style={{ textAlign:'center', color:'var(--muted)', padding:32 }}>Loading…</td></tr>
              )}
              {!loading && visibleCases.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign:'center', color:'var(--muted)', padding:32 }}>No cases found</td></tr>
              )}
              {!loading && visibleCases.map(c => {
                const isSelected = selected.has(c.caseId)
                return (
                  <tr
                    key={c.caseId}
                    onClick={() => setSelectedCase(prev => prev?.caseId === c.caseId ? null : c)}
                    style={{
                      cursor:'pointer',
                      background: isSelected
                        ? 'color-mix(in srgb,var(--accent) 6%,transparent)'
                        : selectedCase?.caseId === c.caseId ? 'var(--bg3)' : '',
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

      {/* Case detail drawer */}
      {selectedCase && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="dot" style={{ background:'var(--teal)' }} />
              {selectedCase.insurerRef || selectedCase.caseId}
              <span style={{ marginLeft:8, fontSize:12, fontWeight:400, color:'var(--muted)' }}>
                {selectedCase.caseId}
              </span>
              <span className={`badge ${STATUS_COLOR[selectedCase.status] || 'gray'}`} style={{ marginLeft:8 }}>
                {fmtStatus(selectedCase.status)}
              </span>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigate(`/insurance/new-case?edit=${selectedCase.caseId}`)}
                style={{ borderColor:'var(--accent)', color:'var(--accent)', display:'flex', alignItems:'center', gap:6 }}
              >
                <EditIcon /> Edit Case
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCase(null)}>Close</button>
            </div>
          </div>

          <div className="panel-body">
            <div className="case-detail-grid">
              <div className="detail-block">
                <div className="detail-block-title">Claimant</div>
                <div className="detail-row"><span>Name</span><span>{selectedCase.claimantName || '—'}</span></div>
                <div className="detail-row"><span>Mobile</span><span>{selectedCase.claimantMobile || '—'}</span></div>
                <div className="detail-row"><span>ID Proof</span><span>{selectedCase.idProofType} {selectedCase.idProofNumber ? `— ${selectedCase.idProofNumber}` : ''}</span></div>
                <div className="detail-row"><span>Pin Code</span><span>{selectedCase.pinCode || '—'}</span></div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Claim</div>
                <div className="detail-row"><span>Mode</span><span style={{ textTransform:'capitalize' }}>{selectedCase.claimMode || '—'}</span></div>
                <div className="detail-row"><span>Subtype</span><span>{selectedCase.claimSubtype || '—'}</span></div>
                <div className="detail-row"><span>Incident Date</span><span>{fmtDate(selectedCase.dateOfIncident)}</span></div>
                <div className="detail-row"><span>Claimed</span><span>{fmtAmount(selectedCase.claimedAmount)}</span></div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Hospital</div>
                <div className="detail-row"><span>Name</span><span>{selectedCase.hospitalDetails?.name || '—'}</span></div>
                <div className="detail-row"><span>Type</span><span style={{ textTransform:'capitalize' }}>{selectedCase.hospitalDetails?.type || '—'}</span></div>
                <div className="detail-row"><span>Admission</span><span>{fmtDate(selectedCase.hospitalDetails?.admissionDate)}</span></div>
                <div className="detail-row"><span>Discharge</span><span>{fmtDate(selectedCase.hospitalDetails?.dischargeDate)}</span></div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Insurer</div>
                <div className="detail-row"><span>Name</span><span>{selectedCase.insurer || '—'}</span></div>
                <div className="detail-row"><span>Claim ID / Insurer Ref</span><span>{selectedCase.insurerRef || '—'}</span></div>
                <div className="detail-row"><span>Policy No.</span><span>{selectedCase.policyNumber || '—'}</span></div>
                <div className="detail-row"><span>Type</span><span>{selectedCase.policyType || '—'}</span></div>
                <div className="detail-row"><span>Target Date</span><span>{fmtDate(selectedCase.targetDate)}</span></div>
              </div>
            </div>

            {selectedCase.description && (
              <div style={{ marginTop:16, padding:'10px 14px', background:'var(--bg3)', borderRadius:'var(--radius-sm)', fontSize:13, color:'var(--muted)', borderLeft:'3px solid var(--border2)' }}>
                {selectedCase.description}
              </div>
            )}

            <div style={{ marginTop:20 }}>
              <div className="sh">Timeline</div>
              <div className="timeline">
                {generateTimeline(selectedCase).map((item, i) => (
                  <div className="tl-item" key={i}>
                    <div className="tl-left">
                      <div className="tl-dot" style={{ background: item.current ? 'var(--accent)' : item.done ? 'var(--green)' : 'var(--border)' }} />
                      <div className="tl-line" />
                    </div>
                    <div className="tl-body">
                      <div className="tl-action">{fmtStatus(item.status)}</div>
                      <div className="tl-meta">{new Date(item.date).toLocaleString('en-IN', { timeZone:'Asia/Kolkata' })}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}