import React, { useState, useEffect } from "react";

const API_BASE_URL =
  window.PATIENT_WIDGET_API ||
  "https://doctorassist.ai/api/";

/* ─────────────────────────────────────────
   THEME TOKENS
───────────────────────────────────────── */
const T = {
  bg:        "#ffffff",
  bgAlt:     "#fafafa",
  bgTert:    "#f5f5f5",
  text:      "#000000",
  textSec:   "#444444",
  textMuted: "#888888",
  border:    "#e0e0e0",
  borderStr: "#000000",
  danger:    "#dc2626",
  font:      "'Open Sans', sans-serif",
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
  .da2-accordion-head:hover { background:${T.bgTert} !important; }
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
  if (!items || !items.length) return null;
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

/* small helper for outcome -> tone mapping used in hypothesis reasoning steps */
const outcomeAccent = (outcome) => {
  if (!outcome) return false;
  const positive = ["supported", "confirmed"];
  return positive.includes(outcome.toLowerCase());
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const DiagnosisAnalysisskill = ({
  open,
  onClose,
  diagnosisText,
  doctorId,
  patientId,
  onApprove,
  dictationTranscript,
  onAddToTreatmentPlan,
}) => {
  const [loading,   setLoading]   = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);
  const [error,     setError]     = useState(null);
  const [apiError, setApiError]   = useState(null);
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

  /* accordion open/close state for the newly added dense sections */
  const [showReasoningSteps, setShowReasoningSteps] = useState(false);
  const [expandedPathwayIdx, setExpandedPathwayIdx] = useState(null);

  injectCSS();

  /* ── fetch ── */
  const fetchDiagnosis = async () => {
    setLoading(true);
    setError(null);
    setApiError(null);

    const url = `${API_BASE_URL}hms/users/ai-legacy/diagnostic/skill/${patientId}?doctor_id=${doctorId}`;

    try {
      const latestTranscript =
        window.DOCTOR_ASSIST_DATA?.transcript ||
        dictationTranscript ||
        diagnosisText ||
        "";
      
      const bodyPayload = {
        doctor_note_or_dictation: latestTranscript
      };
      
      console.log("📤 Sending diagnosis request to:", url);
      console.log("📤 Request body:", bodyPayload);
      
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Diagnosis API failed: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log("✅ Diagnostic Response:", data);
      setDiagnosis(data);
    } catch (err) {
      console.error("❌ Diagnosis Error:", err);
      setApiError(err.message);
      setError("Failed to generate diagnosis. Please try again.");
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
    if (open) { 
      setDiagnosis(null); 
      setApiError(null);
      setShowReasoningSteps(false);
      setExpandedPathwayIdx(null);
      fetchDiagnosis(); 
    }
  }, [open]);

  /* ── approve ── */
  const handleApprove = () => {
    const primaryDiagnosis = diagnosis?.primary_diagnosis?.disease || "";
    const reasonForDiagnosis = diagnosis?.reason_for_primary_diagnosis || "";
    
    let formatted = `Primary Diagnosis: ${primaryDiagnosis}`;
    
    if (reasonForDiagnosis) {
      formatted += `\n\nExplanation: ${reasonForDiagnosis}`;
    }
    
    if (diagnosis?.differential_diagnoses?.length > 0) {
      formatted += "\n\nDifferential Diagnoses:\n";
      diagnosis.differential_diagnoses.forEach((d, i) => {
        formatted += `  ${i+1}. ${d.disease} (${pct(d.probability)})\n`;
      });
    }

    console.log("✅ Primary Diagnosis:", primaryDiagnosis);
    console.log("✅ Reason for Diagnosis:", reasonForDiagnosis);

    if (onAddToTreatmentPlan) {
      onAddToTreatmentPlan(formatted, primaryDiagnosis, reasonForDiagnosis);
    }

    if (onApprove) {
      onApprove(formatted, primaryDiagnosis, reasonForDiagnosis);
    }

    onClose?.();
  };

  const handleClose = () => { 
    setDiagnosis(null); 
    setApiError(null);
    onClose?.(); 
  };

  if (!open) return null;

  const pd = diagnosis?.primary_diagnosis;
  const hr = diagnosis?.hypothesis_reasoning;
  const gp = diagnosis?.guideline_pathways;
  const sas = diagnosis?.skill_application_summary;
  const redFlags = diagnosis?.red_flag_alerts;

  const hasData = (obj) => {
    if (!obj) return false;
    if (Array.isArray(obj)) return obj.length > 0;
    if (typeof obj === 'object') {
      return Object.values(obj).some(v => 
        v !== null && v !== undefined && v !== '' && 
        !(Array.isArray(v) && v.length === 0) &&
        !(typeof v === 'object' && Object.keys(v).length === 0)
      );
    }
    return true;
  };

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
              AI Diagnosis Analysis (Skill-Based)
            </h2>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "2px 0 0", fontWeight: 300 }}>
              Using specialized diagnostic skills for comprehensive analysis
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
              <div>
                <span style={S.secLabel}>AI Clinical Engine</span>
                <h3 style={{ fontSize: "0.95rem", margin: 0 }}>
                  Processing Diagnosis with Skills
                </h3>
              </div>
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
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {steps.map((s, i) => (
                  <div key={i} style={{
                    display: "flex",
                    alignItems: "center",
                    fontSize: "0.75rem",
                    color: s === stage ? T.text : steps.indexOf(stage) > i ? T.textMuted : T.textMuted,
                    opacity: s === stage ? 1 : 0.6
                  }}>
                    <span style={{ width: 16, display: "inline-block" }}>
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
              {apiError && (
                <p style={{ fontSize: "0.7rem", color: "#dc2626", marginTop: "4px", opacity: 0.7 }}>
                  Details: {apiError}
                </p>
              )}
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

              {/* primary diagnosis box - only show if disease exists */}
              {pd?.disease && (
                <div style={{
                  border: `1px solid ${T.borderStr}`,
                  borderTop: `2px solid ${T.borderStr}`,
                  padding: "1.25rem",
                  marginBottom: "1rem",
                  background: T.bg,
                }}>
                  <span style={S.secLabel}>Primary Diagnosis</span>
                  <p style={{ fontSize: "1.1rem", fontWeight: 400, letterSpacing: "-0.02em", color: T.text, margin: "0 0 0.75rem" }}>
                    {pd.disease.charAt(0).toUpperCase() + pd.disease.slice(1)}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {pd.type && <Chip label={`Type: ${pd.type}`} accent />}
                    {pd.stage && <Chip label={`Stage: ${pd.stage}`} accent />}
                    {pd.size && <Chip label={`Size: ${pd.size}`} />}
                    {pd.severity && <Chip label={`Severity: ${pd.severity}`} accent />}
                    {pd.probability != null && <Chip label={`Confidence: ${pct(pd.probability)}`} accent />}
                  </div>
                </div>
              )}

              {/* 🆕 RED FLAG ALERTS — placed high up, right after primary diagnosis, for visibility */}
              {redFlags?.length > 0 && (
                <div style={{
                  border: `1px solid ${T.danger}`,
                  borderLeft: `4px solid ${T.danger}`,
                  padding: "1rem 1.25rem",
                  marginBottom: "1rem",
                  background: "#fef2f2",
                }}>
                  <span style={{ ...S.secLabel, color: T.danger }}>⚠ Red Flag Alerts</span>
                  <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0" }}>
                    {redFlags.map((flag, i) => (
                      <li key={i} style={{
                        fontSize: "0.78rem", color: "#7f1d1d", fontWeight: 400,
                        lineHeight: 1.6, paddingLeft: "0.875rem",
                        position: "relative", marginBottom: "5px",
                      }}>
                        <span style={{ position: "absolute", left: 0, color: T.danger }}>▲</span>
                        {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* explanation - only show if exists */}
              {diagnosis.reason_for_primary_diagnosis && (
                <Callout label="Explanation">
                  <p style={{ fontSize: "0.82rem", color: T.textSec, lineHeight: 1.7, margin: 0, fontWeight: 300 }}>
                    {diagnosis.reason_for_primary_diagnosis}
                  </p>
                </Callout>
              )}

              {/* supporting evidence - only show if exists */}
              {pd?.supporting_evidence?.length > 0 && (
                <SectionCard title="Supporting Evidence">
                  <BulletList items={pd.supporting_evidence} />
                </SectionCard>
              )}

              {/* supported_by_skills - only show if exists */}
              {pd?.supported_by_skills?.length > 0 && (
                <SectionCard title="Supported By Skills">
                  {pd.supported_by_skills.map((skill, i) => (
                    <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.75rem", marginBottom: "0.5rem", background: T.bg }}>
                      <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 4px" }}>
                        {skill.skill_name}
                      </p>
                      {skill.contribution && (
                        <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "0 0 4px", fontWeight: 300 }}>
                          {skill.contribution}
                        </p>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {skill.impact && <Chip label={`Impact: ${skill.impact}`} accent />}
                        {skill.confidence_boost != null && <Chip label={`Confidence Boost: ${pct(skill.confidence_boost)}`} />}
                      </div>
                    </div>
                  ))}
                </SectionCard>
              )}

              {/* GUIDELINES — Only show skills that are in supported_by_skills */}
              {pd?.supported_by_skills?.length > 0 && (
                <SectionCard title="Guidelines — Primary Diagnosis">
                  {(() => {
                    // Get the skill_ids from supported_by_skills
                    const supportedSkillIds = new Set(
                      pd.supported_by_skills.map(s => s.skill_id)
                    );
                    
                    // Filter guidelines to only those in supported_by_skills
                    const relevantGuidelines = pd.guidelines?.filter(g => 
                      supportedSkillIds.has(g.skill_id)
                    ) || [];
                    
                    // If no matching guidelines found, fall back to supported_by_skills data
                    if (relevantGuidelines.length === 0) {
                      return pd.supported_by_skills.map((skill, i) => (
                        <div key={i} style={{ 
                          border: `1px solid ${T.border}`, 
                          padding: "0.875rem", 
                          marginBottom: "0.625rem", 
                          background: T.bg,
                          borderLeft: `3px solid ${skill.impact === 'High' ? T.borderStr : T.border}`
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 3px" }}>
                              {skill.skill_name}
                            </p>
                            {skill.impact && <Chip label={`Impact: ${skill.impact}`} accent />}
                          </div>
                          {skill.contribution && (
                            <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "0 0 4px", fontWeight: 300 }}>
                              {skill.contribution}
                            </p>
                          )}
                          {skill.confidence_boost != null && (
                            <Chip label={`Confidence Boost: ${pct(skill.confidence_boost)}`} />
                          )}
                        </div>
                      ));
                    }
                    
                    return relevantGuidelines.map((g, i) => {
                      // Find the matching supported skill for impact/contribution
                      const matchingSkill = pd.supported_by_skills?.find(s => s.skill_id === g.skill_id);
                      
                      return (
                        <div key={i} style={{ 
                          border: `1px solid ${T.border}`, 
                          padding: "0.875rem", 
                          marginBottom: "0.625rem", 
                          background: T.bg,
                          borderLeft: `3px solid ${matchingSkill?.impact === 'High' ? T.borderStr : T.border}`
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 3px" }}>
                              {g.skill_name}
                            </p>
                            {matchingSkill?.impact && <Chip label={`Impact: ${matchingSkill.impact}`} accent />}
                          </div>
                          
                          {matchingSkill?.contribution && (
                            <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "0 0 4px", fontWeight: 300 }}>
                              {matchingSkill.contribution}
                            </p>
                          )}
                          
                          {g.reference && (
                            <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "0 0 4px", fontWeight: 300 }}>
                              {g.reference}
                            </p>
                          )}
                          
                          {g.disease_type && (
                            <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "2px 0", fontWeight: 300 }}>
                              Disease Type: {g.disease_type}
                            </p>
                          )}
                          
                          {g.subtype && (
                            <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "2px 0", fontWeight: 300 }}>
                              Subtype: {g.subtype}
                            </p>
                          )}
                          
                          {g.sections_used?.length > 0 && (
                            <div style={{ marginTop: "4px" }}>
                              <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, display: "block", marginBottom: "2px" }}>
                                Sections Used
                              </span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {g.sections_used.map((section, si) => (
                                  <Chip key={si} label={section} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </SectionCard>
              )}

              {/* differential diagnoses - only show those with supported_by_skills */}
              {diagnosis.differential_diagnoses?.filter(d => d.supported_by_skills?.length > 0).length > 0 && (
                <SectionCard title="Differential Diagnoses">
                  {diagnosis.differential_diagnoses
                    .filter(d => d.supported_by_skills?.length > 0)
                    .map((d, i) => (
                      <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.625rem", background: T.bgAlt }}>
                        <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: "0 0 6px" }}>
                          {d.disease || "Unknown"}
                        </p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                          {d.type && <Chip label={`Type: ${d.type}`} />}
                          {d.stage && <Chip label={`Stage: ${d.stage}`} />}
                          {d.size && <Chip label={`Size: ${d.size}`} />}
                          {d.probability != null && <Chip label={`Probability: ${pct(d.probability)}`} accent />}
                        </div>
                        {d.supported_by_skills?.length > 0 && (
                          <div style={{ marginTop: "6px" }}>
                            <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted, display: "block", marginBottom: "2px" }}>
                              Supporting Skills
                            </span>
                            {d.supported_by_skills.map((skill, si) => (
                              <div key={si} style={{ fontSize: "0.72rem", color: T.textSec, padding: "2px 0" }}>
                                • {skill.skill_name} 
                                {skill.confidence_boost != null && ` (${(skill.confidence_boost * 100).toFixed(0)}% confidence)`}
                                {skill.impact && ` — ${skill.impact} impact`}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                  ))}
                </SectionCard>
              )}

              {/* investigations - only show if exists */}
              {diagnosis.investigations?.length > 0 && (
                <SectionCard title="Investigations">
                  {diagnosis.investigations.map((inv, i) => (
                    <div key={i} style={{ padding: "0.625rem 0", borderBottom: i < diagnosis.investigations.length - 1 ? `1px solid ${T.border}` : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                        <span style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text }}>• {inv.test}</span>
                        <div>
                          {inv.status && <Chip label={(inv.status || "").replace(/_/g, " ")} accent />}
                          {inv.required_for && <Chip label={inv.required_for} />}
                          {inv.urgency && <Chip label={inv.urgency} />}
                        </div>
                      </div>
                      {inv.result_summary && <p style={{ fontSize: "0.68rem", color: T.textSec, margin: "2px 0", fontWeight: 300 }}>Result: {inv.result_summary}</p>}
                      {inv.interpretation && <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: 0, fontWeight: 300 }}>{inv.interpretation}</p>}
                      {inv.date_performed && <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "2px 0", fontWeight: 300 }}>Date: {inv.date_performed}</p>}
                      {inv.supports_hypothesis != null && (
                        <Chip label={inv.supports_hypothesis ? "Supports Hypothesis" : "Does Not Support"} accent={inv.supports_hypothesis} />
                      )}
                    </div>
                  ))}
                </SectionCard>
              )}

              {/* missing investigations - only show if exists */}
              {diagnosis.missing_investigations?.length > 0 && (
                <Callout label="Missing Investigations" color="#dc2626">
                  <BulletList items={diagnosis.missing_investigations} />
                </Callout>
              )}

              {/* 🆕 HYPOTHESIS REASONING */}
              {hasData(hr) && (
                <SectionCard title="Hypothesis Reasoning">
                  <div style={{ marginBottom: "0.75rem" }}>
                    {hr.primary_hypothesis && (
                      <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 8px" }}>
                        {hr.primary_hypothesis}
                      </p>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "10px" }}>
                      {hr.diagnosis_gate && <Chip label={`Diagnostic Gate: ${hr.diagnosis_gate}`} accent />}
                      {hr.confidence_current != null && <Chip label={`Current Confidence: ${pct(hr.confidence_current)}`} accent />}
                      {hr.confidence_at_entry != null && <Chip label={`Confidence at Entry: ${pct(hr.confidence_at_entry)}`} />}
                      {hr.confidence_for_treatment != null && <Chip label={`Confidence for Treatment: ${pct(hr.confidence_for_treatment)}`} />}
                    </div>

                    {/* confidence progress bar */}
                    {hr.confidence_current != null && (
                      <ProgressBar value={Math.round(hr.confidence_current * 100)} label="Diagnostic Confidence" />
                    )}
                  </div>

                  {hr.specialist_summary && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Specialist Summary</span>
                      <p style={{ fontSize: "0.78rem", color: T.textSec, lineHeight: 1.7, margin: 0, fontWeight: 300 }}>
                        {hr.specialist_summary}
                      </p>
                    </div>
                  )}

                  {hr.gate_blockers?.length > 0 && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Gate Blockers</span>
                      <BulletList items={hr.gate_blockers} />
                    </div>
                  )}

                  {hr.confirmatory_tests_pending?.length > 0 && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Confirmatory Tests Pending</span>
                      <BulletList items={hr.confirmatory_tests_pending} />
                    </div>
                  )}

                  {hr.ruling_out?.length > 0 && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Still Ruling Out</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {hr.ruling_out.map((item, i) => <Chip key={i} label={item} />)}
                      </div>
                    </div>
                  )}

                  {/* step-by-step reasoning, collapsible since it's dense */}
                  {hr.steps?.length > 0 && (
                    <div>
                      <div
                        className="da2-accordion-head"
                        onClick={() => setShowReasoningSteps(!showReasoningSteps)}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          cursor: "pointer", padding: "0.5rem 0.625rem",
                          border: `1px solid ${T.border}`, background: T.bg,
                        }}
                      >
                        <span style={{ fontSize: "0.72rem", fontWeight: 400, color: T.text, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Reasoning Steps ({hr.steps.length})
                        </span>
                        <span style={{ fontSize: "0.7rem", color: T.textMuted }}>{showReasoningSteps ? "▲ Hide" : "▼ Show"}</span>
                      </div>

                      {showReasoningSteps && (
                        <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {hr.steps.map((step, i) => (
                            <div key={i} style={{
                              border: `1px solid ${T.border}`,
                              borderLeft: `3px solid ${outcomeAccent(step.outcome) ? T.borderStr : T.border}`,
                              padding: "0.75rem", background: T.bg,
                            }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                                <p style={{ fontSize: "0.78rem", fontWeight: 400, color: T.text, margin: 0 }}>
                                  {step.step_number}. {step.step_label}
                                </p>
                                {step.outcome && <Chip label={step.outcome.replace(/_/g, " ")} accent={outcomeAccent(step.outcome)} />}
                              </div>
                              {step.reasoning && (
                                <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "0 0 6px", lineHeight: 1.6, fontWeight: 300 }}>
                                  {step.reasoning}
                                </p>
                              )}
                              {step.evidence_available?.length > 0 && (
                                <div style={{ marginBottom: "4px" }}>
                                  <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>Evidence Available</span>
                                  <BulletList items={step.evidence_available} />
                                </div>
                              )}
                              {step.evidence_missing?.length > 0 && (
                                <div style={{ marginBottom: "4px" }}>
                                  <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>Evidence Missing</span>
                                  <BulletList items={step.evidence_missing} />
                                </div>
                              )}
                              {step.next_required && (
                                <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "4px 0 0", fontWeight: 300 }}>
                                  Next required: {step.next_required}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </SectionCard>
              )}

              {/* 🆕 GUIDELINE PATHWAYS */}
              {gp?.length > 0 && (
                <SectionCard title="Guideline Pathways">
                  {gp.map((path, i) => {
                    const isExpanded = expandedPathwayIdx === i;
                    return (
                      <div key={i} style={{ border: `1px solid ${T.border}`, marginBottom: "0.625rem", background: T.bg }}>
                        <div
                          className="da2-accordion-head"
                          onClick={() => setExpandedPathwayIdx(isExpanded ? null : i)}
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                            cursor: "pointer", padding: "0.875rem",
                          }}
                        >
                          <div>
                            <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: "0 0 4px" }}>
                              {path.guideline_name}
                            </p>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {path.pathway_stage && <Chip label={`Stage: ${path.pathway_stage}`} accent />}
                              {path.overall_alignment && <Chip label={`Alignment: ${path.overall_alignment}`} accent={path.overall_alignment === "full"} />}
                              {path.applicable_for && <Chip label={path.applicable_for} />}
                            </div>
                            {path.guideline_source && (
                              <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "4px 0 0", fontWeight: 300 }}>
                                {path.guideline_source}
                              </p>
                            )}
                          </div>
                          <span style={{ fontSize: "0.7rem", color: T.textMuted, flexShrink: 0, marginLeft: "8px" }}>
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </div>

                        {isExpanded && (
                          <div style={{ padding: "0 0.875rem 0.875rem" }}>

                            {/* section 1: evidence available */}
                            {path.section_1_evidence_available?.length > 0 && (
                              <div style={{ marginBottom: "0.75rem" }}>
                                <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Evidence Available</span>
                                {path.section_1_evidence_available.map((ev, ei) => (
                                  <div key={ei} style={{ border: `1px solid ${T.border}`, padding: "0.5rem 0.625rem", marginBottom: "0.4rem", background: T.bgAlt }}>
                                    <p style={{ fontSize: "0.74rem", color: T.text, margin: "0 0 3px", fontWeight: 400 }}>{ev.parameter}</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                      {ev.value && <Chip label={ev.value} accent />}
                                      {ev.source && <Chip label={ev.source} />}
                                      {ev.date && <Chip label={ev.date} />}
                                      {ev.guideline_relevance && <Chip label={`Relevance: ${ev.guideline_relevance}`} />}
                                    </div>
                                    {ev.decision_enabled && (
                                      <p style={{ fontSize: "0.68rem", color: T.textMuted, margin: "3px 0 0", fontWeight: 300 }}>
                                        → {ev.decision_enabled}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* section 2: missing / pending */}
                            {path.section_2_missing_pending?.length > 0 && (
                              <div style={{ marginBottom: "0.75rem" }}>
                                <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Missing / Pending</span>
                                {path.section_2_missing_pending.map((mp, mi) => (
                                  <div key={mi} style={{ borderLeft: `2px solid ${T.danger}`, padding: "0.5rem 0.625rem", marginBottom: "0.4rem", background: "#fef2f2" }}>
                                    <p style={{ fontSize: "0.74rem", color: T.text, margin: "0 0 3px", fontWeight: 400 }}>{mp.investigation}</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                      {mp.status && <Chip label={mp.status} />}
                                      {mp.guideline_requirement && <Chip label={`Requirement: ${mp.guideline_requirement}`} accent />}
                                      {mp.importance_for_treatment && <Chip label={`Importance: ${mp.importance_for_treatment}`} />}
                                    </div>
                                    {mp.recommended_action && (
                                      <p style={{ fontSize: "0.68rem", color: T.textSec, margin: "3px 0 0", fontWeight: 300 }}>
                                        Recommended: {mp.recommended_action}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* section 3: clinical interpretation */}
                            {hasData(path.section_3_clinical_interpretation) && (
                              <div style={{ marginBottom: "0.75rem" }}>
                                <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Clinical Interpretation</span>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                                  <Chip
                                    label={`Sufficient for Treatment: ${path.section_3_clinical_interpretation.sufficient_for_treatment_initiation ? "Yes" : "No"}`}
                                    accent={path.section_3_clinical_interpretation.sufficient_for_treatment_initiation}
                                  />
                                  {path.section_3_clinical_interpretation.hypothesis_gate_status && (
                                    <Chip label={`Gate: ${path.section_3_clinical_interpretation.hypothesis_gate_status}`} accent />
                                  )}
                                </div>
                                {path.section_3_clinical_interpretation.treatment_ready_for?.length > 0 && (
                                  <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "2px 0", fontWeight: 300 }}>
                                    Treatment ready for: {path.section_3_clinical_interpretation.treatment_ready_for.join(", ")}
                                  </p>
                                )}
                                {path.section_3_clinical_interpretation.limited_by_missing?.length > 0 && (
                                  <p style={{ fontSize: "0.72rem", color: T.textSec, margin: "2px 0", fontWeight: 300 }}>
                                    Limited by: {path.section_3_clinical_interpretation.limited_by_missing.join(", ")}
                                  </p>
                                )}
                                {path.section_3_clinical_interpretation.hypothesis_gate_narrative && (
                                  <p style={{ fontSize: "0.72rem", color: T.textMuted, margin: "4px 0 0", fontWeight: 300 }}>
                                    {path.section_3_clinical_interpretation.hypothesis_gate_narrative}
                                  </p>
                                )}
                                {path.section_3_clinical_interpretation.priority_next_steps?.length > 0 && (
                                  <div style={{ marginTop: "4px" }}>
                                    <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>Priority Next Steps</span>
                                    <BulletList items={path.section_3_clinical_interpretation.priority_next_steps} />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* section 4: alignment summary */}
                            {hasData(path.section_4_alignment_summary) && (
                              <div>
                                <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Alignment Summary</span>
                                {path.section_4_alignment_summary.workup_completion_percent != null && (
                                  <ProgressBar value={path.section_4_alignment_summary.workup_completion_percent} label="Workup Completion" />
                                )}
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                  {path.section_4_alignment_summary.confirmed_criteria != null && <Chip label={`Confirmed: ${path.section_4_alignment_summary.confirmed_criteria}`} accent />}
                                  {path.section_4_alignment_summary.pending_criteria != null && <Chip label={`Pending: ${path.section_4_alignment_summary.pending_criteria}`} />}
                                  {path.section_4_alignment_summary.missing_criteria != null && <Chip label={`Missing: ${path.section_4_alignment_summary.missing_criteria}`} />}
                                  {path.section_4_alignment_summary.total_criteria != null && <Chip label={`Total: ${path.section_4_alignment_summary.total_criteria}`} />}
                                </div>
                                <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "2px" }}>
                                  {path.section_4_alignment_summary.ready_for_surgery && (
                                    <p style={{ fontSize: "0.7rem", color: T.textSec, margin: 0, fontWeight: 300 }}>
                                      Ready for surgery: {path.section_4_alignment_summary.ready_for_surgery}
                                    </p>
                                  )}
                                  {path.section_4_alignment_summary.ready_for_systemic_therapy && (
                                    <p style={{ fontSize: "0.7rem", color: T.textSec, margin: 0, fontWeight: 300 }}>
                                      Ready for systemic therapy: {path.section_4_alignment_summary.ready_for_systemic_therapy}
                                    </p>
                                  )}
                                  {path.section_4_alignment_summary.ready_for_mdt_discussion && (
                                    <p style={{ fontSize: "0.7rem", color: T.textSec, margin: 0, fontWeight: 300 }}>
                                      Ready for MDT discussion: {path.section_4_alignment_summary.ready_for_mdt_discussion}
                                    </p>
                                  )}
                                </div>
                                {path.section_4_alignment_summary.readiness_rationale && (
                                  <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "6px 0 0", fontWeight: 300 }}>
                                    {path.section_4_alignment_summary.readiness_rationale}
                                  </p>
                                )}
                              </div>
                            )}

                            {path.cross_guideline_overlaps?.length > 0 && path.cross_guideline_overlaps[0] !== "None" && (
                              <div style={{ marginTop: "0.75rem" }}>
                                <span style={{ ...S.secLabel, marginBottom: "0.3rem" }}>Cross-Guideline Overlaps</span>
                                <BulletList items={path.cross_guideline_overlaps} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </SectionCard>
              )}

              {/* 🆕 SKILL APPLICATION SUMMARY */}
              {sas?.length > 0 && (
                <SectionCard title="Skill Application Summary">
                  {sas.map((skill, i) => (
                    <div key={i} style={{ border: `1px solid ${T.border}`, padding: "0.875rem", marginBottom: "0.625rem", background: T.bg }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                        <p style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text, margin: 0 }}>
                          {skill.skill_name}
                        </p>
                        <div style={{ display: "flex", gap: "4px" }}>
                          {skill.impact && <Chip label={`Impact: ${skill.impact}`} accent />}
                          {skill.diagnostic_weight != null && <Chip label={`Weight: ${pct(skill.diagnostic_weight)}`} />}
                        </div>
                      </div>

                      {skill.contribution && (
                        <p style={{ fontSize: "0.74rem", color: T.textSec, margin: "0 0 6px", lineHeight: 1.6, fontWeight: 300 }}>
                          {skill.contribution}
                        </p>
                      )}

                      {skill.sections_applied?.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                          {skill.sections_applied.map((sec, si) => <Chip key={si} label={sec} />)}
                        </div>
                      )}

                      {skill.matched?.length > 0 && (
                        <div style={{ marginBottom: "6px" }}>
                          <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted, display: "block", marginBottom: "4px" }}>
                            Matched Evidence
                          </span>
                          {skill.matched.map((m, mi) => (
                            <div key={mi} style={{ fontSize: "0.7rem", color: T.textSec, padding: "3px 0", borderTop: mi > 0 ? `1px solid ${T.border}` : "none" }}>
                              <span style={{ color: T.textMuted }}>Skill:</span> {m.skill_content}
                              <br />
                              <span style={{ color: T.textMuted }}>Patient:</span> {m.patient_evidence}
                            </div>
                          ))}
                        </div>
                      )}

                      {skill.evidence_missing?.length > 0 && (
                        <div>
                          <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted, display: "block", marginBottom: "2px" }}>
                            Evidence Missing
                          </span>
                          <BulletList items={skill.evidence_missing} />
                        </div>
                      )}
                    </div>
                  ))}
                </SectionCard>
              )}

            </div>
          )}

        </div>

        {/* ════ FOOTER ════ */}
        {(diagnosis) && (
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
              ✓ Verify &amp; Add to Treatment Plan
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default DiagnosisAnalysisskill;