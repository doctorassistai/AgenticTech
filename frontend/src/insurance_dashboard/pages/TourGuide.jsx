import React, { useState, useEffect, useCallback, useRef } from "react";

const T = {
  bg: "var(--bg)", text: "var(--text)",
  textSec: "color-mix(in srgb, var(--text) 85%, var(--muted))",
  textMuted: "var(--muted)", border: "var(--border)", accent: "var(--accent)",
};

const PAD = 8;
const CARD_W = 320;

function getRect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function TourGuide({ steps, active, onClose }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [ready, setReady] = useState(false);
  const rafRef = useRef(null);
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(180);

  const step = steps[stepIdx];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.selector}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      setTimeout(() => {
        setRect(getRect(el));
        setReady(true);
      }, 260);
    } else {
      setRect(null);
      setReady(true);
    }
  }, [step]);

  useEffect(() => {
    if (!active) return;
    setReady(false);
    if (step?.onBeforeShow) step.onBeforeShow();
    const t = setTimeout(measure, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIdx]);

  useEffect(() => {
    if (!active) return;
    const onResizeScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResizeScroll);
    window.addEventListener("scroll", onResizeScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeScroll);
      window.removeEventListener("scroll", onResizeScroll, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, measure]);

  useEffect(() => { if (!active) setStepIdx(0); }, [active]);

  useEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [stepIdx, rect]);

  if (!active || !step) return null;

  const isLast = stepIdx === steps.length - 1;
  const isFirst = stepIdx === 0;
  const goNext = () => { if (!isLast) setStepIdx(i => i + 1); else onClose(); };
  const goPrev = () => { if (!isFirst) setStepIdx(i => i - 1); };

  let cardStyle = {
    position: "fixed", zIndex: 10002, width: CARD_W,
    opacity: ready ? 1 : 0,
    transition: "opacity 0.2s, top 0.25s ease, left 0.25s ease, transform 0.2s ease",
  };

  if (rect) {
    const placement = step.placement || "bottom";
    const vw = window.innerWidth, vh = window.innerHeight;
    let top, left;
    if (placement === "bottom") {
      top = rect.top + rect.height + PAD + 14;
      left = rect.left + rect.width / 2 - CARD_W / 2;
    } else if (placement === "top") {
      top = rect.top - PAD - 14 - cardH;
      left = rect.left + rect.width / 2 - CARD_W / 2;
    } else if (placement === "left") {
      top = rect.top + rect.height / 2 - cardH / 2;
      left = rect.left - PAD - 14 - CARD_W;
    } else {
      top = rect.top + rect.height / 2 - cardH / 2;
      left = rect.left + rect.width + PAD + 14;
    }
    left = Math.max(12, Math.min(left, vw - CARD_W - 12));
    top = Math.max(12, Math.min(top, vh - cardH - 12));
    cardStyle = { ...cardStyle, top, left };
  } else {
    cardStyle = { ...cardStyle, top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  }

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: rect ? "none" : "auto" }}>
        {rect ? (
          <div style={{
            position: "fixed",
            top: rect.top - PAD, left: rect.left - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            borderRadius: 10,
            border: `2px solid ${T.accent}`,
            opacity: ready ? 1 : 0,
            pointerEvents: "none",
            transition: "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease, opacity 0.2s",
            animation: "tourPulse 1.8s ease-in-out infinite",
          }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "rgba(10,12,16,0.68)" }} />
        )}
      </div>

      <div style={cardStyle}>
        <div ref={cardRef} style={{
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 14,
          boxShadow: "0 16px 40px rgba(0,0,0,0.28)", padding: "16px 18px",
          animation: "tourFadeIn 0.22s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.accent }}>
              Step {stepIdx + 1} of {steps.length}
            </span>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 12, padding: 2 }}>
              Skip tour
            </button>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 5 }}>{step.title}</div>
          <div style={{ fontSize: 12, color: T.textSec, lineHeight: 1.55, marginBottom: 14 }}>{step.content}</div>

          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 14 }}>
            {steps.map((s, i) => (
              <span key={s.id} style={{
                width: i === stepIdx ? 16 : 6, height: 6, borderRadius: 99,
                background: i === stepIdx ? T.accent : T.border,
                transition: "width 0.2s, background 0.2s",
              }} />
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <button onClick={goPrev} disabled={isFirst} style={{
              padding: "7px 14px", borderRadius: 7, border: `1px solid ${T.border}`,
              background: T.bg, color: isFirst ? T.textMuted : T.textSec,
              fontFamily: "inherit", fontSize: 12, cursor: isFirst ? "default" : "pointer",
              opacity: isFirst ? 0.5 : 1,
            }}>← Back</button>
            <button onClick={goNext} style={{
              padding: "7px 16px", borderRadius: 7, border: "none",
              background: T.accent, color: "#fff", fontFamily: "inherit",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>{isLast ? "Finish" : "Next →"}</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes tourPulse {
          0%,100% { box-shadow: 0 0 0 9999px rgba(10,12,16,0.68), 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
          50%     { box-shadow: 0 0 0 9999px rgba(10,12,16,0.68), 0 0 0 8px color-mix(in srgb, var(--accent) 0%, transparent); }
        }
        @keyframes tourFadeIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }
      `}</style>
    </>
  );
}