import React, { useState, useEffect } from 'react';

const TreatmentResponseDashboard = ({ patientId, doctorId }) => {
  const [analysisData, setAnalysisData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedChart, setExpandedChart] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState('3months');
  const [showDetails, setShowDetails] = useState({});
  const [chartView, setChartView] = useState('line');
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

  const fetchTreatmentResponse = async () => {
    if (!patientId || !doctorId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `${API_BASE_URL}hms/users/orchestration/treatment-response-analysis`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
        }
      );
      if (!res.ok) throw new Error('Failed to fetch treatment response analysis');
      const json = await res.json();
      setAnalysisData(json?.analysis || {});
    } catch (err) {
      console.error('Treatment response fetch failed:', err);
      setError(err.message || 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTreatmentResponse(); }, [patientId, doctorId]);

  const toggleDetails = (section) => {
    setShowDetails(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getStatusKey = (status) => {
    switch (status?.toLowerCase()) {
      case 'complete response':
      case 'partial response':
      case 'stable':              return 'stable';
      case 'progressive disease': return 'danger';
      case 'indeterminate':       return 'warn';
      default:                    return 'neutral';
    }
  };

  /* ── Confidence badge ── */
  const getConfidenceBadge = (confidence) => {
    const map = {
      high:   { cls: 'badge-high',    label: 'High Confidence' },
      medium: { cls: 'badge-med',     label: 'Medium Confidence' },
      low:    { cls: 'badge-low',     label: 'Low Confidence' },
    };
    const cfg = map[confidence?.toLowerCase()] || { cls: 'badge-neutral', label: confidence };
    return <span className={`conf-badge ${cfg.cls}`}><span className="badge-dot" />{cfg.label}</span>;
  };

  /* ── Trend icon (monochrome strokes) ── */
  const getTrendIcon = (trend) => {
    const col = { improvement_slope: '#000', improvement: '#000', plateau: '#444', decline: '#000', fluctuating_pattern: '#444' }[trend?.toLowerCase()] || '#888';
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2.5">
        {trend === 'improvement_slope' || trend === 'improvement'
          ? <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>
          : trend === 'decline'
            ? <><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></>
            : trend === 'fluctuating_pattern'
              ? <path d="M3 12 Q6 6 9 12 Q12 18 15 12 Q18 6 21 12"/>
              : <line x1="5" y1="12" x2="19" y2="12"/>}
      </svg>
    );
  };

  const formatDate = (d) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; }
  };

  const calculateAverage = (data, field) => {
    if (!data?.length) return 'N/A';
    const vals = data.map(i => Number(i[field])).filter(v => !isNaN(v));
    if (!vals.length) return 'N/A';
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={S.center}>
          <div className="spin-ring" />
          <p style={{ color: '#000', fontSize: 14, fontWeight: 400, fontFamily: 'Open Sans', marginBottom: 4 }}>Loading treatment response analysis…</p>
          <p style={{ color: '#888', fontSize: 12, fontFamily: 'Open Sans' }}>Processing clinical data</p>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !analysisData || Object.keys(analysisData).length === 0) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={{ ...S.center, gap: 16 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#000', fontSize: 16, fontWeight: 400, fontFamily: 'Open Sans', marginBottom: 8, letterSpacing: '-0.01em' }}>Unable to Load Data</h2>
            <p style={{ color: '#444', fontSize: 13, marginBottom: 20, fontFamily: 'Open Sans', maxWidth: 320, fontWeight: 300 }}>{error || 'No treatment response data available for this patient'}</p>
          </div>
          <button onClick={fetchTreatmentResponse} className="btn-primary">Retry Analysis</button>
        </div>
      </div>
    );
  }

  /* ── Destructure ── */
  const {
    summary_status_indicator = {},
    objective_response_classification = {},
    longitudinal_trend_analysis = {},
    decision_support_for_doctor = {},
    key_drivers_of_response = [],
    expandable_trend_chart_data = {},
    insurance_and_compliance_insight = {},
  } = analysisData;

  const explainability_and_audit_trail =
    typeof analysisData?.explainability_and_audit_trail === 'object' &&
    !Array.isArray(analysisData?.explainability_and_audit_trail)
      ? analysisData.explainability_and_audit_trail
      : {};

  const { labs = [], vitals = [], workflow_events = [], medication_changes = [] } = expandable_trend_chart_data;

  const numericLabValues = labs.map(l => Number(l.value ?? l.lab_value)).filter(v => !isNaN(v));
  const maxValue   = numericLabValues.length ? Math.max(...numericLabValues) : 5;
  const avgValue   = calculateAverage(labs, 'value');
  const avgLabValue = calculateAverage(labs, 'lab_value');
  const finalAverage = avgValue !== 'N/A' ? avgValue : avgLabValue;

  const tabs = [
    { id: 'overview',  label: 'Clinical Overview',  sub: 'Patient response summary' },
    { id: 'trends',    label: 'Trend Analysis',      sub: 'Longitudinal patterns' },
    { id: 'protocol',  label: 'Protocol Alignment',  sub: 'Treatment validation' },
    { id: 'audit',     label: 'Clinical Audit',       sub: 'Explainability & compliance' },
  ];

  const statusKey = getStatusKey(summary_status_indicator.overall_status);

  /* ════════════════════════════════════════════════════════════════════ */
  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={S.logoBox} />
            <div>
              <h1 style={S.headerTitle}>Treatment Response Analysis</h1>
              <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={S.chip}>PAT {patientId?.substring(0, 8)}…</span>
                <span style={S.chip}>DOC {doctorId?.substring(0, 8)}…</span>
                {labs.length > 0 && labs[labs.length - 1]?.date && (
                  <span style={{ ...S.chip }}>Updated {formatDate(labs[labs.length - 1].date)}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <nav style={S.tabBar}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`tab-btn${activeTab === t.id ? ' tab-active' : ''}`}>
              <span className="tab-label">{t.label}</span>
              <span className="tab-sub">{t.sub}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* ── MAIN ── */}
      <main style={S.main}>

        {/* ── STATUS HERO ── */}
        {summary_status_indicator.overall_status && (
          <div style={{ ...S.heroCard, borderColor: statusKey === 'danger' ? '#000' : '#e0e0e0' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <div style={S.heroGlyph}>
                <span style={{ fontSize: 24, fontWeight: 400, color: '#000', fontFamily: 'Open Sans', letterSpacing: '-0.03em' }}>
                  {summary_status_indicator.overall_status?.charAt(0) || '?'}
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 20, fontWeight: 400, color: '#000', fontFamily: 'Open Sans', letterSpacing: '-0.02em' }}>
                    {summary_status_indicator.overall_status}
                  </span>
                  {summary_status_indicator.confidence_level && getConfidenceBadge(summary_status_indicator.confidence_level)}
                  {summary_status_indicator.data_completeness && (
                    <span className="meta-chip">{summary_status_indicator.data_completeness} Data</span>
                  )}
                </div>
                {summary_status_indicator.limitations && (
                  <p style={{ color: '#444', fontSize: 13, lineHeight: 1.7, maxWidth: 720, fontWeight: 300 }}>{summary_status_indicator.limitations}</p>
                )}
              </div>
            </div>
            {objective_response_classification.category && (
              <div style={{ position: 'absolute', top: 20, right: 20 }}>
                <span style={S.sectionLabel}>RESPONSE CLASS</span>
                <div style={{ marginTop: 4 }}>
                  <span className={`status-pill status-${statusKey}`}>{objective_response_classification.category}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════ OVERVIEW ════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <>
            <div style={S.grid3}>

              {/* Objective Response */}
              {objective_response_classification.category && (
                <div style={S.card}>
                  <div style={S.cardHead}>
                    <span style={S.cardTitle}>Objective Response</span>
                    {objective_response_classification.confidence && getConfidenceBadge(objective_response_classification.confidence)}
                  </div>
                  <div style={S.cardBody}>
                    <div style={{ ...S.ibox, marginBottom: 14 }}>
                      <span style={S.sectionLabel}>CATEGORY</span>
                      <span style={{ fontSize: 20, fontWeight: 400, color: '#000', fontFamily: 'Open Sans', marginTop: 4, letterSpacing: '-0.02em' }}>
                        {objective_response_classification.category}
                      </span>
                    </div>
                    {objective_response_classification.basis_of_classification?.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <span style={S.sectionLabel}>CLINICAL BASIS</span>
                        <ul style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {objective_response_classification.basis_of_classification.map((basis, idx) => (
                            <li key={idx} style={S.checkRow}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}><polyline points="20 6 9 17 4 12"/></svg>
                              <span style={{ color: '#444', fontSize: 12, lineHeight: 1.5, fontWeight: 300 }}>{basis}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {objective_response_classification.supporting_data_points?.length > 0 && (
                      <>
                        <button onClick={() => toggleDetails('objective')} className="expand-btn">
                          View Supporting Data
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transition: 'transform 0.2s', transform: showDetails.objective ? 'rotate(180deg)' : 'none' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        {showDetails.objective && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {objective_response_classification.supporting_data_points.map((point, idx) => (
                              <div key={idx} style={S.drow}>
                                <span style={{ color: '#888', fontSize: 11 }}>{formatDate(point.date) || point.date}</span>
                                <span style={{ color: '#000', fontSize: 11, fontWeight: 400 }}>{point.lab_value || point.value || 'Normal'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Longitudinal Trend */}
              {longitudinal_trend_analysis.trend_pattern && (
                <div style={S.card}>
                  <div style={S.cardHead}>
                    <span style={S.cardTitle}>Longitudinal Trend</span>
                    {longitudinal_trend_analysis.depth_assessment && (
                      <span className="meta-chip">{longitudinal_trend_analysis.depth_assessment.replace(/_/g, ' ')}</span>
                    )}
                  </div>
                  <div style={S.cardBody}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                      <div style={S.ibox}>
                        <span style={S.sectionLabel}>PATTERN</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
                          {getTrendIcon(longitudinal_trend_analysis.trend_pattern)}
                          <span style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>{longitudinal_trend_analysis.trend_pattern}</span>
                        </div>
                      </div>
                      <div style={S.ibox}>
                        <span style={S.sectionLabel}>SLOPE</span>
                        <span style={{ fontSize: 13, fontWeight: 400, color: '#000', marginTop: 6 }}>{longitudinal_trend_analysis.improvement_slope || 'None'}</span>
                      </div>
                    </div>
                    {longitudinal_trend_analysis.cross_workflow_response && (
                      <div style={S.ibox}>
                        <span style={S.sectionLabel}>CROSS-WORKFLOW</span>
                        <span style={{ fontSize: 12, color: '#444', marginTop: 4, fontWeight: 300 }}>{longitudinal_trend_analysis.cross_workflow_response}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Decision Support */}
              {decision_support_for_doctor.recommended_action && (
                <div style={S.card}>
                  <div style={S.cardHead}>
                    <span style={S.cardTitle}>Clinical Decision</span>
                  </div>
                  <div style={S.cardBody}>
                    <div style={{ ...S.ibox, borderColor: '#000', marginBottom: 12 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ width: 3, alignSelf: 'stretch', background: '#000', flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: '#000', marginBottom: 4, fontFamily: 'Open Sans' }}>
                            {decision_support_for_doctor.recommended_action}
                          </div>
                          {decision_support_for_doctor.clinical_reasoning && (
                            <p style={{ fontSize: 12, color: '#444', lineHeight: 1.6, fontWeight: 300 }}>{decision_support_for_doctor.clinical_reasoning}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    {decision_support_for_doctor.protocol_reference && (
                      <div style={S.drow}>
                        <span style={S.sectionLabel}>PROTOCOL</span>
                        <span className="meta-chip">{decision_support_for_doctor.protocol_reference}</span>
                      </div>
                    )}
                    {decision_support_for_doctor.non_binding_statement && (
                      <p style={{ fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0e0e0', fontWeight: 300 }}>
                        {decision_support_for_doctor.non_binding_statement}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Key Drivers + Chart ── */}
            <div style={S.grid13}>

              {/* Key Drivers */}
              <div style={S.card}>
                <div style={S.cardHead}>
                  <span style={S.cardTitle}>Key Drivers</span>
                  <span className="meta-chip">{key_drivers_of_response.length} identified</span>
                </div>
                <div style={S.cardBody}>
                  {key_drivers_of_response.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {key_drivers_of_response.map((driver, idx) => (
                        <div key={idx} style={S.driverCard}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>{driver.driver}</span>
                            <span className={`impact-pill impact-${driver.impact || 'neutral'}`}>{driver.impact || 'neutral'}</span>
                          </div>
                          {driver.description && <p style={{ fontSize: 11, color: '#444', lineHeight: 1.5, fontWeight: 300 }}>{driver.description}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 140, gap: 8 }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span style={{ fontSize: 12, color: '#888', fontWeight: 300 }}>No key drivers identified</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Trend Chart */}
              <div style={{ ...S.card, ...(expandedChart ? { position: 'fixed', inset: 16, zIndex: 50, overflow: 'auto' } : {}) }}>
                <div style={{ ...S.cardHead }}>
                  <div>
                    <span style={S.cardTitle}>Longitudinal Trends</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#888', marginTop: 2, fontWeight: 300 }}>Clinical measurements over time</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={S.toggleGroup}>
                      <button onClick={() => setChartView('line')} className={`tog${chartView === 'line' ? ' tog-on' : ''}`}>Line</button>
                      <button onClick={() => setChartView('bar')} className={`tog${chartView === 'bar' ? ' tog-on' : ''}`}>Bar</button>
                    </div>
                    <select className="sel" value={selectedTimeframe} onChange={(e) => setSelectedTimeframe(e.target.value)}>
                      <option value="3months">Last 3 months</option>
                      <option value="6months">Last 6 months</option>
                      <option value="1year">Last year</option>
                      <option value="all">All time</option>
                    </select>
                    <button onClick={() => setExpandedChart(!expandedChart)} className="icon-btn" title={expandedChart ? 'Collapse' : 'Expand'}>
                      {expandedChart ? '↙' : '↗'}
                    </button>
                  </div>
                </div>
                <div style={{ padding: '14px 18px' }}>
                  <div style={S.chartArea}>
                    {labs.length > 0 ? (
                      <div style={{ position: 'relative', height: '100%' }}>
                        {[0, 25, 50, 75, 100].map(p => (
                          <div key={p} style={{ position: 'absolute', bottom: `${p}%`, left: 0, right: 0, borderTop: '1px solid #f0f0f0', pointerEvents: 'none' }}>
                            <span style={{ position: 'absolute', left: 4, top: -9, fontSize: 9, color: '#aaa', letterSpacing: '0.05em' }}>{p}%</span>
                          </div>
                        ))}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around' }}>
                          {labs.map((lab, idx) => {
                            let value = 0;
                            if (typeof lab.value === 'number') value = lab.value;
                            else if (typeof lab.lab_value === 'number') value = lab.lab_value;
                            else if (!isNaN(Number(lab.lab_value))) value = Number(lab.lab_value);
                            else value = 1;
                            const height = Math.max((value / maxValue) * 100, 4);
                            return (
                              <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 52 }}>
                                <div className="bar-wrap">
                                  <div className="bar" style={{ width: 28, height: `${Math.min(height, 100)}px`, minHeight: 4 }}>
                                    <div className="bar-tip">{value}{lab.unit ? ` ${lab.unit}` : ''}</div>
                                  </div>
                                </div>
                                <span style={{ fontSize: 9, color: '#888', textAlign: 'center', lineHeight: 1.3 }}>
                                  {formatDate(lab.date)?.split(' ').slice(0, 2).join(' ') || lab.date}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#888', fontSize: 13, fontWeight: 300 }}>
                        No lab data available
                      </div>
                    )}
                  </div>
                  {labs.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, marginTop: 12, background: '#e0e0e0', border: '1px solid #e0e0e0' }}>
                      {[
                        ['LATEST VALUE', `${labs[labs.length - 1]?.value || labs[labs.length - 1]?.lab_value || 'N/A'}${labs[labs.length - 1]?.unit ? ' ' + labs[labs.length - 1].unit : ''}`],
                        ['AVERAGE', finalAverage],
                        ['TREND', longitudinal_trend_analysis.trend_pattern || 'Stable'],
                      ].map(([lbl, val]) => (
                        <div key={lbl} style={{ background: '#fff', padding: '8px 10px' }}>
                          <span style={S.sectionLabel}>{lbl}</span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: '#000', marginTop: 3 }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Clinical Timeline ── */}
            {(workflow_events.length > 0 || medication_changes.length > 0 || vitals.length > 0) && (
              <div style={S.card}>
                <div style={S.cardHead}>
                  <span style={S.cardTitle}>Clinical Timeline</span>
                  <button className="expand-btn">
                    View all events
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
                <div style={{ padding: '10px 18px 18px', paddingLeft: 48, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 26, top: 18, bottom: 18, width: 1, background: '#e0e0e0' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {workflow_events.map((event, idx) => (
                      <div key={idx} style={S.tlItem}>
                        <div style={{ ...S.tlDot, left: -30 }}>
                          <div style={{ width: 8, height: 8, background: '#000' }} />
                        </div>
                        <div style={S.tlContent}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <span style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>{event.event || event.procedure || 'Clinical Event'}</span>
                              <p style={{ fontSize: 11, color: '#444', marginTop: 3, fontWeight: 300 }}>
                                {event.status && <span>Status: {event.status}</span>}
                                {event.outcome && <span style={{ marginLeft: 10 }}>Outcome: {event.outcome}</span>}
                              </p>
                            </div>
                            <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', marginLeft: 10, letterSpacing: '0.05em' }}>{formatDate(event.date) || event.date}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {medication_changes.map((med, idx) => (
                      <div key={idx} style={S.tlItem}>
                        <div style={{ ...S.tlDot, left: -30 }}>
                          <div style={{ width: 8, height: 8, background: '#fff', border: '1px solid #000' }} />
                        </div>
                        <div style={S.tlContent}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <span style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>{med.medication || 'Medication'}</span>
                              <p style={{ fontSize: 11, color: '#444', marginTop: 3, fontWeight: 300 }}>
                                {med.change && <span>{med.change}</span>}
                                {med.dose && <span style={{ marginLeft: 10 }}>Dose: {med.dose}</span>}
                              </p>
                            </div>
                            <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', marginLeft: 10, letterSpacing: '0.05em' }}>{formatDate(med.date) || med.date}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {vitals.map((vital, idx) => (
                      <div key={idx} style={S.tlItem}>
                        <div style={{ ...S.tlDot, left: -30 }}>
                          <div style={{ width: 8, height: 8, background: '#888' }} />
                        </div>
                        <div style={S.tlContent}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <span style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>Vitals Assessment</span>
                              <p style={{ fontSize: 11, color: '#444', marginTop: 3, fontWeight: 300 }}>
                                {[vital.bp && `BP ${vital.bp}`, vital.hr && `HR ${vital.hr}`, vital.temp && `T ${vital.temp}°F`, vital.spo2 && `SpO₂ ${vital.spo2}%`].filter(Boolean).join('  ·  ')}
                              </p>
                            </div>
                            <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', marginLeft: 10, letterSpacing: '0.05em' }}>{formatDate(vital.date) || vital.date}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Insurance ── */}
            {insurance_and_compliance_insight.insurance_summary && (
              <div style={S.card}>
                <div style={S.cardHead}>
                  <span style={S.cardTitle}>Compliance &amp; Coverage</span>
                  {insurance_and_compliance_insight.continuation_justification_strength && (
                    <span className={`just-pill just-${insurance_and_compliance_insight.continuation_justification_strength?.toLowerCase()}`}>
                      {insurance_and_compliance_insight.continuation_justification_strength} Justification
                    </span>
                  )}
                </div>
                <div style={S.cardBody}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 24, alignItems: 'start' }}>
                    <div>
                      <p style={{ fontSize: 13, color: '#444', lineHeight: 1.7, marginBottom: 14, fontWeight: 300 }}>{insurance_and_compliance_insight.insurance_summary}</p>
                      {insurance_and_compliance_insight.risk_flags?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <span style={S.sectionLabel}>RISK FACTORS</span>
                          {insurance_and_compliance_insight.risk_flags.map((flag, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: '#fafafa', border: '1px solid #e0e0e0', borderLeft: '2px solid #000' }}>
                              <span style={{ fontSize: 12, color: '#000', fontWeight: 300 }}>{flag}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#fafafa', border: '1px solid #e0e0e0' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          <span style={{ fontSize: 12, color: '#000', fontWeight: 300 }}>No compliance risks identified</span>
                        </div>
                      )}
                    </div>
                    <div style={{ background: '#e0e0e0', height: '100%' }} />
                    <div>
                      <div style={S.drow}>
                        <span style={S.sectionLabel}>DOCUMENTATION GAPS</span>
                        <span style={{ fontSize: 24, fontWeight: 300, color: '#000', letterSpacing: '-0.04em' }}>{insurance_and_compliance_insight.documentation_gaps?.length || 0}</span>
                      </div>
                      {insurance_and_compliance_insight.documentation_gaps?.length > 0 && (
                        <ul style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {insurance_and_compliance_insight.documentation_gaps.map((gap, idx) => (
                            <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: '#fafafa', border: '1px solid #e0e0e0' }}>
                              <span style={{ fontSize: 12, color: '#444', fontWeight: 300 }}>{gap}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════ TRENDS ══════════════════════════════════════════════ */}
        {activeTab === 'trends' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={S.card}>
              <div style={S.cardHead}>
                <span style={S.cardTitle}>Comprehensive Trend Analysis</span>
              </div>
              <div style={{ ...S.cardBody, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#e0e0e0' }}>

                {/* Lab Trends */}
                <div style={{ background: '#fff', padding: '14px' }}>
                  <span style={{ ...S.cardTitle, display: 'block', marginBottom: 12 }}>Laboratory Trends</span>
                  {labs.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {labs.map((lab, idx) => {
                        let value = 0;
                        if (typeof lab.value === 'number') value = lab.value;
                        else if (typeof lab.lab_value === 'number') value = lab.lab_value;
                        else if (!isNaN(Number(lab.lab_value))) value = Number(lab.lab_value);
                        else value = 1;
                        const pct = Math.min((value / 5) * 100, 100);
                        return (
                          <div key={idx}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 10, color: '#888', letterSpacing: '0.05em' }}>{formatDate(lab.date) || lab.date}</span>
                              <span style={{ fontSize: 10, fontWeight: 400, color: '#000' }}>{value}</span>
                            </div>
                            <div style={{ height: 3, background: '#f0f0f0', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: '#000', transition: 'width 0.6s ease' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p style={{ fontSize: 12, color: '#888', fontWeight: 300 }}>No laboratory data available</p>}
                </div>

                {/* Vital Signs */}
                <div style={{ background: '#fff', padding: '14px' }}>
                  <span style={{ ...S.cardTitle, display: 'block', marginBottom: 12 }}>Vital Signs</span>
                  {vitals.length > 0 ? (
                    vitals.map((vital, idx) => (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {vital.hr && <div style={S.drow}><span style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>Heart Rate</span><span style={{ fontSize: 11, fontWeight: 400, color: '#000' }}>{vital.hr} bpm</span></div>}
                        {vital.bp && <div style={S.drow}><span style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>Blood Pressure</span><span style={{ fontSize: 11, fontWeight: 400, color: '#000' }}>{vital.bp}</span></div>}
                        {vital.temp && <div style={S.drow}><span style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>Temperature</span><span style={{ fontSize: 11, fontWeight: 400, color: '#000' }}>{vital.temp}°F</span></div>}
                        {vital.spo2 && <div style={S.drow}><span style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>SpO₂</span><span style={{ fontSize: 11, fontWeight: 400, color: '#000' }}>{vital.spo2}%</span></div>}
                      </div>
                    ))
                  ) : <p style={{ fontSize: 12, color: '#888', fontWeight: 300 }}>No vital signs available</p>}
                </div>

                {/* Adherence */}
                <div style={{ background: '#fff', padding: '14px' }}>
                  <span style={{ ...S.cardTitle, display: 'block', marginBottom: 12 }}>Treatment Adherence</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={S.ibox}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={S.sectionLabel}>SCHEDULED</span>
                        <span style={{ fontSize: 22, fontWeight: 300, color: '#000', letterSpacing: '-0.04em' }}>{workflow_events.length || 0}</span>
                      </div>
                      <div style={{ height: 2, background: '#e0e0e0' }}>
                        <div style={{ height: '100%', width: '100%', background: '#000' }} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ ...S.ibox, textAlign: 'center' }}>
                        <span style={S.sectionLabel}>COMPLETED</span>
                        <span style={{ fontSize: 20, fontWeight: 300, color: '#000', letterSpacing: '-0.04em', marginTop: 5, display: 'block' }}>
                          {workflow_events.filter(e => e.status?.toLowerCase() === 'completed').length || 0}
                        </span>
                        <span style={{ fontSize: 10, color: '#888', letterSpacing: '0.05em' }}>
                          {workflow_events.length > 0 ? Math.round((workflow_events.filter(e => e.status?.toLowerCase() === 'completed').length / workflow_events.length) * 100) : 0}%
                        </span>
                      </div>
                      <div style={{ ...S.ibox, textAlign: 'center' }}>
                        <span style={S.sectionLabel}>MISSED</span>
                        <span style={{ fontSize: 20, fontWeight: 300, color: '#000', letterSpacing: '-0.04em', marginTop: 5, display: 'block' }}>
                          {workflow_events.filter(e => ['missed', 'delayed'].includes(e.status?.toLowerCase())).length || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ PROTOCOL ════════════════════════════════════════════ */}
        {activeTab === 'protocol' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={S.card}>
              <div style={S.cardHead}>
                <span style={S.cardTitle}>Protocol Alignment</span>
                {explainability_and_audit_trail.protocol_used && (
                  <span className="meta-chip">{explainability_and_audit_trail.protocol_used}</span>
                )}
              </div>
              <div style={S.cardBody}>
                {explainability_and_audit_trail.protocol_used === 'insufficient_data' ? (
                  <div style={{ ...S.alertBox, borderLeft: '2px solid #000', marginBottom: 16 }}>
                    <div>
                      <p style={{ fontWeight: 400, color: '#000', fontSize: 12, marginBottom: 4 }}>Protocol Reference Insufficient</p>
                      <p style={{ color: '#444', fontSize: 11, lineHeight: 1.6, fontWeight: 300 }}>No structured protocol documentation was available in the clinical context. Protocol alignment validation could not be performed.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ ...S.alertBox, borderLeft: '2px solid #000', marginBottom: 16 }}>
                    <div>
                      <p style={{ fontWeight: 400, color: '#000', fontSize: 12, marginBottom: 4 }}>Protocol Reference Available</p>
                      <p style={{ color: '#444', fontSize: 11, fontWeight: 300 }}>Protocol: {explainability_and_audit_trail.protocol_used}</p>
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#e0e0e0', border: '1px solid #e0e0e0' }}>
                  {[['Expected Response Timeline', 'Unable to validate — protocol reference missing', 'Protocol validation in progress'],
                    ['Assessment Checkpoints', 'Unable to validate — protocol reference missing', 'Protocol validation in progress']].map(([title, insuf, avail]) => (
                    <div key={title} style={{ background: '#fff', padding: '12px' }}>
                      <span style={{ fontSize: 12, fontWeight: 400, color: '#000', display: 'block', marginBottom: 6 }}>{title}</span>
                      <p style={{ fontSize: 11, color: '#444', lineHeight: 1.6, fontWeight: 300 }}>
                        {explainability_and_audit_trail.protocol_used === 'insufficient_data' ? insuf : avail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ AUDIT ═══════════════════════════════════════════════ */}
        {activeTab === 'audit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={S.card}>
              <div style={S.cardHead}>
                <span style={S.cardTitle}>Clinical Audit Trail</span>
              </div>
              <div style={S.cardBody}>

                {explainability_and_audit_trail?.ai_inference_logic_summary && (
                  <div style={{ ...S.ibox, marginBottom: 16, borderColor: '#000' }}>
                    <span style={{ ...S.sectionLabel, marginBottom: 8, display: 'block' }}>AI INFERENCE LOGIC</span>
                    <p style={{ fontSize: 12, color: '#444', lineHeight: 1.7, fontWeight: 300 }}>
                      {explainability_and_audit_trail.ai_inference_logic_summary}
                    </p>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#e0e0e0', border: '1px solid #e0e0e0', marginBottom: 1 }}>
                  <div style={{ background: '#fff', padding: '12px' }}>
                    <span style={{ ...S.sectionLabel, display: 'block', marginBottom: 10 }}>DATA POINTS CONSIDERED</span>
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {explainability_and_audit_trail?.data_points_considered?.map((point, idx) => (
                        <li key={idx} style={S.checkRow}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}>
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          {typeof point === 'object' ? (
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>{point.dimension}</div>
                              <div style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>{point.data_point}</div>
                              <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.05em' }}>Confidence: {point.confidence}</div>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#444', fontWeight: 300 }}>{point}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {explainability_and_audit_trail?.audit_log_flags &&
                  typeof explainability_and_audit_trail.audit_log_flags === 'object' &&
                  !Array.isArray(explainability_and_audit_trail.audit_log_flags) && (
                    <div style={{ background: '#fff', padding: '12px' }}>
                      <span style={{ ...S.sectionLabel, display: 'block', marginBottom: 10 }}>AUDIT FLAGS</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {[
                          ['Clinical Review Required',  explainability_and_audit_trail?.audit_log_flags?.clinical_review_required],
                          ['Insurance Review Required', explainability_and_audit_trail?.audit_log_flags?.insurance_review_flag],
                          ['Legal Sensitivity',          explainability_and_audit_trail?.audit_log_flags?.legal_sensitivity_flag],
                        ].map(([lbl, active]) => (
                          <div key={lbl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#fafafa', border: '1px solid #e0e0e0' }}>
                            <span style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>{lbl}</span>
                            <span style={{
                              fontSize: 9, fontWeight: 400,
                              color: active ? '#000' : '#888',
                              background: active ? '#f0f0f0' : '#fafafa',
                              border: '1px solid #e0e0e0',
                              padding: '2px 7px',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}>
                              {active ? 'YES' : 'CLEAR'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#e0e0e0', border: '1px solid #e0e0e0' }}>
                  {explainability_and_audit_trail?.protocol_used && (
                    <div style={{ background: '#fff', padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={S.sectionLabel}>PROTOCOL REFERENCE</span>
                        <span className="meta-chip">{explainability_and_audit_trail.protocol_used}</span>
                      </div>
                      {explainability_and_audit_trail.protocol_used === 'insufficient_data' && (
                        <p style={{ fontSize: 11, color: '#888', lineHeight: 1.6, fontWeight: 300 }}>Protocol reference was not available in the structured clinical context.</p>
                      )}
                    </div>
                  )}

                  <div style={{ background: '#fff', padding: '12px' }}>
                    <span style={{ ...S.sectionLabel, display: 'block', marginBottom: 8 }}>PHYSICIAN INPUT</span>
                    {explainability_and_audit_trail?.doctor_input_used?.length > 0 ? (
                      explainability_and_audit_trail.doctor_input_used.map((input, idx) => (
                        <div key={idx} style={{ ...S.checkRow, marginBottom: 6 }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                          {typeof input === 'object' && input !== null ? (
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 400, color: '#000' }}>{input.dimension || 'Clinical Dimension'}</div>
                              <div style={{ fontSize: 11, color: '#444', fontWeight: 300 }}>{input.data_point || ''}</div>
                              {input.confidence && <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.05em' }}>Confidence: {input.confidence}</div>}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#444', fontWeight: 300 }}>{input}</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: 12, color: '#888', fontWeight: 300 }}>No physician input used for this analysis</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

/* ─── Style tokens ─────────────────────────────────────────────────────── */
const S = {
  page:        { background: '#fafafa', minHeight: '100vh', fontFamily: "'Open Sans', sans-serif", color: '#000', fontWeight: 300 },
  center:      { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 8 },
  header:      { background: '#fff', borderBottom: '1px solid #000', position: 'sticky', top: 0, zIndex: 50 },
  headerInner: { padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 16, fontWeight: 400, color: '#000', letterSpacing: '-0.02em', fontFamily: "'Open Sans', sans-serif" },
  chip:        { fontSize: 10, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: "'Open Sans', sans-serif" },
  logoBox:     { width: 14, height: 14, background: '#000', flexShrink: 0 },
  tabBar:      { display: 'flex', padding: '0 24px', borderTop: '1px solid #e0e0e0' },
  main:        { padding: '20px 24px', maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 },
  heroCard:    { position: 'relative', border: '1px solid', padding: '20px 24px', background: '#fff' },
  heroGlyph:   { width: 56, height: 56, border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: '#fafafa' },
  grid3:       { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#e0e0e0', border: '1px solid #e0e0e0' },
  grid13:      { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 1, background: '#e0e0e0', border: '1px solid #e0e0e0' },
  card:        { background: '#fff', border: '1px solid #e0e0e0', overflow: 'hidden' },
  cardHead:    { padding: '12px 16px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:   { fontSize: 12, fontWeight: 400, color: '#000', letterSpacing: '0.01em', fontFamily: "'Open Sans', sans-serif" },
  cardBody:    { padding: '12px 16px' },
  ibox:        { background: '#fafafa', border: '1px solid #e0e0e0', padding: '9px 11px', display: 'flex', flexDirection: 'column' },
  drow:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f5f5f5' },
  checkRow:    { display: 'flex', alignItems: 'flex-start', gap: 6, listStyle: 'none' },
  sectionLabel:{ fontSize: 9, color: '#888', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: "'Open Sans', sans-serif", fontWeight: 400 },
  driverCard:  { background: '#fafafa', border: '1px solid #e0e0e0', padding: '9px 11px' },
  tlItem:      { display: 'flex', alignItems: 'flex-start', gap: 10, position: 'relative' },
  tlDot:       { width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, position: 'absolute' },
  tlContent:   { flex: 1, background: '#fafafa', border: '1px solid #e0e0e0', padding: '8px 12px' },
  alertBox:    { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid #e0e0e0', background: '#fafafa' },
  chartArea:   { height: 190, background: '#fafafa', border: '1px solid #e0e0e0', padding: '10px', position: 'relative', overflow: 'hidden' },
  toggleGroup: { display: 'flex', border: '1px solid #e0e0e0', background: '#fafafa' },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #fafafa; }
  ::-webkit-scrollbar-thumb { background: #ccc; }

  .tab-btn {
    display: flex; flex-direction: column; align-items: flex-start;
    padding: 11px 16px; background: none; border: none;
    border-bottom: 2px solid transparent; cursor: pointer;
    color: #888; font-family: 'Open Sans', sans-serif; font-weight: 300;
    transition: color 0.15s, border-color 0.15s;
    min-width: 110px; margin-bottom: -1px; gap: 2px;
  }
  .tab-btn:hover { color: #000; }
  .tab-active { color: #000 !important; border-bottom-color: #000 !important; }
  .tab-label { font-size: 12px; font-weight: 400; }
  .tab-sub   { font-size: 10px; opacity: 0.6; letter-spacing: 0.05em; }

  .icon-btn {
    background: #fafafa; border: 1px solid #e0e0e0; color: #888;
    width: 28px; height: 28px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; transition: all 0.15s; font-family: 'Open Sans', sans-serif;
  }
  .icon-btn:hover { color: #000; border-color: #000; }

  .btn-primary {
    background: #000; border: 1px solid #000; color: #fff;
    padding: 9px 20px; font-family: 'Open Sans', sans-serif;
    font-size: 13px; font-weight: 400; cursor: pointer; transition: all 0.2s;
  }
  .btn-primary:hover { background: transparent; color: #000; }

  .expand-btn {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; color: #000; background: none; border: none;
    cursor: pointer; font-family: 'Open Sans', sans-serif;
    font-weight: 400; letter-spacing: 0.05em; text-transform: uppercase;
    padding: 4px 0; transition: opacity 0.15s;
  }
  .expand-btn:hover { opacity: 0.6; }

  .conf-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px; font-size: 9px; font-weight: 400;
    font-family: 'Open Sans', sans-serif; letter-spacing: 0.1em;
    text-transform: uppercase; border: 1px solid #e0e0e0;
  }
  .badge-dot  { width: 5px; height: 5px; flex-shrink: 0; }
  .badge-high { background: #fafafa; color: #000; border-color: #000; }
  .badge-high .badge-dot { background: #000; }
  .badge-med  { background: #fafafa; color: #444; border-color: #ccc; }
  .badge-med  .badge-dot { background: #444; }
  .badge-low  { background: #fafafa; color: #888; border-color: #ccc; }
  .badge-low  .badge-dot { background: #888; }
  .badge-neutral { background: #fafafa; color: #888; border-color: #e0e0e0; }
  .badge-neutral .badge-dot { background: #ccc; }

  .meta-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #fafafa; border: 1px solid #e0e0e0; color: #444;
    font-size: 9px; font-family: 'Open Sans', sans-serif;
    padding: 2px 7px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase;
  }

  .status-pill {
    font-size: 10px; font-weight: 400; padding: 2px 8px;
    font-family: 'Open Sans', sans-serif; letter-spacing: 0.08em;
    text-transform: uppercase; border: 1px solid #000; color: #000; background: #fff;
  }
  .status-danger { border-color: #000; background: #000; color: #fff; }
  .status-warn   { border-color: #444; color: #444; background: #fff; }
  .status-stable { border-color: #888; color: #888; background: #fff; }

  .impact-pill {
    font-size: 9px; font-weight: 400; padding: 1px 6px;
    font-family: 'Open Sans', sans-serif; letter-spacing: 0.08em;
    text-transform: uppercase; flex-shrink: 0; border: 1px solid #e0e0e0;
  }
  .impact-positive { border-color: #000; color: #000; }
  .impact-negative { border-color: #000; color: #000; background: #000; color: #fff; }
  .impact-neutral  { border-color: #ccc; color: #888; }

  .just-pill   { font-size: 9px; font-weight: 400; padding: 2px 8px;
    font-family: 'Open Sans', sans-serif; letter-spacing: 0.08em;
    text-transform: uppercase; border: 1px solid #e0e0e0; }
  .just-strong   { border-color: #000; color: #000; }
  .just-moderate { border-color: #444; color: #444; }
  .just-weak     { border-color: #888; color: #888; }

  .tog {
    background: none; border: none; cursor: pointer; color: #888;
    padding: 4px 10px; font-size: 10px; font-family: 'Open Sans', sans-serif;
    font-weight: 400; letter-spacing: 0.05em; text-transform: uppercase;
    transition: all 0.15s;
  }
  .tog:hover { color: #000; }
  .tog-on { background: #000; color: #fff; }

  .sel {
    font-size: 10px; font-family: 'Open Sans', sans-serif;
    background: #fff; border: 1px solid #e0e0e0; color: #444;
    padding: 4px 8px; cursor: pointer; outline: none;
    letter-spacing: 0.05em; text-transform: uppercase; font-weight: 400;
  }
  .sel:focus { border-color: #000; }
  .sel:hover { border-color: #000; }

  .bar-wrap { position: relative; }
  .bar {
    background: #000;
    cursor: pointer; transition: opacity 0.15s; position: relative;
  }
  .bar:hover { opacity: 0.6; }
  .bar-tip {
    position: absolute; bottom: calc(100% + 5px); left: 50%;
    transform: translateX(-50%); background: #000; color: #fff;
    padding: 2px 6px; font-size: 9px; font-family: 'Open Sans', sans-serif;
    letter-spacing: 0.05em; white-space: nowrap; pointer-events: none;
    opacity: 0; transition: opacity 0.15s; z-index: 10;
  }
  .bar-wrap:hover .bar-tip { opacity: 1; }

  .spin-ring {
    width: 32px; height: 32px; border: 2px solid #e0e0e0;
    border-top-color: #000; border-radius: 50%;
    animation: trd-spin 0.9s linear infinite; margin-bottom: 12px;
  }
  @keyframes trd-spin { to { transform: rotate(360deg); } }
`;

export default TreatmentResponseDashboard;