import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StructuredNoteEmergency from '../components/StructuredNoteEmergency';
import DataProcessingInline from './DataProcessing';
import AmbulanceImagePhotography from '../components/AmbulanceImagePhotography';
import InsuranceDocumentation from './InsuranceEmergencyDocumentation';

// ─── API Constants ────────────────────────────────────────────────────────────
const API_BASE   = 'https://doctorassist.ai/api';
const ZENZO_BASE = 'https://zenzo.theapothecary.co.in:9500';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) => v || 'N/A';

const fmtDate = (str) => {
  if (!str) return 'N/A';
  try { return new Date(str).toLocaleString(); } catch { return str; }
};

const truncate = (text, max = 140) => {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max) + '…';
};
const humanizeClinicalText = (raw) => {
  if (!raw) return '';
  let text = String(raw);

  // "[TAG @ timestamp]" -> "Tag (timestamp): "
  text = text.replace(/\[([A-Z][A-Z0-9_]*)\s*@\s*([^\]]+)\]/g, (_, tag, time) => {
    const label = tag.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return `${label} (${time.trim()}): `;
  });

  // Pull "key": "value" pairs out of any {...} JSON blob into "Key: value; Key2: value2"
  text = text.replace(/\{([^{}]*)\}/g, (_, inner) => {
    const pairs = [];
    const pairRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = pairRegex.exec(inner)) !== null) {
      const key = m[1].replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      pairs.push(`${key}: ${m[2].replace(/\\"/g, '"')}`);
    }
    return pairs.length ? pairs.join('; ') : inner.replace(/"/g, '');
  });

  // Any leftover UNDERSCORE_TAGS -> Title Case With Spaces
  text = text.replace(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g, (m) =>
    m.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  );

  // Strip any remaining brackets/braces/quotes, keep the text inside
  return text
    .replace(/[\[\]{}"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*;\s*/g, '; ')
    .trim();
};
// ─── Tiny spinner ─────────────────────────────────────────────────────────────
const Spinner = ({ size = 20, color = '#000' }) => (
  <span style={{
    display: 'inline-block',
    width: size,
    height: size,
    border: `2px solid ${color}22`,
    borderTopColor: color,
    borderRadius: '50%',
    animation: 'spin .6s linear infinite',
    flexShrink: 0,
  }} />
);

// ─── Info Row ─────────────────────────────────────────────────────────────────
const InfoRow = ({ label, value }) => (
  <div style={{
    display: 'flex',
    alignItems: 'flex-start',
    padding: '11px 0',
    borderBottom: '1px solid #f0f0f0',
    gap: 12,
  }}>
    <span style={{ fontSize: 11, color: '#999', width: 130, flexShrink: 0, paddingTop: 1, textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>
      {label}
    </span>
    <span style={{ fontSize: 13, color: '#333', flex: 1, lineHeight: 1.5 }}>
      {fmt(value)}
    </span>
  </div>
);

// ─── Section Card ─────────────────────────────────────────────────────────────
const SectionCard = ({ title, children }) => (
  <div style={{ border: '1px solid #e8e8e8', borderRadius: 4, marginBottom: 20, overflow: 'hidden' }}>
    <div style={{
      padding: '12px 16px',
      background: '#fafafa',
      borderBottom: '1px solid #e8e8e8',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
        {title}
      </span>
      <span style={{ flex: 1, height: 1, background: '#e8e8e8' }} />
    </div>
    <div style={{ padding: '4px 16px 8px' }}>
      {children}
    </div>
  </div>
);

// ─── Badge ────────────────────────────────────────────────────────────────────
const Badge = ({ label, dark }) => (
  <span style={{
    display: 'inline-block',
    padding: '3px 8px',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    background: dark ? '#000' : '#f0f0f0',
    color: dark ? '#fff' : '#555',
    borderRadius: 3,
  }}>{label}</span>
);

// ─── Modal ────────────────────────────────────────────────────────────────────
const Modal = ({ visible, onClose, title, children }) => {
  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: '#fff',
        borderRadius: 6,
        width: '100%',
        maxWidth: 640,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderBottom: '1px solid #eee',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#000', letterSpacing: '0.3px' }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid #e0e0e0',
            width: 28, height: 28, cursor: 'pointer',
            fontSize: 14, color: '#666', borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
};

// ─── Modal Section ────────────────────────────────────────────────────────────
const ModalSection = ({ title, children }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
      textTransform: 'uppercase', color: '#999',
      marginBottom: 10, paddingBottom: 6,
      borderBottom: '1px solid #f0f0f0',
    }}>{title}</div>
    {children}
  </div>
);

const ModalText = ({ children, bold }) => (
  <p style={{
    fontSize: 13, color: bold ? '#000' : '#444',
    lineHeight: 1.7, marginBottom: 6,
    fontWeight: bold ? 600 : 400,
  }}>{children}</p>
);

// ─── Clinical Action Card ─────────────────────────────────────────────────────
// ─── Clinical Action Card ─────────────────────────────────────────────────────
const ClinicalCard = ({ action, onView }) => {
  const isAI = action.action_type === 'approved';
  const suggestions = action.ai_suggestion?.suggestions || {};
  const preview = isAI
    ? (suggestions.single_most_critical_action_right_now || suggestions.sbar_summary?.assessment || '')
    : (action.voice_dictation || action.notes || '');

  return (
    <div style={{
      border: '1px solid #e8e8e8',
      borderLeft: isAI ? '3px solid #000' : '3px solid #ccc',
      borderRadius: 4,
      marginBottom: 14,
      background: '#fafafa',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: '#999', flex: 1 }}>
          {fmtDate(action.client_created_at)}
        </span>
        <Badge label={isAI ? 'AI Approved' : 'Doctor Suggestion'} dark={isAI} />
      </div>

      {/* Patient Snapshot */}
      {isAI && suggestions.patient_snapshot && (
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid #f0f0f0',
          background: '#f5f5f5',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          {[
            { label: 'Triage', value: suggestions.patient_snapshot.triage_colour },
            { label: 'Criticality', value: `${suggestions.patient_snapshot.criticality_score}/10` },
            { label: 'Risk', value: suggestions.patient_snapshot.overall_risk },
            { label: 'Consciousness', value: suggestions.patient_snapshot.consciousness },
          ].filter(x => x.value).map((item, idx) => (
            <div key={idx} style={{ flex: 1, minWidth: 80 }}>
              <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#000' }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Most Critical Action */}
      {isAI && suggestions.single_most_critical_action_right_now && (
        <div style={{
          padding: '10px 14px',
          display: 'flex', gap: 8, alignItems: 'flex-start',
          borderBottom: '1px solid #f0f0f0',
          background: '#fffef8',
        }}>
          <span style={{ fontSize: 14, marginTop: 1 }}>⚠</span>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: '#aaa', marginBottom: 4, textTransform: 'uppercase' }}>
              Most Critical Action
            </div>
            <span style={{ fontSize: 12, color: '#222', lineHeight: 1.6 }}>
              {suggestions.single_most_critical_action_right_now}
            </span>
          </div>
        </div>
      )}

      {/* SBAR Summary */}
      {isAI && suggestions.sbar_summary && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: '#aaa', marginBottom: 8, textTransform: 'uppercase' }}>
            SBAR Summary
          </div>
          {[
            { label: 'Situation', value: suggestions.sbar_summary.situation },
            { label: 'Background', value: suggestions.sbar_summary.background },
            { label: 'Assessment', value: suggestions.sbar_summary.assessment },
            { label: 'Recommendation', value: suggestions.sbar_summary.recommendation },
          ].filter(x => x.value).map((item, idx) => (
            <div key={idx} style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#888' }}>{item.label}:</span>
              <span style={{ fontSize: 11, color: '#555', marginLeft: 6 }}>{truncate(item.value, 100)}</span>
            </div>
          ))}
        </div>
      )}

   
      {/* Non-AI preview */}
      {!isAI && preview && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }}>
          <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>{truncate(preview)}</p>
        </div>
      )}

      <div style={{ padding: '8px 14px' }}>
        <button onClick={() => onView(action)} style={{
          background: 'none', border: 'none', padding: 0,
          fontSize: 12, color: '#000', fontWeight: 600,
          cursor: 'pointer', textDecoration: 'underline',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          View details →
        </button>
      </div>
    </div>
  );
};
// ─── New Patient Toast (independent of selected patient) ─────────────────────
const NewPatientToast = ({ alerts, onDismiss, onView }) => {
  if (!alerts.length) return null;
  return (
    <div style={{ position: 'fixed', top: 140, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {alerts.map((p, i) => (
        <div key={p.patient_id + i} style={{
          background: '#1a1a2e', color: '#fff', padding: '14px 18px', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', gap: 12,
          width: 320, border: '1px solid #333',
        }}>
          <div style={{ fontSize: 20 }}>🆕</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>New Patient Added</div>
            <div style={{ fontSize: 12, color: '#ccc', marginBottom: 6 }}>{p.fullName} · {p.patient_id}</div>
            <button onClick={() => onView(p)} style={{
              background: '#fff', color: '#000', border: 'none', padding: '5px 12px',
              borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            }}>View →</button>
          </div>
          <button onClick={() => onDismiss(i)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, alignSelf: 'flex-start' }}>✕</button>
        </div>
      ))}
    </div>
  );
};

// ─── Patient Activity Notifier (isolated polling, top-right overlay) ─────────
const PatientActivityNotifier = ({ patientId, onViewNote, onViewImage }) => {
  const [noteAlert, setNoteAlert] = useState(null);   // { count }
  const [imageAlert, setImageAlert] = useState(null); // { count }

  const lastNoteCount = useRef(null);
  const lastImageCount = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!patientId) return;

    const poll = async () => {
      try {
        const [notesRes, imagesRes] = await Promise.all([
          fetch(`${API_BASE}/hms/users/data/context/voice-dictation/timestamp/${patientId}`).then(r => r.json()).catch(() => null),
          fetch(`${API_BASE}/hms/users/ambulance/ambulance/image/${patientId}`).then(r => r.json()).catch(() => null),
        ]);

        if (notesRes?.status === 'success') {
          const count = (notesRes.dictations || []).length;
          if (lastNoteCount.current === null) {
            lastNoteCount.current = count; // baseline, no alert on first load
          } else if (count > lastNoteCount.current) {
            const delta = count - lastNoteCount.current;
            lastNoteCount.current = count;
            setNoteAlert(prev => ({ count: (prev?.count || 0) + delta }));
          }
        }

        if (imagesRes?.status === 'success') {
          const count = imagesRes.total_images ?? (imagesRes.images || []).length;
          if (lastImageCount.current === null) {
            lastImageCount.current = count;
          } else if (count > lastImageCount.current) {
            const delta = count - lastImageCount.current;
            lastImageCount.current = count;
            setImageAlert(prev => ({ count: (prev?.count || 0) + delta }));
          }
        }
      } catch (e) {
        console.error('Activity notifier poll error:', e);
      }
    };

    poll(); // establish baseline immediately
    pollRef.current = setInterval(poll, 10000);
    return () => clearInterval(pollRef.current);
  }, [patientId]);

  if (!noteAlert && !imageAlert) return null;

  const cardStyle = {
    background: '#1a1a2e', color: '#fff',
    padding: '14px 18px', borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
    display: 'flex', alignItems: 'center', gap: 12,
    width: 320, animation: 'slideInTopRight 0.3s ease',
    border: '1px solid #333', pointerEvents: 'auto',
  };

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10,
      pointerEvents: 'none',
    }}>
      {noteAlert && (
        <div style={cardStyle}>
          <div style={{ fontSize: 20 }}>🎙️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
              {noteAlert.count > 1 ? `${noteAlert.count} New Voice Notes` : 'New Emergency Crew Voice Note'}
            </div>
            <button
              onClick={() => { onViewNote?.(); setNoteAlert(null); }}
              style={{
                background: '#fff', color: '#000', border: 'none',
                padding: '5px 12px', borderRadius: 4, fontSize: 11,
                fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}
            >Tap to View →</button>
          </div>
          <button
            onClick={() => setNoteAlert(null)}
            style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, padding: 0, alignSelf: 'flex-start' }}
          >✕</button>
        </div>
      )}
      {imageAlert && (
        <div style={cardStyle}>
          <div style={{ fontSize: 20 }}>📸</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
              {imageAlert.count > 1 ? `${imageAlert.count} New Clinical Images` : 'New Clinical Image'}
            </div>
            <button
              onClick={() => { onViewImage?.(); setImageAlert(null); }}
              style={{
                background: '#fff', color: '#000', border: 'none',
                padding: '5px 12px', borderRadius: 4, fontSize: 11,
                fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}
            >Tap to View →</button>
          </div>
          <button
            onClick={() => setImageAlert(null)}
            style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, padding: 0, alignSelf: 'flex-start' }}
          >✕</button>
        </div>
      )}
    </div>
  );
};
// ─── Patient Journey Timeline (chronological, not chat-bubble) ───────────────
// ─── Patient Journey Timeline (chronological, no chat bubbles) ───────────────
const TIMELINE_STYLES = {
  registration:      { dot: '#000',    badge: '#000',    icon: '', label: 'Patient Registered' },
emt:               { dot: '#6b7280', badge: '#555',    icon: '🚑', label: 'Emergency Crew' },
  doctor_note:       { dot: '#1d4ed8', badge: '#1d4ed8', icon: '🩺', label: 'Doctor Note' },
  doctor_suggestion: { dot: '#1d4ed8', badge: '#1d4ed8', icon: '🩺', label: 'Doctor Suggestion' },
  ai_approved:       { dot: '#000',    badge: '#000',    icon: '✓',  label: 'AI Suggestion (Approved)' },
  ai_image:          { dot: '#16a34a', badge: '#16a34a', icon: '📷', label: 'Image Analysis' },
  photo:             { dot: '#ca8a04', badge: '#ca8a04', icon: '', label: 'Clinical Photo' },
};

const TimelineImageLightbox = ({ image, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}
  >
    <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '88vh' }}>
      <img
        src={image.image_url}
        alt="Clinical"
        style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 6, display: 'block' }}
      />
      <div style={{
        background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '10px 16px',
        borderRadius: '0 0 6px 6px', fontSize: 12, display: 'flex', gap: 20, flexWrap: 'wrap',
      }}>
        {image.driver_name && <span>👤 {image.driver_name}</span>}
        <span>{image.timestamp_iso ? new Date(image.timestamp_iso).toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }) : ''}</span>
      </div>
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: -16, right: -16,
          width: 34, height: 34, borderRadius: '50%', background: '#fff',
          border: 'none', fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        }}
      >✕</button>
    </div>
  </div>
);

const TimelineEventCard = ({ event, onImageClick }) => {
  const [expanded, setExpanded] = useState(false);
  const style = TIMELINE_STYLES[event.type] || TIMELINE_STYLES.emt;
  const text = event.text || '';
  const isLong = text.length > 220;
  const displayText = expanded || !isLong ? text : text.slice(0, 220) + '…';

  return (
    <div style={{ position: 'relative', paddingLeft: 34, paddingBottom: 26 }}>
      <div style={{
        position: 'absolute', left: 0, top: 2,
        width: 14, height: 14, borderRadius: '50%',
        background: style.dot, border: '2px solid #fff',
        boxShadow: `0 0 0 2px ${style.dot}33`,
      }} />
      <div style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>{style.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.6px',
              textTransform: 'uppercase', color: style.badge,
            }}>{event.label || style.label}</span>
          </div>
          <span style={{ fontSize: 10.5, color: '#999' }}>{event.rawDate}</span>
        </div>

        {event.type === 'photo' ? (
          <div
            onClick={() => onImageClick(event.image)}
            style={{
              padding: 10, display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer',
            }}
          >
            <img
              src={event.image.image_url}
              alt="Clinical"
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee', flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#000', marginBottom: 3 }}>Clinical photo received</div>
              {event.image.driver_name && <div style={{ fontSize: 11, color: '#888' }}>From: {event.image.driver_name}</div>}
              <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 4, textDecoration: 'underline' }}>Click to view full image →</div>
            </div>
          </div>
        ) : event.summary ? (
          <div style={{ padding: '10px 12px' }}>{event.summary}</div>
        ) : (
          <div style={{ padding: '10px 12px' }}>
            <p style={{ fontSize: 12.5, color: '#333', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{displayText}</p>
            {isLong && (
              <button onClick={() => setExpanded(v => !v)} style={{
                background: 'none', border: 'none', color: '#000', fontWeight: 600,
                fontSize: 11, cursor: 'pointer', padding: '4px 0 0', textDecoration: 'underline',
                fontFamily: "'DM Sans', sans-serif",
              }}>{expanded ? 'Show less' : 'Show more →'}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const PatientJourneyTimeline = ({ patient, notes, doctorNotes, clinicalActions, extractedData }) => {
  const [images, setImages] = useState([]);
  const [lightboxImg, setLightboxImg] = useState(null);

  useEffect(() => {
    if (!patient?.patient_id) return;
    fetch(`${API_BASE}/hms/users/ambulance/ambulance/image/${patient.patient_id}`)
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setImages(d.images || []); })
      .catch(e => console.error('Timeline image fetch error:', e));
  }, [patient?.patient_id]);

  const events = [];

  // 1. Registration
  const regDateStr = patient?.accidentDetails?.accidentDate;
  const regTimeStr = patient?.accidentDetails?.accidentTime;
  const regTimestamp = regDateStr ? new Date(`${regDateStr} ${regTimeStr || '00:00'}`) : new Date(0);
  events.push({
    type: 'registration',
    timestamp: regTimestamp,
    rawDate: regTimestamp.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }),
    summary: (
      <div style={{ fontSize: 12.5, color: '#333', lineHeight: 1.8 }}>
        <b>{patient?.fullName}</b> · {patient?.age ? `${patient.age} yrs` : ''} {patient?.gender || ''}<br />
        Incident: {patient?.accidentDetails?.accidentType || 'N/A'} — {patient?.accidentDetails?.condition || 'N/A'}<br />
        Location: {patient?.accidentDetails?.location || 'N/A'}
      </div>
    ),
  });

  // 2. EMT / Paramedic voice notes
  (notes || []).forEach((n) => {
    const ts = new Date(`${n.date} ${n.time}`);
    events.push({
      type: 'emt', timestamp: ts,
      rawDate: ts.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      text: n.conversation,
    });
  });

  // 3. Doctor voice notes
  (doctorNotes || []).forEach((n) => {
    let ts;
    if (n.date && n.time) {
      const [h, m, s] = n.time.split(':');
      ts = new Date(n.date);
      ts.setHours(parseInt(h), parseInt(m), parseInt(s || '0'));
    } else {
      ts = new Date(n.timestamp);
    }
    events.push({
      type: 'doctor_note', timestamp: ts,
      rawDate: ts.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      text: n.conversation,
    });
  });

  // 4. Clinical actions — doctor suggestions vs AI approved
  (clinicalActions || []).forEach((a) => {
    const ts = new Date(a.client_created_at);
    const isAI = a.action_type === 'approved';
    events.push({
      type: isAI ? 'ai_approved' : 'doctor_suggestion', timestamp: ts,
      rawDate: ts.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      text: isAI
        ? (a.ai_suggestion?.suggestions?.single_most_critical_action_right_now || a.ai_suggestion?.suggestions?.sbar_summary?.assessment || 'AI suggestion approved')
        : (a.voice_dictation || a.notes || 'Doctor clinical note'),
    });
  });

  // 5. Image-extracted data / doctor suggestions on images
  (extractedData || []).forEach((item) => {
    const ts = item.timestamp_iso ? new Date(item.timestamp_iso) : new Date(0);
    events.push({
      type: item.type === 'doctor_suggestion' ? 'doctor_suggestion' : 'ai_image', timestamp: ts,
      rawDate: ts.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      text: item.extracted_text || item.suggestion_text || 'No content',
    });
  });

  // 6. Raw clinical photos
  (images || []).forEach((img) => {
    const ts = img.timestamp_iso ? new Date(img.timestamp_iso) : new Date(0);
    events.push({
      type: 'photo', timestamp: ts,
      rawDate: ts.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      image: img,
    });
  });

  events.sort((a, b) => a.timestamp - b.timestamp); // oldest → newest

  if (events.length <= 1) {
    return <div style={{ textAlign: 'center', color: '#aaa', padding: 40, fontSize: 13 }}>No activity recorded yet.</div>;
  }

  return (
    <div style={{ position: 'relative', paddingTop: 6 }}>
      <div style={{ position: 'absolute', left: 6, top: 8, bottom: 26, width: 2, background: '#e5e5e5' }} />
      {events.map((ev, i) => (
        <TimelineEventCard key={i} event={ev} onImageClick={setLightboxImg} />
      ))}
      {lightboxImg && (
        <TimelineImageLightbox image={lightboxImg} onClose={() => setLightboxImg(null)} />
      )}
    </div>
  );
};

// ─── Voice Dictation Card ─────────────────────────────────────────────────────
const VoiceCard = ({ dictation, index, onView }) => (
  <div style={{
    border: '1px solid #e8e8e8',
    borderRadius: 4,
    marginBottom: 14,
    overflow: 'hidden',
    background: '#fafafa',
  }}>
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 14px',
      background: '#fff',
      borderBottom: '1px solid #f0f0f0',
    }}>
      <span style={{ fontSize: 11, color: '#999', flex: 1 }}>
  {dictation?.timestamp 
    ? (() => {
        const utcDate = new Date(dictation.timestamp);
        // Add 5 hours 30 minutes for IST
        const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
        return istDate.toLocaleString('en-IN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
      })()
    : 'N/A'}
</span>
      <span style={{ fontSize: 10, color: '#ccc', fontWeight: 600 }}>#{index + 1}</span>
    </div>
    <div style={{ padding: '10px 14px' }}>
      <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>
        {truncate(dictation?.conversation || '')}
      </p>
      {(dictation?.conversation || '').length > 140 && (
        <button onClick={() => onView(dictation)} style={{
          background: 'none', border: 'none', padding: '6px 0 0',
          fontSize: 12, color: '#000', fontWeight: 600,
          cursor: 'pointer', textDecoration: 'underline',
          fontFamily: "'DM Sans', sans-serif",
        }}>View more →</button>
      )}
    </div>
  </div>
);

// ─── Smart Hospital Agent ─────────────────────────────────────────────────────
const SmartHospitalAgent = ({ patientId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    setLoading(true);
    fetch(`${API_BASE}/hms/users/ai-legacy/patient-intake/analyze/latest/${patientId}`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((r) => r.json())
      .then((r) => { if (r.status === 'success') setData(r); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [patientId]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 30, justifyContent: 'center' }}>
      <Spinner /> <span style={{ fontSize: 13, color: '#999' }}>Loading agent data…</span>
    </div>
  );

  if (!data) return (
    <div style={{ padding: 30, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
      No agent data available for this patient.
    </div>
  );

  const AgentRow = ({ label, value, bold }) => (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #f5f5f5' }}>
      <span style={{ fontSize: 11, color: '#aaa', width: 160, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.7px' }}>{label}</span>
      <span style={{ fontSize: 12, color: bold ? '#000' : '#444', fontWeight: bold ? 700 : 400, flex: 1 }}>{fmt(value)}</span>
    </div>
  );

  return (
    <div style={{ fontSize: 13 }}>
      <SectionCard title="Triage Status">
        <AgentRow label="Level / Severity" value={`${data.triage_level || '—'} · ${data.severity || '—'}`} bold />
        <AgentRow label="Emergency Type" value={data.emergency_type} />
        <AgentRow label="Primary Action" value={data.primary_action_now} />
        <AgentRow label="Confidence" value={`${Math.round((data.composite_confidence || 0) * 100)}%`} />
      </SectionCard>

      {data.hospital_dashboard_card && (
        <SectionCard title="Hospital Dashboard">
          <AgentRow label="Triage Badge" value={data.hospital_dashboard_card.triage_badge} />
          <AgentRow label="Clinical Alert" value={data.hospital_dashboard_card.clinical_alert} />
          <AgentRow label="Drug Warning" value={data.hospital_dashboard_card.drug_warning} />
          <AgentRow label="Top Action" value={data.hospital_dashboard_card.top_action} bold />
        </SectionCard>
      )}

      {data.clinical_result && (
        <SectionCard title="Clinical Assessment">
          <AgentRow label="Primary Diagnosis" value={data.clinical_result.primary_diagnosis} bold />
          {data.clinical_result.haemodynamic_status && (<>
            <AgentRow label="Shock Index" value={data.clinical_result.haemodynamic_status.shock_index} />
            <AgentRow label="MAP" value={`${data.clinical_result.haemodynamic_status.map} mmHg`} />
            <AgentRow label="ATLS Class" value={data.clinical_result.haemodynamic_status.atls_shock_class} />
          </>)}
          {data.clinical_result.neurological_assessment && (
            <AgentRow label="GCS Total" value={`${data.clinical_result.neurological_assessment.gcs_total}/15`} />
          )}
          {data.clinical_result.imaging_orders?.length > 0 && (
            <AgentRow label="Imaging Orders" value={data.clinical_result.imaging_orders.join(', ')} />
          )}
        </SectionCard>
      )}

      {data.synthesis_result && (
        <SectionCard title="Critical Actions">
          {data.synthesis_result.critical_action_checklist?.slice(0, 5).map((a, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#000', marginBottom: 2 }}>
                {a.rank}. {a.action}
              </div>
              <div style={{ fontSize: 11, color: '#999' }}>
                {a.responsible} · {a.timeframe}
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {data.dashboard_narrative && (
        <SectionCard title="Clinical Narrative">
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.7, padding: '8px 0' }}>
            {data.dashboard_narrative}
          </p>
        </SectionCard>
      )}
    </div>
  );
};

// ─── RPM Panel ────────────────────────────────────────────────────────────
const RpmPanel = React.memo(({ iframeUrl, zenzoLoading, zenzoStatus, callZenzoFlow, iframeRef, incidentCompleted }) => {

  const overlayStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    background: '#fff',
    pointerEvents: 'none',
  };

  return (
    <div style={{ border: '1px solid #e8e8e8', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px',
        background: '#fafafa',
        borderBottom: '1px solid #e8e8e8',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#000' }}>
          RPM Live Monitor
        </span>
        {zenzoLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spinner size={12} />
            <span style={{ fontSize: 11, color: '#888' }}>{zenzoStatus || 'Connecting…'}</span>
          </div>
        ) : iframeUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 1.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>LIVE</span>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#aaa' }}>{zenzoStatus || 'Unavailable'}</span>
        )}
      </div>

  {incidentCompleted ? (
        <div style={{ position: 'relative', height: 400, background: '#000' }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#22c55e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{
              fontSize: 20,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.5px',
            }}>
              Incident Completed
            </div>
            <div style={{
              fontSize: 13,
              color: '#aaa',
              textAlign: 'center',
              maxWidth: 260,
              lineHeight: 1.6,
            }}>
              This incident has been successfully completed and recorded in the system.
            </div>
          </div>
        </div>
      ) : iframeUrl ? (
        <div style={{ position: 'relative' }}>
          {false && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: '#000',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: '#22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div style={{
                fontSize: 20,
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '0.5px',
              }}>
                Incident Completed
              </div>
              <div style={{
                fontSize: 13,
                color: '#aaa',
                textAlign: 'center',
                maxWidth: 260,
                lineHeight: 1.6,
              }}>
                This incident has been successfully completed and recorded in the system.
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            title="RPM Monitor"
            scrolling="no"
            allow="camera; microphone"
            style={{ width: '100%', height: '1100px', border: 'none', display: 'block', overflow: 'hidden' }}
          />
          <div style={overlayStyle} />
        </div>
      ) : (
        <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          {zenzoLoading ? (
            <>
              <Spinner size={28} />
              <span style={{ fontSize: 13, color: '#aaa' }}>Initializing RPM connection…</span>
            </>
          ) : (
            <span style={{ fontSize: 13, color: '#aaa' }}>{zenzoStatus || 'RPM monitor not available.'}</span>
          )}
          {!zenzoLoading && (
            <button onClick={callZenzoFlow} style={{
              background: '#000', color: '#fff', border: 'none',
              padding: '8px 18px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
              fontFamily: "'DM Sans', sans-serif",
            }}>Retry Connection</button>
          )}
        </div>
      )}
    </div>
  );
});

// ─── PDF Logo fetcher ─────────────────────────────────────────────────────────
const fetchLogoAsBase64 = async (url) => {
  console.log(`[Logo Fetch] Attempting to fetch: ${url}`);
  
  // Method using Image element (bypasses CORS)
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    
    img.onload = () => {
      console.log(`[Logo Fetch] Image loaded successfully: ${url}`);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL('image/jpeg');
        console.log(`[Logo Fetch] Converted to base64, length: ${dataURL.length}`);
        resolve(dataURL);
      } catch (err) {
        console.error(`[Logo Fetch] Canvas conversion failed:`, err);
        resolve(null);
      }
    };
    
    img.onerror = (err) => {
      console.error(`[Logo Fetch] Image load failed:`, err);
      // Try with timestamp to avoid cache issues
      const timestampedUrl = `${url}?t=${Date.now()}`;
      console.log(`[Logo Fetch] Retrying with timestamp: ${timestampedUrl}`);
      const retryImg = new Image();
      retryImg.crossOrigin = 'Anonymous';
      retryImg.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = retryImg.width;
          canvas.height = retryImg.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(retryImg, 0, 0);
          const dataURL = canvas.toDataURL('image/jpeg');
          console.log(`[Logo Fetch] Retry successful, base64 length: ${dataURL.length}`);
          resolve(dataURL);
        } catch (e) {
          console.error(`[Logo Fetch] Retry conversion failed:`, e);
          resolve(null);
        }
      };
      retryImg.onerror = () => {
        console.error(`[Logo Fetch] Retry also failed for: ${url}`);
        resolve(null);
      };
      retryImg.src = timestampedUrl;
    };
    
    img.src = url;
    
    // Timeout after 5 seconds
    setTimeout(() => {
      console.log(`[Logo Fetch] Timeout for: ${url}`);
      resolve(null);
    }, 5000);
  });
};

// ─── Final Summary PDF Generator (single-column, proper logos) ────────────────
const generateFinalSummaryPDF = async (finalSummary, patientName) => {
  if (!window.jspdf) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = 210;
  const pageH = 297;
  const marginL = 16;
const marginR = 22;
 const contentW = pageW - marginL - marginR - 8;
  const contentTop = 68;

  let curY = contentTop;
const fmtIST = (str) => {
    if (!str) return '';
    try {
      const dt = new Date(str);
      return dt.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      }) + ' IST';
    } catch { return str; }
  };
  const BLACK = [0, 0, 0];
  const WHITE = [255, 255, 255];
  const GRAY  = [110, 110, 110];
  const LGRAY = [230, 230, 230];

  // ── Fetch doctor info ──────────────────────────────────────────────────────
  let doctorInfo = null;
  try {
    const doctorId = localStorage.getItem('zenzo_doctor_id') || localStorage.getItem('doctor_id') || '';
    if (doctorId) {
      const dRes = await fetch(`${API_BASE}/hms/users/get_doctor/${doctorId}`);
      const dData = await dRes.json();
      if (dData.status === 'success') doctorInfo = dData.doctor;
    }
  } catch (e) { console.error('Doctor fetch failed:', e); }

  // ── Fetch all 3 logos ──────────────────────────────────────────────────────
console.log('[PDF Generation] Starting logo fetches...');
const [apocB64, zenzoB64, daB64] = await Promise.all([
  fetchLogoAsBase64('https://doctorassist.ai/uploads/files/Ambulance/apoc1.png'),
  fetchLogoAsBase64('https://doctorassist.ai/uploads/files/Ambulance/ZENO LOGO .png'),
  
]);
console.log('[PDF Generation] Logo results:', {
  apoc: apocB64 ? 'Success' : 'Failed',
  zenzo: zenzoB64 ? 'Success' : 'Failed',
  da: daB64 ? 'Success' : 'Failed'
});

  // ── Helper: get image type from base64 ────────────────────────────────────
  const imgType = (b64) => (b64 && b64.startsWith('data:image/png')) ? 'PNG' : 'JPEG';

  // ── Page break helper ──────────────────────────────────────────────────────
 const ensureSpace = (needed = 12) => {
    if (curY + needed > pageH - 20) {
      doc.addPage();
      curY = 24;
    }
  };

  // ── Footer ─────────────────────────────────────────────────────────────────
 const drawPageFooter = () => {
    const n = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.3);
    doc.line(marginL, pageH - 14, pageW - marginR, pageH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text('DoctorAssist.AI — Confidential Medical Record', marginL, pageH - 8);
    doc.text(`Page ${n}`, pageW - marginR, pageH - 8, { align: 'right' });
  };
  // ── Draw HEADER (page 1) ───────────────────────────────────────────────────
  const drawHeader = () => {
    // Black header bar
    doc.setFillColor(...BLACK);
    doc.rect(0, 0, pageW, 58, 'F');

    // ── Row 1: Left side — "A PRODUCT OF" label + Apoc logo + "×" + Zenzo logo
    let lx = marginL;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(160, 160, 160);
   doc.text('A PRODUCT BY', lx, 10);

    lx += 0;
    // Apoc logo
    if (apocB64) {
      try {
        doc.addImage(apocB64, imgType(apocB64), lx, 14, 18, 9);
        lx += 25;
      } catch (e) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...WHITE);
        doc.text('APOC', lx, 20);
        lx += 16;
      }
    }

    // "×" separator
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(180, 180, 180);
    doc.text('×', lx, 20);
    lx += 6;


    // ── Row 2: Left side — DoctorAssist logo + "AI CLINICAL BY DoctorAssist.Ai"
    let lx2 = marginL;
    if (daB64) {
      try {
        doc.addImage(daB64, imgType(daB64), lx2, 27, 14, 12);
        lx2 += 17;
      } catch (e) {}
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(160, 160, 160);
   
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...WHITE);
  doc.text('DoctorAssist.Ai', lx, 20);
  // ZENZO BELOW
if (zenzoB64) {
  try {
    doc.addImage(
  zenzoB64,
  imgType(zenzoB64),
  marginL,
  32,
  26,
  10
);
  } catch (e) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...WHITE);
    doc.text('ZENZO', marginL, 40);
  }
}

    // ── Right side: triage badge + doctor info ─────────────────────────────
    const triage = finalSummary.section_10_triage_information?.triage_colour;
    if (triage) {
      const bc = triage === 'Red' ? [210, 40, 40]
               : triage === 'Yellow' ? [200, 150, 0]
               : triage === 'Green' ? [30, 140, 30]
               : [80, 80, 80];
      doc.setFillColor(...bc);
      doc.roundedRect(pageW - marginR - 38, 6, 38, 12, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...WHITE);
      doc.text(`TRIAGE: ${triage.toUpperCase()}`, pageW - marginR - 19, 13.5, { align: 'center' });
    }

    if (doctorInfo) {
      const drName = doctorInfo.doctor_name || doctorInfo.fullName || '';
      const drSpec = doctorInfo.specialization || '';
      const drId   = doctorInfo.doctor_id || doctorInfo.sys_user_id || '';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...WHITE);
      doc.text(`Dr. ${drName}`, pageW - marginR, 27, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(180, 180, 180);
      if (drSpec) doc.text(drSpec, pageW - marginR, 33, { align: 'right' });
      if (drId)   doc.text(`ID: ${drId}`, pageW - marginR, 38, { align: 'right' });
    }

    // ── Bottom of header: report type + patient name ───────────────────────
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.3);
    doc.line(marginL, 46, pageW - marginR, 46);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text('EMERGENCY DEPARTMENT — FINAL SUMMARY REPORT', marginL, 52);

    const pName = finalSummary.section_1_patient_information?.full_name || patientName || 'Patient';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...WHITE);
    doc.text(pName, marginL, 62);

    const genDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated: ${genDate}`, pageW - marginR, 62, { align: 'right' });
  };

  // ── Section heading ────────────────────────────────────────────────────────
  const sectionHeading = (title) => {
    ensureSpace(14);
    doc.setFillColor(...BLACK);
    doc.rect(marginL, curY, contentW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    doc.text(title.toUpperCase(), marginL + 4, curY + 5.5);
    curY += 11;
  };

  // ── Key-value row ──────────────────────────────────────────────────────────
  const kvRow = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    const valStr = String(value);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
   const valLines = doc.splitTextToSize(
  valStr,
  contentW - 58
);
    const rowH = Math.max(valLines.length * 4.8 + 5, 10);
    ensureSpace(rowH);

    // Label column (55mm wide)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(label, marginL + 2, curY + 4);

    // Value column
   doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLACK);
    valLines.forEach((line, i) => {
      doc.text(line, marginL + 58, curY + 4 + i * 4.8);
    });

    // Divider
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.2);
    doc.line(marginL, curY + rowH - 1, pageW - marginR, curY + rowH - 1);

    curY += rowH;
  };
const kvRowBold = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    const valStr = String(value);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const valLines = doc.splitTextToSize(valStr, contentW - 58);
    const rowH = Math.max(valLines.length * 4.8 + 5, 10);
    ensureSpace(rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(label, marginL + 2, curY + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLACK);
    valLines.forEach((line, i) => { doc.text(line, marginL + 58, curY + 4 + i * 4.8); });
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.2);
    doc.line(marginL, curY + rowH - 1, pageW - marginR, curY + rowH - 1);
    curY += rowH;
  };
  // ── Paragraph text ─────────────────────────────────────────────────────────
// ── Shared text cleanup (fixes letter-spaced text + unsupported glyphs) ────
  const cleanPdfText = (text) => String(text)
    .replace(/⚠/g, '!')
    .replace(/[^\x00-\x7F]/g, (c) => {
      const map = {'°':'deg','²':'2','³':'3','≥':'>=','≤':'<=','→':'->','–':'-','—':'-','\u201C':'"','\u201D':'"','\u2018':"'",'\u2019':"'"};
      return map[c] || '?';
    })
    .replace(/\b(?:[A-Za-z0-9]\s){2,}[A-Za-z0-9]\b/g, (m) => m.replace(/\s+/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

  // ── Paragraph text ─────────────────────────────────────────────────────────
  const paragraph = (text) => {
  if (!text) return;

 const safeText = cleanPdfText(text);
  // Smaller width to prevent overflow
const maxWidth = contentW - 6;

  const lines = doc.splitTextToSize(
    safeText,
    maxWidth
  );

  const lineHeight = 5.5;

  ensureSpace(lines.length * lineHeight + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(40, 40, 40);

  lines.forEach((line) => {
    ensureSpace(lineHeight + 2);

    // Extra left padding
    doc.text(line, marginL + 4, curY + 4);

    curY += lineHeight;
  });

  curY += 3;
};

  // ── Sub-label ──────────────────────────────────────────────────────────────
  const subLabel = (text) => {
    ensureSpace(8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(text.toUpperCase(), marginL + 2, curY + 4);
    curY += 7;
  };

  // ── Bullet list ────────────────────────────────────────────────────────────
  const bulletList = (items) => {
    if (!items || !items.length) return;
  items.filter(Boolean).forEach((item) => {
      const cleanItem = String(item).replace(/⚠/g, '!').replace(/[^\x00-\x7F]/g, (c) => {
        const map = {'°':'deg','²':'2','³':'3','≥':'>=','≤':'<=','→':'->','–':'-','—':'-','\u201C':'"','\u201D':'"','\u2018':"'",'\u2019':"'"};
        return map[c] || '?';
      });
      const lines = doc.splitTextToSize(cleanItem, contentW - 10);
      ensureSpace(lines.length * 5 + 4);
      doc.setFillColor(...BLACK);
      doc.circle(marginL + 4, curY + 3.2, 0.8, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(40, 40, 40);
      lines.forEach((line, i) => {
        doc.text(line, marginL + 8, curY + 4 + i * 5);
      });
      curY += lines.length * 5 + 2;
    });
    curY += 2;
  };

  // ── Spacer ─────────────────────────────────────────────────────────────────
  const spacer = (h = 4) => { curY += h; };

  // ── DATA REFS ──────────────────────────────────────────────────────────────
  const s1  = finalSummary.section_1_patient_information  || {};
  const s2  = finalSummary.section_2_arrival_details      || {};
  const s3  = finalSummary.section_3_incident_details     || {};
  const s4  = finalSummary.section_4_chief_complaint      || {};
  const s5  = finalSummary.section_5_emt_pre_hospital_report || {};
  const s6  = finalSummary.section_6_voice_note_processing || {};
  const s7  = finalSummary.section_7_ai_clinical_suggestion || {};
  const s8  = finalSummary.section_8_doctor_review_status || {};
  const s9  = finalSummary.section_9_doctor_manual_note   || {};
  const s10 = finalSummary.section_10_triage_information  || {};
  const s11 = finalSummary.section_11_initial_ed_assessment || {};
  const s12 = finalSummary.section_12_visible_injuries    || {};
  const s13 = finalSummary.section_13_physical_examination || {};
  const s14 = finalSummary.section_14_emergency_interventions || {};
  const s15 = finalSummary.section_15_known_medical_history?.known_medical_history || {};
  const s16 = finalSummary.section_16_working_diagnosis   || {};
  const s17 = finalSummary.section_17_clinical_progression || {};
  const s18 = finalSummary.section_18_specialist_alerts   || [];
  const s19 = finalSummary.section_19_ed_clinical_course  || {};
  const s20 = finalSummary.section_20_final_disposition   || {};
  const s21 = finalSummary.section_21_final_ed_summary    || {};
  const s22 = finalSummary.section_22_handover_information || {};
  const s23 = finalSummary.section_23_sbar_summary        || {};
  const s24 = finalSummary.section_24_clinical_actions_summary || {};

  // ── Draw everything ────────────────────────────────────────────────────────
  drawHeader();

  // S1 Patient Information
  sectionHeading('1. Patient Information');
  kvRow('Full Name', s1.full_name);
  kvRow('Age', s1.age);
  kvRow('Gender', s1.gender);
  kvRow('Phone Number', s1.phone_number);
  kvRow('Address', s1.address);
  kvRow('Date of Arrival', s1.date_of_arrival);
  if (s1.emergency_contact_name) {
    kvRow('Emergency Contact', `${s1.emergency_contact_name}${s1.emergency_contact_relationship ? ` (${s1.emergency_contact_relationship})` : ''}${s1.emergency_contact_phone ? ` · ${s1.emergency_contact_phone}` : ''}`);
  }
  spacer();

  // S2 Arrival Details
  sectionHeading('2. Arrival Details');
  kvRow('Mode of Arrival', s2.mode_of_arrival);
  kvRow('EMT Driver', s2.emt_driver_name);
  kvRow('Referral Source', s2.referral_source);
  kvRow('Transport Duration', s2.transport_duration_minutes ? `${s2.transport_duration_minutes} min` : null);
  kvRow('Arrival Condition', s2.arrival_clinical_condition);
  spacer();

  // S3 Incident Details
  sectionHeading('3. Incident Details');
  kvRow('Type of Incident', s3.type_of_incident);
  kvRow('Mechanism of Injury', s3.mechanism_of_injury);
  kvRow('Location', s3.location_of_incident);
  if (s3.coordinates?.latitude) kvRow('Coordinates', `${s3.coordinates.latitude}, ${s3.coordinates.longitude}`);
  kvRow('Date of Incident', s3.date_of_incident);
  kvRow('Time of Incident', s3.time_of_incident);
  spacer();

  // S4 Chief Complaint
  if (s4.chief_complaint) {
    sectionHeading('4. Chief Complaint');
    paragraph(s4.chief_complaint);
    spacer();
  }

  // S5 EMT Pre-Hospital Report
  sectionHeading('5. EMT Pre-Hospital Report');
  kvRow('Scene Findings', s5.scene_findings);
  kvRow('Consciousness Level', s5.consciousness_level_on_scene);
  kvRow('Airway', s5.airway);
  kvRow('Breathing', s5.breathing);
  kvRow('Circulation', s5.circulation);
  kvRow('Bleeding Status', s5.bleeding_status);
  kvRow('Time at Scene', s5.time_at_scene_minutes ? `${s5.time_at_scene_minutes} min` : null);
  kvRow('ETA to Hospital', s5.eta_to_hospital_minutes ? `${s5.eta_to_hospital_minutes} min` : null);
  if (s5.vitals_on_scene) {
    const v = s5.vitals_on_scene;
    subLabel('Vitals on Scene');
    kvRow('Pulse Rate', v.pulse_rate_bpm ? `${v.pulse_rate_bpm} bpm` : null);
    kvRow('Blood Pressure', v.blood_pressure);
    kvRow('SpO2', v.spo2_percent ? `${v.spo2_percent}%` : null);
    kvRow('Respiratory Rate', v.respiratory_rate_bpm ? `${v.respiratory_rate_bpm} bpm` : null);
    kvRow('GCS (Estimated)', v.gcs_estimated);
  }
  if (s5.pre_hospital_interventions_performed?.length) {
    subLabel('Pre-Hospital Interventions');
    bulletList(s5.pre_hospital_interventions_performed);
  }
  if (s5.clinical_narrative_from_emt) {
    subLabel('Clinical Narrative');
    paragraph(s5.clinical_narrative_from_emt);
  }
  spacer();

  // S6 Voice Notes
  if (s6.total_voice_notes > 0) {
    sectionHeading(`6. Voice Notes (${s6.total_voice_notes})`);
    if (s6.combined_clinical_summary_from_voice) paragraph(s6.combined_clinical_summary_from_voice);
    s6.voice_notes?.filter(n => n.transcript)?.forEach((note, i) => {
      subLabel(`Note #${note.note_number || i + 1}  ${note.date || ''}  ${note.time || ''}`);
      paragraph(note.transcript);
    });
    spacer();
  }

  // S7 AI Clinical Suggestion
  sectionHeading('7. AI Clinical Suggestion');
  kvRow('Triage Suggestion', s7.triage_suggestion);
  kvRow('Criticality Score', s7.criticality_score_suggested);
  kvRow('Confidence Level', s7.confidence_level);
  if (s7.ai_generated_summary) { subLabel('AI Summary'); paragraph(s7.ai_generated_summary); }
  if (s7.key_clinical_recommendations?.length) { subLabel('Key Recommendations'); bulletList(s7.key_clinical_recommendations); }
  if (s7.suggested_immediate_interventions?.length) { subLabel('Suggested Interventions'); bulletList(s7.suggested_immediate_interventions); }
  if (s7.suggested_investigations?.length) { subLabel('Suggested Investigations'); bulletList(s7.suggested_investigations); }
 if (s7.hospital_prep_instructions) { subLabel('Hospital Prep Instructions'); paragraph(s7.hospital_prep_instructions); }
  if (s7.image_ai_impression) {
    subLabel('Monitor Image Impression');
    paragraph(s7.image_ai_impression);
    if (s7.image_ai_context_note) paragraph(`NOTE: ${s7.image_ai_context_note}`);
  }
  spacer();

  // S8 Doctor Review
  sectionHeading('8. Doctor Review Status');
  kvRow('Review Decision', s8.ai_review_decision);
  kvRow('Total Reviews', s8.total_reviews_performed);
  kvRow('Approved Count', s8.approved_count);
  kvRow('Rejected Count', s8.rejected_count);
 kvRow('Review Timestamp', s8.review_timestamp ? fmtIST(s8.review_timestamp) : null);
  kvRow('Reviewer Summary', s8.reviewer_summary);
  spacer();

  // S9 Doctor Manual Note
  if (s9.manual_clinical_summary || s9.corrections_or_additions_to_ai || s9.additional_clinical_findings) {
    sectionHeading('9. Doctor Manual Note');
    kvRowBold('Manual Summary', s9.manual_clinical_summary);
    kvRow('Corrections / Additions', s9.corrections_or_additions_to_ai);
    kvRow('Additional Findings', s9.additional_clinical_findings);
   kvRow('Entered At', s9.doctor_entered_at ? fmtIST(s9.doctor_entered_at) : null);
    spacer();
  }

  // S10 Triage
  sectionHeading('10. Triage Information');
 kvRowBold('Triage Colour', s10.triage_colour);
  kvRowBold('Triage Category', s10.triage_category);
  kvRowBold('Criticality Score', s10.criticality_score ? `${s10.criticality_score} / 10` : null);
  kvRowBold('Risk Level', s10.risk_level);
  kvRow('Triage Rationale', s10.triage_rationale);
kvRow('Triage Performed At', s10.triage_performed_at ? fmtIST(s10.triage_performed_at) : null);  spacer();

  // S11 ABCDE
  sectionHeading('11. Initial ED Assessment — ABCDE');
  const abcde = s11.abcde_summary || {};
  ['A_airway', 'B_breathing', 'C_circulation', 'D_disability', 'E_exposure'].forEach(k => {
    if (abcde[k]) kvRow(k.replace(/_/g, ' '), abcde[k]);
  });
  kvRow('GCS Total', s11.gcs_total ? `${s11.gcs_total} / 15` : null);
  const gcs = s11.gcs_breakdown || {};
  if (gcs.eye || gcs.verbal || gcs.motor) kvRow('GCS E/V/M', `${gcs.eye || '?'} / ${gcs.verbal || '?'} / ${gcs.motor || '?'}`);
  kvRow('AVPU', s11.avpu);
  kvRow('Neurological Findings', s11.neurological_findings);
  const iv = s11.initial_vitals_in_ed || {};
  kvRow('Pulse Rate', iv.pulse_rate_bpm ? `${iv.pulse_rate_bpm} bpm` : null);
  kvRow('Blood Pressure', iv.blood_pressure);
  kvRow('SpO2', iv.spo2_percent ? `${iv.spo2_percent}%` : null);
  kvRow('Respiratory Rate', iv.respiratory_rate_bpm ? `${iv.respiratory_rate_bpm} bpm` : null);
  kvRow('Temperature', iv.temperature_celsius ? `${iv.temperature_celsius} °C` : null);
  spacer();

  // S12 Visible Injuries
  if (s12.visible_injuries?.length) {
    sectionHeading('12. Visible Injuries');
    bulletList(s12.visible_injuries);
    spacer();
  }

  // S13 Physical Examination
  sectionHeading('13. Physical Examination');
  [
    ['Head & Face', s13.head_and_face],
    ['Neck & Cervical Spine', s13.neck_and_cervical_spine],
    ['Chest & Thorax', s13.chest_and_thorax],
    ['Abdomen', s13.abdomen],
    ['Pelvis', s13.pelvis],
    ['Spine & Back', s13.spine_and_back],
    ['Upper Limbs', s13.upper_limbs],
    ['Lower Limbs', s13.lower_limbs],
    ['Wounds & Bleeding', s13.wounds_lacerations_and_bleeding],
   ['Skin Findings', s13.skin_findings],
  ].forEach(([l, v]) => { if (v) kvRow(l, v); });
  if (s13.monitor_clinical_data) {
    subLabel('Monitor Clinical Data');
    paragraph(s13.monitor_clinical_data);
  }
  spacer();

  // S14 Emergency Interventions
  sectionHeading('14. Emergency Interventions');
  if (s14.airway_management?.length) { subLabel('Airway Management'); bulletList(s14.airway_management); }
  const oxy = s14.oxygen_therapy || {};
  if (oxy.applied) kvRow('Oxygen Therapy', [oxy.delivery_device, oxy.flow_rate_lpm ? `${oxy.flow_rate_lpm} L/min` : null, oxy.target_spo2 ? `Target: ${oxy.target_spo2}%` : null].filter(Boolean).join(' · '));
  const iv2 = s14.iv_access_and_fluids || {};
  if (iv2.iv_access_established) kvRow('IV Access & Fluids', [iv2.fluid_type, iv2.volume_ml ? `${iv2.volume_ml} mL` : null, iv2.rate].filter(Boolean).join(' · ') || 'Established');
  if (s14.haemorrhage_control_measures?.length) { subLabel('Haemorrhage Control'); bulletList(s14.haemorrhage_control_measures); }
  if (s14.immobilization_applied?.length) { subLabel('Immobilization'); bulletList(s14.immobilization_applied); }
  if (s14.medications_administered?.length) { subLabel('Medications Administered'); bulletList(s14.medications_administered); }
  if (s14.other_interventions?.length) { subLabel('Other Interventions'); bulletList(s14.other_interventions); }
  if (s14.cpr_performed !== null && s14.cpr_performed !== undefined) kvRow('CPR Performed', s14.cpr_performed ? 'Yes' : 'No');
  if (s14.defibrillation_performed !== null && s14.defibrillation_performed !== undefined) kvRow('Defibrillation', s14.defibrillation_performed ? 'Yes' : 'No');
  kvRow('Total Interventions', s14.total_intervention_count);
  spacer();

  // S15 Medical History
  const hasMedHx = s15.diabetes || s15.hypertension || s15.cardiac || s15.allergies || s15.current_medications?.length || s15.other_conditions?.length;
  if (hasMedHx) {
    sectionHeading('15. Known Medical History');
    kvRow('Diabetes', s15.diabetes);
    kvRow('Hypertension', s15.hypertension);
    kvRow('Cardiac', s15.cardiac);
    kvRow('Allergies', s15.allergies);
    if (s15.current_medications?.length) { subLabel('Current Medications'); bulletList(s15.current_medications); }
    if (s15.other_conditions?.length) { subLabel('Other Conditions'); bulletList(s15.other_conditions); }
    spacer();
  }

  // S16 Working Diagnosis
  sectionHeading('16. Working Diagnosis');
 kvRowBold('Primary Diagnosis', s16.primary_diagnosis);
  kvRow('Diagnosis Confidence', s16.diagnosis_confidence);
  kvRow('ICD Code (Approx)', s16.icd_code_approximate);
  if (s16.secondary_diagnoses?.length) { subLabel('Secondary Diagnoses'); bulletList(s16.secondary_diagnoses); }
  if (s16.suspected_injuries?.length) { subLabel('Suspected Injuries'); bulletList(s16.suspected_injuries); }
  if (s16.differential_diagnoses?.length) { subLabel('Differential Diagnoses'); bulletList(s16.differential_diagnoses); }
  spacer();

  // S17 Clinical Progression
  sectionHeading('17. Clinical Progression');
 kvRowBold('Overall Trend', s17.overall_trend);
  kvRowBold('Current Clinical Status', s17.current_clinical_status);
  kvRow('Response to Interventions', s17.response_to_interventions);

  kvRow('Trajectory Note', s17.trajectory_clinical_note);
 if (s17.dictation_by_dictation_progression?.length) {
    subLabel('Dictation-by-Dictation Progression');
    s17.dictation_by_dictation_progression.forEach((p, idx) => {
      ensureSpace(10);
     if (typeof p === 'string') {
        // v7 format: plain string entries — collapse newlines/blank lines into comma-separated sentences
        const cleanP = String(p)
          .replace(/⚠/g, '!')
          .replace(/\r?\n+/g, ', ')
          .replace(/\s+/g, ' ')
          .replace(/,\s*,/g, ',')
          .replace(/,\s*$/, '')
          .trim();
        const lines = doc.splitTextToSize(cleanP, contentW - 8);
        const rowH = lines.length * 5 + 4;
        ensureSpace(rowH);
        doc.setFillColor(248, 248, 248);
        doc.rect(marginL, curY, contentW, rowH, 'F');
        doc.setDrawColor(...LGRAY);
        doc.setLineWidth(0.2);
        doc.rect(marginL, curY, contentW, rowH, 'S');
        doc.setFillColor(...BLACK);
        doc.rect(marginL, curY, 2, rowH, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(40, 40, 40);
        lines.forEach((line, i) => {
          doc.text(line, marginL + 5, curY + 4 + i * 5);
        });
        curY += rowH + 3;
      } else if (typeof p === 'object' && p !== null) {
        // object format with note_number, timestamp etc.
        const label = `Entry ${p.note_number || idx + 1}  ${p.timestamp ? fmtIST(p.timestamp) : ''}`;
        subLabel(label);
        if (p.status_at_this_time) paragraph(p.status_at_this_time);
        if (p.key_clinical_findings?.length) bulletList(p.key_clinical_findings);
        if (p.change_from_previous) kvRow('Change from Previous', p.change_from_previous);
      }
    });
  }
  spacer();

  // S18 Specialist Alerts
  if (s18.filter(a => a.specialty).length) {
    sectionHeading('18. Specialist Alerts');
    s18.filter(a => a.specialty).forEach(alert => {
      ensureSpace(16);
      const uc = alert.urgency === 'Immediate' ? [200, 40, 40]
               : alert.urgency === 'Urgent' ? [200, 130, 0]
               : [60, 130, 60];
      doc.setFillColor(...uc);
      doc.rect(marginL, curY, 2, 10, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...BLACK);
      doc.text(alert.specialty, marginL + 6, curY + 4.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...GRAY);
      doc.text(`${alert.urgency || ''} · ${alert.response_status || ''}`, marginL + 6, curY + 9);
      curY += 13;
      if (alert.reason) paragraph(alert.reason);
      spacer(2);
    });
    spacer();
  }

  // S19 ED Clinical Course
  sectionHeading('19. ED Clinical Course');
  if (s19.narrative) paragraph(s19.narrative);
  kvRow('Patient Response', s19.patient_response_to_treatment);
  kvRow('Complications Noted', s19.complications_noted);
if (s19.key_events_chronological?.length) {
    subLabel('Key Events (Chronological)');
    s19.key_events_chronological.forEach((evt) => {
      if (!evt) return;
      // Clean up raw JSON blob in the event string — truncate at 300 chars and strip JSON artifacts
      let cleanEvt = String(evt);
      const jsonIdx = cleanEvt.indexOf(': {"');
      if (jsonIdx > 0) cleanEvt = cleanEvt.substring(0, jsonIdx + 2) + '[see full data in system]';
      cleanEvt = cleanEvt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanEvt.length > 320) cleanEvt = cleanEvt.substring(0, 320) + '…';
      const lines = doc.splitTextToSize(cleanEvt, contentW - 10);
      ensureSpace(lines.length * 5 + 4);
      doc.setFillColor(...BLACK);
      doc.circle(marginL + 4, curY + 3.2, 0.8, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(40, 40, 40);
      lines.forEach((line, i) => {
        doc.text(line, marginL + 8, curY + 4 + i * 5);
      });
      curY += lines.length * 5 + 2;
    });
    curY += 2;
  }  if (s19.significant_changes_in_ed?.length) { subLabel('Significant Changes in ED'); bulletList(s19.significant_changes_in_ed); }
  spacer();

  // S20 Final Disposition
  sectionHeading('20. Final Disposition');
 kvRowBold('Disposition', s20.disposition);
  kvRowBold('Urgency', s20.urgency);
  kvRow('Destination Unit', s20.destination_unit);

  kvRow('Condition at Disposition', s20.condition_at_disposition);
kvRow('Disposition Time', s20.disposition_time ? fmtIST(s20.disposition_time) : null);
  kvRow('Rationale', s20.rationale);
  spacer();

  // S21 Final ED Summary
  sectionHeading('21. Final ED Summary');
  if (s21.consolidated_narrative) paragraph(s21.consolidated_narrative);
  kvRow('Outcome at Discharge', s21.outcome_at_ed_discharge);
  kvRow('Follow-up Instructions', s21.follow_up_instructions);
  if (s21.clinical_highlights?.length) { subLabel('Clinical Highlights'); bulletList(s21.clinical_highlights); }
  if (s21.outstanding_issues?.length) { subLabel('Outstanding Issues'); bulletList(s21.outstanding_issues); }
  spacer();

  // S22 Handover
  sectionHeading('22. Handover Information');
  kvRow('Handover To', s22.handover_to);
  kvRow('Receiving Unit', s22.receiving_unit);
  kvRow('Handover Summary', s22.handover_summary);
  if (s22.critical_points_for_receiving_team?.length) { subLabel('Critical Points for Receiving Team'); bulletList(s22.critical_points_for_receiving_team); }
  if (s22.pending_investigations_at_handover?.length) { subLabel('Pending Investigations'); bulletList(s22.pending_investigations_at_handover); }
  if (s22.monitoring_requirements?.length) { subLabel('Monitoring Requirements'); bulletList(s22.monitoring_requirements); }
  spacer();

  // S23 SBAR
  sectionHeading('23. SBAR Summary');
 [['Situation', s23.situation], ['Background', s23.background], ['Assessment', s23.assessment], ['Recommendation', s23.recommendation]].forEach(([label, val]) => {
    if (!val) return;
    ensureSpace(16);
    doc.setFillColor(245, 245, 245);
    const cleanVal = cleanPdfText(val);
    const valLines = doc.splitTextToSize(cleanVal, contentW - 10);
    const blockH = valLines.length * 5 + 12;
    doc.rect(marginL, curY, contentW, blockH, 'F');
    doc.setFillColor(...BLACK);
    doc.rect(marginL, curY, 2, blockH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(label.toUpperCase(), marginL + 6, curY + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLACK);
    valLines.forEach((line, i) => {
      doc.text(line, marginL + 6, curY + 10 + i * 5);
    });
    curY += blockH + 4;
  });
  spacer();

  // S24 Clinical Actions Summary
  sectionHeading('24. Clinical Actions Summary');
  kvRow('Total Actions', s24.total_actions);
  kvRow('Approved Count', s24.approved_count);
  kvRow('Rejected Count', s24.rejected_count);
  spacer();

  // ── Page numbers (final pass) ──────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.setDrawColor(...LGRAY);
    doc.setLineWidth(0.3);
    doc.line(marginL, pageH - 14, pageW - marginR, pageH - 14);
    doc.text('DoctorAssist.AI — Confidential Medical Record', marginL, pageH - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageW - marginR, pageH - 8, { align: 'right' });
  }

  const filename = `ED_Summary_${(patientName || 'Patient').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
};

// ─────────────────────────────────────────────────────────────────────────────
// Final Summary — Editable Field Component
// ─────────────────────────────────────────────────────────────────────────────
const EditableInfoRow = ({ label, value, editMode, fieldKey, onChange, extraStyle }) => {
  const val = value !== null && value !== undefined ? String(value) : '';

  if (!editMode && !val) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: editMode ? 'flex-start' : 'flex-start',
      padding: '10px 0',
      borderBottom: '1px solid #f0f0f0',
      gap: 12,
    }}>
      <span style={{
        fontSize: 11, color: '#999', width: 160, flexShrink: 0,
        paddingTop: editMode ? 8 : 1,
        textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600,
      }}>
        {label}
      </span>
      {editMode ? (
        <textarea
          value={val}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          rows={Math.max(2, Math.ceil(val.length / 60))}
          style={{
            flex: 1, fontSize: 13, color: '#222', lineHeight: 1.6,
            border: '1px solid #c0c0c0', borderRadius: 4,
            padding: '6px 10px', resize: 'vertical',
            fontFamily: "'DM Sans', sans-serif",
            background: '#fffef8',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = '#000'}
          onBlur={e => e.target.style.borderColor = '#c0c0c0'}
        />
      ) : (
        <span style={{ fontSize: 13, color: '#333', flex: 1, lineHeight: 1.6, ...(extraStyle || {}) }}>
          {val || 'N/A'}
        </span>
      )}
    </div>
  );
};

const EditableListField = ({ label, items, editMode, fieldKey, onChange }) => {
  const listVal = Array.isArray(items) ? items.join('\n') : '';
  if (!editMode && (!items || items.length === 0)) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>
        {label}
      </div>
      {editMode ? (
        <textarea
          value={listVal}
          onChange={(e) => onChange(fieldKey, e.target.value.split('\n'))}
          placeholder="One item per line..."
          rows={Math.max(3, (items || []).length + 1)}
          style={{
            width: '100%', fontSize: 13, color: '#222', lineHeight: 1.7,
            border: '1px solid #c0c0c0', borderRadius: 4,
            padding: '8px 10px', resize: 'vertical',
            fontFamily: "'DM Sans', sans-serif",
            background: '#fffef8',
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = '#000'}
          onBlur={e => e.target.style.borderColor = '#c0c0c0'}
        />
      ) : (
        <div style={{ padding: '2px 0' }}>
          {(items || []).filter(Boolean).map((item, i) => (
            <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13, color: '#333' }}>
              <span style={{ color: '#aaa', marginRight: 8 }}>•</span>{item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
const BoldInfoRow = ({ label, value, editMode, fieldKey, onChange }) => (
  <EditableInfoRow label={<b style={{color:'#000'}}>{label}</b>} value={value} editMode={editMode} fieldKey={fieldKey} onChange={onChange} />
);
const EditableParagraph = ({ text, editMode, fieldKey, onChange }) => {
  const val = text || '';
  if (!editMode && !val) return null;
  return editMode ? (
    <textarea
      value={val}
      onChange={(e) => onChange(fieldKey, e.target.value)}
      rows={Math.max(3, Math.ceil(val.length / 80))}
      style={{
        width: '100%', fontSize: 13, color: '#222', lineHeight: 1.7,
        border: '1px solid #c0c0c0', borderRadius: 4,
        padding: '8px 10px', resize: 'vertical',
        fontFamily: "'DM Sans', sans-serif",
        background: '#fffef8',
        outline: 'none',
        marginTop: 4,
      }}
      onFocus={e => e.target.style.borderColor = '#000'}
      onBlur={e => e.target.style.borderColor = '#c0c0c0'}
    />
  ) : (
    <p style={{ fontSize: 13, lineHeight: 1.8, color: '#444', padding: '8px 0' }}>{val}</p>
  );
};

// ─── Final Summary Section Card with editing support ─────────────────────────
const FSSectionCard = ({ title, children }) => (
  <div style={{ border: '1px solid #e8e8e8', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
    <div style={{ padding: '11px 16px', background: '#fafafa', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: '#e8e8e8' }} />
    </div>
    <div style={{ padding: '4px 16px 10px' }}>{children}</div>
  </div>
);
// ─── Insurance Documentation Tab Component ───────────────────────────────────

// ─── Final Summary Tab Content ────────────────────────────────────────────────
const FinalSummaryContent = ({ finalSummary, patientName, pdfLoading, setPdfLoading }) => {
  const [editMode, setEditMode]         = useState(false);
  const [editedData, setEditedData]     = useState(null);
  const [saveLoading, setSaveLoading]   = useState(false);

  // Deep clone on mount / when finalSummary changes
  useEffect(() => {
    if (finalSummary) {
      setEditedData(JSON.parse(JSON.stringify(finalSummary)));
    }
  }, [finalSummary]);

  if (!finalSummary || !editedData) return null;

  // ── Generic updater: dotted path like 'section_1_patient_information.full_name'
  const handleChange = (path, value) => {
    setEditedData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let ref = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (ref[keys[i]] === undefined) ref[keys[i]] = {};
        ref = ref[keys[i]];
      }
      ref[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setSaveLoading(true);
    try {
      // Optimistic save — update local state and close edit mode
      // If you have a save endpoint, call it here:
      // await fetch(`${API_BASE}/hms/users/ai-legacy/ed-summary/update/${patient.patient_id}`, {
      //   method: 'PUT', headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ final_summary: editedData }),
      // });
      await new Promise(r => setTimeout(r, 400)); // simulate
      setEditMode(false);
      alert('Summary saved successfully.');
    } catch (e) {
      console.error('Save error:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCancel = () => {
    setEditedData(JSON.parse(JSON.stringify(finalSummary)));
    setEditMode(false);
  };

  const s = editedData;
  const has = (val) => {
    if (val === null || val === undefined) return false;
    if (typeof val === 'string' && val.trim() === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  };

  const s1  = s.section_1_patient_information  || {};
  const s2  = s.section_2_arrival_details      || {};
  const s3  = s.section_3_incident_details     || {};
  const s4  = s.section_4_chief_complaint      || {};
  const s5  = s.section_5_emt_pre_hospital_report || {};
  const s6  = s.section_6_voice_note_processing || {};
  const s7  = s.section_7_ai_clinical_suggestion || {};
  const s8  = s.section_8_doctor_review_status || {};
  const s9  = s.section_9_doctor_manual_note   || {};
  const s10 = s.section_10_triage_information  || {};
  const s11 = s.section_11_initial_ed_assessment || {};
  const s12 = s.section_12_visible_injuries    || {};
  const s13 = s.section_13_physical_examination || {};
  const s14 = s.section_14_emergency_interventions || {};
  const s15 = s.section_15_known_medical_history?.known_medical_history || {};
  const s16 = s.section_16_working_diagnosis   || {};
  const s17 = s.section_17_clinical_progression || {};
  const s18 = s.section_18_specialist_alerts   || [];
  const s19 = s.section_19_ed_clinical_course  || {};
  const s20 = s.section_20_final_disposition   || {};
  const s21 = s.section_21_final_ed_summary    || {};
  const s22 = s.section_22_handover_information || {};
  const s23 = s.section_23_sbar_summary        || {};
  const s24 = s.section_24_clinical_actions_summary || {};

  // Helper for triage colour display
  const triageColor = s10.triage_colour === 'Red' ? '#dc2626'
    : s10.triage_colour === 'Yellow' ? '#ca8a04'
    : s10.triage_colour === 'Green' ? '#16a34a'
    : '#555';

  return (
    <div>
      {/* ── Action Bar ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20, flexWrap: 'wrap', gap: 10,
      }}>
        {/* Edit / Save / Cancel buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!editMode ? (
            <button
              onClick={() => setEditMode(true)}
              style={{
                background: '#fff', color: '#000',
                border: '1.5px solid #000',
                padding: '9px 20px', borderRadius: 4,
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                display: 'flex', alignItems: 'center', gap: 7,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
            >
              ✏️ Edit Summary
            </button>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={saveLoading}
                style={{
                  background: saveLoading ? '#555' : '#16a34a', color: '#fff',
                  border: 'none', padding: '9px 20px', borderRadius: 4,
                  fontSize: 13, fontWeight: 600,
                  cursor: saveLoading ? 'not-allowed' : 'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                  display: 'flex', alignItems: 'center', gap: 7,
                }}
              >
                {saveLoading ? <><Spinner size={13} color="#fff" /> Saving…</> : '✓ Save Changes'}
              </button>
              <button
                onClick={handleCancel}
                style={{
                  background: '#fff', color: '#555',
                  border: '1.5px solid #ccc',
                  padding: '9px 20px', borderRadius: 4,
                  fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                }}
              >
                ✕ Cancel
              </button>
            </>
          )}

          {editMode && (
            <span style={{
              fontSize: 11, color: '#ca8a04', fontWeight: 600,
              background: '#fffbeb', border: '1px solid #fde68a',
              padding: '4px 12px', borderRadius: 20,
            }}>
              ✏ Editing Mode — all fields are now editable
            </span>
          )}
        </div>

        {/* Download PDF button */}
        <button
          disabled={pdfLoading}
          onClick={async () => {
            setPdfLoading(true);
            try {
              await generateFinalSummaryPDF(editedData, patientName);
            } catch (e) {
              console.error('PDF error:', e);
              alert('Failed to generate PDF. Please try again.');
            } finally {
              setPdfLoading(false);
            }
          }}
          style={{
            background: pdfLoading ? '#888' : '#000',
            color: '#fff', border: 'none',
            padding: '9px 22px', borderRadius: 4,
            fontSize: 13, fontWeight: 600,
            cursor: pdfLoading ? 'not-allowed' : 'pointer',
            fontFamily: "'DM Sans', sans-serif",
            display: 'flex', alignItems: 'center', gap: 8,
            letterSpacing: '0.3px', transition: 'background .15s',
          }}
        >
          {pdfLoading ? <><Spinner size={13} color="#fff" /> Generating PDF…</> : '↓ Download PDF'}
        </button>
      </div>

 {/* ── Two-column grid ── */}
      {(() => {
        const has = (val) => {
          if (val === null || val === undefined) return false;
          if (typeof val === 'string' && val.trim() === '') return false;
          if (Array.isArray(val) && val.length === 0) return false;
          return true;
        };

        // Bold value style for critical fields
        const boldVal = { fontWeight: 700, color: '#000' };

        // All sections as ordered array — will alternate left/right
        const allSections = [

          // 1 — Patient Information
          (has(s1.full_name) || has(s1.age) || has(s1.gender) || editMode) && (
            <FSSectionCard title="1. Patient Information">
              <EditableInfoRow label="Full Name" value={s1.full_name} editMode={editMode} fieldKey="section_1_patient_information.full_name" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Age" value={s1.age} editMode={editMode} fieldKey="section_1_patient_information.age" onChange={handleChange} />
              <EditableInfoRow label="Gender" value={s1.gender} editMode={editMode} fieldKey="section_1_patient_information.gender" onChange={handleChange} />
              <EditableInfoRow label="Phone" value={s1.phone_number} editMode={editMode} fieldKey="section_1_patient_information.phone_number" onChange={handleChange} />
              <EditableInfoRow label="Address" value={s1.address} editMode={editMode} fieldKey="section_1_patient_information.address" onChange={handleChange} />
              <EditableInfoRow label="Date of Arrival" value={s1.date_of_arrival} editMode={editMode} fieldKey="section_1_patient_information.date_of_arrival" onChange={handleChange} />
              {(has(s1.emergency_contact_name) || editMode) && <>
                <EditableInfoRow label="Emerg. Contact" value={s1.emergency_contact_name} editMode={editMode} fieldKey="section_1_patient_information.emergency_contact_name" onChange={handleChange} />
                <EditableInfoRow label="Relationship" value={s1.emergency_contact_relationship} editMode={editMode} fieldKey="section_1_patient_information.emergency_contact_relationship" onChange={handleChange} />
                <EditableInfoRow label="Contact Phone" value={s1.emergency_contact_phone} editMode={editMode} fieldKey="section_1_patient_information.emergency_contact_phone" onChange={handleChange} />
              </>}
            </FSSectionCard>
          ),

          // 2 — Arrival Details
          (has(s2.mode_of_arrival) || has(s2.arrival_clinical_condition) || editMode) && (
            <FSSectionCard title="2. Arrival Details">
              <EditableInfoRow label="Mode of Arrival" value={s2.mode_of_arrival} editMode={editMode} fieldKey="section_2_arrival_details.mode_of_arrival" onChange={handleChange} />
              <EditableInfoRow label="EMT Driver" value={s2.emt_driver_name} editMode={editMode} fieldKey="section_2_arrival_details.emt_driver_name" onChange={handleChange} />
              <EditableInfoRow label="Referral Source" value={s2.referral_source} editMode={editMode} fieldKey="section_2_arrival_details.referral_source" onChange={handleChange} />
              <EditableInfoRow label="Transport Duration" value={s2.transport_duration_minutes ? `${s2.transport_duration_minutes} min` : ''} editMode={editMode} fieldKey="section_2_arrival_details.transport_duration_minutes" onChange={handleChange} />
              <EditableInfoRow label="Arrival Condition" value={s2.arrival_clinical_condition} editMode={editMode} fieldKey="section_2_arrival_details.arrival_clinical_condition" onChange={handleChange} extraStyle={boldVal} />
            </FSSectionCard>
          ),

          // 3 — Incident Details
          (has(s3.type_of_incident) || has(s3.location_of_incident) || editMode) && (
            <FSSectionCard title="3. Incident Details">
              <EditableInfoRow label="Type of Incident" value={s3.type_of_incident} editMode={editMode} fieldKey="section_3_incident_details.type_of_incident" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Mechanism of Injury" value={s3.mechanism_of_injury} editMode={editMode} fieldKey="section_3_incident_details.mechanism_of_injury" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Location" value={s3.location_of_incident} editMode={editMode} fieldKey="section_3_incident_details.location_of_incident" onChange={handleChange} />
              <EditableInfoRow label="Date of Incident" value={s3.date_of_incident} editMode={editMode} fieldKey="section_3_incident_details.date_of_incident" onChange={handleChange} />
              <EditableInfoRow label="Time of Incident" value={s3.time_of_incident} editMode={editMode} fieldKey="section_3_incident_details.time_of_incident" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 4 — Chief Complaint
          (has(s4.chief_complaint) || editMode) && (
            <FSSectionCard title="4. Chief Complaint">
              <EditableParagraph text={s4.chief_complaint} editMode={editMode} fieldKey="section_4_chief_complaint.chief_complaint" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 5 — EMT Pre-Hospital
          (has(s5.scene_findings) || has(s5.clinical_narrative_from_emt) || editMode) && (
            <FSSectionCard title="5. EMT Pre-Hospital Report">
              <EditableInfoRow label="Scene Findings" value={s5.scene_findings} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.scene_findings" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Consciousness" value={s5.consciousness_level_on_scene} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.consciousness_level_on_scene" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Airway" value={s5.airway} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.airway" onChange={handleChange} />
              <EditableInfoRow label="Breathing" value={s5.breathing} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.breathing" onChange={handleChange} />
              <EditableInfoRow label="Circulation" value={s5.circulation} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.circulation" onChange={handleChange} />
              <EditableInfoRow label="Bleeding Status" value={s5.bleeding_status} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.bleeding_status" onChange={handleChange} />
              <EditableInfoRow label="Time at Scene" value={s5.time_at_scene_minutes ? `${s5.time_at_scene_minutes} min` : ''} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.time_at_scene_minutes" onChange={handleChange} />
              <EditableInfoRow label="ETA to Hospital" value={s5.eta_to_hospital_minutes ? `${s5.eta_to_hospital_minutes} min` : ''} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.eta_to_hospital_minutes" onChange={handleChange} />
              {s5.vitals_on_scene && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Vitals on Scene</div>
                  <EditableInfoRow label="Pulse Rate" value={s5.vitals_on_scene.pulse_rate_bpm ? `${s5.vitals_on_scene.pulse_rate_bpm} bpm` : ''} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.vitals_on_scene.pulse_rate_bpm" onChange={handleChange} />
                  <EditableInfoRow label="Blood Pressure" value={s5.vitals_on_scene.blood_pressure} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.vitals_on_scene.blood_pressure" onChange={handleChange} />
                  <EditableInfoRow label="SpO2" value={s5.vitals_on_scene.spo2_percent ? `${s5.vitals_on_scene.spo2_percent}%` : ''} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.vitals_on_scene.spo2_percent" onChange={handleChange} />
                  <EditableInfoRow label="Resp Rate" value={s5.vitals_on_scene.respiratory_rate_bpm ? `${s5.vitals_on_scene.respiratory_rate_bpm} bpm` : ''} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.vitals_on_scene.respiratory_rate_bpm" onChange={handleChange} />
                  <EditableInfoRow label="GCS (est.)" value={s5.vitals_on_scene.gcs_estimated} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.vitals_on_scene.gcs_estimated" onChange={handleChange} />
                </div>
              )}
              {(has(s5.pre_hospital_interventions_performed) || editMode) && (
                <EditableListField label="Pre-Hospital Interventions" items={s5.pre_hospital_interventions_performed} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.pre_hospital_interventions_performed" onChange={handleChange} />
              )}
              {(has(s5.clinical_narrative_from_emt) || editMode) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Clinical Narrative</div>
                  <EditableParagraph text={s5.clinical_narrative_from_emt} editMode={editMode} fieldKey="section_5_emt_pre_hospital_report.clinical_narrative_from_emt" onChange={handleChange} />
                </div>
              )}
            </FSSectionCard>
          ),

          // 6 — Voice Notes
          s6.total_voice_notes > 0 && (
            <FSSectionCard title={`6. Voice Notes (${s6.total_voice_notes})`}>
              {(has(s6.combined_clinical_summary_from_voice) || editMode) && (
                <EditableParagraph text={s6.combined_clinical_summary_from_voice} editMode={editMode} fieldKey="section_6_voice_note_processing.combined_clinical_summary_from_voice" onChange={handleChange} />
              )}
              {s6.voice_notes?.filter(n => has(n.transcript)).map((note, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 4 }}>Note #{note.note_number || i + 1} — {note.date} {note.time}</div>
                  {editMode ? (
                    <textarea value={note.transcript || ''} onChange={(e) => { const newNotes = [...(s6.voice_notes || [])]; newNotes[i] = { ...newNotes[i], transcript: e.target.value }; handleChange('section_6_voice_note_processing.voice_notes', newNotes); }} rows={4} style={{ width: '100%', fontSize: 12, color: '#444', lineHeight: 1.7, border: '1px solid #c0c0c0', borderRadius: 4, padding: '8px 10px', fontFamily: "'DM Sans', sans-serif", background: '#fffef8', outline: 'none' }} />
                  ) : (
                    <p style={{ fontSize: 12, color: '#444', lineHeight: 1.7 }}>{note.transcript}</p>
                  )}
                </div>
              ))}
            </FSSectionCard>
          ),

          // 7 — AI Clinical Suggestion
          (has(s7.ai_generated_summary) || has(s7.key_clinical_recommendations) || has(s7.triage_suggestion) || editMode) && (
            <FSSectionCard title="7. AI Clinical Suggestion">
              <EditableInfoRow label="Triage Suggestion" value={s7.triage_suggestion} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.triage_suggestion" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Criticality Score" value={s7.criticality_score_suggested} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.criticality_score_suggested" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Confidence" value={s7.confidence_level} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.confidence_level" onChange={handleChange} />
              {(has(s7.ai_generated_summary) || editMode) && <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 8, marginBottom: 2 }}>AI Summary</div>
                <EditableParagraph text={s7.ai_generated_summary} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.ai_generated_summary" onChange={handleChange} />
              </>}
              {has(s7.image_ai_impression) && <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 8, marginBottom: 2 }}>Monitor Image Impression</div>
                <EditableParagraph text={s7.image_ai_impression} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.image_ai_impression" onChange={handleChange} />
                {has(s7.image_ai_context_note) && <p style={{ fontSize: 11, color: '#ca8a04', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '6px 10px', marginTop: 4, lineHeight: 1.5 }}>{s7.image_ai_context_note}</p>}
              </>}
              {(has(s7.key_clinical_recommendations) || editMode) && <EditableListField label="Key Recommendations" items={s7.key_clinical_recommendations} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.key_clinical_recommendations" onChange={handleChange} />}
              {(has(s7.suggested_immediate_interventions) || editMode) && <EditableListField label="Suggested Interventions" items={s7.suggested_immediate_interventions} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.suggested_immediate_interventions" onChange={handleChange} />}
              {(has(s7.suggested_investigations) || editMode) && <EditableListField label="Suggested Investigations" items={s7.suggested_investigations} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.suggested_investigations" onChange={handleChange} />}
              {(has(s7.hospital_prep_instructions) || editMode) && <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 8, marginBottom: 2 }}>Hospital Prep</div>
                <EditableParagraph text={s7.hospital_prep_instructions} editMode={editMode} fieldKey="section_7_ai_clinical_suggestion.hospital_prep_instructions" onChange={handleChange} />
              </>}
            </FSSectionCard>
          ),

          // 8 — Doctor Review
          (has(s8.ai_review_decision) || has(s8.reviewer_summary) || editMode) && (
            <FSSectionCard title="8. Doctor Review Status">
              <EditableInfoRow label="Review Decision" value={s8.ai_review_decision} editMode={editMode} fieldKey="section_8_doctor_review_status.ai_review_decision" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Total Reviews" value={s8.total_reviews_performed} editMode={editMode} fieldKey="section_8_doctor_review_status.total_reviews_performed" onChange={handleChange} />
              <EditableInfoRow label="Approved" value={s8.approved_count} editMode={editMode} fieldKey="section_8_doctor_review_status.approved_count" onChange={handleChange} />
              <EditableInfoRow label="Rejected" value={s8.rejected_count} editMode={editMode} fieldKey="section_8_doctor_review_status.rejected_count" onChange={handleChange} />
              <EditableInfoRow label="Review Timestamp" value={s8.review_timestamp ? fmtDate(s8.review_timestamp) : ''} editMode={editMode} fieldKey="section_8_doctor_review_status.review_timestamp" onChange={handleChange} />
              <EditableInfoRow label="Reviewer Summary" value={s8.reviewer_summary} editMode={editMode} fieldKey="section_8_doctor_review_status.reviewer_summary" onChange={handleChange} extraStyle={boldVal} />
            </FSSectionCard>
          ),

          // 9 — Doctor Manual Note
          (has(s9.manual_clinical_summary) || has(s9.corrections_or_additions_to_ai) || has(s9.additional_clinical_findings) || editMode) && (
            <FSSectionCard title="9. Doctor Manual Note">
              <EditableInfoRow label="Manual Summary" value={s9.manual_clinical_summary} editMode={editMode} fieldKey="section_9_doctor_manual_note.manual_clinical_summary" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Corrections" value={s9.corrections_or_additions_to_ai} editMode={editMode} fieldKey="section_9_doctor_manual_note.corrections_or_additions_to_ai" onChange={handleChange} />
              <EditableInfoRow label="Additional Findings" value={s9.additional_clinical_findings} editMode={editMode} fieldKey="section_9_doctor_manual_note.additional_clinical_findings" onChange={handleChange} />
              <EditableInfoRow label="Entered At" value={s9.doctor_entered_at ? fmtDate(s9.doctor_entered_at) : ''} editMode={editMode} fieldKey="section_9_doctor_manual_note.doctor_entered_at" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 10 — Triage
          (has(s10.triage_colour) || has(s10.triage_rationale) || editMode) && (
            <FSSectionCard title="10. Triage Information">
              {(has(s10.triage_colour) || editMode) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ fontSize: 11, color: '#999', width: 160, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>Triage Colour</span>
                  {editMode ? (
                    <select value={s10.triage_colour || ''} onChange={(e) => handleChange('section_10_triage_information.triage_colour', e.target.value)} style={{ fontSize: 13, border: '1px solid #c0c0c0', borderRadius: 4, padding: '6px 10px', fontFamily: "'DM Sans', sans-serif", background: '#fffef8' }}>
                      <option value="">Select...</option>
                      <option value="Red">Red</option>
                      <option value="Yellow">Yellow</option>
                      <option value="Green">Green</option>
                      <option value="Black">Black</option>
                    </select>
                  ) : (
                    <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 3, fontSize: 12, fontWeight: 700, background: triageColor, color: '#fff' }}>{s10.triage_colour}</span>
                  )}
                </div>
              )}
              <EditableInfoRow label="Category" value={s10.triage_category} editMode={editMode} fieldKey="section_10_triage_information.triage_category" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Criticality Score" value={s10.criticality_score ? `${s10.criticality_score} / 10` : ''} editMode={editMode} fieldKey="section_10_triage_information.criticality_score" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Risk Level" value={s10.risk_level} editMode={editMode} fieldKey="section_10_triage_information.risk_level" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Rationale" value={s10.triage_rationale} editMode={editMode} fieldKey="section_10_triage_information.triage_rationale" onChange={handleChange} />
              <EditableInfoRow label="Triage At" value={s10.triage_performed_at ? fmtDate(s10.triage_performed_at) : ''} editMode={editMode} fieldKey="section_10_triage_information.triage_performed_at" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 11 — ABCDE
          (s11.abcde_summary || editMode) && (
            <FSSectionCard title="11. Initial ED Assessment — ABCDE">
              {['A_airway', 'B_breathing', 'C_circulation', 'D_disability', 'E_exposure'].map((key) => (
                <EditableInfoRow key={key} label={key.replace(/_/g, ' ')} value={(s11.abcde_summary || {})[key]} editMode={editMode} fieldKey={`section_11_initial_ed_assessment.abcde_summary.${key}`} onChange={handleChange} extraStyle={key === 'C_circulation' || key === 'D_disability' ? boldVal : undefined} />
              ))}
              <EditableInfoRow label="GCS Total" value={s11.gcs_total ? `${s11.gcs_total} / 15` : ''} editMode={editMode} fieldKey="section_11_initial_ed_assessment.gcs_total" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="AVPU" value={s11.avpu} editMode={editMode} fieldKey="section_11_initial_ed_assessment.avpu" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Neurological" value={s11.neurological_findings} editMode={editMode} fieldKey="section_11_initial_ed_assessment.neurological_findings" onChange={handleChange} />
              {s11.initial_vitals_in_ed && <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 8, marginBottom: 4 }}>Initial Vitals in ED</div>
                <EditableInfoRow label="Pulse Rate" value={s11.initial_vitals_in_ed.pulse_rate_bpm ? `${s11.initial_vitals_in_ed.pulse_rate_bpm} bpm` : ''} editMode={editMode} fieldKey="section_11_initial_ed_assessment.initial_vitals_in_ed.pulse_rate_bpm" onChange={handleChange} />
                <EditableInfoRow label="Blood Pressure" value={s11.initial_vitals_in_ed.blood_pressure} editMode={editMode} fieldKey="section_11_initial_ed_assessment.initial_vitals_in_ed.blood_pressure" onChange={handleChange} extraStyle={boldVal} />
                <EditableInfoRow label="SpO2" value={s11.initial_vitals_in_ed.spo2_percent ? `${s11.initial_vitals_in_ed.spo2_percent}%` : ''} editMode={editMode} fieldKey="section_11_initial_ed_assessment.initial_vitals_in_ed.spo2_percent" onChange={handleChange} extraStyle={boldVal} />
                <EditableInfoRow label="Resp Rate" value={s11.initial_vitals_in_ed.respiratory_rate_bpm ? `${s11.initial_vitals_in_ed.respiratory_rate_bpm} bpm` : ''} editMode={editMode} fieldKey="section_11_initial_ed_assessment.initial_vitals_in_ed.respiratory_rate_bpm" onChange={handleChange} />
                <EditableInfoRow label="Temperature" value={s11.initial_vitals_in_ed.temperature_celsius ? `${s11.initial_vitals_in_ed.temperature_celsius} °C` : ''} editMode={editMode} fieldKey="section_11_initial_ed_assessment.initial_vitals_in_ed.temperature_celsius" onChange={handleChange} />
              </>}
            </FSSectionCard>
          ),

          // 12 — Visible Injuries
          (has(s12.visible_injuries) || editMode) && (
            <FSSectionCard title="12. Visible Injuries">
              <EditableListField label="Injuries" items={s12.visible_injuries} editMode={editMode} fieldKey="section_12_visible_injuries.visible_injuries" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 13 — Physical Examination
          (Object.values(s13).some(v => has(v)) || editMode) && (
            <FSSectionCard title="13. Physical Examination">
              {[['Head & Face','head_and_face'],['Neck & Cervical Spine','neck_and_cervical_spine'],['Chest & Thorax','chest_and_thorax'],['Abdomen','abdomen'],['Pelvis','pelvis'],['Spine & Back','spine_and_back'],['Upper Limbs','upper_limbs'],['Lower Limbs','lower_limbs'],['Wounds & Bleeding','wounds_lacerations_and_bleeding'],['Skin Findings','skin_findings']].map(([label,key]) => (
                <EditableInfoRow key={key} label={label} value={s13[key]} editMode={editMode} fieldKey={`section_13_physical_examination.${key}`} onChange={handleChange} />
              ))}
              {has(s13.monitor_clinical_data) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Monitor Clinical Data</div>
                  <EditableParagraph text={s13.monitor_clinical_data} editMode={editMode} fieldKey="section_13_physical_examination.monitor_clinical_data" onChange={handleChange} />
                </div>
              )}
            </FSSectionCard>
          ),

          // 14 — Emergency Interventions
          (has(s14.airway_management) || s14.oxygen_therapy?.applied || has(s14.haemorrhage_control_measures) || editMode) && (
            <FSSectionCard title="14. Emergency Interventions">
              {(has(s14.airway_management) || editMode) && <EditableListField label="Airway Management" items={s14.airway_management} editMode={editMode} fieldKey="section_14_emergency_interventions.airway_management" onChange={handleChange} />}
              {(s14.oxygen_therapy?.applied || editMode) && <EditableInfoRow label="Oxygen Therapy" value={[s14.oxygen_therapy?.delivery_device, s14.oxygen_therapy?.flow_rate_lpm ? `${s14.oxygen_therapy.flow_rate_lpm} L/min` : null, s14.oxygen_therapy?.target_spo2 ? `Target: ${s14.oxygen_therapy.target_spo2}%` : null].filter(Boolean).join(' · ')} editMode={editMode} fieldKey="section_14_emergency_interventions.oxygen_therapy.delivery_device" onChange={handleChange} />}
              {s14.iv_access_and_fluids?.iv_access_established && (
                <EditableInfoRow label="IV Access & Fluids" value={[s14.iv_access_and_fluids?.fluid_type, s14.iv_access_and_fluids?.volume_ml ? `${s14.iv_access_and_fluids.volume_ml} mL` : null, s14.iv_access_and_fluids?.rate].filter(Boolean).join(' · ') || 'Established'} editMode={editMode} fieldKey="section_14_emergency_interventions.iv_access_and_fluids.fluid_type" onChange={handleChange} extraStyle={boldVal} />
              )}
              {(has(s14.haemorrhage_control_measures) || editMode) && <EditableListField label="Haemorrhage Control" items={s14.haemorrhage_control_measures} editMode={editMode} fieldKey="section_14_emergency_interventions.haemorrhage_control_measures" onChange={handleChange} />}
              {(has(s14.immobilization_applied) || editMode) && <EditableListField label="Immobilization" items={s14.immobilization_applied} editMode={editMode} fieldKey="section_14_emergency_interventions.immobilization_applied" onChange={handleChange} />}
              {(has(s14.medications_administered) || editMode) && <EditableListField label="Medications Administered" items={s14.medications_administered} editMode={editMode} fieldKey="section_14_emergency_interventions.medications_administered" onChange={handleChange} />}
              {(has(s14.other_interventions) || editMode) && <EditableListField label="Other Interventions" items={s14.other_interventions} editMode={editMode} fieldKey="section_14_emergency_interventions.other_interventions" onChange={handleChange} />}
              <EditableInfoRow label="CPR Performed" value={s14.cpr_performed !== null && s14.cpr_performed !== undefined ? (s14.cpr_performed ? 'Yes' : 'No') : ''} editMode={editMode} fieldKey="section_14_emergency_interventions.cpr_performed" onChange={handleChange} />
              <EditableInfoRow label="Defibrillation" value={s14.defibrillation_performed !== null && s14.defibrillation_performed !== undefined ? (s14.defibrillation_performed ? 'Yes' : 'No') : ''} editMode={editMode} fieldKey="section_14_emergency_interventions.defibrillation_performed" onChange={handleChange} />
              <EditableInfoRow label="Total Interventions" value={s14.total_intervention_count} editMode={editMode} fieldKey="section_14_emergency_interventions.total_intervention_count" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 15 — Medical History
          (has(s15.diabetes) || has(s15.hypertension) || has(s15.cardiac) || has(s15.allergies) || has(s15.current_medications) || has(s15.other_conditions) || editMode) && (
            <FSSectionCard title="15. Known Medical History">
              <EditableInfoRow label="Diabetes" value={s15.diabetes} editMode={editMode} fieldKey="section_15_known_medical_history.known_medical_history.diabetes" onChange={handleChange} />
              <EditableInfoRow label="Hypertension" value={s15.hypertension} editMode={editMode} fieldKey="section_15_known_medical_history.known_medical_history.hypertension" onChange={handleChange} />
              <EditableInfoRow label="Cardiac" value={s15.cardiac} editMode={editMode} fieldKey="section_15_known_medical_history.known_medical_history.cardiac" onChange={handleChange} />
              <EditableInfoRow label="Allergies" value={s15.allergies} editMode={editMode} fieldKey="section_15_known_medical_history.known_medical_history.allergies" onChange={handleChange} extraStyle={boldVal} />
              {(has(s15.current_medications) || editMode) && <EditableListField label="Current Medications" items={s15.current_medications} editMode={editMode} fieldKey="section_15_known_medical_history.known_medical_history.current_medications" onChange={handleChange} />}
              {(has(s15.other_conditions) || editMode) && <EditableListField label="Other Conditions" items={s15.other_conditions} editMode={editMode} fieldKey="section_15_known_medical_history.known_medical_history.other_conditions" onChange={handleChange} />}
            </FSSectionCard>
          ),

          // 16 — Working Diagnosis
          (has(s16.primary_diagnosis) || editMode) && (
            <FSSectionCard title="16. Working Diagnosis">
              <EditableInfoRow label="Primary Diagnosis" value={s16.primary_diagnosis} editMode={editMode} fieldKey="section_16_working_diagnosis.primary_diagnosis" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Confidence" value={s16.diagnosis_confidence} editMode={editMode} fieldKey="section_16_working_diagnosis.diagnosis_confidence" onChange={handleChange} />
              <EditableInfoRow label="ICD Code (approx)" value={s16.icd_code_approximate} editMode={editMode} fieldKey="section_16_working_diagnosis.icd_code_approximate" onChange={handleChange} />
              {(has(s16.secondary_diagnoses) || editMode) && <EditableListField label="Secondary Diagnoses" items={s16.secondary_diagnoses} editMode={editMode} fieldKey="section_16_working_diagnosis.secondary_diagnoses" onChange={handleChange} />}
              {(has(s16.suspected_injuries) || editMode) && <EditableListField label="Suspected Injuries" items={s16.suspected_injuries} editMode={editMode} fieldKey="section_16_working_diagnosis.suspected_injuries" onChange={handleChange} />}
              {(has(s16.differential_diagnoses) || editMode) && <EditableListField label="Differential Diagnoses" items={s16.differential_diagnoses} editMode={editMode} fieldKey="section_16_working_diagnosis.differential_diagnoses" onChange={handleChange} />}
            </FSSectionCard>
          ),

          // 17 — Clinical Progression
          (has(s17.overall_trend) || has(s17.current_clinical_status) || editMode) && (
            <FSSectionCard title="17. Clinical Progression">
              <EditableInfoRow label="Overall Trend" value={s17.overall_trend} editMode={editMode} fieldKey="section_17_clinical_progression.overall_trend" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Response to Interventions" value={s17.response_to_interventions} editMode={editMode} fieldKey="section_17_clinical_progression.response_to_interventions" onChange={handleChange} />
              <EditableInfoRow label="Current Status" value={humanizeClinicalText(s17.current_clinical_status)} editMode={editMode} fieldKey="section_17_clinical_progression.current_clinical_status" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Trajectory Note" value={s17.trajectory_clinical_note} editMode={editMode} fieldKey="section_17_clinical_progression.trajectory_clinical_note" onChange={handleChange} />
              {has(s17.dictation_by_dictation_progression) && Array.isArray(s17.dictation_by_dictation_progression) && s17.dictation_by_dictation_progression.map((p, i) => (
                typeof p === 'string' ? (
                  <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 12, color: '#555', lineHeight: 1.6 }}>• {humanizeClinicalText(p)}</div>
                ) : (
                  <div key={i} style={{ marginTop: 10, border: '1px solid #f0f0f0', borderRadius: 4, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#000', marginBottom: 4 }}>Note #{p.note_number} — {p.timestamp ? fmtDate(p.timestamp) : ''}</div>
                    {has(p.status_at_this_time) && <p style={{ fontSize: 12, color: '#444', lineHeight: 1.6, marginBottom: 4 }}>{p.status_at_this_time}</p>}
                    {has(p.key_clinical_findings) && p.key_clinical_findings.map((f, fi) => <div key={fi} style={{ fontSize: 12, color: '#555', marginLeft: 10, marginBottom: 3 }}>• {f}</div>)}
                    {has(p.change_from_previous) && <div style={{ fontSize: 11, fontWeight: 600, color: p.change_from_previous === 'Worsened' ? '#d32f2f' : p.change_from_previous === 'Improved' ? '#2e7d32' : '#666', marginTop: 4 }}>Change: {p.change_from_previous}</div>}
                  </div>
                )
              ))}
            </FSSectionCard>
          ),

          // 18 — Specialist Alerts
          s18.length > 0 && (
            <FSSectionCard title="18. Specialist Alerts">
              {s18.filter(a => has(a.specialty)).map((alert, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ width: 3, flexShrink: 0, alignSelf: 'stretch', background: alert.urgency === 'Immediate' ? '#dc2626' : alert.urgency === 'Urgent' ? '#ca8a04' : '#16a34a', borderRadius: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>{alert.specialty}</div>
                    {editMode ? (
                      <textarea value={alert.reason || ''} onChange={(e) => { const newAlerts = [...s18]; newAlerts[i] = { ...newAlerts[i], reason: e.target.value }; handleChange('section_18_specialist_alerts', newAlerts); }} rows={2} style={{ width: '100%', fontSize: 12, border: '1px solid #c0c0c0', borderRadius: 4, padding: '4px 8px', marginTop: 4, fontFamily: "'DM Sans', sans-serif", background: '#fffef8', outline: 'none' }} />
                    ) : has(alert.reason) && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{alert.reason}</div>}
                    <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{[alert.urgency, alert.response_status, alert.alert_time ? fmtDate(alert.alert_time) : null].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              ))}
            </FSSectionCard>
          ),

          // 19 — ED Clinical Course
          (has(s19.narrative) || has(s19.key_events_chronological) || editMode) && (
            <FSSectionCard title="19. ED Clinical Course">
              <EditableParagraph text={s19.narrative} editMode={editMode} fieldKey="section_19_ed_clinical_course.narrative" onChange={handleChange} />
              <EditableInfoRow label="Patient Response" value={s19.patient_response_to_treatment} editMode={editMode} fieldKey="section_19_ed_clinical_course.patient_response_to_treatment" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Complications" value={s19.complications_noted} editMode={editMode} fieldKey="section_19_ed_clinical_course.complications_noted" onChange={handleChange} extraStyle={boldVal} />
              {(has(s19.key_events_chronological) || editMode) && <EditableListField label="Key Events (Chronological)" items={(s19.key_events_chronological || []).map(humanizeClinicalText)} editMode={editMode} fieldKey="section_19_ed_clinical_course.key_events_chronological" onChange={handleChange} />}
              {(has(s19.significant_changes_in_ed) || editMode) && <EditableListField label="Significant Changes" items={s19.significant_changes_in_ed} editMode={editMode} fieldKey="section_19_ed_clinical_course.significant_changes_in_ed" onChange={handleChange} />}
            </FSSectionCard>
          ),

          // 20 — Final Disposition
          (has(s20.disposition) || editMode) && (
            <FSSectionCard title="20. Final Disposition">
              <EditableInfoRow label="Disposition" value={s20.disposition} editMode={editMode} fieldKey="section_20_final_disposition.disposition" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Destination Unit" value={s20.destination_unit} editMode={editMode} fieldKey="section_20_final_disposition.destination_unit" onChange={handleChange} />
              <EditableInfoRow label="Urgency" value={s20.urgency} editMode={editMode} fieldKey="section_20_final_disposition.urgency" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Condition" value={s20.condition_at_disposition} editMode={editMode} fieldKey="section_20_final_disposition.condition_at_disposition" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Disposition Time" value={s20.disposition_time ? fmtDate(s20.disposition_time) : ''} editMode={editMode} fieldKey="section_20_final_disposition.disposition_time" onChange={handleChange} />
              <EditableInfoRow label="Rationale" value={s20.rationale} editMode={editMode} fieldKey="section_20_final_disposition.rationale" onChange={handleChange} />
            </FSSectionCard>
          ),

          // 21 — Final ED Summary
          (has(s21.consolidated_narrative) || editMode) && (
            <FSSectionCard title="21. Final ED Summary">
              <EditableParagraph text={s21.consolidated_narrative} editMode={editMode} fieldKey="section_21_final_ed_summary.consolidated_narrative" onChange={handleChange} />
              <EditableInfoRow label="Outcome at Discharge" value={s21.outcome_at_ed_discharge} editMode={editMode} fieldKey="section_21_final_ed_summary.outcome_at_ed_discharge" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Follow-up Instructions" value={s21.follow_up_instructions} editMode={editMode} fieldKey="section_21_final_ed_summary.follow_up_instructions" onChange={handleChange} />
              {(has(s21.clinical_highlights) || editMode) && <EditableListField label="Clinical Highlights" items={s21.clinical_highlights} editMode={editMode} fieldKey="section_21_final_ed_summary.clinical_highlights" onChange={handleChange} />}
              {(has(s21.outstanding_issues) || editMode) && <EditableListField label="Outstanding Issues" items={(s21.outstanding_issues || []).map(humanizeClinicalText)} editMode={editMode} fieldKey="section_21_final_ed_summary.outstanding_issues" onChange={handleChange} />}
            </FSSectionCard>
          ),

          // 22 — Handover
          (has(s22.handover_to) || has(s22.handover_summary) || editMode) && (
            <FSSectionCard title="22. Handover Information">
              <EditableInfoRow label="Handover To" value={s22.handover_to} editMode={editMode} fieldKey="section_22_handover_information.handover_to" onChange={handleChange} extraStyle={boldVal} />
              <EditableInfoRow label="Receiving Unit" value={s22.receiving_unit} editMode={editMode} fieldKey="section_22_handover_information.receiving_unit" onChange={handleChange} />
              <EditableInfoRow label="Summary" value={s22.handover_summary} editMode={editMode} fieldKey="section_22_handover_information.handover_summary" onChange={handleChange} />
              {(has(s22.critical_points_for_receiving_team) || editMode) && <EditableListField label="Critical Points for Receiving Team" items={s22.critical_points_for_receiving_team} editMode={editMode} fieldKey="section_22_handover_information.critical_points_for_receiving_team" onChange={handleChange} />}
              {(has(s22.pending_investigations_at_handover) || editMode) && <EditableListField label="Pending Investigations" items={s22.pending_investigations_at_handover} editMode={editMode} fieldKey="section_22_handover_information.pending_investigations_at_handover" onChange={handleChange} />}
              {(has(s22.monitoring_requirements) || editMode) && <EditableListField label="Monitoring Requirements" items={s22.monitoring_requirements} editMode={editMode} fieldKey="section_22_handover_information.monitoring_requirements" onChange={handleChange} />}
            </FSSectionCard>
          ),

          // 23 — SBAR
          (has(s23.situation) || has(s23.background) || editMode) && (
            <FSSectionCard title="23. SBAR Summary">
              {[['Situation','situation','section_23_sbar_summary.situation'],['Background','background','section_23_sbar_summary.background'],['Assessment','assessment','section_23_sbar_summary.assessment'],['Recommendation','recommendation','section_23_sbar_summary.recommendation']].map(([label, key, path]) => (
                (has(s23[key]) || editMode) && (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa', marginBottom: 4 }}>{label}</div>
                    <EditableParagraph text={s23[key]} editMode={editMode} fieldKey={path} onChange={handleChange} />
                  </div>
                )
              ))}
            </FSSectionCard>
          ),

          // 24 — Clinical Actions Summary
          (has(s24.total_actions) || has(s24.approved_count) || editMode) && (
            <FSSectionCard title="24. Clinical Actions Summary">
              <EditableInfoRow label="Total Actions" value={s24.total_actions} editMode={editMode} fieldKey="section_24_clinical_actions_summary.total_actions" onChange={handleChange} />
              <EditableInfoRow label="Approved" value={s24.approved_count} editMode={editMode} fieldKey="section_24_clinical_actions_summary.approved_count" onChange={handleChange} />
              <EditableInfoRow label="Rejected" value={s24.rejected_count} editMode={editMode} fieldKey="section_24_clinical_actions_summary.rejected_count" onChange={handleChange} />
            </FSSectionCard>
          ),

        ].filter(Boolean);

        // Alternate into left and right columns
        const leftCol  = allSections.filter((_, i) => i % 2 === 0);
        const rightCol = allSections.filter((_, i) => i % 2 !== 0);

        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', alignItems: 'start' }}>
            <div>{leftCol}</div>
            <div>{rightCol}</div>
          </div>
        );
      })()}

      {/* Bottom Save/Cancel bar in edit mode */}
      {editMode && (
        <div style={{
          position: 'sticky', bottom: 0,
          background: '#fff', borderTop: '1px solid #e8e8e8',
          padding: '14px 0', marginTop: 20,
          display: 'flex', gap: 12, alignItems: 'center',
          zIndex: 100,
        }}>
          <button
            onClick={handleSave}
            disabled={saveLoading}
            style={{
              background: saveLoading ? '#555' : '#16a34a', color: '#fff',
              border: 'none', padding: '11px 28px', borderRadius: 4,
              fontSize: 14, fontWeight: 600,
              cursor: saveLoading ? 'not-allowed' : 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {saveLoading ? <><Spinner size={14} color="#fff" /> Saving…</> : '✓ Save Changes'}
          </button>
          <button
            onClick={handleCancel}
            style={{
              background: '#fff', color: '#555',
              border: '1.5px solid #ccc',
              padding: '11px 24px', borderRadius: 4,
              fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            }}
          >
            ✕ Cancel
          </button>
          
        </div>
      )}
    </div>
  );
};

// ─── Image Gallery Component ──────────────────────────────────────────────────
const ImageGallery = ({ patientId }) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImg, setSelectedImg] = useState(null);

  const fetchImages = async () => {
    if (!patientId) return;
    setLoading(true);
    try {
   const r = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/image/${patientId}`);
      const d = await r.json();
      if (d.status === 'success') setImages(d.images || []);
    } catch (e) { console.error('Image fetch error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchImages(); }, [patientId]);

  if (loading) return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 40, justifyContent: 'center' }}>
      <Spinner /><span style={{ fontSize: 13, color: '#999' }}>Loading images…</span>
    </div>
  );

  if (images.length === 0) return (
    <div style={{ textAlign: 'center', padding: 60, color: '#aaa', fontSize: 13, border: '1px dashed #e0e0e0', borderRadius: 6 }}>
      No clinical images received yet.
    </div>
  );

  return (
    <div>
      {selectedImg && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setSelectedImg(null)}>
          <div style={{ position: 'relative', maxWidth: 800, width: '100%' }} onClick={e => e.stopPropagation()}>
            <img src={selectedImg.image_url} alt="Clinical" style={{ width: '100%', borderRadius: 6, display: 'block' }} />
            <button onClick={() => setSelectedImg(null)} style={{
              position: 'absolute', top: -16, right: -16,
              background: '#fff', border: 'none', width: 32, height: 32,
              borderRadius: '50%', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}>✕</button>
            <div style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '10px 14px', borderRadius: '0 0 6px 6px', fontSize: 12 }}>
              {selectedImg.driver_name && <span>Driver: {selectedImg.driver_name} · </span>}
              {selectedImg.vehicle_number && <span>Vehicle: {selectedImg.vehicle_number} · </span>}
              <span>{selectedImg.created_at ? new Date(selectedImg.created_at).toLocaleString() : ''}</span>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={fetchImages} style={{
          background: 'none', border: '1px solid #e0e0e0', padding: '7px 14px',
          borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 500,
          color: '#555', fontFamily: "'DM Sans', sans-serif",
        }}>⟳ Reload</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {images.map((img, i) => (
          <div key={i} style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
            onClick={() => setSelectedImg(img)}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
            <img src={img.image_url} alt={`Clinical ${i + 1}`} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', background: '#f5f5f5' }} />
            <div style={{ padding: '10px 12px', background: '#fafafa' }}>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 3 }}>
                {img.driver_name || 'Paramedic'}
              </div>
              <div style={{ fontSize: 10, color: '#aaa' }}>
                {img.created_at ? new Date(img.created_at).toLocaleString() : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function PatientProfileEmergency() {
  const navigate = useNavigate();

  // ── State ──
  const [patient, setPatient]           = useState(null);
const [activeTab, setActiveTab] = useState('patient');
  const [dictTab, setDictTab]           = useState('voice');
  const [rpmTab, setRpmTab]             = useState('rpm');

  const [voiceDictations, setVoiceDictations] = useState([]);
  const [clinicalActions, setClinicalActions] = useState([]);
  const [notes, setNotes]                     = useState([]);
const [showStructuredNote, setShowStructuredNote] = useState(false);
  const [loadingDicts, setLoadingDicts]       = useState(false);
  const [mergedTimeline, setMergedTimeline] = useState([]);
  const [loadingClinical, setLoadingClinical] = useState(false);
  const [finalSummary, setFinalSummary]       = useState(null);
  const [finalSummaryLoading, setFinalSummaryLoading] = useState(false);
  const [loadingNotes, setLoadingNotes]       = useState(false);
  const [doctorNotes, setDoctorNotes] = useState([]);
  const [extractedData, setExtractedData] = useState([]);
const [extractedDataLoading, setExtractedDataLoading] = useState(false);
  const [pdfLoading, setPdfLoading]           = useState(false);
  const [notesFilter, setNotesFilter] = useState('all');
const [notesExtractedData, setNotesExtractedData] = useState([]);
const [showFinalSummary, setShowFinalSummary] = useState(false);
// Structured Note State
  const [structuredNote, setStructuredNote] = useState(null);
  const [structuredNoteLoading, setStructuredNoteLoading] = useState(false);
  const handleStructuredNoteRefresh = useCallback((note) => setStructuredNote(note), []);
  const handleStructuredNoteLoadingChange = useCallback((isLoading) => setStructuredNoteLoading(isLoading), []);
  const [showDataProcessing, setShowDataProcessing] = useState(false);
const dataProcessingRef = useRef(null);

  // Zenzo
  const [iframeUrl, setIframeUrl]       = useState('');
const [rpmOpened, setRpmOpened]       = useState(false);
  const [zenzoLoading, setZenzoLoading] = useState(false);
  const [zenzoStatus, setZenzoStatus]   = useState('');
const [showInsuranceDoc, setShowInsuranceDoc] = useState(false);
  // Modal
  const [incidentCompleted, setIncidentCompleted] = useState(false);
const incidentPollRef = useRef(null);
const [modal, setModal] = useState({ open: false, data: null, type: null });

  // ── New patient (global) notification ──
  const knownAllPatientIdsRef = useRef(null);
  const [newPatientAlerts, setNewPatientAlerts] = useState([]);
  // Voice recording
  const [showVoiceSection, setShowVoiceSection] = useState(true);
 const [dictationText, setDictationText]       = useState('');
  const [isRecording, setIsRecording]           = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [voiceSubmitLoading, setVoiceSubmitLoading] = useState(false);

  // Doctor Note section - separate state so it doesn't interfere with Voice Notes section
  const [doctorNoteText, setDoctorNoteText]       = useState('');
  const [isRecordingDoctor, setIsRecordingDoctor] = useState(false);
  const [transcribeLoadingDoctor, setTranscribeLoadingDoctor] = useState(false);
  const [doctorNoteSubmitLoading, setDoctorNoteSubmitLoading] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);
const hasLoadedNotesOnce = useRef(false);   // ← add this
  const mediaRecorderRefDoctor = useRef(null);
  const audioChunksRefDoctor   = useRef([]);
  const streamRefDoctor        = useRef(null);
  const voiceSectionRef  = useRef(null);
 const iframeRef        = useRef(null);



  // ── New patient detection (independent of selected patient) ──
  useEffect(() => {
    const pollNewPatients = async () => {
      try {
        const r = await fetch(`${API_BASE}/hms/users/emergencypatients/get_today_patients-with-timestamp-and-withotut-limit`);
        const d = await r.json();
        if (d.status === 'success') {
          const currentIds = new Set((d.patients || []).map((p) => p.patient_id));
          if (knownAllPatientIdsRef.current === null) {
            knownAllPatientIdsRef.current = currentIds;
          } else {
            const newOnes = (d.patients || []).filter((p) => !knownAllPatientIdsRef.current.has(p.patient_id));
            if (newOnes.length > 0) {
              setNewPatientAlerts((prev) => [...prev, ...newOnes]);
            }
            knownAllPatientIdsRef.current = currentIds;
          }
        }
      } catch (e) { console.error('New patient poll error:', e); }
    };
    pollNewPatients();
    const interval = setInterval(pollNewPatients, 20000);
    return () => clearInterval(interval);
  }, []);

  // ── Auto-refresh History Section (Voice Dictations / Clinical Actions / Image Suggestions) ──
  useEffect(() => {
    if (!patient) return;
    const historyInterval = setInterval(() => {
      fetchVoiceDictations();
      fetchClinicalActions();
      fetchExtractedData();
    }, 15000);
    return () => clearInterval(historyInterval);
  }, [patient]);

  // ── On Mount ──

  // ── On Mount ──
  useEffect(() => {
    const raw = localStorage.getItem('selected_patient');
    if (!raw) { window.location.href = '/Doctor-Emergency-Dashbaord'; return; }
    setPatient(JSON.parse(raw));
  }, []);
 useEffect(() => {
    setIframeUrl('');
    setRpmOpened(false);
    setZenzoStatus('');
    setZenzoLoading(false);
    setIncidentCompleted(false);
  }, [patient?.patient_id]);
const [imageRefreshKey, setImageRefreshKey] = useState(0);

useEffect(() => {
  if (!patient) return;
  
  // Load all data immediately
  const loadInitialData = async () => {
   await Promise.all([
  fetchNotes(),
  fetchVoiceDictations(),
  fetchExtractedData(),
  fetchClinicalActions(),
  fetchExtractedDataForNotes()
]);
    console.log('✅ All initial data loaded');
  };
  
  loadInitialData();
  callZenzoFlow();
  
  // Poll for new notes every 15 seconds
  const interval = setInterval(() => {
    fetchNotes();
  }, 15000);
  
  return () => clearInterval(interval);
}, [patient]);
// ADD THIS NEW useEffect RIGHT AFTER the one above
useEffect(() => {
const timeline = [
    ...(notes || []).map((note) => ({
      type: 'patient',
      timestamp: new Date(`${note.date} ${note.time}`),
      text: note.conversation,
      rawDate: new Date(`${note.date} ${note.time}`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    })),
    ...(clinicalActions || [])
      .filter((action) => action.action_type !== 'approved')
      .map((action) => ({
        type: 'doctor',
        timestamp: new Date(action.client_created_at),
        text: action.voice_dictation || action.notes || action.ai_suggestion?.suggestions?.single_most_critical_action_right_now || 'Clinical update',
        rawDate: new Date(action.client_created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      })),
    ...(doctorNotes || []).map((note) => ({
      type: 'doctornote',
      // ✅ FIX: Use date and time from API instead of timestamp
      timestamp: note.time && note.date ? new Date(`${note.date} ${note.time}`) : new Date(note.timestamp),
      text: note.conversation,
      // ✅ FIX: Format using the API's time field (already in IST)
      rawDate: note.time && note.date 
        ? (() => {
            const [hours, minutes, seconds] = note.time.split(':');
            const date = new Date(note.date);
            date.setHours(parseInt(hours), parseInt(minutes), parseInt(seconds || '0'));
            return date.toLocaleString('en-IN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            });
          })()
        : new Date(note.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    })),
].sort((a, b) => b.timestamp - a.timestamp);
  
  setMergedTimeline(timeline);
}, [notes, clinicalActions, doctorNotes]);
useEffect(() => {
  if (!patient) return;

  const checkIncidentStatus = async () => {
    try {
      const patientId = patient.patient_id;
      const r = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/get-completed-incident/${patientId}`);
      const d = await r.json();
      console.log('🔍 Incident status poll:', d);

      if (d?.status === 'success' && d?.incident?.status === 'completed') {
        console.log('✅ Incident is COMPLETED - showing popup and stopping poll');
        setIncidentCompleted(true);
        clearInterval(incidentPollRef.current);
      }
    } catch (e) {
      console.error('❌ Incident status poll error:', e);
    }
  };

  incidentPollRef.current = setInterval(checkIncidentStatus, 5000);
  checkIncidentStatus();

  return () => clearInterval(incidentPollRef.current);
}, [patient]);


  // ── API Calls ──
const fetchNotes = async () => {
  if (!hasLoadedNotesOnce.current) setLoadingNotes(true);
  try {
    const r = await fetch(`${API_BASE}/hms/users/data/context/voice-dictation/timestamp/${patient.patient_id}`);
    const d = await r.json();
    if (d.status === 'success') {
      setNotes(prev => {
        const next = d.dictations || [];
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    }
  } catch (e) { console.error(e); }
  finally {
    setLoadingNotes(false);
    hasLoadedNotesOnce.current = true;
  }
  try {
    const r2 = await fetch(`${API_BASE}/hms/users/data/context/doctor-voice-note-forprocessing/${patient.patient_id}`);
    const d2 = await r2.json();
    if (d2.status === 'success') {
      setDoctorNotes(prev => {
        const next = d2.doctor_voice_notes || [];
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    }
  } catch (e) { console.error(e); }
};
const fetchExtractedData = async () => {
  setExtractedDataLoading(true);

  try {
    const patientId = patient?.patient_id;

    const approvedUrl =
      `${API_BASE}/hms/users/ai-legacy/extraction-ambulance-emt/ambulance/image/approved-analysis/all/${patientId}`;

    const notesUrl =
      `${API_BASE}/hms/users/ambulance/ambulance/image-extracted/all-notes/doctor-suggestions/${patientId}`;

    const [approvedResponse, notesResponse] = await Promise.all([
      fetch(approvedUrl),
      fetch(notesUrl)
    ]);

    const approvedData = await approvedResponse.json();
    const notesData = await notesResponse.json();

    let combinedData = [];

    // AI Approved Analysis
    if (approvedData.status === 'success' && approvedData.data) {
      const aiData = approvedData.data.map((analysis) => ({
        id: analysis._id,
        timestamp_iso: analysis.timestamp_iso || analysis.timestamp,
        extracted_text: analysis.ai_impression || analysis.impressive_findings || 'No content',
        suggestion_text: analysis.emt_actions || '',
        fullData: analysis,
        type: 'ai_approved'
      }));
      combinedData.push(...aiData);
    }

    // ✅ FIXED: Doctor Suggestions - use 'notes' not 'data'
   if (notesData.status === 'success' && notesData.notes) {
      const doctorData = notesData.notes.map((note) => ({
        id: note._id,
        timestamp_iso: note.timestamp_iso || note.timestamp || note.created_at,
        extracted_text: note.suggestion_text || note.doctor_suggestion || note.note || 'No content',
        suggestion_text: note.suggestion_text || note.doctor_suggestion || '',
        fullData: note,
        type: 'doctor_suggestion'
      }));
      combinedData.push(...doctorData);
    }

    // Sort latest first
    // Sort latest first
    combinedData.sort(
      (a, b) =>
        new Date(b.timestamp_iso || 0) -
        new Date(a.timestamp_iso || 0)
    );

    setExtractedData(prev =>
      JSON.stringify(prev) === JSON.stringify(combinedData) ? prev : combinedData
    );
  } catch (e) {
    console.error('Error fetching image suggestions:', e);
    setExtractedData([]);
  } finally {
    setExtractedDataLoading(false);
  }
};
const fetchExtractedDataForNotes = async () => {
  try {
    const r = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/image-extracted/all-notes/${patient.patient_id}`);
    const d = await r.json();
    if (d.status === 'success') {
      // Filter to only show type: "extracted_data"
      const filteredNotes = (d.notes || []).filter(note => note.type === 'extracted_data');
      setNotesExtractedData(filteredNotes);
    }
  } catch (e) { console.error(e); }
};
 const fetchVoiceDictations = async () => {
  setLoadingDicts(true);
  try {
    const r = await fetch(`${API_BASE}/hms/users/data/context/voice-dictation/${patient.patient_id}`);
    const d = await r.json();
    if (d.status === 'success') {
      setVoiceDictations(prev => {
        const next = d.dictations || [];
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    }
  } catch (e) { console.error(e); }
  finally { setLoadingDicts(false); }
};

const fetchClinicalActions = async () => {
  setLoadingClinical(true);
  try {
    const r = await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/${patient.patient_id}`);
    const d = await r.json();

    if (d.status === 'success') {
      setClinicalActions(prev => {
        const next = d.actions || [];
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    }
  } catch (e) { console.error(e); }
  finally { setLoadingClinical(false); }
};

  const fetchFinalSummary = async () => {
    try {
      setFinalSummaryLoading(true);
      const response = await fetch(`${API_BASE}/hms/users/ai-legacy/ed-summary/latest/${patient.patient_id}`);
      const data = await response.json();
      if (data.status === 'success') {
        setFinalSummary(data.result.final_summary);
      }
    } catch (err) {
      console.error('Final Summary Error:', err);
    } finally {
      setFinalSummaryLoading(false);
    }
  };

  // Fetch Structured Note
  const fetchStructuredNote = async (patientId) => {
    if (!patientId) { setStructuredNote(null); return; }
    try {
      setStructuredNoteLoading(true);
      let doctorId = localStorage.getItem('doctor_id');
      if (!doctorId) doctorId = localStorage.getItem('zenzo_doctor_id');
      if (!doctorId) {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          try { const user = JSON.parse(userStr); doctorId = user.doctor_id || user.id || user._id || user.sys_user_id; } catch (e) {}
        }
      }
      const response = await fetch(`${API_BASE}/hms/users/ai-legacy/generate-emergency-structured-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`Server responded with ${response.status}: ${responseText}`);
      const data = JSON.parse(responseText);
      if (data.status === 'success') {
        setStructuredNote(data.finaloutput || data.structured_note || data.data);
      } else {
        setStructuredNote(null);
      }
    } catch (err) {
      console.error('Structured Note Error:', err);
      setStructuredNote(null);
      alert(`Failed to generate structured note: ${err.message}`);
    } finally {
      setStructuredNoteLoading(false);
    }
  };

  // ── Voice Recording ──
  const transcribeAudio = async (file, setTextTarget = setDictationText, setLoadingTarget = setTranscribeLoading) => {
    try {
      setLoadingTarget(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language_code', 'eng');
      const response = await fetch('https://doctorassist.ai/api/hms/users/ai/elevenlabs/api/transcribe_labs', { method: 'POST', body: formData });
      const result = await response.json();
      if (result.text) {
        setTextTarget((prev) => prev ? `${prev} ${result.text}` : result.text);
      } else if (result.error) {
        alert(result.error);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to transcribe audio');
    } finally {
      setLoadingTarget(false);
    }
  };
  const handleVoiceSubmit = async () => {
    try {
      if (!dictationText.trim()) { alert('Please enter voice notes'); return; }
      setVoiceSubmitLoading(true);
      const payload = {
        patient_id: patient?.patient_id,
        ai_suggestion: null,
        voice_dictation: dictationText,
        action_type: 'not_approved',
        notes: (notes || []).map((n) => `Timestamp: ${n.date} ${n.time}\nVoice: ${n.conversation}`).join('\n\n'),
        created_at: new Date().toISOString(),
      };
      const response = await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed');
      alert('Suggestion sent to the EMT app.');
      await fetchClinicalActions();
      setDictationText('');
      setShowVoiceSection(false);
    } catch (err) {
      console.error(err);
      alert('Failed to send suggestion to EMT');
    } finally {
      setVoiceSubmitLoading(false);
    }
  };
const handleDoctorNoteSubmit = async () => {
  try {
    if (!dictationText.trim()) { alert('Please enter a note'); return; }
    setDoctorNoteSubmitLoading(true);
    
    const payload = {
      patient_id: patient?.patient_id,
      conversation: dictationText,
    };
    
    const response = await fetch(`${API_BASE}/hms/users/data/context/doctor-voice-note-forprocessing/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) throw new Error('Failed to save doctor note');
    
    const result = await response.json();
if (result.status === 'success') {
  alert('Note saved for AI analysis. This was NOT sent to the EMT app.');
  setDictationText('');
  await fetchNotes();   // ← refresh doctorNotes right away
} else {
  throw new Error(result.message || 'Failed to save');
}
    
  } catch (err) {
    console.error(err);
    alert('Failed to save doctor note: ' + err.message);
  } finally {
    setDoctorNoteSubmitLoading(false);
  }
};
  // ── Zenzo Flow ──
const callZenzoFlow = useCallback(async (forceRelogin = false) => {
    setZenzoLoading(true);
    try {
      const zenzoToken = localStorage.getItem('zenzo_doctor_access_token');

      if (forceRelogin || !zenzoToken || zenzoToken === 'undefined' || zenzoToken === 'null') {
        setZenzoStatus('Re-authenticating with Zenzo…');
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        const email = localStorage.getItem('zenzo_doctor_email') || storedUser.username || '';
        const password = localStorage.getItem('zenzo_doctor_password') || '';
        if (!password) { setZenzoStatus('Session expired. Please login again.'); setZenzoLoading(false); return; }
        try {
          const reLoginRes = await fetch(`${API_BASE}/hms/users/ambulance/zenzo-doctor-login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const reLoginData = await reLoginRes.json();
          if (reLoginData?.accessToken) {
            localStorage.setItem('zenzo_doctor_access_token', reLoginData.accessToken);
            if (reLoginData.data) {
              localStorage.setItem('zenzo_doctor_data', JSON.stringify(reLoginData.data));
              localStorage.setItem('zenzo_doctor_mongo_id', reLoginData.data._id);
              localStorage.setItem('zenzo_doctor_id', reLoginData.data.doctorId);
              localStorage.setItem('zenzo_doctor_organization_id', reLoginData.data?.organization?._id || '');
              localStorage.setItem('zenzo_doctor_department_id', reLoginData.data?.department?._id || '');
            }
          } else {
            setZenzoStatus('Re-authentication failed. Check credentials.');
            setZenzoLoading(false);
            return;
          }
        } catch (err) {
          setZenzoStatus('Re-authentication error: ' + err.message);
          setZenzoLoading(false);
          return;
        }
      }

      const freshToken = localStorage.getItem('zenzo_doctor_access_token');
      const doctorEmail = localStorage.getItem('zenzo_doctor_email');

      setZenzoStatus('Fetching appointment…');
      const latestRes = await fetch(`${API_BASE}/hms/users/ambulance/ambulance/patient-click/latest/${patient.patient_id}`);
      const latestData = await latestRes.json();

      // Guard: if the backend response identifies a different patient,
      // do not proceed — this would wire up the wrong patient's monitor.
      const returnedPatientId = latestData?.data?.patient_id || latestData?.patient_id;
      if (returnedPatientId && returnedPatientId !== patient.patient_id) {
        console.error('Zenzo appointment mismatch:', returnedPatientId, 'expected', patient.patient_id);
        setZenzoStatus('Session mismatch — please retry.');
        setZenzoLoading(false);
        return;
      }

      const ambulanceMongoId = latestData?.data?.ambulance || '';
      const appointmentId = latestData?.appointment_id || latestData?.data?.appointment_id || latestData?.appointment?.appointment_id;

      if (!appointmentId) {
        setZenzoStatus('No active appointment found.');
        setZenzoLoading(false);
        return;
      }

      setZenzoStatus('Assigning doctor…');
      await fetch(`${API_BASE}/hms/users/ambulance/zenzo/appointments/${appointmentId}/assign-doctor`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: freshToken, appointment: appointmentId, ambulance: ambulanceMongoId, email: doctorEmail || '' }),
      });

      setZenzoStatus('Loading RPM monitor…');
      const tokenRes = await fetch(`${API_BASE}/hms/users/ambulance/zenzo/tokens/doctor`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: freshToken, appointment: appointmentId, ambulance: ambulanceMongoId, email: doctorEmail || '' }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData?.success && tokenData?.data?.iframeUrl) {
        const freshIframe = tokenData.data.iframeUrl;
        if (iframeUrl !== freshIframe) {
          setIframeUrl(freshIframe);
          setZenzoStatus('');
        }
      } else {
        setZenzoStatus('RPM monitor unavailable.');
      }
    } catch (err) {
      console.error('Zenzo flow error:', err);
      setZenzoStatus('Error connecting to RPM service.');
    } finally {
      setZenzoLoading(false);
    }
}, [patient]);

  // ── Modal helpers ──
  const openClinicalModal = (action) => setModal({ open: true, data: action, type: 'clinical' });
  const openVoiceModal    = (dict)   => setModal({ open: true, data: dict,   type: 'voice'    });
  const closeModal        = ()       => setModal({ open: false, data: null, type: null });

  // ── Merged timeline ──


  if (!patient) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={32} />
    </div>
  );

  // ─── Tab helpers ──
const Tab = ({ id, label, count }) => (
    <button onClick={() => { setActiveTab(id); setShowDataProcessing(false); }} style={{
      padding: '10px 18px', background: 'none', border: 'none',
      borderBottom: activeTab === id ? '2px solid #000' : '2px solid transparent',
      fontFamily: "'DM Sans', sans-serif", fontSize: 13,
      fontWeight: activeTab === id ? 600 : 400,
      color: activeTab === id ? '#000' : '#999',
      cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          background: activeTab === id ? '#000' : '#e8e8e8',
          color: activeTab === id ? '#fff' : '#666',
          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
        }}>{count}</span>
      )}
    </button>
  );

  const SubTab = ({ id, label, count, current, onSet }) => (
    <button onClick={() => onSet(id)} style={{
      flex: 1, padding: '9px 10px',
      background: current === id ? '#fff' : 'transparent',
      border: 'none', borderRadius: 4,
      fontFamily: "'DM Sans', sans-serif", fontSize: 12,
      fontWeight: current === id ? 600 : 400,
      color: current === id ? '#000' : '#999',
      cursor: 'pointer',
      boxShadow: current === id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
      transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          background: current === id ? '#000' : '#e0e0e0',
          color: current === id ? '#fff' : '#888',
          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
        }}>{count}</span>
      )}
    </button>
  );

  // ─── Modal content renderer ───
  const renderModal = () => {
    if (!modal.open || !modal.data) return null;

    if (modal.type === 'voice') {
      const d = modal.data;
      return (
        <Modal visible title="Voice Dictation" onClose={closeModal}>
          <ModalSection title="Metadata"><ModalText bold>{d.date} · {d.time}</ModalText></ModalSection>
          <ModalSection title="Transcription"><ModalText>{d.conversation}</ModalText></ModalSection>
        </Modal>
      );
    }

   if (modal.type === 'clinical') {
  const action = modal.data;
  const isAI   = action.action_type === 'approved';
const s      = action.ai_suggestion?.suggestions || {};
  const snap   = s.patient_snapshot;
  const immediate = action.ai_suggestion?.immediate_actions || s.immediate_actions || {};
  const risk = action.ai_suggestion?.risk_stratification || s.risk_stratification || {};
  const hospital = action.ai_suggestion?.hospital_prep || s.hospital_prep || {};
  const vitals = action.ai_suggestion?.vitals_comparison || s.vitals_comparison || {};
  const precautions = action.ai_suggestion?.precautions || s.precautions || {};

  return (
    <Modal visible title={isAI ? 'AI Suggestion Details' : 'Voice Clinical Note'} onClose={closeModal}>
      <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Badge label={isAI ? 'AI Approved' : 'Voice Note'} dark={isAI} />
        <span style={{ fontSize: 11, color: '#999' }}>{fmtDate(action.client_created_at)}</span>
      </div>

      {!isAI && action.voice_dictation && (
        <ModalSection title="Voice Dictation"><ModalText>{action.voice_dictation}</ModalText></ModalSection>
      )}

      {isAI && (
        <>
          {/* Patient Snapshot */}
          {snap && (
            <ModalSection title="Patient Snapshot">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
                <div><div style={{ fontSize: 10, color: '#aaa' }}>Age/Gender</div><ModalText bold>{snap.age_gender || 'N/A'}</ModalText></div>
                <div><div style={{ fontSize: 10, color: '#aaa' }}>Mechanism</div><ModalText bold>{snap.mechanism || 'N/A'}</ModalText></div>
                <div><div style={{ fontSize: 10, color: '#aaa' }}>Triage Colour</div><ModalText bold>{snap.triage_colour || 'N/A'}</ModalText></div>
                <div><div style={{ fontSize: 10, color: '#aaa' }}>Criticality Score</div><ModalText bold>{snap.criticality_score || 'N/A'}/10</ModalText></div>
                <div><div style={{ fontSize: 10, color: '#aaa' }}>Overall Risk</div><ModalText bold>{snap.overall_risk || 'N/A'}</ModalText></div>
                <div><div style={{ fontSize: 10, color: '#aaa' }}>Consciousness</div><ModalText bold>{snap.consciousness || 'N/A'}</ModalText></div>
              </div>
            </ModalSection>
          )}

          {/* Most Critical Action */}
          {s.single_most_critical_action_right_now && (
            <ModalSection title="⚠ Most Critical Action">
              <div style={{ background: '#fffdf0', border: '1px solid #f0e0a0', borderRadius: 4, padding: 12 }}>
                <ModalText bold>{s.single_most_critical_action_right_now}</ModalText>
              </div>
            </ModalSection>
          )}

          {/* SBAR Summary */}
          {s.sbar_summary && (
            <ModalSection title="SBAR Summary">
              {[
                ['Situation', s.sbar_summary.situation],
                ['Background', s.sbar_summary.background],
                ['Assessment', s.sbar_summary.assessment],
                ['Recommendation', s.sbar_summary.recommendation]
              ].map(([l, v]) => v && (
                <div key={l} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa', marginBottom: 4 }}>{l}</div>
                  <ModalText>{v}</ModalText>
                </div>
              ))}
            </ModalSection>
          )}

          {/* Immediate Actions - Timestamp Anchored Actions */}
          {immediate.timestamp_anchored_actions?.length > 0 && (
            <ModalSection title="Immediate Actions (Timestamped)">
              {immediate.timestamp_anchored_actions.map((item, idx) => (
                <div key={idx} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#000', marginBottom: 6 }}>
                    {item.label} ({item.time_window})
                  </div>
                  {item.actions?.map((act, actIdx) => (
                    <div key={actIdx} style={{ marginLeft: 10, marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>• {act.action}</div>
                      {act.why_for_this_patient && <div style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>Why: {act.why_for_this_patient}</div>}
                      {act.method && <div style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>Method: {act.method}</div>}
                      {act.success_indicator && <div style={{ fontSize: 11, color: '#2e7d32', marginLeft: 12 }}>Success: {act.success_indicator}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </ModalSection>
          )}

          {/* Timeline Response Plan */}
          {s.timestamp_based_response_plan?.length > 0 && (
            <ModalSection title="Timeline Response Plan">
              {s.timestamp_based_response_plan.map((item, i) => (
                <div key={i} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>{item.clock_label}</span>
                    <span style={{ fontSize: 11, color: '#888' }}>{item.phase}</span>
                  </div>
                  {item.priority_actions?.map((a, j) => (
                    <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 5, marginLeft: 8 }}>
                      <span style={{ color: '#ccc', fontSize: 14 }}>•</span>
                      <ModalText>{a}</ModalText>
                    </div>
                  ))}
                  {item.monitoring?.length > 0 && (
                    <div style={{ marginLeft: 16, marginTop: 6, padding: '6px 10px', borderLeft: '2px solid #eee' }}>
                      <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>Monitor</div>
                      {item.monitoring.map((m, k) => <div key={k} style={{ fontSize: 11, color: '#888' }}>· {m}</div>)}
                    </div>
                  )}
                </div>
              ))}
            </ModalSection>
          )}

          {/* Risk Stratification */}
          {risk.criticality_score && (
            <ModalSection title="Risk Stratification">
              <div style={{ background: '#fff5f0', padding: 12, borderRadius: 4, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Criticality Score: {risk.criticality_score.score}/10</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{risk.criticality_score.rationale}</div>
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 8 }}>Overall Risk Level: {risk.overall_risk_level}</div>
              </div>
              {risk.life_threats_ranked?.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', marginBottom: 8, textTransform: 'uppercase' }}>Ranked Life Threats</div>
                  {risk.life_threats_ranked.map((threat, idx) => (
                    <div key={idx} style={{ marginBottom: 10, padding: 8, background: '#fafafa', borderRadius: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{threat.rank}. {threat.threat}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>Time to harm: {threat.time_to_harm_minutes} min | Action: {threat.immediate_action}</div>
                    </div>
                  ))}
                </>
              )}
              {risk.shock_risk?.present && (
                <div style={{ marginTop: 8, padding: 8, background: '#ffe0e0', borderRadius: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#c62828' }}>Shock Risk: {risk.shock_risk.type} - {risk.shock_risk.stage}</div>
                  <div style={{ fontSize: 11 }}>Action: {risk.shock_risk.action}</div>
                </div>
              )}
            </ModalSection>
          )}

          {/* Hospital Preparation */}
          {hospital.trauma_bay_activation && (
            <ModalSection title="Hospital Preparation">
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>Trauma Bay: {hospital.trauma_bay_activation.level}</div>
                <div style={{ fontSize: 11, color: '#555' }}>{hospital.trauma_bay_activation.rationale}</div>
              </div>
              {hospital.personnel_to_alert?.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', marginTop: 8, textTransform: 'uppercase' }}>Personnel to Alert</div>
                  {hospital.personnel_to_alert.map((p, idx) => (
                    <div key={idx} style={{ fontSize: 11, marginLeft: 10 }}>• {p.role} ({p.urgency})</div>
                  ))}
                </>
              )}
              {hospital.imaging_to_book?.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', marginTop: 8, textTransform: 'uppercase' }}>Imaging Required</div>
                  {hospital.imaging_to_book.map((img, idx) => (
                    <div key={idx} style={{ fontSize: 11, marginLeft: 10 }}>• {img.imaging} - {img.priority}</div>
                  ))}
                </>
              )}
              {hospital.specialist_teams_to_notify?.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', marginTop: 8, textTransform: 'uppercase' }}>Specialist Teams</div>
                  {hospital.specialist_teams_to_notify.map((spec, idx) => (
                    <div key={idx} style={{ fontSize: 11, marginLeft: 10 }}>• {spec.specialty} ({spec.urgency})</div>
                  ))}
                </>
              )}
            </ModalSection>
          )}

          {/* Clinical Progression */}
          {s.progression && (
            <ModalSection title="Clinical Progression">
              <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 4, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#000', marginBottom: 6 }}>Overall Trend: {s.progression.overall_trend}</div>
                <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>{s.progression.trend_summary}</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Current Status</div>
              <ModalText>{s.progression.current_status}</ModalText>
              {s.progression.milestones?.map((m, i) => (
                <div key={i} style={{ marginTop: 12, padding: 10, background: '#f5f5f5', borderRadius: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>Note #{m.entry_number} - {m.source}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{fmtDate(m.timestamp_ist)}</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>{m.status_at_this_time}</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: m.change_from_previous === 'Improved' ? '#2e7d32' : '#d32f2f' }}>
                    Change: {m.change_from_previous}
                  </div>
                </div>
              ))}
            </ModalSection>
          )}
{/* Vitals Comparison */}
{vitals.vital_signs_comparison && vitals.vital_signs_comparison.length > 0 && (
  <ModalSection title="Vitals Comparison">
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #eee' }}>Parameter</th>
            <th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #eee' }}>Monitor</th>
            <th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #eee' }}>Voice</th>
            <th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #eee' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {vitals.vital_signs_comparison.slice(0, 5).map((v, idx) => (
            <tr key={idx}>
              <td style={{ padding: 6, borderBottom: '1px solid #f5f5f5' }}><b>{v.vital_parameter}</b></td>
              <td style={{ padding: 6, borderBottom: '1px solid #f5f5f5' }}>{v.image_monitor_value || '—'}</td>
              <td style={{ padding: 6, borderBottom: '1px solid #f5f5f5' }}>{v.voice_reported_value || '—'}</td>
              <td style={{ padding: 6, borderBottom: '1px solid #f5f5f5' }}>
                <span style={{
                  background: v.agreement === 'Confirmed' ? '#e8f5e9' : '#fff3e0',
                  color: v.agreement === 'Confirmed' ? '#2e7d32' : '#e65100',
                  padding: '2px 6px', borderRadius: 3, fontSize: 10
                }}>{v.agreement || '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {vitals.overall_clinical_impression && (
      <div style={{ marginTop: 12, padding: 8, background: '#e8f5e9', borderRadius: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700 }}>Overall Impression</div>
        <div style={{ fontSize: 11 }}>{vitals.overall_clinical_impression.current_status_based_on_combined_data}</div>
      </div>
    )}
  </ModalSection>
)}

{/* Infusion Pump Data */}
{vitals.infusion_pump_data?.pump_details?.length > 0 && (
  <ModalSection title="Infusion Pumps">
    {vitals.infusion_pump_data.pump_details.map((pump, idx) => (
      <div key={idx} style={{ marginBottom: 8, padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700 }}>{pump.pump_id}</div>
        <div style={{ fontSize: 11 }}>Flow: {pump.flow_rate_ml_per_hr} ml/hr | Infused: {pump.infused_ml} ml</div>
      </div>
    ))}
    <div style={{ fontSize: 11, marginTop: 8 }}>Total Infused: {vitals.infusion_pump_data.total_fluid_infused_ml} ml</div>
  </ModalSection>
)}

{/* Deterioration Watch */}
{s.deterioration_watch && (
  <ModalSection title="Deterioration Watch">
    {s.deterioration_watch.early_warning_signs?.length > 0 && (
      <>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#c62828', marginTop: 8, textTransform: 'uppercase' }}>Early Warning Signs</div>
        {s.deterioration_watch.early_warning_signs.map((sign, idx) => (
          <div key={idx} style={{ fontSize: 11, marginLeft: 10 }}>⚠ {sign}</div>
        ))}
      </>
    )}
    {s.deterioration_watch.immediate_escalation_triggers?.length > 0 && (
      <>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#d32f2f', marginTop: 8, textTransform: 'uppercase' }}>Immediate Escalation Triggers</div>
        {s.deterioration_watch.immediate_escalation_triggers.map((trigger, idx) => (
          <div key={idx} style={{ fontSize: 11, marginLeft: 10 }}>🚨 {trigger}</div>
        ))}
      </>
    )}
  </ModalSection>
)}

{/* Full Precautions */}
{precautions.critical_do_not_list?.length > 0 && (
  <ModalSection title="Critical Do Not List">
    {precautions.critical_do_not_list.map((item, idx) => (
      <div key={idx} style={{ marginBottom: 10, padding: 8, background: '#ffebee', borderRadius: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#c62828' }}>⛔ {item.do_not}</div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{item.applies_because}</div>
        <div style={{ fontSize: 10, color: '#d32f2f' }}>Severity: {item.severity}</div>
      </div>
    ))}
  </ModalSection>
)}{console.log('Vitals Comparison:', vitals)}
{console.log('Vitals Signs:', vitals?.vital_signs_comparison)}
{console.log('Infusion Pumps:', vitals?.infusion_pump_data)}
          {/* Critical Precautions */}
          {s.top_3_precautions_summary?.length > 0 && (
            <ModalSection title="Critical Precautions">
              {s.top_3_precautions_summary.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, padding: 8, background: '#fff5f5', borderRadius: 4 }}>
                  <span style={{ color: '#dc2626', fontSize: 14 }}>⚠</span>
                  <ModalText>{p}</ModalText>
                </div>
              ))}
            </ModalSection>
          )}

          {/* ED Handover Brief */}
          {s.ed_handover_brief && (
            <ModalSection title="ED Handover Brief">
              <div style={{ background: '#f0f7ff', borderRadius: 4, padding: 12 }}>
                <ModalText>{s.ed_handover_brief}</ModalText>
              </div>
            </ModalSection>
          )}

          
        </>
      )}
    </Modal>
  );
}

 if (modal.type === 'doctor_suggestion') {
    const d = modal.data;
    return (
      <Modal visible title="Doctor Suggestion" onClose={closeModal}>
        <div>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-block', padding: '3px 8px', fontSize: 9, fontWeight: 700,
              letterSpacing: '0.8px', textTransform: 'uppercase',
              background: '#14a348', color: '#fff', borderRadius: 3,
            }}>DR. SUGGESTION</span>
            <span style={{ fontSize: 11, color: '#999' }}>
              {d.timestamp
                ? new Date(d.timestamp).toLocaleString('en-IN', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                  })
                : 'Unknown time'}
            </span>
          </div>
          <div style={{ borderBottom: '1px solid #f0f0f0', marginBottom: 16 }} />
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
            textTransform: 'uppercase', color: '#999', marginBottom: 10,
          }}>Doctor's Suggestion</div>
          <p style={{ fontSize: 13, color: '#444', lineHeight: 1.8 }}>
            {d.extracted_text || 'No content available'}
          </p>
        </div>
      </Modal>
    );
  }

  if (modal.type === 'ai_analysis') {
  const analysis = modal.data.fullData;
  
  // Helper function to clean text
  const cleanText = (text) => {
    if (!text) return 'N/A';
    return text
      .replace(/###\s*/g, '')
      .replace(/\*\*/g, '')
      .replace(/^\* /gm, '• ')
      .replace(/^\*\t/gm, '• ')
      .replace(/^-\s/gm, '• ')
      .trim();
  };

  // Section block component
  const SectionBlock = ({ title, content }) => {
    if (!content) return null;
    const lines = cleanText(content)
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    return (
      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#000', letterSpacing: 0.8, marginBottom: 8 }}>
          {title}
        </div>
        {lines.map((line, idx) => (
          <div key={idx} style={{ display: 'flex', flexDirection: 'row', marginBottom: 6, alignItems: 'flex-start' }}>
            {line.startsWith('•') ? (
              <>
                <span style={{ fontSize: 14, color: '#000', marginRight: 6, marginTop: 1 }}>•</span>
                <span style={{ flex: 1, fontSize: 13, color: '#444', lineHeight: 1.5 }}>
                  {line.replace(/^•\s*/, '')}
                </span>
              </>
            ) : (
              <span style={{ flex: 1, fontSize: 13, color: '#444', lineHeight: 1.5 }}>{line}</span>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Modal visible title="AI Clinical Analysis" onClose={closeModal}>
      <div>
        {/* Header with Badge and Timestamp */}
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Badge label="AI APPROVED" dark={true} />
          <span style={{ fontSize: 11, color: '#999' }}>
            {modal.data.timestamp ? fmtDate(modal.data.timestamp) : 'Unknown time'}
          </span>
        </div>

        {/* Risk Level Badge */}
        {analysis?.risk_level && (
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#000' }}>RISK LEVEL</span>
            <span style={{
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              backgroundColor: analysis.risk_level === 'LOW' ? '#e8f5e9' : analysis.risk_level === 'HIGH' ? '#ffebee' : '#fff3e0',
              color: analysis.risk_level === 'LOW' ? '#2e7d32' : analysis.risk_level === 'HIGH' ? '#c62828' : '#e65100'
            }}>
              {analysis.risk_level}
            </span>
          </div>
        )}

        <SectionBlock title="IMPRESSIVE FINDINGS" content={analysis?.impressive_findings} />
        <SectionBlock title="COMORBIDITIES / DIFFERENTIAL DIAGNOSIS" content={analysis?.comorbidities} />
        <SectionBlock title="TREND ANALYSIS" content={analysis?.trend_analysis} />

        {/* ✅ Vitals Timeline Table - ADD THIS SECTION */}
        {analysis?.vitals_timeline && analysis.vitals_timeline.length > 0 && (
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#000', letterSpacing: 0.8, marginBottom: 8 }}>
              VITALS TIMELINE
            </div>
            {analysis.vitals_timeline.map((v, idx) => (
              <div key={idx} style={{
                marginBottom: 12,
                paddingBottom: 12,
                borderBottom: idx < analysis.vitals_timeline.length - 1 ? '1px solid #f0f0f0' : 'none'
              }}>
                {/* Timestamp */}
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: '600' }}>
                  🕐 {v.timestamp_display || v.timestamp_iso || 'N/A'}{idx === 0 ? '  ✦ Latest' : ''}
                </div>

                {/* Vitals Section */}
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', marginBottom: 8, textTransform: 'uppercase' }}>
                  VITALS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'SpO2', value: v.spo2 ? `${v.spo2}%` : null },
                    { label: 'Heart Rate', value: v.hr ? `${v.hr} bpm` : null },
                    { label: 'RR', value: v.rr ? `${v.rr}/min` : null },
                    { label: 'Temp', value: v.temperature ? `${v.temperature}°C` : null },
                    { label: 'BP', value: v.bp ? `${v.bp} mmHg` : null },
                    { label: 'PREDICT-HF', value: v.predict_hf || null },
                  ].filter(x => x.value).map((x, j) => (
                    <div key={j} style={{
                      backgroundColor: '#eef2ff',
                      borderRadius: 10,
                      padding: '8px 12px',
                      minWidth: 75,
                      textAlign: 'center',
                      border: '1px solid #c7d2fe'
                    }}>
                      <div style={{ fontSize: 9, color: '#6366f1', fontWeight: '700', marginBottom: 2 }}>
                        {x.label}
                      </div>
                      <div style={{ fontSize: 14, color: '#1e1b4b', fontWeight: '800' }}>
                        {x.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Infusion Pumps Section */}
                {(v.pump1_flow || v.pump2_flow || v.pump3_flow || v.pump1_infused || v.pump2_infused || v.pump3_infused) && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', marginBottom: 8, textTransform: 'uppercase' }}>
                      INFUSION PUMPS
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {[
                        { label: 'Pump 1 Flow', value: v.pump1_flow ? `${v.pump1_flow} ml/hr` : null },
                        { label: 'Pump 2 Flow', value: v.pump2_flow ? `${v.pump2_flow} ml/hr` : null },
                        { label: 'Pump 3 Flow', value: v.pump3_flow ? `${v.pump3_flow} ml/hr` : null },
                        { label: 'P1 Infused', value: v.pump1_infused ? `${v.pump1_infused} ml` : null, highlight: true },
                        { label: 'P2 Infused', value: v.pump2_infused ? `${v.pump2_infused} ml` : null, highlight: true },
                        { label: 'P3 Infused', value: v.pump3_infused ? `${v.pump3_infused} ml` : null, highlight: true },
                      ].filter(x => x.value).map((x, j) => (
                        <div key={j} style={{
                          backgroundColor: x.highlight ? '#fff0f0' : '#fff7ed',
                          borderRadius: 10,
                          padding: '8px 12px',
                          minWidth: 75,
                          textAlign: 'center',
                          border: `1px solid ${x.highlight ? '#fca5a5' : '#fed7aa'}`
                        }}>
                          <div style={{ fontSize: 9, color: x.highlight ? '#dc2626' : '#ea580c', fontWeight: '700', marginBottom: 2 }}>
                            {x.label}
                          </div>
                          <div style={{ fontSize: 14, color: x.highlight ? '#991b1b' : '#9a3412', fontWeight: '800' }}>
                            {x.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ✅ Change Between Readings (Trends) - ADD THIS SECTION */}
        {analysis?.trends && analysis.trends.length > 0 && (
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#000', letterSpacing: 0.8, marginBottom: 8 }}>
              CHANGE BETWEEN READINGS
            </div>
            {analysis.trends.map((trend, idx) => (
              <div key={idx} style={{
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: idx < analysis.trends.length - 1 ? '1px solid #f0f0f0' : 'none'
              }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                  {trend.from_timestamp} → {trend.to_timestamp}
                </div>
                {Object.entries(trend.changes || {}).map(([key, val]) => (
                  <div key={key} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4
                  }}>
                    <span style={{ fontSize: 12, fontWeight: '700', color: '#000', width: 100 }}>
                      {key.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, color: '#444' }}>
                      {val.previous} → {val.current}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: val.direction?.includes('↑') ? '#c62828' : val.direction?.includes('↓') ? '#1565c0' : '#2e7d32'
                    }}>
                      {val.direction}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <SectionBlock title="CLINICAL IMPRESSION" content={analysis?.ai_impression} />
        <SectionBlock title="EMT ACTION SUGGESTIONS" content={analysis?.emt_actions} />
        <SectionBlock title="PHYSICIAN ALERT" content={analysis?.physician_alert} />
      </div>
    </Modal>
  );
}
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #fff; color: #000; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.7)} }
        textarea { font-family: 'DM Sans', sans-serif; }
       ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #f5f5f5; }
        ::-webkit-scrollbar-thumb { background: #bbb; border-radius: 6px; border: 2px solid #f5f5f5; }
        ::-webkit-scrollbar-thumb:hover { background: #999; }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: translateX(0); } 
        @keyframes slideInTopRight { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', width: '100%', maxWidth: '100%', margin: 0 }}>
        <NewPatientToast
          alerts={newPatientAlerts}
          onDismiss={(idx) => setNewPatientAlerts((prev) => prev.filter((_, i) => i !== idx))}
          onView={(patient) => {
            localStorage.setItem('selected_patient', JSON.stringify(patient));
            window.location.href = `/patient-profile-emergency/${patient.patient_id}`;
          }}
        />
        <PatientActivityNotifier
          patientId={patient?.patient_id}
          onViewNote={() => {
            setNotesFilter('paramedic');
            document.querySelector('[data-voice-section="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          onViewImage={() => {
            setImageRefreshKey(prev => prev + 1);
            setTimeout(() => {
              document.getElementById('clinical-images-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          }}
        />

        {/* ── HEADER ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '36px 24px 16px', borderBottom: '1px solid #e8e8e8',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={() => window.location.href = '/Doctor-Emergency-Dashbaord'} style={{
              background: 'none', border: '1px solid #e0e0e0', padding: '6px 12px',
              cursor: 'pointer', borderRadius: 3, fontSize: 12, color: '#444',
              fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6,
            }}>← Back</button>
            <div>
              <p style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 2 }}>
                Patient Profile · Emergency
              </p>
              <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, fontWeight: 400, letterSpacing: '-0.5px', color: '#000' }}>
                {patient.fullName}
              </h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
  <span style={{ fontSize: 14, fontWeight: 600, color: '#000', letterSpacing: '-0.3px' }}>DoctorAssist.Ai</span>
</div>
        </div>

        {/* Patient quick-pill */}
        <div style={{ display: 'flex', gap: 10, padding: '12px 24px', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap', alignItems: 'center' }}>
          {[patient.patient_id, patient.age ? `${patient.age} yrs` : null, patient.gender, patient.accidentDetails?.condition]
            .filter(Boolean).map((v, i) => (
              <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#f5f5f5', color: '#555', fontWeight: 500 }}>{v}</span>
            ))}
        </div>

      
        {/* ── CONTENT ── */}
        <div style={{ padding: '20px 24px 40px' }}>

         {/* PATIENT INFO */}
         {activeTab === 'patient' && (
  <div>
    {/* PATIENT INFORMATION HEADING WITH UNDERLINE */}
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      color: '#000',
      textTransform: 'uppercase',
      letterSpacing: '1.2px',
      marginBottom: 16,
      paddingBottom: 10,
      borderBottom: '1px solid #e8e8e8'
    }}>
      Patient Information
    </div>

    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: '280px' }}>
        <SectionCard title="Personal Information">
                  <InfoRow label="Patient ID"   value={patient.patient_id} />
                  <InfoRow label="System ID"    value={patient.sys_user_id} />
                  <InfoRow label="Full Name"    value={patient.fullName} />
                  <InfoRow label="Age"          value={patient.age} />
                  <InfoRow label="Gender"       value={patient.gender} />
                  <InfoRow label="Phone"        value={patient.phoneNumber} />
                  <InfoRow label="Address"      value={patient.address} />
                </SectionCard>
                {(patient.emergencyContact?.name || patient.emergencyContact?.phoneNumber) && (
                  <SectionCard title="Emergency Contact">
                    <InfoRow label="Name"         value={patient.emergencyContact?.name} />
                    <InfoRow label="Relationship" value={patient.emergencyContact?.relationship} />
                    <InfoRow label="Phone"        value={patient.emergencyContact?.phoneNumber} />
                  </SectionCard>
                )}
              </div>
              <div style={{ flex: 1, minWidth: '280px' }}>
                <SectionCard title="Incident Details">
                  <InfoRow label="Date"          value={patient.accidentDetails?.accidentDate} />
                  <InfoRow label="Time"          value={patient.accidentDetails?.accidentTime} />
                  <InfoRow label="Location"      value={patient.accidentDetails?.location} />
                  <InfoRow label="Incident Type" value={patient.accidentDetails?.accidentType} />
                  <InfoRow label="Condition"     value={patient.accidentDetails?.condition} />
                </SectionCard>
          </div>
            </div>

            {/* HISTORY SECTION INSIDE PATIENT TAB */}
          {/* HISTORY SECTION INSIDE PATIENT TAB */}
{/* PATIENT JOURNEY TIMELINE */}
<div style={{ marginTop: 32, background: '#f4f0f0', borderRadius: 8, padding: '20px' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 10, borderBottom: '1px solid #e0e0e0' }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
      Patient Journey
    </div>
  </div>
  <PatientJourneyTimeline
    patient={patient}
    notes={notes}
    doctorNotes={doctorNotes}
    clinicalActions={clinicalActions}
    extractedData={extractedData}
  />
</div>

            {/* ── RPM SECTION ── */}
            <div style={{ marginTop: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid #e8e8e8', marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>RPM Section</span>
                
                <button onClick={() => { setRpmOpened(true); callZenzoFlow(); }} style={{ background: '#000', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {zenzoLoading ? 'Connecting…' : 'Open RPM Monitor'}
                </button>
              </div>
             {rpmOpened && (
<RpmPanel iframeUrl={iframeUrl} zenzoLoading={zenzoLoading} zenzoStatus={zenzoStatus} callZenzoFlow={callZenzoFlow} iframeRef={iframeRef} incidentCompleted={incidentCompleted} />              )}

              {/* Voice Notes + Doctor Note + Notes + DataProcessing — always shown */}
              <div style={{ marginTop: 24 }}>
                <div style={{ marginBottom: 16, padding: '10px 16px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🔴</span>
                  <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 500, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}>
                                 If you do not want AI processing, you can directly suggest to EMT using the voice notes below By Clicking Submit Voice Suggestion.
                  </span>
                </div>

                <div ref={voiceSectionRef} style={{ marginBottom: 24, border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', background: '#fafafa', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>VOICE NOTES / MANUAL INSTRUCTIONS FOR ClINCAL ACTIONS</div>
                    <button type="button" onClick={async () => {
                      try {
                        if (isRecording) { mediaRecorderRef.current.stop(); streamRef.current?.getTracks().forEach(t => t.stop()); setIsRecording(false); return; }
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        streamRef.current = stream;
                        const mediaRecorder = new MediaRecorder(stream);
                        mediaRecorderRef.current = mediaRecorder;
                        audioChunksRef.current = [];
                        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
                        mediaRecorder.onstop = async () => { const b = new Blob(audioChunksRef.current, { type: 'audio/webm' }); await transcribeAudio(new File([b], 'voice-note.webm', { type: 'audio/webm' })); streamRef.current?.getTracks().forEach(t => t.stop()); };
                        mediaRecorder.start(); setIsRecording(true);
                      } catch (err) { console.error(err); alert('Microphone permission denied'); }
                    }} disabled={transcribeLoading} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                      {transcribeLoading ? <Spinner size={30} /> : isRecording ? (
                        <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#dc3545', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.5s infinite' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="3" width="12" height="16" rx="2" /></svg>
                          <span style={{ fontSize: 8, fontWeight: 700, color: '#fff' }}>REC</span>
                        </div>
                      ) : (
                        <div style={{ width: 50, height: 50, borderRadius: '50%', border: '2px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                        </div>
                      )}
                    </button>
                  </div>
                  <div style={{ padding: 20 }}>
                    <textarea value={dictationText} onChange={(e) => setDictationText(e.target.value)} placeholder="Enter additional clinical instructions or record voice/doctor notes..." style={{ width: '100%', minHeight: 140, border: '1px solid #e8e8e8', padding: 16, fontSize: 14, borderRadius: 6, resize: 'vertical', outline: 'none', lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }} />
                    <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                      <div>
                        <button onClick={handleVoiceSubmit} disabled={voiceSubmitLoading} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '11px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>{voiceSubmitLoading ? 'Sending to EMT…' : ' Send to EMT App Now'}</button>
                        
                      </div>
                      <div>
                        <button onClick={handleDoctorNoteSubmit} disabled={doctorNoteSubmitLoading} style={{ background: '#fff', color: '#1d4ed8', border: '1.5px solid #1d4ed8', padding: '11px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>{doctorNoteSubmitLoading ? 'Saving…' : ' Save Note for AI Only'}</button>
                        
                      </div>
                    </div>
                  </div>
                </div>
                {loadingNotes ? <div>Loading...</div> : (
                  <div style={{ border: '2px solid #e0e0e0', borderRadius: 8, padding: 16, background: '#fefefe' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #e8e8e8' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>CLINICAL ACTIONS NOTES SECTION</div>
                      <button onClick={fetchNotes} style={{ background: '#000', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Reload</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
                      {[['all', `All (${mergedTimeline.length + (notesExtractedData?.length || 0)})`], ['paramedic', `Emergency Crew (${mergedTimeline.filter(i => i.type === 'patient').length})`], ['doctor', `Doctor (${mergedTimeline.filter(i => i.type === 'doctor' || i.type === 'doctornote').length})`], ['extracted', `Extracted Data (${notesExtractedData?.length || 0})`]].map(([val, lbl]) => (
                        <button key={val} onClick={() => { setNotesFilter(val); if (val === 'extracted') fetchExtractedDataForNotes(); }} style={{ background: notesFilter === val ? '#000' : '#f5f5f5', color: notesFilter === val ? '#fff' : '#666', border: 'none', padding: '6px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{lbl}</button>
                      ))}
                    </div>
                    {notesFilter !== 'extracted' ? (() => {
                      let itemsToShow = notesFilter === 'all' ? [...mergedTimeline, ...notesExtractedData.map(item => ({ ...item, type: 'extracted', rawDate: item.timestamp_iso ? new Date(item.timestamp_iso).toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : 'N/A', text: item.extracted_text || item.suggestion_text || 'No content' }))].sort((a, b) => new Date(b.timestamp_iso || b.timestamp) - new Date(a.timestamp_iso || a.timestamp)) : notesFilter === 'paramedic' ? mergedTimeline.filter(i => i.type === 'patient') : mergedTimeline.filter(i => i.type === 'doctor' || i.type === 'doctornote');
                      return itemsToShow.length === 0 ? <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>No Notes Found</div> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {itemsToShow.map((item, index) => (
                            <div key={index} style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', background: item.type === 'doctor' ? '#fffef8' : item.type === 'doctornote' ? '#eff6ff' : item.type === 'extracted' ? '#f0fdf4' : '#fafafa' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', background: item.type === 'doctor' ? '#000' : item.type === 'doctornote' ? '#1d4ed8' : item.type === 'extracted' ? '#16a34a' : '#f0f0f0', color: item.type === 'doctor' || item.type === 'doctornote' || item.type === 'extracted' ? '#fff' : '#555', padding: '3px 8px', borderRadius: 3 }}>{item.type === 'doctornote' ? 'Doctor Note' : item.type === 'doctor' ? 'Doctor Suggestion' : item.type === 'extracted' ? 'Extracted Data' : 'Emergency Crew'}</span>
                                <span style={{ fontSize: 11, color: '#999' }}>{item.rawDate}</span>
                              </div>
                              <div style={{ padding: '14px 16px' }}>
                                <div style={{ fontSize: 13, lineHeight: 1.6, color: '#333' }}>{item.type === 'extracted' ? (item.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : item.text}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })() : (notesExtractedData.length === 0 ? <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>No extracted data found</div> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {notesExtractedData.map((item, i) => (
                          <div key={i} style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', background: '#fafafa' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, background: '#000', color: '#fff', padding: '3px 8px', borderRadius: 3, textTransform: 'uppercase' }}>Extracted Data</span>
                              <span style={{ fontSize: 11, color: '#999' }}>{item.timestamp_iso ? new Date(item.timestamp_iso).toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : 'N/A'}</span>
                            </div>
                            <div style={{ padding: '14px 16px' }}>
                              <div style={{ fontSize: 13, lineHeight: 1.6, color: '#333' }}>{(item.extracted_text || item.suggestion_text || 'No content').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
   {/* ── PROCESS PATIENT DATA BUTTON ── */}
<button onClick={() => {
  const hasNotes = (notes && notes.length > 0) || (doctorNotes && doctorNotes.length > 0);
  if (!hasNotes) { alert('⚠️ No paramedic voice notes & Doctor notes available for AI processing.'); return; }
  setShowDataProcessing(false);
  setTimeout(() => { setShowDataProcessing(true); setTimeout(() => { dataProcessingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200); }, 50);
}} style={{ marginTop: 16, background: '#000', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 8 }}>
  Process Patient Data →
</button>
{showDataProcessing && (
  <div ref={dataProcessingRef} style={{ marginTop: 30 }}>
    <DataProcessingInline patientData={patient} notes={notes} />
  </div>
)}

{/* ── IMAGE GALLERY SECTION INSIDE NOTES ── */}
<div id="clinical-images-section" style={{ marginTop: 24, marginBottom: 24, background: '#f0ebeb', borderRadius: 6, padding: '16px' }}>
  <div style={{
    fontSize: 12,
    fontWeight: 700,
    color: '#000',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottom: '1px solid #e8e8e8'
  }}>
    Clinical Images from Ambulance
  </div>
 <AmbulanceImagePhotography
    key={imageRefreshKey}
    patientId={patient?.patient_id}
    patientName={patient?.fullName}
  />
</div>
{/* ── STRUCTURED NOTE SECTION ── */}
<div style={{ marginTop: 32, background: '#f8f8f8', borderRadius: 8, border: '1px solid #e0e0e0', overflow: 'hidden' }}>
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 20px', borderBottom: showStructuredNote ? '1px solid #e0e0e0' : 'none',
    cursor: 'pointer', background: '#f8f8f8',
  }} onClick={() => setShowStructuredNote(prev => !prev)}>
    <span style={{  fontSize: 13, fontWeight: 800, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
      Structured Note
    </span>
    <span style={{ fontSize: 18, color: '#000', transition: 'transform 0.2s', transform: showStructuredNote ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
  </div>
  {showStructuredNote && (
    <StructuredNoteEmergency
  doctorId={localStorage.getItem('doctor_id') || localStorage.getItem('zenzo_doctor_id')}
  patientId={patient?.patient_id}
  onRefresh={handleStructuredNoteRefresh}
  onLoadingChange={handleStructuredNoteLoadingChange}
/>
  )}
</div>

{/* ── INSURANCE DOCUMENTATION SECTION ── */}
<div style={{ marginTop: 32, background: '#f8f8f8', borderRadius: 8, border: '1px solid #e0e0e0', overflow: 'hidden' }}>
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 20px', borderBottom: showInsuranceDoc ? '1px solid #e0e0e0' : 'none',
    cursor: 'pointer', background: '#f8f8f8',
  }} onClick={() => setShowInsuranceDoc(prev => !prev)}>
    <span style={{  fontSize: 13, fontWeight: 800, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
      Insurance Documentation
    </span>
    <span style={{ fontSize: 18, color: '#000', transition: 'transform 0.2s', transform: showInsuranceDoc ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
  </div>
  {showInsuranceDoc && (
    <div style={{ padding: '16px 20px' }}>
    <InsuranceDocumentation patientId={patient?.patient_id} />
    </div>
  )}
</div>

{/* ── FINAL SUMMARY SECTION ── */}
<div style={{ marginTop: 32, background: '#f8f8f8', borderRadius: 8, border: '1px solid #e0e0e0', overflow: 'hidden' }}>
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 20px', borderBottom: showFinalSummary ? '1px solid #e0e0e0' : 'none',
    cursor: 'pointer', background: '#f8f8f8',
  }} onClick={() => setShowFinalSummary(prev => !prev)}>
    <div style={{
      fontSize: 13, fontWeight: 800,
      color: '#000',
      textTransform: 'uppercase',
      letterSpacing: '1.2px'
    }}>
      Final Summary
    </div>
    <span style={{ fontSize: 18, color: '#000', transition: 'transform 0.2s', transform: showFinalSummary ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
  </div>
{showFinalSummary && (
  <div style={{ padding: '16px 20px 20px' }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <button onClick={async () => {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'final-summary-loading-popup';
        loadingDiv.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;`;
        loadingDiv.innerHTML = `<div style="background:white;padding:32px 48px;border-radius:8px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.2);min-width:300px;"><div style="margin-bottom:16px;"><div style="display:inline-block;width:40px;height:40px;border:3px solid #f0f0f0;border-top-color:#000;border-radius:50%;animation:spin 0.8s linear infinite;"></div></div><div style="font-size:16px;font-weight:600;color:#000;margin-bottom:8px;">Generating Final Summary</div><div style="font-size:13px;color:#666;">Please wait while AI processes patient data...</div></div>`;
        document.body.appendChild(loadingDiv);
        try {
          const response = await fetch(`https://doctorassist.ai/api/hms/users/ai-legacy/ed-summary/generate/${patient.patient_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
          await response.json();
          document.body.removeChild(loadingDiv);
          const successDiv = document.createElement('div');
          successDiv.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;`;
          successDiv.innerHTML = `<div style="background:white;padding:32px 48px;border-radius:8px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.2);min-width:320px;"><div style="font-size:48px;margin-bottom:16px;"></div><div style="font-size:18px;font-weight:700;color:#000;margin-bottom:12px;">Summary Generated!</div><div style="font-size:13px;color:#666;margin-bottom:24px;">Final ED Summary has been created successfully.</div><button id="success-ok-btn" style="background:#000;color:#fff;border:none;padding:10px 32px;border-radius:4px;font-size:14px;font-weight:600;cursor:pointer;">OK</button></div>`;
          document.body.appendChild(successDiv);
          document.getElementById('success-ok-btn')?.addEventListener('click', async () => {
            document.body.removeChild(successDiv);
            await fetchFinalSummary();
          });
        } catch (err) {
          if (document.getElementById('final-summary-loading-popup')) document.body.removeChild(loadingDiv);
          alert('Failed to generate final summary. Please try again.');
        }
      }} style={{ border: 'none', background: '#000', color: '#fff', padding: '8px 16px', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.3px' }}>
        + Generate Final Summary
      </button>
    </div>
    {finalSummaryLoading ? (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><Spinner size={32} /></div>
    ) : !finalSummary ? (
      <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>No Final Summary Available. Click "Generate Final Summary" to create one.</div>
    ) : (
      <FinalSummaryContent
        finalSummary={finalSummary}
        patientName={patient?.fullName}
        pdfLoading={pdfLoading}
        setPdfLoading={setPdfLoading}
      />
    )}
  </div>
)}
</div>
              </div>
            </div>
            </div>
          )}

          {/* HISTORY */}
          {activeTab === 'history' && (
            <>
              <div style={{ display: 'flex', background: '#f5f5f5', borderRadius: 6, padding: 4, marginBottom: 20 }}>
                <SubTab id="voice"    label="Voice Dictations" count={voiceDictations.length} current={dictTab} onSet={setDictTab} />
                <SubTab id="clinical" label="Clinical Actions"  count={clinicalActions.length} current={dictTab} onSet={setDictTab} />
              </div>
              {dictTab === 'voice' && (
                loadingDicts
                  ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 20, justifyContent: 'center' }}><Spinner /><span style={{ color: '#999', fontSize: 13 }}>Loading…</span></div>
                  : voiceDictations.length === 0
                  ? <div style={{ textAlign: 'center', padding: 40, color: '#aaa', fontSize: 13 }}>No voice dictations found.</div>
                  : voiceDictations.map((d, i) => <VoiceCard key={i} dictation={d} index={i} onView={openVoiceModal} />)
              )}
              {dictTab === 'clinical' && (
                loadingClinical
                  ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 20, justifyContent: 'center' }}><Spinner /><span style={{ color: '#999', fontSize: 13 }}>Loading…</span></div>
                  : clinicalActions.length === 0
                  ? <div style={{ textAlign: 'center', padding: 40, color: '#aaa', fontSize: 13 }}>No clinical actions yet.</div>
                  : clinicalActions.map((a, i) => <ClinicalCard key={i} action={a} onView={openClinicalModal} />)
              )}
            </>
          )}

          {/* RPM */}
     

          {/* FINAL SUMMARY */}
          {activeTab === 'final-summary' && (
            <div style={{ padding: 10 }}>
              {finalSummaryLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={32} /></div>
              ) : !finalSummary ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>No Final Summary Available</div>
              ) : (
                <FinalSummaryContent
                  finalSummary={finalSummary}
                  patientName={patient?.fullName}
                  pdfLoading={pdfLoading}
                  setPdfLoading={setPdfLoading}
                />
              )}
            </div>
          )}
{/* IMAGES - REMOVED FROM TABS */}
          {/* STRUCTURED NOTE */}
          {activeTab === 'structured-note' && (
            <StructuredNoteEmergency
  doctorId={localStorage.getItem('doctor_id') || localStorage.getItem('zenzo_doctor_id')}
  patientId={patient?.patient_id}
  onRefresh={handleStructuredNoteRefresh}
  onLoadingChange={handleStructuredNoteLoadingChange}
/>
          )}
{/* INSURANCE DOCUMENTATION */}
{activeTab === 'insurance-doc' && (
  <InsuranceDocumentation
    patientId={patient?.patient_id}
  />
)}
          {/* Notes + Voice — only for non-history, non-final-summary, non-structured-note tabs */}
       {activeTab === 'rpm' && (
    <div style={{ marginTop: 20 }}>

      {/* VOICE RECORDING */}
      <div style={{ marginBottom: 20 }}>
       
      </div>

      {/* Info message */}
      <div style={{
        marginBottom: 16, padding: '10px 16px',
        background: '#fff5f5', border: '1px solid #fecaca',
        borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>🔴</span>
        <span style={{
          fontSize: 12, color: '#dc2626', fontWeight: 500,
          fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
        }}>
          If you do not want AI processing of your Image, you can directly suggest to EMT using the voice notes below.
        </span>
      </div>

<div ref={voiceSectionRef} data-voice-section="true" style={{ marginBottom: 24, border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden' }}>         
                  <div style={{
                    padding: '14px 20px', background: '#fafafa', borderBottom: '1px solid #e8e8e8',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>VOICE NOTES / MANUAL INSTRUCTIONS &amp; DOCTOR NOTE</div>
                    <button type="button" onClick={async () => {
                      try {
                        if (isRecording) {
                          mediaRecorderRef.current.stop();
                          streamRef.current?.getTracks().forEach((track) => track.stop());
                          setIsRecording(false);
                          return;
                        }
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        streamRef.current = stream;
                        const mediaRecorder = new MediaRecorder(stream);
                        mediaRecorderRef.current = mediaRecorder;
                        audioChunksRef.current = [];
                        mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
                        mediaRecorder.onstop = async () => {
                          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                          const audioFile = new File([audioBlob], 'voice-note.webm', { type: 'audio/webm' });
                          await transcribeAudio(audioFile);
                          streamRef.current?.getTracks().forEach((track) => track.stop());
                        };
                        mediaRecorder.start();
                        setIsRecording(true);
                      } catch (err) {
                        console.error(err);
                        alert('Microphone permission denied');
                      }
                    }} disabled={transcribeLoading} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      {transcribeLoading ? <Spinner size={30} /> : isRecording ? (
  <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#dc3545', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.5s infinite' }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="3" width="12" height="16" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
    <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '1px', marginTop: 2 }}>REC</span>
  </div>
) : (
  <div style={{ width: 60, height: 60, borderRadius: '50%', border: '2px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  </div>
)}
                    </button>
                  </div>
                <div style={{ padding: 24 }}>
                    <textarea
                      value={dictationText}
                      onChange={(e) => setDictationText(e.target.value)}
                      placeholder="Enter additional clinical instructions or record voice/doctor notes..."
                      style={{ width: '100%', minHeight: 180, border: '1px solid #e8e8e8', padding: 20, fontSize: 14, borderRadius: 6, resize: 'vertical', outline: 'none', lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}
                    />
                    <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div>
                        <button onClick={handleVoiceSubmit} disabled={voiceSubmitLoading} style={{
                          background: '#dc2626', color: '#fff', border: 'none', padding: '12px 24px',
                          borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}>
                          {voiceSubmitLoading ? 'Sending to EMT…' : '📡 Send to EMT App Now'}
                        </button>
                        <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4, maxWidth: 220, lineHeight: 1.4 }}>Goes live to the ambulance crew's phone immediately — not used for AI analysis.</div>
                      </div>
                      <div>
                        <button onClick={handleDoctorNoteSubmit} disabled={doctorNoteSubmitLoading} style={{
                          background: '#fff', color: '#1d4ed8', border: '1.5px solid #1d4ed8', padding: '12px 24px',
                          borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}>
                          {doctorNoteSubmitLoading ? 'Saving…' : '📝 Save Note for AI Only'}
                        </button>
                        <div style={{ fontSize: 10, color: '#1d4ed8', marginTop: 4, maxWidth: 220, lineHeight: 1.4 }}>Saved for AI analysis only — the EMT app never sees this.</div>
                      </div>
                      <button onClick={() => {
                        setShowVoiceSection(false); setDictationText('');
                        if (isRecording) { mediaRecorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()); setIsRecording(false); }
                      }} style={{
                        background: '#fff', color: '#666', border: '1px solid #e8e8e8', padding: '12px 24px',
                        borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                      }}>Cancel</button>
                    </div>
                  </div>
                </div>
              {/* NOTES SECTION */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
             
           
              </div>

{loadingNotes ? (
  <div>Loading...</div>
) : (
  <div style={{ 
    border: '2px solid #e0e0e0', 
    borderRadius: 8, 
    padding: '16px',
    background: '#fefefe'
  }}>
    {/* ── NOTES HEADER ── */}
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
      paddingBottom: 10,
      borderBottom: '1px solid #e8e8e8'
    }}>
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        color: '#000',
        textTransform: 'uppercase',
        letterSpacing: '1.2px'
      }}>
        NOTES
      </div>
      <button onClick={fetchNotes} style={{
        background: '#000', color: '#fff', border: 'none', padding: '5px 12px',
        borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
      }}>Reload</button>
    </div>

    {/* ── 4 FILTER TABS ── */}
    <div style={{
      display: 'flex',
      gap: 8,
      marginBottom: 16,
      paddingBottom: 10,
      borderBottom: '1px solid #f0f0f0',
      flexWrap: 'wrap',
    }}>
      <button
        onClick={() => setNotesFilter('all')}
        style={{
          background: notesFilter === 'all' ? '#000' : '#f5f5f5',
          color: notesFilter === 'all' ? '#fff' : '#666',
          border: 'none',
          padding: '6px 14px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        All ({mergedTimeline.length + (notesExtractedData?.length || 0)})
      </button>
      <button
        onClick={() => setNotesFilter('paramedic')}
        style={{
          background: notesFilter === 'paramedic' ? '#000' : '#f5f5f5',
          color: notesFilter === 'paramedic' ? '#fff' : '#666',
          border: 'none',
          padding: '6px 14px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Emergency Crew ({mergedTimeline.filter(i => i.type === 'patient').length})
      </button>
      <button
        onClick={() => setNotesFilter('doctor')}
        style={{
          background: notesFilter === 'doctor' ? '#000' : '#f5f5f5',
          color: notesFilter === 'doctor' ? '#fff' : '#666',
          border: 'none',
          padding: '6px 14px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Doctor ({mergedTimeline.filter(i => i.type === 'doctor' || i.type === 'doctornote').length})
      </button>
      <button
        onClick={() => { setNotesFilter('extracted'); fetchExtractedDataForNotes(); }}
        style={{
          background: notesFilter === 'extracted' ? '#000' : '#f5f5f5',
          color: notesFilter === 'extracted' ? '#fff' : '#666',
          border: 'none',
          padding: '6px 14px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Extracted Data ({notesExtractedData?.length || 0})
      </button>
    </div>

    {/* ── NOTES LIST ── */}
  {notesFilter !== 'extracted' ? (
  (() => {
    let itemsToShow = [];
    if (notesFilter === 'all') {
      // Combine mergedTimeline and notesExtractedData for All tab
      itemsToShow = [
        ...mergedTimeline,
        ...notesExtractedData.map(item => ({ 
          ...item, 
          type: 'extracted', 
          rawDate: item.timestamp_iso ? new Date(item.timestamp_iso).toLocaleString('en-IN', { 
            year: 'numeric', month: '2-digit', day: '2-digit', 
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
          }) : 'N/A', 
          text: item.extracted_text || item.suggestion_text || 'No content' 
        }))
      ].sort((a, b) => new Date(b.timestamp_iso || b.timestamp) - new Date(a.timestamp_iso || a.timestamp));
    } else if (notesFilter === 'paramedic') {
      itemsToShow = mergedTimeline.filter(item => item.type === 'patient');
    } else if (notesFilter === 'doctor') {
      itemsToShow = mergedTimeline.filter(item => item.type === 'doctor' || item.type === 'doctornote');
    } else {
      itemsToShow = mergedTimeline;
    }
    
    return itemsToShow.length === 0 ? (
      <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>No Notes Found</div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {itemsToShow.map((item, index) => (
          <div key={index} style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', background: item.type === 'doctor' ? '#fffef8' : item.type === 'doctornote' ? '#eff6ff' : item.type === 'extracted' ? '#f0fdf4' : '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase',
                background: item.type === 'doctor' ? '#000' : item.type === 'doctornote' ? '#1d4ed8' : item.type === 'extracted' ? '#16a34a' : '#f0f0f0',
                color: item.type === 'doctor' ? '#fff' : item.type === 'doctornote' ? '#fff' : item.type === 'extracted' ? '#fff' : '#555',
                padding: '3px 8px', borderRadius: 3,
              }}>{item.type === 'doctornote' ? 'Doctor Note' : item.type === 'doctor' ? 'Doctor Suggestion' : item.type === 'extracted' ? 'Extracted Data' : 'Emergency Crew'}</span>
              <span style={{ fontSize: 11, color: '#999' }}>{item.rawDate}</span>
            </div>
            <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#333', whiteSpace: 'normal' }}>
  {item.type === 'extracted' 
    ? (typeof item.text === 'string' ? (item.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : 'No content')
    : (typeof item.text === 'string' ? item.text : JSON.stringify(item.text))}
</div>
            </div>
          </div>
        ))}
      </div>
    );
  })()
) : (
      notesExtractedData.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>No extracted data found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {notesExtractedData.map((item, i) => (
            <div key={i} style={{ border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', background: '#000', color: '#fff', padding: '3px 8px', borderRadius: 3 }}>Extracted Data</span>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {item.timestamp_iso 
                    ? new Date(item.timestamp_iso).toLocaleString('en-IN', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                      })
                    : 'N/A'}
                </span>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: '#333', whiteSpace: 'normal' }}>
  {(item.extracted_text || item.suggestion_text || 'No content').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()}
</div>
              </div>
            </div>
          ))}
        </div>
      )
    )}
  </div>
)} 
{/* Check if paramedic notes exist before showing DataProcessing */}
<button 
onClick={() => {
  const hasParamedicNotes = (notes && notes.length > 0) || (doctorNotes && doctorNotes.length > 0);

if (!hasParamedicNotes) {
      alert('⚠️ No paramedic voice notes & Doctor notes available for AI processing.\n\nPlease ask the paramedic to record voice notes , or add your own doctor note for AI processing.');
      return;
    }
    
    setShowDataProcessing(false);
    setTimeout(() => {
      setShowDataProcessing(true);
      setTimeout(() => { dataProcessingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
    }, 50);
  }}
  style={{
    background: '#000',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px'
  }}
>
  Process Patient Data →
</button>
              
              {showDataProcessing && (
  <div ref={dataProcessingRef} style={{ marginTop: 30 }}>
    <DataProcessingInline patientData={patient} notes={notes} />
  </div>
)}
            </div>
          )}
        </div>
      </div>
      {/* ── NEW IMAGE NOTIFICATION ── */}


  {/* ── NEW NOTE NOTIFICATION ── */}

      {/* ── MODALS ── */}
      {renderModal()}
    </>
  );
}