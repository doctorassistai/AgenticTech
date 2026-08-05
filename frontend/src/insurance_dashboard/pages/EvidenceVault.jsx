import { useState, useEffect, useCallback } from 'react'

// ─── Config ────────────────────────────────────────────────────────────────
// Adjust to match your actual API base URL
const API_BASE = '/api/hms/app'

// ─── Constants ─────────────────────────────────────────────────────────────
const TYPE_FILTERS = ['All', 'PDF', 'Image', 'Video', 'Document']

const STATUS_COLOR = {
  'ALLOCATED':    'var(--accent)',
  'COMPLETED':    'var(--green)',
  'IN_PROGRESS':  'var(--amber)',
  'REJECTED':     'var(--red, #e53935)',
  'ON_HOLD':      'var(--muted)',
  // legacy labels from static data
  'Under Review': 'var(--amber)',
  'Allocated':    'var(--accent)',
  'Closed':       'var(--green)',
}

const STATUS_LABEL = {
  'ALLOCATED':   'Allocated',
  'COMPLETED':   'Completed',
  'IN_PROGRESS': 'In Progress',
  'REJECTED':    'Rejected',
  'ON_HOLD':     'On Hold',
}

const TYPE_ICON = {
  'PDF':      PDFIcon,
  'Image':    ImageIcon,
  'Video':    VideoIcon,
  'Document': DocIcon,
}

// ─── Icon Components ────────────────────────────────────────────────────────

function PDFIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="12" y2="17"/>
    </svg>
  )
}
function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}
function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="23 7 16 12 23 17 23 7"/>
      <rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>
  )
}
function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="15" y2="17"/>
    </svg>
  )
}
function VerifiedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
function InvestigatorIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}
function CalendarIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="8 17 12 21 16 17"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
    </svg>
  )
}
function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
    </svg>
  )
}
function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}
function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
}

// ─── Skeleton loader ────────────────────────────────────────────────────────
function Skeleton({ width = '100%', height = '14px', style = {} }) {
  return (
    <div style={{
      width, height,
      borderRadius: '4px',
      background: 'linear-gradient(90deg, var(--bg3) 25%, var(--border) 50%, var(--bg3) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      ...style,
    }} />
  )
}

// ─── Empty state ────────────────────────────────────────────────────────────
function EmptyDocs({ filter }) {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
      <div style={{ marginBottom: '6px', fontSize: '20px', opacity: 0.4 }}>📂</div>
      {filter === 'All'
        ? 'No documents uploaded yet for this case.'
        : `No ${filter} documents for this case.`}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function EvidenceVault() {
  const [claimants, setClaimants]           = useState([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null)
  const [selectedClaimant, setSelectedClaimant] = useState(null)
  const [activeFilter, setActiveFilter]     = useState('All')
  const [selectedDoc, setSelectedDoc]       = useState(null)
  const [searchQuery, setSearchQuery]       = useState('')
  const [refreshing, setRefreshing]         = useState(false)

  // ── Fetch evidence data ─────────────────────────────────────
  const fetchEvidence = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const token = localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || ''
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${API_BASE}/evidence`, { headers })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()

      const list = data.claimants || []
      setClaimants(list)
      if (list.length > 0 && !selectedClaimant) {
        setSelectedClaimant(list[0])
      } else if (selectedClaimant) {
        // re-sync selected claimant with fresh data
        const refreshed = list.find(c => c.id === selectedClaimant.id)
        if (refreshed) setSelectedClaimant(refreshed)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedClaimant])

  useEffect(() => { fetchEvidence() }, [])

  // ── Derived values ──────────────────────────────────────────
  const filteredClaimants = claimants.filter(c => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      c.caseId.toLowerCase().includes(q) ||
      c.claimType.toLowerCase().includes(q)
    )
  })

  const currentClaimant = selectedClaimant
    ? (filteredClaimants.find(c => c.id === selectedClaimant.id) || filteredClaimants[0] || null)
    : filteredClaimants[0] || null

  const docs = currentClaimant
    ? currentClaimant.documents.filter(d =>
        activeFilter === 'All' || d.type === activeFilter
      )
    : []

  const verifiedCount = currentClaimant ? currentClaimant.documents.filter(d => d.verified).length : 0
  const totalCount    = currentClaimant ? currentClaimant.documents.length : 0

  const investigators = currentClaimant
    ? [...new Set(currentClaimant.documents.map(d => d.investigator))]
    : []

  const totalDocs = claimants.reduce((a, c) => a + c.documents.length, 0)

  // ─────────────────────────────────────────────────────────────

  return (
    <div className="page-content">
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0 }
          100% { background-position:  200% 0 }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px) }
          to   { opacity: 1; transform: translateY(0)   }
        }
        .doc-row:hover { background: color-mix(in srgb, var(--accent) 4%, var(--bg2)) !important; }
        .claimant-btn:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)) !important; }
        .icon-btn:hover { background: var(--bg2) !important; color: var(--text) !important; border-color: var(--accent) !important; }
        .search-input:focus { outline: none; border-color: var(--accent) !important; }
      `}</style>

      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>Evidence Vault</div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
            {loading
              ? 'Loading…'
              : `${claimants.length} claimants · ${totalDocs} documents total`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="btn btn-ghost btn-sm icon-btn"
            onClick={() => fetchEvidence(true)}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: refreshing ? 0.6 : 1 }}
          >
            <RefreshIcon /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <UploadIcon /> Upload Evidence
          </button>
          <button className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <DownloadIcon /> Download All
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '8px',
          background: 'color-mix(in srgb, var(--red,#e53935) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--red,#e53935) 25%, transparent)',
          color: 'var(--red,#e53935)', fontSize: '13px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚠</span>
          <span>Failed to load: {error}</span>
          <button
            onClick={() => fetchEvidence()}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '12px', textDecoration: 'underline' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Two-pane layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px', alignItems: 'start' }}>

        {/* ── LEFT: Claimant List ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Search */}
          <div style={{ position: 'relative', marginBottom: '4px' }}>
            <div style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}>
              <SearchIcon />
            </div>
            <input
              className="search-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search claimants…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '7px 10px 7px 30px', fontSize: '12px',
                border: '1px solid var(--border)', borderRadius: '8px',
                background: 'var(--bg2)', color: 'var(--text)',
                transition: 'border-color 0.15s',
              }}
            />
          </div>

          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 4px', marginBottom: '4px' }}>
            Claimants
          </div>

          {/* Loading skeletons */}
          {loading && [0, 1, 2].map(i => (
            <div key={i} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Skeleton width="36px" height="36px" style={{ borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Skeleton width="80%" height="13px" />
                <Skeleton width="60%" height="11px" />
                <Skeleton width="50%" height="10px" />
              </div>
            </div>
          ))}

          {/* Claimant buttons */}
          {!loading && filteredClaimants.map(c => {
            const isActive   = currentClaimant?.id === c.id
            const vCount     = c.documents.filter(d => d.verified).length
            const tCount     = c.documents.length
            const initials   = c.name.split(' ').map(n => n[0]).join('').slice(0, 2)
            const statusColor = STATUS_COLOR[c.status] || 'var(--muted)'

            return (
              <button
                key={c.id}
                className="claimant-btn"
                onClick={() => {
                  setSelectedClaimant(c)
                  setActiveFilter('All')
                  setSelectedDoc(null)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 14px', borderRadius: '10px',
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'color-mix(in srgb, var(--accent) 8%, var(--bg2))' : 'var(--bg2)',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.15s', width: '100%',
                  animation: 'fadeSlideIn 0.2s ease-out',
                }}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                  background: isActive ? 'color-mix(in srgb, var(--accent) 20%, var(--bg3))' : 'var(--bg3)',
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: 700,
                  color: isActive ? 'var(--accent)' : 'var(--muted)',
                }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px', fontWeight: 600,
                    color: isActive ? 'var(--text)' : 'var(--text2)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{c.caseId}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px',
                      background: `color-mix(in srgb, ${statusColor} 15%, transparent)`,
                      color: statusColor,
                      border: `1px solid color-mix(in srgb, ${statusColor} 30%, transparent)`,
                    }}>
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{vCount}/{tCount} verified</span>
                  </div>
                </div>
              </button>
            )
          })}

          {!loading && filteredClaimants.length === 0 && !error && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
              {searchQuery ? 'No claimants match your search.' : 'No cases found.'}
            </div>
          )}
        </div>

        {/* ── RIGHT: Document Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Claimant header strip */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-body" style={{ padding: '16px 20px' }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Skeleton width="200px" height="16px" />
                  <Skeleton width="320px" height="12px" />
                  <Skeleton width="180px" height="22px" />
                </div>
              ) : currentClaimant ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{currentClaimant.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>
                      {currentClaimant.caseId} &middot; {currentClaimant.claimType} &middot; Filed {currentClaimant.filed}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {investigators.map(inv => (
                        <span key={inv} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontSize: '11px', color: 'var(--muted)',
                          background: 'var(--bg3)', border: '1px solid var(--border)',
                          borderRadius: '20px', padding: '2px 9px',
                        }}>
                          <InvestigatorIcon /> {inv}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
                    {[
                      { label: 'Files',    value: totalCount,              color: 'var(--accent)' },
                      { label: 'Verified', value: verifiedCount,           color: 'var(--green)'  },
                      { label: 'Pending',  value: totalCount - verifiedCount, color: 'var(--amber)'  },
                    ].map((stat, i) => (
                      <div key={stat.label} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        {i > 0 && <div style={{ width: '1px', background: 'var(--border)' }} />}
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '22px', fontWeight: 700, color: stat.color, fontFamily: 'var(--mono, monospace)' }}>
                            {stat.value}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {stat.label}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Select a claimant to view documents.</div>
              )}
            </div>
          </div>

          {/* Filter tabs + document table */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-header">
              <div className="panel-title">
                <div className="dot" style={{ background: 'var(--accent)' }} />
                Documents
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {TYPE_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => { setActiveFilter(f); setSelectedDoc(null) }}
                    style={{
                      padding: '3px 10px', fontSize: '11px', borderRadius: '5px', cursor: 'pointer',
                      border: `1px solid ${activeFilter === f ? 'var(--accent)' : 'var(--border)'}`,
                      background: activeFilter === f ? 'color-mix(in srgb, var(--accent) 12%, var(--bg2))' : 'var(--bg2)',
                      color: activeFilter === f ? 'var(--accent)' : 'var(--muted)',
                      fontWeight: activeFilter === f ? 600 : 400,
                      transition: 'all 0.12s',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-body" style={{ padding: 0 }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 80px 1fr 1fr 90px 60px',
                padding: '8px 20px',
                borderBottom: '1px solid var(--border)',
                fontSize: '10px', fontWeight: 700,
                color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>
                <div>File Name</div>
                <div>Size</div>
                <div>Investigator</div>
                <div>Submitted</div>
                <div style={{ textAlign: 'center' }}>Status</div>
                <div />
              </div>

              {/* Loading rows */}
              {loading && [0, 1, 2, 4].map(i => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '2fr 80px 1fr 1fr 90px 60px',
                  padding: '11px 20px', borderBottom: '1px solid var(--border)', alignItems: 'center', gap: '0',
                }}>
                  <Skeleton width="70%" height="13px" />
                  <Skeleton width="50px" height="12px" />
                  <Skeleton width="80px" height="12px" />
                  <Skeleton width="90px" height="11px" />
                  <Skeleton width="60px" height="20px" style={{ margin: '0 auto', borderRadius: '4px' }} />
                  <Skeleton width="28px" height="28px" style={{ margin: '0 auto', borderRadius: '6px' }} />
                </div>
              ))}

              {/* Document rows */}
              {!loading && docs.length === 0 && <EmptyDocs filter={activeFilter} />}

              {!loading && docs.map((doc, i) => {
                const Icon       = TYPE_ICON[doc.type] || DocIcon
                const isSelected = selectedDoc?.id === doc.id
                const initials   = doc.investigator.split(' ').map(n => n[0]).join('').slice(0, 2)

                return (
                  <div
                    key={doc.id}
                    className="doc-row"
                    onClick={() => setSelectedDoc(isSelected ? null : doc)}
                    style={{
                      display: 'grid', gridTemplateColumns: '2fr 80px 1fr 1fr 90px 60px',
                      padding: '11px 20px',
                      borderBottom: i < docs.length - 1 ? '1px solid var(--border)' : 'none',
                      alignItems: 'center', cursor: 'pointer',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--accent) 6%, var(--bg2))'
                        : i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--bg3) 40%, transparent)',
                      transition: 'background 0.1s',
                      animation: 'fadeSlideIn 0.15s ease-out',
                    }}
                  >
                    {/* Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{
                        color: doc.type === 'PDF'   ? 'var(--red, #e53935)'
                             : doc.type === 'Image' ? 'var(--accent)'
                             : doc.type === 'Video' ? 'var(--green)'
                             : 'var(--amber)',
                        flexShrink: 0,
                      }}>
                        <Icon />
                      </span>
                      <span style={{
                        fontSize: '13px', color: 'var(--text)',
                        fontFamily: 'var(--mono, monospace)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {doc.label || doc.name}
                      </span>
                    </div>

                    {/* Size — not available from API, show inv type instead */}
                    <div style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--mono, monospace)' }}>
                      {doc.invType}
                    </div>

                    {/* Investigator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{
                        width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                        background: 'var(--bg3)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '9px', fontWeight: 700, color: 'var(--muted)',
                      }}>
                        {initials}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {doc.investigator}
                      </span>
                    </div>

                    {/* Date */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted)', fontSize: '11px' }}>
                      <CalendarIcon />
                      {doc.submittedOn}
                    </div>

                    {/* Status */}
                    <div style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                        background: doc.verified
                          ? 'color-mix(in srgb, var(--green) 15%, transparent)'
                          : 'color-mix(in srgb, var(--amber) 15%, transparent)',
                        color:  doc.verified ? 'var(--green)' : 'var(--amber)',
                        border: `1px solid ${doc.verified
                          ? 'color-mix(in srgb, var(--green) 30%, transparent)'
                          : 'color-mix(in srgb, var(--amber) 30%, transparent)'}`,
                      }}>
                        {doc.verified && <VerifiedIcon />}
                        {doc.verified ? 'Verified' : 'Pending'}
                      </span>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                      {/* Open in new tab */}
                      <button
                        className="icon-btn"
                        onClick={e => { e.stopPropagation(); window.open(doc.url, '_blank') }}
                        style={{
                          width: '28px', height: '28px', borderRadius: '6px',
                          border: '1px solid var(--border)', background: 'var(--bg3)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--muted)', transition: 'all 0.12s',
                        }}
                        title="Open file"
                      >
                        <ExternalLinkIcon />
                      </button>
                      {/* Download */}
                      <button
                        className="icon-btn"
                        onClick={e => {
                          e.stopPropagation()
                          const a = document.createElement('a')
                          a.href     = doc.url
                          a.download = doc.name
                          a.click()
                        }}
                        style={{
                          width: '28px', height: '28px', borderRadius: '6px',
                          border: '1px solid var(--border)', background: 'var(--bg3)',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--muted)', transition: 'all 0.12s',
                        }}
                        title="Download"
                      >
                        <DownloadIcon />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Expanded document detail */}
          {selectedDoc && (
            <div
              className="panel"
              style={{ margin: 0, borderColor: 'var(--accent)', borderWidth: '1px', animation: 'fadeSlideIn 0.2s ease-out' }}
            >
              <div className="panel-header">
                <div className="panel-title">
                  <div className="dot" style={{ background: 'var(--accent)' }} />
                  Document Detail
                </div>
                <button
                  onClick={() => setSelectedDoc(null)}
                  style={{
                    marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--muted)', fontSize: '18px', lineHeight: 1, padding: '0 4px',
                  }}
                >
                  &times;
                </button>
              </div>
              <div className="panel-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  {[
                    { label: 'Document',     value: selectedDoc.label || selectedDoc.name },
                    { label: 'File Type',    value: selectedDoc.type },
                    { label: 'Inv. Type',    value: selectedDoc.invLabel },
                    { label: 'Investigator', value: selectedDoc.investigator },
                    { label: 'Submitted On', value: selectedDoc.submittedOn },
                    { label: 'Verification', value: selectedDoc.verified ? 'Verified' : 'Pending Review' },
                  ].map(row => (
                    <div key={row.label}>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
                        {row.label}
                      </div>
                      <div style={{
                        fontSize: '13px', fontWeight: 500,
                        color: row.label === 'Verification'
                          ? (selectedDoc.verified ? 'var(--green)' : 'var(--amber)')
                          : 'var(--text)',
                      }}>
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* URL preview */}
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
                    File URL
                  </div>
                  <div style={{
                    fontSize: '11px', color: 'var(--muted)',
                    fontFamily: 'var(--mono, monospace)',
                    wordBreak: 'break-all',
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    borderRadius: '6px', padding: '8px 10px',
                  }}>
                    {selectedDoc.url}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => window.open(selectedDoc.url, '_blank')}
                  >
                    <ExternalLinkIcon /> Open File
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = selectedDoc.url
                      a.download = selectedDoc.name
                      a.click()
                    }}
                  >
                    <DownloadIcon /> Download File
                  </button>
                  {!selectedDoc.verified && (
                    <button className="btn btn-primary btn-sm">Mark as Verified</button>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}