import { useState } from "react";

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

  const doctorId = localStorage.getItem("user_id") || "";

  const toggleTrigger = (key) =>
    setSelectedTriggers(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const handleGenerate = async () => {
    console.log("annotations prop at click:", annotations);
    if (selectedTriggers.length === 0) { setError("Select at least one trigger."); return; }
    setGenerating(true);
    setError(null);
    const annotationContext = formatAnnotationsForPrompt(annotations);
    try {
      const url = `${baseUrl.replace(/\/$/, "")}/insurance/web/generate-conclusion/${caseId}`;
      const body = {
        triggers: selectedTriggers,
        ...(annotationContext ? { additional_context: annotationContext } : {}),
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Error ${res.status}`); }
      const data = await res.json();
      if (!data.conclusion) throw new Error("No conclusion returned.");
      onConclusionGenerated(data.conclusion);
    } catch (err) {
      setError(err.message || "Generation failed. Please retry.");
    } finally {
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
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
        {generating && <span style={{ fontSize: 11, color: T.textMuted, whiteSpace: "nowrap" }}>This may take 20–40 s…</span>}
        {error && <span style={{ fontSize: 11, color: T.danger, whiteSpace: "nowrap" }}>✕ {error}</span>}

        {/* Generate button — always at right end */}
        <button
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
          {generating ? (
            <>
              <span style={{ display: "inline-block", width: 10, height: 10, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              Generating…
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Generate Conclusion
            </>
          )}
        </button>
      </div>
    </div>
  );
}