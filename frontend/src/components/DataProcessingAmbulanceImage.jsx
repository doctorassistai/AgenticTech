import React, { useRef, useState } from 'react';

const API_BASE = 'https://doctorassist.ai/api';

const fmt = (v) => v || 'N/A';

const Spinner = ({ size = 22, color = '#000' }) => (
  <div style={{
    width: size, height: size,
    border: `2px solid ${color}22`,
    borderTop: `2px solid ${color}`,
    borderRadius: '50%',
    animation: 'spin .7s linear infinite',
    flexShrink: 0,
  }} />
);

const fmtTimestamp = (iso) => {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return iso; }
};

const RISK_COLORS = {
  LOW:      { bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a' },
  MODERATE: { bg: '#fffbeb', border: '#fde68a', color: '#d97706' },
  HIGH:     { bg: '#fff7ed', border: '#fed7aa', color: '#ea580c' },
  CRITICAL: { bg: '#fef2f2', border: '#fecaca', color: '#dc2626' },
  UNKNOWN:  { bg: '#f5f5f5', border: '#e0e0e0', color: '#666' },
};

// ── Section wrapper ────────────────────────────────────────────────────────────
const Section = ({ title, children, isEditing }) => (
  <div style={{
    border: isEditing ? '2px solid #000' : '1px solid #eee',
    borderRadius: 8, marginBottom: 24, overflow: 'hidden',
    transition: 'border 0.2s',
  }}>
    <div style={{
      padding: '13px 20px', background: '#fafafa',
      borderBottom: '1px solid #eee',
      fontSize: 11, fontWeight: 700, letterSpacing: '1.2px',
      textTransform: 'uppercase', color: '#444',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {title}
    </div>
    <div style={{ padding: 24 }}>{children}</div>
  </div>
);

// ── Editable field ─────────────────────────────────────────────────────────────
const Field = ({ label, value, isEditing, onChange, multiline = false, rows = 3 }) => {
  if (!isEditing && (!value || value.trim() === '' || value === 'N/A')) return null;
  return (
    <div style={{ marginBottom: label ? 20 : 0 }}>
      {label && (
        <div style={{
          fontSize: 11, color: '#999', marginBottom: 6, fontWeight: 700,
          letterSpacing: '1px', textTransform: 'uppercase',
          fontFamily: "'DM Sans', sans-serif",
        }}>{label}</div>
      )}
      {isEditing ? (
        multiline
          ? <textarea
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              rows={rows}
              style={{
                fontSize: 14, lineHeight: 1.8, width: '100%',
                border: '1.5px solid #ddd', padding: '10px 12px',
                borderRadius: 6, fontFamily: "'DM Sans', sans-serif",
                boxSizing: 'border-box', resize: 'vertical',
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#000'}
              onBlur={e => e.target.style.borderColor = '#ddd'}
            />
          : <input
              type="text"
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              style={{
                fontSize: 15, fontWeight: 600, width: '100%',
                border: '1.5px solid #ddd', padding: '8px 10px',
                borderRadius: 6, fontFamily: "'DM Sans', sans-serif",
                boxSizing: 'border-box', outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = '#000'}
              onBlur={e => e.target.style.borderColor = '#ddd'}
            />
      ) : (
        <div style={{
          fontSize: 14, lineHeight: 1.85, whiteSpace: 'pre-wrap',
          color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif",
        }}>{value}</div>
      )}
    </div>
  );
};

// ── Bullet list renderer ───────────────────────────────────────────────────────
const BulletList = ({ text, isEditing, onChange, rows = 6 }) => {
  if (!isEditing && (!text || text.trim() === '')) return null;
  if (isEditing) {
    return (
      <textarea
        value={text || ''}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{
          fontSize: 14, lineHeight: 1.8, width: '100%',
          border: '1.5px solid #ddd', padding: '10px 12px',
          borderRadius: 6, fontFamily: "'DM Sans', sans-serif",
          boxSizing: 'border-box', resize: 'vertical',
          outline: 'none', transition: 'border-color 0.2s',
        }}
        onFocus={e => e.target.style.borderColor = '#000'}
        onBlur={e => e.target.style.borderColor = '#ddd'}
      />
    );
  }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return (
    <ul style={{ margin: 0, padding: '0 0 0 18px', fontFamily: "'DM Sans', sans-serif" }}>
      {lines.map((line, i) => (
        <li key={i} style={{ fontSize: 14, lineHeight: 1.85, color: '#1a1a1a', marginBottom: 4 }}>
          {line.replace(/^[-•*]\s*/, '')}
        </li>
      ))}
    </ul>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const DataProcessingAmbulanceImage = ({ processingData, onApprove, onNotApprove }) => {
  const {
    patientData,
    selectedImage,
    voiceText: incomingVoice = '',
    aiResult,
    processingId,
  } = processingData || {};

  // ── Editable fields state ──
  const [fields, setFields] = useState({
    impressive_findings: aiResult?.impressive_findings || '',
    comorbidities:       aiResult?.comorbidities       || '',
    trend_analysis:      aiResult?.trend_analysis      || '',
    clinical_impression: aiResult?.clinical_impression || '',
    risk_level:          aiResult?.risk_level          || 'UNKNOWN',
    emt_actions:         aiResult?.emt_actions         || '',
    physician_alert:     aiResult?.physician_alert     || '',
  });
  const [savedFields, setSavedFields] = useState({ ...fields });
  const [isEditing, setIsEditing]     = useState(false);

  // ── Approval state ──
  // NOTE: derive the initial status from data the parent/backend already gave
  // us, so a reopened / "history" view of an already-approved record doesn't
  // start blank and show the action buttons again.
  // I'm checking a few likely field names below (aiResult.approval_status,
  // aiResult.status, processingData.approval_status, processingData.status,
  // or a boolean .approved flag). CONFIRM the actual field your backend
  // returns and trim this down once known — right now it's a best guess.
  const deriveInitialApprovalStatus = () => {
    const raw =
      aiResult?.approval_status ??
      aiResult?.status ??
      processingData?.approval_status ??
      processingData?.status ??
      (aiResult?.approved === true ? 'approved' : undefined) ??
      (processingData?.approved === true ? 'approved' : undefined);
    if (!raw) return null;
    const normalized = String(raw).toLowerCase();
    if (normalized === 'approved') return 'approved';
    if (normalized === 'not_approved' || normalized === 'not approved' || normalized === 'rejected') return 'not_approved';
    return null;
  };

  const [approveLoading, setApproveLoading] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState(deriveInitialApprovalStatus());

  // ── Voice section (Not Approve) ──
  const [showVoiceSection, setShowVoiceSection]     = useState(false);
  const [dictationText, setDictationText]           = useState(incomingVoice || '');
  const [isRecording, setIsRecording]               = useState(false);
  const [transcribeLoading, setTranscribeLoading]   = useState(false);
  const [voiceSubmitLoading, setVoiceSubmitLoading] = useState(false);
  const [voiceSubmitted, setVoiceSubmitted]         = useState(false);

  const voiceSectionRef  = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);

  const setField = (key, val) => setFields(prev => ({ ...prev, [key]: val }));

  const vitalsTimeline = aiResult?.vitals_timeline || [];
  const trends         = aiResult?.trends          || [];
  const riskKey        = (fields.risk_level || 'UNKNOWN').toUpperCase();
  const riskColors     = RISK_COLORS[riskKey] || RISK_COLORS.UNKNOWN;

  // ── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    try {
      setApproveLoading(true);
      const doctorId = localStorage.getItem('doctor_id') || '';
      const res = await fetch(
        `${API_BASE}/hms/users/ai-legacy/extraction-ambulance-emt/ambulance/image/approve-processing/${patientData?.patient_id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id:    patientData?.patient_id,
            doctor_id:     doctorId,
            processing_id: processingId || '',
          }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setApprovalStatus('approved');
      if (onApprove) onApprove();
    } catch (err) {
      alert('Failed to approve AI analysis: ' + err.message);
    } finally {
      setApproveLoading(false);
    }
  };

  // ── Not Approve → scroll to voice section in PARENT ───────────────────────
  const handleNotApprove = () => {
    setApprovalStatus('not_approved');
    setShowVoiceSection(true);
    // onNotApprove scrolls the parent's voiceSectionRef
    if (onNotApprove) onNotApprove();
    // also scroll to local voice section as fallback
    setTimeout(() => {
      voiceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  // ── Microphone ─────────────────────────────────────────────────────────────
  const transcribeAudio = async (file) => {
    try {
      setTranscribeLoading(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language_code', 'eng');
      const res = await fetch(
        `${API_BASE}/hms/users/ai/elevenlabs/api/transcribe_labs`,
        { method: 'POST', body: formData }
      );
      const result = await res.json();
      if (result.text) setDictationText(prev => prev ? `${prev} ${result.text}` : result.text);
    } catch { alert('Failed to transcribe audio'); }
    finally { setTranscribeLoading(false); }
  };

  const handleMic = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(new File([blob], 'voice.webm', { type: 'audio/webm' }));
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
    } catch { alert('Microphone permission denied'); }
  };

  // ── Submit voice ───────────────────────────────────────────────────────────
  const handleVoiceSubmit = async () => {
    if (!dictationText.trim()) { alert('Please enter or record a voice suggestion.'); return; }
    setVoiceSubmitLoading(true);
    try {
      const doctorId = localStorage.getItem('doctor_id') || '';
      await fetch(`${API_BASE}/hms/users/ambulance/ambulance/doctor-suggestion/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id:      patientData?.patient_id,
          doctor_id:       doctorId,
          suggestion_text: dictationText,
        }),
      });
      setVoiceSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { alert('Failed to submit voice suggestion'); }
    finally { setVoiceSubmitLoading(false); }
  };

  // If this record was rejected — either just now (session) or on reopen
  // (persisted, via deriveInitialApprovalStatus) — the whole panel disappears.
  // The doctor's dictation/suggestion still lives in the parent's Voice Notes
  // section, so nothing is lost by hiding this view.
  if (approvalStatus === 'not_approved') {
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(.88)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{ background: '#fff', fontFamily: "'DM Sans', sans-serif", color: '#111' }}>

        {/* ══ HEADER ══ */}
        <div style={{
          padding: '24px 36px',
          borderBottom: '1px solid #eee',
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: '#aaa', marginBottom: 6, textTransform: 'uppercase' }}>
              Ambulance · Clinical Photography · AI Processing
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 300, letterSpacing: '-0.5px' }}>
              Data Processing
            </h1>
            {aiResult?.timestamp_display && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                Processed: {aiResult.timestamp_display}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Approval badge */}
            {approvalStatus && (
              <div style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: approvalStatus === 'approved' ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${approvalStatus === 'approved' ? '#bbf7d0' : '#fecaca'}`,
                color: approvalStatus === 'approved' ? '#16a34a' : '#c0392b',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {approvalStatus === 'approved' ? '✅ Approved' : '❌ Not Approved'}
              </div>
            )}

            {/* Edit / Save / Cancel — hidden once approved (read-only history) */}
{approvalStatus === 'approved' ? null : !isEditing ? (
  <button
    onClick={() => setIsEditing(true)}
    style={{
      border: '1px solid #ddd', background: '#fff',
      padding: '9px 18px', cursor: 'pointer', borderRadius: 6,
      fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
      display: 'flex', alignItems: 'center', gap: 6,
      transition: 'background 0.15s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
  >
    <span style={{ fontSize: 14 }}>✏️</span> Edit All
  </button>
) : (
  <>
    <button
      onClick={() => { setSavedFields({ ...fields }); setIsEditing(false); }}
      style={{
        border: '1px solid #000', background: '#000', color: '#fff',
        padding: '9px 18px', cursor: 'pointer', borderRadius: 6,
        fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
        display: 'flex', alignItems: 'center', gap: 6,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#222'; }}
      onMouseLeave={e => { e.currentTarget.style.background = '#000'; e.currentTarget.style.borderColor = '#000'; }}
    >
      <span style={{ fontSize: 14 }}>💾</span> Save All
    </button>
                   <button
                  onClick={() => { setFields({ ...savedFields }); setIsEditing(false); }}
                  style={{
                    border: '1px solid #ddd', background: '#fff', color: '#000',
                    padding: '9px 18px', cursor: 'pointer', borderRadius: 6,
                    fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.color = '#000'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
                >
                  <span style={{ fontSize: 14 }}>✖️</span> Cancel
                </button>
  </>
)}
          </div>
        </div>

        {/* ══ CONTENT ══ */}
        <div style={{ padding: '32px 36px', maxWidth: 1200, margin: '0 auto' }}>

          {/* Patient + Image row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: selectedImage ? '260px 1fr' : '1fr',
            gap: 20, marginBottom: 28,
          }}>
            {selectedImage && (
              <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                <img
                  src={selectedImage.image_url}
                  alt="Clinical"
                  style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
                />
                <div style={{ padding: '12px 14px', background: '#fafafa' }}>
                  <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>Selected Image</div>
                  <div style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>{fmtTimestamp(selectedImage.timestamp_iso)}</div>
                  {selectedImage.driver_name && (
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>👤 {selectedImage.driver_name}</div>
                  )}
                </div>
              </div>
            )}

            <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{
                background: '#fafafa', padding: '13px 20px', borderBottom: '1px solid #eee',
                fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase',
                fontFamily: "'DM Sans', sans-serif",
              }}>Patient Information</div>
              <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                {[
                  ['Patient Name', patientData?.fullName],
                  ['Patient ID',   patientData?.patient_id],
                  ['Age / Gender', patientData?.age ? `${patientData.age} / ${patientData.gender || 'N/A'}` : null],
                ].filter(([, v]) => v).map(([label, val]) => (
                  <div key={label}>
                    <div style={{ color: '#aaa', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
                {aiResult?.total_images_used !== undefined && (
                  <div>
                    <div style={{ color: '#aaa', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Images Used</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{aiResult.total_images_used}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* No data guard */}
          {!aiResult && (
            <div style={{ border: '1px solid #fecaca', background: '#fef2f2', padding: 28, borderRadius: 8, color: '#c00' }}>
              No AI analysis data available.
            </div>
          )}

          {aiResult && (
            <>
              {/* Approval banner */}
              {approvalStatus && (
                <div style={{
                  marginBottom: 24, padding: '14px 18px', borderRadius: 8,
                  background: approvalStatus === 'approved' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${approvalStatus === 'approved' ? '#bbf7d0' : '#fecaca'}`,
                  display: 'flex', alignItems: 'center', gap: 10,
                  animation: 'fadeIn 0.3s ease',
                }}>
                  <span style={{ fontSize: 20 }}>{approvalStatus === 'approved' ? '✅' : '❌'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: approvalStatus === 'approved' ? '#16a34a' : '#c0392b' }}>
                    {approvalStatus === 'approved'
                      ? 'AI Analysis Approved — Saved to clinical record.'
                      : 'AI Analysis Not Approved — Please provide voice instructions in the Voice Notes section above.'}
                  </span>
                </div>
              )}

              {/* ── RISK LEVEL BANNER ── */}
              <div style={{
                border: `2px solid ${riskColors.border}`,
                background: riskColors.bg,
                borderRadius: 10, padding: '20px 28px', marginBottom: 28,
                display: 'flex', alignItems: 'center', gap: 20,
              }}>
                <div>
                  <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 4 }}>Risk Level</div>
                  {isEditing ? (
                    <select
                      value={fields.risk_level}
                      onChange={e => setField('risk_level', e.target.value)}
                      style={{
                        fontSize: 24, fontWeight: 800, color: riskColors.color,
                        border: `1.5px solid ${riskColors.border}`, borderRadius: 6,
                        padding: '4px 10px', fontFamily: "'DM Sans', sans-serif",
                        background: riskColors.bg, cursor: 'pointer',
                      }}
                    >
                      {['LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'UNKNOWN'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: 32, fontWeight: 800, color: riskColors.color, letterSpacing: '1px' }}>
                      {fields.risk_level || 'UNKNOWN'}
                    </div>
                  )}
                </div>
                {aiResult.timestamp_display && (
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>Analysis Time</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#444' }}>{aiResult.timestamp_display}</div>
                  </div>
                )}
              </div>

              {/* ── IMPRESSIVE FINDINGS ── */}
              {(fields.impressive_findings || isEditing) && (
                <Section title="Impressive Findings" isEditing={isEditing}>
                  <BulletList
                    text={fields.impressive_findings}
                    isEditing={isEditing}
                    onChange={v => setField('impressive_findings', v)}
                    rows={7}
                  />
                </Section>
              )}

              {/* ── COMORBIDITIES ── */}
              {(fields.comorbidities || isEditing) && (
                <Section title="Comorbidities / Differential Diagnosis" isEditing={isEditing}>
                  <BulletList
                    text={fields.comorbidities}
                    isEditing={isEditing}
                    onChange={v => setField('comorbidities', v)}
                    rows={6}
                  />
                </Section>
              )}

              {/* ── TREND ANALYSIS + VITALS TABLE ── */}
              <Section title="Trend Analysis" isEditing={isEditing}>
                
                {(fields.trend_analysis || isEditing) && (
                  <Field
                    label="Analysis"
                    value={fields.trend_analysis}
                    isEditing={isEditing}
                    onChange={v => setField('trend_analysis', v)}
                    multiline
                    rows={5}
                  />
                )}

                {/* Vitals Timeline Table */}
                {vitalsTimeline.length > 0 && (
                  <div style={{ marginTop: 20, overflowX: 'auto' }}>
                    <div style={{
                      fontSize: 11, color: '#666', fontWeight: 700,
                      letterSpacing: '1px', textTransform: 'uppercase',
                      marginBottom: 10, fontFamily: "'DM Sans', sans-serif",
                    }}>Vitals Timeline</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
                      <thead>
                        <tr style={{ background: '#111', color: '#fff' }}>
                          {['Timestamp', 'SpO2', 'Heart Rate', 'RR', 'Temperature', 'BP', 'PREDICT-HF'].map(h => (
                            <th key={h} style={{
                              padding: '10px 14px', textAlign: 'left',
                              fontSize: 10, fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.8px',
                              whiteSpace: 'nowrap',
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vitalsTimeline.map((row, i) => {
                          const spo2Num = row.spo2 ? Number(row.spo2) : null;
                          const hrNum  = row.hr   ? Number(row.hr)   : null;
                          return (
                            <tr key={i} style={{
                              background: i === 0 ? '#f0fdf4' : i % 2 === 0 ? '#fafafa' : '#fff',
                              borderBottom: '1px solid #eee',
                            }}>
                              <td style={{ padding: '10px 14px', fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>
                                {row.timestamp_display || fmtTimestamp(row.timestamp_iso)}
                                {i === 0 && (
                                  <span style={{
                                    marginLeft: 6, fontSize: 9, background: '#16a34a',
                                    color: '#fff', padding: '1px 6px', borderRadius: 10,
                                    fontWeight: 700, textTransform: 'uppercase',
                                  }}>Latest</span>
                                )}
                              </td>
                              <td style={{
                                padding: '10px 14px', fontWeight: 600,
                                color: spo2Num && spo2Num < 94 ? '#dc2626' : spo2Num && spo2Num >= 98 ? '#16a34a' : '#111',
                              }}>
                                {row.spo2 ? `${row.spo2}%` : '—'}
                              </td>
                              <td style={{
                                padding: '10px 14px', fontWeight: 500,
                                color: hrNum && (hrNum > 100 || hrNum < 60) ? '#ea580c' : '#111',
                              }}>
                                {row.hr ? `${row.hr} bpm` : '—'}
                              </td>
                              <td style={{ padding: '10px 14px' }}>{row.rr ? `${row.rr}/min` : '—'}</td>
                              <td style={{ padding: '10px 14px' }}>{row.temperature ? `${row.temperature}°C` : '—'}</td>
                              <td style={{ padding: '10px 14px', fontWeight: 500 }}>{row.bp || '—'}</td>
                              <td style={{ padding: '10px 14px' }}>{row.predict_hf || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pump flows table */}
                {vitalsTimeline.some(r => r.pump1_flow || r.pump2_flow || r.pump3_flow) && (
                  <div style={{ marginTop: 20, overflowX: 'auto' }}>
                    <div style={{
                      fontSize: 11, color: '#666', fontWeight: 700,
                      letterSpacing: '1px', textTransform: 'uppercase',
                      marginBottom: 10, fontFamily: "'DM Sans', sans-serif",
                    }}>Infusion Pumps</div>
                   <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
                      <thead>
                        <tr style={{ background: '#333', color: '#fff' }}>
                          {['Timestamp', 'Pump 1 Flow', 'Pump 2 Flow', 'Pump 3 Flow', 'Pump 1 Infused', 'Pump 2 Infused', 'Pump 3 Infused'].map(h => (
                            <th key={h} style={{
                              padding: '10px 14px', textAlign: 'left',
                              fontSize: 10, fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.8px',
                              whiteSpace: 'nowrap',
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vitalsTimeline
                          .filter(r => r.pump1_flow || r.pump2_flow || r.pump3_flow || r.pump1_infused || r.pump2_infused || r.pump3_infused)
                          .map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? '#fafafa' : '#fff', borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '10px 14px', fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>
                              {row.timestamp_display || fmtTimestamp(row.timestamp_iso)}
                            </td>
                            <td style={{ padding: '10px 14px' }}>{row.pump1_flow ? `${row.pump1_flow} ml/hr` : '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{row.pump2_flow ? `${row.pump2_flow} ml/hr` : '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{row.pump3_flow ? `${row.pump3_flow} ml/hr` : '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{row.pump1_infused ? `${row.pump1_infused} ml` : '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{row.pump2_infused ? `${row.pump2_infused} ml` : '—'}</td>
                            <td style={{ padding: '10px 14px' }}>{row.pump3_infused ? `${row.pump3_infused} ml` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Trend changes */}
                {trends.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{
                      fontSize: 11, color: '#666', fontWeight: 700,
                      letterSpacing: '1px', textTransform: 'uppercase',
                      marginBottom: 10, fontFamily: "'DM Sans', sans-serif",
                    }}>Change Between Readings</div>
                    {trends.map((t, i) => (
                      <div key={i} style={{
                        border: '1px solid #eee', borderRadius: 8,
                        padding: '12px 16px', marginBottom: 10,
                        background: '#fafafa',
                      }}>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 10, fontFamily: "'DM Sans', sans-serif" }}>
                          {t.from_timestamp} → {t.to_timestamp}
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {Object.entries(t.changes || {}).map(([key, val]) => {
                            const isUp   = val.direction?.includes('↑');
                            const isDown = val.direction?.includes('↓');
                            return (
                              <div key={key} style={{
                                padding: '6px 14px', borderRadius: 20,
                                fontSize: 11, fontWeight: 600,
                                background: isUp ? '#fef2f2' : isDown ? '#f0fdf4' : '#f5f5f5',
                                color: isUp ? '#dc2626' : isDown ? '#16a34a' : '#666',
                                border: `1px solid ${isUp ? '#fecaca' : isDown ? '#bbf7d0' : '#e0e0e0'}`,
                                fontFamily: "'DM Sans', sans-serif",
                              }}>
                                {key.toUpperCase()}: {val.previous} → {val.current} {val.direction?.split(' ')[0]}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── CLINICAL IMPRESSION ── */}
              {(fields.clinical_impression || isEditing) && (
                <Section title="Clinical Impression" isEditing={isEditing}>
                  <Field
                    label=""
                    value={fields.clinical_impression}
                    isEditing={isEditing}
                    onChange={v => setField('clinical_impression', v)}
                    multiline
                    rows={5}
                  />
                </Section>
              )}

              {/* ── EMT ACTIONS ── */}
              {(fields.emt_actions || isEditing) && (
                <Section title="EMT Action Suggestions" isEditing={isEditing}>
                  <BulletList
                    text={fields.emt_actions}
                    isEditing={isEditing}
                    onChange={v => setField('emt_actions', v)}
                    rows={7}
                  />
                </Section>
              )}

              {/* ── PHYSICIAN ALERT ── */}
                           {(fields.physician_alert || isEditing) && (
                <div style={{
                  border: isEditing ? '2px solid #000' : '1.5px solid #ddd',
                  borderRadius: 8, marginBottom: 24, overflow: 'hidden',
                  background: isEditing ? '#fff' : '#fff',
                  transition: 'border 0.2s',
                }}>
                  <div style={{
                    padding: '13px 20px',
                    background: isEditing ? '#fafafa' : '#fafafa',
                    borderBottom: '1px solid #eee',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}></span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: '1.2px',
                      textTransform: 'uppercase',
                      color: '#000',
                      fontFamily: "'DM Sans', sans-serif",
                    }}>Physician Alert — Urgent</span>
                  </div>
                  <div style={{ padding: 24 }}>
                    <BulletList
                      text={fields.physician_alert}
                      isEditing={isEditing}
                      onChange={v => setField('physician_alert', v)}
                      rows={5}
                    />
                  </div>
                </div>
              )}
              {/* ── APPROVE / NOT APPROVE BUTTONS ── */}
              {/* Once approved, this record is history — the decision is made,
                  so we don't show the action buttons anymore. */}
              {approvalStatus !== 'approved' && (
                <div style={{ display: 'flex', gap: 16, marginTop: 36, flexWrap: 'wrap' }}>
                  <button
                    onClick={handleApprove}
                    disabled={approveLoading}
                    style={{
                      background: approveLoading ? '#555' : '#000',
                      color: '#fff', border: 'none',
                      padding: '15px 36px', borderRadius: 8, fontSize: 14,
                      fontWeight: 700, cursor: approveLoading ? 'not-allowed' : 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                      display: 'flex', alignItems: 'center', gap: 8, minWidth: 220,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!approveLoading) e.currentTarget.style.background = '#222'; }}
                    onMouseLeave={e => { if (!approveLoading) e.currentTarget.style.background = '#000'; }}
                  >
                    {approveLoading
                      ? <><Spinner size={14} color="#fff" /> Approving…</>
                      : '✓ Approve AI Analysis'}
                  </button>

                  <button
                    onClick={handleNotApprove}
                    disabled={voiceSubmitted}
                    style={{
                      background: '#fff', color: '#000',
                      border: '2px solid #ddd',
                      padding: '15px 32px', borderRadius: 8, fontSize: 14,
                      fontWeight: 700, cursor: voiceSubmitted ? 'not-allowed' : 'pointer',
                      fontFamily: "'DM Sans', sans-serif", minWidth: 220,
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => { if (!voiceSubmitted) { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.color = '#000'; } }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
                  >✕ Not Approve</button>
                </div>
              )}

              
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default DataProcessingAmbulanceImage;