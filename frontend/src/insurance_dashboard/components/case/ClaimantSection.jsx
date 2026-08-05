export default function ClaimantSection({
  formData,
  handleChange,
  fieldErrors,
  sectionRefs,
  sectionProgress,
  SectionBadge,
  extractedSuggestions = {},
  unfilledFields = new Set()   // ← add this
}) {
  // Generate initials avatar from name
  const initials = (formData.claimantName || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || '?'

  const relationshipColors = {
    Self: 'var(--accent)',
    Spouse: 'var(--purple)',
    Child: 'var(--teal)',
    Parent: 'var(--green)',
    'Legal Heir': 'var(--amber)',
    Nominee: 'var(--amber)',
    Other: 'var(--muted)',
  }

  const relColor = relationshipColors[formData.relationship] || 'var(--muted)'

  return (
    <div className="panel" ref={sectionRefs.claimant}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="dot" style={{ background: 'var(--purple)' }} />
          Claimant Details
        </div>
        <SectionBadge pct={sectionProgress('claimant')} color="var(--purple)" />
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Identity Card strip ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
        }}>
          {/* Avatar */}
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: `color-mix(in srgb, var(--purple) 15%, var(--bg3))`,
            border: '2px solid color-mix(in srgb, var(--purple) 30%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--purple)',
            flexShrink: 0,
            letterSpacing: 1,
          }}>
            {initials}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
              {formData.claimantName || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Name not entered</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {formData.claimantMobile && <span>📞 {formData.claimantMobile}</span>}
              {formData.city && <span>📍 {formData.city}{formData.pinCode ? ` — ${formData.pinCode}` : ''}</span>}
            </div>
          </div>

          {/* Relationship badge */}
          {formData.relationship && (
            <div style={{
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              background: `color-mix(in srgb, ${relColor} 12%, var(--bg3))`,
              color: relColor,
              border: `1px solid color-mix(in srgb, ${relColor} 30%, transparent)`,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              {formData.relationship}
            </div>
          )}
        </div>

        {/* ── Section: Personal Info ── */}
        <div className="section-divider"><span>Personal Info</span></div>

        <div className="form-grid cols-3">

          <div className="field">
            <label>Full Name <span className="req">*</span></label>
            <input
              type="text"
              placeholder="As on policy / Aadhaar"
              value={formData.claimantName}
              onChange={e => handleChange('claimantName', e.target.value)}
               style={{
    borderColor: unfilledFields.has('claimantName') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('claimantName') ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
            />
          </div>

          <div className="field">
            <label>Age</label>
            <input
              type="number"
              placeholder="e.g. 42"
              min={0}
              max={120}
              value={formData.claimantAge}
              onChange={e => handleChange('claimantAge', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Relationship to Insured</label>
            <select
              value={formData.relationship}
              onChange={e => handleChange('relationship', e.target.value)}
            >
              <option>Self</option>
              <option>Spouse</option>
              <option>Child</option>
              <option>Parent</option>
              <option>Legal Heir</option>
              <option>Nominee</option>
              <option>Other</option>
            </select>
          </div>

        </div>

        {/* ── Section: Contact ── */}
        <div className="section-divider"><span>Contact</span></div>

        <div className="form-grid cols-3">

          <div className="field">
            <label>Primary Mobile <span className="req">*</span></label>
            <input
  type="tel"
  placeholder="10-digit number"
  maxLength={10}
  value={formData.claimantMobile}
  onChange={e => handleChange('claimantMobile', e.target.value.replace(/\D/g, ''))}
  style={{
    borderColor: fieldErrors.claimantMobile
      ? 'var(--red)'
      : unfilledFields.has('claimantMobile') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('claimantMobile') && !fieldErrors.claimantMobile
      ? '0 0 0 3px rgb(239 68 68 / 15%)'
      : undefined,
  }}
/>
            {fieldErrors.claimantMobile && (
              <span style={{ color: 'var(--red)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚠ {fieldErrors.claimantMobile}
              </span>
            )}
          </div>

          <div className="field">
            <label>Alternate Contact</label>
            <input
              type="tel"
              placeholder="Optional"
              value={formData.altContact}
              onChange={e => handleChange('altContact', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Email Address</label>
            <input
              type="email"
              placeholder="claimant@email.com"
              value={formData.claimantEmail || ''}
              onChange={e => handleChange('claimantEmail', e.target.value)}
            />
          </div>

        </div>

        {/* ── Section: Identity Proof ── */}
        <div className="section-divider"><span>Identity Proof</span></div>

        <div className="form-grid cols-3">

          <div className="field">
            <label>ID Proof Type</label>
            <select
              value={formData.idProofType}
              onChange={e => handleChange('idProofType', e.target.value)}
            >
              <option value="aadhaar">Aadhaar Card</option>
              <option value="pan">PAN Card</option>
              <option value="passport">Passport</option>
              <option value="dl">Driving Licence</option>
              <option value="voter">Voter ID</option>
            </select>
          </div>

          <div className="field span-2">
            <label>ID Number</label>
            <input
              type="text"
              placeholder={
                formData.idProofType === 'aadhaar' ? 'XXXX XXXX XXXX' :
                formData.idProofType === 'pan' ? 'ABCDE1234F' :
                formData.idProofType === 'passport' ? 'A1234567' :
                'Enter ID number'
              }
              value={formData.idProofNumber}
              onChange={e => handleChange('idProofNumber', e.target.value)}
            />
          </div>

        </div>

        {/* ── Section: Address ── */}
        <div className="section-divider"><span>Address</span></div>

        <div className="form-grid cols-3">

          <div className="field span-3">
            <label>Residential Address</label>
            <textarea
              placeholder="House/Flat No., Street, Locality — used for field visit scheduling"
              value={formData.claimantAddress}
              onChange={e => handleChange('claimantAddress', e.target.value)}
            />
          </div>

          <div className="field">
            <label>City</label>
            <input
              type="text"
              placeholder="e.g. Bengaluru"
              value={formData.city}
              onChange={e => handleChange('city', e.target.value)}
            />
          </div>

          <div className="field">
            <label>District</label>
            <input
              type="text"
              placeholder="e.g. Bengaluru Urban"
              value={formData.district}
              onChange={e => handleChange('district', e.target.value)}
            />
          </div>

          <div className="field">
            <label>PIN Code <span className="req">*</span></label>
            <input
              type="text"
              placeholder="6-digit PIN"
              maxLength={6}
              value={formData.pinCode}
              onChange={e => handleChange('pinCode', e.target.value.replace(/\D/g, ''))}
               style={{
    borderColor: fieldErrors.pinCode ? 'var(--red)' : unfilledFields.has('pinCode') ? '#ef4444' : undefined,
    boxShadow: unfilledFields.has('pinCode') && !fieldErrors.pinCode ? '0 0 0 3px rgb(239 68 68 / 15%)' : undefined,
  }}
            />
            {fieldErrors.pinCode && (
              <span style={{ color: 'var(--red)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚠ {fieldErrors.pinCode}
              </span>
            )}
          </div>

        </div>

      </div>
    </div>
  )
}