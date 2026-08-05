import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AgenticWorkspace from "./AgenticWorkspace";

const API_BASE = import.meta.env.VITE_BACKEND_URL;

/* ─── GLOBAL STYLES (injected once) ─── */
const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');

  .ap-root * { box-sizing: border-box; margin: 0; padding: 0; }

  .ap-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 3000;
  }

  .ap-center {
    position: fixed; inset: 0;
    display: grid; place-items: center;
    padding: 24px; z-index: 3001;
    pointer-events: none;
  }

  .ap-popup {
    background: #ffffff;
    border: 1px solid #000000;
    width: 100%; max-width: 1250px; max-height: 92vh;
    display: flex; flex-direction: column;
    pointer-events: auto;
    font-family: 'Open Sans', sans-serif;
    font-weight: 300;
    color: #000000;
    -webkit-font-smoothing: antialiased;
  }

  /* ─── HEADER ─── */
  .ap-header {
    padding: 1.25rem 1.5rem;
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid #e0e0e0;
  }
  .ap-header-title-row {
    display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem;
  }
  .ap-header-icon {
    width: 14px; height: 14px; background: #000000; flex-shrink: 0;
  }
  .ap-header-title {
    font-size: 1rem; font-weight: 400; letter-spacing: -0.01em;
  }
  .ap-header-sub {
    font-size: 0.68rem; color: #888888; font-weight: 300;
  }
  .ap-header-right {
    display: flex; align-items: center; gap: 0.5rem;
  }

  /* ─── CHIPS ─── */
  .ap-chip {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid #e0e0e0;
    font-size: 0.65rem; font-weight: 400;
    color: #444444; background: #fafafa;
    font-family: 'Open Sans', sans-serif;
    white-space: nowrap;
  }
  .ap-chip-dot {
    width: 5px; height: 5px; border-radius: 50%; background: #000000; flex-shrink: 0;
  }
  .ap-chip-dot.pulse {
    animation: ap-pulse 2s infinite;
  }
  @keyframes ap-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

  /* ─── CLOSE BUTTON ─── */
  .ap-close {
    width: 28px; height: 28px;
    background: none; border: 1px solid #e0e0e0;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 1rem; font-weight: 300; color: #000000;
    transition: border-color 0.2s;
    font-family: inherit;
  }
  .ap-close:hover { border-color: #000000; }
  .ap-close:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ─── PROGRESS ─── */
  .ap-progress-wrap {
    padding: 0.5rem 1.5rem 0.6rem;
    background: #ffffff; border-bottom: 1px solid #e0e0e0;
  }
  .ap-progress-label {
    font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.12em;
    color: #888888; margin-bottom: 0.35rem;
  }
  .ap-progress-track {
    height: 1px; background: #e0e0e0;
  }
  .ap-progress-fill {
    height: 1px; background: #000000;
    animation: ap-prog 2s ease-in-out infinite alternate;
  }
  @keyframes ap-prog { 0%{width:15%} 100%{width:88%} }

  /* ─── BODY ─── */
  .ap-body {
    flex: 1; overflow: auto; padding: 1.5rem;
    background: #fafafa;
  }

  /* ─── FOOTER ─── */
  .ap-footer {
    padding: 1rem 1.5rem;
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid #e0e0e0;
    background: #ffffff;
  }
  .ap-footer-note {
    font-size: 0.65rem; color: #888888;
  }
  .ap-footer-actions {
    display: flex; gap: 0.75rem;
  }

  /* ─── BUTTONS ─── */
  .ap-btn {
    padding: 0.55rem 1.5rem;
    border: 1px solid #e0e0e0;
    background: #ffffff; color: #000000;
    font-size: 0.78rem; font-weight: 400;
    font-family: 'Open Sans', sans-serif;
    cursor: pointer; transition: all 0.2s;
    display: inline-flex; align-items: center; gap: 0.4rem;
    white-space: nowrap;
  }
  .ap-btn:hover { border-color: #000000; }
  .ap-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .ap-btn.primary {
    background: #000000; color: #ffffff; border-color: #000000;
  }
  .ap-btn.primary:hover { background: transparent; color: #000000; }
  .ap-btn.primary:disabled { background: #000000; color: #ffffff; opacity: 0.45; }

  /* ─── SPINNER ─── */
  .ap-spinner {
    width: 14px; height: 14px;
    border: 1.5px solid rgba(255,255,255,0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: ap-spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  .ap-spinner.dark {
    border-color: rgba(0,0,0,0.15);
    border-top-color: #000000;
  }
  @keyframes ap-spin { to{transform:rotate(360deg)} }
`;

function injectStyle() {
  if (document.getElementById("ap-style")) return;
  const tag = document.createElement("style");
  tag.id = "ap-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ─── HELPERS ─── */
function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

/* ═══════════════════════════════════════════════════
   COMPONENT
══════════════════════════════════════════════════ */
export default function AgenticPopup({ open, onClose, doctorId, patientId }) {
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [lastDate, setLastDate] = useState(null);
  const [lastVersion, setLastVersion] = useState(null);
  const [tempDate, setTempDate] = useState(null);

  /* inject styles once */
  useEffect(() => { injectStyle(); }, []);

  /* ── fetch meta ── */
  useEffect(() => {
    if (!open || !doctorId || !patientId) return;

    const run = async () => {
      setMetaLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}hms/users/data/context/get_agentic_data?patient_id=${patientId}&doctor_id=${doctorId}`
        );
        if (res.ok) {
          const { data: d } = await res.json();
          setLastDate(d?.date ?? null);
          setLastVersion(d?.version ?? null);
        }

        const tempRes = await fetch(
          `${API_BASE}hms/users/data/context/general/temp/get_date?patient_id=${patientId}&doctor_id=${doctorId}`
        );
        if (tempRes.ok) {
          const t = await tempRes.json();
          setTempDate(t?.updated_at ?? t?.temp_date ?? null);
        } else {
          setTempDate(null);
        }
      } catch {
        setLastDate(null);
        setLastVersion(null);
        setTempDate(null);
      } finally {
        setMetaLoading(false);
      }
    };

    run();
  }, [open, doctorId, patientId]);

  /* ── can run ── */
  const canRunAgentic = () => {
    if (!lastVersion) return true;
    if (!tempDate) return true;
    const diffDays = (new Date() - new Date(tempDate)) / (1000 * 60 * 60 * 24);
    return diffDays >= 30;
  };

  /* ── delete temp ── */
  const deleteTempData = async () => {
    if (!doctorId || !patientId) return;
    const r = await fetch(
      `${API_BASE}hms/users/data/context/general/temp/delete?patient_id=${patientId}&doctor_id=${doctorId}`,
      { method: "DELETE" }
    );
    if (!r.ok) throw new Error("Failed to delete temp data");
  };

  /* ── run ── */
  const runAgentic = async (force = false) => {
    if (!doctorId || !patientId) return;
    try {
      if (!force && !canRunAgentic()) {
        alert("Temp data is recent. Use Force Run if needed.");
        return;
      }
      await deleteTempData();
      setLoading(true);

      const reasoningRes = await fetch(
        `${API_BASE}hms/users/ai-legacy/clinical-reasoning-enhanced`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            consultation_text: "patient",
            force_run: force,
          }),
        }
      );
      if (!reasoningRes.ok) throw new Error("Clinical reasoning failed");
      const result = await reasoningRes.json();

      await fetch(`${API_BASE}hms/users/data/context/save_agentic_data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, data: result }),
      });

      setLastVersion((v) => (v ? v + 1 : 1));
      setLastDate(new Date().toISOString().slice(0, 10));
      setTempDate(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────── RENDER ─────────────────── */
  return (
    <AnimatePresence>
      {open && (
        <div className="ap-root">
          {/* backdrop */}
          <motion.div
            className="ap-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!loading ? onClose : undefined}
          />

          {/* popup */}
          <motion.div
            className="ap-center"
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="ap-popup">

              {/* ── HEADER ── */}
              <div className="ap-header">
                <div>
                  <div className="ap-header-title-row">
                    <div className="ap-header-icon" />
                    <span className="ap-header-title">Clinical Review Engines</span>
                  </div>
                  <div className="ap-header-sub">
                    Autonomous clinical reasoning &amp; decision support
                  </div>
                </div>

                <div className="ap-header-right">
                  {metaLoading ? (
                    <div className="ap-chip">
                      <div className="ap-chip-dot pulse" />
                      Loading…
                    </div>
                  ) : lastVersion ? (
                    <>
                      <div className="ap-chip">
                        <div className="ap-chip-dot" />
                        v{lastVersion}
                      </div>
                      {lastDate && (
                        <div className="ap-chip">{formatDate(lastDate)}</div>
                      )}
                    </>
                  ) : (
                    <div className="ap-chip">No history</div>
                  )}

                  <button
                    className="ap-close"
                    disabled={loading}
                    onClick={onClose}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* ── PROGRESS BAR (while loading) ── */}
              {loading && (
                <div className="ap-progress-wrap">
                  <div className="ap-progress-label">Running — please wait</div>
                  <div className="ap-progress-track">
                    <div className="ap-progress-fill" />
                  </div>
                </div>
              )}

              {/* ── BODY ── */}
              <div className="ap-body">
                <AgenticWorkspace doctorId={doctorId} patientId={patientId} />
              </div>

              {/* ── FOOTER ── */}
              <div className="ap-footer">
                <div className="ap-footer-note">
                  {lastVersion
                    ? `History: v${lastVersion} · Last run ${formatDate(lastDate) ?? "—"}`
                    : "No previous runs"}
                </div>
                <div className="ap-footer-actions">
                  <button
                    className="ap-btn"
                    disabled={loading}
                    onClick={() => runAgentic(true)}
                  >
                    {loading
                      ? <><span className="ap-spinner dark" /> Force Run</>
                      : "⚡ Force Run"}
                  </button>
                  <button
                    className="ap-btn primary"
                    disabled={loading}
                    onClick={() => runAgentic(false)}
                  >
                    {loading
                      ? <><span className="ap-spinner" /> Running…</>
                      : "▶ Run Clinical Workspace"}
                  </button>
                </div>
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}