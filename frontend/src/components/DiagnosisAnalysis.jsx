import React, { useState, useEffect } from "react";

const API_BASE_URL =
  window.PATIENT_WIDGET_API ||
  "https://doctorassist.ai/api/";


/* ─────────────────────────────────────────
   THEME TOKENS
───────────────────────────────────────── */
import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "BlackWhite";
const theme = THEMES[themeName] || THEMES.BlackWhite;
const T = {
  bg: theme.bg,
  bgAlt: theme.bgAlt,
  bgTert: theme.bgTert,

  text: theme.text,
  textSec: theme.textSec,
  textMuted: theme.textMuted,

  border: theme.border,
  borderStr: theme.borderStr,

  font: theme.font,

};
/* ─────────────────────────────────────────
   CSS  (injected once)
───────────────────────────────────────── */
const CSS_ID = "da-diag2-css";
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  .da2-overlay { animation: da2-fade 0.18s ease; }
  .da2-modal   { animation: da2-up   0.22s ease; }
  @keyframes da2-fade { from { opacity:0; }                     to { opacity:1; }           }
  @keyframes da2-up   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes da2-spin { to   { transform:rotate(360deg); }              }
  .da2-root * { box-sizing:border-box; }
  .da2-root   { font-family:${T.font}; font-weight:300; color:${T.text}; }
  .da2-scroll::-webkit-scrollbar       { width:4px; }
  .da2-scroll::-webkit-scrollbar-thumb { background:${T.border}; }
  .da2-scroll { scrollbar-width:thin; scrollbar-color:${T.border} transparent; }
  .da2-step-row:hover  { background:${T.bgAlt} !important; }
  .da2-tbl-row:hover td { background:${T.bgAlt} !important; }
  .da2-btn-primary:hover { background:transparent !important; color:${T.text} !important; }
  .da2-btn-outline:hover { border-color:${T.borderStr} !important; color:${T.text} !important; }
`;

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ─────────────────────────────────────────
   SHARED STYLE OBJECTS
───────────────────────────────────────── */
const S = {
  secLabel: {
    fontSize: "0.6rem", textTransform: "uppercase",
    letterSpacing: "0.18em", color: T.textMuted,
    fontWeight: 400, display: "block", marginBottom: "0.25rem",
  },
  card: {
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    padding: "1rem 1.25rem",
    marginBottom: "0.875rem",
  },
  cardTitle: {
    fontSize: "0.7rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.12em",
    color: T.text, marginBottom: "0.75rem", display: "block",
  },
  badge: (accent = false) => ({
    padding: "0.18rem 0.5rem",
    border: `1px solid ${accent ? T.borderStr : T.border}`,
    fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.08em",
    color: accent ? T.text : T.textMuted,
    display: "inline-block", marginRight: "4px", marginBottom: "4px",
  }),
  callout: (borderColor = T.borderStr) => ({
    borderLeft: `2px solid ${borderColor}`,
    padding: "0.875rem 1.25rem",
    background: T.bgAlt,
    marginBottom: "0.875rem",
  }),
  btnPrimary: {
    padding: "0.6rem 1.5rem",
    background: T.text, color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.75rem", fontWeight: 400,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "6px",
    letterSpacing: "0.04em",
  },
  btnOutline: {
    padding: "0.6rem 1.25rem",
    background: T.bg, color: T.textSec,
    border: `1px solid ${T.border}`,
    fontSize: "0.75rem", fontWeight: 300,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
  },
  divider: { height: 1, background: T.border, margin: "1.5rem 0" },
  listItem: {
    fontSize: "0.78rem", color: T.textSec, fontWeight: 300,
    lineHeight: 1.7, paddingLeft: "0.875rem",
    position: "relative", marginBottom: "3px",
  },
};

/* ─────────────────────────────────────────
   MICRO-COMPONENTS
───────────────────────────────────────── */
const pct = (v) => (v != null ? `${(v * 100).toFixed(0)}%` : null);

function SectionCard({ title, children, border = T.border }) {
  return (
    <div style={{ ...S.card, border: `1px solid ${border}`, marginBottom: "0.875rem" }}>
      {title && <span style={S.cardTitle}>{title}</span>}
      {children}
    </div>
  );
}

function Callout({ label, color = T.borderStr, children }) {
  return (
    <div style={S.callout(color)}>
      {label && <span style={{ ...S.secLabel, marginBottom: "0.4rem" }}>{label}</span>}
      {children}
    </div>
  );
}

function BulletList({ items = [] }) {
  if (!items.length) return null;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item, i) => (
        <li key={i} style={S.listItem}>
          <span style={{ position: "absolute", left: 0, color: T.textMuted }}>•</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Chip({ label, accent = false }) {
  if (!label) return null;
  return <span style={S.badge(accent)}>{label}</span>;
}

function ProgressBar({ value, label }) {
  const v = Math.min(100, Math.max(0, value || 0));
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span style={{ fontSize: "0.68rem", color: T.textMuted }}>{label}</span>
          <span style={{ fontSize: "0.68rem", fontWeight: 400, color: T.text }}>{v}%</span>
        </div>
      )}
      <div style={{ height: 6, background: T.border, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${v}%`, background: T.text, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const DiagnosisAnalysisPopup = ({
  open,
  onClose,
  diagnosisText,
  doctorId,
  patientId,
  onApprove,
  dictationTranscript,
}) => {
  const [loading,   setLoading]   = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);
  const [prognosis, setPrognosis] = useState(null);
  const [error,     setError]     = useState(null);
const steps = [
  "Extracting clinical data",
  "Building evidence graph",
  "Generating differentials",
  "Scoring probabilities",
  "Running specialist reasoning",
  "Mapping guidelines",
  "Evaluating investigations",
  "Identifying gaps",
  "Finalizing report"
];

const [stage, setStage] = useState(steps[0]);
const [progress, setProgress] = useState(5);
  injectCSS();

  /* ── fetch ── */
const fetchDiagnosis = async () => {
  setLoading(true);
  setError(null);

  const url = `${API_BASE_URL}hms/users/ai-legacy/diagnostic/${patientId}?doctor_id=${doctorId}`;

  try {
    const latestTranscript =
        window.DOCTOR_ASSIST_DATA?.transcript ||
        dictationTranscript ||
        "";
    const bodyPayload = {
        doctor_note_or_dictation: latestTranscript
      };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || `Diagnosis API failed: ${res.status}`);
    }   // 👈 parse response
    console.log("Diagnostic Response:", data);  // 👈 correct console log

    setDiagnosis(data);
  } catch (err) {
    console.error("Diagnosis Error:", err); // better debugging
    setError(err.message);
  }

  setLoading(false);
};
useEffect(() => {
  if (!loading) return;

  let i = 0;

  const interval = setInterval(() => {
    setStage(steps[i]);
    setProgress(((i + 1) / steps.length) * 100);

    i++;
    if (i >= steps.length) clearInterval(interval);
  }, 700);

  return () => clearInterval(interval);
}, [loading]);
  useEffect(() => {
    if (open) { setDiagnosis(null); setPrognosis(null); fetchDiagnosis(); }
  }, [open]);



  
  /* ── approve ── */
  const handleApprove = async () => {

  try {

    // =========================
    // VERIFY API CALL
    // =========================
    await fetch(`${API_BASE_URL}hms/users/data/context/verify-diagnosis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tag: "diagnosis",
        doctor_id: doctorId,
        patient_id: patientId,
        diagnosis_data: diagnosis
      }),
    });

  } catch (err) {

    // integrator/verify fail should NOT stop UI flow
    console.error("Verify diagnosis API failed:", err);
  }

  // =========================
  // EXISTING FLOW
  // =========================

  const primary =
    diagnosis?.primary_diagnosis?.disease || "";

  const explanation =
    diagnosis?.reason_for_primary_diagnosis || "";

  const formatted =
    `Primary Diagnosis: ${primary}\n\nExplanation: ${explanation}`.trim();

  const existingText =
    window.DOCTOR_ASSIST_DATA?.transcript || "";

  const updatedTranscript = existingText
    ? `${existingText}\n\n${formatted}`
    : formatted;

  window.DOCTOR_ASSIST_DATA =
    window.DOCTOR_ASSIST_DATA || {};

  window.DOCTOR_ASSIST_DATA.transcript =
    updatedTranscript;

  window.DOCTOR_ASSIST_DATA.diagnosis =
    formatted;

  window.dispatchEvent(
    new Event("doctorassist-transcript-update")
  );

  console.log(
    "✅ Final transcript:",
    updatedTranscript
  );

  if (onApprove) {
    onApprove(updatedTranscript);
  }

  onClose?.();
};

  const handleClose = () => { setDiagnosis(null); setPrognosis(null); onClose?.(); };

  if (!open) return null;

  const pd = diagnosis?.primary_diagnosis;
  const hr = diagnosis?.hypothesis_reasoning;

  return (
    <div className="da2-root">
      {/* backdrop */}
      <div
        className="da2-overlay"
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 9999,
        }}
      />

      {/* modal */}
      <div
        className="da2-modal"
        style={{
          position: "fixed",
          top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: 10000,
          width: "calc(100vw - 32px)",
          maxWidth: 900,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: T.bg,
          border: `1px solid ${T.borderStr}`,
          boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          fontFamily: T.font,
          fontWeight: 300,
        }}
      >

        {/* ════ HEADER ════ */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.875rem 1.5rem",
          background: T.bgAlt, borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}>
          <div>
            <span style={S.secLabel}>AI Clinical Engine</span>
            <h2 style={{ fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>
              AI Diagnosis
            </h2>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "2px 0 0", fontWeight: 300 }}>
              Using patient data for personalized recommendations
            </p>
          </div>
          <button
            onClick={handleClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "4px", fontSize: "1.25rem", lineHeight: 1, fontFamily: T.font }}
          >
            ✕
          </button>
        </div>

        {/* ════ BODY ════ */}
        <div className="da2-scroll" style={{ padding: "1.5rem", overflowY: "auto", flex: 1 }}>

          {/* loading */}
          {loading && (
  <div style={{
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem"
  }}>

    {/* Header */}
    <div>
      <span style={S.secLabel}>AI Clinical Engine</span>
      <h3 style={{ fontSize: "0.95rem", margin: 0 }}>
        Processing Diagnosis
      </h3>
    </div>

    {/* Progress bar */}
    <div style={{ height: 4, background: T.border }}>
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: T.text,
          transition: "width 0.4s ease"
        }}
      />
    </div>

    {/* Current step */}
    <div style={{
      fontSize: "0.8rem",
      color: T.text,
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }}>
      <div className="da2-dot" />
      {stage}
    </div>

    {/* Step list */}
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {steps.map((s, i) => (
        <div key={i} style={{
          display: "flex",
          alignItems: "center",
          fontSize: "0.75rem",
          color:
            s === stage
              ? T.text
              : steps.indexOf(stage) > i
              ? T.textMuted
              : T.textMuted,
          opacity: s === stage ? 1 : 0.6
        }}>
          <span style={{
            width: 16,
            display: "inline-block"
          }}>
            {steps.indexOf(stage) > i ? "✓" : s === stage ? "●" : "○"}
          </span>
          {s}
        </div>
      ))}
    </div>
  </div>
)}

          {/* error */}
          {error && (
            <div style={{ ...S.callout("#dc2626"), marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.82rem", color: "#dc2626" }}>{error}</span>
            </div>
          )}

          {/* ═══ DIAGNOSIS ═══ */}
          {diagnosis && (
            <div>

              {/* page heading */}
              <div style={{ marginBottom: "1.25rem" }}>
                <span style={S.secLabel}>Diagnosis Report</span>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: 0 }}>Diagnosis</h3>
              </div>

              {/* primary diagnosis box */}
              <div style={{
                border: `1px solid ${T.borderStr}`,
                borderTop: `2px solid ${T.borderStr}`,
                padding: "1.25rem",
                marginBottom: "1rem",
                background: T.bg,
              }}>
                <span style={S.secLabel}>Primary Diagnosis</span>
                <p style={{ fontSize: "1.1rem", fontWeight: 400, letterSpacing: "-0.02em", color: T.text, margin: "0 0 0.75rem" }}>
                  {pd?.disease ? pd.disease.charAt(0).toUpperCase() + pd.disease.slice(1) : "—"}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {pd?.type        && <Chip label={`Type: ${pd.type}`}                                 accent />}
                  {pd?.stage       && <Chip label={`Stage: ${pd.stage}`}                               accent />}
                  {pd?.size        && <Chip label={`Size: ${pd.size}`}                                         />}
                  {pd?.severity    && <Chip label={`Severity: ${pd.severity}`}                         accent />}
                  {pd?.probability != null && <Chip label={`Confidence: ${pct(pd.probability)}`}       accent />}
                </div>
              </div>

              {/* explanation */}
              {diagnosis.reason_for_primary_diagnosis && (
                <Callout label="Explanation">
                  <p style={{ fontSize: "0.82rem", color: T.textSec, lineHeight: 1.7, margin: 0, fontWeight: 300 }}>
                    {diagnosis.reason_for_primary_diagnosis}
                  </p>
                </Callout>
              )}

              {/* supporting evidence */}
              {pd?.supporting_evidence?.length > 0 && (
                <SectionCard title="Supporting Evidence">
                  <BulletList items={pd.supporting_evidence} />
                </SectionCard>
              )}



              {/* differential diagnoses */}
              {diagnosis.differential_diagnoses?.length > 0 && (
                <SectionCard title="Differential Diagnoses">
                  {diagnosis.differential_diagnoses.map((d, i) => (
                    <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.625rem", background: T.bgAlt }}>
                      <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: "0 0 6px" }}>
                        {d.disease || "Unknown"}
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                        {d.type        && <Chip label={`Type: ${d.type}`}                            />}
                        {d.stage       && <Chip label={`Stage: ${d.stage}`}                          />}
                        {d.size        && <Chip label={`Size: ${d.size}`}                            />}
                        {d.probability != null && <Chip label={`Probability: ${pct(d.probability)}`} accent />}
                      </div>
                    </div>
                  ))}
                </SectionCard>
              )}


              {/* recommended investigations */}
              {diagnosis.recommended_investigations?.length > 0 && (
                <SectionCard title="Recommended Investigations">
                  {diagnosis.recommended_investigations.map((inv, i) => {
                    let testName = "", done = false;
                    if (typeof inv === "string") {
                      const tm = inv.match(/test='([^']+)'/);
                      const dm = inv.match(/done=(True|False|true|false)/);
                      testName = tm ? tm[1] : inv;
                      done     = dm ? dm[1].toLowerCase() === "true" : false;
                    } else { testName = inv.test; done = inv.done; }
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: `1px solid ${T.border}`, fontSize: "0.78rem", color: T.textSec }}>
                        <span>• {testName}</span>
                        <Chip label={done ? "Done" : "Not done"} accent={done} />
                      </div>
                    );
                  })}
                </SectionCard>
              )}

              {/* investigations */}
              {diagnosis.investigations?.length > 0 && (
                <SectionCard title="Investigations">
                  {diagnosis.investigations.map((inv, i) => (
                    <div key={i} style={{ padding: "0.625rem 0", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                        <span style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text }}>• {inv.test}</span>
                        <div>
                          <Chip label={(inv.status || "").replace(/_/g, " ")} accent />
                          {inv.required_for && <Chip label={inv.required_for} />}
                          {inv.urgency      && <Chip label={inv.urgency} />}
                        </div>
                      </div>
                      {inv.result_summary && <p style={{ fontSize: "0.68rem", color: T.textSec,  margin: "2px 0", fontWeight: 300 }}>Result: {inv.result_summary}</p>}
                      {inv.interpretation  && <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: 0,       fontWeight: 300 }}>{inv.interpretation}</p>}
                    </div>
                  ))}
                </SectionCard>
              )}

              {/* missing investigations */}
              {diagnosis.missing_investigations?.length > 0 && (
                <Callout label="Missing Investigations" color="#dc2626">
                  <BulletList items={diagnosis.missing_investigations} />
                </Callout>
              )}

              {/* ── HYPOTHESIS REASONING ── */}
              {hr && (
                <div style={{ marginTop: "1.5rem" }}>
                  <div style={S.divider} />
                  <span style={S.secLabel}>Reasoning Engine</span>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: "0 0 1rem" }}>Hypothesis Reasoning</h3>

                  {/* summary panel */}
                  <div style={{ border: `1px solid ${T.borderStr}`, borderTop: `2px solid ${T.borderStr}`, padding: "1.25rem", marginBottom: "1rem", background: T.bg }}>
                    <p style={{ fontSize: "0.9rem", fontWeight: 400, color: T.text, margin: "0 0 0.75rem" }}>
                      {hr.primary_hypothesis}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "0.75rem" }}>
                      {hr.diagnosis_gate           && <Chip label={`Gate: ${hr.diagnosis_gate}`}                         accent />}
                      {hr.confidence_current    != null && <Chip label={`Confidence: ${pct(hr.confidence_current)}`}     accent />}
                      {hr.confidence_at_entry   != null && <Chip label={`Entry: ${pct(hr.confidence_at_entry)}`}                />}
                      {hr.confidence_for_treatment != null && <Chip label={`Treatment: ${pct(hr.confidence_for_treatment)}`}    />}
                    </div>
                    {hr.confidence_current != null && (
                      <ProgressBar value={hr.confidence_current * 100} label="Diagnostic Confidence" />
                    )}
                  </div>

                  {hr.specialist_summary && (
                    <Callout label="Specialist Summary">
                      <p style={{ fontSize: "0.82rem", color: T.textSec, lineHeight: 1.7, margin: 0, fontWeight: 300 }}>
                        {hr.specialist_summary}
                      </p>
                    </Callout>
                  )}

                  {hr.gate_blockers?.length > 0 && (
                    <Callout label="Gate Blockers" color="#dc2626">
                      <BulletList items={hr.gate_blockers} />
                    </Callout>
                  )}

                  {hr.gate_conditions?.length > 0 && (
                    <SectionCard title="Gate Conditions">
                      <BulletList items={hr.gate_conditions} />
                    </SectionCard>
                  )}

                  {hr.confirmatory_tests_pending?.length > 0 && (
                    <SectionCard title="Confirmatory Tests Pending">
                      <BulletList items={hr.confirmatory_tests_pending} />
                    </SectionCard>
                  )}

                  {hr.ruling_out?.length > 0 && (
                    <SectionCard title="Ruling Out">
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {hr.ruling_out.map((r, i) => <Chip key={i} label={r} />)}
                      </div>
                    </SectionCard>
                  )}

                  {/* reasoning steps */}
                  {hr.steps?.length > 0 && (
                    <div style={{ marginTop: "1.25rem" }}>
                      <span style={S.secLabel}>Diagnostic Reasoning Steps</span>
                      <div style={{ border: `1px solid ${T.border}` }}>
                        {hr.steps.map((step, i) => (
                          <div
                            key={i}
                            className="da2-step-row"
                            style={{
                              padding: "0.875rem 1rem",
                              borderBottom: i < hr.steps.length - 1 ? `1px solid ${T.border}` : "none",
                              borderLeft: `2px solid ${T.borderStr}`,
                              transition: "background 0.12s",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                              <span style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>{step.step_label}</span>
                              <Chip label={(step.outcome || "").replace(/_/g, " ")} accent />
                            </div>
                            <p style={{ fontSize: "0.75rem", color: T.textSec, lineHeight: 1.6, margin: "0 0 0.5rem", fontWeight: 300 }}>
                              {step.reasoning}
                            </p>
                            {step.evidence_available?.length > 0 && (
                              <div style={{ marginBottom: "0.35rem" }}>
                                <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.text, display: "block", marginBottom: "2px" }}>
                                  ✓ Evidence Available
                                </span>
                                <BulletList items={step.evidence_available} />
                              </div>
                            )}
                            {step.evidence_missing?.length > 0 && (
                              <div style={{ marginBottom: "0.35rem" }}>
                                <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#dc2626", display: "block", marginBottom: "2px" }}>
                                  ✗ Evidence Missing
                                </span>
                                <BulletList items={step.evidence_missing} />
                              </div>
                            )}
                            {step.next_required && (
                              <p style={{ fontSize: "0.72rem", color: T.textSec, margin: 0, fontWeight: 300 }}>
                                <strong>Next Required:</strong> {step.next_required}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── GUIDELINE PATHWAYS ── */}
              {diagnosis.guideline_pathways?.length > 0 && (
                <div style={{ marginTop: "1.5rem" }}>
                  <div style={S.divider} />
                  <span style={S.secLabel}>Evidence-Based Pathways</span>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: "0 0 1rem" }}>Guideline Pathways</h3>

                  {diagnosis.guideline_pathways.map((gp, gi) => (
                    <div key={gi} style={{ border: `1px solid ${T.border}`, borderTop: `2px solid ${T.borderStr}`, marginBottom: "1.5rem", background: T.bg }}>

                      {/* pathway header */}
                      <div style={{ padding: "0.875rem 1.25rem", background: T.bgAlt, borderBottom: `1px solid ${T.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text }}>{gp.guideline_name}</span>
                          {gp.overall_alignment && <Chip label={`Alignment: ${gp.overall_alignment}`} accent />}
                          {gp.pathway_stage     && <Chip label={`Stage: ${gp.pathway_stage}`} />}
                        </div>
                        <p style={{ fontSize: "0.65rem", color: T.textMuted, margin: "4px 0 0", fontWeight: 300 }}>{gp.guideline_source}</p>
                      </div>

                      <div style={{ padding: "1rem 1.25rem" }}>

                        {/* § alignment summary */}
                        {gp.section_4_alignment_summary && (() => {
                          const as_ = gp.section_4_alignment_summary;
                          return (
                            <div style={{ ...S.card, background: T.bg }}>
                              <span style={S.cardTitle}>Alignment Summary</span>
                              {as_.workup_completion_percent != null && (
                                <ProgressBar value={as_.workup_completion_percent} label="Workup Completion" />
                              )}
                              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                                {as_.confirmed_criteria != null && <span style={{ fontSize: "0.68rem", color: T.text }}>✓ Confirmed: {as_.confirmed_criteria}</span>}
                                {as_.pending_criteria  != null && <span style={{ fontSize: "0.68rem", color: T.textMuted }}>⏳ Pending: {as_.pending_criteria}</span>}
                                {as_.missing_criteria  != null && <span style={{ fontSize: "0.68rem", color: "#dc2626" }}>✗ Missing: {as_.missing_criteria}</span>}
                                {as_.total_criteria    != null && <span style={{ fontSize: "0.68rem", color: T.textMuted }}>Total: {as_.total_criteria}</span>}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "0.5rem" }}>
                                {as_.ready_for_surgery          && <Chip label={`Surgery: ${as_.ready_for_surgery}`}          accent />}
                                {as_.ready_for_systemic_therapy && <Chip label={`Systemic: ${as_.ready_for_systemic_therapy}`}        />}
                                {as_.ready_for_mdt_discussion   && <Chip label={`MDT: ${as_.ready_for_mdt_discussion}`}               />}
                              </div>
                              {as_.readiness_rationale && <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "4px 0", fontWeight: 300 }}>{as_.readiness_rationale}</p>}
                              {as_.cross_guideline_consensus && <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "4px 0", fontWeight: 300 }}><strong>Consensus:</strong> {as_.cross_guideline_consensus}</p>}
                              {as_.cross_guideline_conflicts && as_.cross_guideline_conflicts !== "None" && (
                                <div style={{ ...S.callout("#dc2626"), marginTop: "6px", marginBottom: 0 }}>
                                  <span style={{ fontSize: "0.72rem", color: "#dc2626" }}><strong>Conflicts:</strong> {as_.cross_guideline_conflicts}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* § evidence available */}
                        {gp.section_1_evidence_available?.length > 0 && (
                          <SectionCard title="Evidence Available">
                            {gp.section_1_evidence_available.map((ev, ei) => (
                              <div key={ei} style={{ border: `1px solid ${T.border}`, padding: "0.75rem", marginBottom: "0.5rem", background: T.bg }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                                  <span style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text }}>{ev.parameter}</span>
                                  <Chip label={ev.value} accent />
                                </div>
                                <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "2px 0", fontWeight: 300 }}>Source: {ev.source}</p>
                                {ev.date               && <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "2px 0", fontWeight: 300 }}>Date: {ev.date}</p>}
                                {ev.guideline_relevance && <p style={{ fontSize: "0.68rem", color: T.textSec,   margin: "2px 0", fontWeight: 300 }}>{ev.guideline_relevance}</p>}
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                                  {ev.hypothesis_link  && <Chip label={`Hypothesis: ${ev.hypothesis_link}`} />}
                                  {ev.decision_enabled && <Chip label={`Decision: ${ev.decision_enabled}`} />}
                                </div>
                              </div>
                            ))}
                          </SectionCard>
                        )}

                        {/* § missing / pending */}
                        {gp.section_2_missing_pending?.length > 0 && (
                          <SectionCard title="Missing / Pending Investigations" border="#dc2626">
                            {gp.section_2_missing_pending.map((mp, mi) => (
                              <div key={mi} style={{ border: `1px solid ${T.border}`, padding: "0.75rem", marginBottom: "0.5rem", background: T.bg }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                                  <span style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text }}>{mp.investigation}</span>
                                  <div>
                                    <Chip label={mp.status} accent />
                                    {mp.ordering_priority != null && <Chip label={`Priority: ${mp.ordering_priority}`} />}
                                  </div>
                                </div>
                                {mp.guideline_requirement    && <p style={{ fontSize: "0.68rem", color: T.textSec,  margin: "2px 0", fontWeight: 300 }}>{mp.guideline_requirement}</p>}
                                {mp.importance_for_treatment && <p style={{ fontSize: "0.68rem", color: T.text,     margin: "2px 0" }}><strong>Importance:</strong> {mp.importance_for_treatment}</p>}
                                {mp.hypothesis_step_blocked  && <p style={{ fontSize: "0.68rem", color: "#dc2626",  margin: "2px 0" }}><strong>Blocking:</strong> {mp.hypothesis_step_blocked}</p>}
                                {mp.recommended_action       && <p style={{ fontSize: "0.68rem", color: T.textSec,  margin: "2px 0", fontWeight: 300 }}>→ {mp.recommended_action}</p>}
                              </div>
                            ))}
                          </SectionCard>
                        )}

                        {/* § clinical interpretation */}
                        {gp.section_3_clinical_interpretation && (() => {
                          const ci = gp.section_3_clinical_interpretation;
                          return (
                            <SectionCard title="Clinical Interpretation">
                              <div style={{ marginBottom: "0.75rem" }}>
                                <Chip
                                  label={ci.sufficient_for_treatment_initiation ? "✓ Sufficient for Treatment" : "✗ Not Yet Sufficient for Treatment"}
                                  accent={!!ci.sufficient_for_treatment_initiation}
                                />
                              </div>
                              {ci.treatment_ready_for?.length > 0 && (
                                <div style={{ marginBottom: "0.625rem" }}>
                                  <span style={S.secLabel}>Treatment Ready For</span>
                                  <BulletList items={ci.treatment_ready_for} />
                                </div>
                              )}
                              {ci.limited_by_missing?.length > 0 && (
                                <div style={{ marginBottom: "0.625rem" }}>
                                  <span style={{ ...S.secLabel, color: "#dc2626" }}>Limited By Missing</span>
                                  <BulletList items={ci.limited_by_missing} />
                                </div>
                              )}
                              {ci.hypothesis_gate_narrative && (
                                <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "4px 0", fontWeight: 300 }}>{ci.hypothesis_gate_narrative}</p>
                              )}
                              {ci.priority_next_steps?.length > 0 && (
                                <div style={{ marginTop: "0.625rem" }}>
                                  <span style={S.secLabel}>Priority Next Steps</span>
                                  <BulletList items={ci.priority_next_steps} />
                                </div>
                              )}
                            </SectionCard>
                          );
                        })()}

                        {/* cross-guideline overlaps */}
                        {gp.cross_guideline_overlaps?.length > 0 && (
                          <div style={{ marginTop: "0.75rem" }}>
                            <span style={S.secLabel}>Cross-Guideline Overlaps</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {gp.cross_guideline_overlaps.map((o, oi) => <Chip key={oi} label={o} />)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* red flags */}
              {diagnosis.red_flag_alerts?.length > 0 && (
                <Callout label="Red Flag Alerts" color="#dc2626">
                  <BulletList items={diagnosis.red_flag_alerts} />
                </Callout>
              )}

            </div>
          )}
              {/* primary guidelines */}
{/* primary guidelines - check for "guidelines" array */}
{pd?.guidelines?.length > 0 && (
  <SectionCard title="Guidelines — Primary Diagnosis">
    {pd.guidelines.map((g, i) => (
      <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.625rem", background: T.bg }}>
        <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 3px" }}>{g.title}</p>
        <p style={{ fontSize: "0.7rem",  color: T.textMuted, margin: "0 0 4px", fontWeight: 300 }}>{g.reference}</p>
        <p style={{ fontSize: "0.72rem", color: T.textSec,   margin: "0 0 4px", fontWeight: 300 }}>{g.explanation}</p>
        {g.reason && <p style={{ fontSize: "0.72rem", color: T.text, margin: 0 }}><strong>Reason:</strong> {g.reason}</p>}
      </div>
    ))}
  </SectionCard>
)}

{/* differential guidelines - check for "guidelines" inside each differential */}
{diagnosis?.differential_diagnoses?.some(d => d.guidelines?.length > 0) && (
  <SectionCard title="Guidelines — Differential Diagnoses">
    {diagnosis.differential_diagnoses
      .filter(d => d.guidelines?.length > 0)
      .map((d, i) => (
        <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.625rem", background: T.bg }}>
          <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 8px" }}>
            {d.disease || "Unknown Diagnosis"}
          </p>
          {d.guidelines.map((g, gi) => (
            <div key={gi} style={{ paddingLeft: "0.875rem", borderLeft: `1px solid ${T.border}`, marginBottom: "0.5rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 400, color: T.text, margin: "0 0 2px" }}>{g.title || "Guideline"}</p>
              <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "0 0 2px", fontWeight: 300 }}>{g.reference}</p>
              <p style={{ fontSize: "0.68rem", color: T.textSec,   margin: "0 0 2px", fontWeight: 300 }}>{g.explanation}</p>
              {g.reason && <p style={{ fontSize: "0.68rem", color: T.text, margin: 0 }}><strong>Reason:</strong> {g.reason}</p>}
            </div>
          ))}
        </div>
      ))}
  </SectionCard>
)}

          {/* ═══ PROGNOSIS ═══ */}
          {prognosis && (
            <div style={{ marginTop: "1.5rem" }}>
              <div style={S.divider} />
              <span style={S.secLabel}>Prognosis Report</span>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: "0 0 1rem" }}>Prognosis</h3>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "1rem" }}>
                {prognosis.prognostic_category && <Chip label={`Category: ${prognosis.prognostic_category}`} accent />}
                {prognosis.risk_category       && <Chip label={`Risk: ${prognosis.risk_category}`} />}
                {prognosis.confidence_score != null && <Chip label={`Confidence: ${pct(prognosis.confidence_score)}`} />}
              </div>

              {prognosis.summary && (
                <Callout label="Summary">
                  <p style={{ fontSize: "0.82rem", color: T.textSec, lineHeight: 1.7, margin: 0, fontWeight: 300 }}>{prognosis.summary}</p>
                </Callout>
              )}

              {prognosis.survival_estimates && (
                <SectionCard title="Survival Estimates">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "1px", background: T.border }}>
                    {Object.entries(prognosis.survival_estimates).map(([key, value], i) => (
                      <div key={i} style={{ background: T.bg, padding: "0.875rem", textAlign: "center" }}>
                        <span style={S.secLabel}>{key.replace("_", " ")}</span>
                        <p style={{ fontSize: "1.1rem", fontWeight: 300, letterSpacing: "-0.03em", color: T.text, margin: 0 }}>
                          {key.includes("months") ? `${value}mo` : `${(value * 100).toFixed(0)}%`}
                        </p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {prognosis.favorable_factors?.length > 0    && <SectionCard title="Favorable Factors"><BulletList items={prognosis.favorable_factors} /></SectionCard>}
              {prognosis.unfavorable_factors?.length > 0  && <Callout label="Unfavorable Factors" color="#dc2626"><BulletList items={prognosis.unfavorable_factors} /></Callout>}
              {prognosis.multi_disciplinary_needs         && (
                <SectionCard title="Recommended Care Team">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {prognosis.multi_disciplinary_needs.recommended_team?.map((t, i) => <Chip key={i} label={t} />)}
                  </div>
                </SectionCard>
              )}
              {prognosis.optimization_recommendations?.length > 0 && <SectionCard title="Optimization Recommendations"><BulletList items={prognosis.optimization_recommendations} /></SectionCard>}
              {prognosis.monitoring_plan?.length > 0          && <SectionCard title="Monitoring Plan"><BulletList items={prognosis.monitoring_plan} /></SectionCard>}
              {prognosis.red_flags?.length > 0                && <Callout label="Warnings" color="#dc2626"><BulletList items={prognosis.red_flags} /></Callout>}
            </div>
          )}

        </div>

        {/* ════ FOOTER ════ */}
        {(diagnosis || prognosis) && (
          <div style={{
            padding: "0.875rem 1.5rem",
            borderTop: `1px solid ${T.border}`,
            background: T.bgAlt,
            display: "flex", justifyContent: "flex-end", gap: "0.625rem",
            flexShrink: 0,
          }}>
            <button className="da2-btn-outline" style={S.btnOutline} onClick={handleClose}>
              Cancel
            </button>
            <button className="da2-btn-primary" style={S.btnPrimary} onClick={handleApprove}>
              ✓ Verify &amp; Add to Dictation
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default DiagnosisAnalysisPopup;