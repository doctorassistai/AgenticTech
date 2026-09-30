import { useState, useEffect, useMemo } from "react";

const STATUS_COLOR = {
  ALLOCATED: 'var(--accent)', IN_PROGRESS: 'var(--amber)', EVIDENCE_COLLECTION: 'var(--amber)',
  UNDER_REVIEW: 'var(--purple, #a855f7)', QC_PENDING: 'var(--teal, #14b8a6)',
  COMPLETED: 'var(--green)', CLOSED: 'var(--muted)', DRAFT: 'var(--muted)', UNKNOWN: 'var(--muted)',
}

function fmtAmount(n) {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}
function fmtStatus(s) { return (s || '').replaceAll('_', ' ') }

// Shown in the "Not Yet Available" stub if the performance endpoint fails to
// load — keeps the spec's blocked-analytics list visible even without data.
const DEFAULT_BLOCKED = [
  { key: 'stage_tat', label: 'Stage turnaround & minute-level timing', reason: 'Cases store only createdAt/updatedAt — no per-stage timestamp/audit log yet (spec §15.1).' },
  { key: 'state_performance', label: 'State performance', reason: 'No per-visit state field exists on cases yet (spec §6).' },
  { key: 'reporting_manager', label: 'Reporting Manager performance', reason: 'No reporting-manager allocation records are captured yet (spec §9).' },
  { key: 'portal_team', label: 'Portal Team performance', reason: 'No portal download/processing events are logged yet (spec §11.2).' },
  { key: 'no_resource_events', label: 'No-available-doctor / field-officer events', reason: 'These conditions are not persisted as events yet (spec §20.1).' },
]

// ── Dependency-free cumulative line chart (same approach as the old
// per-doctor stats modal) — used for the daily new-case trend. ────────────
function BarTrend({ data, valueKey, label, color = 'var(--accent)' }) {
  if (!data || data.length === 0) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No data yet.</div>
  }
  const max = Math.max(1, ...data.map(d => d[valueKey]))
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${d.date}: ${d[valueKey]} ${label}`}>
            <div style={{
              width: '100%', minHeight: d[valueKey] > 0 ? 3 : 0,
              height: `${(d[valueKey] / max) * 100}%`,
              background: color, borderRadius: '2px 2px 0 0',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
        <span>{data[0]?.date?.slice(5)}</span>
        <span>{data[data.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  )
}

// Ported from DoctorsList's StatsModal — cumulative assigned/generated lines.
function LineChartSVG({ data }) {
  const width = 640, height = 220
  const padL = 40, padR = 12, padT = 12, padB = 28
  const innerW = width - padL - padR
  const innerH = height - padT - padB

  if (!data || data.length === 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, color: 'var(--muted)', fontSize: 13 }}>No timeline data yet.</div>
  }

  const maxVal = Math.max(1, ...data.map(d => Math.max(d.assigned_cumulative, d.generated_cumulative)))
  const xFor = i => data.length === 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW
  const yFor = v => padT + innerH - (v / maxVal) * innerH
  const pathFor = key => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d[key])}`).join(' ')

  const labelIdxs = new Set()
  const step = Math.max(1, Math.floor((data.length - 1) / 4))
  for (let i = 0; i < data.length; i += step) labelIdxs.add(i)
  labelIdxs.add(data.length - 1)

  const yTicks = [0, Math.round(maxVal / 2), maxVal]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={width - padR} y1={yFor(t)} y2={yFor(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{t}</text>
        </g>
      ))}
      {data.map((d, i) => labelIdxs.has(i) && (
        <text key={i} x={xFor(i)} y={height - padB + 16} textAnchor="middle" fontSize="9" fill="var(--muted)">{d.date.slice(5)}</text>
      ))}
      <path d={pathFor('generated_cumulative')} fill="none" stroke="var(--green)" strokeWidth={2} />
      <path d={pathFor('assigned_cumulative')} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {data.map((d, i) => (
        <g key={`pts-${i}`}>
          <circle cx={xFor(i)} cy={yFor(d.assigned_cumulative)} r={3} fill="var(--accent)"><title>{`${d.date} — Assigned: ${d.assigned_cumulative}`}</title></circle>
          <circle cx={xFor(i)} cy={yFor(d.generated_cumulative)} r={3} fill="var(--green)"><title>{`${d.date} — Generated: ${d.generated_cumulative}`}</title></circle>
        </g>
      ))}
    </svg>
  )
}

function BreakdownList({ items, labelKey, color }) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1
  const sorted = [...items].sort((a, b) => b.count - a.count)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map(item => {
        const pct = Math.round((item.count / total) * 100)
        return (
          <div key={item[labelKey]}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span>{fmtStatus(item[labelKey])}</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{item.count} · {pct}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%`, background: (typeof color === 'function' ? color(item[labelKey]) : color) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Analytics({ mdMode = false, operationsMode = false }) {
  const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || ''
  const apiPrefix = mdMode ? '/insurance/web/md' : operationsMode ? '/insurance/web/operations' : '/insurance/web'
  const token = localStorage.getItem(mdMode ? 'md_token' : 'operations_token')
  const requestOptions = (mdMode || operationsMode) ? { headers: { Authorization: `Bearer ${token || ''}` } } : undefined

  const [overview, setOverview]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  const [docStats, setDocStats]   = useState(null)
  const [docLoading, setDocLoading] = useState(true)

  // Extended MD/Operations-only performance analytics (spec §20.1/§20.2).
  const [perf, setPerf]         = useState(null)
  const [perfLoading, setPerfLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${BASE_URL}${apiPrefix}/analytics/overview`, requestOptions)
      .then(r => { if (!r.ok) throw new Error('Failed to load analytics.'); return r.json() })
      .then(d => { if (!cancelled) { if (d.success) setOverview(d); else setError('Failed to load analytics.') } })
      .catch(() => { if (!cancelled) setError('Failed to load analytics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [BASE_URL, apiPrefix])

  useEffect(() => {
    let cancelled = false
    setDocLoading(true)
    fetch(`${BASE_URL}${apiPrefix}/doctors/stats`, requestOptions)
      .then(r => { if (!r.ok) throw new Error('Doctor stats unavailable.'); return r.json() })
      .then(d => { if (!cancelled) setDocStats(d) })
      .catch(() => { if (!cancelled) setDocStats(null) })
      .finally(() => { if (!cancelled) setDocLoading(false) })
    return () => { cancelled = true }
  }, [BASE_URL, apiPrefix])

  // Only MD / Operations get the extended performance endpoint (guarded server-side).
  useEffect(() => {
    if (!(mdMode || operationsMode)) { setPerfLoading(false); return }
    let cancelled = false
    setPerfLoading(true)
    fetch(`${BASE_URL}${apiPrefix}/analytics/performance`, requestOptions)
      .then(r => { if (!r.ok) throw new Error('Performance analytics unavailable.'); return r.json() })
      .then(d => { if (!cancelled) setPerf(d?.success ? d : null) })
      .catch(() => { if (!cancelled) setPerf(null) })
      .finally(() => { if (!cancelled) setPerfLoading(false) })
    return () => { cancelled = true }
  }, [BASE_URL, apiPrefix, mdMode, operationsMode])

  const doctorRows = useMemo(() => {
    if (!docStats?.doctors) return []
    return [...docStats.doctors].sort((a, b) => b.assigned_count - a.assigned_count)
  }, [docStats])

  const k = overview?.kpis

  if (error && !overview) {
    return <div className="page-content" role="alert" style={{ padding: 20, color: 'var(--red)' }}>{error}</div>
  }

  return (
    <div className="page-content">
      {error && (
        <div style={{ background: 'rgba(239,68,68,.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-label">Total Cases</div>
          <div className="stat-value">{loading || !k ? '—' : k.total_cases}</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Active</div>
          <div className="stat-value">{loading || !k ? '—' : k.active}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Completed</div>
          <div className="stat-value">{loading || !k ? '—' : k.completed}</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">SLA Breached</div>
          <div className="stat-value">{loading || !k ? '—' : k.sla_breached}</div>
          <div className="stat-meta">Open cases past target date</div>
        </div>
      </div>
      <div className="stats-grid" style={{ marginTop: 14 }}>
        <div className="stat-card purple">
          <div className="stat-label">New Today</div>
          <div className="stat-value">{loading || !k ? '—' : k.today}</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">New This Week</div>
          <div className="stat-value">{loading || !k ? '—' : k.this_week}</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">New This Month</div>
          <div className="stat-value">{loading || !k ? '—' : k.this_month}</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-label">Avg Claimed Amount</div>
          <div className="stat-value">{loading || !k ? '—' : fmtAmount(k.avg_claimed_amount)}</div>
          <div className="stat-meta">Total: {loading || !k ? '—' : fmtAmount(k.total_claimed_amount)}</div>
        </div>
      </div>

      {(mdMode || operationsMode) && <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div className="panel-title"><div className="dot" style={{ background: 'var(--teal)' }} />Cases by Source</div>
        </div>
        <div className="panel-body">
          {loading ? <div style={{ color: 'var(--muted)' }}>Loading…</div> :
            overview.source_breakdown?.length
              ? <BreakdownList items={overview.source_breakdown} labelKey="source" color="var(--teal)" />
              : <div style={{ color: 'var(--muted)' }}>No source data yet.</div>}
        </div>
      </div>}

      <div className="two-col" style={{ marginTop: 16 }}>
        {/* Status breakdown */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><div className="dot" style={{ background: 'var(--accent)' }} />Cases by Status</div>
          </div>
          <div className="panel-body">
            {loading ? <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
              <BreakdownList items={overview.status_breakdown} labelKey="status" color={s => STATUS_COLOR[s] || 'var(--muted)'} />}
          </div>
        </div>

        {/* Priority breakdown */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><div className="dot" style={{ background: 'var(--amber)' }} />Cases by Priority</div>
          </div>
          <div className="panel-body">
            {loading ? <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
              <BreakdownList
                items={overview.priority_breakdown}
                labelKey="priority"
                color={p => ({ Normal: 'var(--muted)', High: 'var(--amber)', Urgent: 'var(--red)', Critical: 'var(--red)' }[p] || 'var(--muted)')}
              />}
          </div>
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 16 }}>
        {/* Tag breakdown */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><div className="dot" style={{ background: 'var(--purple, #a855f7)' }} />Cases by Tag</div>
          </div>
          <div className="panel-body">
            {loading ? <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
              overview.tag_breakdown.length === 0
                ? <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>No tagged cases.</div>
                : <BreakdownList items={overview.tag_breakdown} labelKey="tag" color="var(--purple, #a855f7)" />}
          </div>
        </div>

        {/* Claim mode breakdown */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><div className="dot" style={{ background: 'var(--teal, #14b8a6)' }} />Cases by Claim Mode</div>
          </div>
          <div className="panel-body">
            {loading ? <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
              <BreakdownList items={overview.claim_mode_breakdown} labelKey="mode" color="var(--teal, #14b8a6)" />}
          </div>
        </div>
      </div>

      {/* Daily trend */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div className="panel-title"><div className="dot" style={{ background: 'var(--accent)' }} />New Cases — Last 30 Days</div>
        </div>
        <div className="panel-body">
          {loading ? <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
            <BarTrend data={overview.daily_trend} valueKey="new_cases" label="new cases" />}
        </div>
      </div>

      {/* Insurer breakdown */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div className="panel-title"><div className="dot" style={{ background: 'var(--green)' }} />Claims by Insurance Company</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Insurer</th><th>Cases</th><th>Total Claimed</th><th>Avg Claimed</th><th>Status Mix</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>Loading…</td></tr>}
              {!loading && overview.insurer_breakdown.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No cases yet.</td></tr>
              )}
              {!loading && overview.insurer_breakdown.map(row => (
                <tr key={row.insurer}>
                  <td className="td-name">{row.insurer}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{row.count}</td>
                  <td>{fmtAmount(row.total_claimed)}</td>
                  <td>{fmtAmount(row.avg_claimed)}</td>
                  <td>
                    {Object.entries(row.status_counts).map(([s, n]) => (
                      <span key={s} className="badge gray" style={{ marginRight: 4, marginBottom: 4, display: 'inline-block' }}>
                        {fmtStatus(s)}: {n}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Doctor performance */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div className="panel-title"><div className="dot" style={{ background: 'var(--accent)' }} />Doctor Performance</div>
        </div>
        <div className="panel-body">
          {docLoading ? (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : !docStats ? (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Doctor stats unavailable.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                  Assigned (total: {docStats.totals?.assigned ?? 0})
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                  Generated (total: {docStats.totals?.generated ?? 0})
                </div>
              </div>
              <LineChartSVG data={docStats.timeline} />
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr><th>Doctor</th><th>Assigned</th><th>Generated</th><th>Completion</th></tr>
                  </thead>
                  <tbody>
                    {doctorRows.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No cases assigned yet.</td></tr>
                    )}
                    {doctorRows.map(r => {
                      const pct = r.assigned_count > 0 ? Math.round((r.generated_count / r.assigned_count) * 100) : 0
                      return (
                        <tr key={r.doctor_id}>
                          <td className="td-name">{r.name}</td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{r.assigned_count}</td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{r.generated_count}</td>
                          <td>
                            <span className={`badge ${pct >= 70 ? 'green' : pct >= 40 ? 'amber' : 'red'}`}>{pct}%</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── MD / Operations-only extended analytics (spec §20.1 / §20.2) ── */}
      {(mdMode || operationsMode) && (
        <>
          {/* Field Officer performance */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <div className="panel-title"><div className="dot" style={{ background: 'var(--amber)' }} />Field Officer Performance</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Officer</th><th>Assigned</th><th>Accepted</th><th>Declined</th>
                    <th>Pending</th><th>Reassigned Away</th><th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {perfLoading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>Loading…</td></tr>}
                  {!perfLoading && (!perf || perf.field_officers.length === 0) && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No field-officer assignments yet.</td></tr>
                  )}
                  {!perfLoading && perf?.field_officers.map(o => (
                    <tr key={o.officer_id}>
                      <td className="td-name">{o.name}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{o.assigned}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{o.accepted}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{o.declined}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{o.pending}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{o.reassigned_away}</td>
                      <td>
                        {o.on_leave
                          ? <span className="badge amber">On Leave</span>
                          : <span className={`badge ${o.availability === 'Available' ? 'green' : o.availability === 'Unavailable' ? 'red' : 'gray'}`}>{o.availability}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-col" style={{ marginTop: 16 }}>
            {/* Reassignment volume & reasons */}
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title"><div className="dot" style={{ background: 'var(--red)' }} />Reassignments {perf ? `· ${perf.reassignment.total} total` : ''}</div>
              </div>
              <div className="panel-body">
                {perfLoading ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
                  !perf || perf.reassignment.total === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No reassignments recorded.</div> : (
                    <>
                      {perf.reassignment.by_type.length > 0 && (
                        <>
                          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>By investigation type</div>
                          <BreakdownList items={perf.reassignment.by_type.map(x => ({ inv_type: fmtStatus(x.inv_type), count: x.count }))} labelKey="inv_type" color="var(--red)" />
                        </>
                      )}
                      {perf.reassignment.decline_reasons.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>Decline / reassignment reasons</div>
                          {perf.reassignment.decline_reasons.map((r, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                              <span>{r.reason}</span>
                              <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{r.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
              </div>
            </div>

            {/* QC performance */}
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title"><div className="dot" style={{ background: 'var(--teal, #14b8a6)' }} />QC Performance</div>
              </div>
              <div className="panel-body">
                {perfLoading ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div> :
                  !perf || perf.qc.reviewed === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No QC decisions recorded.</div> : (
                    <>
                      <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 13 }}>
                        <div><span className="badge green">Approved</span> <span style={{ fontFamily: 'var(--mono)' }}>{perf.qc.approved}</span></div>
                        <div><span className="badge amber">Reinvestigate</span> <span style={{ fontFamily: 'var(--mono)' }}>{perf.qc.reinvestigate}</span></div>
                        <div style={{ color: 'var(--muted)' }}>Reviewed: {perf.qc.reviewed}</div>
                      </div>
                      {perf.qc.by_doctor.length > 0 && (
                        <table>
                          <thead><tr><th>Doctor</th><th>Approved</th><th>Reinvestigate</th></tr></thead>
                          <tbody>
                            {perf.qc.by_doctor.map((d, i) => (
                              <tr key={i}>
                                <td className="td-name">{d.doctor}</td>
                                <td style={{ fontFamily: 'var(--mono)' }}>{d.approved}</td>
                                <td style={{ fontFamily: 'var(--mono)' }}>{d.reinvestigate}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
              </div>
            </div>
          </div>

          {/* SLA / overdue open cases */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <div className="panel-title"><div className="dot" style={{ background: 'var(--red)' }} />SLA · Overdue Open Cases {perf ? `· ${perf.sla.overdue_count}` : ''}</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Case</th><th>Insurer</th><th>Status</th><th>Priority</th><th>Target Date</th><th>Days Overdue</th></tr>
                </thead>
                <tbody>
                  {perfLoading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>Loading…</td></tr>}
                  {!perfLoading && (!perf || perf.sla.overdue.length === 0) && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No overdue open cases. 🎉</td></tr>
                  )}
                  {!perfLoading && perf?.sla.overdue.map(row => (
                    <tr key={row.caseId}>
                      <td className="td-name">{row.caseId}</td>
                      <td>{row.insurer}</td>
                      <td>{fmtStatus(row.status)}</td>
                      <td>{row.priority}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{row.targetDate || '—'}</td>
                      <td><span className={`badge ${row.days_overdue >= 3 ? 'red' : 'amber'}`}>{row.days_overdue}d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Blocked analytics — explicit stub (spec items with no data model yet) */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-header">
              <div className="panel-title"><div className="dot" style={{ background: 'var(--muted)' }} />Not Yet Available — Requires Stage / Audit Logging</div>
            </div>
            <div className="panel-body">
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                These spec analytics need data the current model does not capture. Add per-stage audit timestamps and a per-visit state field first.
              </div>
              {(perf?.blocked || DEFAULT_BLOCKED).map(b => (
                <div key={b.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="badge gray" style={{ flexShrink: 0 }}>Pending data</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{b.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
