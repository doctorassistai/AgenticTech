/**
 * DoctorSoulDashboard.jsx — Complete Redesign v2
 * All sections expandable by default · Enhanced Decision Flow · Full details
 */

import { useState, useEffect, useCallback, useMemo } from "react";

const BASE_URL = "https://doctorassist.ai//api/hms/users/ai-legacy/soul";

function getDoctorId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("doctor_id") || p.get("doctorId") ||
    (window.location.pathname.match(/DOC-[a-f0-9-]+/i) || [])[0] || null;
}

const G = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,600;0,700;1,300&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Open Sans', sans-serif; background: #ffffff; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #ffffff; }
  ::-webkit-scrollbar-thumb { background: #000000; border-radius: 2px; }
  @keyframes spin  { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes fillBar { from { width: 0; } }
  @keyframes drawRing { from { stroke-dasharray: 0 999; } }
  @keyframes slideDown { from { opacity:0; max-height:0; } to { opacity:1; max-height:2000px; } }
  button { cursor: pointer; font-family: inherit; }
  input  { font-family: inherit; }
`;

function Spinner({ size = 32 }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid #000000`,
      borderTopColor: "#ffffff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
  );
}

function Tag({ children, filled }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px",
      background: filled ? "#000000" : "#ffffff",
      color: filled ? "#ffffff" : "#000000",
      border: "1px solid #000000",
      fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
      textTransform: "uppercase", borderRadius: 2, marginRight: 5, marginBottom: 5 }}>
      {children}
    </span>
  );
}

function Pill({ val, label }) {
  const score = Math.round(val || 0);
  return (
    <div style={{ textAlign: "center", padding: "10px 8px" }}>
      <div style={{ fontSize: 28, fontWeight: 300, color: "#ffffff", fontFamily: "monospace", lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Ring({ value, size = 80, strokeW = 5, label }) {
  const r   = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(Math.max(value || 0, 0), 100) / 100;
  const dash = pct * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e0e0e0" strokeWidth={strokeW} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#000000" strokeWidth={strokeW}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ animation: "drawRing 1.2s ease forwards", transition: "stroke-dasharray 1s ease" }} />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: size * 0.2, fontWeight: 600, fill: "#000000", fontFamily: "monospace" }}>
          {Math.round(value || 0)}
        </text>
      </svg>
      {label && <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.09em",
        textTransform: "uppercase", color: "#000000", textAlign: "center", maxWidth: size + 10 }}>{label}</div>}
    </div>
  );
}

function Bar({ label, value, sublabel, bold }) {
  const pct = Math.min(Math.max(value || 0, 0), 100);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "baseline" }}>
        <span style={{ fontSize: 12, fontWeight: bold ? 600 : 400, color: "#000000" }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#000000", fontFamily: "monospace" }}>{Math.round(pct)}</span>
      </div>
      {sublabel && <div style={{ fontSize: 10, color: "#000000", marginBottom: 5 }}>{sublabel}</div>}
      <div style={{ background: "#e0e0e0", height: 4, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#000000",
          borderRadius: 2, animation: "fillBar 1s ease forwards", transition: "width 1s ease" }} />
      </div>
    </div>
  );
}

function Radar({ data, size = 260 }) {
  const keys = Object.keys(data);
  const n = keys.length;
  if (n < 3) return null;
  const cx = size / 2, cy = size / 2;
  const r  = size * 0.34;
  const angle = i => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i, scale) => ({
    x: cx + Math.cos(angle(i)) * r * scale,
    y: cy + Math.sin(angle(i)) * r * scale,
  });
  const gridLines = [0.25, 0.5, 0.75, 1];
  const dataPoints = keys.map((k, i) => pt(i, Math.min(data[k] / 100, 1)));
  const dataPoly = dataPoints.map(p => `${p.x},${p.y}`).join(" ");
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      {gridLines.map(lvl => (
        <polygon key={lvl}
          points={keys.map((_, i) => { const p = pt(i, lvl); return `${p.x},${p.y}`; }).join(" ")}
          fill="none" stroke="#000000" strokeWidth={0.5} strokeOpacity={0.2} />
      ))}
      {keys.map((_, i) => {
        const outer = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#000000" strokeWidth={0.5} strokeOpacity={0.2} />;
      })}
      <polygon points={dataPoly} fill="rgba(0,0,0,0.07)" stroke="#000000" strokeWidth={1.5} />
      {dataPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#000000" />)}
      {keys.map((k, i) => {
        const lp = pt(i, 1.22);
        return (
          <text key={k} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="central"
            style={{ fontSize: 9, fontWeight: 600, fill: "#000000", letterSpacing: "0.08em", fontFamily: "'Open Sans',sans-serif" }}>
            {k.toUpperCase()}
          </text>
        );
      })}
    </svg>
  );
}

function Gauge({ score, size = 180 }) {
  const cx = size / 2, cy = size * 0.68;
  const r  = size * 0.38;
  const circ = Math.PI * r;
  const dash = (Math.min(score || 0, 100) / 100) * circ;
  const label = score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Moderate" : "Developing";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size * 0.65}>
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
          fill="none" stroke="#e0e0e0" strokeWidth={10} strokeLinecap="round" />
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
          fill="none" stroke="#000000" strokeWidth={10} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 1.4s ease" }} />
        {[0, 25, 50, 75, 100].map(v => {
          const a = Math.PI - (v / 100) * Math.PI;
          const x1 = cx + Math.cos(a) * (r - 12);
          const y1 = cy - Math.sin(a) * (r - 12);
          const x2 = cx + Math.cos(a) * (r + 2);
          const y2 = cy - Math.sin(a) * (r + 2);
          return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000000" strokeWidth={1.5} />;
        })}
        <text x={cx} y={cy - 10} textAnchor="middle"
          style={{ fontSize: 32, fontWeight: 300, fill: "#000000", fontFamily: "monospace" }}>
          {Math.round(score || 0)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 600, fill: "#000000", letterSpacing: "0.12em", fontFamily: "'Open Sans',sans-serif" }}>
          {label.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

// ── ENHANCED Decision Flow — HTML-based for readable text ─────────────────
function DecisionFlowEnhanced({ sf, bm, qm, sp }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [hovNode, setHovNode] = useState(null);

  if (!sf || !bm) return null;

  const risk = (sf.risk_profile?.value || "moderate").replace(/_/g, " ");
  const riskConf = sf.risk_profile?.confidence || "low";
  const style_v = (sf.decision_style?.primary || "evidence first").replace(/_/g, " ");
  const styleConf = sf.decision_style?.confidence || "low";
  const inv = sf.diagnostic_rigor?.investigation_intensity || "standard";
  const invRate = bm.investigation_order_rate || 0;
  const noteRate = bm.clinical_note_rate || 0;
  const treat = (sf.treatment_philosophy?.approach || "balanced").replace(/_/g, " ");
  const treatConf = sf.treatment_philosophy?.confidence || "low";
  const docLevel = sf.documentation_quality?.detail_level || "standard";
  const patScore = sf.communication_style?.patient_centered_score || 0;
  const safetyConf = sf.safety_behaviors?.double_check_frequency || "medium";

  const confDot = (conf) => {
    const colors = { high: "#000", medium: "#666", low: "#aaa" };
    return (
      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%",
        background: colors[conf] || "#aaa", marginRight: 5, verticalAlign: "middle" }} />
    );
  };

  const nodes = [
    {
      id: "encounter",
      title: "PATIENT ENCOUNTER",
      category: "entry",
      metrics: [
        { label: "Total Consultations", value: bm.consultation_count || 0 },
        { label: "Unique Patients", value: bm.unique_patients_seen || 0 },
        { label: "Avg Conditions/Visit", value: (bm.avg_conditions_surfaced_per_visit || 0).toFixed(1) },
        { label: "Agentic Sessions", value: bm.agentic_engagement_count || 0 },
      ],
      description: "Every encounter begins here. Real metrics show the doctor's practice volume and patient breadth.",
      tags: [],
    },
    {
      id: "risk",
      title: "RISK ASSESSMENT",
      category: "assessment",
      metrics: [
        { label: "Risk Profile", value: risk },
        { label: "Confidence", value: riskConf },
        { label: "Decision Style", value: style_v },
        { label: "Style Confidence", value: styleConf },
      ],
      description: sf.risk_profile?.evidence || "Risk profile inferred from observed clinical patterns.",
      tags: [risk, style_v],
    },
    {
      id: "investigation",
      title: "INVESTIGATION & DIAGNOSTICS",
      category: "diagnostic",
      metrics: [
        { label: "Order Rate", value: invRate.toFixed(3) },
        { label: "Intensity", value: inv },
        { label: "Escalation", value: sf.diagnostic_rigor?.escalation_pattern || "standard" },
        { label: "Diagnostic QA", value: `${Math.round(qm?.diagnostic_quality_score || 0)}/100` },
        { label: "Investigation QA", value: `${Math.round(qm?.investigation_appropriateness_score || 0)}/100` },
      ],
      description: sf.diagnostic_rigor?.evidence || "Investigation pattern inferred from order rate and note correlation.",
      tags: [inv],
    },
    {
      id: "decision",
      title: "CLINICAL DECISION",
      category: "decision",
      metrics: [
        { label: "Primary Style", value: style_v },
        { label: "Secondary Style", value: sf.decision_style?.secondary || "—" },
        { label: "Guideline Score", value: `${Math.round(qm?.guideline_compliance_score || 0)}/100` },
        { label: "Intervention Threshold", value: sf.treatment_philosophy?.intervention_threshold || "medium" },
      ],
      description: sf.decision_style?.evidence || "Decision style derived from clinical note patterns and investigation ratios.",
      tags: [style_v],
    },
    {
      id: "treatment",
      title: "TREATMENT & PRESCRIBING",
      category: "treatment",
      metrics: [
        { label: "Philosophy", value: treat },
        { label: "Medication Rate", value: (bm.medication_prescription_rate || 0).toFixed(3) },
        { label: "Medication Safety", value: `${Math.round(qm?.medication_safety_score || 0)}/100` },
        { label: "Guideline Align", value: `${Math.round(qm?.guideline_compliance_score || 0)}/100` },
        { label: "Confidence", value: treatConf },
      ],
      description: sf.treatment_philosophy?.evidence || "Treatment philosophy inferred from prescribing patterns and intervention rate.",
      tags: [treat],
    },
    {
      id: "documentation",
      title: "DOCUMENTATION",
      category: "documentation",
      metrics: [
        { label: "Note Rate", value: noteRate.toFixed(3) },
        { label: "Detail Level", value: docLevel },
        { label: "Structure", value: sf.documentation_quality?.structure_preference || "mixed" },
        { label: "Doc QA Score", value: `${Math.round(qm?.documentation_quality_score || 0)}/100` },
      ],
      description: sf.documentation_quality?.evidence || "Documentation style inferred from clinical note rate.",
      tags: [docLevel],
    },
    {
      id: "safety",
      title: "SAFETY BEHAVIORS",
      category: "safety",
      metrics: [
        { label: "Double-Check Freq.", value: safetyConf },
        { label: "Risk Flags", value: (sp?.risk_flags || []).length },
        { label: "Safety Score", value: `${Math.round(qm?.overall_quality_score || 0)}/100` },
        ...(sf.safety_behaviors?.traits || []).map(t => ({ label: "Trait", value: t })),
      ],
      description: sf.safety_behaviors?.evidence || "Safety behaviors inferred from documentation patterns and safety rule compliance.",
      tags: sf.safety_behaviors?.traits || [],
    },
    {
      id: "outcome",
      title: "OUTCOME & FOLLOW-UP",
      category: "outcome",
      metrics: [
        { label: "Outcome QA", value: `${Math.round(qm?.outcome_quality_score || 0)}/100` },
        { label: "Patient-Centered", value: `${Math.round(patScore)}/100` },
        { label: "Conditions Surfaced", value: (bm.avg_conditions_surfaced_per_visit || 0).toFixed(1) + "/visit" },
        { label: "Overall Intelligence", value: "see header" },
      ],
      description: "Final outcome quality measured by conditions surfaced, patient-centered score, and follow-up signals.",
      tags: [],
    },
  ];

  const edges = [
    { from: "encounter", to: "risk", label: "Assessment" },
    { from: "risk", to: "investigation", label: "Diagnostic path" },
    { from: "risk", to: "decision", label: "Clinical judgment" },
    { from: "investigation", to: "treatment", label: "Evidence informs" },
    { from: "decision", to: "treatment", label: "Decides" },
    { from: "treatment", to: "documentation", label: "Record" },
    { from: "treatment", to: "safety", label: "Safety check" },
    { from: "documentation", to: "outcome", label: "Documented" },
    { from: "safety", to: "outcome", label: "Validated" },
  ];

  const catColors = {
    entry: "#000",
    assessment: "#111",
    diagnostic: "#222",
    decision: "#000",
    treatment: "#111",
    documentation: "#222",
    safety: "#000",
    outcome: "#000",
  };

  const selected = nodes.find(n => n.id === selectedNode);

  // Layout: 3 rows
  const layout = [
    ["encounter"],
    ["risk"],
    ["investigation", "decision"],
    ["treatment", "documentation"],
    ["safety", "outcome"],
  ];

  const connectedIds = selectedNode
    ? new Set([
        ...edges.filter(e => e.from === selectedNode).map(e => e.to),
        ...edges.filter(e => e.to === selectedNode).map(e => e.from),
        selectedNode,
      ])
    : null;

  return (
    <div>
      {/* Flow layout */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
        {layout.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 16, justifyContent: "center" }}>
            {row.map(nodeId => {
              const node = nodes.find(n => n.id === nodeId);
              const isSelected = selectedNode === nodeId;
              const isHov = hovNode === nodeId;
              const isDimmed = connectedIds && !connectedIds.has(nodeId);
              const outEdges = edges.filter(e => e.from === nodeId);

              return (
                <div key={nodeId} style={{ flex: row.length > 1 ? 1 : undefined, maxWidth: row.length === 1 ? 480 : undefined, width: row.length === 1 ? "100%" : undefined }}>
                  <div
                    onClick={() => setSelectedNode(selectedNode === nodeId ? null : nodeId)}
                    onMouseEnter={() => setHovNode(nodeId)}
                    onMouseLeave={() => setHovNode(null)}
                    style={{
                      border: `${isSelected ? 2 : 1}px solid #000`,
                      background: isSelected ? "#000" : isHov ? "#f8f8f8" : "#fff",
                      padding: "14px 16px",
                      cursor: "pointer",
                      opacity: isDimmed ? 0.35 : 1,
                      transition: "all 0.2s",
                      position: "relative",
                    }}>
                    {/* Node header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                        color: isSelected ? "#fff" : "#000", textTransform: "uppercase" }}>
                        {node.title}
                      </div>
                      <div style={{ fontSize: 8, fontWeight: 600, color: isSelected ? "rgba(255,255,255,0.5)" : "#888",
                        letterSpacing: "0.08em" }}>
                        {isSelected ? "CLICK TO CLOSE" : "CLICK FOR DETAIL"}
                      </div>
                    </div>

                    {/* Metrics grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                      {node.metrics.slice(0, 4).map((m, i) => (
                        <div key={i} style={{ borderBottom: `1px solid ${isSelected ? "rgba(255,255,255,0.15)" : "#e8e8e8"}`, paddingBottom: 4, marginBottom: 2 }}>
                          <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase",
                            color: isSelected ? "rgba(255,255,255,0.55)" : "#888", marginBottom: 1 }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: isSelected ? "#fff" : "#000",
                            fontFamily: "monospace", textTransform: "capitalize" }}>
                            {String(m.value)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Tags */}
                    {node.tags.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {node.tags.map((t, i) => (
                          <span key={i} style={{
                            padding: "2px 7px", fontSize: 8, fontWeight: 700,
                            letterSpacing: "0.08em", textTransform: "uppercase",
                            border: `1px solid ${isSelected ? "rgba(255,255,255,0.4)" : "#000"}`,
                            color: isSelected ? "#fff" : "#000",
                            background: "transparent",
                          }}>{t}</span>
                        ))}
                      </div>
                    )}

                    {/* Arrow indicator down */}
                    {outEdges.length > 0 && !isSelected && (
                      <div style={{ position: "absolute", bottom: -14, left: "50%", transform: "translateX(-50%)",
                        fontSize: 10, color: "#aaa", zIndex: 1 }}>▼</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{ border: "1.5px solid #000", padding: 24, animation: "fadeIn 0.2s ease", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "#000", marginBottom: 6 }}>{selected.title} — Detail View</div>
              <div style={{ fontSize: 13, fontWeight: 300, color: "#000", lineHeight: 1.7, maxWidth: 600 }}>
                {selected.description}
              </div>
            </div>
            <button onClick={() => setSelectedNode(null)}
              style={{ background: "#000", color: "#fff", border: "none", padding: "6px 14px",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              CLOSE ✕
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
            {selected.metrics.map((m, i) => (
              <div key={i} style={{ padding: "12px 14px", border: "1px solid #000", background: "#fafafa" }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                  color: "#888", marginBottom: 6 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 300, color: "#000", fontFamily: "monospace",
                  textTransform: "capitalize" }}>{String(m.value)}</div>
              </div>
            ))}
          </div>

          {/* Connected nodes */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              color: "#000", marginBottom: 10 }}>Connected Stages</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {edges.filter(e => e.from === selected.id || e.to === selected.id).map((e, i) => {
                const otherId = e.from === selected.id ? e.to : e.from;
                const direction = e.from === selected.id ? "→" : "←";
                const otherNode = nodes.find(n => n.id === otherId);
                return (
                  <div key={i} onClick={() => setSelectedNode(otherId)}
                    style={{ padding: "6px 12px", border: "1px solid #000", cursor: "pointer",
                      background: "#fff", display: "flex", alignItems: "center", gap: 6,
                      fontSize: 10, fontWeight: 600, letterSpacing: "0.05em" }}>
                    <span style={{ color: "#888" }}>{direction}</span>
                    <span>{otherNode?.title}</span>
                    <span style={{ color: "#888", fontSize: 9 }}>({e.label})</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Edge legend */}
      <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: 16, marginTop: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
          color: "#000", marginBottom: 10 }}>Flow Connections</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
          {edges.map((e, i) => (
            <div key={i} style={{ fontSize: 10, fontWeight: 300, color: "#000", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontWeight: 600, fontSize: 9 }}>{nodes.find(n=>n.id===e.from)?.title?.split(" ")[0]}</span>
              <span style={{ color: "#888" }}>→</span>
              <span style={{ fontWeight: 600, fontSize: 9 }}>{nodes.find(n=>n.id===e.to)?.title?.split(" ")[0]}</span>
              <span style={{ color: "#aaa", fontSize: 9 }}>({e.label})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BehaviorHeatmap({ bm }) {
  if (!bm) return null;
  const cells = [
    { label: "Consultations",     value: bm.consultation_count,               max: 100, unit: "" },
    { label: "Unique Patients",   value: bm.unique_patients_seen,             max: 80,  unit: "" },
    { label: "Investigation Rate",value: bm.investigation_order_rate * 100,   max: 100, unit: "%" },
    { label: "Medication Rate",   value: bm.medication_prescription_rate * 100, max: 100, unit: "%" },
    { label: "Clinical Note Rate",value: bm.clinical_note_rate * 100,         max: 100, unit: "%" },
    { label: "Conditions/Visit",  value: bm.avg_conditions_surfaced_per_visit * 20, max: 100, unit: `(${bm.avg_conditions_surfaced_per_visit?.toFixed(1)})` },
    { label: "Agentic Sessions",  value: bm.agentic_engagement_count,         max: 50,  unit: "" },
    { label: "Data Sufficiency",  value: bm.weighted_sufficiency_score,        max: 100, unit: "/100" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#000000" }}>
      {cells.map(c => {
        const pct = Math.min(Math.max((c.value || 0) / c.max * 100, 0), 100);
        const raw = c.label.includes("Rate") ? `${((c.value || 0)).toFixed(0)}%` : Math.round(c.value || 0) + " " + c.unit;
        return (
          <div key={c.label} style={{ background: "#ffffff", padding: "16px 14px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", bottom: 0, left: 0, height: 3,
              width: `${pct}%`, background: "#000000", transition: "width 1.2s ease" }} />
            <div style={{ fontSize: 22, fontWeight: 300, color: "#000000", fontFamily: "monospace", lineHeight: 1 }}>{raw}</div>
            <div style={{ fontSize: 9, fontWeight: 600, color: "#000000", letterSpacing: "0.09em",
              textTransform: "uppercase", marginTop: 5 }}>{c.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function SafetyPipeline({ sp }) {
  const [active, setActive] = useState(null);
  if (!sp) return null;
  const stages = [
    {
      id: "guideline", label: "Guideline Alignment",
      status: sp.guideline_alignment?.confidence || "low",
      detail: (sp.guideline_alignment?.observed_compliant_patterns || []).slice(0,2).join("; ") || "No data",
    },
    {
      id: "medication", label: "Medication Safety",
      status: sp.medication_safety?.confidence || "low",
      detail: (sp.medication_safety?.observed_safe_patterns || []).slice(0,1).join("; ") || "No data",
    },
    {
      id: "diagnostic", label: "Diagnostic Accuracy",
      status: sp.diagnostic_accuracy?.confidence || "low",
      detail: (sp.diagnostic_accuracy?.consistency_observations || []).slice(0,1).join("; ") || "No data",
    },
    {
      id: "outcome", label: "Outcome Quality",
      status: sp.outcome_quality?.confidence || "low",
      detail: (sp.outcome_quality?.positive_signals || []).slice(0,1).join("; ") || "No data",
    },
  ];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginBottom: 20 }}>
        {stages.map((s, i) => (
          <div key={s.id} style={{ display: "flex", flex: 1 }}>
            <div
              onClick={() => setActive(active === s.id ? null : s.id)}
              style={{ flex: 1, padding: "12px 10px", border: `1.5px solid #000000`,
                background: active === s.id ? "#000000" : "#ffffff",
                cursor: "pointer", textAlign: "center", transition: "all 0.2s" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%",
                background: active === s.id ? "#ffffff" : "#000000",
                margin: "0 auto 7px" }} />
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
                color: active === s.id ? "#ffffff" : "#000000" }}>{s.label}</div>
              <div style={{ fontSize: 9, fontWeight: 600,
                color: active === s.id ? "rgba(255,255,255,0.7)" : "#000000",
                textTransform: "uppercase", marginTop: 3 }}>{s.status}</div>
            </div>
            {i < stages.length - 1 && (
              <div style={{ width: 1, background: "#000000" }} />
            )}
          </div>
        ))}
      </div>
      {active && (() => {
        const s = stages.find(s => s.id === active);
        return (
          <div style={{ padding: "14px 16px", background: "#ffffff", border: `1px solid #000000`,
            borderLeft: `3px solid #000000`, animation: "fadeIn 0.2s ease", marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
              textTransform: "uppercase", marginBottom: 6 }}>{s.label} — Detail</div>
            <div style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.7 }}>{s.detail}</div>
          </div>
        );
      })()}
      {(sp.risk_flags || []).length > 0 && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
            color: "#000000", marginBottom: 10 }}>Risk Flags ({sp.risk_flags.length})</div>
          {sp.risk_flags.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 14px", marginBottom: 6,
              border: `1px solid #000000`, background: "#ffffff", borderLeft: `3px solid #000000` }}>
              <div style={{ flexShrink: 0, paddingTop: 2 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#000000" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                  color: "#000000", marginBottom: 3 }}>{(f.category || "").replace(/_/g," ")} · {f.severity}</div>
                <div style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.6 }}>{f.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Expandable section (open by default) ─────────────────────────────────
function Section({ title, subtitle, children, badge, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ border: `1px solid #000000`, background: "#ffffff", marginBottom: 10 }}>
      <div onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", cursor: "pointer", userSelect: "none",
          background: hovered ? "#000000" : "transparent", transition: "background 0.2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: hovered ? "#ffffff" : "#000000",
              letterSpacing: "0.02em", transition: "color 0.2s" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 10, fontWeight: 300,
              color: hovered ? "rgba(255,255,255,0.7)" : "#000000",
              marginTop: 2, transition: "color 0.2s" }}>{subtitle}</div>}
          </div>
          {badge && <Tag>{badge}</Tag>}
        </div>
        <span style={{ fontSize: 11, color: hovered ? "#ffffff" : "#000000", fontWeight: 300,
          transition: "transform 0.2s, color 0.2s",
          transform: open ? "rotate(180deg)" : "none", display: "inline-block" }}>▼</span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid #000000`, padding: "16px 18px", animation: "fadeIn 0.2s ease" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function FRow({ label, value, conf, evidence }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid #e0e0e0` }}>
      <div onClick={() => evidence && setOpen(o => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "9px 0", cursor: evidence ? "pointer" : "default" }}>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.07em", color: "#000000" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 400, color: "#000000",
            textTransform: "capitalize" }}>{(value || "—").replace(/_/g," ")}</span>
          {conf && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 600, color: "#000000" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#000000", flexShrink: 0 }} />
              {conf}
            </span>
          )}
          {evidence && <span style={{ fontSize: 10, color: "#000000" }}>{open ? "▲" : "▼"}</span>}
        </div>
      </div>
      {open && evidence && (
        <div style={{ margin: "0 0 10px", padding: "10px 12px", background: "#f8f8f8",
          fontSize: 11, fontWeight: 300, color: "#000000", lineHeight: 1.7,
          borderLeft: `2px solid #000000`, animation: "fadeIn 0.15s ease" }}>
          {evidence}
        </div>
      )}
    </div>
  );
}

function DirBlock({ label, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
        color: "#000000", marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid #000000` }}>{label}</div>
      {items.map((d, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid #e0e0e0` }}>
          <span style={{ fontSize: 12, color: "#000000", flexShrink: 0 }}>→</span>
          <span style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.6 }}>{d}</span>
        </div>
      ))}
    </div>
  );
}

function TopBar({ data, doctorId, generating, onGenerate }) {
  const ss = data?.soul_scores || {};
  const intel = data?.intelligence_score || {};
  const bm = data?.behavior_metrics || {};
  return (
    <div style={{ background: "#000000", color: "#ffffff", padding: "0 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.15)", paddingTop: 20, paddingBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.2em",
            textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Soul Engine</div>
          <div style={{ fontSize: 22, fontWeight: 300, lineHeight: 1.2, color: "#ffffff" }}>
            {data?.doctor_name || "Doctor Soul Intelligence"}
          </div>
          <div style={{ fontSize: 12, fontWeight: 300, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
            {data?.specialization || "—"} &nbsp;·&nbsp;
            <span style={{ fontFamily: "monospace", fontSize: 11 }}>{doctorId}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {data && (
            <>
              <Pill val={intel.overall_intelligence_score} label="Intelligence" />
              <Pill val={ss.overall_soul_score} label="Soul Score" />
              <Pill val={bm.consultation_count} label="Consultations" />
            </>
          )}
          <button onClick={onGenerate} disabled={generating}
            style={{ padding: "10px 22px", background: "transparent", border: "1px solid rgba(255,255,255,0.4)",
              color: "#ffffff", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em",
              textTransform: "uppercase", opacity: generating ? 0.5 : 1,
              transition: "border-color 0.2s, background 0.2s" }}
            onMouseEnter={e => { if(!generating){ e.currentTarget.style.background="rgba(255,255,255,0.1)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.8)"; }}}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.borderColor="rgba(255,255,255,0.4)"; }}>
            {generating ? "Generating…" : data ? "↻ Regenerate" : "+ Generate Soul"}
          </button>
        </div>
      </div>
      {data && (
        <div style={{ display: "flex", gap: 32, padding: "12px 0", fontSize: 10, fontWeight: 300,
          color: "rgba(255,255,255,0.5)" }}>
          <span>Data: <b style={{ color: "#ffffff", fontWeight: 600 }}>{(data.data_sufficiency || "low").toUpperCase()}</b></span>
          <span>Records: <b style={{ color: "#ffffff", fontWeight: 600 }}>{data.behavioral_record_count || 0}</b></span>
          <span>Generated: <b style={{ color: "#ffffff", fontWeight: 600 }}>
            {data.generated_at ? new Date(data.generated_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : "—"}
          </b></span>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: "overview",   label: "Overview"    },
  { id: "soul",       label: "Behavioral Profile" },
  { id: "quality",    label: "Clinical QA" },
  { id: "flow",       label: "Decision Flow" },
  { id: "directives", label: "Directives" },
  { id: "markdown",   label: "SOUL.md"     },
];

export default function DoctorSoulDashboard() {
  const doctorId = getDoctorId();
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [generating,setGen]       = useState(false);
  const [error,     setError]     = useState(null);
  const [genMsg,    setGenMsg]    = useState(null);
  const [tab,       setTab]       = useState("overview");
  const [copied,    setCopied]    = useState(false);

  const fetchProfile = useCallback(async id => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${BASE_URL}/get/${id}`);
      const json = await res.json();
      if (res.ok && json.status === "success") setData(json.data);
      else if (res.status === 404) { setData(null); setError("No soul profile found. Click Generate to create one."); }
      else setError(json.detail || "Failed to load profile.");
    } catch(e) { setError("Network error: " + e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (doctorId) fetchProfile(doctorId); }, [doctorId, fetchProfile]);

  const generateSoul = async () => {
    if (!doctorId || generating) return;
    setGen(true); setError(null); setGenMsg("Collecting behavioral data…");
    try {
      setGenMsg("Running LLM analysis — takes 20–40 s…");
      const res  = await fetch(`${BASE_URL}/generate/${doctorId}`, { method: "POST" });
      const json = await res.json();
      if (res.status === 422) { setError(json.message + " " + (json.tip || "")); return; }
      if (!res.ok) throw new Error(json.detail || "Generation failed.");
      setGenMsg("Done — loading profile…");
      await fetchProfile(doctorId);
    } catch(e) { setError("Error: " + e.message); }
    finally { setGen(false); setGenMsg(null); }
  };

  const sf    = data?.soul_features      || {};
  const bm    = data?.behavior_metrics   || {};
  const ss    = data?.soul_scores        || {};
  const qm    = data?.quality_metrics    || {};
  const intel = data?.intelligence_score || {};
  const sp    = data?.safety_profile     || {};

  const radarData = useMemo(() => ({
    Evidence:  Math.round(ss.evidence_score         || 0),
    Safety:    Math.round(ss.safety_score           || 0),
    Patient:   Math.round(ss.patient_centered_score || 0),
    Docs:      Math.round(ss.documentation_score    || 0),
    Guideline: Math.round(qm.guideline_compliance_score || 0),
  }), [ss, qm]);

  if (!doctorId) return (
    <>
      <style>{G}</style>
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 12, background: "#ffffff" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#000000", letterSpacing: "0.16em", textTransform: "uppercase" }}>No Doctor ID</div>
        <div style={{ fontSize: 13, fontWeight: 300, color: "#000000" }}>Add ?doctor_id=DOC-xxxx to the URL</div>
      </div>
    </>
  );

  if (loading || generating) return (
    <>
      <style>{G}</style>
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 20, background: "#ffffff" }}>
        <Spinner size={40} />
        <div style={{ fontSize: 11, fontWeight: 300, color: "#000000", letterSpacing: "0.1em" }}>
          {generating ? (genMsg || "GENERATING SOUL PROFILE…") : "LOADING PROFILE…"}
        </div>
        {generating && genMsg && (
          <div style={{ fontSize: 10, fontWeight: 300, color: "#000000", maxWidth: 300, textAlign: "center" }}>{genMsg}</div>
        )}
      </div>
    </>
  );

  return (
    <>
      <style>{G}</style>
      <div style={{ minHeight: "100vh", background: "#ffffff", fontFamily: "'Open Sans',sans-serif" }}>

        <TopBar data={data} doctorId={doctorId} generating={generating} onGenerate={generateSoul} />

        {error && (
          <div style={{ background: "#ffffff", borderBottom: `1px solid #000000`, padding: "12px 32px",
            fontSize: 12, fontWeight: 300, color: "#000000", borderLeft: "4px solid #000000" }}>
            {error}
          </div>
        )}

        {!data && !loading && !error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 16, height: "60vh" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#000000", letterSpacing: "0.16em", textTransform: "uppercase" }}>No Profile</div>
            <div style={{ fontSize: 13, fontWeight: 300, color: "#000000" }}>Click Generate to build this doctor's soul profile.</div>
          </div>
        )}

        {data && (
          <>
            {/* TAB BAR */}
            <div style={{ background: "#ffffff", borderBottom: `1px solid #000000`, padding: "0 32px",
              display: "flex", gap: 0, overflowX: "auto" }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: "14px 20px", fontSize: 11,
                    fontWeight: tab === t.id ? 700 : 400,
                    background: tab === t.id ? "#000000" : "transparent",
                    color: tab === t.id ? "#ffffff" : "#000000",
                    border: "none", letterSpacing: "0.04em", whiteSpace: "nowrap",
                    transition: "all 0.15s" }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* CONTENT */}
            <div style={{ padding: "28px 32px", maxWidth: 1400, margin: "0 auto", animation: "fadeIn 0.3s ease" }}>

              {/* ═══════════════════ OVERVIEW ══════════════════════ */}
              {tab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                  <Section title="Unified Intelligence Score" subtitle="Combined Soul + Clinical QA metric" defaultOpen>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 32, alignItems: "center" }}>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <Gauge score={intel.overall_intelligence_score} size={200} />
                      </div>
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#000000", marginBottom: 16 }}>
                          {[
                            { l: "Soul",       v: intel.soul_score,       w: "40%" },
                            { l: "Guideline",  v: intel.guideline_score,  w: "20%" },
                            { l: "Medication", v: intel.medication_score,  w: "15%" },
                            { l: "Diagnostic", v: intel.diagnostic_score,  w: "15%" },
                            { l: "Outcome",    v: intel.outcome_score,     w: "10%" },
                          ].map(it => (
                            <div key={it.l} style={{ background: "#ffffff", padding: "10px 14px" }}>
                              <div style={{ fontSize: 18, fontWeight: 300, fontFamily: "monospace", color: "#000000" }}>{Math.round(it.v||0)}</div>
                              <div style={{ fontSize: 8, fontWeight: 600, color: "#000000", letterSpacing: "0.08em",
                                textTransform: "uppercase", marginTop: 2 }}>{it.l} · {it.w}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
                          <Bar label="Soul (Behavioral)" value={intel.soul_score} bold />
                          <Bar label="Guideline Compliance" value={intel.guideline_score} />
                          <Bar label="Medication Safety" value={intel.medication_score} />
                          <Bar label="Diagnostic Quality" value={intel.diagnostic_score} />
                          <Bar label="Outcome Quality" value={intel.outcome_score} />
                        </div>
                      </div>
                    </div>
                  </Section>

                  <Section title="Soul Dimensions" subtitle="Radar view across core clinical dimensions" defaultOpen>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 32, alignItems: "center" }}>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <Radar data={radarData} size={240} />
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 24 }}>
                          <Ring value={ss.overall_soul_score} size={72} label="Soul" />
                          <Ring value={qm.overall_quality_score} size={72} label="QA" />
                          <Ring value={intel.overall_intelligence_score} size={72} label="Intelligence" />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                          <Ring value={ss.evidence_score}         size={64} label="Evidence" />
                          <Ring value={ss.safety_score}           size={64} label="Safety" />
                          <Ring value={ss.patient_centered_score} size={64} label="Patient" />
                          <Ring value={ss.documentation_score}    size={64} label="Docs" />
                        </div>
                      </div>
                    </div>
                  </Section>

                  <Section title="Quick Profile Summary" subtitle="At-a-glance clinical attributes" defaultOpen>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 40px" }}>
                      {sf.risk_profile && [
                        { k: "Risk profile",       v: sf.risk_profile?.value },
                        { k: "Decision style",     v: sf.decision_style?.primary },
                        { k: "Intervention",       v: sf.treatment_philosophy?.intervention_threshold },
                        { k: "Investigation",      v: sf.diagnostic_rigor?.investigation_intensity },
                        { k: "Documentation",      v: sf.documentation_quality?.detail_level },
                        { k: "Treatment approach", v: sf.treatment_philosophy?.approach },
                      ].map(({ k, v }) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between",
                          padding: "7px 0", borderBottom: `1px solid #e0e0e0` }}>
                          <span style={{ fontSize: 9, fontWeight: 600, color: "#000000",
                            textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</span>
                          <span style={{ fontSize: 11, fontWeight: 400, color: "#000000",
                            textTransform: "capitalize" }}>{(v||"—").replace(/_/g," ")}</span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section title="Activity Metrics" subtitle="Real observed data from the doctor's practice" defaultOpen>
                    <BehaviorHeatmap bm={bm} />
                  </Section>

                  {data.observed_behavior_report?.key_observations?.length > 0 && (
                    <Section title="Key Behavioral Observations" subtitle="LLM-extracted patterns from clinical activity" defaultOpen>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                        {data.observed_behavior_report.key_observations.map((o, i) => (
                          <div key={i} style={{ padding: "12px 14px", background: "#ffffff", border: `1px solid #000000` }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#000000",
                              fontFamily: "monospace", marginBottom: 6 }}>#{String(i+1).padStart(2,"0")}</div>
                            <div style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.6 }}>{o}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                </div>
              )}

              {/* ═══════════════════ BEHAVIORAL PROFILE ══════════════════ */}
              {tab === "soul" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                  <Section title="Behavioral Features" subtitle="Click any row with evidence to expand it" defaultOpen>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
                      <div>
                        <FRow label="Risk Profile"            value={sf.risk_profile?.value}                        conf={sf.risk_profile?.confidence}           evidence={sf.risk_profile?.evidence} />
                        <FRow label="Decision Style"          value={sf.decision_style?.primary}                    conf={sf.decision_style?.confidence}         evidence={sf.decision_style?.evidence} />
                        <FRow label="Treatment Philosophy"    value={sf.treatment_philosophy?.approach}             conf={sf.treatment_philosophy?.confidence}   evidence={sf.treatment_philosophy?.evidence} />
                        <FRow label="Intervention Threshold"  value={sf.treatment_philosophy?.intervention_threshold} />
                      </div>
                      <div>
                        <FRow label="Investigation Intensity" value={sf.diagnostic_rigor?.investigation_intensity}  conf={sf.diagnostic_rigor?.confidence}       evidence={sf.diagnostic_rigor?.evidence} />
                        <FRow label="Escalation Pattern"      value={sf.diagnostic_rigor?.escalation_pattern} />
                        <FRow label="Documentation Detail"    value={sf.documentation_quality?.detail_level}        conf={sf.documentation_quality?.confidence}  evidence={sf.documentation_quality?.evidence} />
                        <FRow label="Safety Check Freq."      value={sf.safety_behaviors?.double_check_frequency}   conf={sf.safety_behaviors?.confidence}       evidence={sf.safety_behaviors?.evidence} />
                      </div>
                    </div>
                  </Section>

                  <Section title="Core Values" subtitle="What this doctor fundamentally cares about" defaultOpen>
                    <div style={{ marginBottom: 10 }}>
                      {(sf.core_values?.values || []).map((v,i) => <Tag key={i} filled>{v}</Tag>)}
                    </div>
                    {sf.core_values?.evidence && (
                      <div style={{ fontSize: 11, fontWeight: 300, color: "#000000", fontStyle: "italic", lineHeight: 1.7, marginTop: 10 }}>
                        {sf.core_values.evidence}
                      </div>
                    )}
                  </Section>

                  <Section title="Clinical Principles" subtitle="How this doctor approaches clinical decisions" defaultOpen>
                    {(sf.clinical_principles?.principles || []).map((p,i) => (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid #e0e0e0` }}>
                        <span style={{ fontSize: 12, color: "#000000", flexShrink: 0 }}>→</span>
                        <span style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.6 }}>{p}</span>
                      </div>
                    ))}
                  </Section>

                  <Section title="Red Lines" subtitle="Non-negotiables — what this doctor will never compromise on" badge={`${(sf.red_lines?.lines||[]).length} rules`} defaultOpen>
                    {(sf.red_lines?.lines || []).map((l,i) => (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid #e0e0e0` }}>
                        <span style={{ fontSize: 11, color: "#000000", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✕</span>
                        <span style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.6 }}>{l}</span>
                      </div>
                    ))}
                  </Section>

                  {data.priority_order?.ordered_priorities?.length > 0 && (
                    <Section title="Clinical Priority Order" subtitle="When priorities conflict, follow this order" defaultOpen>
                      {data.priority_order.ordered_priorities.map((p,i) => (
                        <div key={i} style={{ display: "flex", gap: 14, alignItems: "center",
                          padding: "8px 0", borderBottom: `1px solid #e0e0e0` }}>
                          <span style={{ width: 24, height: 24, border: `1.5px solid #000000`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 700, flexShrink: 0, color: "#000000" }}>{i+1}</span>
                          <span style={{ fontSize: 12, fontWeight: 300, color: "#000000",
                            textTransform: "capitalize" }}>{p.replace(/_/g," ")}</span>
                        </div>
                      ))}
                      {data.priority_order.conflict_resolution_rule && (
                        <div style={{ marginTop: 12, fontSize: 11, fontWeight: 300, color: "#000000",
                          fontStyle: "italic", lineHeight: 1.6 }}>{data.priority_order.conflict_resolution_rule}</div>
                      )}
                    </Section>
                  )}

                  {data.safety_rules && (
                    <Section title="Safety Rules" subtitle="Hard rules encoded into the AI agent" defaultOpen>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                            textTransform: "uppercase", marginBottom: 10 }}>Never</div>
                          {(data.safety_rules.never || []).map((r,i) => (
                            <div key={i} style={{ fontSize: 11, fontWeight: 300, color: "#000000",
                              padding: "6px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.6 }}>{r}</div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                            textTransform: "uppercase", marginBottom: 10 }}>Always</div>
                          {(data.safety_rules.always || []).map((r,i) => (
                            <div key={i} style={{ fontSize: 11, fontWeight: 300, color: "#000000",
                              padding: "6px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.6 }}>{r}</div>
                          ))}
                        </div>
                      </div>
                    </Section>
                  )}
                </div>
              )}

              {/* ═══════════════════ CLINICAL QA ═════════════════════════ */}
              {tab === "quality" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                  <Section title="Clinical QA Scores" subtitle="Six evidence-based quality dimensions" defaultOpen>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
                      <div>
                        <Bar label="Guideline Compliance"          value={qm.guideline_compliance_score}          sublabel="Evidence-based treatment alignment" bold />
                        <Bar label="Medication Safety"             value={qm.medication_safety_score}             sublabel="Prescribing pattern vs safety band" />
                        <Bar label="Diagnostic Quality"            value={qm.diagnostic_quality_score}            sublabel="Structured note rate as proxy" />
                      </div>
                      <div>
                        <Bar label="Investigation Appropriateness" value={qm.investigation_appropriateness_score} sublabel="Ideal: 0.4–1.0 investigations/consultation" />
                        <Bar label="Documentation Quality"         value={qm.documentation_quality_score}         sublabel="Completeness and reasoning depth" />
                        <Bar label="Outcome Quality"               value={qm.outcome_quality_score}               sublabel="Conditions surfaced per visit" />
                      </div>
                    </div>
                    <div style={{ borderTop: `2px solid #000000`, paddingTop: 14, marginTop: 8 }}>
                      <Bar label="Overall Quality Score" value={qm.overall_quality_score} bold />
                    </div>
                  </Section>

                  <Section title="Safety Assessment Pipeline" subtitle="Click a stage to expand its detail" defaultOpen>
                    <SafetyPipeline sp={sp} />
                  </Section>

                  {sp.guideline_alignment && (
                    <Section title="Guideline Alignment Detail" subtitle="Observed patterns vs evidence-based standards" defaultOpen>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                            textTransform: "uppercase", marginBottom: 8 }}>Compliant Patterns</div>
                          {(sp.guideline_alignment.observed_compliant_patterns || []).map((p,i) => (
                            <div key={i} style={{ fontSize: 12, fontWeight: 300, color: "#000000",
                              padding: "5px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.6 }}>· {p}</div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                            textTransform: "uppercase", marginBottom: 8 }}>Observed Gaps</div>
                          {(sp.guideline_alignment.observed_gaps || []).map((g,i) => (
                            <div key={i} style={{ fontSize: 12, fontWeight: 300, color: "#000000",
                              padding: "5px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.6 }}>· {g}</div>
                          ))}
                        </div>
                      </div>
                      {(sp.guideline_alignment.references || []).length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          {sp.guideline_alignment.references.map(r => <Tag key={r}>{r}</Tag>)}
                        </div>
                      )}
                    </Section>
                  )}

                  <Section title="Medication Safety & Diagnostic" subtitle="Prescribing patterns and diagnosis consistency" defaultOpen>
                    {sp.medication_safety && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                          textTransform: "uppercase", marginBottom: 8 }}>Safe Prescribing Patterns</div>
                        {(sp.medication_safety.observed_safe_patterns || []).map((p,i) => (
                          <div key={i} style={{ fontSize: 12, fontWeight: 300, color: "#000000",
                            padding: "5px 0", borderBottom: `1px solid #e0e0e0` }}>· {p}</div>
                        ))}
                        {(sp.medication_safety.potential_flags || []).length > 0 && (
                          <>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                              textTransform: "uppercase", margin: "14px 0 8px" }}>Potential Flags</div>
                            {sp.medication_safety.potential_flags.map((f,i) => (
                              <div key={i} style={{ fontSize: 12, fontWeight: 300, color: "#000000",
                                padding: "5px 0", borderBottom: `1px solid #e0e0e0` }}>⚠ {f}</div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    {sp.diagnostic_accuracy && (
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                          textTransform: "uppercase", margin: "0 0 8px" }}>Diagnostic Consistency</div>
                        {(sp.diagnostic_accuracy.consistency_observations || []).map((o,i) => (
                          <div key={i} style={{ fontSize: 12, fontWeight: 300, color: "#000000",
                            padding: "5px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.6 }}>· {o}</div>
                        ))}
                        <div style={{ marginTop: 10, fontSize: 11, fontWeight: 400, color: "#000000" }}>
                          Escalation: <b>{sp.diagnostic_accuracy.escalation_appropriateness || "—"}</b>
                        </div>
                      </div>
                    )}
                  </Section>
                </div>
              )}

              {/* ═══════════════════ DECISION FLOW ══════════════════════ */}
              {tab === "flow" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                  <Section title="Clinical Decision Flow" subtitle="Click any stage node to see full detail and navigate connections" defaultOpen>
                    <div style={{ fontSize: 12, fontWeight: 300, color: "#000000", marginBottom: 20, lineHeight: 1.6,
                      padding: "10px 14px", background: "#f8f8f8", borderLeft: "3px solid #000" }}>
                      This flow maps the doctor's full clinical pipeline — from patient encounter to outcome.
                      Each stage shows real metrics from observed activity. Click a node to expand its details
                      and see which stages it connects to. Selecting a node highlights its direct connections.
                    </div>
                    <DecisionFlowEnhanced sf={sf} bm={bm} qm={qm} sp={sp} />
                  </Section>

                  {data.observed_behavior_report?.inferences?.length > 0 && (
                    <Section title="Evidence-Based Inferences" subtitle="Logical conclusions drawn from behavioral pattern analysis" defaultOpen>
                      {data.observed_behavior_report.inferences.map((inf, i) => (
                        <div key={i} style={{ display: "flex", gap: 14, padding: "12px 0",
                          borderBottom: `1px solid #e0e0e0`, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#000000",
                            fontFamily: "monospace", flexShrink: 0, marginTop: 2 }}>INF {String(i+1).padStart(2,"0")}</span>
                          <span style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.7 }}>{inf}</span>
                        </div>
                      ))}
                    </Section>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {sf.communication_style && (
                      <Section title="Communication Style" subtitle="How this doctor interacts with patients" defaultOpen>
                        <div style={{ marginBottom: 12 }}>
                          {(sf.communication_style.traits || []).map((t,i) => <Tag key={i}>{t}</Tag>)}
                        </div>
                        {sf.communication_style.evidence && (
                          <div style={{ fontSize: 12, fontWeight: 300, color: "#000000", fontStyle: "italic", lineHeight: 1.7, marginBottom: 12 }}>
                            {sf.communication_style.evidence}
                          </div>
                        )}
                        <div style={{ padding: "10px 12px", background: "#000000" }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em",
                            textTransform: "uppercase" }}>Patient-Centered Score</div>
                          <div style={{ fontSize: 26, fontWeight: 300, fontFamily: "monospace", color: "#ffffff", marginTop: 4 }}>
                            {Math.round(sf.communication_style.patient_centered_score || 0)}
                            <span style={{ fontSize: 12, fontWeight: 300, color: "rgba(255,255,255,0.5)" }}>/100</span>
                          </div>
                        </div>
                      </Section>
                    )}
                    {sf.safety_behaviors && (
                      <Section title="Safety Behaviors" subtitle="Observed safety and verification patterns" defaultOpen>
                        <div style={{ marginBottom: 12 }}>
                          {(sf.safety_behaviors.traits || []).map((t,i) => <Tag key={i}>{t}</Tag>)}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "#000000",
                          textTransform: "uppercase", letterSpacing: "0.08em" }}>Double-Check Frequency</div>
                        <div style={{ fontSize: 20, fontWeight: 300, color: "#000000", marginTop: 6,
                          textTransform: "capitalize", marginBottom: 12 }}>{sf.safety_behaviors.double_check_frequency || "—"}</div>
                        {sf.safety_behaviors.evidence && (
                          <div style={{ fontSize: 11, fontWeight: 300, color: "#000000", lineHeight: 1.7,
                            fontStyle: "italic" }}>{sf.safety_behaviors.evidence}</div>
                        )}
                      </Section>
                    )}
                  </div>
                </div>
              )}

              {/* ═══════════════════ AI DIRECTIVES ══════════════════════ */}
              {tab === "directives" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                  <Section title="AI Behavior Directives" subtitle="Injected before SKILL.md — shapes HOW the AI reasons, not what it knows" defaultOpen>
                    <div style={{ fontSize: 12, fontWeight: 300, color: "#000000", lineHeight: 1.7, marginBottom: 20,
                      padding: "10px 14px", background: "#f8f8f8", borderLeft: "3px solid #000" }}>
                      These directives are injected before SKILL.md and patient context in the doctor agent system prompt.
                      They encode the doctor's clinical style into the AI so it reasons the way this doctor would.
                    </div>
                    {data.ai_behavior_directives && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                        <div>
                          <DirBlock label="Diagnostic"    items={data.ai_behavior_directives.diagnostic} />
                          <DirBlock label="Treatment"     items={data.ai_behavior_directives.treatment} />
                        </div>
                        <div>
                          <DirBlock label="Communication" items={data.ai_behavior_directives.communication} />
                          <DirBlock label="Documentation" items={data.ai_behavior_directives.documentation} />
                        </div>
                      </div>
                    )}
                  </Section>

                  {data.safety_rules && (
                    <Section title="Runtime Safety Rules" subtitle="Hard constraints enforced at every AI inference step" defaultOpen>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                            textTransform: "uppercase", marginBottom: 10 }}>Never</div>
                          {(data.safety_rules.never || []).map((r,i) => (
                            <div key={i} style={{ fontSize: 11, fontWeight: 300, color: "#000000",
                              padding: "6px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.5 }}>{r}</div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "#000000", letterSpacing: "0.1em",
                            textTransform: "uppercase", marginBottom: 10 }}>Always</div>
                          {(data.safety_rules.always || []).map((r,i) => (
                            <div key={i} style={{ fontSize: 11, fontWeight: 300, color: "#000000",
                              padding: "6px 0", borderBottom: `1px solid #e0e0e0`, lineHeight: 1.5 }}>{r}</div>
                          ))}
                        </div>
                      </div>
                    </Section>
                  )}

                  {sp.safety_md && (
                    <Section title="SAFETY.md Preview" subtitle="Runtime safety profile injected alongside SOUL.md" defaultOpen>
                      <div style={{ maxHeight: 400, overflow: "auto", border: `1px solid #000000` }}>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, fontWeight: 300,
                          color: "#000000", lineHeight: 1.7, padding: 16, margin: 0, fontFamily: "inherit" }}>
                          {sp.safety_md}
                        </pre>
                      </div>
                    </Section>
                  )}
                </div>
              )}

              {/* ═══════════════════ SOUL.MD ═════════════════════════ */}
              {tab === "markdown" && (
                <div style={{ background: "#ffffff", border: `1px solid #000000` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "16px 24px", borderBottom: `1px solid #000000` }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#000000" }}>SOUL.md — Full Doctor Profile</div>
                      <div style={{ fontSize: 11, fontWeight: 300, color: "#000000", marginTop: 3 }}>
                        Inject this before SKILL.md and patient context in the agent system prompt
                      </div>
                    </div>
                    <button onClick={() => { navigator.clipboard?.writeText(data.soul_markdown || ""); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      style={{ padding: "9px 20px",
                        background: copied ? "#000000" : "#ffffff",
                        color: copied ? "#ffffff" : "#000000",
                        border: `1px solid #000000`, fontSize: 10, fontWeight: 600,
                        letterSpacing: "0.1em", textTransform: "uppercase", transition: "all 0.2s" }}>
                      {copied ? "Copied ✓" : "Copy to Clipboard"}
                    </button>
                  </div>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12,
                    fontWeight: 300, color: "#000000", lineHeight: 1.8, padding: 28,
                    background: "#ffffff", margin: 0, maxHeight: "70vh", overflowY: "auto" }}>
                    {data.soul_markdown || "No content."}
                  </pre>
                </div>
              )}

            </div>
          </>
        )}
      </div>
    </>
  );
}