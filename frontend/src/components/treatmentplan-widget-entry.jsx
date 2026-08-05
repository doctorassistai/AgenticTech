import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TreatmentPlanPopup from "./TreatmentPlanPopup";

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES — Trigger button + Powered by badge only
───────────────────────────────────────────────────────────────────────────── */
const WIDGET_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

  .tpw-root *,
  .tpw-root *::before,
  .tpw-root *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .tpw-root {
    font-family: 'Open Sans', sans-serif;
    font-weight: 300;
    -webkit-font-smoothing: antialiased;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  /* ── TRIGGER BUTTON ── */
  .tpw-trigger {
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
  .tpw-trigger:hover {
    background: transparent;
    color: #000000;
  }
  .tpw-trigger-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ffffff;
    flex-shrink: 0;
    transition: background 0.2s;
    animation: tpw-pulse 2s infinite;
  }
  .tpw-trigger:hover .tpw-trigger-dot {
    background: #000000;
  }
  @keyframes tpw-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  /* ── POWERED BY ── */
  .tpw-powered {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .tpw-powered-text {
    font-size: 0.58rem;
    font-weight: 300;
    color: #888888;
    letter-spacing: 0.06em;
    font-family: 'Open Sans', sans-serif;
  }
  .tpw-powered-dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #cccccc;
    flex-shrink: 0;
  }
  .tpw-powered-brand {
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
function TreatmentPlanWidgetApp({ doctorId, patientId, diagnosisText }) {
  const [open, setOpen] = useState(false);

  const diagnosis =
    window?.DOCTOR_ASSIST_DATA?.diagnosis || diagnosisText || "";

  const handleApprove = (data) => {
    console.log("✅ Approved Treatment Plan:", data);
    if (!window.DOCTOR_ASSIST_DATA) window.DOCTOR_ASSIST_DATA = {};
    window.DOCTOR_ASSIST_DATA.treatment_plan = data;
  };

  return (
    <div className="tpw-root">

      {/* ── TRIGGER BUTTON ── */}
      <button className="tpw-trigger" onClick={() => setOpen(true)}>
        <span className="tpw-trigger-dot" />
        Generate Treatment Plan
      </button>

      {/* ── POWERED BY ── */}
      <div className="tpw-powered">
        <span className="tpw-powered-text">powered by</span>
        <span className="tpw-powered-dot" />
        <span className="tpw-powered-brand">Doctorassist.AI</span>
      </div>

      {/* ── YOUR EXISTING POPUP — completely untouched ── */}
      <TreatmentPlanPopup
        open={open}
        onClose={() => setOpen(false)}
        doctorId={doctorId}
        patientId={patientId}
        diagnosisText={diagnosis}
        onApprove={handleApprove}
      />

    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   WIDGET INIT
───────────────────────────────────────────────────────────────────────────── */
(function () {
  if (typeof window === "undefined") return;

  // Inject styles once into <head>
  if (!document.getElementById("tpw-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "tpw-styles";
    styleEl.textContent = WIDGET_STYLES;
    document.head.appendChild(styleEl);
  }

  window.TreatmentPlanWidget = {
    init: function ({ containerId, doctorId, patientId, diagnosisText = "" }) {
      const container =
        document.getElementById(containerId) || document.body;

      if (!container) {
        console.error("❌ Invalid container for TreatmentPlanWidget");
        return;
      }

      // Remove existing widget instance
      const existing = document.getElementById("treatmentplan-widget-root");
      if (existing) existing.remove();

      // Create root container
      const rootDiv = document.createElement("div");
      rootDiv.id = "treatmentplan-widget-root";
      container.appendChild(rootDiv);

      let root;
      try {
        root = createRoot(rootDiv);
      } catch (err) {
        console.error("❌ React 18 createRoot failed:", err);
        return;
      }

      root.render(
        <TreatmentPlanWidgetApp
          doctorId={doctorId}
          patientId={patientId}
          diagnosisText={diagnosisText}
        />
      );
    },
  };
})();