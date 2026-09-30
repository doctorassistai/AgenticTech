// components/case/FormTabs.jsx
import { useState } from 'react'
import InsurerSection from './InsurerSection'
import ClaimantSection from './ClaimantSection'
import ClaimSection from './ClaimSection'

// Single source of truth for what counts as "required" per section.
// Keep this in sync with REQUIRED in pages/NewCase.jsx.
export const REQUIRED_KEYS = {
  insurer:  ['insurer', 'policyNumber', 'insurerRef', 'policyDetails.coverageType'],
  claimant: ['claimantName', 'claimantMobile', 'pinCode'],
  claim:    ['claimMode', 'claimSubtype', 'claimTriggers'],
}

export default function FormTabs({
  formData,
  setFormData,
  handleChange,
  fieldErrors,
  sectionRefs,
  sectionProgress,
  SectionBadge,
  riskLabel,
  setAutoPriority,
  extractedSuggestions,
  unfilledFields,
}) {
  const [tab, setTab] = useState('required')

  const shared = {
    formData,
    setFormData,
    handleChange,
    sectionRefs,
    sectionProgress,
    SectionBadge,
    extractedSuggestions,
    unfilledFields,
    bare: true,
  }

  return (
    <div className="panel" ref={sectionRefs.formTabs}>
      <div className="panel-header" style={{ paddingBottom: 0, borderBottom: 'none' }}>
        <div className="nc-tab-row">
          <button
            type="button"
            className={`nc-tab-btn ${tab === 'required' ? 'active' : ''}`}
            onClick={() => setTab('required')}
          >
            Required Fields
          </button>
          <button
            type="button"
            className={`nc-tab-btn ${tab === 'additional' ? 'active' : ''}`}
            onClick={() => setTab('additional')}
          >
            Additional Details
          </button>
        </div>
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <InsurerSection
          {...shared}
          mode={tab}
          requiredKeys={REQUIRED_KEYS.insurer}
        />
        <ClaimantSection
          {...shared}
          fieldErrors={fieldErrors}
          mode={tab}
          requiredKeys={REQUIRED_KEYS.claimant}
        />
        <ClaimSection
          {...shared}
          riskLabel={riskLabel}
          setAutoPriority={setAutoPriority}
          mode={tab}
          requiredKeys={REQUIRED_KEYS.claim}
        />
      </div>

      <style>{`
        .nc-tab-row { display: flex; gap: 8px; }
        .nc-tab-btn {
          padding: 8px 16px;
          border: 1px solid var(--border);
          border-bottom: none;
          border-radius: 8px 8px 0 0;
          background: var(--bg2);
          color: var(--muted);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .nc-tab-btn.active {
          background: var(--bg1);
          color: var(--accent);
          border-color: var(--accent);
        }
      `}</style>
    </div>
  )
}