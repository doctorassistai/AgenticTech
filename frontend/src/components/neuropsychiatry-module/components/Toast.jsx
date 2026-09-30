import React, { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Toast.jsx — a floating, auto-dismissing save confirmation.
//
// Renders fixed to the top-center of the viewport (zIndex above all workflow
// chrome), so it "pops up" over the page instead of pushing an inline banner
// into the document flow below the form. Success toasts fade out after a short
// delay; error toasts linger longer so the doctor can read them. Either can be
// dismissed manually with the × button.
//
// Props:
//   toast    { ok: boolean, text: string } | null   — null renders nothing
//   onClose  () => void                              — clears the toast
// ─────────────────────────────────────────────────────────────────────────────
const Toast = ({ toast, onClose }) => {
  // Mirror the latest onClose so the auto-dismiss timer never captures a stale
  // closure and the timer isn't reset by unrelated parent re-renders.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!toast) return undefined;
    const ms = toast.ok ? 2800 : 6000; // success is brief; errors linger
    const id = setTimeout(() => onCloseRef.current && onCloseRef.current(), ms);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast) return null;

  const ok = toast.ok;

  return (
    <>
      <style>
        {`@keyframes npsyToastIn {
            from { opacity: 0; transform: translate(-50%, -10px); }
            to   { opacity: 1; transform: translate(-50%, 0); }
          }`}
      </style>
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          maxWidth: 'min(90vw, 480px)',
          padding: '11px 14px 11px 16px',
          borderRadius: '4px',
          fontFamily: '"Open Sans", sans-serif',
          fontSize: '13px',
          fontWeight: 500,
          lineHeight: 1.4,
          border: '1px solid',
          boxShadow: '0 6px 22px rgba(0,0,0,.15)',
          animation: 'npsyToastIn .18s ease-out',
          ...(ok
            ? { background: '#eef6ee', color: '#1e6b32', borderColor: '#cfe5d2' }
            : { background: '#fdecec', color: '#9b1c1c', borderColor: '#f5c6c6' }),
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: '11px',
            fontWeight: 700,
            color: '#ffffff',
            background: ok ? '#1e6b32' : '#9b1c1c',
          }}
        >
          {ok ? '✓' : '!'}
        </span>
        <span style={{ flex: 1 }}>{toast.text}</span>
        <button
          type="button"
          onClick={() => onCloseRef.current && onCloseRef.current()}
          aria-label="Dismiss"
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: '16px',
            lineHeight: 1,
            padding: '0 2px',
            opacity: 0.55,
          }}
        >
          ×
        </button>
      </div>
    </>
  );
};

export default Toast;
