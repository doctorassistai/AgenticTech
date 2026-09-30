import React, { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// SessionHistory — the "History records" block shown at the TOP of a tab that
// saves SESSIONS rather than a single overwritten section (the Procedure entry,
// the Psychotherapy/CBT log, the MSE tab and Baseline Investigations).
//
// Behaviour is fixed by design (do not turn this into a list/form editor):
//   • one collapsible section titled "History records", DEFAULT COLLAPSED,
//   • it lists every saved session date-wise (newest first — the caller sorts),
//   • clicking one entry expands it to show that session's saved data.
//
// An expanded entry renders one of two ways, chosen with the `detail` prop:
//   • 'grid'  (default) — label-over-value pairs in two columns. Right for a
//     narrative session, where most values are prose or a graded option.
//   • 'table' — a real Parameter / Value / Unit table, grouped. Right for a panel
//     of measurements (Baseline Investigations), where the point is to read a
//     column of numbers with their units and compare across dates.
//
// The caller maps its own storage shape onto the normalised `entries` array, so
// this component knows nothing about procedures, CBT, MSE or labs specifically.
// ─────────────────────────────────────────────────────────────────────────────

/** ISO timestamp → short readable local date/time ('' when unparseable). */
export function formatSavedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sort key for date-wise ordering: the clinical date the caller nominates
 * (session.data[dateKey]) if parseable, else the saved timestamp.
 *
 * @param {object} session  { saved_at, data }
 * @param {string} dateKey  the data field holding the clinical date
 */
export function sessionTime(session, dateKey) {
  const clinical = dateKey ? session?.data?.[dateKey] : undefined;
  const t = clinical ? Date.parse(clinical) : NaN;
  if (!Number.isNaN(t)) return t;
  const savedAt = session?.saved_at ? Date.parse(session.saved_at) : NaN;
  return Number.isNaN(savedAt) ? 0 : savedAt;
}

export function isEmptyVal(v) {
  return (
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** camelCase field key → readable label (e.g. cbtPreSuds → "Cbt Pre Suds"). */
export function humanizeKey(k) {
  const s = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function renderVal(v) {
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0] !== null) {
      return v
        .map((o) => Object.values(o).filter(Boolean).join(' — '))
        .filter(Boolean)
        .join('; ');
    }
    return v.join(', ');
  }
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return String(v);
}

/**
 * Table body for `detail="table"`. Groups are section-labelled bands of rows;
 * a group with no rows (nothing recorded in that part of the panel) is dropped
 * rather than shown empty.
 *
 * @param {object} props
 * @param {Array}  props.groups  [{ group, rows: [{ k, label, value, unit }] }]
 */
const DetailTable = ({ groups = [] }) => {
  const visible = groups.filter((g) => (g.rows || []).length);
  if (!visible.length) return null;

  const th = {
    padding: '6px 10px',
    background: '#fafafa',
    borderBottom: '1px solid #e8e8e8',
    fontSize: '10px',
    fontWeight: 600,
    color: '#7a7a7a',
    textTransform: 'uppercase',
    letterSpacing: '.05em',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };
  const td = {
    padding: '5px 10px',
    borderBottom: '1px solid #f4f4f4',
    fontSize: '12px',
    color: '#1a1a1a',
    verticalAlign: 'top',
  };

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #ececec', borderRadius: '3px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={th}>Parameter</th>
            <th style={{ ...th, width: '34%' }}>Value</th>
            <th style={{ ...th, width: '16%' }}>Unit</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((group) => (
            <React.Fragment key={group.group || '_'}>
              {group.group ? (
                <tr>
                  <td
                    colSpan={3}
                    style={{
                      padding: '6px 10px',
                      background: '#f7f9fb',
                      borderBottom: '1px solid #e8e8e8',
                      borderTop: '1px solid #e8e8e8',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#3a5a78',
                    }}
                  >
                    {group.group}
                  </td>
                </tr>
              ) : null}
              {group.rows.map((row) => (
                <tr key={`${group.group || '_'}:${row.k || row.label}`}>
                  <td style={{ ...td, color: '#4a4a4a', wordBreak: 'break-word' }}>
                    {row.label}
                  </td>
                  <td style={{ ...td, fontWeight: 500, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {row.value}
                  </td>
                  <td style={{ ...td, color: '#9a9a9a', fontSize: '11px' }}>{row.unit || ''}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ConversationPreview = ({ text }) => {
  const [modalOpen, setModalOpen] = useState(false);
  if (!text) return null;

  return (
    <>
      <div style={{ marginTop: '20px', padding: '14px', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: '#3a3a3a', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '14px' }}>🎙️</span> Conversation Transcript
          </h4>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={{
              background: 'none', border: 'none', color: '#1890ff', fontSize: '12px', fontWeight: 500, cursor: 'pointer', padding: 0
            }}
          >
            View Full
          </button>
        </div>
        <div style={{ fontSize: '12.5px', color: '#4a4a4a', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.5', paddingRight: '20px' }}>
          {text}
        </div>
      </div>

      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(255, 255, 255, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
          }}
          onClick={() => setModalOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              width: '100%',
              maxWidth: '600px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#1a1a1a' }}>Conversation Transcript</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9a9a9a' }}
              >
                &times;
              </button>
            </div>
            <div style={{ padding: '16px', overflowY: 'auto', fontSize: '13px', lineHeight: '1.6', color: '#1a1a1a', whiteSpace: 'pre-wrap' }}>
              {text}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * @param {object}   props
 * @param {Array}    props.entries  already sorted newest-first. Each entry:
 *        { id, dateLabel, title, note?, badge?, meta?, data, skipKeys?, table? }
 *        `table` is only read when detail === 'table'; without it the table is
 *        built from `data` with humanised keys and no units.
 * @param {string}   [props.title]  section heading (default "History records")
 * @param {string}   [props.countLabel]  right of the heading (default "N saved")
 * @param {'grid'|'table'} [props.detail]  how an expanded entry renders
 */
const SessionHistory = ({
  entries = [],
  title = 'History records',
  countLabel,
  detail = 'grid',
}) => {
  const [open, setOpen] = useState(false); // default collapsed
  const [expandedId, setExpandedId] = useState(null);

  if (!entries.length) return null;

  return (
    <div style={{ marginBottom: '18px', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          background: '#fafafa',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>
          {title}
          <span style={{ marginLeft: '8px', fontWeight: 400, color: '#7a7a7a' }}>
            {countLabel || `${entries.length} saved`}
          </span>
        </span>
        <span
          style={{
            fontSize: '11px',
            color: '#7a7a7a',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
          }}
        >
          ▶
        </span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #e8e8e8' }}>
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const skip = new Set(entry.skipKeys || []);
            skip.add('sessionTranscript');
            const details = Object.entries(entry.data || {}).filter(
              ([k, v]) => !skip.has(k) && !isEmptyVal(v)
            );
            return (
              <div key={entry.id} style={{ borderBottom: '1px solid #f2f2f2' }}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '10px 14px',
                    background: isExpanded ? '#f7f7f7' : '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>
                      {entry.dateLabel || '—'}
                    </span>
                    <span style={{ fontSize: '12px', color: '#3a3a3a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.title}
                      {entry.note ? <span style={{ color: '#9a9a9a' }}> · {entry.note}</span> : null}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    {entry.badge ? (
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 500,
                          padding: '2px 8px',
                          borderRadius: '3px',
                          background: '#eef2f6',
                          color: '#3a5a78',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.badge}
                      </span>
                    ) : null}
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#9a9a9a',
                        transform: isExpanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform .15s',
                      }}
                    >
                      ▶
                    </span>
                  </span>
                </button>

                {isExpanded && (
                  <div style={{ padding: '4px 14px 14px' }}>
                    {entry.meta && (
                      <div style={{ fontSize: '11px', color: '#9a9a9a', margin: '0 0 8px' }}>
                        {entry.meta}
                      </div>
                    )}
                    {detail === 'table' ? (
                      <DetailTable
                        groups={
                          entry.table || [
                            {
                              group: '',
                              rows: details.map(([k, v]) => ({
                                k,
                                label: humanizeKey(k),
                                value: renderVal(v),
                                unit: '',
                              })),
                            },
                          ]
                        }
                      />
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', columnGap: '24px', rowGap: '0' }}>
                        {details.map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#555', flexShrink: 0, width: '130px', paddingTop: '1px' }}>
                              {humanizeKey(k)}
                            </span>
                            <span style={{ fontSize: '12.5px', color: '#1a1a1a', flexGrow: 1, whiteSpace: 'pre-wrap', lineHeight: '1.4', wordBreak: 'break-word' }}>
                              {renderVal(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <ConversationPreview text={entry.data?.sessionTranscript} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SessionHistory;
