import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const API_BASE = 'https://doctorassist.ai/api';

// ─── Small helpers ─────────────────────────────────────────────────────────
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
  return true;
};
const cloneSuggestions = (s) => (s ? JSON.parse(JSON.stringify(s)) : null);

const Spinner = ({ size = 18, color = '#000' }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid ${color}22`, borderTopColor: color,
    borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0,
  }} />
);

const Badge = ({ label, bg = '#000', text = '#fff' }) => (
  <span style={{
    display: 'inline-block', padding: '3px 10px', background: bg, color: text,
    fontSize: 9, fontWeight: 700, letterSpacing: '0.9px',
    textTransform: 'uppercase', borderRadius: 3, flexShrink: 0,
  }}>{label}</span>
);

const SectionCard = ({ title, subtitle, accent, children }) => (
  <div style={{
    border: '1px solid #e8e8e8', borderLeft: accent ? `3px solid ${accent}` : '1px solid #e8e8e8',
    borderRadius: 4, marginBottom: 18, overflow: 'hidden',
  }}>
    <div style={{
      padding: '11px 18px', background: '#fafafa', borderBottom: '1px solid #e8e8e8',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#000', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
        {title}
      </span>
      {subtitle && <span style={{ fontSize: 10, color: '#aaa' }}>{subtitle}</span>}
      <span style={{ flex: 1, height: 1, background: '#e8e8e8' }} />
    </div>
    <div style={{ padding: '12px 18px 16px' }}>{children}</div>
  </div>
);

// ─── "Not enough data" placeholder — shown whenever a section's
// data_available is explicitly false. Never invents content. ─────────────
const NotEnoughData = ({ label, reason }) => (
  <p style={{ fontSize: 13, color: '#aaa', fontStyle: 'italic', lineHeight: 1.6 }}>
    Not enough data to determine {label}{reason ? ` — ${reason}` : '.'}
  </p>
);

const triageBg = (colour) => {
  const c = (colour || '').toLowerCase();
  if (c === 'red') return '#dc2626';
  if (c === 'yellow') return '#ca8a04';
  if (c === 'green') return '#16a34a';
  if (c === 'black') return '#111';
  return '#888'; // Unknown
};

// ─── Click-to-edit text. Renders plain text; clicking swaps in an
// input/textarea. Commits on blur or Enter (Escape reverts). Every
// sentence shown in the clinical summary goes through this component so
// the doctor can correct anything before approving. Becomes inert
// (plain text, no click) once `editable` is false — e.g. after approval. ──
function EditableText({ value, onChange, placeholder, style, multiline, editable = true }) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');
  const inputRef = useRef(null);

  useEffect(() => { setLocalValue(value || ''); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (localValue !== (value || '')) onChange(localValue);
  };

  const cancel = () => {
    setLocalValue(value || '');
    setEditing(false);
  };

  if (!editable) {
    return hasValue(value)
      ? <span style={style}>{value}</span>
      : <span style={{ ...style, color: '#ccc', fontStyle: 'italic' }}>{placeholder || '—'}</span>;
  }

  if (editing) {
    const commonProps = {
      ref: inputRef,
      value: localValue,
      onChange: (e) => setLocalValue(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      },
      style: {
        ...style, width: '100%', border: '1px solid #1d4ed8', borderRadius: 3,
        padding: '4px 6px', outline: 'none', fontFamily: "'DM Sans', sans-serif",
        background: '#fff', boxSizing: 'border-box',
      },
    };
    return multiline
      ? <textarea rows={4} style={{ ...commonProps.style, resize: 'vertical' }} {...commonProps} />
      : <input type="text" {...commonProps} />;
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        ...style, cursor: 'text', borderBottom: '1px dashed #ddd',
        display: 'inline-block',
      }}
    >
      {hasValue(value) ? value : <span style={{ color: '#ccc', fontStyle: 'italic' }}>{placeholder || 'click to add'}</span>}
    </span>
  );
}

// ─── Generic wrapper for the data-bearing sections. `section` is the
// {data_available, reason_if_unavailable, items|text} object; `renderContent`
// renders it when data_available is true. If the section itself is missing
// entirely (older cached result, etc.) the card is skipped rather than
// shown as falsely "not enough data". ────────────────────────────────────
function DataSection({ title, subtitle, accent, label, section, renderContent }) {
  if (!section || typeof section !== 'object') return null;
  const available = section.data_available !== false;
  return (
    <SectionCard title={title} subtitle={subtitle} accent={accent}>
      {available
        ? renderContent(section)
        : <NotEnoughData label={label} reason={section.reason_if_unavailable} />}
    </SectionCard>
  );
}

// ─── Treatment Plan / Drugs ────────────────────────────────────────────────
function renderTreatmentPlan(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="a treatment plan" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((x, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: i < list.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <EditableText
              editable={editable}
              value={x.drug_or_treatment}
              onChange={(v) => onField(i, 'drug_or_treatment', v)}
              style={{ fontSize: 13, fontWeight: 700, color: '#000' }}
            />
            <span style={{ minWidth: 60 }}>
              <EditableText
                editable={editable}
                value={x.dose}
                placeholder="dose"
                onChange={(v) => onField(i, 'dose', v)}
                style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8' }}
              />
            </span>
            {x.confirmation_status === 'previously_advised_unconfirmed' && (
              <Badge label="Confirm — advised earlier" bg="#ca8a04" />
            )}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 3, lineHeight: 1.5 }}>
            <EditableText
              editable={editable}
              multiline
              value={x.reason}
              placeholder="reason"
              onChange={(v) => onField(i, 'reason', v)}
              style={{ fontSize: 12, color: '#666' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Investigations ─────────────────────────────────────────────────────────
function renderInvestigations(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="investigations needed" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((x, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: i < list.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>
            <EditableText editable={editable} value={x.investigation} onChange={(v) => onField(i, 'investigation', v)} />
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.5 }}>
            <EditableText editable={editable} multiline value={x.justification} placeholder="justification" onChange={(v) => onField(i, 'justification', v)} style={{ fontSize: 12, color: '#666' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Procedures ─────────────────────────────────────────────────────────────
function renderProcedures(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="procedures to be done" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((x, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: i < list.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>
              <EditableText editable={editable} value={x.procedure} onChange={(v) => onField(i, 'procedure', v)} />
            </div>
            {x.confirmation_status === 'previously_advised_unconfirmed' && (
              <Badge label="Confirm — advised earlier" bg="#ca8a04" />
            )}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.5 }}>
            <EditableText editable={editable} multiline value={x.reason} placeholder="reason" onChange={(v) => onField(i, 'reason', v)} style={{ fontSize: 12, color: '#666' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SBAR Summary ────────────────────────────────────────────────────────────
function renderSbar(section, onChangeText, editable) {
  if (!hasValue(section.text) && !editable) return <NotEnoughData label="an SBAR summary" reason={null} />;
  return (
    <EditableText
      editable={editable}
      multiline
      value={section.text}
      placeholder="SBAR summary"
      onChange={onChangeText}
      style={{ fontSize: 13, lineHeight: 1.75, color: '#333', whiteSpace: 'pre-wrap' }}
    />
  );
}

// ─── Referrals ───────────────────────────────────────────────────────────────
function renderReferrals(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="a referral department" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {list.map((r, i) => (
        <div key={i}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#000', marginBottom: 3 }}>
            <EditableText editable={editable} value={r.specialty} onChange={(v) => onField(i, 'specialty', v)} />
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>
            <EditableText editable={editable} multiline value={r.reason} placeholder="reason" onChange={(v) => onField(i, 'reason', v)} style={{ fontSize: 13, color: '#555' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Anticipated Complications ─────────────────────────────────────────────
function renderComplications(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="anticipated complications" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((x, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: i < list.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>
            <EditableText editable={editable} value={x.complication} onChange={(v) => onField(i, 'complication', v)} />
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.5 }}>
            <EditableText editable={editable} multiline value={x.reason} placeholder="reason" onChange={(v) => onField(i, 'reason', v)} style={{ fontSize: 12, color: '#666' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Contraindication Checks ────────────────────────────────────────────────
function renderContraindications(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="contraindication checks" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((x, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: i < list.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>
            <EditableText editable={editable} value={x.treatment_or_medication} onChange={(v) => onField(i, 'treatment_or_medication', v)} />
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.5 }}>
            <EditableText editable={editable} multiline value={x.contraindication_assessment} placeholder="assessment" onChange={(v) => onField(i, 'contraindication_assessment', v)} style={{ fontSize: 12, color: '#666' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Precautions ─────────────────────────────────────────────────────────
function renderPrecautions(section, onField, editable) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (list.length === 0) return <NotEnoughData label="precautions" reason={null} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map((x, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: i < list.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>
            <EditableText editable={editable} value={x.precaution} onChange={(v) => onField(i, 'precaution', v)} />
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.5 }}>
            <EditableText editable={editable} multiline value={x.reason} placeholder="reason" onChange={(v) => onField(i, 'reason', v)} style={{ fontSize: 12, color: '#666' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Read-only renderer for one approved suggestion in the full history
// list — reuses the same section renderers as the live draft, but with
// editable=false and no-op field handlers, so nothing here is mutable. ──
function renderApprovedSuggestionDetail(ai) {
  const triage = ai.triage || {};
  const triageAvailable = triage.data_available !== false;
  const noop = () => {};
  return (
    <div>
      <div style={{ marginBottom: 4, marginTop: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 4 }}>
          Triage {triageAvailable ? `— ${triage.colour || 'Unknown'}` : ''}
        </div>
        {triageAvailable ? (
          <p style={{ fontSize: 13, color: '#333', lineHeight: 1.5, marginBottom: 10 }}>{triage.rationale}</p>
        ) : (
          <NotEnoughData label="a triage colour" reason={triage.reason_if_unavailable} />
        )}
        {hasValue(triage.safety_net_breaches) && (
          <div style={{ marginBottom: 10 }}>
            <Badge label="Escalated by automated safety check" bg="#dc2626" />
          </div>
        )}
      </div>

      <DataSection title="Treatment Plan" subtitle="drugs / treatment given" label="a treatment plan" section={ai.treatment_plan} renderContent={(section) => renderTreatmentPlan(section, noop, false)} />
      <DataSection title="Investigations Needed" label="investigations needed" section={ai.investigations} renderContent={(section) => renderInvestigations(section, noop, false)} />
      <DataSection title="Procedures" label="procedures to be done" section={ai.procedures} renderContent={(section) => renderProcedures(section, noop, false)} />
      <DataSection title="Handover Summary" subtitle="SBAR" accent="#000" label="an SBAR summary" section={ai.sbar_summary} renderContent={(section) => renderSbar(section, noop, false)} />
      <DataSection title="Referral Departments" accent="#1d4ed8" label="a referral department" section={ai.referrals} renderContent={(section) => renderReferrals(section, noop, false)} />
      <DataSection title="Anticipated Complications" accent="#ca8a04" label="anticipated complications" section={ai.complications} renderContent={(section) => renderComplications(section, noop, false)} />
      <DataSection title="Contraindication Checks" label="contraindication checks" section={ai.contraindications} renderContent={(section) => renderContraindications(section, noop, false)} />
      <DataSection title="Precautions" accent="#ca8a04" label="precautions" section={ai.precautions} renderContent={(section) => renderPrecautions(section, noop, false)} />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function DataProcessing({ patientData: propPatientData, incidentCompleted = false }) {
    const location = useLocation?.() || {};
  const patientData = propPatientData || location.state?.patientData;
  const patientId = patientData?.patient_id;

  const [loading, setLoading] = useState(true);
  const [processingError, setProcessingError] = useState('');
  const [result, setResult] = useState(null); // raw API response payload (read-only reference)
  const [draft, setDraft] = useState(null);   // editable clone of result.suggestions — this is what gets approved
  const [isApproved, setIsApproved] = useState(false);
  const [approvedAt, setApprovedAt] = useState(null);
  const [approvedActions, setApprovedActions] = useState([]); // FULL history of every approved suggestion for this patient
  const [expandedApprovedId, setExpandedApprovedId] = useState(null); // which approved-history card is currently open
  const [isDiscarded, setIsDiscarded] = useState(false); // set when doctor clicks "Not Approve" — no auto-regenerate
  const [approveLoading, setApproveLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setProcessingError('');
    try {
      const response = await fetch(
        `${API_BASE}/hms/users/ai-legacy/emergency/voice-suggestions/${patientId}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const data = await response.json();
      if (data.status === 'success') {
        const r = data.results?.[0];
        setResult(r);
        setDraft(cloneSuggestions(r?.suggestions));
        setIsApproved(false);
        setIsDiscarded(false);
        await checkPriorDecision();
      } else {
        setResult(null);
        setDraft(null);
        setProcessingError(data.detail || 'No suggestions available.');
      }
    } catch {
      setResult(null);
      setDraft(null);
      setProcessingError('Failed to load suggestions. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const checkPriorDecision = async () => {
    // NOTE: this only maintains the "Approved Suggestions" history list.
    // It must NOT touch isApproved/draft for the live suggestion — that
    // reflects whether the CURRENT freshly-generated suggestion has been
    // approved, not whether the patient has any past approvals at all.
    // Otherwise a brand-new suggestion generated after a prior approval
    // would be hidden with nothing left to approve or discard.
    try {
      const res = await fetch(`${API_BASE}/hms/users/ai-legacy/clinical-action/${patientId}`);
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.actions)) {
        setApprovedActions(data.actions.filter((a) => a.action_type === 'approved'));
      } else {
        setApprovedActions([]);
      }
    } catch (err) {
      console.error('Failed to check clinical action history', err);
    }
  };

  useEffect(() => { if (patientId) fetchSuggestions(); }, [patientId, fetchSuggestions]);

  // ── Edit helpers — mutate `draft` only. `result` (the raw AI output) is
  // never touched, so we always know exactly what the doctor changed. ──
  const updateItemField = (sectionKey, index, field, value) => {
    setDraft((prev) => {
      if (!prev || !prev[sectionKey] || !Array.isArray(prev[sectionKey].items)) return prev;
      const items = prev[sectionKey].items.map((it, i) => (i === index ? { ...it, [field]: value } : it));
      return { ...prev, [sectionKey]: { ...prev[sectionKey], items } };
    });
  };

  const updateSbarText = (value) => {
    setDraft((prev) => (prev ? { ...prev, sbar_summary: { ...(prev.sbar_summary || {}), text: value, data_available: true } } : prev));
  };

  const updateTriageRationale = (value) => {
    setDraft((prev) => (prev ? { ...prev, triage: { ...(prev.triage || {}), rationale: value } } : prev));
  };

  // ── Approve: saves the EDITED draft (not the raw AI suggestion) into
  // clinical_actions. The backend's save endpoint already notifies the
  // EMT/driver app on save, so this is the only handoff point needed. ──
  const handleApprove = async () => {
    setApproveLoading(true);
    try {
      const payload = {
        patient_id: patientId,
        ai_suggestion: draft,
        voice_dictation: null,
        action_type: 'approved',
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
      // Refresh the full approved-suggestion history from the server so the
      // suggestion just approved appears immediately in the "Approved
      // Suggestions" list below.
      await checkPriorDecision();
    } catch {
      alert('Failed to approve suggestion.');
    } finally {
      setApproveLoading(false);
    }
  };

  // ── Not Approve: simply discards the current generated suggestion.
  // Nothing is saved and nothing is sent to the EMT app. No new
  // suggestion is fetched — the doctor can retry manually later if needed. ──
  const handleNotApprove = () => {
    setIsDiscarded(true);
  };

  const s = result?.suggestions || {};       // raw AI output — only used for sufficiency/history flags, never rendered
  const d = draft || {};                      // editable version — this is what's rendered and approved
  const triage = d.triage || {};
  const sources = result?.data_sources || {};
  const history = result?.clinical_action_history || {};
  const insufficientData = s.sufficient_data === false;
  const triageDataAvailable = triage.data_available !== false;
  const editable = !isApproved && !incidentCompleted;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #fff; color: #000; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ekgDraw { 0% { stroke-dashoffset: 460; } 60% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -460; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        textarea, input { font-family: 'DM Sans', sans-serif; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ padding: '28px 24px 60px', maxWidth: 900, margin: '0 auto' }}>

          {/* ── HEADER ── */}
          <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid #e8e8e8' }}>
            <p style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 6 }}>
              Emergency Voice Intelligence System
            </p>
            <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, fontWeight: 400, letterSpacing: '-0.5px' }}>
              {patientData?.fullName || 'Patient'} — Clinical Summary
            </h1>
            {result && (
              <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                Generated {fmtDate(result.generated_at_ist)} · {sources.total_entries || 0} entries
                {sources.emt_voice_dictations > 0 && ` · ${sources.emt_voice_dictations} EMT`}
                {sources.doctor_voice_notes > 0 && ` · ${sources.doctor_voice_notes} Doctor`}
                {sources.image_extracted_records > 0 && ` · ${sources.image_extracted_records} Monitor`}
              </p>
            )}
            {editable && !loading && result && !insufficientData && !isDiscarded && (
              <p style={{ fontSize: 11, color: '#1d4ed8', marginTop: 8 }}>
                Click any line below to edit it before approving. Only what you approve is sent to the EMT app.
              </p>
            )}
          </div>

          {/* ── LOADING ── */}
          {loading && (
            <div style={{ padding: '70px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, animation: 'fadeInUp .4s ease' }}>
              <svg width="260" height="70" viewBox="0 0 260 70" style={{ overflow: 'visible' }}>
                <polyline points="0,35 65,35 80,35 90,10 100,60 110,5 120,35 135,35 260,35"
                  fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray="460" style={{ animation: 'ekgDraw 1.8s ease-in-out infinite' }} />
              </svg>
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#333', fontSize: 14, fontWeight: 600 }}>Reading notes…</p>
                <p style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>Extracting facts, then generating suggestions</p>
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {!loading && processingError && (
            <div style={{ border: '1px solid #fecaca', background: '#fff5f5', padding: 28, borderRadius: 6, color: '#dc2626' }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Unable to load suggestions</p>
              <p style={{ fontSize: 13 }}>{processingError}</p>
              <button onClick={fetchSuggestions} style={{
                marginTop: 14, background: '#000', color: '#fff', border: 'none', padding: '9px 18px',
                borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}>Retry</button>
            </div>
          )}

          {/* ── APPROVED — FULL HISTORY, not just the latest one ── */}
          {!loading && approvedActions.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 10 }}>
                Approved Suggestions ({approvedActions.length})
              </p>
              {approvedActions.map((action, idx) => {
                const key = action._id || idx;
                const isOpen = expandedApprovedId === key;
                const ai = action.ai_suggestion || {};
                const when = fmtDate(action.server_received_at || action.client_created_at);
                return (
                  <div key={key} style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 6, marginBottom: 10, overflow: 'hidden' }}>
                    <div style={{
                      padding: '16px 20px', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
                    }}>
                      <div>
                        <p style={{ fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>{patientData?.fullName || 'Patient'}</p>
                        <p style={{ fontSize: 12, color: '#555' }}>{when ? `Approved ${when} · sent to EMT app` : 'Approved · sent to EMT app'}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button onClick={() => setExpandedApprovedId(isOpen ? null : key)} style={{
                          background: '#fff', color: '#16a34a', border: '1px solid #16a34a', borderRadius: 4,
                          padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.4px', textTransform: 'uppercase',
                        }}>{isOpen ? 'Hide Details' : 'View Details'}</button>
                        <Badge label="Approved" bg="#16a34a" />
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 20px 20px' }}>
                        {renderApprovedSuggestionDetail(ai)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── DISCARDED (doctor clicked Not Approve) ── */}
          {!loading && result && !isApproved && isDiscarded && (
            <div style={{
              border: '1px solid #e8e8e8', background: '#fafafa', padding: 20, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 20,
            }}>
              <div>
                <p style={{ fontWeight: 700, color: '#555', marginBottom: 4 }}>{patientData?.fullName || 'Patient'}</p>
                <p style={{ fontSize: 12, color: '#888' }}>Suggestion discarded — nothing was sent to the EMT app.</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={fetchSuggestions} style={{
                  background: '#fff', color: '#000', border: '1px solid #000', borderRadius: 4,
                  padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.4px', textTransform: 'uppercase',
                }}>Generate New</button>
                <Badge label="Discarded" bg="#888" />
              </div>
            </div>
          )}

          {/* ── NOT ENOUGH DATA FOR THE WHOLE CASE ── */}
          {!loading && result && !isApproved && !isDiscarded && insufficientData && (
            <div style={{
              border: '1px solid #fde68a', background: '#fffbeb', padding: '20px 22px', borderRadius: 6, marginBottom: 20,
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <Badge label="Not Enough Information" bg="#ca8a04" />
              </div>
              <p style={{ fontSize: 13, color: '#333', lineHeight: 1.6, marginBottom: hasValue(s.missing_information) ? 12 : 0 }}>
                The notes available so far don't give enough to safely assess this patient at all.
              </p>
              {hasValue(s.missing_information) && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#ca8a04', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
                    Still Needed
                  </div>
                  {s.missing_information.filter(Boolean).map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'flex-start' }}>
                      <span style={{ color: '#ca8a04', fontSize: 14, lineHeight: 1.5 }}>•</span>
                      <span style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={fetchSuggestions} style={{
                background: '#000', color: '#fff', border: 'none', padding: '9px 18px',
                borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}>Check Again</button>
            </div>
          )}

          {/* ── MAIN SUGGESTIONS CONTENT — only the current, not-yet-approved
               suggestion. Past approvals are shown in the full history list above. ── */}
          {!loading && result && !insufficientData && !isDiscarded && !isApproved && (
            <div>

              {/* Triage strip */}
              <div style={{
                border: '1.5px solid #000', borderRadius: 4, marginBottom: 14, padding: '16px 18px',
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              }}>
                <span style={{
                  display: 'inline-block', width: 14, height: 14, borderRadius: 3,
                  background: triageDataAvailable ? triageBg(triage.colour) : '#ddd', flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 4 }}>
                    Triage {triageDataAvailable ? `— ${triage.colour || 'Unknown'}` : ''}
                  </div>
                  {triageDataAvailable ? (
                    <p style={{ fontSize: 13, color: '#333', lineHeight: 1.5 }}>
                      <EditableText
                        editable={editable}
                        multiline
                        value={triage.rationale}
                        placeholder="triage rationale"
                        onChange={updateTriageRationale}
                        style={{ fontSize: 13, color: '#333' }}
                      />
                    </p>
                  ) : (
                    <NotEnoughData label="a triage colour" reason={triage.reason_if_unavailable} />
                  )}
                  {hasValue(triage.safety_net_breaches) && (
                    <div style={{ marginTop: 8 }}>
                      <Badge label="Escalated by automated safety check" bg="#dc2626" />
                    </div>
                  )}
                </div>
              </div>

              {hasValue(triage.safety_net_breaches) && (
                <div style={{
                  border: '1px solid #fecaca', background: '#fff5f5', borderRadius: 4,
                  padding: '10px 16px', marginBottom: 14,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>
                    Automated Vital-Sign Safety Net Triggered
                  </div>
                  {triage.safety_net_breaches.filter(Boolean).map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'flex-start' }}>
                      <span style={{ color: '#dc2626', fontSize: 14, lineHeight: 1.5 }}>•</span>
                      <span style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}

              <DataSection
                title="Treatment Plan"
                subtitle="drugs / treatment to give"
                label="a treatment plan"
                section={d.treatment_plan}
                renderContent={(section) => renderTreatmentPlan(
                  section, (i, field, v) => updateItemField('treatment_plan', i, field, v), editable
                )}
              />

              <DataSection
                title="Investigations Needed"
                label="investigations needed"
                section={d.investigations}
                renderContent={(section) => renderInvestigations(
                  section, (i, field, v) => updateItemField('investigations', i, field, v), editable
                )}
              />

              <DataSection
                title="Procedures"
                label="procedures to be done"
                section={d.procedures}
                renderContent={(section) => renderProcedures(
                  section, (i, field, v) => updateItemField('procedures', i, field, v), editable
                )}
              />

              <DataSection
                title="Handover Summary"
                subtitle="SBAR"
                accent="#000"
                label="an SBAR summary"
                section={d.sbar_summary}
                renderContent={(section) => renderSbar(section, updateSbarText, editable)}
              />

              <DataSection
                title="Referral Departments"
                accent="#1d4ed8"
                label="a referral department"
                section={d.referrals}
                renderContent={(section) => renderReferrals(
                  section, (i, field, v) => updateItemField('referrals', i, field, v), editable
                )}
              />

              <DataSection
                title="Anticipated Complications"
                accent="#ca8a04"
                label="anticipated complications"
                section={d.complications}
                renderContent={(section) => renderComplications(
                  section, (i, field, v) => updateItemField('complications', i, field, v), editable
                )}
              />

              <DataSection
                title="Contraindication Checks"
                label="contraindication checks"
                section={d.contraindications}
                renderContent={(section) => renderContraindications(
                  section, (i, field, v) => updateItemField('contraindications', i, field, v), editable
                )}
              />

              <DataSection
                title="Precautions"
                accent="#ca8a04"
                label="precautions"
                section={d.precautions}
                renderContent={(section) => renderPrecautions(
                  section, (i, field, v) => updateItemField('precautions', i, field, v), editable
                )}
              />

              {(history.approved_count > 0 || history.rejected_count > 0) && (
                <p style={{ fontSize: 11, color: '#aaa', marginTop: 4, marginBottom: 8 }}>
                  {history.approved_count > 0 && `${history.approved_count} prior action(s) approved`}
                  {history.approved_count > 0 && history.rejected_count > 0 && ' · '}
                  {history.rejected_count > 0 && `${history.rejected_count} rejected`}
                  {' '}for this patient.
                </p>
              )}

              {/* ── ACTION BAR ── */}
              {!isApproved && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 32, paddingTop: 24, borderTop: '2px solid #e8e8e8' }}>
                  {incidentCompleted && (
                    <p style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                      Incident completed — this suggestion can no longer be approved or discarded.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <button onClick={handleApprove} disabled={approveLoading || incidentCompleted} style={{
                      background: (approveLoading || incidentCompleted) ? '#555' : '#000', color: '#fff', border: 'none',
                      padding: '14px 32px', borderRadius: 4, fontSize: 14, fontWeight: 600,
                      cursor: (approveLoading || incidentCompleted) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
                      display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.3px',
                      opacity: incidentCompleted ? 0.6 : 1,
                    }}>
                      {approveLoading ? <><Spinner size={14} color="#fff" /> Approving…</> : '✓ Approve & Send to EMT'}
                    </button>
                    <button onClick={handleNotApprove} disabled={approveLoading || incidentCompleted} style={{
                      background: '#fff', color: '#000', border: '1.5px solid #000', padding: '14px 28px',
                      borderRadius: 4, fontSize: 14, fontWeight: 600,
                      cursor: (approveLoading || incidentCompleted) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
                      display: 'flex', alignItems: 'center', gap: 8,
                      opacity: incidentCompleted ? 0.6 : 1,
                    }}>
                      ✕ Not Approve — Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}