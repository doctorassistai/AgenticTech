import { useState, useEffect } from "react";
const TRIGGER_OPTIONS = [
  { key: 'claim_genuinity_authenticity', label: 'Claim Genuinity & Authenticity' },
  { key: 'ped_non_disclosure', label: 'PED / Non-Disclosure' },
  { key: 'accident_incident_verification', label: 'Accident / Incident Verification' },
  { key: 'intoxication_addiction', label: 'Intoxication / Addiction' },
  { key: 'medical_records_treatment_verification', label: 'Medical Records & Treatment Verification' },
  { key: 'financial_claim_pattern_risk', label: 'Financial & Claim Pattern Risk' },
  { key: 'policy_coverage_verification', label: 'Policy & Coverage Verification' },
  { key: 'field_vicinity_investigation', label: 'Field / Vicinity Investigation' },
  { key: 'legal_regulatory_death_verification', label: 'Legal / Regulatory / Death Verification' },
  { key: 'hospital_criteria_watchlist', label: 'Hospital Criteria / Watchlist Hospital' },
  { key: 'employee_corporate_group_policy_verification', label: 'Employee / Corporate / Group Policy Verification' },
  { key: 'hospital_cash_benefit_abuse', label: 'Hospital Cash / Benefit Abuse' },
  { key: 'suspicious_claim_pattern_repeat_fraud', label: 'Suspicious Claim Pattern / Repeat Fraud Indicators' },
  { key: 'final_universal_red_flags_matrix', label: 'Final Universal Red Flags Matrix (Master Cross-Trigger Fraud Detection Sheet)' },
]

function formatAnnotationsForPrompt(annotations) {
  if (!annotations || annotations.length === 0) return null;
  const lines = [
    "REVIEWER ANNOTATIONS — treat these as HIGH-PRIORITY findings that MUST be addressed in the conclusion:",
    "",
  ];
  annotations.forEach((ann, i) => {
    const colorLabel = { yellow: "General note", blue: "Important finding", green: "Positive finding", red: "Critical concern" }[ann.color] || "Note";
    lines.push(`[${i + 1}] ${colorLabel.toUpperCase()}`);
    lines.push(`    Highlighted text: "${ann.selectedText}"`);
    lines.push(`    Reviewer note: ${ann.note}`);
    lines.push("");
  });
  return lines.join("\n");
}

export default function GenerateConclusionBar({ caseId, annotations, baseUrl, onConclusionGenerated, initialTriggers = [], emailInstructions }) {
  
  const [selectedTriggers, setSelectedTriggers] = useState(
    initialTriggers.length > 0 ? initialTriggers : ["claim_genuinity_authenticity"]
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [completed, setCompleted]   = useState(false);
  const doctorId = localStorage.getItem("user_id") || "";

  const toggleTrigger = (key) =>
    setSelectedTriggers(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  useEffect(() => {
    if (!generating) return;
    const interval = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [generating]);

  const formatElapsed = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const getStageLabel = (s) => {
    if (s < 15) return "Reading documents…";
    if (s < 45) return "Analyzing hospital records…";
    if (s < 75) return "Cross-checking member account…";
    if (s < 120) return "Drafting conclusion…";
    return "Almost done — large cases take a bit longer…";
  };

  const POLL_INTERVAL_MS = 4000;
  const POLL_MAX_ATTEMPTS = 90; // ~6 minutes — multi-trigger reports can run long

  const handleGenerate = async () => {
    if (selectedTriggers.length === 0) { setError("Select at least one trigger."); return; }
    setGenerating(true);
    setError(null);
    setCompleted(false);
    setElapsedSeconds(0);
    const annotationContext = formatAnnotationsForPrompt(annotations);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    try {
      const enqueueUrl = `${baseUrl.replace(/\/$/, "")}/insurance/web/generate-conclusion/${caseId}`;
      const body = {
        triggers: selectedTriggers,
        ...(annotationContext ? { additional_context: annotationContext } : {}),
      };
      const enqueueRes = await fetch(enqueueUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        body: JSON.stringify(body),
      });
      if (!enqueueRes.ok) {
        const e = await enqueueRes.json().catch(() => ({}));
        throw new Error(e.detail || `Error ${enqueueRes.status}`);
      }
      const { task_id: taskId } = await enqueueRes.json();
      if (!taskId) throw new Error("No task_id returned for conclusion generation.");

      const statusUrl = `${baseUrl.replace(/\/$/, "")}/insurance/web/advanced-upload/status/${taskId}`;
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const statusRes = await fetch(statusUrl, {
          headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        });
        if (!statusRes.ok) continue; // transient — keep polling
        const statusData = await statusRes.json();
        if (statusData.status === "success") {
          const conclusion = statusData.result?.conclusion;
          if (!conclusion) throw new Error("No conclusion returned.");
          setCompleted(true);
          await sleep(700);
          onConclusionGenerated(conclusion);
          setGenerating(false);
          return;
        }
        if (statusData.status === "failed") {
          throw new Error(statusData.error || "Generation failed.");
        }
        // "queued" / "processing" — keep polling
      }
      throw new Error("Conclusion generation is taking longer than expected. It may still complete in the background — try refreshing shortly.");
    } catch (err) {
      setError(err.message || "Generation failed. Please retry.");
      setGenerating(false);
    }
  };

  const T = {
    bg: "#ffffff", bgAlt: "#fafafa", bgTert: "#f4f4f2",
    text: "#0a0a0a", textSec: "#3a3a3a", textMuted: "#888888",
    border: "#e0e0e0", danger: "#dc2626", dangerBg: "#fef2f2", dangerBorder: "#fca5a5",
  };
return (
  <div style={{ padding: "10px 16px" }}>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    {emailInstructions && (
      <div style={{
        display: "flex", gap: 8, alignItems: "flex-start",
        padding: "8px 12px", marginBottom: 8,
        background: "#fffbeb", border: "1px solid #fac775",
        borderRadius: 6, fontSize: 12, color: "#633806", lineHeight: 1.5,
      }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>⚠</span>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 2 }}>
            Insurer Instructions
          </div>
          {emailInstructions}
        </div>
      </div>
    )}

    {/* Single row: label + chips + button */}
    <div data-tour="trigger-chips" style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, fontWeight: 600, marginRight: 2, whiteSpace: "nowrap" }}>
          Triggers
        </span>

        {TRIGGER_OPTIONS.map(t => {
          const active = selectedTriggers.includes(t.key);
          return (
            <button
              key={t.key}
              onClick={() => toggleTrigger(t.key)}
              style={{
                padding: "3px 11px", borderRadius: 99, fontSize: 11,
                cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 500 : 400,
                background: active ? "#f0f0f0" : "transparent",
                color: active ? T.text : T.textMuted,
                border: `1px solid ${active ? "#c0c0c0" : T.border}`,
                transition: "all 0.12s",
              }}
            >
              {active && <span style={{ marginRight: 4, fontSize: 9, color: "#555" }}>✓</span>}
              {t.label}
            </button>
          );
        })}

        {/* Spacer pushes button to the right */}
        <span style={{ flex: 1, minWidth: 8 }} />

        {/* Inline status */}
        {generating && completed && (
          <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600, whiteSpace: "nowrap" }}>
            ✓ Conclusion ready — loading…
          </span>
        )}
        {generating && !completed && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.textMuted, whiteSpace: "nowrap" }}>
            <span style={{ display: "inline-block", width: 9, height: 9, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
            {getStageLabel(elapsedSeconds)} · {formatElapsed(elapsedSeconds)}
          </span>
        )}
        {!generating && error && <span style={{ fontSize: 11, color: T.danger, whiteSpace: "nowrap" }}>✕ {error}</span>}

        {/* Generate button — always at right end */}
        <button
          data-tour="generate-conclusion-btn"
          onClick={handleGenerate}
          disabled={generating || selectedTriggers.length === 0}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px", flexShrink: 0,
            background: (generating || selectedTriggers.length === 0) ? T.bgTert : "#1a1a1a",
            border: "none",
            color: (generating || selectedTriggers.length === 0) ? T.textMuted : "#fff",
            fontFamily: "inherit", fontSize: 11, fontWeight: 500,
            cursor: (generating || selectedTriggers.length === 0) ? "not-allowed" : "pointer",
            borderRadius: 5, whiteSpace: "nowrap",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Generate Conclusion
        </button>
      </div>
    </div>
  );
}