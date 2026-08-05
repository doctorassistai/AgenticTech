import { useState, useEffect } from 'react'

const priorityColor = { Normal: 'gray', High: 'amber', Critical: 'red', Urgent: 'red' }
const statusColor = {
  IN_PROGRESS: 'blue',
  EVIDENCE_COLLECTION: 'amber',
  UNDER_REVIEW: 'purple',
  QC_PENDING: 'teal',
  COMPLETED: 'green',
  ALLOCATED: 'gray',
}
const tatColor = (t) => t >= 90 ? 'var(--green)' : t >= 75 ? 'var(--amber)' : 'var(--red)'

// ─── Availability helpers ─────────────────────────────────────────────────────
function isOfficerAvailable(availRec) {
  if (!availRec) return null
  if (availRec.status === 'Unavailable') return false
  const now = new Date().toTimeString().slice(0, 5)
  return availRec.availableFrom <= now && now <= availRec.availableTo
}

function AvailabilityBadge({ availRec, size = 'md' }) {
  const fs  = size === 'sm' ? 9  : 10
  const pad = size === 'sm' ? '2px 5px' : '2px 7px'

  if (!availRec) return (
    <span style={{
      fontSize: fs, padding: pad, borderRadius: 4, fontWeight: 600,
      background: 'rgba(107,114,128,.1)', color: 'var(--muted)',
      border: '1px solid rgba(107,114,128,.2)', whiteSpace: 'nowrap',
    }}>
      No check-in
    </span>
  )

  const avail = isOfficerAvailable(availRec)
  const label = avail ? '● Available' : availRec.status === 'Unavailable' ? '○ Unavailable' : '⏱ Off hours'
  const bg    = avail ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.10)'
  const color = avail ? 'var(--green)' : 'var(--red)'
  const border = avail ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.2)'

  return (
    <span style={{
      fontSize: fs, padding: pad, borderRadius: 4, fontWeight: 600,
      background: bg, color, border: `1px solid ${border}`, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// ─── Unapproved assignment detector ──────────────────────────────────────────
function getUnapprovedAssignments(caseItem) {
  const results = []
  const now = Date.now()
  const TWO_HOURS = 2 * 60 * 60 * 1000
  const investigations = caseItem.investigations || {}

  for (const [inv_type, invList] of Object.entries(investigations)) {
    if (!Array.isArray(invList)) continue
    const hasAccepted = invList.some(e => e?.assignmentResponse === 'accepted')
    if (hasAccepted) continue

    for (const entry of invList) {
      if (!entry?.investigatorId) continue
      const response    = entry.assignmentResponse
      const allocatedAt = entry.reassignedAt || entry.assignedAt || caseItem.createdAt
      const ageMs       = allocatedAt ? now - new Date(allocatedAt).getTime() : 0

      if (response === 'declined' || (response == null && ageMs > TWO_HOURS)) {
        results.push({ inv_type, entry, reason: response === 'declined' ? 'declined' : 'no_response' })
      }
    }
  }
  return results
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TaskAllocation() {
  const [selectedInv, setSelectedInv]   = useState(null)
  const [selectedCase, setSelectedCase] = useState(null)
  const [locationFilter, setLocationFilter] = useState('All Locations')
  const [typeFilter, setTypeFilter]     = useState('All Types')
  const [statusFilter, setStatusFilter] = useState('All Statuses')

  const [investigators, setInvestigators]     = useState([])
  const [cases, setCases]                     = useState([])
  const [availabilityMap, setAvailabilityMap] = useState({})  // { userId: availRec }
  const [loading, setLoading]                 = useState(true)

  // Reassign modal state
  const [reassignModal, setReassignModal]           = useState(null)
  const [availableOfficers, setAvailableOfficers]   = useState([])
  const [loadingOfficers, setLoadingOfficers]       = useState(false)
  const [reassigning, setReassigning]               = useState(false)
  const [selectedNewOfficer, setSelectedNewOfficer] = useState(null)
  const [officerSearch, setOfficerSearch]           = useState('')

  const BASE_URL = import.meta.env.VITE_BACKEND_URL

  // ── Initial data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [officersRes, casesRes, availRes] = await Promise.all([
          fetch(`${BASE_URL}/insurance/api/hms/users/field-officers`),
          fetch(`${BASE_URL}/insurance/web/cases`),
          // ✅ Fixed: uses the new /all endpoint we added to the availability router
          fetch(`${BASE_URL}/insurance/app/availability/all`, {
            headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' },
          }),
        ])

        const [officersData, casesResponse, availData] = await Promise.all([
          officersRes.json(),
          casesRes.json(),
          availRes.json(),
        ])

        // ✅ Build availability map: userId → record
        // The availability collection stores userId = sys_user_id, so they match directly
        const aMap = {}
        for (const rec of (availData.officers || [])) {
          aMap[rec.userId] = rec
        }
        setAvailabilityMap(aMap)

        const casesData = casesResponse.cases || []

        const transformedInvestigators = (officersData.data || []).map(officer => {
          const activeCount = casesData.filter(caseItem =>
            Object.values(caseItem.investigations || {}).some(invList =>
              Array.isArray(invList) && invList.some(a =>
                a.investigatorName === officer.full_name ||
                a.investigatorId   === officer.sys_user_id
              )
            )
          ).length

          return {
            name:            officer.full_name,
            id:              officer.sys_user_id,  // matches availability userId
            initials:        officer.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
            location:        officer.location || 'Unknown',
            tat:             officer.tat_score || 85,
            phone:           officer.phone_number || 'N/A',
            specialization:  officer.specialization || 'General',
            activeCases:     activeCount,
            closedThisMonth: officer.closed_this_month || 0,
          }
        })

        setInvestigators(transformedInvestigators)
        setCases(casesData)
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [BASE_URL])

  // ── Fetch officers for reassign modal ───────────────────────────────────────
  useEffect(() => {
    if (!reassignModal) return
    setLoadingOfficers(true)
    setSelectedNewOfficer(null)
    setOfficerSearch('')

    const { inv_type, pincode } = reassignModal
    const needsPin = inv_type === 'HVI' || inv_type === 'MV'
    const url = needsPin && pincode
      ? `${BASE_URL}/insurance/app/availability/officers?pincode=${pincode}&inv_type=${inv_type}`
      : `${BASE_URL}/insurance/api/hms/users/field-officers`

    fetch(url, { headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' } })
      .then(r => r.json())
      .then(data => {
        const list = data.officers
          ? data.officers.map(o => ({
              id:        o.userId,
              name:      o.fullName,
              pin:       o.pincode,
              status:    o.status,
              matchType: o.matchType,
              availFrom: o.availableFrom,
              availTo:   o.availableTo,
            }))
          : (data.data || []).map(o => ({
              id:        o.sys_user_id,
              name:      o.full_name,
              pin:       null,
              status:    null,
              matchType: 'exact',
              availFrom: null,
              availTo:   null,
            }))
        setAvailableOfficers(list)
      })
      .catch(() => setAvailableOfficers([]))
      .finally(() => setLoadingOfficers(false))
  }, [reassignModal, BASE_URL])

  // ── Reassign handler ────────────────────────────────────────────────────────
  const handleReassign = async () => {
    if (!selectedNewOfficer || !reassignModal) return
    setReassigning(true)
    try {
      const res = await fetch(
        `${BASE_URL}/insurance/web/cases/${reassignModal.caseId}/reassign-investigation`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': 'web-user',
            'X-User-Role': 'supervisor',
          },
          body: JSON.stringify({
            inv_type:              reassignModal.inv_type,
            old_investigator_id:   reassignModal.old_investigator_id,
            new_investigator_id:   selectedNewOfficer.id,
            new_investigator_name: selectedNewOfficer.name,
          }),
        }
      )
      if (!res.ok) throw new Error('Reassign failed')
      const casesRes = await fetch(`${BASE_URL}/insurance/web/cases`)
      const casesResponse = await casesRes.json()
      setCases(casesResponse.cases || [])
      setReassignModal(null)
    } catch (e) {
      console.error(e)
    } finally {
      setReassigning(false)
    }
  }

  // ── Derived data ────────────────────────────────────────────────────────────
  const invData = investigators.find(i => i.id === selectedInv)

  const getInvestigatorCases = (invName) =>
    cases.filter(c =>
      Object.values(c.investigations || {}).some(list =>
        Array.isArray(list) && list.some(a =>
          a.investigatorName === invName || a.investigatorId === invName
        )
      )
    )

  const filteredCases = cases.filter(c => {
    const matchesInv = !selectedInv ||
      getInvestigatorCases(invData?.name).some(ic =>
        (ic.caseId || ic._id) === (c.caseId || c._id)
      )
    return (
      matchesInv &&
      (locationFilter === 'All Locations' || c.city === locationFilter) &&
      (typeFilter === 'All Types' || c.tags?.includes(typeFilter) || c.claimSubtype === typeFilter) &&
      (statusFilter === 'All Statuses' || c.status === statusFilter)
    )
  })

  const selectedCaseData = cases.find(c => (c.caseId || c._id) === selectedCase)
  const overdue = (d) => d && new Date(d) < new Date()

  const filteredModalOfficers = availableOfficers.filter(o =>
    !officerSearch || o.name?.toLowerCase().includes(officerSearch.toLowerCase())
  )

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-content">
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)' }}>
          Loading investigators and cases…
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px', alignItems: 'start' }}>

        {/* ══ LEFT: Investigator List ══════════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <div className="dot" style={{ background: 'var(--accent)' }} />
                Field Officers
              </div>
              <span className="badge gray">{investigators.length}</span>
            </div>

            <div style={{ padding: '8px' }}>
              <select
                style={{ width: '100%', marginBottom: '8px' }}
                value={locationFilter}
                onChange={e => { setLocationFilter(e.target.value); setSelectedInv(null) }}
              >
                <option>All Locations</option>
                {[...new Set(investigators.map(i => i.location))].map(loc => (
                  <option key={loc}>{loc}</option>
                ))}
              </select>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {investigators
                  .filter(inv => locationFilter === 'All Locations' || inv.location === locationFilter)
                  .map(inv => {
                    const isSelected = selectedInv === inv.id
                    const caseCount  = getInvestigatorCases(inv.name).filter(c => c.status !== 'COMPLETED').length
                    // ✅ availabilityMap[inv.id] works because inv.id = sys_user_id = userId in availability collection
                    const availRec   = availabilityMap[inv.id]
                    const hasUnconf  = getInvestigatorCases(inv.name).some(c => getUnapprovedAssignments(c).length > 0)

                    return (
                      <div
                        key={inv.id}
                        className="ta-inv-card"
                        data-selected={isSelected}
                        onClick={() => { setSelectedInv(inv.id); setSelectedCase(null) }}
                        style={{ position: 'relative' }}
                      >
                        {hasUnconf && (
                          <div style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 8, height: 8, borderRadius: '50%',
                            background: 'var(--red)',
                            boxShadow: '0 0 0 2px rgba(239,68,68,.2)',
                          }} />
                        )}

                        <div
                          className="ta-inv-avatar"
                          style={{ background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--bg3)' }}
                        >
                          {inv.initials}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="ta-inv-name">{inv.name}</div>
                          <div className="ta-inv-meta">{inv.location} · {inv.specialization}</div>
                          {availRec && (
                            <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                              {availRec.availableFrom}–{availRec.availableTo}
                              {availRec.pincode && ` · 📍 ${availRec.pincode}`}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                          <AvailabilityBadge availRec={availRec} size="sm" />
                          <span style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                            {caseCount} active
                          </span>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>

          {/* Investigator stat card */}
          {invData && (() => {
            const availRec = availabilityMap[invData.id]
            return (
              <div className="panel">
                <div className="panel-header">
                  <div className="panel-title" style={{ fontSize: '12px' }}>
                    {invData.name} — Stats
                  </div>
                </div>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

                  <div className="ta-stat-row">
                    <span className="ta-stat-label">TAT Score</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: tatColor(invData.tat), fontWeight: 600 }}>
                      {invData.tat}%
                    </span>
                  </div>
                  <div style={{ height: '4px', background: 'var(--bg3)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${invData.tat}%`, background: tatColor(invData.tat), borderRadius: '2px', transition: 'width .4s' }} />
                  </div>

                  <div className="ta-stat-row">
                    <span className="ta-stat-label">Closed this month</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, color: 'var(--green)' }}>
                      {invData.closedThisMonth}
                    </span>
                  </div>
                  <div className="ta-stat-row">
                    <span className="ta-stat-label">Active cases</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 600, color: 'var(--accent2)' }}>
                      {getInvestigatorCases(invData.name).filter(c => c.status !== 'COMPLETED').length}
                    </span>
                  </div>
                  <div className="ta-stat-row">
                    <span className="ta-stat-label">Phone</span>
                    <span style={{ fontSize: '12px', color: 'var(--text)' }}>{invData.phone}</span>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="ta-stat-row">
                      <span className="ta-stat-label">Availability</span>
                      <AvailabilityBadge availRec={availRec} />
                    </div>
                    {availRec && (
                      <>
                        <div className="ta-stat-row">
                          <span className="ta-stat-label">Working hours</span>
                          <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--mono)' }}>
                            {availRec.availableFrom} – {availRec.availableTo}
                          </span>
                        </div>
                        <div className="ta-stat-row">
                          <span className="ta-stat-label">Pincode</span>
                          <span style={{ fontSize: 12, color: 'var(--text)' }}>
                            📍 {availRec.pincode || '—'}
                            {availRec.district ? ` · ${availRec.district}` : ''}
                          </span>
                        </div>
                        <div className="ta-stat-row">
                          <span className="ta-stat-label">Last check-in</span>
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                            {availRec.lastUpdated
                              ? new Date(availRec.lastUpdated).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                </div>
              </div>
            )
          })()}
        </div>

        {/* ══ RIGHT: Cases + Detail ═══════════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <div className="dot" style={{ background: 'var(--teal)' }} />
                {selectedInv ? `Assigned Cases — ${invData?.name}` : 'Select a Field Officer'}
                <span className="badge gray" style={{ marginLeft: '6px' }}>{filteredCases.length}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  <option>All Types</option>
                  <option>Accident</option>
                  <option>Death</option>
                  <option>Critical Illness</option>
                  <option>Normal</option>
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option>All Statuses</option>
                  <option value="ALLOCATED">Allocated</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
            </div>

            {!selectedInv && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                Select a field officer to view their assigned cases
              </div>
            )}
            {selectedInv && filteredCases.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                No cases assigned to this field officer
              </div>
            )}

            {selectedInv && filteredCases.length > 0 && (
              <div className="table-wrap">
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Type</th>
                      <th>Insurer</th>
                      <th>Amount</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCases.map(c => {
                      const unconf     = getUnapprovedAssignments(c)
                      const hasUnconf  = unconf.length > 0
                      const isSelected = selectedCase === (c.caseId || c._id)
                      return (
                        <tr
                          key={c.caseId || c._id}
                          onClick={() => setSelectedCase(isSelected ? null : (c.caseId || c._id))}
                          style={{
                            cursor: 'pointer',
                            background: isSelected
                              ? 'rgba(59,130,246,.07)'
                              : hasUnconf
                                ? 'rgba(239,68,68,.03)'
                                : 'transparent',
                          }}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent2)' }}>
                                {c.caseId || c._id}
                              </span>
                              {hasUnconf && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700,
                                  background: 'rgba(239,68,68,.12)', color: 'var(--red)',
                                  border: '1px solid rgba(239,68,68,.25)',
                                  borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
                                }}>
                                  ⚠ {unconf.length} UNCONFIRMED
                                </span>
                              )}
                            </div>
                          </td>
                          <td><span>{(c.tags || ['Normal'])[0]}</span></td>
                          <td style={{ color: 'var(--muted)', fontSize: '12px' }}>{c.insurer}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
                            ₹{c.claimedAmount?.toLocaleString('en-IN') || 0}
                          </td>
                          <td>
                            <span className={`badge ${priorityColor[c.claimPriority] || 'gray'}`}>
                              {c.claimPriority || 'Normal'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${statusColor[c.status] || 'gray'}`}>
                              {c.status?.replaceAll('_', ' ') || 'ALLOCATED'}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              fontSize: '11px', fontFamily: 'var(--mono)',
                              color: overdue(c.targetDate) && c.status !== 'COMPLETED' ? 'var(--red)' : 'var(--muted)',
                              fontWeight: overdue(c.targetDate) && c.status !== 'COMPLETED' ? 600 : 400,
                            }}>
                              {overdue(c.targetDate) && c.status !== 'COMPLETED' ? '⚠ ' : ''}
                              {c.targetDate
                                ? new Date(c.targetDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                                : 'N/A'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Case detail panel */}
          {selectedCaseData && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <div className="dot" style={{ background: 'var(--purple)' }} />
                  Case Detail
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent2)', marginLeft: '8px' }}>
                    {selectedCaseData.caseId || selectedCaseData._id}
                  </span>
                </div>
                <span className={`badge ${statusColor[selectedCaseData.status] || 'gray'}`}>
                  {selectedCaseData.status?.replaceAll('_', ' ') || 'ALLOCATED'}
                </span>
              </div>

              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  {[
                    ['Type',           (selectedCaseData.tags || ['Normal'])[0]],
                    ['Insurer',        selectedCaseData.insurer],
                    ['Claimed Amount', `₹${(selectedCaseData.claimedAmount || 0).toLocaleString('en-IN')}`],
                    ['Priority',       selectedCaseData.claimPriority || 'Normal'],
                    ['Location',       selectedCaseData.city || selectedCaseData.locationDetails?.hospitalLocation || 'Unknown'],
                    ['Received',       selectedCaseData.createdAt ? new Date(selectedCaseData.createdAt).toLocaleDateString('en-IN') : 'N/A'],
                    ['Due Date',       selectedCaseData.targetDate ? new Date(selectedCaseData.targetDate).toLocaleDateString('en-IN') : 'N/A'],
                    ['Assigned To',    invData?.name || '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '4px' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{val}</div>
                    </div>
                  ))}
                </div>

                {getUnapprovedAssignments(selectedCaseData).length > 0 && (
                  <div style={{
                    marginTop: 20,
                    border: '1px solid rgba(239,68,68,.25)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      background: 'rgba(239,68,68,.07)',
                      padding: '9px 14px',
                      fontSize: 11, fontWeight: 700,
                      color: 'var(--red)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      borderBottom: '1px solid rgba(239,68,68,.15)',
                    }}>
                      ⚠ Unconfirmed Assignments — Action Required
                    </div>

                    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {getUnapprovedAssignments(selectedCaseData).map(({ inv_type, entry, reason }) => {
                        const pincode = inv_type === 'HVI'
                          ? (selectedCaseData.hospitalDetails?.pincode || selectedCaseData.hospitalPincode || '')
                          : inv_type === 'MV'
                            ? (selectedCaseData.pinCode || selectedCaseData.claimantPincode || '')
                            : ''

                        const isDeclined  = reason === 'declined'
                        const rowBg       = isDeclined ? 'rgba(239,68,68,.05)' : 'rgba(245,158,11,.05)'
                        const rowBorder   = isDeclined ? 'rgba(239,68,68,.2)'  : 'rgba(245,158,11,.2)'
                        const reasonColor = isDeclined ? 'var(--red)'          : 'var(--amber)'
                        const reasonLabel = isDeclined ? '✕ Declined'          : '⏱ No response (>2h)'

                        return (
                          <div
                            key={inv_type + entry.investigatorId}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '10px 12px', borderRadius: 6,
                              background: rowBg,
                              border: `1px solid ${rowBorder}`,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700,
                                  padding: '1px 7px', borderRadius: 4,
                                  background: 'var(--bg3)', color: 'var(--text)',
                                  border: '1px solid var(--border)',
                                }}>
                                  {inv_type}
                                </span>
                                <span style={{ fontSize: 10, fontWeight: 600, color: reasonColor }}>
                                  {reasonLabel}
                                </span>
                                {pincode && (
                                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                                    📍 {pincode}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {entry.investigatorName || entry.investigatorId}
                                {entry.declineReason && (
                                  <span style={{ marginLeft: 6, fontStyle: 'italic', color: 'var(--red)' }}>
                                    — "{entry.declineReason}"
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => setReassignModal({
                                caseId:              selectedCaseData.caseId,
                                inv_type,
                                old_investigator_id: entry.investigatorId,
                                pincode,
                              })}
                              style={{
                                padding: '6px 16px', borderRadius: 5,
                                background: 'var(--accent)', color: '#fff',
                                border: 'none', fontSize: 12, fontWeight: 600,
                                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                              }}
                            >
                              Reassign
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══ Reassign Modal ═══════════════════════════════════════════════════ */}
      {reassignModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setReassignModal(null) }}
        >
          <div style={{
            background: 'var(--bg1)', borderRadius: 12,
            border: '1px solid var(--border)',
            width: 460, maxHeight: '82vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                  Reassign — <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent2)' }}>{reassignModal.inv_type}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--mono)' }}>{reassignModal.caseId}</span>
                  {reassignModal.pincode && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(59,130,246,.1)', color: 'var(--accent2)',
                      border: '1px solid rgba(59,130,246,.2)',
                    }}>
                      📍 PIN {reassignModal.pincode}
                    </span>
                  )}
                  {(reassignModal.inv_type === 'HVI' || reassignModal.inv_type === 'MV') && !reassignModal.pincode && (
                    <span style={{ fontSize: 10, color: 'var(--amber)' }}>
                      ⚠ No pincode — showing all officers
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setReassignModal(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 18, color: 'var(--muted)', lineHeight: 1,
                  padding: '2px 6px',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <input
                type="text"
                placeholder="Search officer name…"
                value={officerSearch}
                onChange={e => setOfficerSearch(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
              {loadingOfficers ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13 }}>
                  Loading officers…
                </div>
              ) : filteredModalOfficers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13 }}>
                  {officerSearch ? 'No officers match that search' : 'No available officers found'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filteredModalOfficers.map(officer => {
                    const isSelected = selectedNewOfficer?.id === officer.id
                    const availRec   = availabilityMap[officer.id]
                    const avail      = officer.status != null
                      ? officer.status === 'Available'
                      : isOfficerAvailable(availRec)

                    return (
                      <div
                        key={officer.id}
                        onClick={() => setSelectedNewOfficer(officer)}
                        style={{
                          padding: '10px 12px', borderRadius: 7, cursor: 'pointer',
                          border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                          background: isSelected
                            ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                            : 'var(--bg2)',
                          display: 'flex', alignItems: 'center', gap: 10,
                          transition: 'all 0.12s',
                        }}
                      >
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%',
                          background: isSelected ? 'var(--accent)' : 'var(--bg3)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700,
                          color: isSelected ? '#fff' : 'var(--muted)',
                          flexShrink: 0,
                        }}>
                          {officer.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
                            {officer.name}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center' }}>
                            {avail !== null && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: avail ? 'var(--green)' : 'var(--red)' }}>
                                {avail ? '● Available' : '○ Unavailable'}
                              </span>
                            )}
                            {(officer.availFrom || availRec?.availableFrom) && (
                              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                                {officer.availFrom || availRec?.availableFrom}–{officer.availTo || availRec?.availableTo}
                              </span>
                            )}
                            {(officer.pin || availRec?.pincode) && (
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                                📍 {officer.pin || availRec?.pincode}
                              </span>
                            )}
                            {officer.matchType === 'district' && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                                borderRadius: 4, background: 'rgba(245,158,11,.12)',
                                color: 'var(--amber)', border: '1px solid rgba(245,158,11,.25)',
                              }}>
                                NEARBY
                              </span>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0 }}>✓</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--border)',
              display: 'flex', gap: 10,
              flexShrink: 0,
            }}>
              <button
                onClick={() => setReassignModal(null)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 6,
                  background: 'none', border: '1px solid var(--border)',
                  color: 'var(--muted)', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReassign}
                disabled={!selectedNewOfficer || reassigning}
                style={{
                  flex: 2, padding: '9px 0', borderRadius: 6,
                  background: selectedNewOfficer && !reassigning ? 'var(--accent)' : 'var(--bg3)',
                  border: 'none',
                  color: selectedNewOfficer && !reassigning ? '#fff' : 'var(--muted)',
                  cursor: selectedNewOfficer && !reassigning ? 'pointer' : 'not-allowed',
                  fontSize: 13, fontWeight: 600,
                  fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {reassigning ? (
                  <>
                    <span style={{
                      display: 'inline-block', width: 11, height: 11,
                      border: '2px solid currentColor', borderTopColor: 'transparent',
                      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                    }} />
                    Reassigning…
                  </>
                ) : (
                  `Reassign${selectedNewOfficer ? ` to ${selectedNewOfficer.name}` : ''}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}