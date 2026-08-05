export default function Analytics() {
  return (
    <div className="page-content">
      <div className="filter-row">
        <select style={{width:'auto'}}><option>Last 30 days</option><option>Last 7 days</option><option>This Month</option><option>Custom Range</option></select>
        <select style={{width:'auto'}}><option>All Insurers</option><option>HDFC Ergo</option><option>Star Health</option><option>New India</option><option>LIC</option></select>
        <select style={{width:'auto'}}><option>All Claim Types</option><option>Motor</option><option>Health</option><option>Fire</option><option>Life</option></select>
        <button className="btn btn-ghost btn-sm">Apply</button>
        <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
          </svg>
          Export CSV
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-label">Total Cases (Period)</div>
          <div className="stat-value blue">412</div>
          <div className="stat-meta">↑ 8% vs prior period</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Avg TAT (days)</div>
          <div className="stat-value green">3.8</div>
          <div className="stat-meta">Target: 5 days</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Fraud Rate</div>
          <div className="stat-value amber">12%</div>
          <div className="stat-meta">49 cases flagged</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Reports Approved</div>
          <div className="stat-value purple">389</div>
          <div className="stat-meta">94.4% approval rate</div>
        </div>
      </div>

      <div className="two-col">
        {/* TAT Compliance */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="dot" style={{background:'var(--accent)'}}/>
              TAT Compliance by Investigator
            </div>
          </div>
          <div className="panel-body" style={{display:'flex', flexDirection:'column', gap:'14px'}}>
            {[
              { name: 'Arjun Patil', pct: 96, color: 'var(--green)' },
              { name: 'Meena S.', pct: 91, color: 'var(--green)' },
              { name: 'Ravi Kumar', pct: 78, color: 'var(--amber)' },
              { name: 'Deepa N.', pct: 62, color: 'var(--red)' },
              { name: 'Kiran M.', pct: 88, color: 'var(--green)' },
            ].map(inv => (
              <div key={inv.name}>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:'12px', marginBottom:'4px'}}>
                  <span>{inv.name}</span>
                  <span style={{color: inv.color, fontFamily:'var(--mono)'}}>{inv.pct}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{width:`${inv.pct}%`, background: inv.color}}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Outcome Distribution */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <div className="dot" style={{background:'var(--amber)'}}/>
              Outcome Distribution
            </div>
          </div>
          <div className="panel-body">
            <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
              {[
                { label:'Genuine', count:263, pct:64, color:'var(--green)', bg:'rgba(16,185,129,.08)', border:'rgba(16,185,129,.2)' },
                { label:'Suspicious', count:100, pct:24, color:'var(--amber)', bg:'rgba(245,158,11,.08)', border:'rgba(245,158,11,.2)' },
                { label:'Repudiated', count:49, pct:12, color:'var(--red)', bg:'rgba(239,68,68,.08)', border:'rgba(239,68,68,.2)' },
              ].map(item => (
                <div key={item.label} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'12px 14px',
                  background: item.bg,
                  border:`1px solid ${item.border}`,
                  borderRadius:'6px'
                }}>
                  <div>
                    <div style={{fontSize:'13px', marginBottom:'2px'}}>{item.label}</div>
                    <div style={{fontSize:'11px', color:'var(--muted)'}}>{item.pct}% of total</div>
                  </div>
                  <span style={{fontSize:'22px', fontFamily:'var(--mono)', color:item.color}}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Claim type breakdown */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <div className="dot" style={{background:'var(--teal)'}}/>
            Cases by Claim Type
          </div>
          <span style={{fontSize:'11px', color:'var(--muted)'}}>Last 30 days</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Claim Type</th><th>Total Cases</th><th>Avg TAT</th>
                <th>Genuine</th><th>Suspicious</th><th>Repudiated</th><th>Fraud Rate</th>
              </tr>
            </thead>
            <tbody>
              {[
                { type:'Motor', total:182, tat:'3.2d', genuine:118, suspicious:42, rep:22, fraud:'12.1%' },
                { type:'Health', total:124, tat:'4.1d', genuine:88, suspicious:28, rep:8, fraud:'6.5%' },
                { type:'Fire / Property', total:54, tat:'5.8d', genuine:32, suspicious:16, rep:6, fraud:'11.1%' },
                { type:'Life', total:32, tat:'6.2d', genuine:20, suspicious:8, rep:4, fraud:'12.5%' },
                { type:'Marine', total:14, tat:'4.0d', genuine:4, suspicious:6, rep:4, fraud:'28.6%' },
                { type:'Burglary', total:6, tat:'2.8d', genuine:1, suspicious:0, rep:5, fraud:'83.3%' },
              ].map(r => (
                <tr key={r.type}>
                  <td className="td-name">{r.type}</td>
                  <td style={{fontFamily:'var(--mono)'}}>{r.total}</td>
                  <td style={{color:'var(--muted)'}}>{r.tat}</td>
                  <td style={{color:'var(--green)', fontFamily:'var(--mono)'}}>{r.genuine}</td>
                  <td style={{color:'var(--amber)', fontFamily:'var(--mono)'}}>{r.suspicious}</td>
                  <td style={{color:'var(--red)', fontFamily:'var(--mono)'}}>{r.rep}</td>
                  <td>
                    <span className={`badge ${parseFloat(r.fraud) > 20 ? 'red' : parseFloat(r.fraud) > 10 ? 'amber' : 'green'}`}>
                      {r.fraud}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
