import { useState, useEffect, useRef } from 'react'

// ─── API helpers ─────────────────────────────────────────────────────────────
function useBaseUrl() {
  // mirrors how NewCase.jsx reads it
  return (import.meta.env.VITE_BACKEND_URL || 'https://doctorassist.ai//api/').replace(/\/$/, '')
}

function apiUrl(base, path) {
  // path  = "/insurance/web/cases"  → full URL
  return `${base}/insurance${path}`
}

function getAuthHeaders() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || ''
  return {
    'Content-Type': 'application/json',
    'X-User-Id': 'web-user',
    'X-User-Role': 'supervisor',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function fmtDate(val) {
  if (!val) return '—'
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const [y, m, d] = val.substring(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  return val
}

function fmtAmount(val) {
  if (!val && val !== 0) return '—'
  return `₹${Number(val).toLocaleString('en-IN')}`
}

// ─── Fraud indicators ────────────────────────────────────────────────────────
const FRAUD_FLAGS = [
  'Claim filed within 30 days of policy inception',
  'Multiple claims filed in current policy year',
  'Claimant has prior fraud history',
  'FIR filed after delay (>48h post incident)',
  'Witnesses unavailable or uncooperative',
  'Damage inconsistent with reported cause',
  'Repair estimate significantly inflated',
]

// ─── Doctor picker modal ──────────────────────────────────────────────────────
function DoctorModal({ doctors, onSelect, onCancel }) {
  const [sel, setSel] = useState('')

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ width: 480 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Assign Doctor &amp; Submit to QC</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            style={{ padding: '2px 8px', fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Select an auditing doctor to review this report before QC submission.
        </p>

        {/* doctor list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
          {doctors.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 13 }}>
              No auditing doctors found
            </div>
          )}
          {doctors.map(d => (
            <label
              key={d.sys_user_id}
              className="ta-inv-card"
              data-selected={sel === d.sys_user_id ? 'true' : 'false'}
              style={{ cursor: 'pointer' }}
              onClick={() => setSel(d.sys_user_id)}
            >
              <div
                className="ta-inv-avatar"
                style={{ background: sel === d.sys_user_id ? 'rgba(59,130,246,.2)' : 'var(--bg3)', fontSize: 13 }}
              >
                {(d.full_name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ta-inv-name">{d.full_name}</div>
                <div className="ta-inv-meta">{d.email}{d.phone_number ? ` · ${d.phone_number}` : ''}</div>
              </div>
              {sel === d.sys_user_id && (
                <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14 }}>✓</span>
              )}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!sel}
            style={{ opacity: sel ? 1 : 0.45, cursor: sel ? 'pointer' : 'not-allowed' }}
            onClick={() => onSelect(sel)}
          >
            Assign &amp; Submit
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const colors = type === 'success'
    ? { bg: 'rgba(22,163,74,.1)', border: 'var(--green)', color: 'var(--green)' }
    : { bg: 'rgba(220,38,38,.1)', border: 'var(--red)', color: 'var(--red)' }
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 18px', borderRadius: 8,
      background: colors.bg, border: `1px solid ${colors.border}`, color: colors.color,
      fontSize: 13, fontWeight: 500, zIndex: 9999, maxWidth: 360,
      boxShadow: '0 4px 20px rgba(0,0,0,.15)',
      animation: 'rb_fadein .2s ease',
    }}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 18, lineHeight: 1 }}>×</button>
      <style>{`@keyframes rb_fadein { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </div>
  )
}

// ─── Read-only display cell ───────────────────────────────────────────────────
function RO({ value }) {
  return (
    <div style={{
      background: 'var(--bg3)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '8px 12px',
      fontSize: 13, color: 'var(--text)', minHeight: 36,
      opacity: value && value !== '—' ? 1 : 0.5,
    }}>
      {value || '—'}
    </div>
  )
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function ReportBuilder() {
  const BASE_URL = useBaseUrl()

  // list data
  const [cases, setCases]     = useState([])
  const [doctors, setDoctors] = useState([])

  // selected case
  const [selectedId, setSelectedId] = useState('')
  const [claim, setClaim]           = useState(null)
  const [loadingCase, setLoadingCase] = useState(false)

  // initial load
  const [loadingList, setLoadingList] = useState(true)

  // conclusion preview
  const [conclusion, setConclusion] = useState('')

  // form state
  const [form, setForm] = useState({
    idType: 'Aadhaar Card',
    idNumber: '',
    claimantPresent: 'Yes',
    statementConsistent: 'Yes',
    verificationRemarks: '',
    assetInspected: 'Yes',
    damageConsistent: 'Yes — Consistent',
    preExistingDamage: 'No',
    estimatedDamage: '',
    assessmentNotes: '',
    fraudFlags: [],
    recommendation: null,
    justification: '',
  })

  // UI state
  const [saving, setSaving]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showModal, setShowModal]   = useState(false)
  const [toast, setToast]           = useState(null)

  const justRef = useRef(null)

  // ── load case list + doctors ──
  useEffect(() => {
    async function load() {
      setLoadingList(true)
      try {
        const [r1, r2, r3] = await Promise.all([
          fetch(apiUrl(BASE_URL, '/web/cases?status=COMPLETED&limit=200'), { headers: getAuthHeaders() }),
          fetch(apiUrl(BASE_URL, '/web/cases?status=ALLOCATED&limit=200'),  { headers: getAuthHeaders() }),
          fetch(apiUrl(BASE_URL, '/web/doctors'),                           { headers: getAuthHeaders() }),
        ])
        const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()])
        const all  = [...(d1.cases || []), ...(d2.cases || [])]
        const seen = new Set()
        setCases(all.filter(c => { if (seen.has(c.caseId)) return false; seen.add(c.caseId); return true }))
        setDoctors(d3.doctors || [])
      } catch (e) {
        notify('Failed to load cases: ' + e.message, 'error')
      } finally {
        setLoadingList(false)
      }
    }
    load()
  }, [])

  // ── load selected case ──
  useEffect(() => {
    if (!selectedId) { setClaim(null); setConclusion(''); return }
    async function fetch_case() {
      setLoadingCase(true)
      try {
        const r = await fetch(apiUrl(BASE_URL, `/web/cases/${selectedId}`), { headers: getAuthHeaders() })
        if (!r.ok) throw new Error(`Case not found (${r.status})`)
        const data = await r.json()
        setClaim(data)

        // prefill form from claim
        setForm(f => ({
          ...f,
          idType:           data.idProofType   || 'Aadhaar Card',
          idNumber:         data.idProofNumber || '',
          estimatedDamage:  data.billingDetails?.estimatedDamage
                              || data.claimedAmount
                              || '',
          verificationRemarks: data.reportDraft?.verificationRemarks
                                || data.assignmentNotes
                                || '',
          claimantPresent:     data.reportDraft?.claimantPresent     || 'Yes',
          statementConsistent: data.reportDraft?.statementConsistent || 'Yes',
          assetInspected:      data.reportDraft?.assetInspected      || 'Yes',
          damageConsistent:    data.reportDraft?.damageConsistent     || 'Yes — Consistent',
          preExistingDamage:   data.reportDraft?.preExistingDamage   || 'No',
          assessmentNotes:     data.reportDraft?.assessmentNotes     || '',
          fraudFlags:          data.reportDraft?.fraudFlags          || [],
          recommendation:      data.reportDraft?.recommendation      || null,
          justification:       data.reportDraft?.justification       || '',
        }))

        // existing conclusion
        if (data.conclusion) {
          setConclusion(data.conclusion)
        } else {
          try {
            const cr = await fetch(apiUrl(BASE_URL, `/web/conclusion/${selectedId}`), { headers: getAuthHeaders() })
            if (cr.ok) {
              const cd = await cr.json()
              if (cd.success && cd.conclusion) setConclusion(cd.conclusion)
            }
          } catch (_) {}
        }
      } catch (e) {
        notify(e.message, 'error')
      } finally {
        setLoadingCase(false)
      }
    }
    fetch_case()
  }, [selectedId])

  function notify(msg, type = 'success') { setToast({ msg, type }) }
  function setF(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function toggleFlag(flag) {
    setForm(f => ({
      ...f,
      fraudFlags: f.fraudFlags.includes(flag)
        ? f.fraudFlags.filter(x => x !== flag)
        : [...f.fraudFlags, flag],
    }))
  }

  // ── build update payload (mirrors NewCase buildPayload pattern) ──
  function buildDraftPayload() {
    return {
      ...claim,
      idProofType:  form.idType,
      idProofNumber: form.idNumber,
      assignmentNotes: form.verificationRemarks,
      billingDetails: {
        ...(claim?.billingDetails || {}),
        estimatedDamage: form.estimatedDamage,
        assessmentNotes: form.assessmentNotes,
      },
      reportDraft: {
        claimantPresent:     form.claimantPresent,
        statementConsistent: form.statementConsistent,
        assetInspected:      form.assetInspected,
        damageConsistent:    form.damageConsistent,
        preExistingDamage:   form.preExistingDamage,
        verificationRemarks: form.verificationRemarks,
        fraudFlags:          form.fraudFlags,
        recommendation:      form.recommendation,
        justification:       form.justification,
        savedAt:             new Date().toISOString(),
      },
    }
  }

  // ── Save Draft ──
  async function saveDraft() {
    if (!claim) return notify('Select a case first', 'error')
    setSaving(true)
    try {
      const res = await fetch(apiUrl(BASE_URL, `/web/cases/${selectedId}`), {
        method:  'PUT',
        headers: getAuthHeaders(),
        body:    JSON.stringify(buildDraftPayload()),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Save failed')
      notify('Draft saved successfully')
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Validate before submit ──
  function validateSubmit() {
    if (!form.recommendation) { notify('Select a recommendation before submitting', 'error'); return false }
    if (!form.justification.trim()) { justRef.current?.focus(); notify('Justification is required', 'error'); return false }
    return true
  }

  function handleSubmitToQC() {
    if (!claim) return notify('Select a case first', 'error')
    if (!validateSubmit()) return
    setShowModal(true)
  }

  // ── Submit with doctor ──
  async function submitWithDoctor(doctorId) {
    setShowModal(false)
    setSubmitting(true)
    try {
      // 1. Generate conclusion
      const triggers = claim.claimTriggers?.length
        ? claim.claimTriggers
        : claim.claimTrigger ? [claim.claimTrigger] : []

      if (!triggers.length) throw new Error('No claim triggers on this case. Set triggers first.')

      const cr = await fetch(apiUrl(BASE_URL, `/web/generate-conclusion/${selectedId}`), {
        method:  'POST',
        headers: getAuthHeaders(),
        body:    JSON.stringify({ triggers }),
      })
      if (!cr.ok) {
        const e = await cr.json().catch(() => ({}))
        throw new Error(e.detail || 'Conclusion generation failed')
      }
      const cd = await cr.json()
      if (cd.conclusion) setConclusion(cd.conclusion)

      // 2. Update case with doctor + IN_PROGRESS + form data
      const payload = {
        ...buildDraftPayload(),
        doctor_assigned: doctorId,
        status: 'IN_PROGRESS',
        reportDraft: {
          ...buildDraftPayload().reportDraft,
          submittedAt: new Date().toISOString(),
        },
      }
      const ur = await fetch(apiUrl(BASE_URL, `/web/cases/${selectedId}`), {
        method:  'PUT',
        headers: getAuthHeaders(),
        body:    JSON.stringify(payload),
      })
      if (!ur.ok) throw new Error('Case update failed after conclusion generation')

      notify('Report submitted to QC successfully!')
    } catch (e) {
      notify(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── helpers for rendering ──
  const selected = cases.find(c => c.caseId === selectedId)
  const triggers = claim
    ? (claim.claimTriggers?.length ? claim.claimTriggers : claim.claimTrigger ? [claim.claimTrigger] : [])
    : []

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="page-content">

      {/* ── Top bar ── */}
      <div className="panel">
        <div className="panel-body" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}>
          <div className="field" style={{ flex: 1, minWidth: 240, gap: 0 }}>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              disabled={loadingList}
              style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
            >
              <option value="">{loadingList ? 'Loading cases…' : `— Select a case (${cases.length} available) —`}</option>
              {cases.map(c => (
                <option key={c.caseId} value={c.caseId}>
                  {c.caseId} — {c.claimantName}
                </option>
              ))}
            </select>
          </div>

          {claim && (
            <>
              <span className="badge blue">{claim.claimSubtype || claim.tags?.[0] || 'Claim'}</span>
              <span className={`badge ${claim.status === 'COMPLETED' ? 'green' : claim.status === 'IN_PROGRESS' ? 'teal' : 'amber'}`}>
                {claim.status}
              </span>
            </>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!claim || saving}
              onClick={saveDraft}
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!claim || submitting}
              onClick={handleSubmitToQC}
            >
              {submitting ? 'Submitting…' : 'Submit to QC'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Loading case spinner ── */}
      {loadingCase && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', color: 'var(--muted)', fontSize: 13 }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
            animation: 'spin .7s linear infinite', flexShrink: 0,
          }} />
          Loading case…
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* ── Empty state ── */}
      {!claim && !loadingCase && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Select a case to begin</div>
          <div style={{ fontSize: 12, marginTop: 5 }}>All COMPLETED and ALLOCATED cases appear in the dropdown above</div>
        </div>
      )}

      {claim && !loadingCase && (<>

        {/* ── 01 Incident Summary ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="dot" style={{ background: 'var(--accent)' }} />
              01 — Incident Summary
            </span>
            {triggers.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {triggers.map(t => (
                  <span key={t} className="badge blue">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="panel-body">
            {/* stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
              {[
                ['Case ID',        claim.caseId],
                ['Policy No',      claim.policyNumber],
                ['Insurer',        claim.insurer],
                ['Date of Incident', fmtDate(claim.dateOfIncident)],
                ['Date of Intimation', fmtDate(claim.dateOfIntimation)],
                ['Claim Mode',     claim.claimMode],
                ['Claimed Amount', fmtAmount(claim.claimedAmount)],
                ['Sum Insured',    fmtAmount(claim.sumInsured)],
              ].map(([label, val]) => (
                <div key={label} style={{
                  background: 'var(--bg3)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{val || '—'}</div>
                </div>
              ))}
            </div>

            <div className="form-grid cols-3" style={{ marginBottom: 14 }}>
              <div className="field">
                <label>Incident Type</label>
                <RO value={claim.claimSubtype || claim.tags?.join(', ')} />
              </div>
              <div className="field">
                <label>Claim Priority</label>
                <RO value={claim.claimPriority} />
              </div>
              <div className="field">
                <label>Claim Source</label>
                <RO value={claim.claimSource} />
              </div>
            </div>

            <div className="field">
              <label>Incident Description</label>
              <RO value={claim.description} />
            </div>

            {/* accident details if present */}
            {claim.accidentDetails && (
              <div className="form-grid cols-4" style={{ marginTop: 14 }}>
                {[
                  ['Vehicle Number',  claim.accidentDetails.vehicleNumber],
                  ['Accident Place',  claim.accidentDetails.place],
                  ['FIR Number',      claim.accidentDetails.firNumber],
                  ['Police Station',  claim.accidentDetails.policeStation],
                ].filter(([, v]) => v).map(([label, val]) => (
                  <div key={label} className="field">
                    <label>{label}</label>
                    <RO value={val} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── 02 Claimant Verification ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="dot" style={{ background: 'var(--purple)' }} />
              02 — Claimant Verification
            </span>
          </div>
          <div className="panel-body">
            <div className="form-grid cols-4">

              {/* read-only from claim */}
              <div className="field">
                <label>Claimant Name</label>
                <RO value={claim.claimantName} />
              </div>
              <div className="field">
                <label>Mobile</label>
                <RO value={claim.claimantMobile} />
              </div>
              <div className="field">
                <label>City / District</label>
                <RO value={[claim.city, claim.district].filter(Boolean).join(', ')} />
              </div>
              <div className="field">
                <label>Pin Code</label>
                <RO value={claim.pinCode} />
              </div>

              {/* editable fields */}
              <div className="field">
                <label>ID Verified</label>
                <select value={form.idType} onChange={e => setF('idType', e.target.value)}>
                  <option>Aadhaar Card</option>
                  <option>PAN Card</option>
                  <option>Passport</option>
                  <option>Driving Licence</option>
                  <option>Voter ID</option>
                </select>
              </div>
              <div className="field">
                <label>ID Number</label>
                <input
                  type="text"
                  value={form.idNumber}
                  onChange={e => setF('idNumber', e.target.value)}
                  placeholder="Enter ID number"
                />
              </div>
              <div className="field">
                <label>Claimant Present at Field Visit</label>
                <select value={form.claimantPresent} onChange={e => setF('claimantPresent', e.target.value)}>
                  <option>Yes</option>
                  <option>No</option>
                  <option>Representative</option>
                </select>
              </div>
              <div className="field">
                <label>Statement Consistent with FIR</label>
                <select value={form.statementConsistent} onChange={e => setF('statementConsistent', e.target.value)}>
                  <option>Yes</option>
                  <option>No</option>
                  <option>Partially</option>
                </select>
              </div>

              <div className="field span-4">
                <label>Verification Remarks</label>
                <textarea
                  value={form.verificationRemarks}
                  onChange={e => setF('verificationRemarks', e.target.value)}
                  placeholder="Any discrepancies, inconsistencies, or notable observations…"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── 03 Vehicle / Asset Assessment ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="dot" style={{ background: 'var(--amber)' }} />
              03 — Vehicle / Asset Assessment
            </span>
          </div>
          <div className="panel-body">
            <div className="form-grid cols-4">
              {/* prefill read-only */}
              {claim.accidentDetails?.vehicleNumber && (
                <div className="field">
                  <label>Vehicle Reg. No.</label>
                  <RO value={claim.accidentDetails.vehicleNumber} />
                </div>
              )}
              {(claim.accidentDetails?.vehicleMake || claim.accidentDetails?.vehicleModel) && (
                <div className="field">
                  <label>Make / Model</label>
                  <RO value={`${claim.accidentDetails.vehicleMake || ''} ${claim.accidentDetails.vehicleModel || ''}`.trim()} />
                </div>
              )}

              <div className="field">
                <label>Vehicle / Asset Inspected</label>
                <select value={form.assetInspected} onChange={e => setF('assetInspected', e.target.value)}>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </div>
              <div className="field">
                <label>Damage Consistent with Claim</label>
                <select value={form.damageConsistent} onChange={e => setF('damageConsistent', e.target.value)}>
                  <option>Yes — Consistent</option>
                  <option>No — Inconsistent</option>
                  <option>Partially</option>
                </select>
              </div>
              <div className="field">
                <label>Pre-existing Damage Observed</label>
                <select value={form.preExistingDamage} onChange={e => setF('preExistingDamage', e.target.value)}>
                  <option>No</option>
                  <option>Yes — Minor</option>
                  <option>Yes — Major</option>
                </select>
              </div>
              <div className="field">
                <label>Estimated Damage (₹)</label>
                <input
                  type="number"
                  value={form.estimatedDamage}
                  onChange={e => setF('estimatedDamage', e.target.value)}
                  placeholder="0.00"
                  min="0"
                />
              </div>

              <div className="field span-4">
                <label>Assessment Notes</label>
                <textarea
                  value={form.assessmentNotes}
                  onChange={e => setF('assessmentNotes', e.target.value)}
                  placeholder="Detailed description of damage, supporting photos referenced…"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── 04 Fraud Indicators ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="dot" style={{ background: 'var(--red)' }} />
              04 — Fraud Indicators
            </span>
            {form.fraudFlags.length > 0 && (
              <span className="badge red">⚠ {form.fraudFlags.length} flagged</span>
            )}
          </div>
          <div className="panel-body">
            <div className="checklist">
              {FRAUD_FLAGS.map((item, i) => {
                const checked = form.fraudFlags.includes(item)
                return (
                  <div
                    key={i}
                    className="check-item"
                    style={checked ? {
                      borderColor: 'rgba(220,38,38,.4)',
                      background: 'rgba(220,38,38,.05)',
                    } : {}}
                    onClick={() => toggleFlag(item)}
                    style={{
                      cursor: 'pointer',
                      ...(checked ? { borderColor: 'rgba(220,38,38,.4)', background: 'rgba(220,38,38,.05)' } : {}),
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFlag(item)}
                      onClick={e => e.stopPropagation()}
                      style={{ accentColor: 'var(--red)' }}
                    />
                    <div>
                      <div className="check-label">{item}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── 05 Recommendation ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="dot" style={{ background: 'var(--green)' }} />
              05 — Investigator Recommendation
            </span>
          </div>
          <div className="panel-body">
            <div className="rec-cards" style={{ marginBottom: 16 }}>
              {[
                { key: 'genuine',   label: 'Genuine',   icon: '✅', sub: 'Claim appears valid. Recommend settlement.' },
                { key: 'suspicious', label: 'Suspicious', icon: '⚠️', sub: 'Further scrutiny required.' },
                { key: 'repudiate', label: 'Repudiate', icon: '❌', sub: 'Evidence of fraud. Recommend rejection.' },
              ].map(r => (
                <button
                  key={r.key}
                  className={`rec-card ${r.key}${form.recommendation === r.key ? ' selected' : ''}`}
                  onClick={() => setF('recommendation', r.key)}
                  type="button"
                >
                  <div className="rec-card-icon">{r.icon}</div>
                  <div className="rec-card-label">{r.label}</div>
                  <div className="rec-card-sub">{r.sub}</div>
                </button>
              ))}
            </div>

            <div className="field">
              <label>Detailed Justification <span className="req">*</span></label>
              <textarea
                ref={justRef}
                style={{ minHeight: 120 }}
                value={form.justification}
                onChange={e => setF('justification', e.target.value)}
                placeholder="Provide a comprehensive justification for your recommendation, referencing specific evidence…"
              />
            </div>
          </div>
        </div>

        {/* ── 06 AI Conclusion Preview ── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="dot" style={{ background: 'var(--teal)' }} />
              06 — AI-Generated Conclusion
            </span>
            {conclusion && <span className="badge teal">Generated</span>}
          </div>
          <div className="panel-body">
            {conclusion ? (
              <pre style={{
                background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: 16,
                fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)',
                whiteSpace: 'pre-wrap', lineHeight: 1.7,
                maxHeight: 360, overflowY: 'auto',
              }}>{conclusion}</pre>
            ) : (
              <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--muted)', fontSize: 13 }}>
                No conclusion generated yet. Submit to QC to trigger AI conclusion generation using the claim's triggers.
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom actions ── */}
        <div className="nc-submit-bar">
          {!form.recommendation && (
            <span className="nc-submit-hint">⚠ Select a recommendation before submitting</span>
          )}
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
            <button className="btn btn-ghost" disabled={saving} onClick={saveDraft}>
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              className="btn btn-amber"
              disabled={!claim}
              style={{ opacity: claim ? 1 : 0.45 }}
            >
              Request Supervisor Review
            </button>
            <button
              className="btn btn-primary"
              disabled={!claim || submitting}
              style={{ opacity: (!claim || submitting) ? 0.45 : 1 }}
              onClick={handleSubmitToQC}
            >
              {submitting ? 'Submitting…' : 'Submit Report to QC'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

      </>)}

      {/* Doctor modal */}
      {showModal && (
        <DoctorModal
          doctors={doctors}
          onSelect={submitWithDoctor}
          onCancel={() => setShowModal(false)}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}