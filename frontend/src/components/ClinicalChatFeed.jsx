import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import AiSuggestionAction from './AiSuggestionAction';
import ClinicalSuggestionCard, { cloneSuggestions } from './ClinicalSuggestionCard';

const API_BASE = 'https://doctorassist.ai/api';

// ─── Helpers ────────────────────────────────────────────────────────────────
const Spinner = ({ size = 18, color = '#000' }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid ${color}22`, borderTopColor: color,
    borderRadius: '50%', animation: 'ccf-spin .6s linear infinite', flexShrink: 0,
  }} />
);

const fmtClock = (d) => {
  try {
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return ''; }
};
const fmtFull = (d) => {
  try {
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return ''; }
};
const dayKey = (d) => {
  try { return new Date(d).toDateString(); } catch { return 'unknown'; }
};
const dayLabel = (d) => {
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 86400000).toDateString();
  const k = dayKey(d);
  if (k === today) return 'Today';
  if (k === yest) return 'Yesterday';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return k; }
};

const TRIAGE_COLOR_MAP = { Red: '#dc2626', Yellow: '#ca8a04', Green: '#16a34a', Black: '#374151' };

const doctorId = () => localStorage.getItem('doctor_id') || localStorage.getItem('zenzo_doctor_id') || '';

// Pulls every populated emt_clarifying_question out of a suggestion draft.
// Only these six sections carry the field (see backend SUGGESTION_OUTPUT_SHAPE);
// null/absent means that section's gap isn't something EMT could answer.
const collectEmtQuestions = (draft) => {
  if (!draft) return [];
  const sectionKeys = ['clinical_impression', 'triage', 'treatment_plan', 'investigations', 'procedures', 'previously_administered'];
  return sectionKeys
    .map((k) => draft[k]?.emt_clarifying_question)
    .filter((q) => typeof q === 'string' && q.trim())
    .map((q) => q.trim());
};

const Bubble = ({ align = 'left', tone = 'default', maxWidth, width, children }) => {
  const palette = {
    default: { bg: '#fff', text: '#1a1a1a', border: '#e5e5e5' },
    dark:    { bg: '#111', text: '#fff',    border: '#111' },
    system:  { bg: '#f4f1ea', text: '#3d3830', border: '#e8e2d4' },
    accent:  { bg: '#f5f0ff', text: '#2e1065', border: '#e0d4fb' },
  }[tone];

  return (
    <div style={{
      display: 'flex',
      justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
      marginBottom: 10, padding: '0 4px',
    }}>
      <div style={{
        width: width || undefined,
        maxWidth: maxWidth || (align === 'center' ? '86%' : '76%'),
        minWidth: 90,
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderRadius: 14,
        borderTopLeftRadius: align === 'left' ? 4 : 14,
        borderTopRightRadius: align === 'right' ? 4 : 14,
        padding: '9px 13px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        fontSize: 13, lineHeight: 1.55, wordBreak: 'break-word',
      }}>
        {children}
      </div>
    </div>
  );
};

const BubbleMeta = ({ label, time, color }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', color: color || 'inherit', opacity: 0.85 }}>
      {label}
    </span>
    <span style={{ fontSize: 10, opacity: 0.5 }}>{time}</span>
  </div>
);

// ─── Simple fullscreen image viewer ───────────────────────────────────────────
const Lightbox = ({ src, onClose }) => (
  <div onClick={onClose} style={{
    position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  }}>
    <img src={src} alt="Clinical" style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 6 }} />
    <button onClick={onClose} style={{
      position: 'absolute', top: 20, right: 20, width: 36, height: 36, borderRadius: '50%',
      background: '#fff', border: 'none', fontSize: 16, cursor: 'pointer',
    }}>✕</button>
  </div>
);

// ─── AI Approved bubble (expandable) ──────────────────────────────────────────
const ApprovedBubble = ({ action, time }) => {
  const [open, setOpen] = useState(false);
  const ai = action.ai_suggestion || {};
  const drugs = (ai.treatment_plan?.items || []).map(i => i.drug_or_treatment).filter(Boolean);
  const preview = drugs.length ? `Approved: ${drugs.join(', ')}` : (ai.sbar_summary?.text || ai.clinical_impression?.impression || 'AI suggestion approved');

  return (
    <Bubble align="center" tone="accent">
      <BubbleMeta label="AI Approved" time={time} color="#7c3aed" />
      {ai.triage?.colour && (
        <span style={{
          display: 'inline-block', fontSize: 10, fontWeight: 700, color: '#fff',
          background: TRIAGE_COLOR_MAP[ai.triage.colour] || '#555',
          padding: '2px 8px', borderRadius: 3, marginBottom: 6, textTransform: 'uppercase',
        }}>{ai.triage.colour}</span>
      )}
      <div>{preview}</div>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{
          marginTop: 6, background: 'none', border: 'none', padding: 0,
          fontSize: 11, fontWeight: 700, color: '#7c3aed', cursor: 'pointer', textDecoration: 'underline',
        }}>View details →</button>
      ) : (
        <div style={{ marginTop: 8, borderTop: '1px solid #e0d4fb', paddingTop: 8, fontSize: 12 }}>

          {ai.triage?.rationale && (
            <div style={{ marginBottom: 8 }}><b>Triage Rationale:</b> {ai.triage.rationale}</div>
          )}
          {ai.triage?.safety_net_breaches?.length > 0 && (
            <div style={{ marginBottom: 8, padding: 8, background: '#fee2e2', borderRadius: 6, border: '1px solid #fca5a5' }}>
              <b style={{ color: '#991b1b' }}>⚠ Safety Net Triggered:</b>
              {ai.triage.safety_net_breaches.map((b, i) => <div key={i} style={{ color: '#991b1b', marginTop: 3 }}>{b}</div>)}
            </div>
          )}

          {ai.clinical_impression?.impression && (
            <div style={{ marginBottom: 8 }}>
              <b>Impression:</b> {ai.clinical_impression.impression}
              {ai.clinical_impression.supporting_findings?.length > 0 && (
                <div style={{ marginTop: 3 }}>
                  {ai.clinical_impression.supporting_findings.map((f, i) => <div key={i} style={{ marginLeft: 8 }}>• {f}</div>)}
                </div>
              )}
              {ai.clinical_impression.differential?.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <b style={{ fontSize: 11 }}>Differential:</b>
                  {ai.clinical_impression.differential.map((d, i) => <div key={i} style={{ marginLeft: 8 }}>• {d}</div>)}
                </div>
              )}
            </div>
          )}

          {ai.sbar_summary?.text && (
            <div style={{ marginBottom: 8 }}><b>SBAR:</b> {ai.sbar_summary.text}</div>
          )}

          {ai.treatment_plan?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Treatment:</b>
              {ai.treatment_plan.items.map((it, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {it.drug_or_treatment}{it.dose ? ` · ${it.dose}` : ''}{it.reason ? ` — ${it.reason}` : ''}</div>
              ))}
            </div>
          )}

          {ai.investigations?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Investigations:</b>
              {ai.investigations.items.map((x, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {x.investigation}{x.status ? ` · ${x.status.replace(/_/g, ' ')}` : ''}{x.finding_if_completed ? ` — ${x.finding_if_completed}` : ''}</div>
              ))}
            </div>
          )}

          {ai.procedures?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Procedures:</b>
              {ai.procedures.items.map((x, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {x.procedure}{x.timing ? ` · ${x.timing.replace(/_/g, ' ')}` : ''}{x.reason ? ` — ${x.reason}` : ''}</div>
              ))}
            </div>
          )}

          {ai.referrals?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Referrals:</b>
              {ai.referrals.items.map((x, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {x.specialty}{x.reason ? ` — ${x.reason}` : ''}</div>
              ))}
            </div>
          )}

          {ai.complications?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Anticipated Complications:</b>
              {ai.complications.items.map((x, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {x.complication}{x.reason ? ` — ${x.reason}` : ''}</div>
              ))}
            </div>
          )}

          {ai.contraindications?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Contraindication Checks:</b>
              {ai.contraindications.items.map((x, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {x.treatment_or_medication} — {x.contraindication_assessment}</div>
              ))}
            </div>
          )}

          {ai.precautions?.items?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <b>Precautions:</b>
              {ai.precautions.items.map((x, i) => (
                <div key={i} style={{ marginLeft: 8 }}>• {x.precaution}{x.reason ? ` — ${x.reason}` : ''}</div>
              ))}
            </div>
          )}

          <button onClick={() => setOpen(false)} style={{
            background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 700,
            color: '#7c3aed', cursor: 'pointer', textDecoration: 'underline',
          }}>Show less</button>
        </div>
      )}
    </Bubble>
  );
};

// ─── AI Suggestion draft bubble — editable, with Approve / Discard ───────────
// Renders the same shape as an approved clinical_action.ai_suggestion, using
// ClinicalSuggestionCard for per-line editing. Approve saves through the
// same clinical-action/save endpoint DataProcessing.jsx uses, so once
// approved it becomes a real AI-approved action on the next refresh and
// this draft bubble removes itself (onResolved) to avoid a duplicate.
const AiSuggestionDraftBubble = ({ item, time, patientId, incidentCompleted, onResolved, onApproved, onAskEmt }) => {
  const [draft, setDraft] = useState(() => cloneSuggestions(item.suggestions) || {});
  const [approving, setApproving] = useState(false);
  const [resolved, setResolved] = useState(null); // 'approved' | 'discarded' | null

  // Recomputed from the current (possibly doctor-edited) draft on every
  // render — if the doctor blanks out a question by editing that section,
  // it naturally drops off the list.
  const emtQuestions = useMemo(() => collectEmtQuestions(draft), [draft]);

  const updateItem = (sectionKey, index, field, value) => {
    setDraft(prev => {
      if (!prev?.[sectionKey] || !Array.isArray(prev[sectionKey].items)) return prev;
      const items = prev[sectionKey].items.map((it, i) => (i === index ? { ...it, [field]: value } : it));
      return { ...prev, [sectionKey]: { ...prev[sectionKey], items } };
    });
  };
  const updateSbar = (value) => setDraft(prev => ({ ...prev, sbar_summary: { ...(prev.sbar_summary || {}), text: value, data_available: true } }));
  const updateTriage = (value) => setDraft(prev => ({ ...prev, triage: { ...(prev.triage || {}), rationale: value } }));
  // Colour is a separate control from rationale text — kept as its own
  // updater so ClinicalSuggestionCard can render a Red/Yellow/Green/Black
  // select without clobbering the rationale field on every keystroke.
  const updateTriageColour = (colour) => setDraft(prev => ({
    ...prev,
    triage: { ...(prev.triage || {}), colour, data_available: true },
  }));

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId, ai_suggestion: draft, voice_dictation: null,
          action_type: 'approved', created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          detail = body?.detail || JSON.stringify(body);
        } catch {
          try { detail = await res.text(); } catch {}
        }
        throw new Error(detail);
      }
      setResolved('approved');
      onApproved?.(); // triggers a refetch so the real ai_approved bubble appears
      setTimeout(() => onResolved?.(item.id), 900); // brief confirmation, then drop the draft
    } catch (e) {
      console.error('Approve failed:', e);
      alert(`Failed to approve suggestion: ${e.message}`);
    } finally {
      setApproving(false);
    }
  };

  const handleDiscard = () => {
    setResolved('discarded');
    setTimeout(() => onResolved?.(item.id), 600);
  };

  if (resolved === 'approved') {
    return (
      <Bubble align="center" tone="accent">
        <BubbleMeta label="AI Suggestion" time={time} color="#7c3aed" />
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>✓ Approved & sent to EMT</div>
      </Bubble>
    );
  }
  if (resolved === 'discarded') {
    return (
      <Bubble align="center" tone="system">
        <BubbleMeta label="AI Suggestion" time={time} color="#92400e" />
        <div style={{ fontSize: 12.5 }}>Discarded — nothing was sent.</div>
      </Bubble>
    );
  }

  return (
    <Bubble align="center" tone="accent">
      <BubbleMeta label="AI Suggestion · Draft" time={time} color="#7c3aed" />
      <div style={{ fontSize: 10.5, color: '#6d28d9', marginBottom: 10 }}>
        Click any line to edit before approving.
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
        <ClinicalSuggestionCard
          draft={draft}
          onUpdateItem={updateItem}
          onUpdateSbar={updateSbar}
          onUpdateTriage={updateTriage}
          onUpdateTriageColour={updateTriageColour}
          editable={!incidentCompleted}
          sufficientData={item.sufficientData}
          missingInformation={item.missingInformation}
        />
      </div>
      {emtQuestions.length > 0 && (
        <button
          onClick={() => onAskEmt?.(emtQuestions.map(q => `• ${q}`).join('\n'))}
          disabled={incidentCompleted}
          style={{
            marginTop: 10, width: '100%', background: '#fff', color: '#7c3aed',
            border: '1px solid #7c3aed', padding: '8px 14px', borderRadius: 6,
            fontSize: 11.5, fontWeight: 700,
            cursor: incidentCompleted ? 'not-allowed' : 'pointer',
            opacity: incidentCompleted ? 0.5 : 1,
          }}
        >
          ❓ Ask EMT for missing info ({emtQuestions.length})
        </button>
      )}
      {item.sufficientData && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={handleApprove} disabled={approving || incidentCompleted} style={{
            background: incidentCompleted ? '#999' : '#111', color: '#fff', border: 'none',
            padding: '9px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: (approving || incidentCompleted) ? 'not-allowed' : 'pointer',
          }}>{approving ? 'Approving…' : '✓ Approve & Send to EMT'}</button>
          <button onClick={handleDiscard} disabled={approving || incidentCompleted} style={{
            background: '#fff', color: '#111', border: '1px solid #111',
            padding: '9px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: (approving || incidentCompleted) ? 'not-allowed' : 'pointer',
          }}>✕ Discard</button>
        </div>
      )}
      {!item.sufficientData && (
        <button onClick={handleDiscard} style={{
          marginTop: 10, background: '#fff', color: '#111', border: '1px solid #111',
          padding: '9px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>Dismiss</button>
      )}
    </Bubble>
  );
};

// ─── Image bubble w/ inline extraction ────────────────────────────────────────
const IMAGE_TYPE_COLORS = {
  rpm_monitor:      '#0ea5e9',
  ecg_strip:        '#0ea5e9',
  vitals_screen:    '#0ea5e9',
  fall:             '#dc2626',
  burn:             '#ea580c',
  wound_laceration: '#dc2626',
  trauma_fracture:  '#dc2626',
  medication_label: '#7c3aed',
  id_insurance:     '#6b7280',
  scene_accident:   '#6b7280',
  other:            '#6b7280',
};

const ImageBubble = ({ img, time, patientId, incidentCompleted, onExtract, extracting, onOpen }) => (
  <Bubble align="left" tone="default">
    <BubbleMeta label={img.driver_name || 'Emergency Crew'} time={time} color="#6b7280" />
    {img.image_type_label && (
      <span style={{
        display: 'inline-block', fontSize: 9.5, fontWeight: 700, color: '#fff',
        background: IMAGE_TYPE_COLORS[img.image_type] || '#6b7280',
        padding: '2px 8px', borderRadius: 3, marginBottom: 8,
        textTransform: 'uppercase', letterSpacing: '0.4px',
      }}>{img.image_type_label}</span>
    )}
    <img
      src={img.image_url}
      alt="Clinical"
      onClick={() => onOpen(img.image_url)}
      style={{ width: '100%', maxWidth: 220, borderRadius: 8, display: 'block', cursor: 'pointer', marginBottom: 8 }}
    />
    <button
      onClick={() => onExtract(img)}
      disabled={extracting || incidentCompleted}
      style={{
        fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 20,
        border: '1px solid #111', background: extracting ? '#eee' : '#fff', color: '#111',
        cursor: (extracting || incidentCompleted) ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, opacity: incidentCompleted ? 0.5 : 1,
      }}
    >
      {extracting ? <><Spinner size={12} /> Extracting…</> : 'Extract from image'}
    </button>
  </Bubble>
);
const ExtractionEditorBubble = ({ draft, onChange, onSave, onCancel, saving }) => {
  const textareaRef = useRef(null);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Grow to fit whenever the draft text changes (initial load, extraction result, etc.)
  useEffect(() => { resize(); }, [draft.text]);

  return (
        <Bubble align="left" tone="system" width="96%" maxWidth="96%">
      <BubbleMeta label="Extraction Draft" time="Review & edit" color="#92400e" />
      <textarea
        ref={textareaRef}
        value={draft.text}
        onChange={(e) => onChange(e.target.value)}
        onInput={resize}
        rows={6}
        style={{
          width: '100%', fontSize: 12.5, lineHeight: 1.6, color: '#1a1a1a',
          border: '1px solid #d8cfba', borderRadius: 6, padding: '8px 10px',
          resize: 'none', outline: 'none', fontFamily: "'DM Sans', sans-serif",
          background: '#fffdf8', boxSizing: 'border-box',
          overflow: 'hidden', maxHeight: '60vh', overflowY: 'auto',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onSave} disabled={saving} style={{
          background: '#111', color: '#fff', border: 'none', padding: '7px 16px',
          borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
        }}>{saving ? 'Saving…' : 'Save to Chart'}</button>
        <button onClick={onCancel} disabled={saving} style={{
          background: '#fff', color: '#666', border: '1px solid #ddd', padding: '7px 16px',
          borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>Cancel</button>
      </div>
    </Bubble>
  );
};
// ─── Composer ──────────────────────────────────────────────────────────────────
// mode/text are now controlled from ClinicalChatFeed so AI Suggestion
// Draft bubbles can push an "ask EMT" question straight into the Voice
// Note textarea (see handleAskEmt) without a new bubble type or endpoint.
const Composer = ({ patientId, incidentCompleted, onSent, onAiPosted, mode, setMode, text, setText }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sending, setSending] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);
  const textareaRef      = useRef(null);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Grow to fit whenever the text changes (typing, transcription, or
  // an "Ask EMT" question getting appended from a suggestion draft).
  useEffect(() => { resizeTextarea(); }, [text]);

  const transcribe = async (file) => {
    try {
      setTranscribing(true);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('language_code', 'eng');
      const res = await fetch(`${API_BASE}/hms/users/ai/elevenlabs/api/transcribe_labs`, { method: 'POST', body: fd });
      const result = await res.json();
      if (result.text) setText(prev => prev ? `${prev} ${result.text}` : result.text);
    } catch (e) { console.error(e); }
    finally { setTranscribing(false); }
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
        await transcribe(new File([blob], 'note.webm', { type: 'audio/webm' }));
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
    } catch (e) { alert('Microphone permission denied'); }
  };

  const handleSend = async () => {
    if (!text.trim() || sending || incidentCompleted) return;
    setSending(true);
    try {
      if (mode === 'voice') {
        await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/save`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: patientId, ai_suggestion: null, voice_dictation: text,
            action_type: 'not_approved', created_at: new Date().toISOString(),
          }),
        });
      }
      setText('');
      onSent?.(mode);
    } catch (e) {
      console.error(e);
      alert('Failed to send.');
    } finally {
      setSending(false);
    }
  };
  const modeLabels = {
    voice: { placeholder: 'Type or record a voice note to send to EMT…', sendLabel: 'Send to EMT' },
  };

  return (
    <div style={{ borderTop: '1px solid #e5e5e5', background: '#fff', padding: '14px 14px 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          ['voice', 'Voice Note'],
          ['ai_suggestion', 'AI Suggestion'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{
            fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 20,
            border: mode === id ? '1px solid #111' : '1px solid #e0e0e0',
            background: mode === id ? '#111' : '#fff',
            color: mode === id ? '#fff' : '#555', cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      {mode === 'ai_suggestion' ? (
        <AiSuggestionAction patientId={patientId} incidentCompleted={incidentCompleted} onPosted={onAiPosted} />
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onInput={resizeTextarea}
            placeholder={modeLabels[mode].placeholder}
            rows={1}
            style={{
              flex: 1, fontSize: 13, lineHeight: 1.5, padding: '10px 12px',
              border: '1px solid #e0e0e0', borderRadius: 10, resize: 'none',
              outline: 'none', fontFamily: "'DM Sans', sans-serif",
              minHeight: 42, maxHeight: '40vh', overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleMic}
            disabled={transcribing || incidentCompleted}
            title={isRecording ? 'Stop recording' : 'Record voice'}
            style={{
              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
              border: isRecording ? 'none' : '1.5px solid #111',
              background: isRecording ? '#dc2626' : '#fff',
              cursor: (transcribing || incidentCompleted) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: isRecording ? 'ccf-pulse 1.4s infinite' : 'none',
            }}
          >
            {transcribing ? <Spinner size={16} /> : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isRecording ? '#fff' : '#111'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || incidentCompleted || !text.trim()}
            style={{
              height: 42, padding: '0 18px', borderRadius: 10, flexShrink: 0,
              background: incidentCompleted ? '#999' : '#111', color: '#fff', border: 'none',
              fontSize: 13, fontWeight: 700,
              cursor: (sending || incidentCompleted || !text.trim()) ? 'not-allowed' : 'pointer',
              opacity: (sending || incidentCompleted || !text.trim()) ? 0.6 : 1,
            }}
          >{sending ? '…' : modeLabels[mode].sendLabel}</button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const ClinicalChatFeed = ({ patientId, patientName, incidentCompleted = false, wsEvent }) => {
    const [notes, setNotes]                 = useState([]);
  const [doctorNotes, setDoctorNotes]     = useState([]);
  const [clinicalActions, setClinicalActions] = useState([]);
  const [images, setImages]               = useState([]);
  const [extractedNotes, setExtractedNotes] = useState([]); // { type: 'extracted_data' | 'doctor_suggestion', ... }
  const [localAiBubbles, setLocalAiBubbles] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [lightboxSrc, setLightboxSrc]     = useState(null);
  const [collapsed, setCollapsed]         = useState(false); // default: open
  const [filterType, setFilterType]       = useState('all'); // all | emt | doctor | ai | images | extracted
  const [sortOrder, setSortOrder]         = useState('asc'); // asc = oldest first (chat-style), desc = newest first
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Lifted up from Composer (see its comment) so AI-suggestion draft
  // bubbles can populate the Voice Note textarea directly.
  const [composerMode, setComposerMode] = useState('voice');
  const [composerText, setComposerText] = useState('');

  // extraction state, keyed by image_id
  const [extractingId, setExtractingId] = useState(null);
  const [drafts, setDrafts] = useState({}); // { [imageId]: { text, extracted_data, saving } }

  const bottomRef = useRef(null);

  // ── Fetchers ──
  const fetchAll = useCallback(async () => {
    if (!patientId) return;
    try {
      const [notesRes, dNotesRes, actionsRes, imagesRes, exNotesRes] = await Promise.all([
        fetch(`${API_BASE}/hms/users/data/context/voice-dictation/timestamp/${patientId}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/hms/users/data/context/doctor-voice-note-forprocessing/${patientId}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/${patientId}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/hms/users/ambulance/ambulance/image/${patientId}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/hms/users/ambulance/ambulance/image-extracted/all-notes/${patientId}`).then(r => r.json()).catch(() => null),
      ]);
      if (notesRes?.status === 'success') setNotes(notesRes.dictations || []);
      if (dNotesRes?.status === 'success') setDoctorNotes(dNotesRes.doctor_voice_notes || []);
      if (actionsRes?.status === 'success') setClinicalActions(actionsRes.actions || []);
      if (imagesRes?.status === 'success') setImages(imagesRes.images || []);
      if (exNotesRes?.status === 'success') setExtractedNotes(exNotesRes.notes || []);
    } catch (e) {
      console.error('ClinicalChatClinicalChatFeed fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live updates — replaces the old 15s poll. Any push from the parent's
  // WebSocket (notes, clinical actions, extracted data, or new images)
  // triggers a single refetch instead of running our own timer.
  useEffect(() => {
    if (!wsEvent) return;
    fetchAll();
  }, [wsEvent, fetchAll]);

  // ── Merge timeline ──
  const timeline = useMemo(() => {
    const items = [];

    (notes || []).forEach((n, i) => items.push({
      id: `emt-${i}-${n.date}-${n.time}`, type: 'emt',
      timestamp: new Date(`${n.date} ${n.time}`), text: n.conversation,
    }));

    (doctorNotes || []).forEach((n, i) => {
      let ts;
      if (n.date && n.time) { const [h, m, s] = n.time.split(':'); ts = new Date(n.date); ts.setHours(+h, +m, +(s || 0)); }
      else ts = new Date(n.timestamp);
      items.push({ id: `dnote-${i}`, type: 'doctor_note', timestamp: ts, text: n.conversation });
    });

    (clinicalActions || []).forEach((a, i) => {
      const ts = new Date(a.client_created_at);
      if (a.action_type === 'approved') {
        items.push({ id: `approved-${a._id || i}`, type: 'ai_approved', timestamp: ts, action: a });
      } else {
        items.push({
          id: `docsug-${a._id || i}`, type: 'doctor_suggestion', timestamp: ts,
          text: a.voice_dictation || a.notes || 'Clinical instruction sent to EMT',
        });
      }
    });

    (images || []).forEach((img, i) => items.push({
      id: img.image_id || `img-${i}`, type: 'emt_image', timestamp: new Date(img.timestamp_iso || 0), image: img,
    }));

    (extractedNotes || []).forEach((n, i) => {
      const ts = new Date(n.image_timestamp_iso || n.timestamp_iso || 0);
      if (n.type === 'doctor_suggestion') {
        items.push({ id: `imgsug-${i}`, type: 'doctor_suggestion', timestamp: ts, text: n.suggestion_text || 'Image suggestion' });
      } else if (n.type === 'extracted_data') {
        items.push({
          id: `extracted-${i}`, type: 'extracted_data', timestamp: ts,
          text: (n.extracted_text || '').split('\n').map(l => l.trim()).filter(Boolean).join(', '),
        });
      }
    });
    localAiBubbles.forEach(b => items.push(b));

    const FILTER_GROUPS = {
      emt: ['emt', 'emt_image'],
      doctor: ['doctor_note', 'doctor_suggestion'],
      ai: ['ai_approved', 'ai_suggestion_draft'],
      images: ['emt_image'],
      extracted: ['extracted_data'],
    };

    const filtered = filterType === 'all'
      ? items
      : items.filter(it => (FILTER_GROUPS[filterType] || []).includes(it.type));

    return filtered.sort((a, b) => sortOrder === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
  }, [notes, doctorNotes, clinicalActions, images, extractedNotes, localAiBubbles, filterType, sortOrder]);
  // ── Auto-scroll ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timeline.length, drafts]);

  // ── Extraction flow ──
  const handleExtract = async (img) => {
    if (incidentCompleted) return;
    setExtractingId(img.image_id);
    try {
      const res = await fetch(
        `${API_BASE}/hms/users/ai-legacy/extraction-ambulance-emt/ambulance/image/extract-medical-values/${patientId}`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(`Extraction failed (${res.status})`);
      const data = await res.json();
      let extraction = data?.extractions?.[0];
      if (data?.extractions?.length > 1) {
        extraction = [...data.extractions].sort((a, b) => new Date(b.timestamp_iso) - new Date(a.timestamp_iso))[0];
      }
      setDrafts(prev => ({
        ...prev,
        [img.image_id]: {
          text: extraction?.extracted_text || '',
          extracted_data: extraction?.extracted_data || null,
          saving: false,
        },
      }));
    } catch (e) {
      console.error(e);
      alert(`Extraction failed: ${e.message}`);
    } finally {
      setExtractingId(null);
    }
  };

  const handleDraftChange = (imageId, text) => {
    setDrafts(prev => ({ ...prev, [imageId]: { ...prev[imageId], text } }));
  };

  const handleDraftCancel = (imageId) => {
    setDrafts(prev => { const next = { ...prev }; delete next[imageId]; return next; });
  };

  const handleDraftSave = async (imageId) => {
    const draft = drafts[imageId];
    if (!draft) return;
    setDrafts(prev => ({ ...prev, [imageId]: { ...prev[imageId], saving: true } }));
    try {
      await fetch(`${API_BASE}/hms/users/ambulance/ambulance/image-extracted/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId(), image_id: imageId,
          extracted_text: draft.text, extracted_data: draft.extracted_data,
        }),
      });
      handleDraftCancel(imageId);
      await fetchAll();
    } catch (e) {
      console.error(e);
      alert('Failed to save extraction.');
      setDrafts(prev => ({ ...prev, [imageId]: { ...prev[imageId], saving: false } }));
    }
  };

  const handleAiPosted = (bubble) => setLocalAiBubbles(prev => [...prev, bubble]);
  const handleAiResolved = (id) => setLocalAiBubbles(prev => prev.filter(b => b.id !== id));

  // Switches the composer to Voice Note and appends the combined EMT
  // question(s) — never overwrites whatever the doctor was already typing.
  // Doctor still edits/sends manually via the existing Send to EMT flow.
  const handleAskEmt = useCallback((questionText) => {
    setComposerMode('voice');
    setComposerText(prev => {
      const existing = (prev || '').trim();
      return existing ? `${existing}\n${questionText}` : questionText;
    });
  }, []);

  // ── Render ──
  let lastDay = null;

  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column',
      minHeight: collapsed ? 60 : 300,
      maxHeight: collapsed ? 60 : 'none',
      border: '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden', background: '#faf9f6',
      transition: 'max-height 0.25s ease',
    }}>
      <style>{`
        @keyframes ccf-spin { to { transform: rotate(360deg); } }
        @keyframes ccf-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(.85)} }
      `}</style>

      {/* Header */}
      <div style={{ padding: '12px 18px', background: '#fff', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Clinical Chat · Beta</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>{patientName || 'Patient'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
          {!collapsed && (
            <>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowFilterMenu(v => !v)} style={{
                  fontSize: 11, fontWeight: 600, color: filterType !== 'all' ? '#111' : '#555',
                  background: filterType !== 'all' ? '#f0f0f0' : '#fff',
                  border: filterType !== 'all' ? '1px solid #111' : '1px solid #e0e0e0',
                  borderRadius: 20, padding: '5px 12px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  ⇅ {filterType === 'all' ? 'Filter' : {
                    emt: 'Emergency Crew', doctor: 'Doctor', ai: 'AI', images: 'Images', extracted: 'Extracted'
                  }[filterType]}
                </button>
                {showFilterMenu && (
                  <div style={{
                    position: 'absolute', top: '110%', right: 0, zIndex: 50,
                    background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.12)', minWidth: 170, overflow: 'hidden',
                  }}>
                    {[
                      ['all', 'All'],
                      ['emt', 'Emergency Crew'],
                      ['doctor', 'Doctor Notes'],
                      ['ai', 'AI Suggestions'],
                      ['images', 'Images'],
                      ['extracted', 'Extracted Data'],
                    ].map(([val, label]) => (
                      <button key={val} onClick={() => { setFilterType(val); setShowFilterMenu(false); }} style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                        background: filterType === val ? '#f4f1ea' : '#fff', border: 'none',
                        fontSize: 12.5, fontWeight: filterType === val ? 700 : 500, color: '#333', cursor: 'pointer',
                      }}>{label}</button>
                    ))}
                    <div style={{ borderTop: '1px solid #eee' }} />
                    <button onClick={() => { setSortOrder(o => o === 'asc' ? 'desc' : 'asc'); setShowFilterMenu(false); }} style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                      background: '#fff', border: 'none', fontSize: 12.5, fontWeight: 600, color: '#7c3aed', cursor: 'pointer',
                    }}>{sortOrder === 'asc' ? '↓ Sort: Newest first' : '↑ Sort: Oldest first'}</button>
                  </div>
                )}
              </div>
              <button onClick={fetchAll} style={{
                fontSize: 11, fontWeight: 600, color: '#555', background: '#fff',
                border: '1px solid #e0e0e0', borderRadius: 20, padding: '5px 12px', cursor: 'pointer',
              }}>⟳ Refresh</button>
            </>
          )}
          <button onClick={() => setCollapsed(c => !c)} style={{
            fontSize: 11, fontWeight: 600, color: '#555', background: '#fff',
            border: '1px solid #e0e0e0', borderRadius: 20, padding: '5px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            {collapsed ? '▾ Expand' : '▴ Collapse'}
          </button>
        </div>
      </div>

      {/* Thread */}
      <div style={{ display: collapsed ? 'none' : 'block', padding: '16px 14px' }}>
                {loading ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <Spinner /><span style={{ fontSize: 13, color: '#999' }}>Loading conversation…</span>
          </div>
        ) : timeline.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#aaa', padding: 40, fontSize: 13 }}>No activity yet.</div>
        ) : (
          timeline.map((item) => {
            const showDivider = dayKey(item.timestamp) !== lastDay;
            lastDay = dayKey(item.timestamp);
            const time = fmtClock(item.timestamp);

            return (
              <React.Fragment key={item.id}>
                {showDivider && (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#999', background: '#eee8db', padding: '3px 12px', borderRadius: 20 }}>
                      {dayLabel(item.timestamp)}
                    </span>
                  </div>
                )}

                {item.type === 'emt' && (
                  <Bubble align="left" tone="default">
                    <BubbleMeta label="Emergency Crew" time={time} color="#6b7280" />
                    {item.text}
                  </Bubble>
                )}

                {item.type === 'doctor_note' && (
                  <Bubble align="right" tone="dark">
                    <BubbleMeta label="Doctor Note · AI only" time={time} color="#cbd5e1" />
                    {item.text}
                  </Bubble>
                )}

                {item.type === 'doctor_suggestion' && (
                  <Bubble align="right" tone="dark">
                    <BubbleMeta label="Doctor → EMT" time={time} color="#cbd5e1" />
                    {item.text}
                  </Bubble>
                )}

                {item.type === 'extracted_data' && (
                  <Bubble align="left" tone="system">
                    <BubbleMeta label="Extracted Data" time={time} color="#92400e" />
                    {item.text || 'No content'}
                  </Bubble>
                )}

                {item.type === 'ai_approved' && <ApprovedBubble action={item.action} time={time} />}

                {item.type === 'ai_suggestion_draft' && (
                  <AiSuggestionDraftBubble
                    item={item} time={fmtFull(item.timestamp)} patientId={patientId}
                    incidentCompleted={incidentCompleted}
                    onResolved={handleAiResolved}
                    onApproved={fetchAll}
                    onAskEmt={handleAskEmt}
                  />
                )}

                {item.type === 'emt_image' && (
                  <>
                    <ImageBubble
                      img={item.image} time={time} patientId={patientId}
                      incidentCompleted={incidentCompleted}
                      extracting={extractingId === item.image.image_id}
                      onExtract={handleExtract}
                      onOpen={setLightboxSrc}
                    />
                    {drafts[item.image.image_id] && (
                      <ExtractionEditorBubble
                        draft={drafts[item.image.image_id]}
                        onChange={(t) => handleDraftChange(item.image.image_id, t)}
                        onSave={() => handleDraftSave(item.image.image_id)}
                        onCancel={() => handleDraftCancel(item.image.image_id)}
                        saving={!!drafts[item.image.image_id].saving}
                      />
                    )}
                  </>
                )}
              </React.Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {!collapsed && (
        <Composer
          patientId={patientId}
          incidentCompleted={incidentCompleted}
          onSent={() => fetchAll()}
          onAiPosted={handleAiPosted}
          mode={composerMode}
          setMode={setComposerMode}
          text={composerText}
          setText={setComposerText}
        />
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
};

export default ClinicalChatFeed;