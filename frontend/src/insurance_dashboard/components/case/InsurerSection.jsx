import SuggestionBanner from '../case/SuggestionBanner'
import { useState } from 'react'
const TPA_OPTIONS = [
  'Medi Assist India TPA Pvt Ltd',
  'Vidal Health Insurance TPA Pvt Ltd',
  'MD India Health Insurance TPA Pvt Ltd',
  'Paramount Health Services & Insurance TPA Pvt Ltd',
  'Family Health Plan Insurance TPA Ltd',
  'Health India Insurance TPA Services Pvt Ltd',
  'Genins India Insurance TPA Ltd',
  'Safeway Insurance TPA Pvt Ltd',
  'Raksha Health Insurance TPA Pvt Ltd',
  'Vipul MedCorp Insurance TPA Pvt Ltd',
  'Dedicated Healthcare Services TPA (India) Pvt Ltd',
  'East West Assist Insurance TPA Pvt Ltd',
  'Good Health Insurance TPA Ltd',
  'Heritage Health Insurance TPA Pvt Ltd',
  'Anmol Medicare Insurance TPA Ltd',
  'Medsave Health Insurance TPA Ltd',
  'Ericson Insurance TPA Pvt Ltd',
  'United Healthcare Parekh Insurance TPA Pvt Ltd',
  'Park Mediclaim Insurance TPA Pvt Ltd',
  'Link K Insurance TPA Pvt Ltd',
  'Global Healthcare Services (MAA) TPA Pvt Ltd',
  'AKNA Health Insurance TPA Pvt Ltd',
  'Citizen Health Services TPA Pvt Ltd',
]

export default function InsurerSection({
  formData,
  setFormData,
  handleChange,
  sectionRefs,
  sectionProgress,
  SectionBadge,
  extractedSuggestions = {},
    unfilledFields = new Set()   // ← add this

}) {
  const [dismissed, setDismissed] = useState({})
  const dismiss = (key) => setDismissed(p => ({ ...p, [key]: true }))

  const showBanner = (key, currentVal) => {
    const extracted = extractedSuggestions[key]
    return extracted && !dismissed[key] && extracted !== currentVal
  }

  const updatePolicyDetail = (field, value) => {
    setFormData(prev => ({
      ...prev,
      policyDetails: {
        ...prev.policyDetails,
        [field]: value
      }
    }))
  }

  return (
    <div className="panel" ref={sectionRefs.insurer}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="dot" style={{ background: 'var(--accent)' }} />
          Insurer Details
        </div>
        <SectionBadge pct={sectionProgress('insurer')} color="var(--accent)" />
      </div>

      <div className="panel-body">
        <div className="form-grid cols-3">
          {/* TPA Name */}
<div className="field">
  <label>TPA Name</label>
  <select
    value={formData.tpaName || ''}
    onChange={e => handleChange('tpaName', e.target.value)}
  >
    <option value="">Select TPA (optional)</option>
    {TPA_OPTIONS.map(t => (
      <option key={t} value={t}>{t}</option>
    ))}
  </select>
  {showBanner('tpaName', formData.tpaName) && (
    <SuggestionBanner
      value={extractedSuggestions['tpaName']}
      onApply={(v) => { handleChange('tpaName', v); dismiss('tpaName') }}
      onDismiss={() => dismiss('tpaName')}
    />
  )}
</div>

          {/* Insurer Name */}
          <div className="field">
            <label>Company Name <span className="req">*</span></label>
            <select
              value={formData.insurer}
              onChange={e => handleChange('insurer', e.target.value)}
              style={{
    borderColor: unfilledFields.has('insurer') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('insurer') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
            >
              <option value="">Select insurer</option>
              <option>HDFC Ergo General Insurance</option>
              <option>Star Health &amp; Allied Insurance</option>
              <option>Volo Health Insurance</option>
              <option>New India Assurance</option>
              <option>National Insurance Co. Ltd.</option>
              <option>LIC of India</option>
              <option>ICICI Lombard General Insurance</option>
              <option>Future Generali Insurance</option>
              <option>Bajaj Allianz General Insurance</option>
              <option>DHFL General Insurance</option>
              <option>National Insurance Company</option>
              <option>Aditya Birla Health Insurance</option>
              <option>Oriental Insurance Company</option>
              <option>SBI General Insurance</option>
              <option>United India Insurance</option>
              <option>ManipalCigna Health Insurance</option>
              <option>Niva Bupa Health Insurance</option>
              <option>Care Health Insurance</option>
              <option>Cholamandalam MS General Insurance</option>
              <option>Magma HDI General Insurance</option>
              <option>Liberty General Insurance</option>
              <option>TATA AIG General Insurance</option>
              <option>Future Generali India Insurance</option>
              <option>Reliance General Insurance</option>
              <option>Universal Sompo General Insurance</option>
              <option>ACKO General Insurance</option>
              <option>Go Digit General Insurance</option>
              <option>IFFCO Tokio General Insurance</option>
              <option>Kotak Mahindra General Insurance</option>
              <option>Royal Sundaram General Insurance</option>
              <option>Navi General Insurance</option>
              <option>Edelweiss General Insurance</option>
              <option>Raheja QBE General Insurance</option>
              <option>Shriram General Insurance</option>
              <option>Bharti AXA General Insurance</option>
            </select>
{showBanner('insurer', formData.insurer) && (
  <SuggestionBanner
    value={extractedSuggestions['insurer']}
    onApply={() => dismiss('insurer')}
    onDismiss={() => dismiss('insurer')}
  />
)}
          </div>

          {/* Policy Number */}
          <div className="field">
            <label>Policy Number <span className="req">*</span></label>
            <input
              type="text"
              placeholder="e.g. POL-HE-2024-88821"
              value={formData.policyNumber}
              onChange={e => handleChange('policyNumber', e.target.value)}
              style={{
    borderColor: unfilledFields.has('policyNumber') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('policyNumber') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
            />
          </div>

          {/* Policy Start Date */}
          <div className="field">
            <label>Policy Start Date</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="DD/MM/YYYY"
              value={formData.policyDetails?.startDate || ''}
              onChange={e => updatePolicyDetail('startDate', e.target.value)}
            />
          </div>

          {/* Policy Inception Date */}
          <div className="field">
            <label>Policy Inception Date</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="DD/MM/YYYY"
              value={formData.policyDetails?.inceptionDate || ''}
              onChange={e => updatePolicyDetail('inceptionDate', e.target.value)}
            />
          </div>

          {/* Policy End Date */}
          <div className="field">
            <label>Policy End Date</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="DD/MM/YYYY"
              value={formData.policyDetails?.endDate || ''}
              onChange={e => updatePolicyDetail('endDate', e.target.value)}
            />
          </div>

          {/* Coverage Type */}
          <div className="field">
            <label>Coverage Type <span className="req">*</span></label>
            <input
              type="text"
              placeholder="e.g. health, accident, life"
              value={formData.policyDetails?.coverageType || ''}
              onChange={e => updatePolicyDetail('coverageType', e.target.value)}
              style={{
    borderColor: unfilledFields.has('policyDetails.coverageType') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('policyDetails.coverageType') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
            />
            {showBanner('policyDetails.coverageType', formData.policyDetails?.coverageType) && (
              <SuggestionBanner
                value={extractedSuggestions['policyDetails.coverageType']}
                onApply={(v) => updatePolicyDetail('coverageType', v)}
                onDismiss={() => dismiss('policyDetails.coverageType')}
              />
            )}
          </div>

          {/* Pre-existing Disease */}
          <div className="field">
            <label>Pre-existing Disease</label>
            <input
              type="text"
              placeholder="yes / no / unknown"
              value={formData.policyDetails?.preExistingDisease || ''}
              onChange={e => updatePolicyDetail('preExistingDisease', e.target.value)}
            />
            {showBanner('policyDetails.preExistingDisease', formData.policyDetails?.preExistingDisease) && (
              <SuggestionBanner
                value={extractedSuggestions['policyDetails.preExistingDisease']}
                onApply={(v) => updatePolicyDetail('preExistingDisease', v)}
                onDismiss={() => dismiss('policyDetails.preExistingDisease')}
              />
            )}
          </div>

          {/* Policy Type */}
          <div className="field">
            <label>Policy Type</label>
            <input
              type="text"
              placeholder="Individual, Corporate, Commercial..."
              value={formData.policyType || ''}
              onChange={e => handleChange('policyType', e.target.value)}
            />
            {showBanner('policyType', formData.policyType) && (
              <SuggestionBanner
                value={extractedSuggestions['policyType']}
                onApply={(v) => handleChange('policyType', v)}
                onDismiss={() => dismiss('policyType')}
              />
            )}
          </div>

          {/* Insurer Ref / Claim No. */}
          <div className="field">
            <label>Insurer Ref / Claim No. <span className="req">*</span></label>
            <input
              type="text"
              placeholder="Insurer's internal claim number"
              value={formData.insurerRef}
              onChange={e => handleChange('insurerRef', e.target.value)}
              style={{
    borderColor: unfilledFields.has('insurerRef') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('insurerRef') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
            />
          </div>

          {/* Contact Person */}
          <div className="field">
            <label>Insurer Contact Person</label>
            <input
              type="text"
              placeholder="Name of the handler"
              value={formData.insurerContact}
              onChange={e => handleChange('insurerContact', e.target.value)}
            />
          </div>

          {/* Contact Info */}
          <div className="field">
            <label>Contact Email / Phone</label>
            <input
              type="text"
              placeholder="email@insurer.com or 9xxxxxxxx"
              value={formData.insurerContactInfo}
              onChange={e => handleChange('insurerContactInfo', e.target.value)}
            />
          </div>

        </div>
      </div>

      <style>{`
        .field { margin-bottom: 8px; }
      `}</style>
    </div>
  )
}