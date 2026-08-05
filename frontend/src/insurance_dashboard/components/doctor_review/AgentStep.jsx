// AgentStep.jsx
// Step 3: Run AI agent analysis and display results

import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_BACKEND_URL;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}hms/app/doctor${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) { window.location.href = "/"; return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Tiny components ────────────────────────────────────────────────────────────

function Spinner({ size = 20, color = "#7C3AED" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `2.5px solid #E5E7EB`, borderTopColor: color,
      animation: "spin 0.7s linear infinite", flexShrink: 0,
    }} />
  );
}

function ScoreBadge({ score, label }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct >= 70 ? "#16A34A" : pct >= 40 ? "#D97706" : "#DC2626";
  const bg    = pct >= 70 ? "#F0FDF4" : pct >= 40 ? "#FFFBEB" : "#FEF2F2";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 16px", borderRadius: 10, background: bg,
      border: `1px solid ${color}22`, minWidth: 80,
    }}>
      <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{pct}<span style={{ fontSize: 12, fontWeight: 600 }}>%</span></div>
      <div style={{ fontSize: 10, color: "#64748B", marginTop: 3, textAlign: "center", fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function VerdictChip({ verdict, label }) {
  const v = (verdict || "").toLowerCase();
  const config = {
    adequate:    { bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0" },
    sufficient:  { bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0" },
    approve:     { bg: "#F0FDF4", color: "#16A34A", border: "#BBF7D0" },
    inadequate:  { bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
    insufficient:{ bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
    reject:      { bg: "#FEF2F2", color: "#DC2626", border: "#FECACA" },
    inconclusive:{ bg: "#FFFBEB", color: "#D97706", border: "#FDE68A" },
    query:       { bg: "#FFFBEB", color: "#D97706", border: "#FDE68A" },
  }[v] || { bg: "#F1F5F9", color: "#64748B", border: "#E2E8F0" };

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 800,
      background: config.bg, color: config.color,
      border: `1.5px solid ${config.border}`,
    }}>
      {label && <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>{label}:</span>}
      {verdict}
    </span>
  );
}

function SectionCard({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden",
      marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "11px 16px", background: "#F8FAFC",
          border: "none", borderBottom: open ? "1px solid #E2E8F0" : "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{title}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6,9 12,15 18,9"/>
        </svg>
      </button>
      {open && <div style={{ padding: "14px 16px" }}>{children}</div>}
    </div>
  );
}

function TagList({ items, color = "#1D4ED8", bg = "#EFF6FF" }) {
  if (!items?.length) return <span style={{ fontSize: 11, color: "#94A3B8" }}>None</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item, i) => (
        <span key={i} style={{
          fontSize: 11, padding: "3px 9px", borderRadius: 99,
          background: bg, color, fontWeight: 600,
        }}>{typeof item === "string" ? item : JSON.stringify(item)}</span>
      ))}
    </div>
  );
}

function KVRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  const display = typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748B", minWidth: 140, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: "#0F172A", wordBreak: "break-word" }}>{display}</span>
    </div>
  );
}

// ── Section renderers ──────────────────────────────────────────────────────────

function ClinicalContextPanel({ ctx }) {
  if (!ctx) return null;
  return (
    <SectionCard title="Clinical Context" icon="🧬">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <KVRow label="Primary Specialty" value={ctx.primary_specialty} />
        <KVRow label="Primary Complaint" value={ctx.primary_complaint} />
        <KVRow label="Total Documents" value={ctx.total_documents} />
        <KVRow label="Date Range" value={ctx.date_range ? `${ctx.date_range.earliest || "?"} → ${ctx.date_range.latest || "?"}` : null} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Active Diagnoses</div>
        <TagList items={ctx.active_diagnoses} color="#1D4ED8" bg="#EFF6FF" />
      </div>
      {ctx.past_history?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Past History</div>
          <TagList items={ctx.past_history} color="#7C3AED" bg="#FAF5FF" />
        </div>
      )}
      {ctx.medications?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Medications</div>
          <TagList items={ctx.medications} color="#0F766E" bg="#F0FDFA" />
        </div>
      )}
      {ctx.pending_reports?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Pending Reports</div>
          <TagList items={ctx.pending_reports} color="#C2410C" bg="#FFF7ED" />
        </div>
      )}
      {ctx.raw_text_summary && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, fontSize: 11, color: "#374151", lineHeight: 1.6, border: "1px solid #E2E8F0" }}>
          {ctx.raw_text_summary}
        </div>
      )}
    </SectionCard>
  );
}

function AdequacyPanel({ data }) {
  if (!data) return null;
  return (
    <SectionCard title="Medical Adequacy" icon="✅">
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <ScoreBadge score={data.adequacy_score} label="Adequacy" />
        {data.final_verdict && <VerdictChip verdict={data.final_verdict} label="Verdict" />}
      </div>
      {data.clinical_interpretation && (
        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 10, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
          {data.clinical_interpretation}
        </div>
      )}
      {data.diagnostic_accuracy && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>
            Diagnostic Accuracy — {Math.round((data.diagnostic_accuracy.score || 0) * 100)}%
          </div>
          {data.diagnostic_accuracy.strengths?.length > 0 && (
            <TagList items={data.diagnostic_accuracy.strengths} color="#16A34A" bg="#F0FDF4" />
          )}
          {data.diagnostic_accuracy.issues?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <TagList items={data.diagnostic_accuracy.issues} color="#DC2626" bg="#FEF2F2" />
            </div>
          )}
        </div>
      )}
      {data.next_steps?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Next Steps</div>
          <ul style={{ paddingLeft: 16, margin: 0 }}>
            {data.next_steps.map((s, i) => (
              <li key={i} style={{ fontSize: 11, color: "#374151", marginBottom: 3 }}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function SufficiencyPanel({ data }) {
  if (!data) return null;
  return (
    <SectionCard title="Medical Sufficiency" icon="📋">
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <ScoreBadge score={data.sufficiency_score} label="Sufficiency" />
        {data.final_verdict && <VerdictChip verdict={data.final_verdict} label="Verdict" />}
      </div>
      {data.executive_summary && (
        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 10, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
          {data.executive_summary}
        </div>
      )}
      {data.documentation_completeness && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>
            Documentation — {Math.round((data.documentation_completeness.score || 0) * 100)}%
          </div>
          {data.documentation_completeness.present_elements?.length > 0 && (
            <TagList items={data.documentation_completeness.present_elements} color="#16A34A" bg="#F0FDF4" />
          )}
          {data.documentation_completeness.missing_elements?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 3 }}>Missing:</div>
              <TagList items={data.documentation_completeness.missing_elements} color="#DC2626" bg="#FEF2F2" />
            </div>
          )}
        </div>
      )}
      {data.critical_gaps?.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#FEF2F2", borderRadius: 8, border: "1px solid #FECACA" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>Critical Gaps</div>
          <ul style={{ paddingLeft: 16, margin: 0 }}>
            {data.critical_gaps.map((g, i) => (
              <li key={i} style={{ fontSize: 11, color: "#991B1B", marginBottom: 2 }}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function InsuranceDecisionPanel({ data }) {
  if (!data) return null;
  return (
    <SectionCard title="Insurance Decision" icon="⚖️" defaultOpen={true}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <VerdictChip verdict={data.decision} />
        {data.confidence != null && (
          <ScoreBadge score={data.confidence} label="Confidence" />
        )}
      </div>
      {data.reason && (
        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 10, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
          {data.reason}
        </div>
      )}
      {data.recommendation && (
        <div style={{ fontSize: 11, color: "#1D4ED8", fontWeight: 600, marginBottom: 8 }}>
          → {data.recommendation}
        </div>
      )}
      {data.supporting_flags?.length > 0 && (
        <TagList items={data.supporting_flags} color="#7C3AED" bg="#FAF5FF" />
      )}
      {data.requires_manual_review && (
        <div style={{ marginTop: 10, padding: "7px 12px", background: "#FFFBEB", borderRadius: 8, border: "1px solid #FDE68A", fontSize: 11, color: "#92400E", fontWeight: 600 }}>
          ⚠️ Manual review required
        </div>
      )}
    </SectionCard>
  );
}

function EngineResultsPanel({ engines }) {
  if (!engines) return null;
  const KEY_ENGINES = [
    ["Fraud Screening Engine", "🔍"],
    ["fraud_suspicious_dictation", "🔍"],
    ["Admission Review Engine", "🏥"],
    ["Discharge & Outcome Engine", "🚪"],
    ["Investigation Audit Engine", "🔬"],
    ["Medication Review Engine", "💊"],
    ["Treatment & Procedure Engine", "⚕️"],
    ["Billing Audit Engine", "💰"],
    ["Specialty Engine", "🩺"],
    ["patient_risk_stratification", "⚠️"],
    ["disease_progression", "📈"],
    ["clinical_contradiction", "⚡"],
    ["cross_specialty_conflict", "🔀"],
  ];

  const rendered = [];
  const shown = new Set();

  for (const [key, icon] of KEY_ENGINES) {
    if (shown.has(key) || !engines[key]) continue;
    shown.add(key);
    const eng = engines[key];
    rendered.push({ key, icon, eng });
  }

  if (!rendered.length) return null;

  return (
    <SectionCard title="Engine Results" icon="🤖" defaultOpen={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rendered.map(({ key, icon, eng }) => (
          <div key={key} style={{
            padding: "10px 14px", borderRadius: 10,
            border: "1px solid #E2E8F0", background: "#FAFAFA",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", flex: 1 }}>
                {eng.engine_name || key}
              </span>
              {eng.fraud_risk_score != null && (
                <ScoreBadge score={1 - eng.fraud_risk_score} label="Safety" />
              )}
              {eng.risk_level && (
                <VerdictChip verdict={eng.risk_level} />
              )}
              {eng.admission_type && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "#EFF6FF", color: "#1D4ED8", fontWeight: 700 }}>{eng.admission_type}</span>
              )}
            </div>
            {eng.summary && typeof eng.summary === "string" && (
              <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.5 }}>{eng.summary}</div>
            )}
            {eng.discharge_status && (
              <div style={{ fontSize: 11, color: "#374151" }}>Discharge: <b>{eng.discharge_status}</b>{eng.discharge_date ? ` — ${eng.discharge_date}` : ""}</div>
            )}
            {eng.flags?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {eng.flags.slice(0, 3).map((f, i) => (
                  <div key={i} style={{ fontSize: 10, color: f.type === "warning" || f.type === "critical" ? "#DC2626" : "#64748B", marginTop: 2 }}>
                    {f.type === "warning" ? "⚠️ " : f.type === "critical" ? "🚨 " : "ℹ️ "}{f.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function WarningsPanel({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <SectionCard title={`Warnings (${warnings.length})`} icon="⚠️" defaultOpen={true}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {warnings.slice(0, 10).map((w, i) => {
          const msg = typeof w === "string" ? w : (w.type ? `[${w.type}] ${w.message || JSON.stringify(w.details || "")}` : JSON.stringify(w));
          return (
            <div key={i} style={{
              fontSize: 11, padding: "7px 11px", borderRadius: 8,
              background: "#FFFBEB", border: "1px solid #FDE68A",
              color: "#92400E", lineHeight: 1.5,
            }}>
              {msg}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function VerdictSummaryPanel({ data }) {
  if (!data) return null;
  return (
    <SectionCard title="Verdict Summary" icon="📊">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <KVRow label="Adequacy" value={data.adequacy_verdict} />
        <KVRow label="Sufficiency" value={data.sufficiency_verdict} />
        <KVRow label="Specialty" value={data.primary_specialty} />
        <KVRow label="Documents" value={data.total_documents} />
      </div>
      {data.pending_reports?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Pending Reports</div>
          <TagList items={data.pending_reports} color="#C2410C" bg="#FFF7ED" />
        </div>
      )}
    </SectionCard>
  );
}

// ── Main AgentStep ─────────────────────────────────────────────────────────────

export default function AgentStep({ detail, onBack, verifState }) {
  const caseId = detail?.id;

  const [phase, setPhase] = useState("idle"); // idle | running | done | error | cached
  const [result, setResult] = useState(null);
  const [error, setError]   = useState(null);
  const [runLog, setRunLog] = useState([]);

  const addLog = (msg) => setRunLog(prev => [...prev, { msg, ts: new Date().toISOString() }]);

  // On mount: check if a cached result exists
  useEffect(() => {
    if (!caseId) return;
    apiFetch(`/claims/${caseId}/agent-result`)
      .then(data => {
        if (data?.status === "success" && data?.data) {
          setResult(data.data);
          setPhase("cached");
        }
      })
      .catch(() => {});
  }, [caseId]);

  const runAgent = useCallback(async () => {
    setPhase("running");
    setError(null);
    setRunLog([]);
    addLog("Starting clinical reasoning pipeline…");
    addLog("Fetching and normalising documents…");

    try {
      const data = await apiFetch(`/claims/${caseId}/run-agent`, { method: "POST", body: JSON.stringify({}) });
      addLog("Pipeline complete. Processing results…");
      setResult(data);
      setPhase("done");
    } catch (e) {
      setError(e.message);
      setPhase("error");
    }
  }, [caseId]);

  // Summary from verif steps
  const totalVerified = Object.values(verifState?.fields || {}).filter(v => v === true).length
    + Object.values(verifState?.documents || {}).filter(v => v === true).length;
  const totalDisputed = Object.values(verifState?.fields || {}).filter(v => v === false).length
    + Object.values(verifState?.documents || {}).filter(v => v === false).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

      {/* Header */}
      <div style={{
        padding: "14px 20px 12px", background: "#fff",
        borderBottom: "1px solid #E2E8F0", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #BE185D, #7C3AED)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>3</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>Agent Analysis</div>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              AI-powered clinical reasoning across all submitted documents
            </div>
          </div>
        </div>

        {/* Verif summary from previous steps */}
        <div style={{
          display: "flex", gap: 8, flexWrap: "wrap",
          padding: "7px 10px", background: "#F8FAFC",
          borderRadius: 8, border: "1px solid #E2E8F0",
        }}>
          <span style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>Verification summary:</span>
          <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: "#DCFCE7", color: "#166534", fontWeight: 700 }}>✓ {totalVerified} verified</span>
          {totalDisputed > 0 && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: "#FEE2E2", color: "#991B1B", fontWeight: 700 }}>✗ {totalDisputed} disputed</span>
          )}
          {phase === "cached" && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: "#EFF6FF", color: "#1D4ED8", fontWeight: 700 }}>↩ Previous result loaded</span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

        {/* Idle / not yet run */}
        {(phase === "idle") && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 16, padding: "48px 0",
            textAlign: "center",
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: "linear-gradient(135deg, #BE185D22, #7C3AED22)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
                Ready to run AI Analysis
              </div>
              <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, maxWidth: 320 }}>
                The agent will analyse all {detail?.docsTotal || ""} submitted documents for this claim and provide a comprehensive clinical reasoning report.
              </div>
            </div>
          </div>
        )}

        {/* Cached result prompt */}
        {phase === "cached" && result && (
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#EFF6FF", borderRadius: 10, border: "1px solid #BFDBFE", fontSize: 11, color: "#1D4ED8", fontWeight: 600 }}>
            ↩ Showing previous analysis result. Click "Re-run Agent" to refresh.
          </div>
        )}

        {/* Running state */}
        {phase === "running" && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 20, padding: "40px 0",
          }}>
            <Spinner size={36} color="#7C3AED" />
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Running Clinical Analysis…</div>
            <div style={{ fontSize: 11, color: "#64748B", maxWidth: 360, textAlign: "center", lineHeight: 1.6 }}>
              This may take 60–120 seconds. The AI is processing all documents through 15+ specialist engines.
            </div>
            <div style={{
              width: "100%", maxWidth: 440,
              background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0",
              padding: "12px 14px", fontFamily: "monospace",
            }}>
              {runLog.map((l, i) => (
                <div key={i} style={{ fontSize: 10, color: "#374151", marginBottom: 3 }}>
                  <span style={{ color: "#94A3B8" }}>{new Date(l.ts).toLocaleTimeString()}</span> {l.msg}
                </div>
              ))}
              <div style={{ fontSize: 10, color: "#7C3AED", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                <Spinner size={10} color="#7C3AED" /> Processing…
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <div style={{
            padding: "20px", background: "#FEF2F2", borderRadius: 12,
            border: "1px solid #FECACA", marginBottom: 14,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626", marginBottom: 6 }}>Agent Analysis Failed</div>
            <div style={{ fontSize: 11, color: "#991B1B", lineHeight: 1.6 }}>{error}</div>
          </div>
        )}

        {/* Results */}
        {(phase === "done" || phase === "cached") && result && (
          <>
            {/* Insurance decision — most prominent */}
            <InsuranceDecisionPanel data={result.insurance_decision} />

            {/* Scores row */}
            {result.confidence_scores && (
              <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                {Object.entries(result.confidence_scores).map(([k, v]) =>
                  v != null && typeof v === "number"
                    ? <ScoreBadge key={k} score={v} label={k.replace(/_/g, " ")} />
                    : null
                )}
              </div>
            )}

            <VerdictSummaryPanel data={result.verdict_summary} />
            <ClinicalContextPanel ctx={result.clinical_context} />
            <AdequacyPanel data={result.medical_adequacy_results} />
            <SufficiencyPanel data={result.medical_sufficiency_results} />
            <WarningsPanel warnings={result.warnings} />
            <EngineResultsPanel engines={result.engine_specific_results} />
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "14px 20px", background: "#fff",
        borderTop: "1px solid #E2E8F0", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          onClick={onBack}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 10,
            border: "1.5px solid #E2E8F0", background: "#fff",
            color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5"/>
          </svg>
          Back
        </button>

        <div style={{ flex: 1 }} />

        {(phase === "done" || phase === "cached" || phase === "error") && (
          <button
            onClick={runAgent}
            disabled={phase === "running"}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "10px 18px", borderRadius: 10,
              border: "1.5px solid #DDD6FE", background: "#FAF5FF",
              color: "#7C3AED", fontSize: 13, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Re-run Agent
          </button>
        )}

        <button
          onClick={runAgent}
          disabled={phase === "running"}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "12px 28px", borderRadius: 10, border: "none",
            background: phase === "running"
              ? "#E2E8F0"
              : "linear-gradient(135deg, #BE185D, #7C3AED)",
            color: phase === "running" ? "#94A3B8" : "#fff",
            fontSize: 14, fontWeight: 800,
            cursor: phase === "running" ? "not-allowed" : "pointer",
            boxShadow: phase === "running" ? "none" : "0 4px 18px rgba(124,58,237,0.35)",
            transition: "all 0.2s",
          }}
        >
          {phase === "running" ? (
            <><Spinner size={15} color="#94A3B8" /> Running…</>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              {phase === "idle" ? "Run Agent" : "Run Again"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}