import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const API_BASE = 'https://doctorassist.ai/api';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────
const fmt = (v) => (v !== null && v !== undefined && v !== '' ? v : null);
const fmtDate = (str) => {
  if (!str) return null;
  try {
    return new Date(str).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return str; }
};
const hasValue = (v) => {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
};

// ─── Spinner ──────────────────────────────────────────────────────────────────
const Spinner = ({ size = 22, color = '#000' }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid ${color}22`, borderTopColor: color,
    borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0,
  }} />
);

// ─── Badge ────────────────────────────────────────────────────────────────────
const Badge = ({ label, color = '#000', bg = '#000', text = '#fff' }) => (
  <span style={{
    display: 'inline-block', padding: '3px 10px',
    background: bg, color: text,
    fontSize: 9, fontWeight: 700, letterSpacing: '0.9px',
    textTransform: 'uppercase', borderRadius: 3, flexShrink: 0,
  }}>{label}</span>
);

// ─── Section Card ─────────────────────────────────────────────────────────────
const SectionCard = ({ title, children, accent }) => (
  <div style={{
    border: '1px solid #e8e8e8',
    borderLeft: accent ? `3px solid ${accent}` : '1px solid #e8e8e8',
    borderRadius: 4, marginBottom: 20, overflow: 'hidden',
  }}>
    <div style={{
      padding: '11px 18px', background: '#fafafa',
      borderBottom: '1px solid #e8e8e8',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#000',
        textTransform: 'uppercase', letterSpacing: '1.2px',
      }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: '#e8e8e8' }} />
    </div>
    <div style={{ padding: '10px 18px 14px' }}>{children}</div>
  </div>
);

// ─── Info Row ─────────────────────────────────────────────────────────────────
const InfoRow = ({ label, value, editMode, onChange, multiline }) => {
  if (!editMode && !hasValue(value)) return null;
  return (
    <div style={{
      display: 'flex', alignItems: editMode ? 'flex-start' : 'flex-start',
      padding: '9px 0', borderBottom: '1px solid #f5f5f5', gap: 12,
    }}>
      <span style={{
        fontSize: 11, color: '#888', width: 180, flexShrink: 0,
        paddingTop: editMode ? 7 : 1,
        textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 600,
      }}>{label}</span>
      {editMode ? (
        multiline ? (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            rows={Math.max(2, Math.ceil((value || '').length / 70))}
            style={{
              flex: 1, fontSize: 13, color: '#222', lineHeight: 1.6,
              border: '1px solid #ccc', borderRadius: 4, padding: '6px 10px',
              resize: 'vertical', fontFamily: "'DM Sans', sans-serif",
              background: '#fffef8', outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = '#000'}
            onBlur={e => e.target.style.borderColor = '#ccc'}
          />
        ) : (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            style={{
              flex: 1, fontSize: 13, color: '#222', lineHeight: 1.6,
              border: '1px solid #ccc', borderRadius: 4, padding: '6px 10px',
              fontFamily: "'DM Sans', sans-serif", background: '#fffef8', outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = '#000'}
            onBlur={e => e.target.style.borderColor = '#ccc'}
          />
        )
      ) : (
        <span style={{ fontSize: 13, color: '#333', flex: 1, lineHeight: 1.6 }}>
          {String(value)}
        </span>
      )}
    </div>
  );
};

// ─── Bullet List (editable) ───────────────────────────────────────────────────
const BulletList = ({ items, editMode, onChange, label }) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!editMode && list.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {label && (
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#aaa',
          textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6,
        }}>{label}</div>
      )}
      {editMode ? (
        <div>
          {list.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>
              <input
                type="text"
                value={item}
                onChange={e => {
                  const next = [...list];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                style={{
                  flex: 1, fontSize: 12, border: '1px solid #ccc', borderRadius: 4,
                  padding: '5px 8px', fontFamily: "'DM Sans', sans-serif",
                  background: '#fffef8', outline: 'none',
                }}
              />
              <button
                onClick={() => onChange(list.filter((_, idx) => idx !== i))}
                style={{
                  background: '#000', color: '#fff', border: 'none',
                  borderRadius: 3, cursor: 'pointer', padding: '4px 8px', fontSize: 11, flexShrink: 0,
                }}
              >×</button>
            </div>
          ))}
          <button
            onClick={() => onChange([...list, ''])}
            style={{
              marginTop: 4, background: 'none', border: '1px dashed #ccc',
              borderRadius: 3, cursor: 'pointer', padding: '4px 10px',
              fontSize: 11, color: '#666', fontFamily: "'DM Sans', sans-serif",
            }}
          >+ Add item</button>
        </div>
      ) : (
        list.map((item, i) => (
          <div key={i} style={{
            display: 'flex', gap: 8, padding: '5px 0',
            borderBottom: '1px solid #f5f5f5', alignItems: 'flex-start',
          }}>
            <span style={{ color: '#ccc', fontSize: 16, lineHeight: 1.3 }}>•</span>
            <span style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{item}</span>
          </div>
        ))
      )}
    </div>
  );
};

// ─── Triage color helper ──────────────────────────────────────────────────────
const triageBg = (colour) => {
  if (!colour) return '#555';
  const c = colour.toLowerCase();
  if (c === 'red') return '#dc2626';
  if (c === 'yellow') return '#ca8a04';
  if (c === 'green') return '#16a34a';
  if (c === 'black') return '#111';
  return '#555';
};

const riskBg = (r) => {
  if (!r) return '#555';
  const c = r.toLowerCase();
  if (c.includes('critical') || c.includes('high') || c.includes('immediately')) return '#dc2626';
  if (c.includes('moderate')) return '#ca8a04';
  if (c.includes('low')) return '#16a34a';
  return '#555';
};

// ─── Deep set helper ──────────────────────────────────────────────────────────
function deepSet(obj, pathArr, value) {
  const next = JSON.parse(JSON.stringify(obj));
  let ref = next;
  for (let i = 0; i < pathArr.length - 1; i++) {
    if (ref[pathArr[i]] === undefined || ref[pathArr[i]] === null) {
      ref[pathArr[i]] = isNaN(pathArr[i + 1]) ? {} : [];
    }
    ref = ref[pathArr[i]];
  }
  ref[pathArr[pathArr.length - 1]] = value;
  return next;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DataProcessing({ patientData: propPatientData, notes: propNotes }) {
  const location = useLocation?.() || {};
  const navigate = useNavigate?.() || (() => {});

  const patientData = propPatientData || location.state?.patientData;
  const notes = propNotes || location.state?.notes;

  const [loading, setLoading] = useState(true);
  const [isRejected, setIsRejected] = useState(false);
  const [historyChecked, setHistoryChecked] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [showFullReport, setShowFullReport] = useState(false);
  const [processingError, setProcessingError] = useState('');
  const [rawData, setRawData] = useState(null);        // original from backend
  const [editedData, setEditedData] = useState(null);  // working copy
  const [isEditing, setIsEditing] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [dictationText, setDictationText] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const hasCalledRef = useRef(false); // kept for initial auto-call only

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSuggestions();
    checkPriorDecision();
  }, []);
  const [approvedAt, setApprovedAt] = useState(null);

  const checkPriorDecision = async (reportGeneratedAt) => {
    try {
      const res = await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/${patientData?.patient_id}`);
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.actions) && data.actions.length > 0) {
        const latest = data.actions[0];
        const actionTime = new Date(latest.server_received_at || latest.client_created_at || 0).getTime();
        const reportTime = new Date(reportGeneratedAt || 0).getTime();

        // Only apply this decision if it happened AFTER this specific report was generated —
        // otherwise it's a leftover decision from a previous report cycle.
        if (reportTime && actionTime < reportTime) {
          return;
        }

        if (latest.action_type === 'approved') {
          setIsApproved(true);
          setApprovedAt(latest.server_received_at || latest.client_created_at || null);
        } else if (latest.action_type === 'not_approved') {
          setIsRejected(true);
        }
      }
    } catch (err) {
      console.error('Failed to check clinical action history', err);
    }
  };
  const fetchSuggestions = async () => {
    setLoading(true);
    setProcessingError('');
    try {
      const response = await fetch(
        `${API_BASE}/hms/users/ai-legacy/emergency/voice-suggestions/${patientData?.patient_id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientData?.patient_id, include_intermediates: false }),
        }
      );
      const data = await response.json();
      if (data.status === 'success') {
        const result = data.results?.[0] || data.result || {};
        setRawData(result);
        setEditedData(JSON.parse(JSON.stringify(result)));
        setIsApproved(false);
        setIsRejected(false);
        await checkPriorDecision(data.generated_at_ist || result?.suggestions?.generated_at_ist || result?.timestamp_ist);
      } else {
        setProcessingError(data.detail || data.message || 'No AI suggestions available.');
      }
    } catch (err) {
      setProcessingError('Failed to load AI suggestions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Edit helpers ───────────────────────────────────────────────────────────
  const update = useCallback((pathArr, value) => {
    setEditedData(prev => deepSet(prev, pathArr, value));
  }, []);

  const handleSave = async () => {
    setSaveLoading(true);
    await new Promise(r => setTimeout(r, 400));
    setRawData(JSON.parse(JSON.stringify(editedData)));
    setIsEditing(false);
    setSaveLoading(false);
  };

  const handleCancel = () => {
    setEditedData(JSON.parse(JSON.stringify(rawData)));
    setIsEditing(false);
  };

  // ── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setApproveLoading(true);
    try {
      const payload = {
        patient_id: patientData?.patient_id,
        ai_suggestion: editedData,
        voice_dictation: null,
        action_type: 'approved',
        notes: (notes || []).map(n => `Timestamp: ${n.date} ${n.time}\nVoice: ${n.conversation}`).join('\n\n'),
        created_at: new Date().toISOString(),
      };
      const response = await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed');
      setIsApproved(true);
      setApprovedAt(new Date().toISOString());
      alert('AI Suggestion Approved Successfully');
    } catch {
      alert('Failed to approve AI suggestion.');
    } finally {
      setApproveLoading(false);
    }
  };

  // ── Not Approve → scroll to voice section in parent ───────────────────────
  const handleNotApprove = async () => {
    // "Not Approved" decisions are intentionally NOT persisted to the backend —
    // this is a local-only UI state change.
    setIsRejected(true);
    setIsApproved(false);

    window.dispatchEvent(new CustomEvent('scrollToVoiceSection', { detail: { patientId: patientData?.patient_id } }));
    setTimeout(() => {
      const el = document.querySelector('[data-voice-section="true"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const headers = Array.from(document.querySelectorAll('div'));
        const found = headers.find(d => d.textContent?.trim() === 'VOICE NOTES / MANUAL INSTRUCTIONS');
        if (found) found.closest('div')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 200);
  };

  // ── Voice recording ────────────────────────────────────────────────────────
  const transcribeAudio = async (file) => {
    setTranscribeLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language_code', 'eng');
      const res = await fetch('https://doctorassist.ai/api/hms/users/ai/elevenlabs/api/transcribe_labs', { method: 'POST', body: formData });
      const result = await res.json();
      if (result.text) setDictationText(prev => prev ? `${prev} ${result.text}` : result.text);
    } catch { alert('Transcription failed.'); }
    finally { setTranscribeLoading(false); }
  };

  const toggleRecording = async () => {
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
    } catch { alert('Microphone permission denied.'); }
  };

  // ── Data shortcuts ─────────────────────────────────────────────────────────
  // NOTE: Trimmed to only what the 7 required sections need:
  //   Triage + patient condition · SBAR · treatment plan/drugs · investigations ·
  //   procedures · referral departments · complications/contraindications
  const d = editedData;
  const s = d?.suggestions || {};
  const snap = s.patient_snapshot || {};              // Triage + patient condition
  const sbar = s.sbar_summary || {};                  // SBAR summary
  const precautions = s.top_3_precautions_summary || []; // Complications/contraindications (summary)
  const alerts = s.specialist_alerts || [];            // Referral departments (A8)
  const immActions = d?.immediate_actions || {};       // Treatment plan / drugs / procedures
  const precautionsData = d?.precautions || {};        // Complications/contraindications (detailed)
  const hospitalPrep = d?.hospital_prep || {};         // Investigations + referral departments (A7)
  const dataSources = d?.data_sources || {};
  const prescribedMeds = (d?.doctor_prescribed_medications || s.doctor_prescribed_medications || []).filter(Boolean);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #fff; color: #000; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }
        @keyframes ekgDraw {
          0% { stroke-dashoffset: 460; }
          60% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -460; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        textarea, input { font-family: 'DM Sans', sans-serif; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
      `}</style>

      <div style={{
        minHeight: (!loading && d && !isRejected && (!isApproved || showFullReport)) ? '100vh' : 'auto',
        background: '#fff',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {/* ── TOP ACTION BAR ── */}
        <div style={{ padding: '28px 24px 60px', maxWidth: 1400, margin: '0 auto' }}>

          {/* ── PAGE HEADER ── */}
          <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid #e8e8e8' }}>
            <p style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6 }}>
              Emergency Voice Intelligence System · AI Processing Result
            </p>
            <h1 style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 28, fontWeight: 400, letterSpacing: '-0.5px', color: '#000',
            }}>
              {patientData?.fullName || 'Patient'} — Clinical AI Report
            </h1>
            {d && (
              <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                Generated {fmtDate(s.generated_at_ist || d.timestamp_ist)} · {dataSources.total_entries || 0} entries processed
                {dataSources.emt_voice_dictations > 0 && ` · ${dataSources.emt_voice_dictations} EMT`}
                {dataSources.doctor_voice_notes > 0 && ` · ${dataSources.doctor_voice_notes} Doctor`}
                {dataSources.image_extracted_records > 0 && ` · ${dataSources.image_extracted_records} Image`}
              </p>
            )}
          </div>

          {loading && (
            <div style={{
              padding: '70px 20px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 22, animation: 'fadeInUp .4s ease',
            }}>
              {/* EKG heartbeat line */}
              <svg width="260" height="70" viewBox="0 0 260 70" style={{ overflow: 'visible' }}>
                <polyline
                  points="0,35 65,35 80,35 90,10 100,60 110,5 120,35 135,35 260,35"
                  fill="none"
                  stroke="#000"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="460"
                  style={{ animation: 'ekgDraw 1.8s ease-in-out infinite' }}
                />
              </svg>

              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#333', fontSize: 14, fontWeight: 600 }}>Processing AI Suggestions…</p>
                <p style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>9 clinical agents are analysing patient data</p>
              </div>
            </div>
          )}
          {/* ── ERROR ── */}
          {!loading && processingError && (
            <div style={{
              border: '1px solid #fecaca', background: '#fff5f5',
              padding: 28, borderRadius: 6, color: '#dc2626',
            }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Unable to load suggestions</p>
              <p style={{ fontSize: 13 }}>{processingError}</p>
              <button
                onClick={fetchSuggestions}
                style={{
                  marginTop: 14, background: '#000', color: '#fff',
                  border: 'none', padding: '9px 18px', borderRadius: 4,
                  fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                }}
              >Retry</button>
            </div>
          )}

          {/* ── CONTENT ── */}
          {/* ── APPROVED (collapsed) ── */}
          {!loading && d && isApproved && (
            <div style={{
              border: '1px solid #bbf7d0', background: '#f0fdf4',
              padding: 20, borderRadius: 6, display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
            }}>
              <div>
                <p style={{ fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>
                  {patientData?.fullName || 'Patient'}
                </p>
                <p style={{ fontSize: 12, color: '#555' }}>
                  {approvedAt ? `Approved ${fmtDate(approvedAt)}` : 'Approved'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setShowFullReport(v => !v)}
                  style={{
                    background: '#fff', color: '#16a34a', border: '1px solid #16a34a',
                    borderRadius: 4, padding: '6px 14px', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                    letterSpacing: '0.4px', textTransform: 'uppercase',
                  }}
                >
                  {showFullReport ? 'Hide Details' : 'View Details'}
                </button>
                <Badge label="Approved" bg="#16a34a" />
              </div>
            </div>
          )}

          {/* ── NOT APPROVED ── */}
          {!loading && d && isRejected && (
            <div style={{
              border: '1px solid #fecaca', background: '#fff5f5',
              padding: 28, borderRadius: 6, color: '#dc2626',
            }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>AI Suggestion Not Approved</p>
              <p style={{ fontSize: 13 }}>This report was not approved. Add a voice note to generate a new one.</p>
            </div>
          )}

          {/* ── CONTENT ── */}
          {!loading && d && !isRejected && (!isApproved || showFullReport) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', alignItems: 'start', marginTop: isApproved ? 20 : 0 }}>
              {/* ════════════ LEFT COLUMN ════════════ */}
              <div>

                {/* ─ Patient Snapshot (Triage + Patient Condition) ─ */}
                {(hasValue(snap) || isEditing) && (
                  <SectionCard title="Triage & Patient Condition">
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 12, paddingTop: 4,
                    }}>
                      {[
                        { label: 'TRIAGE', key: 'triage_colour' },
                        { label: 'CRITICALITY', key: 'criticality_score' },
                        { label: 'OVERALL RISK', key: 'overall_risk' },
                        { label: 'CONSCIOUSNESS', key: 'consciousness' },
                      ].map(({ label, key }) => (
                        (hasValue(snap[key]) || isEditing) && (
                          <div key={key} style={{
                            border: '1px solid #eee', borderRadius: 4,
                            padding: '14px 16px',
                          }}>
                            <div style={{
                              fontSize: 9, color: '#aaa', letterSpacing: '1px',
                              textTransform: 'uppercase', fontWeight: 700, marginBottom: 8,
                            }}>{label}</div>
                            {isEditing ? (
                              <input
                                type="text"
                                value={snap[key] || ''}
                                onChange={e => update(['suggestions', 'patient_snapshot', key], e.target.value)}
                                style={{
                                  fontSize: 16, fontWeight: 700, width: '100%',
                                  border: '1px solid #ccc', borderRadius: 4, padding: '5px 8px',
                                  fontFamily: "'DM Sans', sans-serif",
                                }}
                              />
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {key === 'triage_colour' && (
                                  <span style={{
                                    display: 'inline-block', width: 12, height: 12,
                                    borderRadius: 2, background: triageBg(snap[key]), flexShrink: 0,
                                  }} />
                                )}
                                {key === 'overall_risk' ? (
                                  <span style={{
                                    display: 'inline-block', padding: '2px 10px',
                                    background: riskBg(snap[key]), color: '#fff',
                                    fontSize: 11, fontWeight: 700, borderRadius: 3,
                                  }}>{snap[key]}</span>
                                ) : (
                                  <span style={{ fontSize: 16, fontWeight: 700, color: '#000' }}>
                                    {key === 'criticality_score' ? `${snap[key]}/10` : snap[key]}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      ))}
                    </div>

                    {(hasValue(snap.age_gender) || isEditing) && (
                      <InfoRow
                        label="Age / Gender"
                        value={snap.age_gender}
                        editMode={isEditing}
                        onChange={v => update(['suggestions', 'patient_snapshot', 'age_gender'], v)}
                      />
                    )}
                    {(hasValue(snap.presenting_complaint) || isEditing) && (
                      <InfoRow
                        label="Presenting Complaint"
                        value={snap.presenting_complaint}
                        editMode={isEditing}
                        multiline
                        onChange={v => update(['suggestions', 'patient_snapshot', 'presenting_complaint'], v)}
                      />
                    )}
                    {(hasValue(snap.mechanism) || isEditing) && (
                      <InfoRow
                        label="Mechanism"
                        value={snap.mechanism}
                        editMode={isEditing}
                        multiline
                        onChange={v => update(['suggestions', 'patient_snapshot', 'mechanism'], v)}
                      />
                    )}
                    {(hasValue(snap.monitor_vitals_summary) || isEditing) && (
                      <InfoRow
                        label="Monitor Vitals"
                        value={snap.monitor_vitals_summary}
                        editMode={isEditing}
                        multiline
                        onChange={v => update(['suggestions', 'patient_snapshot', 'monitor_vitals_summary'], v)}
                      />
                    )}
                    {snap.vitals_confirmed_by_monitor !== null && snap.vitals_confirmed_by_monitor !== undefined && (
                      <InfoRow
                        label="Confirmed by Monitor"
                        value={snap.vitals_confirmed_by_monitor ? 'Yes' : 'No'}
                        editMode={false}
                        onChange={() => {}}
                      />
                    )}
                  </SectionCard>
                )}

                {/* ─ Doctor Prescribed Medications (Treatment Plan / Drugs) ─ */}
                {(prescribedMeds.length > 0 || isEditing) && (
                  <div style={{
                    border: '1px solid #e8e8e8',
                    borderLeft: '3px solid #dc2626',
                    borderRadius: 4, marginBottom: 20, padding: 20,
                    background: '#fff5f5',
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '1.2px',
                      textTransform: 'uppercase', marginBottom: 10, color: '#dc2626',
                    }}>💊 Doctor-Prescribed Medications</div>
                    {isEditing ? (
                      <BulletList
                        items={prescribedMeds}
                        editMode={isEditing}
                        onChange={v => update(['doctor_prescribed_medications'], v)}
                      />
                    ) : (
                      prescribedMeds.map((m, i) => (
                        <div key={i} style={{
                          fontSize: 13, color: '#111', padding: '6px 0',
                          borderBottom: i < prescribedMeds.length - 1 ? '1px solid #fecaca' : 'none',
                          fontWeight: 500,
                        }}>
                          💊 {m}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* ─ SBAR Summary ─ */}
                {(hasValue(sbar) || isEditing) && (
                  <SectionCard title="SBAR Summary">
                    {[
                      ['Situation', 'situation'],
                      ['Background', 'background'],
                      ['Assessment', 'assessment'],
                      ['Recommendation', 'recommendation'],
                    ].map(([label, key]) => (
                      (hasValue(sbar[key]) || isEditing) && (
                        <div key={key} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #f5f5f5' }}>
                          <div style={{
                            fontSize: 9, fontWeight: 700, color: '#aaa',
                            textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6,
                          }}>{label}</div>
                          {isEditing ? (
                            <textarea
                              value={sbar[key] || ''}
                              onChange={e => update(['suggestions', 'sbar_summary', key], e.target.value)}
                              rows={3}
                              style={{
                                width: '100%', fontSize: 13, lineHeight: 1.7,
                                border: '1px solid #ccc', borderRadius: 4,
                                padding: '6px 10px', fontFamily: "'DM Sans', sans-serif",
                                resize: 'vertical', outline: 'none', background: '#fffef8',
                              }}
                            />
                          ) : (
                            <p style={{ fontSize: 13, lineHeight: 1.75, color: '#333' }}>{sbar[key]}</p>
                          )}
                        </div>
                      )
                    ))}
                  </SectionCard>
                )}

                {/* ─ Immediate Actions (Treatment Plan / Drugs / Procedures) ─ */}
                {(hasValue(immActions) || isEditing) && (
                  <SectionCard title="Treatment Plan & Procedures">
                    {immActions.most_critical_single_action && (
                      <div style={{ padding: '10px 14px', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4, marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Most Critical</div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>{immActions.most_critical_single_action}</p>
                      </div>
                    )}
                    {(immActions.timestamp_anchored_actions || []).map((window, wi) => (
                      <div key={wi} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #f5f5f5' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <Badge label={window.time_window || ''} bg="#000" />
                          {window.label && <span style={{ fontSize: 10, color: '#888' }}>{window.label}</span>}
                        </div>
                        {(window.actions || []).map((a, ai) => (
                          <div key={ai} style={{ padding: '8px 0', borderBottom: '1px solid #fafafa' }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: '#000', marginBottom: 3 }}>• {a.action}</p>
                            {hasValue(a.why_for_this_patient) && <p style={{ fontSize: 11, color: '#888', marginLeft: 14, marginBottom: 2 }}>{a.why_for_this_patient}</p>}
                            {hasValue(a.method) && <p style={{ fontSize: 11, color: '#aaa', marginLeft: 14 }}>Method: {a.method}</p>}
                            {hasValue(a.success_indicator) && <p style={{ fontSize: 11, color: '#16a34a', marginLeft: 14 }}>✓ {a.success_indicator}</p>}
                            {hasValue(a.builds_on_prior_action) && <p style={{ fontSize: 11, color: '#1d4ed8', marginLeft: 14 }}>↑ Builds on: {a.builds_on_prior_action}</p>}
                          </div>
                        ))}
                      </div>
                    ))}
                    {immActions.oxygen_protocol && hasValue(immActions.oxygen_protocol.indicated) && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>Oxygen Protocol</div>
                        <InfoRow label="Indicated" value={immActions.oxygen_protocol.indicated !== null ? String(immActions.oxygen_protocol.indicated) : null} editMode={false} onChange={() => {}} />
                        <InfoRow label="Flow Rate" value={immActions.oxygen_protocol.flow_rate_lpm ? `${immActions.oxygen_protocol.flow_rate_lpm} L/min` : null} editMode={false} onChange={() => {}} />
                        <InfoRow label="Device" value={immActions.oxygen_protocol.delivery_device} editMode={false} onChange={() => {}} />
                        <InfoRow label="Target SpO2" value={immActions.oxygen_protocol.target_spo2} editMode={false} onChange={() => {}} />
                      </div>
                    )}
                    {immActions.fluid_resuscitation && hasValue(immActions.fluid_resuscitation.indicated) && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>Fluid Resuscitation</div>
                        <InfoRow label="Indicated" value={immActions.fluid_resuscitation.indicated !== null ? String(immActions.fluid_resuscitation.indicated) : null} editMode={false} onChange={() => {}} />
                        <InfoRow label="Type" value={immActions.fluid_resuscitation.type} editMode={false} onChange={() => {}} />
                        <InfoRow label="Rate" value={immActions.fluid_resuscitation.rate} editMode={false} onChange={() => {}} />
                      </div>
                    )}
                  </SectionCard>
                )}

                {/* ─ Specialist Alerts (Referral Departments) ─ */}
                {(alerts.filter(a => hasValue(a.specialty)).length > 0 || isEditing) && (
                  <SectionCard title="Referral Departments — Specialist Alerts">
                    {alerts.filter(a => hasValue(a.specialty)).map((alert, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 12, padding: '12px 0',
                        borderBottom: '1px solid #f5f5f5', alignItems: 'flex-start',
                      }}>
                        <div style={{
                          width: 3, flexShrink: 0, alignSelf: 'stretch',
                          background: alert.timing === 'Alert_Now' || alert.urgency === 'Immediate' ? '#dc2626' : alert.timing === 'Alert_on_Arrival' ? '#ca8a04' : '#16a34a',
                          borderRadius: 2,
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#000' }}>{alert.specialty}</span>
                            {hasValue(alert.timing) && <Badge label={alert.timing} bg={alert.timing === 'Alert_Now' ? '#dc2626' : alert.timing === 'Alert_on_Arrival' ? '#ca8a04' : '#555'} />}
                          </div>
                          {hasValue(alert.reason) && (
                            isEditing ? (
                              <textarea
                                value={alert.reason || ''}
                                onChange={e => {
                                  const next = [...alerts];
                                  next[i] = { ...next[i], reason: e.target.value };
                                  update(['suggestions', 'specialist_alerts'], next);
                                }}
                                rows={2}
                                style={{
                                  width: '100%', fontSize: 12, lineHeight: 1.6,
                                  border: '1px solid #ccc', borderRadius: 4,
                                  padding: '4px 8px', fontFamily: "'DM Sans', sans-serif",
                                  resize: 'vertical', outline: 'none', background: '#fffef8',
                                }}
                              />
                            ) : (
                              <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>{alert.reason}</p>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </SectionCard>
                )}

                {/* ─ Top 3 Precautions (Complications / Contraindications summary) ─ */}
                {(precautions.filter(Boolean).length > 0 || isEditing) && (
                  <SectionCard title="Anticipated Complications — Summary">
                    {precautions.filter(Boolean).map((p, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f5f5f5', alignItems: 'flex-start' }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: 3, background: '#000',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                        }}>{i + 1}</div>
                        {isEditing ? (
                          <input
                            type="text"
                            value={p}
                            onChange={e => {
                              const next = [...precautions];
                              next[i] = e.target.value;
                              update(['suggestions', 'top_3_precautions_summary'], next);
                            }}
                            style={{
                              flex: 1, fontSize: 13, border: '1px solid #ccc', borderRadius: 4,
                              padding: '5px 8px', fontFamily: "'DM Sans', sans-serif",
                            }}
                          />
                        ) : (
                          <p style={{ fontSize: 13, color: '#333', lineHeight: 1.6, flex: 1 }}>{p}</p>
                        )}
                      </div>
                    ))}
                  </SectionCard>
                )}

                {/* ─ Investigations & Referrals (Hospital Prep, trimmed) ─ */}
                {(hospitalPrep.imaging_to_book?.some(img => hasValue(img.imaging)) ||
                  hospitalPrep.specialist_teams_to_notify?.some(t => hasValue(t.specialty)) ||
                  isEditing) && (
                  <SectionCard title="Investigations & Referral Departments">
                    {hospitalPrep.imaging_to_book?.filter(img => hasValue(img.imaging)).length > 0 && (
                      <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #f5f5f5' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>Investigations / Imaging to Book</div>
                        {hospitalPrep.imaging_to_book.filter(img => hasValue(img.imaging)).map((img, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f5f5f5', alignItems: 'flex-start' }}>
                            <Badge label={img.priority || ''} bg={img.priority === 'Immediate' ? '#dc2626' : img.priority?.includes('5') ? '#ca8a04' : '#555'} />
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>{img.imaging}</div>
                              {hasValue(img.reason) && <p style={{ fontSize: 11, color: '#888' }}>{img.reason}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {hospitalPrep.specialist_teams_to_notify?.filter(t => hasValue(t.specialty)).length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>Referral Departments</div>
                        {hospitalPrep.specialist_teams_to_notify.filter(t => hasValue(t.specialty)).map((t, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f5f5f5', alignItems: 'flex-start' }}>
                            <Badge label={t.urgency || ''} bg={t.urgency === 'Immediate' ? '#dc2626' : t.urgency === 'Urgent' ? '#ca8a04' : '#555'} />
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>{t.specialty}</div>
                              {hasValue(t.reason) && <p style={{ fontSize: 11, color: '#888' }}>{t.reason}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                )}
              </div>

              {/* ════════════ RIGHT COLUMN ════════════ */}
              <div>

                {/* ─ Precautions (Contraindications / Anticipated Complications, detailed) ─ */}
                {(hasValue(precautionsData) || isEditing) && (
                  <SectionCard title="Contraindications & Complications — Detail" accent="#ca8a04">
                    {hasValue(precautionsData.highest_priority_precaution) && (
                      <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#ca8a04', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>⚠ Highest Priority</div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>{precautionsData.highest_priority_precaution}</p>
                      </div>
                    )}

                    {precautionsData.critical_do_not_list?.filter(item => hasValue(item.do_not)).length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>Critical DO NOT List</div>
                        {precautionsData.critical_do_not_list.filter(item => hasValue(item.do_not)).map((item, i) => (
                          <div key={i} style={{
                            marginBottom: 10, padding: '10px 12px',
                            background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 4,
                          }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                              <Badge label={item.severity || 'Risk'} bg={item.severity === 'Potentially_Fatal' ? '#dc2626' : item.severity === 'High_Risk' ? '#ca8a04' : '#555'} />
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>DO NOT: {item.do_not}</span>
                            </div>
                            {hasValue(item.applies_because) && <p style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>Because: {item.applies_because}</p>}
                            {hasValue(item.consequence_if_violated) && <p style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>If violated: {item.consequence_if_violated}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {precautionsData.medication_precautions?.filter(m => hasValue(m.drug_or_class)).length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>Medication Precautions</div>
                        {precautionsData.medication_precautions.filter(m => hasValue(m.drug_or_class)).map((m, i) => (
                          <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>{m.drug_or_class}</span>
                              {hasValue(m.precaution) && <Badge label={m.precaution} bg={m.precaution === 'avoid' ? '#dc2626' : '#ca8a04'} />}
                            </div>
                            {hasValue(m.reason) && <p style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{m.reason}</p>}
                            {hasValue(m.alternative) && <p style={{ fontSize: 11, color: '#1d4ed8' }}>Alternative: {m.alternative}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                )}
              </div>
            </div>
          )}

          {/* ── BOTTOM ACTION BAR ── */}
          {!loading && d && !isRejected && !isApproved && (
            <div style={{
              display: 'flex', gap: 14, marginTop: 40, paddingTop: 28,
              borderTop: '2px solid #e8e8e8', flexWrap: 'wrap', alignItems: 'center',
            }}>
              <button
                onClick={handleApprove}
                disabled={approveLoading}
                style={{
                  background: approveLoading ? '#555' : '#000', color: '#fff',
                  border: 'none', padding: '14px 32px', borderRadius: 4,
                  fontSize: 14, fontWeight: 600, cursor: approveLoading ? 'not-allowed' : 'pointer',
                  fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 8,
                  letterSpacing: '0.3px',
                }}
              >
                {approveLoading ? <><Spinner size={14} color="#fff" /> Approving…</> : '✓ Approve AI Suggestion'}
              </button>
              <button
                onClick={handleNotApprove}
                style={{
                  background: '#fff', color: '#000',
                  border: '1.5px solid #000', padding: '14px 28px',
                  borderRadius: 4, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
              >
                ✕ Not Approve — Add Voice Note
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}