import React from "react";
import { createRoot } from "react-dom/client";
import DiagnosisAnalysisPopup from "./DiagnosisAnalysis";

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES — Trigger button + Powered by badge only
───────────────────────────────────────────────────────────────────────────── */
const WIDGET_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

  .daw-root *,
  .daw-root *::before,
  .daw-root *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .daw-root {
    font-family: 'Open Sans', sans-serif;
    font-weight: 300;
    -webkit-font-smoothing: antialiased;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  /* ── TRIGGER BUTTON ── */
  .daw-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    background: #000000;
    color: #ffffff;
    border: 1px solid #000000;
    font-family: 'Open Sans', sans-serif;
    font-weight: 400;
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    outline: none;
    border-radius: 0;
    line-height: 1;
  }
  .daw-trigger:hover {
    background: transparent;
    color: #000000;
  }
  .daw-trigger-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ffffff;
    flex-shrink: 0;
    transition: background 0.2s;
    animation: daw-pulse 2s infinite;
  }
  .daw-trigger:hover .daw-trigger-dot {
    background: #000000;
  }
  @keyframes daw-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  /* ── POWERED BY ── */
  .daw-powered {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .daw-powered-text {
    font-size: 0.58rem;
    font-weight: 300;
    color: #888888;
    letter-spacing: 0.06em;
    font-family: 'Open Sans', sans-serif;
  }
  .daw-powered-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #cccccc;
    flex-shrink: 0;
  }
  .daw-powered-brand {
    font-size: 0.58rem;
    font-weight: 400;
    color: #000000;
    letter-spacing: -0.01em;
    font-family: 'Open Sans', sans-serif;
  }
`;

/* ─────────────────────────────────────────────────────────────────────────────
   WIDGET APP
───────────────────────────────────────────────────────────────────────────── */
function DiagnosisWidgetApp({ doctorId, patientId, dictationTranscript }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="daw-root">

      {/* ── TRIGGER BUTTON ── */}
      <button className="daw-trigger" onClick={() => setOpen(true)}>
        <span className="daw-trigger-dot" />
        Run Diagnosis
      </button>

      {/* ── POWERED BY ── */}
      <div className="daw-powered">
        <span className="daw-powered-text">powered by</span>
        <span className="daw-powered-dot" />
        <span className="daw-powered-brand">Doctorassist.AI</span>
      </div>

      {/* ── YOUR EXISTING POPUP — completely untouched ── */}
      <DiagnosisAnalysisPopup
  open={open}
  onClose={() => setOpen(false)}
  doctorId={doctorId}
  patientId={patientId}
  doctor_note_or_dictation={
    window.DOCTOR_ASSIST_DATA?.transcript || ""
  }
/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   WIDGET INIT — identical API as before
───────────────────────────────────────────────────────────────────────────── */
(function () {

  // Inject styles once into <head>
  if (!document.getElementById("daw-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "daw-styles";
    styleEl.textContent = WIDGET_STYLES;
    document.head.appendChild(styleEl);
  }

  window.DiagnosisWidget = {
    init: function ({ containerId, doctorId, patientId, dictationTranscript }) {
      const container =
        document.getElementById(containerId) || document.body;

      const rootDiv = document.createElement("div");
      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);

      root.render(
        <DiagnosisWidgetApp
          doctorId={doctorId}
          patientId={patientId}
          dictationTranscript={dictationTranscript}
        />
      );
    },
  };

})();