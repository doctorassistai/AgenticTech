import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const BASE_URL = import.meta.env.VITE_BACKEND_URL

// Maps each doc string → category for grouping
const CATEGORY_LABELS = {
  core: 'Core Claim Documents',
  mode: 'Payment / Mode Documents',
  accident: 'Accident-Specific Documents',
  death: 'Death Claim Documents',
  critical: 'Critical Illness Documents',
}

function categorise(docs, tags = [], claimMode = '') {
  const groups = {
    core: [],
    mode: [],
    accident: [],
    death: [],
    critical: [],
  }

  const accidentKeywords  = ['FIR', 'MLC', 'Driving', 'Vehicle RC', 'Spot', 'Police station']
  const deathKeywords     = ['Death certificate', 'Post-mortem', 'Burial', 'Nominee', 'SDF', "Claimant's statement"]
  const criticalKeywords  = ['Specialist', 'Histopathology', 'biopsy', 'Oncologist']
  const modeKeywords      = ['Cancelled cheque', 'NEFT', 'Pre-authorisation', 'TPA network']

  for (const doc of docs) {
    const text = doc.replace('✅ ', '')
    if (accidentKeywords.some(k => text.includes(k)))      groups.accident.push(text)
    else if (deathKeywords.some(k => text.includes(k)))    groups.death.push(text)
    else if (criticalKeywords.some(k => text.includes(k))) groups.critical.push(text)
    else if (modeKeywords.some(k => text.includes(k)))     groups.mode.push(text)
    else                                                    groups.core.push(text)
  }

  // Only return groups that have items AND are relevant to this case
  return Object.entries(groups).filter(([key, items]) => {
    if (!items.length) return false
    if (key === 'accident' && !tags.includes('Accident')) return false
    if (key === 'death'    && !tags.includes('Death'))    return false
    if (key === 'critical' && !tags.includes('Critical Illness')) return false
    return true
  })
}

const PRIORITY_COLOR = {
  Normal:   { bg: '#e8f5e9', text: '#2e7d32', dot: '#43a047' },
  High:     { bg: '#fff8e1', text: '#f57f17', dot: '#fbc02d' },
  Urgent:   { bg: '#fff3e0', text: '#e65100', dot: '#fb8c00' },
  Critical: { bg: '#fce4ec', text: '#b71c1c', dot: '#e53935' },
}

const STATUS_LABEL = {
  ALLOCATED:   { label: 'Allocated',   color: '#1976d2' },
  IN_PROGRESS: { label: 'In Progress', color: '#f57c00' },
  COMPLETED:   { label: 'Completed',   color: '#388e3c' },
  REJECTED:    { label: 'Rejected',    color: '#c62828' },
  ON_HOLD:     { label: 'On Hold',     color: '#7b1fa2' },
}

export default function ChecklistPage() {
  const { caseId } = useParams()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [checked, setChecked] = useState({})   // local tick-off state

  useEffect(() => {
    const url = `${BASE_URL.replace(/\/$/, '')}/insurance/web/checklist/${caseId}`
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Case not found' : 'Server error')
        return r.json()
      })
      .then(json => { setData(json); setLoading(false) })
      .catch(e  => { setError(e.message); setLoading(false) })
  }, [caseId])

  const toggle = (key) =>
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={styles.center}>
      <div style={styles.spinner} />
      <p style={{ color: '#888', marginTop: 16, fontSize: 14 }}>Loading checklist…</p>
    </div>
  )

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) return (
    <div style={styles.center}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
      <p style={{ fontWeight: 600, fontSize: 18, color: '#333' }}>{error}</p>
      <p style={{ color: '#888', fontSize: 14, marginTop: 6 }}>
        Please verify the link or contact the insurance company.
      </p>
    </div>
  )

  // ── Data ─────────────────────────────────────────────────────────────────
  const { claimantName, policyNumber, insurer, claimMode, claimSubtype,
          tags = [], claimPriority = 'Normal', hospitalDetails = {},
          status = 'ALLOCATED', createdAt, requiredDocuments = [] } = data

  const groups     = categorise(requiredDocuments, tags, claimMode)
  const totalDocs  = requiredDocuments.length
  const doneCount  = Object.values(checked).filter(Boolean).length
  const pct        = totalDocs ? Math.round((doneCount / totalDocs) * 100) : 0
  const pColor     = PRIORITY_COLOR[claimPriority] || PRIORITY_COLOR.Normal
  const sColor     = STATUS_LABEL[status]  || STATUS_LABEL.ALLOCATED
  const dateStr    = createdAt
    ? new Date(createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
    : '—'

  return (
    <div style={styles.page}>

      {/* ── Header ── */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div>
            <div style={styles.caseId}>{caseId}</div>
            <div style={styles.claimantName}>{claimantName}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ ...styles.badge, background: pColor.bg, color: pColor.text }}>
              <span style={{ ...styles.dot, background: pColor.dot }} />
              {claimPriority}
            </span>
            <br />
            <span style={{ ...styles.badge, marginTop: 6, background: '#f0f0f0', color: sColor.color }}>
              {sColor.label}
            </span>
          </div>
        </div>

        {/* Meta grid */}
        <div style={styles.metaGrid}>
          <MetaItem label="Insurer"      value={insurer} />
          <MetaItem label="Policy No."   value={policyNumber} />
          <MetaItem label="Claim Mode"   value={claimMode?.charAt(0).toUpperCase() + claimMode?.slice(1)} />
          <MetaItem label="Hospital"     value={hospitalDetails?.name || '—'} />
          <MetaItem label="Admission"    value={hospitalDetails?.admissionDate || '—'} />
          <MetaItem label="Raised On"    value={dateStr} />
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div style={styles.tagRow}>
            {tags.map(t => (
              <span key={t} style={styles.tag}>{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div style={styles.progressWrap}>
        <div style={styles.progressTop}>
          <span style={{ fontSize: 13, color: '#555' }}>Documents collected</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: pct === 100 ? '#388e3c' : '#555' }}>
            {doneCount} / {totalDocs}
          </span>
        </div>
        <div style={styles.progressTrack}>
          <div style={{
            ...styles.progressFill,
            width: `${pct}%`,
            background: pct === 100 ? '#388e3c' : '#1976d2',
          }} />
        </div>
      </div>

      {/* ── Document groups ── */}
      <div style={styles.body}>
        {groups.map(([groupKey, items]) => (
          <div key={groupKey} style={styles.group}>
            <div style={styles.groupHeader}>{CATEGORY_LABELS[groupKey]}</div>
            {items.map((doc, i) => {
              const key = `${groupKey}-${i}`
              const done = !!checked[key]
              return (
                <label key={key} style={{ ...styles.docRow, background: done ? '#f1f8e9' : '#fff' }}>
                  <div style={{
                    ...styles.checkbox,
                    background:   done ? '#388e3c' : '#fff',
                    borderColor:  done ? '#388e3c' : '#bbb',
                  }}>
                    {done && <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4L4 7.5L10 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>}
                  </div>
                  <input type="checkbox" checked={done} onChange={() => toggle(key)}
                    style={{ position:'absolute', opacity:0, width:0, height:0 }} />
                  <span style={{ fontSize: 14, color: done ? '#555' : '#222',
                    textDecoration: done ? 'line-through' : 'none' }}>
                    {doc}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={styles.footer}>
        <p style={{ margin: 0, fontSize: 12, color: '#aaa' }}>
          This checklist is for reference only. Tick-offs are not saved to the server.
          Contact the investigator for any queries regarding this claim.
        </p>
      </div>

    </div>
  )
}

function MetaItem({ label, value }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: '#222', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  page: {
    maxWidth: 640,
    margin: '0 auto',
    padding: '0 0 48px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background: '#f7f8fa',
    minHeight: '100vh',
  },
  center: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    minHeight: '60vh',
  },
  spinner: {
    width: 36, height: 36,
    border: '3px solid #e0e0e0',
    borderTopColor: '#1976d2',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  header: {
    background: '#fff',
    padding: '24px 20px 16px',
    borderBottom: '1px solid #eee',
  },
  headerTop: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 16,
  },
  caseId: {
    fontSize: 12, color: '#888', fontFamily: 'monospace',
    marginBottom: 4, letterSpacing: '0.04em',
  },
  claimantName: {
    fontSize: 22, fontWeight: 700, color: '#1a1a1a',
  },
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 20,
    fontSize: 12, fontWeight: 600,
  },
  dot: {
    width: 7, height: 7, borderRadius: '50%',
  },
  metaGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: '12px 20px', marginBottom: 12,
  },
  tagRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8,
  },
  tag: {
    background: '#e3f2fd', color: '#1565c0',
    fontSize: 12, fontWeight: 600, padding: '3px 10px',
    borderRadius: 20, border: '1px solid #bbdefb',
  },
  progressWrap: {
    background: '#fff', padding: '14px 20px',
    borderBottom: '1px solid #eee',
  },
  progressTop: {
    display: 'flex', justifyContent: 'space-between', marginBottom: 8,
  },
  progressTrack: {
    height: 8, background: '#e0e0e0',
    borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: 4,
    transition: 'width 0.4s ease, background 0.4s ease',
  },
  body: {
    padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 16,
  },
  group: {
    background: '#fff', borderRadius: 10,
    border: '1px solid #ebebeb', overflow: 'hidden',
  },
  groupHeader: {
    fontSize: 12, fontWeight: 700, color: '#555',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    padding: '10px 16px', background: '#fafafa',
    borderBottom: '1px solid #ebebeb',
  },
  docRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '13px 16px', cursor: 'pointer', position: 'relative',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background 0.15s',
    userSelect: 'none',
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    border: '2px solid',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.15s',
  },
  footer: {
    padding: '16px 20px', textAlign: 'center',
  },
}