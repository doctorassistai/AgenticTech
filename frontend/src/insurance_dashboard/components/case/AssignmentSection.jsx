// components/case/AssignmentSection.jsx
import React, { useState, useEffect, useRef } from 'react'
import AvailableOfficerDropdown from "./AvailableOfficerDropdown"

// ─── Investigation types ───────────────────────────────────────────────────────
// DB keys are unchanged for MV / HVI / HV.
// TELE is renamed to DIGI in DB and everywhere.
// BILL is removed as a standalone type — its docs are merged into MV and HVI.
// TRIGGER is removed as a standalone type — its docs are merged into HVI.

const INVESTIGATION_TYPES = [
  { key: "MV",   label: "Member Visit"        },
  { key: "HVI",  label: "Hospital Visit"       },
  { key: "HV",   label: "Past Hospital Visit"  },
  { key: "DIGI", label: "Digi Verification"    },
]

const DOCUMENT_OPTIONS = {

  // ─── Member Visit (at claimant's home) ───────────────────────────────────
  // Only docs a patient would physically possess at home
  MV: [
    // Identity & policy
    "Patient ID Proof",
    "ID Proof of person filling MVF (if different)",
    "Policy card / Health card",
    "Policy-related documents",
    "Declaration form",
    "Forms and declarations",

    // Discharge & consultation papers patient took home
    "Discharge summary",
    "Previous consultation papers before admission",
    "First consultation papers (FCP)",
    "ICP (Initial Consultation Paper)",
    "Past OP papers",
    "Past IP papers",

    // Investigation reports patient brought home
    "Blood reports",
    "X-ray reports",
    "MRI reports",
    "Other investigation reports",

    // Physical evidence
    "Surgery scar mark photos",
    "House geotagged photos",
    "Patient photos",
    "Google Timeline",

    // Bills patient received
    "Bill copy",
    "Pharmacy bills",
    "All bills",
    "Bills from transferred hospitals",
    "Bills from patient",
    "Discharge bill",
    "Lab bill",

    // Consent / declarations
    "Consent for collection of previous records from hospital (if documents unavailable)",

    // Bill verification (done at home visit)
    "Wound certificate",
    "RTA verification",
    "Cashless claim details",
    "Bill genuineness verification",
    "Discount verification",
    "Non-medical expenses verification",
  ],

  // ─── Member Visit — Accident sub-type ────────────────────────────────────
  MV_ACCIDENT: [
    "Driving License",
    "MLC Copy",
    "Police MLC",
    "FIR",
    "Police intimation letter",
    "Wound certificate",
    "Panchanama",
    "Vehicle photos",
    "Damaged vehicle photos",
    "Spot photos",
    "Spot videos",
    "Newspaper cuttings",
    "Social media coverage",
    "Narratives/audio from accident spot persons",
    "First aid hospital prescriptions",
    "First consultation papers (FCP)",
    "Treating doctor certificate to rule out alcohol history",
    "Witness statements",
    "Bystander ID proof",
    "All bills",
    "Consent for unavailable first-aid prescriptions",
  ],

  // ─── Member Visit — Death sub-type ───────────────────────────────────────
  MV_DEATH: [
    "Death summary",
    "Reason for death certificate",
    "Time of death record",
    "Site / spot of death",
    "Detailed narration of incident",
    "Postmortem report",
    "Chemical analysis report",
    "FIR",
    "Witness name and address",
    "Details of person who brought patient to hospital",
    "Psychiatric history",
    "SDF filled by insured / primary beneficiary",
    "Legal heir certificate",
    "Ration card",
  ],

  // ─── Member Visit — Railway Accident sub-type ─────────────────────────────
  MV_RAILWAY: [
    "Panchanama",
    "Witness statement",
    "Spot visit photos",
    "Spot visit videos",
  ],

  // ─── Member Visit — Critical Illness sub-type ─────────────────────────────
  MV_CRITICAL_ILLNESS: [
    "Specialist diagnosis certificate",
    "Histopathology / biopsy report (if applicable)",
    "Oncologist / cardiologist / neurologist report",
    "ICU admission summary and records",
    "All treatment records for the critical condition",
  ],

  // ─── Hospital Visit (investigator physically goes to hospital) ───────────
  // All clinical records that only exist inside the hospital
  HVI: [
    // Admission & identity at hospital
    "OP Card",
    "Hospital visit form",
    "Signed investigation consent form",
    "Claimant ID proof",
    "Policy document copy",

    // Consultation & admission records
    "First consultation papers",
    "ICP (Initial Consultation Paper)",
    "IP papers",
    "Emergency notes",
    "Casualty notes",
    "Doctor statement",

    // Clinical charts (only in hospital) ← MOVED FROM MV
    "Initial assessment chart",
    "Treatment chart",
    "BP chart",
    "Diabetic chart",
    "Temperature chart",
    "Nurses' records",

    // Surgery & anaesthesia records (only in hospital) ← MOVED FROM MV
    "Pre-anesthetic checklist",
    "Anesthesia chart",
    "Surgery notes",
    "Post-operative notes",

    // Investigation reports (hospital copies)
    "Blood reports",
    "X-ray",
    "MRI",
    "Other investigation reports",

    // Referral & transfer
    "Reference notes",
    "Discharge summary from transferred hospital",
    "Bills from both hospitals",

    // Past records retrieved from hospital
    "Past OP papers",
    "Past IP papers",
    "Treatment records",
    "Hospital records",

    // Bills collected at hospital
    "Pharmacy bills",
    "Every bill",
    "Discharge bill",
    "Lab bill",

    // MLC / legal (at hospital)
    "MLC",
    "Police MLC",
    "FIR",
    "Wound certificate",
    "Treating doctor certificate regarding alcohol history",
    "Death summary",
    "Postmortem report",
    "Chemical analysis report",

    // Physical
    "Hospital geotag photo",

    // Bill verification (done at hospital)
    "Seal verification",
    "RTA verification",
    "Cashless claim details",
    "Bill genuineness verification",
    "Discount verification",
    "Non-medical expenses verification",
  ],

  // ─── Past Hospital Visit (verifying a previous admission) ────────────────
  // Field officer interviews people, verifies history — no clinical charts
  HV: [
    // Witness & residence
    "Neighbour statement",
    "Residence proof",
    "Family interview",
    "Patient / family statement",
    "Witness details",
    "Witness statement",
    "Witness contact",
    "Witness statements",
    "Person who brought patient statement",

    // Treatment history to verify
    "First consultation details",
    "Doctor details",
    "Admission details",
    "Treatment details",
    "Discharge details",
    "Pre-existing disease details",
    "Medication history",
    "Other treatment history",

    // Bill & payment verification
    "Bill payment details",
    "Bill amount",

    // Accident-specific history
    "Accident narration",
    "Time and place of accident",
    "Purpose of travel",
    "Driver details",
    "Safety measures",
    "Person who brought patient",
    "Vehicle damage details",
    "Death narration",

    // Admin
    "Missing document declaration",
  ],

  // ─── Digi Verification ───────────────────────────────────────────────────
  DIGI: [
    "Call recording",
    "Telephonic statement",
  ],
}

// REPLACE getDocsForType entirely

function getDocsForType(type, claimMode = '', claimTriggers = []) {
  if (type === 'MV') {
    let docs = [...DOCUMENT_OPTIONS.MV]

    if (claimMode === 'personal_accident')  docs = [...docs, ...DOCUMENT_OPTIONS.MV_ACCIDENT]
    if (claimMode === 'death')              docs = [...docs, ...DOCUMENT_OPTIONS.MV_DEATH]
    if (claimMode === 'railway_accident')   docs = [...docs, ...DOCUMENT_OPTIONS.MV_ACCIDENT, ...DOCUMENT_OPTIONS.MV_RAILWAY]
    if (claimMode === 'critical_illness')   docs = [...docs, ...DOCUMENT_OPTIONS.MV_CRITICAL_ILLNESS]

    return [...new Set(docs)]
  }

  if (type === 'HVI') {
    const base     = [...DOCUMENT_OPTIONS.HVI]
    const specific = claimTriggers.flatMap(t => DOCUMENT_OPTIONS[`TRIGGER_${t}`] || [])
    return [...new Set([...base, ...specific])]
  }

  return DOCUMENT_OPTIONS[type] || []
}


function OfficerDropdown({ investigators = [], value, onChange, disabled, pincode, invType }) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const wrapRef               = useRef(null)
  const inputRef              = useRef(null)

  const needsPin = ['HVI', 'HV', 'MV', 'DIGI'].includes(key)
const pinOk    = !needsPin || (getPincodeForType(key).length === 6)

  // Filter investigators by pincode serviceability when needed
  const filtered = investigators.filter(inv => {
    if (!pinOk) return true   // show all when no pin (user sees the warning anyway)
    const name = (inv.name || inv.investigatorName || '').toLowerCase()
    const q    = search.toLowerCase()
    if (q && !name.includes(q)) return false
    // pincode match: if investigator has servicePincodes array, filter; else show all
    if (needsPin && pincode && inv.servicePincodes?.length) {
      return inv.servicePincodes.includes(pincode)
    }
    return true
  }).filter(inv => {
    if (!search) return true
    const name = (inv.name || inv.investigatorName || '').toLowerCase()
    return name.includes(search.toLowerCase())
  })

  const selected = investigators.find(
    inv => (inv.id || inv._id || inv.sys_user_id) === value
  )
  const selectedLabel = selected
    ? (selected.name || selected.investigatorName || selected.full_name || value)
    : ''

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Focus search when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
    else setSearch('')
  }, [open])

  const handleSelect = (inv) => {
    onChange({
      id:   inv.id || inv._id || inv.sys_user_id || '',
      name: inv.name || inv.investigatorName || inv.full_name || '',
    })
    setOpen(false)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange({ id: '', name: '' })
  }

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: '100%' }}
    >
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--bg1, #fff)',
          border: `1.5px solid ${open ? 'var(--accent, #4f6ef7)' : 'var(--border, #d1d5db)'}`,
          borderRadius: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
          color: selectedLabel ? 'var(--text, #111)' : 'var(--muted, #9ca3af)',
          textAlign: 'left',
          outline: 'none',
          transition: 'border-color 0.15s',
          minHeight: 38,
        }}
      >
        <span style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: selectedLabel ? 'var(--text, #111827)' : 'var(--muted, #9ca3af)',
        }}>
          {selectedLabel || 'Select investigator'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {selectedLabel && (
            <span
              onClick={handleClear}
              style={{
                fontSize: 16,
                lineHeight: 1,
                color: 'var(--muted, #9ca3af)',
                cursor: 'pointer',
                padding: '0 2px',
              }}
              title="Clear"
            >
              ×
            </span>
          )}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
              color: 'var(--muted, #9ca3af)',
              flexShrink: 0,
            }}
          >
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {/* Dropdown panel — fixed position to escape overflow:hidden parents */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'var(--bg1, #fff)',
            border: '1.5px solid var(--accent, #4f6ef7)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            overflow: 'hidden',
            minWidth: 220,
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search investigator..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 12,
                border: '1px solid var(--border, #d1d5db)',
                borderRadius: 6,
                background: 'var(--bg2, #f9fafb)',
                color: 'var(--text, #111827)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Options */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{
                padding: '12px 14px',
                fontSize: 12,
                color: 'var(--muted, #9ca3af)',
                textAlign: 'center',
              }}>
                {needsPin && !pinOk
                  ? 'Enter a 6-digit pincode to find officers'
                  : 'No investigators found'}
              </div>
            ) : (
              filtered.map((inv, i) => {
                const id    = inv.id || inv._id || inv.sys_user_id || i
                const name  = inv.name || inv.investigatorName || inv.full_name || `Officer ${i + 1}`
                const isSelected = id === value
                const online = inv.online ?? inv.isOnline ?? inv.available ?? null

                return (
                  <div
                    key={id}
                    onClick={() => handleSelect(inv)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 14px',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: isSelected ? 600 : 400,
                      color: 'var(--text, #111827)',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--accent, #4f6ef7) 10%, transparent)'
                        : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => {
                      if (!isSelected)
                        e.currentTarget.style.background = 'var(--bg2, #f3f4f6)'
                    }}
                    onMouseLeave={e => {
                      if (!isSelected)
                        e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {/* Status dot — only show if online status is known */}
                    {online !== null && (
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: online
                          ? 'var(--green, #22c55e)'
                          : 'var(--muted, #d1d5db)',
                      }} />
                    )}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    {isSelected && (
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
                        style={{ flexShrink: 0, color: 'var(--accent, #4f6ef7)' }}>
                        <path d="M2 6.5l3.5 3.5 6-6" stroke="currentColor"
                          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Collapsible doc list with custom-doc addition ────────────────────────────
function DocList({ type, claimMode, claimTriggers, customDocs, onAddCustom, onRemoveCustom })
 {
  const [open, setOpen]         = useState(false)
  const [inputVal, setInputVal] = useState('')
  const inputRef                = useRef(null)

  const standardDocs = getDocsForType(type, claimMode, claimTriggers)
  const allDocs      = [...standardDocs, ...(customDocs || [])]

  const handleAdd = () => {
    const trimmed = inputVal.trim()
    if (!trimmed) return
    if (allDocs.includes(trimmed)) { setInputVal(''); return }
    onAddCustom(trimmed)
    setInputVal('')
    inputRef.current?.focus()
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      background: 'var(--bg1)',
    }}>
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--bg2)',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700,
            background: 'var(--accent)22', color: 'var(--accent)',
            borderRadius: 20, padding: '2px 8px',
          }}>
            {allDocs.length} docs
          </span>
          Documents to Collect
        </span>
        <svg
          width="13" height="13" viewBox="0 0 12 12" fill="none"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            color: 'var(--muted)',
          }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Standard doc list */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '5px 10px',
            maxHeight: 280,
            overflowY: 'auto',
            padding: '4px 0',
          }}>
            {standardDocs.map((doc, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 7,
                fontSize: 12, color: 'var(--text)', lineHeight: 1.4,
                padding: '3px 0',
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 2,
                  width: 14, height: 14, borderRadius: 3,
                  border: '1.5px solid var(--accent)',
                  background: 'var(--accent)18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'var(--accent)', fontWeight: 700,
                }}>✓</span>
                {doc}
              </div>
            ))}

            {/* Custom docs */}
            {(customDocs || []).map((doc, i) => (
              <div key={`custom-${i}`} style={{
                display: 'flex', alignItems: 'flex-start', gap: 7,
                fontSize: 12, color: 'var(--amber, #f59e0b)', lineHeight: 1.4,
                padding: '3px 0',
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 2,
                  width: 14, height: 14, borderRadius: 3,
                  border: '1.5px solid var(--amber, #f59e0b)',
                  background: 'var(--amber, #f59e0b)18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'var(--amber, #f59e0b)', fontWeight: 700,
                }}>+</span>
                <span style={{ flex: 1 }}>{doc}</span>
                <button
                  type="button"
                  onClick={() => onRemoveCustom(i)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--muted)', fontSize: 14, lineHeight: 1,
                    padding: '0 2px', flexShrink: 0,
                  }}
                  title="Remove custom document"
                >×</button>
              </div>
            ))}
          </div>

          {/* Add custom document */}
          <div style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 10,
            display: 'flex', gap: 8,
          }}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Add a document not on the list..."
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
              style={{
                flex: 1, fontSize: 12,
                padding: '6px 10px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!inputVal.trim()}
              style={{
                padding: '6px 14px',
                background: inputVal.trim() ? 'var(--accent)' : 'var(--bg3)',
                color: inputVal.trim() ? '#fff' : 'var(--muted)',
                border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600,
                cursor: inputVal.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              + Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AssignmentSection({
  formData,
  setFormData,
  sectionRefs,
  sectionProgress,
  SectionBadge,
  INVESTIGATORS,
  loadingInvestigators,
  setAutoTargetDate,
  BASE_URL,
    unfilledFields = new Set()   // ← add this

}) {
  const [activeTab, setActiveTab]           = useState(null)
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [doctorsList, setDoctorsList]       = useState([])
  const [loadingDoctors, setLoadingDoctors] = useState(false)

  const claimTriggers = formData.claimTriggers || []

  // ── Read pincodes from upstream form sections (not collected here) ─────────
  // HVI (Hospital Visit) uses hospital pincode entered in the hospital/claim section
  // MV  (Member Visit)   uses claimant pincode entered in the claimant section
  const hospitalPincode  = formData.hospitalDetails?.pincode
                        || formData.hospitalPincode
                        || ''
  const claimantPincode  = formData.pinCode
                        || formData.claimantPincode
                        || ''
  const pastHospitalPincode = formData.pastHospitalPincode || ''   // ← add this
  const digiPincode         = formData.digiPincode   
function getPincodeForType(invType) {
  if (invType === 'HVI') return hospitalPincode
  if (invType === 'MV')  return claimantPincode
  if (invType === 'HV')  return formData.pastHospitalPincode || ''
  if (invType === 'DIGI') return formData.digiPincode || ''
  return ''
}

  useEffect(() => {
    if (activeTab !== 'doctor') return
    setLoadingDoctors(true)
    fetch(`${BASE_URL.replace(/\/$/, '')}/insurance/web/doctors`, {
      headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' },
    })
      .then(r => r.json())
      .then(data => setDoctorsList(data.doctors || []))
      .catch(() => setDoctorsList([]))
      .finally(() => setLoadingDoctors(false))
  }, [activeTab, BASE_URL])

  const handleChange = (field, value) =>
    setFormData(prev => ({ ...prev, [field]: value }))

  // Get/set the single officer for a type
  const getOfficer = (type) => {
    const arr = formData.investigations?.[type] || []
    return arr[0] || { investigatorId: '', investigatorName: '', customDocs: [], note: '' }
  }

const setOfficer = (type, patch) => {
  setFormData(prev => {
    const existing = (prev.investigations?.[type] || [])[0] || {
      investigatorId: '', investigatorName: '', customDocs: [], note: '', documents: [],
    }
    // Always recompute the full doc list when anything changes
    const updatedEntry = { ...existing, ...patch }
    const claimMode = prev.claimMode || ''
const standardDocs = getDocsForType(type, claimMode, claimTriggers)
    const allDocs = [...standardDocs, ...(updatedEntry.customDocs || [])]
    return {
      ...prev,
      investigations: {
        ...prev.investigations,
        [type]: [{ ...updatedEntry, documents: allDocs }],
      },
    }
  })
}

// FIND:
const addCustomDoc = (type, doc) => {
  const officer    = getOfficer(type)
  const customDocs = [...(officer.customDocs || []), doc]
  setOfficer(type, { customDocs })
}

const removeCustomDoc = (type, idx) => {
  const officer    = getOfficer(type)
  const customDocs = (officer.customDocs || []).filter((_, i) => i !== idx)
  setOfficer(type, { customDocs })
}

  const handleTabSwitch = (tab) =>
    setActiveTab(prev => prev === tab ? null : tab)

  const tabStyle = (tab) => ({
    flex: 1,
    padding: '10px 16px',
    border: '1.5px solid',
    borderRadius: 10,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    transition: 'all 0.18s',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderColor:  activeTab === tab ? 'var(--accent)' : 'var(--border)',
    background:   activeTab === tab
      ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
      : 'var(--bg1)',
    color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
  })

  return (
    <div className="panel" ref={sectionRefs.assignment}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="dot" style={{ background: 'var(--green)' }} />
          Assignment
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 4 }}>
            (optional)
          </span>
        </div>
        <SectionBadge pct={sectionProgress('assignment')} color="var(--green)" />
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Tab toggle ── */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            style={tabStyle('field-officer')}
            onClick={() => handleTabSwitch('field-officer')}
          >
            <span style={{ fontSize: 16 }}>🕵️</span>
            Field Officer
            {activeTab === 'field-officer' && (
              <span style={{
                marginLeft: 4, fontSize: 10,
                background: 'var(--accent)', color: '#fff',
                borderRadius: 20, padding: '1px 7px',
              }}>Active</span>
            )}
          </button>
          <button
            type="button"
            style={tabStyle('doctor')}
            onClick={() => handleTabSwitch('doctor')}
          >
            <span style={{ fontSize: 16 }}>👨‍⚕️</span>
            Auditing Doctor
            {activeTab === 'doctor' && (
              <span style={{
                marginLeft: 4, fontSize: 10,
                background: 'var(--accent)', color: '#fff',
                borderRadius: 20, padding: '1px 7px',
              }}>Active</span>
            )}
          </button>
        </div>

        {/* ── Field Officer Panel ── */}
        {activeTab === 'field-officer' && (
          <div style={{
            padding: 16,
            background: 'var(--bg2)',
            borderRadius: 12,
            border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              📋 Investigation Assignments
            </h4>

            {INVESTIGATION_TYPES.map(({ key, label }) => {
              const pincode    = getPincodeForType(key)
              const needsPin   = key === 'HVI' || key === 'MV'
              const pinOk      = !needsPin || pincode.length === 6
              const officer    = getOfficer(key)
              const hasOfficer = !!officer.investigatorId

              return (
                <div
                  key={key}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    overflow: 'visible',   // allow dropdown to escape
                    background: 'var(--bg1)',
                  }}
                >
                  {/* Section header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg2)',
                    borderBottom: '1px solid var(--border)',
                    borderRadius: '10px 10px 0 0',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', flex: 1 }}>
                      {label}
                    </span>
{needsPin && !pinOk && (
  <div style={{
    fontSize: 11, color: 'var(--amber,#f59e0b)',
    background: 'rgba(245,158,11,0.06)',
    border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: 6, padding: '7px 12px',
  }}>
    ⚠ Enter the{' '}
    {key === 'MV'   ? 'claimant pincode in the Claimant section'
    : key === 'HVI' ? 'hospital pincode in the Hospital Details section'
    : key === 'HV'  ? 'past hospital pincode in the Claim Details section'
    : key === 'DIGI'? 'digi verification pincode in the Claim Details section'
    : 'pincode'}{' '}
    to enable smart officer matching for {label}
  </div>
)}
                    {hasOfficer && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        background: 'var(--green)22', color: 'var(--green)',
                        borderRadius: 10, padding: '2px 8px',
                        border: '1px solid var(--green)44',
                      }}>
                        ✓ Assigned
                      </span>
                    )}
                  </div>

                  <div style={{
                    padding: 14,
                    display: 'flex', flexDirection: 'column', gap: 12,
                    overflow: 'visible',
                  }}>

                    {/* Pincode warning — shown only when pincode is missing from upstream */}
                    {needsPin && !pinOk && (
                      <div style={{
                        fontSize: 11, color: 'var(--amber,#f59e0b)',
                        background: 'rgba(245,158,11,0.06)',
                        border: '1px solid rgba(245,158,11,0.2)',
                        borderRadius: 6, padding: '7px 12px',
                      }}>
                        ⚠ Enter the{' '}
                        {key === 'MV' ? 'claimant pincode in the Claimant section' : 'hospital pincode in the Hospital Details section'}{' '}
                        to enable smart officer matching for {label}
                      </div>
                    )}

                    {/* Officer + instructions row */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div className="field" style={{ flex: '0 0 280px', minWidth: 0, overflow: 'visible' }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
                          Assign Field Officer
                          {needsPin && pinOk && (
                            <span style={{
                              marginLeft: 6, fontSize: 9, fontWeight: 600,
                              background: 'var(--accent)22', color: 'var(--accent)',
                              borderRadius: 4, padding: '1px 5px',
                            }}>
                              PINCODE MATCHED
                            </span>
                          )}
                        </label>
                        <AvailableOfficerDropdown
  investigators={INVESTIGATORS || []}
  value={officer.investigatorId || ''}
  onChange={({ id, name }) =>
    setOfficer(key, { investigatorId: id, investigatorName: name })
  }
  disabled={loadingInvestigators}
  loading={loadingInvestigators}
  pincode={getPincodeForType(key)}
  invType={key}
/>
                      </div>

                      <div className="field" style={{ flex: 1, minWidth: 180 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
                          Special Instructions
                        </label>
                        <input
                          type="text"
                          placeholder="Add specific instructions for this officer..."
                          value={officer.note || ''}
                          onChange={e => setOfficer(key, { note: e.target.value })}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>

                    {/* Document list */}
                    <DocList
                      type={key}
                      claimMode={formData.claimMode || ''}
                      claimTriggers={claimTriggers}
                      customDocs={officer.customDocs || []}
                      onAddCustom={(doc) => addCustomDoc(key, doc)}
                      onRemoveCustom={(idx) => removeCustomDoc(key, idx)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Doctor Panel ── */}
        {activeTab === 'doctor' && (
          <div style={{
            padding: 16,
            background: 'var(--bg2)',
            borderRadius: 12,
            border: '1px solid var(--border)',
          }}>
            <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              👨‍⚕️ Assign Auditing Doctor
            </h4>
            <div className="field" style={{ marginBottom: 20 }}>
              <label>Select Doctor</label>
              {loadingDoctors ? (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>
                  Loading doctors...
                </div>
              ) : (
                <select
                  value={selectedDoctor}
                  onChange={(e) => {
                    const sysUserId = e.target.value
                    setSelectedDoctor(sysUserId)
                    handleChange('doctor_assigned', sysUserId || null)
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="">Select a doctor...</option>
                  {doctorsList.map((doc) => (
                    <option key={doc.sys_user_id} value={doc.sys_user_id}>
                      {doc.full_name}{doc.email && doc.email !== 'NA' ? ` — ${doc.email}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {selectedDoctor && (
              <div style={{
                padding: 12, borderRadius: 8,
                background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                fontSize: 13,
              }}>
                ✅ Auditing doctor assigned successfully.
              </div>
            )}
          </div>
        )}

        {/* ── Target date + Notes ── */}
        <div className="form-grid cols-4">
          <div className="field">
  <label>Target Completion Date & Time</label>
  <input
    type="text"
    inputMode="numeric"
    placeholder="DD/MM/YYYY HH:MM"
    value={formData.targetDate || ''}
    onChange={(e) => {
      setAutoTargetDate(false)
      handleChange('targetDate', e.target.value)
    }}
    style={{
    borderColor: unfilledFields.has('targetDate') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('targetDate') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
  />
  <small style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
    Cashless: 6 hrs · All others: 3 days. Edit to override.
  </small>
</div>
          <div className="field span-3">
            <label>Assignment Notes</label>
            <textarea
              rows={3}
              placeholder="General instructions for all investigators on this case..."
              value={formData.assignmentNotes || ''}
              onChange={e => handleChange('assignmentNotes', e.target.value)}
            />
          </div>
        </div>

      </div>
    </div>
  )
}