// SuggestionBanner.jsx
export default function SuggestionBanner({ value, onApply, onDismiss }) {
  if (!value) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', marginTop: 3,
      background: 'color-mix(in srgb, var(--amber,#f59e0b) 10%, transparent)',
      border: '1px solid color-mix(in srgb, var(--amber,#f59e0b) 25%, transparent)',
      borderRadius: 6, fontSize: 11,
      color: 'var(--amber,#b45309)',
    }}>
      <span style={{ fontSize: 11, flexShrink: 0 }}>✨ Suggestion:</span>
      <span
        onClick={() => onApply(value)}
        style={{
          fontWeight: 600, cursor: 'pointer',
          textDecoration: 'underline dotted',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        title={`Click to apply: ${value}`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginLeft: 'auto', flexShrink: 0,
          background: 'none', border: 'none',
          cursor: 'pointer', color: 'inherit',
          opacity: 0.5, fontSize: 14, lineHeight: 1, padding: 0,
        }}
        aria-label="Dismiss"
      >×</button>
    </div>
  )
}