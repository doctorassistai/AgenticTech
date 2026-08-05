// components/case/AvailableOfficerDropdown.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Pincode-aware field officer assignment dropdown.
//
// Props:
//   pincode        — claimant house pincode (for HVI) or hospital pincode (for HV)
//   invType        — "HVI" | "HV" | other (non-HVI/HV types use standard dropdown)
//   investigators  — full list from parent (fallback when pincode is empty)
//   value          — selected investigatorId
//   onChange       — ({ id, name }) => void
//   disabled       — bool
//   loading        — bool (parent loading state)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react'

const BASE_URL = import.meta.env.VITE_BACKEND_URL

// Debounce helper
function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

// Status dot
function StatusDot({ status }) {
  const color = status === 'Available' ? '#22c55e' : '#d1d5db'
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, flexShrink: 0,
      boxShadow: status === 'Available' ? `0 0 0 2px ${color}33` : 'none',
    }} />
  )
}

// Match level banner
function MatchBanner({ level }) {
  if (level === 'exact') return null
  if (level === 'district') return (
    <div style={{
      padding: '6px 12px', fontSize: 11, fontWeight: 600,
      background: 'rgba(245,158,11,0.08)', color: 'var(--amber,#f59e0b)',
      borderBottom: '1px solid var(--border,#333)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span>⚠</span>
      No officers in exact pincode — showing nearby officers in the same district
    </div>
  )
  return null
}

export default function AvailableOfficerDropdown({
  pincode,
  invType,
  investigators = [],
  value,
  onChange,
  disabled = false,
  loading: parentLoading = false,
}) {
  const PIN_TYPES = ['HVI', 'HV', 'MV', 'DIGI']
 // types that use pincode-based filtering
  const usePinFilter = PIN_TYPES.includes(invType)

  const [open, setOpen]               = useState(false)
  const [search, setSearch]           = useState('')
  const [officers, setOfficers]       = useState([])
  const [matchLevel, setMatchLevel]   = useState('none')
  const [fetching, setFetching]       = useState(false)
  const [fetchError, setFetchError]   = useState(null)
  const containerRef                  = useRef(null)
  const debouncedSearch               = useDebounce(search, 300)
  const debouncedPincode              = useDebounce(pincode, 500)

  // ── Close on outside click ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Fetch available officers when pincode changes ─────────────────────
  const fetchOfficers = useCallback(async (pin, srch) => {
    if (!pin || pin.length !== 6) {
      setOfficers([])
      setMatchLevel('none')
      return
    }
    setFetching(true)
    setFetchError(null)
    try {
      const url = new URL(`${BASE_URL.replace(/\/$/, '')}/insurance/app/availability/officers`)
      url.searchParams.set('pincode', pin)
      url.searchParams.set('inv_type', invType || '')
      if (srch) url.searchParams.set('search', srch)

      const res  = await fetch(url.toString(), {
        headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setOfficers(data.officers || [])
      setMatchLevel(data.matchLevel || 'none')
    } catch (err) {
      setFetchError('Could not load officers')
      console.error('Officer fetch error:', err)
    } finally {
      setFetching(false)
    }
  }, [invType])

  useEffect(() => {
    if (!usePinFilter) return
    fetchOfficers(debouncedPincode, debouncedSearch)
  }, [debouncedPincode, debouncedSearch, usePinFilter, fetchOfficers])

  // ── For non-pincode types, fall back to full investigators list ───────
// REPLACE WITH:
const displayList = officers.filter(inv =>
  !search ||
  (inv.fullName || inv.name || '').toLowerCase().includes(search.toLowerCase())
)

// ── Find selected label ───────────────────────────────────────────────
const selectedNameCache = useRef({})

const selectedOfficer = officers.find(o => o.userId === value) || null

if (selectedOfficer) {
  selectedNameCache.current[value] = selectedOfficer.fullName || selectedOfficer.name
}

const selectedLabel = selectedOfficer
  ? (selectedOfficer.fullName || selectedOfficer.name)
  : value
    ? (selectedNameCache.current[value] || 'Officer assigned ✓')
    : 'Select investigator'

  const isLoading = fetching || parentLoading

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>

      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled || isLoading}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '7px 10px',
          background: 'var(--bg1,#fff)',
          border: `1px solid ${open ? 'var(--accent,#3b82f6)' : 'var(--border,#333)'}`,
          borderRadius: 'var(--radius-sm,6px)',
          color: 'var(--fg,#fff)',
          fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left', opacity: disabled ? 0.6 : 1,
          outline: open ? '2px solid var(--accent,#3b82f6)' : 'none',
          outlineOffset: -1, transition: 'border-color 0.1s',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
          {isLoading
            ? <span style={{ fontSize: 11, color: 'var(--muted,#666)' }}>Loading officers…</span>
            : <>
                {selectedOfficer && <StatusDot status={selectedOfficer.status || 'Available'} />}
<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text,#111827)' }}>
  {selectedLabel}
</span>
              </>
          }
        </span>
        {/* Arrow */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{
          flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Pincode requirement hint for HVI/HV */}
      {usePinFilter && (!pincode || pincode.length !== 6) && !open && (
        <div style={{ fontSize: 10, color: 'var(--amber,#f59e0b)', marginTop: 4 }}>
         ⚠ Enter a valid{' '}
{invType === 'HVI' ? 'hospital'
: invType === 'MV'  ? 'claimant'
: invType === 'HV'  ? 'past hospital'
: 'verification'}{' '}
pincode above to load available officers
        </div>
      )}

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000,
          background: 'var(--bg1,#fff)',
          border: '1px solid var(--border,#333)',
          borderRadius: 'var(--radius-sm,6px)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}>

          {/* Match level banner */}
          <MatchBanner level={matchLevel} />

          {/* Search box */}
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border,#333)',
            background: 'var(--bg2,#f9fafb)',

          }}>
            <input
              autoFocus
              placeholder={usePinFilter ? 'Search by name or pincode…' : 'Search investigator…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', background: 'transparent',
                border: 'none', outline: 'none',
                color: 'var(--text,#111827)', fontSize: 12, padding: 0,

              }}
            />
          </div>

          {/* Error state */}
          {fetchError && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--red,#ef4444)', textAlign: 'center' }}>
              {fetchError}
            </div>
          )}

          {/* Empty state */}
          {!fetchError && displayList.length === 0 && !isLoading && (
           <div style={{ padding: '16px 12px', textAlign: 'center' }}>
  <div style={{ fontSize: 13, color: 'var(--muted,#666)', marginBottom: 4 }}>
    {pincode?.length === 6
      ? `No officers available in PIN ${pincode}`
      : 'Enter a 6-digit pincode to find officers'
    }
  </div>
  <div style={{ fontSize: 11, color: 'var(--muted,#555)', marginTop: 4 }}>
    Officers must check in via the mobile app to appear here
  </div>
</div>
          )}

          {/* Officer list */}
          {displayList.length > 0 && (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {displayList.map((officer, i) => {
                const id      = officer.userId || officer.id
                const name    = officer.fullName || officer.name
                const pin     = officer.pincode
                const lat     = officer.latitude
                const lng     = officer.longitude
                const status  = officer.status || 'Available'
                const window_ = officer.availableFrom && officer.availableTo
                  ? `${officer.availableFrom}–${officer.availableTo}`
                  : null
                const match   = officer.matchType || 'exact'
                const isSelected = id === value

                return (
                  <div
                    key={id || i}
                    onClick={() => {
                      selectedNameCache.current[id] = name   // ← ADD THIS LINE
                      onChange({ id, name })
                      setOpen(false)
                      setSearch('')
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      background: isSelected
                        ? 'rgba(59,130,246,0.1)'
                        : 'var(--bg2,#16161e)',
                      borderBottom: i < displayList.length - 1
                        ? '1px solid var(--border,#222)'
                        : 'none',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--bg3,#1e1e2e)'
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--bg2,#16161e)'
                    }}
                  >
                    {/* Status dot */}
                    <StatusDot status={status} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600,
                        color: 'var(--text,#111827)',

                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span style={{
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {name}
                        </span>
                        {match === 'district' && (
                          <span style={{
                            fontSize: 9, fontWeight: 700,
                            background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                            borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
                          }}>
                            NEARBY
                          </span>
                        )}
                      </div>

                      <div style={{
                        display: 'flex', gap: 8, marginTop: 2,
                        flexWrap: 'wrap',
                      }}>
                        {pin && (
                          <span style={{ fontSize: 10, color: 'var(--muted,#666)' }}>
                            📍 PIN {pin}
                          </span>
                        )}
                        {window_ && (
                          <span style={{ fontSize: 10, color: 'var(--muted,#666)' }}>
                            🕐 {window_}
                          </span>
                        )}
                        {lat && lng && (
                          <span style={{ fontSize: 10, color: 'var(--muted,#555)' }}>
                            🛰 {lat.toFixed(3)}, {lng.toFixed(3)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Selected check */}
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l4 4 6-8" stroke="var(--accent,#3b82f6)" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}