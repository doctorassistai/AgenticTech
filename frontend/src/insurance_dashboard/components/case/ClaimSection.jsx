import React, { useState, useRef, useEffect } from 'react'
import SuggestionBanner from '../case/SuggestionBanner'

const TRIGGER_OPTIONS = [
  { value: 'claim_genuinity_authenticity', label: 'Claim Genuinity & Authenticity' },
  { value: 'ped_non_disclosure', label: 'PED / Non-Disclosure' },
  { value: 'accident_incident_verification', label: 'Accident / Incident Verification' },
  { value: 'intoxication_addiction', label: 'Intoxication / Addiction' },
  { value: 'medical_records_treatment_verification', label: 'Medical Records & Treatment Verification' },
  { value: 'financial_claim_pattern_risk', label: 'Financial & Claim Pattern Risk' },
  { value: 'policy_coverage_verification', label: 'Policy & Coverage Verification' },
  { value: 'field_vicinity_investigation', label: 'Field / Vicinity Investigation' },
  { value: 'legal_regulatory_death_verification', label: 'Legal / Regulatory / Death Verification' },
  { value: 'hospital_criteria_watchlist', label: 'Hospital Criteria / Watchlist Hospital' },
  { value: 'employee_corporate_group_policy_verification', label: 'Employee / Corporate / Group Policy Verification' },
  { value: 'hospital_cash_benefit_abuse', label: 'Hospital Cash / Benefit Abuse' },
  { value: 'suspicious_claim_pattern_repeat_fraud', label: 'Suspicious Claim Pattern / Repeat Fraud Indicators' },
  { value: 'final_universal_red_flags_matrix', label: 'Final Universal Red Flags Matrix (Master Cross-Trigger Fraud Detection Sheet)' }
]

// Add this constant near the top of ClaimSection.jsx
const CLAIM_SUB_MODE_OPTIONS = {
  reimbursement: [
    { value: 'normal',   label: 'Normal' },
    { value: 'accident', label: 'Accident' },
  ],
  personal_accident: [
    { value: 'normal',           label: 'Normal' },
    { value: 'death',            label: 'Death' },
    { value: 'critical_illness', label: 'Critical Illness' },
    { value: 'pt_td',            label: 'PT / TD (Permanent Total Disability)' },
    { value: 'railway_death',    label: 'Railway Death' },
  ],
}

// ── Tag options now includes Railway ────────────────────────────────────────
const TAG_OPTIONS = ['Accident', 'Death', 'Railway', 'Critical Illness', 'Normal']

// ── Multi-select trigger checklist dropdown ──────────────────────────────────
function TriggerMultiSelect({ value = [], onChange }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (val) => {
    if (value.includes(val)) {
      onChange(value.filter(v => v !== val))
    } else {
      onChange([...value, val])
    }
  }

  const selectAll = () => onChange(TRIGGER_OPTIONS.map(o => o.value))
  const clearAll = () => onChange([])

  const displayLabel = value.length === 0
    ? 'Select triggers...'
    : value.length === 1
      ? TRIGGER_OPTIONS.find(o => o.value === value[0])?.label
      : `${value.length} triggers selected`

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '7px 10px',
          background: 'var(--bg3, #1e1e2e)',
          border: '1px solid var(--border, #333)',
          borderRadius: 'var(--radius-sm, 6px)',
          color: value.length === 0 ? 'var(--muted, #666)' : 'var(--fg, #fff)',
          fontSize: 13,
          cursor: 'pointer',
          textAlign: 'left',
          outline: open ? '2px solid var(--amber, #f59e0b)' : 'none',
          outlineOffset: -1,
          transition: 'outline 0.1s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {displayLabel}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {value.map(v => {
            const label = TRIGGER_OPTIONS.find(o => o.value === v)?.label || v
            return (
              <span
                key={v}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'var(--amber, #f59e0b)22',
                  border: '1px solid var(--amber, #f59e0b)55',
                  borderRadius: 4, padding: '2px 6px', fontSize: 11,
                  color: 'var(--amber, #f59e0b)', maxWidth: 240,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(v) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--amber, #f59e0b)', padding: 0, lineHeight: 1,
                    flexShrink: 0, fontSize: 13, fontWeight: 700,
                  }}
                >×</button>
              </span>
            )
          })}
        </div>
      )}

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, marginTop: 4,
          background: 'var(--bg2, #16161e)', border: '1px solid var(--border, #333)',
          borderRadius: 'var(--radius-sm, 6px)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '7px 10px', borderBottom: '1px solid var(--border, #333)',
            background: 'var(--bg3, #1e1e2e)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--muted, #666)', fontWeight: 500 }}>
              {value.length} / {TRIGGER_OPTIONS.length} selected
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={selectAll}
                style={{ fontSize: 11, background: 'none', border: 'none', color: 'var(--amber, #f59e0b)', cursor: 'pointer', padding: 0 }}>
                Select all
              </button>
              <span style={{ color: 'var(--border, #333)' }}>|</span>
              <button type="button" onClick={clearAll}
                style={{ fontSize: 11, background: 'none', border: 'none', color: 'var(--muted, #666)', cursor: 'pointer', padding: 0 }}>
                Clear
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {TRIGGER_OPTIONS.map((opt, i) => {
              const checked = value.includes(opt.value)
              return (
                <div
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    cursor: 'pointer', minHeight: 52, userSelect: 'none',
                    background: checked ? 'rgba(59,130,246,.08)' : 'var(--bg2)',
                    borderBottom: i < TRIGGER_OPTIONS.length - 1 ? '1px solid var(--border)' : 'none',
                    transition: 'all .15s ease',
                  }}
                >
                  <input
                    type="checkbox" checked={checked} onChange={() => toggle(opt.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 16, height: 16, accentColor: 'var(--amber)', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, lineHeight: 1.45, flex: 1, color: 'var(--text)', fontWeight: checked ? 600 : 400 }}>
                    {opt.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Railway tag blank state ─────────────────────────────────────────────────
const BLANK_RAILWAY = {
  incidentDate: '', incidentTime: '', stationNear: '', trainNumber: '',
  trainName: '', coachNumber: '', panchanama: false, witnessName: '',
  witnessAddress: '', witnessStatement: '', spotPhotos: false, spotVideos: false,
  policeReported: '', firNumber: '', mlcNumber: '', narration: '',
}

export default function ClaimSection({
  formData,
  setFormData,
  handleChange,
  sectionRefs,
  sectionProgress,
  SectionBadge,
  riskLabel,
  setAutoPriority,
  extractedSuggestions = {},
    unfilledFields = new Set()   // ← add this

}) {
  const [dismissed, setDismissed] = useState({})
  const dismiss = (key) => setDismissed(p => ({ ...p, [key]: true }))

  const showBanner = (key, currentVal) => {
    const extracted = extractedSuggestions[key]
    return extracted && !dismissed[key] && extracted !== currentVal
  }

  const tags = formData.tags || []
  const selectedTriggers = formData.claimTriggers || []

  const handleTriggersChange = (vals) => {
    setFormData(prev => ({
      ...prev,
      claimTriggers: vals,
    }))
  }

  const handleTagChange = (val) => {
    if (val.includes('Normal') && val.length > 1) {
      alert('Normal cannot be combined with other tags')
      return
    }
    setFormData(prev => ({
      ...prev,
      tags: val,
      accidentDetails: val.includes('Accident') ? (prev.accidentDetails || {
        dateTime: '', place: '', spotOfAccident: '', witness: '', witnessAddress: '',
        witnessStatement: '', broughtBy: '', broughtByNumber: '', broughtByAddress: '',
        broughtByStatement: '', firstAidHospital: '', firstAidDetails: '', fcpCollected: false,
        opCardCollected: false, patientNarration: '', helmetWorn: '', seatbeltWorn: '',
        vehicleDamagePercentage: '', vehicleType: '', policeReported: '', firNumber: '', mlcNumber: ''
      }) : {
        dateTime: '', place: '', spotOfAccident: '', witness: '', witnessAddress: '',
        witnessStatement: '', broughtBy: '', broughtByNumber: '', broughtByAddress: '',
        broughtByStatement: '', firstAidHospital: '', firstAidDetails: '', fcpCollected: false,
        opCardCollected: false, patientNarration: '', helmetWorn: '', seatbeltWorn: '',
        vehicleDamagePercentage: '', vehicleType: '', policeReported: '', firNumber: '', mlcNumber: ''
      },
      deathDetails: val.includes('Death') ? (prev.deathDetails || {
        date: '', time: '', reason: '', place: '', spotOfDeath: '', witness: '',
        witnessAddress: '', witnessStatement: '', broughtBy: '', broughtByNumber: '',
        broughtByAddress: '', broughtByStatement: '', incidentNarration: '',
        psychiatricHistory: '', depressionHistory: '', suicidalHistory: '',
        alcoholHistory: '', beneficiaryName: '', beneficiaryRelationship: '',
        beneficiaryStatement: '', postmortem: '', postmortemReport: '', claimDocumentRef: ''
      }) : {
        date: '', time: '', reason: '', place: '', spotOfDeath: '', witness: '',
        witnessAddress: '', witnessStatement: '', broughtBy: '', broughtByNumber: '',
        broughtByAddress: '', broughtByStatement: '', incidentNarration: '',
        psychiatricHistory: '', depressionHistory: '', suicidalHistory: '',
        alcoholHistory: '', beneficiaryName: '', beneficiaryRelationship: '',
        beneficiaryStatement: '', postmortem: '', postmortemReport: '', claimDocumentRef: ''
      },
      railwayDetails: val.includes('Railway') ? (prev.railwayDetails || BLANK_RAILWAY) : BLANK_RAILWAY,
    }))
  }

  const updateNested = (key, field, value) => {
    setFormData(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }))
  }

  const riskColor = {
    Low: 'var(--green)', Medium: 'var(--amber)', High: 'var(--red)', Critical: 'var(--red)'
  }[riskLabel] || 'var(--muted)'

  return (
    <div className="panel" ref={sectionRefs.claim}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="dot" style={{ background: 'var(--amber)' }} />
          Claim Details
        </div>
        <SectionBadge pct={sectionProgress('claim')} color="var(--amber)" />
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Row 1: Core identifiers ── */}
        <div className="form-grid cols-4">

          <div className="field">
            <label>Claim Mode <span className="req">*</span></label>
            <select
  value={formData.claimMode}
  // FIND the claimMode <select> onChange and REPLACE with:
onChange={(e) => {
  const value = e.target.value
  setFormData(prev => ({
    ...prev,
    claimMode: value,
    claimSubMode: '',   // reset sub-mode when mode changes
    reimbursementDetails: value === 'cashless'
      ? { bankDetails: '', accountName: '', ifsc: '' }
      : prev.reimbursementDetails,
    cashlessDetails: value === 'reimbursement'
      ? { admissionType: '', estimatedCost: '', preAuthDetails: '' }
      : prev.cashlessDetails
  }))
}}
style={{
    borderColor: unfilledFields.has('claimMode') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('claimMode') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
>
  <option value="">Select</option>
  <option value="cashless">Cashless</option>
  <option value="reimbursement">Reimbursement</option>
  <option value="personal_accident">Personal Accident</option>
  <option value="death">Death</option>
  <option value="railway_accident">Railway Accident</option>
  <option value="sme_verification">SME Verification</option>
  <option value="critical_illness">Critical Illness</option>
  <option value="asset_verification">Asset Verification</option>
  <option value="bill_verification">Bill Verification / Domiciliary</option>
   <option value="document_verification">Document Verification</option>  {/* ← new */}
  <option value="client_verification">Client Verification</option>       {/* ← new */}
  <option value="others">Others</option>    
</select>
            {showBanner('claimMode', formData.claimMode) && (
              <SuggestionBanner
                value={extractedSuggestions['claimMode']}
                onApply={(v) => {
                  setFormData(prev => ({
                    ...prev,
                    claimMode: v,
                    reimbursementDetails: v === 'cashless' ? { bankDetails: '', accountName: '', ifsc: '' } : prev.reimbursementDetails,
                    cashlessDetails: v === 'reimbursement' ? { admissionType: '', estimatedCost: '', preAuthDetails: '' } : prev.cashlessDetails
                  }))
                  dismiss('claimMode')
                }}
                onDismiss={() => dismiss('claimMode')}
              />
            )}
          </div>
          {/* ── Sub-mode dropdown — only for reimbursement and personal_accident ── */}
{CLAIM_SUB_MODE_OPTIONS[formData.claimMode] && (
  <div className="field">
    <label>
      {formData.claimMode === 'reimbursement'
        ? 'Reimbursement Type'
        : 'PA Sub-type'
      }
      {' '}<span className="req">*</span>
    </label>
    <select
      value={formData.claimSubMode || ''}
      onChange={e => handleChange('claimSubMode', e.target.value)}
    >
      <option value="">Select...</option>
      {CLAIM_SUB_MODE_OPTIONS[formData.claimMode].map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
)}

          <div className="field">
            <label>Claim Subtype <span className="req">*</span></label>
            <select
  value={formData.claimSubtype}
  onChange={e => handleChange('claimSubtype', e.target.value)}
  style={{
    borderColor: unfilledFields.has('claimSubtype') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('claimSubtype') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
>
              <option value="">Select</option>
              <option value="preauth">Pre-Authorization</option>
              <option value="post">Post-Hospitalization</option>
              <option value="daycare">Daycare Procedure</option>
              <option value="opd">OPD</option>
              <option value="maternity">Maternity</option>
              <option value="surgical">Surgical</option>
            </select>
            {showBanner('claimSubtype', formData.claimSubtype) && (
              <SuggestionBanner
                value={extractedSuggestions['claimSubtype']}
                onApply={(v) => { handleChange('claimSubtype', v); dismiss('claimSubtype') }}
                onDismiss={() => dismiss('claimSubtype')}
              />
            )}
          </div>

          <div className="field">
            <label>Date of Incident</label>
            <input
              type="text" placeholder="DD/MM/YYYY"
              value={formData.dateOfIncident}
              onChange={e => handleChange('dateOfIncident', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Claimed Amount (₹) <span className="req">*</span></label>
            <input
              type="number" placeholder="0.00"
              value={formData.claimedAmount}
              onChange={e => handleChange('claimedAmount', e.target.value)}
            />
          </div>

        </div>

        {/* ── Row 2: Hospital Details ── */}
        <div className="form-grid cols-4">

          <div className="field">
            <label>Hospital Name <span className="req">*</span></label>
            <input
              value={formData.hospitalDetails?.name || ''}
              placeholder="e.g. Apollo Hospitals, Delhi"
              onChange={e => updateNested('hospitalDetails', 'name', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Hospital Type</label>
            <input
              type="text" placeholder="Network / Non-Network"
              value={formData.hospitalDetails?.type || ''}
              onChange={e => updateNested('hospitalDetails', 'type', e.target.value)}
            />
            {showBanner('hospitalDetails.type', formData.hospitalDetails?.type) && (
              <SuggestionBanner
                value={extractedSuggestions['hospitalDetails.type']}
                onApply={(v) => { updateNested('hospitalDetails', 'type', v); dismiss('hospitalDetails.type') }}
                onDismiss={() => dismiss('hospitalDetails.type')}
              />
            )}
          </div>

          <div className="field">
            <label>Admission Date <span className="req">*</span></label>
            <input
              type="text" placeholder="DD/MM/YYYY"
              value={formData.hospitalDetails?.admissionDate || ''}
              onChange={e => updateNested('hospitalDetails', 'admissionDate', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Discharge Date</label>
            <input
              type="text" placeholder="DD/MM/YYYY"
              value={formData.hospitalDetails?.dischargeDate || ''}
              onChange={e => updateNested('hospitalDetails', 'dischargeDate', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Hospital Address</label>
            <input
              value={formData.hospitalDetails?.address || ''}
              placeholder="Full hospital address"
              onChange={e => updateNested('hospitalDetails', 'address', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Treating Doctor</label>
            <input
              value={formData.hospitalDetails?.doctorName || ''}
              placeholder="Dr. full name"
              onChange={e => updateNested('hospitalDetails', 'doctorName', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Speciality / Department</label>
            <input
              type="text" placeholder="e.g. Cardiology, Orthopaedics..."
              value={formData.hospitalDetails?.department || ''}
              onChange={e => updateNested('hospitalDetails', 'department', e.target.value)}
            />
            {showBanner('hospitalDetails.department', formData.hospitalDetails?.department) && (
              <SuggestionBanner
                value={extractedSuggestions['hospitalDetails.department']}
                onApply={(v) => { updateNested('hospitalDetails', 'department', v); dismiss('hospitalDetails.department') }}
                onDismiss={() => dismiss('hospitalDetails.department')}
              />
            )}
          </div>

          <div className="field">
            <label>Hospital Contact Number</label>
            <input
              type="tel" placeholder="Hospital phone number"
              value={formData.hospitalDetails?.hospitalContactNumber || ''}
              onChange={e => updateNested('hospitalDetails', 'hospitalContactNumber', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Hospital Email Address</label>
            <input
              type="email" placeholder="hospital@example.com"
              value={formData.hospitalDetails?.hospitalEmail || ''}
              onChange={e => updateNested('hospitalDetails', 'hospitalEmail', e.target.value)}
            />
          </div>
          <div className="field">
  <label>Hospital Pincode</label>
  <input
    type="text"
    placeholder="6-digit pincode"
    maxLength={6}
    value={formData.hospitalPincode || ''}
    onChange={e => setFormData(prev => ({ ...prev, hospitalPincode: e.target.value }))}
  />
</div>
{/* Past Hospital Details — for HV */}
<div className="field">
  <label>Past Hospital Name</label>
  <input
    value={formData.pastHospitalDetails?.name || ''}
    placeholder="e.g. City General Hospital"
    onChange={e => updateNested('pastHospitalDetails', 'name', e.target.value)}
  />
</div>

<div className="field">
  <label>Past Hospital Pincode</label>
  <input
    type="text"
    placeholder="6-digit pincode"
    maxLength={6}
    value={formData.pastHospitalPincode || ''}
    onChange={e => setFormData(prev => ({ ...prev, pastHospitalPincode: e.target.value }))}
  />
</div>

{/* Digi Verification Pincode — for DIGI/TELE */}
<div className="field">
  <label>Digi Verification Pincode</label>
  <input
    type="text"
    placeholder="6-digit pincode"
    maxLength={6}
    value={formData.digiPincode || ''}
    onChange={e => setFormData(prev => ({ ...prev, digiPincode: e.target.value }))}
  />
</div>
        </div>

        {/* ── Row 3: Tags + Trigger + Priority + Risk ── */}
        <div className="form-grid cols-4">


          {/* Multi-select Trigger */}
          <div className="field span-2">
            <label>
              Triggers <span className="req">*</span>
              {selectedTriggers.length > 0 && (
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 600,
                  background: 'var(--amber, #f59e0b)', color: '#000',
                  borderRadius: 10, padding: '1px 6px', verticalAlign: 'middle',
                }}>
                  {selectedTriggers.length}
                </span>
              )}
            </label>
            <div style={{
  borderRadius: 6,
  outline: unfilledFields.has('claimTriggers') ? '2px solid #ef4444' : undefined,
  boxShadow: unfilledFields.has('claimTriggers') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
}}>
            <TriggerMultiSelect value={selectedTriggers} onChange={handleTriggersChange} /></div>
            {(() => {
  const suggested = extractedSuggestions?.suggestedTriggers
  if (!Array.isArray(suggested) || !suggested.length || dismissed['suggestedTriggers']) return null
  const newOnes = suggested.filter(v => !selectedTriggers.includes(v))
  if (!newOnes.length) return null
  const labels = newOnes.map(v => TRIGGER_OPTIONS.find(o => o.value === v)?.label || v).join(', ')
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6,
      padding: '6px 8px', marginTop: 4,
      background: 'color-mix(in srgb, var(--amber,#f59e0b) 10%, transparent)',
      border: '1px solid color-mix(in srgb, var(--amber,#f59e0b) 25%, transparent)',
      borderRadius: 6, fontSize: 11, color: 'var(--amber,#b45309)',
    }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>✨</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>Suggested triggers: </span>
        <span style={{ opacity: 0.85 }}>{labels}</span>
        <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
          <button
            type="button"
            onClick={() => {
              handleTriggersChange([...new Set([...selectedTriggers, ...newOnes])])
              dismiss('suggestedTriggers')
            }}
            style={{
              fontSize: 11, fontWeight: 600, padding: '2px 10px',
              background: 'var(--amber,#f59e0b)', color: '#000',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}
          >+ Add all ({newOnes.length})</button>
          <button
            type="button"
            onClick={() => dismiss('suggestedTriggers')}
            style={{
              fontSize: 11, padding: '2px 8px', background: 'none',
              border: '1px solid currentColor', borderRadius: 4,
              cursor: 'pointer', color: 'inherit', opacity: 0.7,
            }}
          >Dismiss</button>
        </div>
      </div>
    </div>
  )
})()}
            <small style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
              Select one or more triggers — conclusion will be generated for all selected
            </small>
          </div>

          {/* Claim Priority */}
          <div className="field">
            <label>Claim Priority</label>
            <select
              value={formData.claimPriority}
              onChange={(e) => {
                setAutoPriority(false)
                handleChange('claimPriority', e.target.value)
              }}
            >
              <option>Normal</option>
              <option>High</option>
              <option>Urgent</option>
              <option>Critical</option>
            </select>
          </div>

          {/* Risk Level */}
          <div className="field">
            <label>Risk Level</label>
            <div style={{
              background: 'var(--bg3)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 12px',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, fontWeight: 500, color: riskColor
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: riskColor, flexShrink: 0 }} />
              {riskLabel || 'Calculating...'}
            </div>
          </div>

        </div>

        {/* ── ACCIDENT tag expansion ── */}
        {tags.includes('Accident') && (
          <div className="tag-section">
            <div className="tag-section-header">Accident Details (As per MV Checklist)</div>
            <div className="tag-section-body">

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Date &amp; Time of Accident</label>
                  <input type="text" placeholder="DD/MM/YYYY HH:MM"
                    value={formData.accidentDetails?.dateTime || ''}
                    onChange={e => updateNested('accidentDetails', 'dateTime', e.target.value)} />
                </div>
                <div className="field">
                  <label>Site/Spot of Accident</label>
                  <input placeholder="e.g. NH-48, near Gurugram toll plaza"
                    value={formData.accidentDetails?.place || ''}
                    onChange={e => updateNested('accidentDetails', 'place', e.target.value)} />
                </div>
                <div className="field">
                  <label>Specific Spot Details</label>
                  <input placeholder="Road name, landmark, exact location"
                    value={formData.accidentDetails?.spotOfAccident || ''}
                    onChange={e => updateNested('accidentDetails', 'spotOfAccident', e.target.value)} />
                </div>
                <div className="field">
                  <label>Vehicle Type</label>
                  <input type="text" placeholder="e.g. Two-Wheeler, Car, Bus..."
                    value={formData.accidentDetails?.vehicleType || ''}
                    onChange={e => updateNested('accidentDetails', 'vehicleType', e.target.value)} />
                  {showBanner('accidentDetails.vehicleType', formData.accidentDetails?.vehicleType) && (
                    <SuggestionBanner
                      value={extractedSuggestions['accidentDetails.vehicleType']}
                      onApply={(v) => { updateNested('accidentDetails', 'vehicleType', v); dismiss('accidentDetails.vehicleType') }}
                      onDismiss={() => dismiss('accidentDetails.vehicleType')}
                    />
                  )}
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Was Helmet Worn?</label>
                  <input type="text" placeholder="yes / no / not applicable"
                    value={formData.accidentDetails?.helmetWorn || ''}
                    onChange={e => updateNested('accidentDetails', 'helmetWorn', e.target.value)} />
                  {showBanner('accidentDetails.helmetWorn', formData.accidentDetails?.helmetWorn) && (
                    <SuggestionBanner
                      value={extractedSuggestions['accidentDetails.helmetWorn']}
                      onApply={(v) => { updateNested('accidentDetails', 'helmetWorn', v); dismiss('accidentDetails.helmetWorn') }}
                      onDismiss={() => dismiss('accidentDetails.helmetWorn')}
                    />
                  )}
                </div>
                <div className="field">
                  <label>Was Seatbelt Worn?</label>
                  <input type="text" placeholder="yes / no / not applicable"
                    value={formData.accidentDetails?.seatbeltWorn || ''}
                    onChange={e => updateNested('accidentDetails', 'seatbeltWorn', e.target.value)} />
                  {showBanner('accidentDetails.seatbeltWorn', formData.accidentDetails?.seatbeltWorn) && (
                    <SuggestionBanner
                      value={extractedSuggestions['accidentDetails.seatbeltWorn']}
                      onApply={(v) => { updateNested('accidentDetails', 'seatbeltWorn', v); dismiss('accidentDetails.seatbeltWorn') }}
                      onDismiss={() => dismiss('accidentDetails.seatbeltWorn')}
                    />
                  )}
                </div>
                <div className="field">
                  <label>Percentage of Vehicle Damage</label>
                  <input type="text" placeholder="e.g. 40%, Major/Minor damage"
                    value={formData.accidentDetails?.vehicleDamagePercentage || ''}
                    onChange={e => updateNested('accidentDetails', 'vehicleDamagePercentage', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Witness Name</label>
                  <input placeholder="Full name of witness"
                    value={formData.accidentDetails?.witness || ''}
                    onChange={e => updateNested('accidentDetails', 'witness', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Witness Address</label>
                  <input placeholder="Complete address with landmark"
                    value={formData.accidentDetails?.witnessAddress || ''}
                    onChange={e => updateNested('accidentDetails', 'witnessAddress', e.target.value)} />
                </div>
                <div className="field span-3">
                  <label>Witness Statement</label>
                  <textarea rows={2} placeholder="Detailed statement from witness about the accident"
                    value={formData.accidentDetails?.witnessStatement || ''}
                    onChange={e => updateNested('accidentDetails', 'witnessStatement', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Person who brought to hospital</label>
                  <input placeholder="Name"
                    value={formData.accidentDetails?.broughtBy || ''}
                    onChange={e => updateNested('accidentDetails', 'broughtBy', e.target.value)} />
                </div>
                <div className="field">
                  <label>Contact Number</label>
                  <input placeholder="Mobile number"
                    value={formData.accidentDetails?.broughtByNumber || ''}
                    onChange={e => updateNested('accidentDetails', 'broughtByNumber', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Address</label>
                  <input placeholder="Complete address"
                    value={formData.accidentDetails?.broughtByAddress || ''}
                    onChange={e => updateNested('accidentDetails', 'broughtByAddress', e.target.value)} />
                </div>
                <div className="field span-3">
                  <label>Statement of person who brought</label>
                  <textarea rows={2} placeholder="Statement about how they found the patient, what happened"
                    value={formData.accidentDetails?.broughtByStatement || ''}
                    onChange={e => updateNested('accidentDetails', 'broughtByStatement', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field span-2">
                  <label>First Aid Taken At (Hospital/Clinic)</label>
                  <input placeholder="Name of hospital/clinic where first aid was given"
                    value={formData.accidentDetails?.firstAidHospital || ''}
                    onChange={e => updateNested('accidentDetails', 'firstAidHospital', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>First Aid Details</label>
                  <input placeholder="Type of treatment given"
                    value={formData.accidentDetails?.firstAidDetails || ''}
                    onChange={e => updateNested('accidentDetails', 'firstAidDetails', e.target.value)} />
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox"
                      checked={formData.accidentDetails?.fcpCollected || false}
                      onChange={e => updateNested('accidentDetails', 'fcpCollected', e.target.checked)} />
                    {' '}FCP Collected
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox"
                      checked={formData.accidentDetails?.opCardCollected || false}
                      onChange={e => updateNested('accidentDetails', 'opCardCollected', e.target.checked)} />
                    {' '}OP Card Collected
                  </label>
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field span-4">
                  <label>Detailed Narration of Accident by Patient</label>
                  <textarea rows={3}
                    placeholder="Patient's own words describing the accident sequence, time, location, parties involved, injuries sustained..."
                    value={formData.accidentDetails?.patientNarration || ''}
                    onChange={e => updateNested('accidentDetails', 'patientNarration', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Police Reported?</label>
                  <select value={formData.accidentDetails?.policeReported || ''}
                    onChange={e => updateNested('accidentDetails', 'policeReported', e.target.value)}>
                    <option value="">Select</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div className="field">
                  <label>FIR Number</label>
                  <input placeholder="FIR registration number"
                    value={formData.accidentDetails?.firNumber || ''}
                    onChange={e => updateNested('accidentDetails', 'firNumber', e.target.value)} />
                </div>
                <div className="field">
                  <label>MLC Number</label>
                  <input placeholder="Medico-Legal Case number"
                    value={formData.accidentDetails?.mlcNumber || ''}
                    onChange={e => updateNested('accidentDetails', 'mlcNumber', e.target.value)} />
                </div>
                <div className="field">
                  <label>Police Station</label>
                  <input placeholder="Name of police station"
                    value={formData.accidentDetails?.policeStation || ''}
                    onChange={e => updateNested('accidentDetails', 'policeStation', e.target.value)} />
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── DEATH tag expansion ── */}
        {tags.includes('Death') && (
          <div className="tag-section">
            <div className="tag-section-header">Death Details (As per MV Checklist)</div>
            <div className="tag-section-body">

              <div className="tag-trigger-box">
                <div className="tag-trigger-title">Trigger Checks (Mandatory)</div>
                <div className="form-grid cols-4">
                  <div className="field">
                    <label className="checkbox-row">
                      <input type="checkbox"
                        checked={formData.deathDetails?.suicidalHistory === 'yes'}
                        onChange={e => updateNested('deathDetails', 'suicidalHistory', e.target.checked ? 'yes' : 'no')} />
                      <span>Suicidal History / Attempt</span>
                    </label>
                  </div>
                  <div className="field">
                    <label className="checkbox-row">
                      <input type="checkbox"
                        checked={formData.deathDetails?.alcoholHistory === 'yes'}
                        onChange={e => updateNested('deathDetails', 'alcoholHistory', e.target.checked ? 'yes' : 'no')} />
                      <span>Alcohol History</span>
                    </label>
                  </div>
                  <div className="field">
                    <label className="checkbox-row">
                      <input type="checkbox"
                        checked={formData.deathDetails?.depressionHistory === 'yes'}
                        onChange={e => updateNested('deathDetails', 'depressionHistory', e.target.checked ? 'yes' : 'no')} />
                      <span>Depression History</span>
                    </label>
                  </div>
                  <div className="field">
                    <label className="checkbox-row">
                      <input type="checkbox"
                        checked={formData.deathDetails?.psychiatricHistory === 'yes'}
                        onChange={e => updateNested('deathDetails', 'psychiatricHistory', e.target.checked ? 'yes' : 'no')} />
                      <span>Other Psychiatric History</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Date of Death <span className="req">*</span></label>
                  <input type="text" placeholder="DD/MM/YYYY"
                    value={formData.deathDetails?.date || ''}
                    onChange={e => updateNested('deathDetails', 'date', e.target.value)} />
                </div>
                <div className="field">
                  <label>Time of Death <span className="req">*</span></label>
                  <input type="time"
                    value={formData.deathDetails?.time || ''}
                    onChange={e => updateNested('deathDetails', 'time', e.target.value)} />
                </div>
                <div className="field">
                  <label>Place of Death <span className="req">*</span></label>
                  <select value={formData.deathDetails?.place || ''}
                    onChange={e => updateNested('deathDetails', 'place', e.target.value)}>
                    <option value="">Select</option>
                    <option>Hospital / ICU</option>
                    <option>Home</option>
                    <option>On the way to hospital</option>
                    <option>At accident spot</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="field">
                  <label>Specific Site/Spot of Death</label>
                  <input placeholder="Exact location where death occurred"
                    value={formData.deathDetails?.spotOfDeath || ''}
                    onChange={e => updateNested('deathDetails', 'spotOfDeath', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field span-2">
                  <label>Reason/Cause of Death <span className="req">*</span></label>
                  <input placeholder="e.g. Cardiac arrest, Multiple organ failure"
                    value={formData.deathDetails?.reason || ''}
                    onChange={e => updateNested('deathDetails', 'reason', e.target.value)} />
                </div>
                <div className="field">
                  <label>Postmortem Conducted?</label>
                  <select value={formData.deathDetails?.postmortem || ''}
                    onChange={e => updateNested('deathDetails', 'postmortem', e.target.value)}>
                    <option value="">Select</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div className="field">
                  <label>Postmortem Report Reference</label>
                  <input value={formData.deathDetails?.postmortemReport || ''}
                    onChange={e => updateNested('deathDetails', 'postmortemReport', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Witness Name <span className="req">*</span></label>
                  <input value={formData.deathDetails?.witness || ''}
                    onChange={e => updateNested('deathDetails', 'witness', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Witness Address</label>
                  <input value={formData.deathDetails?.witnessAddress || ''}
                    onChange={e => updateNested('deathDetails', 'witnessAddress', e.target.value)} />
                </div>
                <div className="field span-3">
                  <label>Witness Statement</label>
                  <textarea rows={2}
                    value={formData.deathDetails?.witnessStatement || ''}
                    onChange={e => updateNested('deathDetails', 'witnessStatement', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Person who brought to hospital</label>
                  <input value={formData.deathDetails?.broughtBy || ''}
                    onChange={e => updateNested('deathDetails', 'broughtBy', e.target.value)} />
                </div>
                <div className="field">
                  <label>Contact Number</label>
                  <input value={formData.deathDetails?.broughtByNumber || ''}
                    onChange={e => updateNested('deathDetails', 'broughtByNumber', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Address</label>
                  <input value={formData.deathDetails?.broughtByAddress || ''}
                    onChange={e => updateNested('deathDetails', 'broughtByAddress', e.target.value)} />
                </div>
                <div className="field span-3">
                  <label>Statement</label>
                  <textarea rows={2}
                    value={formData.deathDetails?.broughtByStatement || ''}
                    onChange={e => updateNested('deathDetails', 'broughtByStatement', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field span-4">
                  <label>Detailed Narration of Incident <span className="req">*</span></label>
                  <textarea rows={3}
                    value={formData.deathDetails?.incidentNarration || ''}
                    onChange={e => updateNested('deathDetails', 'incidentNarration', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>SDF Filled By <span className="req">*</span></label>
                  <input value={formData.deathDetails?.beneficiaryName || ''}
                    onChange={e => updateNested('deathDetails', 'beneficiaryName', e.target.value)} />
                </div>
                <div className="field">
                  <label>Relationship</label>
                  <input value={formData.deathDetails?.beneficiaryRelationship || ''}
                    onChange={e => updateNested('deathDetails', 'beneficiaryRelationship', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Beneficiary Statement</label>
                  <input value={formData.deathDetails?.beneficiaryStatement || ''}
                    onChange={e => updateNested('deathDetails', 'beneficiaryStatement', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field span-2">
                  <label>Claim Document Reference</label>
                  <input value={formData.deathDetails?.claimDocumentRef || ''}
                    onChange={e => updateNested('deathDetails', 'claimDocumentRef', e.target.value)} />
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── RAILWAY tag expansion ── */}
        {tags.includes('Railway') && (
          <div className="tag-section">
            <div className="tag-section-header">🚂 Railway Accident Details</div>
            <div className="tag-section-body">

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Date of Incident</label>
                  <input type="text" placeholder="DD/MM/YYYY"
                    value={formData.railwayDetails?.incidentDate || ''}
                    onChange={e => updateNested('railwayDetails', 'incidentDate', e.target.value)} />
                </div>
                <div className="field">
                  <label>Time of Incident</label>
                  <input type="time"
                    value={formData.railwayDetails?.incidentTime || ''}
                    onChange={e => updateNested('railwayDetails', 'incidentTime', e.target.value)} />
                </div>
                <div className="field">
                  <label>Nearest Station / Location</label>
                  <input placeholder="e.g. Near Kalyan station, Mumbai"
                    value={formData.railwayDetails?.stationNear || ''}
                    onChange={e => updateNested('railwayDetails', 'stationNear', e.target.value)} />
                </div>
                <div className="field">
                  <label>Train Number</label>
                  <input placeholder="e.g. 12345"
                    value={formData.railwayDetails?.trainNumber || ''}
                    onChange={e => updateNested('railwayDetails', 'trainNumber', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Train Name</label>
                  <input placeholder="e.g. Rajdhani Express"
                    value={formData.railwayDetails?.trainName || ''}
                    onChange={e => updateNested('railwayDetails', 'trainName', e.target.value)} />
                </div>
                <div className="field">
                  <label>Coach Number</label>
                  <input placeholder="e.g. S4, B2, General"
                    value={formData.railwayDetails?.coachNumber || ''}
                    onChange={e => updateNested('railwayDetails', 'coachNumber', e.target.value)} />
                </div>
                <div className="field">
                  <label>Police Reported?</label>
                  <select value={formData.railwayDetails?.policeReported || ''}
                    onChange={e => updateNested('railwayDetails', 'policeReported', e.target.value)}>
                    <option value="">Select</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div className="field">
                  <label>FIR / MLC Number</label>
                  <input placeholder="FIR or MLC reference"
                    value={formData.railwayDetails?.firNumber || ''}
                    onChange={e => updateNested('railwayDetails', 'firNumber', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label>Witness Name</label>
                  <input placeholder="Full name of witness"
                    value={formData.railwayDetails?.witnessName || ''}
                    onChange={e => updateNested('railwayDetails', 'witnessName', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Witness Address</label>
                  <input placeholder="Complete address with landmark"
                    value={formData.railwayDetails?.witnessAddress || ''}
                    onChange={e => updateNested('railwayDetails', 'witnessAddress', e.target.value)} />
                </div>
                <div className="field span-3">
                  <label>Witness Statement</label>
                  <textarea rows={2} placeholder="Detailed statement from witness"
                    value={formData.railwayDetails?.witnessStatement || ''}
                    onChange={e => updateNested('railwayDetails', 'witnessStatement', e.target.value)} />
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field">
                  <label className="checkbox-row">
                    <input type="checkbox"
                      checked={formData.railwayDetails?.panchanama || false}
                      onChange={e => updateNested('railwayDetails', 'panchanama', e.target.checked)} />
                    <span>Panchanama Collected</span>
                  </label>
                </div>
                <div className="field">
                  <label className="checkbox-row">
                    <input type="checkbox"
                      checked={formData.railwayDetails?.spotPhotos || false}
                      onChange={e => updateNested('railwayDetails', 'spotPhotos', e.target.checked)} />
                    <span>Spot Visit Photos Collected</span>
                  </label>
                </div>
                <div className="field">
                  <label className="checkbox-row">
                    <input type="checkbox"
                      checked={formData.railwayDetails?.spotVideos || false}
                      onChange={e => updateNested('railwayDetails', 'spotVideos', e.target.checked)} />
                    <span>Spot Visit Videos Collected</span>
                  </label>
                </div>
              </div>

              <div className="form-grid cols-4">
                <div className="field span-4">
                  <label>Detailed Narration of Incident</label>
                  <textarea rows={3}
                    placeholder="Describe the railway accident sequence — how it happened, injuries sustained, who was present..."
                    value={formData.railwayDetails?.narration || ''}
                    onChange={e => updateNested('railwayDetails', 'narration', e.target.value)} />
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── Cashless conditional fields ── */}
        {formData.claimMode === 'cashless' && (
          <div>
            <div className="section-divider"><span>Cashless Details</span></div>
            <div className="form-grid cols-4">
              <div className="field">
                <label>Admission Type </label>
                <select value={formData.cashlessDetails?.admissionType || ''}
                  onChange={e => updateNested('cashlessDetails', 'admissionType', e.target.value)}>
                  <option value="">Select</option>
                  <option value="planned">Planned</option>
                  <option value="emergency">Emergency</option>
                </select>
                {showBanner('cashlessDetails.admissionType', formData.cashlessDetails?.admissionType) && (
                  <SuggestionBanner
                    value={extractedSuggestions['cashlessDetails.admissionType']}
                    onApply={(v) => { updateNested('cashlessDetails', 'admissionType', v); dismiss('cashlessDetails.admissionType') }}
                    onDismiss={() => dismiss('cashlessDetails.admissionType')}
                  />
                )}
              </div>
              
              <div className="field">
                <label>Estimated Cost (₹)</label>
                <input type="number"
                  value={formData.cashlessDetails?.estimatedCost || ''}
                  onChange={e => updateNested('cashlessDetails', 'estimatedCost', e.target.value)} />
              </div>
              <div className="field span-4">
                <label>Pre-Auth Details / Remarks</label>
                <textarea placeholder="Pre-authorization reference, approval notes..."
                  value={formData.cashlessDetails?.preAuthDetails || ''}
                  onChange={e => updateNested('cashlessDetails', 'preAuthDetails', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* ── Reimbursement conditional fields ── */}
        {formData.claimMode === 'reimbursement' && (
          <div>
            <div className="section-divider"><span>Reimbursement / Bank Details</span></div>
            <div className="form-grid cols-4">
              <div className="field span-2">
                <label>Account Holder Name </label>
                <input value={formData.reimbursementDetails?.accountName || ''}
                  placeholder="As per bank records"
                  onChange={e => updateNested('reimbursementDetails', 'accountName', e.target.value)} />
              </div>
              <div className="field">
                <label>Bank &amp; Account No. </label>
                <input value={formData.reimbursementDetails?.bankDetails || ''}
                  placeholder="Bank — XXXX XXXX XXXX"
                  onChange={e => updateNested('reimbursementDetails', 'bankDetails', e.target.value)} />
              </div>
              <div className="field">
                <label>IFSC Code </label>
                <input value={formData.reimbursementDetails?.ifsc || ''}
                  placeholder="e.g. HDFC0001234"
                  onChange={e => updateNested('reimbursementDetails', 'ifsc', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* ── Description ── */}
        <div className="form-grid cols-4">
          <div className="field span-4">
            <label>Case Description <span className="req">*</span></label>
            <textarea
              style={{ minHeight: 100 }}
              placeholder="Summarize the nature of the claim, circumstances, and any key observations relevant to investigation..."
              value={formData.description}
              onChange={e => handleChange('description', e.target.value)}
            />
          </div>
        </div>

      </div>
    </div>
  )
}