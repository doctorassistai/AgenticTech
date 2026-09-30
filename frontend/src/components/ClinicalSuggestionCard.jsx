import React, { useState, useEffect, useRef } from 'react';

// ─── Helpers ────────────────────────────────────────────────────────────────
export const hasValue = (v) => {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
};

export const cloneSuggestions = (s) => (s ? JSON.parse(JSON.stringify(s)) : null);

const triageBg = (colour) => {
  const c = (colour || '').toLowerCase();
  if (c === 'red') return '#dc2626';
  if (c === 'yellow') return '#ca8a04';
  if (c === 'green') return '#16a34a';
  if (c === 'black') return '#111';
  return '#888';
};

const Badge = ({ label, bg = '#000', text = '#fff' }) => (
  <span style={{
    display: 'inline-block', padding: '2px 8px', background: bg, color: text,
    fontSize: 9, fontWeight: 700, letterSpacing: '0.7px',
    textTransform: 'uppercase', borderRadius: 3, flexShrink: 0,
  }}>{label}</span>
);

const NotEnoughData = ({ label, reason }) => (
  <p style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic', lineHeight: 1.5 }}>
    Not enough data for {label}{reason ? ` — ${reason}` : '.'}
  </p>
);

// Compact section wrapper — a labeled block, not a full bordered card,
// since this whole thing already lives inside a chat bubble.
const MiniSection = ({ title, subtitle, accent, label, section, children }) => {
  if (!section || typeof section !== 'object') return null;
  const available = section.data_available !== false;
  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #eee7d6' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.9px', textTransform: 'uppercase',
          color: accent || '#666',
        }}>{title}</span>
        {subtitle && <span style={{ fontSize: 9.5, color: '#aaa' }}>{subtitle}</span>}
      </div>
      {available ? children : <NotEnoughData label={label} reason={section.reason_if_unavailable} />}
    </div>
  );
};

// ─── Click-to-edit text ────────────────────────────────────────────────────
export function EditableText({ value, onChange, placeholder, style, multiline, editable = true }) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');
  const inputRef = useRef(null);

  useEffect(() => { setLocalValue(value || ''); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (localValue !== (value || '')) onChange(localValue);
  };
  const cancel = () => { setLocalValue(value || ''); setEditing(false); };

  if (!editable) {
    return hasValue(value)
      ? <span style={style}>{value}</span>
      : <span style={{ ...style, color: '#ccc', fontStyle: 'italic' }}>{placeholder || '—'}</span>;
  }

  if (editing) {
    const commonProps = {
      ref: inputRef, value: localValue, onChange: (e) => setLocalValue(e.target.value), onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      },
      style: {
        ...style, width: '100%', border: '1px solid #1d4ed8', borderRadius: 3,
        padding: '3px 5px', outline: 'none', fontFamily: "'DM Sans', sans-serif",
        background: '#fff', boxSizing: 'border-box',
      },
    };
    return multiline
      ? <textarea rows={3} style={{ ...commonProps.style, resize: 'vertical' }} {...commonProps} />
      : <input type="text" {...commonProps} />;
  }

  return (
    <span onClick={() => setEditing(true)} title="Click to edit" style={{
      ...style, cursor: 'text', borderBottom: '1px dashed #ccc', display: 'inline-block',
    }}>
      {hasValue(value) ? value : <span style={{ color: '#ccc', fontStyle: 'italic' }}>{placeholder || 'click to add'}</span>}
    </span>
  );
}

// ─── Section renderers (compact) ──────────────────────────────────────────
const List = ({ items, render }) => (
  <div>
    {items.map((x, i) => (
      <div key={i} style={{ padding: '5px 0', borderTop: i > 0 ? '1px solid #f2ede0' : 'none' }}>
        {render(x, i)}
      </div>
    ))}
  </div>
);

function TreatmentPlan({ section, onField, editable }) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (!list.length) return <NotEnoughData label="a treatment plan" />;
  return (
    <List items={list} render={(x, i) => (
      <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <EditableText editable={editable} value={x.drug_or_treatment} onChange={(v) => onField(i, 'drug_or_treatment', v)} style={{ fontSize: 12.5, fontWeight: 700 }} />
          <EditableText editable={editable} value={x.dose} placeholder="dose" onChange={(v) => onField(i, 'dose', v)} style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8' }} />
          {x.confirmation_status === 'previously_advised_unconfirmed' && <Badge label="Confirm" bg="#ca8a04" />}
        </div>
        <div style={{ marginTop: 2 }}>
          <EditableText editable={editable} multiline value={x.reason} placeholder="reason" onChange={(v) => onField(i, 'reason', v)} style={{ fontSize: 11.5, color: '#666' }} />
        </div>
      </>
    )} />
  );
}

function PreviouslyAdministered({ section }) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (!list.length) return <NotEnoughData label="previously administered treatments" reason={section.reason_if_unavailable} />;
  return (
    <List items={list} render={(x) => (
      <>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{x.treatment_or_medication}</div>
        <div style={{ fontSize: 11.5, color: '#666', marginTop: 2 }}>{x.reason}</div>
      </>
    )} />
  );
}

function ItemList({ section, fields, onField, editable, emptyLabel }) {
  const list = Array.isArray(section.items) ? section.items : [];
  if (!list.length) return <NotEnoughData label={emptyLabel} />;
  return (
    <List items={list} render={(x, i) => (
      <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <EditableText editable={editable} value={x[fields.title]} onChange={(v) => onField(i, fields.title, v)} style={{ fontSize: 12.5, fontWeight: 600 }} />
          {x.confirmation_status === 'previously_advised_unconfirmed' && <Badge label="Confirm" bg="#ca8a04" />}
        </div>
        <div style={{ marginTop: 2 }}>
          <EditableText editable={editable} multiline value={x[fields.detail]} placeholder={fields.detail} onChange={(v) => onField(i, fields.detail, v)} style={{ fontSize: 11.5, color: '#666' }} />
        </div>
      </>
    )} />
  );
}

function Sbar({ section, onChangeText, editable }) {
  if (!hasValue(section.text) && !editable) return <NotEnoughData label="an SBAR summary" />;
  return (
    <EditableText editable={editable} multiline value={section.text} placeholder="SBAR summary" onChange={onChangeText}
      style={{ fontSize: 12.5, lineHeight: 1.65, color: '#333', whiteSpace: 'pre-wrap' }} />
  );
}

// ─── Main compact card ─────────────────────────────────────────────────────
/**
 * ClinicalSuggestionCard
 * Renders the same suggestion shape used by DataProcessing.jsx / approved
 * clinical_action.ai_suggestion, but compact for a chat bubble.
 *
 * Props:
 *  - draft: the editable suggestions object (mutate only via callbacks)
 *  - onUpdateItem(sectionKey, index, field, value)
 *  - onUpdateSbar(value)
 *  - onUpdateTriage(value)
 *  - editable: bool
 *  - sufficientData: bool — when false, only the missing-info notice renders
 *  - missingInformation: string[]
 */
const TRIAGE_RANK = { Green: 0, Yellow: 1, Unknown: 1, Red: 2, Black: 3 };

export default function ClinicalSuggestionCard({
  draft, onUpdateItem, onUpdateSbar, onUpdateTriage, onUpdateTriageColour, editable, sufficientData = true, missingInformation = [],
}) {
  const d = draft || {};
  const triage = d.triage || {};
  const triageAvailable = triage.data_available !== false;

  if (!sufficientData) {
    return (
      <div>
        <div style={{ marginBottom: 8 }}><Badge label="Not Enough Information" bg="#ca8a04" /></div>
        <p style={{ fontSize: 12.5, color: '#333', lineHeight: 1.6, marginBottom: hasValue(missingInformation) ? 8 : 0 }}>
          The notes available don't give enough to safely assess this patient yet.
        </p>
        {hasValue(missingInformation) && (
          <div>
            {missingInformation.filter(Boolean).map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
                <span style={{ color: '#ca8a04', fontSize: 12 }}>•</span>
                <span style={{ fontSize: 12, color: '#333' }}>{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Triage */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #eee7d6' }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: triageAvailable ? triageBg(triage.colour) : '#ddd', flexShrink: 0, marginTop: 3 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.9px' }}>
              Triage
            </span>
            {triageAvailable && editable && onUpdateTriageColour ? (
              <select
                value={triage.colour || ''}
                onChange={(e) => onUpdateTriageColour(e.target.value)}
                style={{
                  fontSize: 11, fontWeight: 700, color: '#fff',
                  background: triageBg(triage.colour), border: 'none', borderRadius: 3,
                  padding: '2px 8px', cursor: 'pointer', appearance: 'none',
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                }}
              >
                <option value="Red">Red</option>
                <option value="Yellow">Yellow</option>
                <option value="Green">Green</option>
                <option value="Black">Black</option>
              </select>
            ) : triageAvailable ? (
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#fff', background: triageBg(triage.colour),
                borderRadius: 3, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>{triage.colour || 'Unknown'}</span>
            ) : null}
          </div>
          {triageAvailable ? (
            <EditableText editable={editable} multiline value={triage.rationale} placeholder="triage rationale" onChange={onUpdateTriage} style={{ fontSize: 12.5, color: '#333' }} />
          ) : (
            <NotEnoughData label="a triage colour" reason={triage.reason_if_unavailable} />
          )}
          {hasValue(triage.safety_net_breaches) && (
            <div style={{ marginTop: 6 }}>
              <Badge label="Safety check escalated" bg="#dc2626" />
              {editable && triageAvailable && TRIAGE_RANK[triage.colour] < TRIAGE_RANK['Red'] && (
                <div style={{ marginTop: 4, fontSize: 10.5, color: '#dc2626', fontWeight: 600 }}>
                  ⚠ This case triggered an automated vital-sign safety escalation to Red — overriding it below a Red triage should only be done deliberately.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <MiniSection title="Previously Administered" subtitle="already given" label="previously administered treatments" section={d.previously_administered}>
        <PreviouslyAdministered section={d.previously_administered} />
      </MiniSection>

      <MiniSection title="Treatment Plan" subtitle="to give" label="a treatment plan" section={d.treatment_plan}>
        <TreatmentPlan section={d.treatment_plan} editable={editable} onField={(i, f, v) => onUpdateItem('treatment_plan', i, f, v)} />
      </MiniSection>

      <MiniSection title="Investigations" label="investigations needed" section={d.investigations}>
        <ItemList section={d.investigations} editable={editable} emptyLabel="investigations needed"
          fields={{ title: 'investigation', detail: 'justification' }}
          onField={(i, f, v) => onUpdateItem('investigations', i, f, v)} />
      </MiniSection>

      <MiniSection title="Procedures" label="procedures to be done" section={d.procedures}>
        <ItemList section={d.procedures} editable={editable} emptyLabel="procedures to be done"
          fields={{ title: 'procedure', detail: 'reason' }}
          onField={(i, f, v) => onUpdateItem('procedures', i, f, v)} />
      </MiniSection>

      <MiniSection title="Handover" subtitle="SBAR" accent="#111" label="an SBAR summary" section={d.sbar_summary}>
        <Sbar section={d.sbar_summary} editable={editable} onChangeText={onUpdateSbar} />
      </MiniSection>

      <MiniSection title="Referrals" accent="#1d4ed8" label="a referral department" section={d.referrals}>
        <ItemList section={d.referrals} editable={editable} emptyLabel="a referral department"
          fields={{ title: 'specialty', detail: 'reason' }}
          onField={(i, f, v) => onUpdateItem('referrals', i, f, v)} />
      </MiniSection>

      <MiniSection title="Anticipated Complications" accent="#ca8a04" label="anticipated complications" section={d.complications}>
        <ItemList section={d.complications} editable={editable} emptyLabel="anticipated complications"
          fields={{ title: 'complication', detail: 'reason' }}
          onField={(i, f, v) => onUpdateItem('complications', i, f, v)} />
      </MiniSection>

      <MiniSection title="Contraindication Checks" label="contraindication checks" section={d.contraindications}>
        <ItemList section={d.contraindications} editable={editable} emptyLabel="contraindication checks"
          fields={{ title: 'treatment_or_medication', detail: 'contraindication_assessment' }}
          onField={(i, f, v) => onUpdateItem('contraindications', i, f, v)} />
      </MiniSection>

      <MiniSection title="Precautions" accent="#ca8a04" label="precautions" section={d.precautions}>
        <ItemList section={d.precautions} editable={editable} emptyLabel="precautions"
          fields={{ title: 'precaution', detail: 'reason' }}
          onField={(i, f, v) => onUpdateItem('precautions', i, f, v)} />
      </MiniSection>
    </div>
  );
}