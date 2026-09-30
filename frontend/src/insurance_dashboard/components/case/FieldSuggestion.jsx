// components/case/FieldSuggestion.jsx
// Replaces SuggestionBanner everywhere. Renders nothing if there's no
// suggestion or it matches what's already in the field. If the document(s)
// produced more than one distinct value for this field, renders a small
// row of source-labelled chips instead of a single "Apply" banner, so the
// user picks which extracted value wins rather than one silently
// overwriting another.
export default function FieldSuggestion({ suggestion, currentValue, onApply, onDismiss }) {
  if (!suggestion) return null

  const candidates = Array.isArray(suggestion.candidates) ? suggestion.candidates : []
  const hasConflict = candidates.length > 1

  if (!hasConflict) {
    const value = suggestion.value
    if (value === null || value === undefined || value === '' || value === currentValue) return null
    return (
      <div className="fld-suggestion">
        <span>✨ Suggested: <strong>{String(value)}</strong></span>
        <button type="button" onClick={() => onApply(value)}>Apply</button>
        <button type="button" className="fld-suggestion-x" onClick={onDismiss}>✕</button>
        <style>{`
          .fld-suggestion { display:flex; align-items:center; gap:8px; margin-top:4px; padding:4px 8px;
            background: color-mix(in srgb, var(--amber,#f59e0b) 10%, transparent);
            border: 1px solid color-mix(in srgb, var(--amber,#f59e0b) 30%, transparent);
            border-radius: 6px; font-size: 11px; color: var(--amber,#b45309); }
          .fld-suggestion button { font-size: 11px; padding: 1px 8px; border-radius: 4px; cursor: pointer;
            border: 1px solid currentColor; background: transparent; color: inherit; }
          .fld-suggestion-x { padding: 1px 6px !important; margin-left: auto; }
        `}</style>
      </div>
    )
  }

  return (
    <div className="fld-suggestion fld-suggestion-conflict">
      <span>⚠ Multiple values found:</span>
      <div className="fld-chip-row">
        {candidates.map((c, i) => (
          <button key={i} type="button" className="fld-chip" onClick={() => onApply(c.value)}>
            {String(c.value)} <em>({c.source})</em>
          </button>
        ))}
      </div>
      <button type="button" className="fld-suggestion-x" onClick={onDismiss}>✕</button>
      <style>{`
        .fld-suggestion-conflict { display:flex; align-items:flex-start; gap:8px; margin-top:4px; padding:6px 8px;
          background: color-mix(in srgb, var(--red,#dc2626) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--red,#dc2626) 25%, transparent);
          border-radius: 6px; font-size: 11px; color: var(--red,#b91c1c); flex-wrap: wrap; }
        .fld-chip-row { display:flex; flex-wrap:wrap; gap:6px; flex:1; }
        .fld-chip { font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
          border: 1px solid currentColor; background: transparent; color: inherit; }
        .fld-chip em { opacity: 0.7; font-style: normal; }
        .fld-suggestion-x { border: 1px solid currentColor; background: transparent; color: inherit;
          border-radius: 4px; padding: 1px 6px; cursor: pointer; }
      `}</style>
    </div>
  )
}