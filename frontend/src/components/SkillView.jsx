/**
 * ClinicalGraphViewer_v2.jsx
 * ─────────────────────────────────────────────────────────
 * Clinical Knowledge Graph — API-driven, Doctor-centric
 * Black & White · Open Sans Light · No hardcoded data
 *
 * Right panel now has 3 sub-tabs:
 *   Flags    — impact flags (unchanged)
 *   Pending  — skill candidates (confirm / reject)
 *   My Skills — confirmed doctor skills
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── CONSTANTS ────────────────────────────────────────────
const TYPE_COLORS = {
  Condition:   "#0a0a0a",
  Abnormality: "#555",
  Decision:    "#888",
  Finding:     "#bbb",
  Outcome:     "#ccc",
};

const RELATION_COLORS = {
  TRIGGERS_DECISION: "#0a0a0a",
  INFLUENCES:        "#555",
  LEADS_TO:          "#888",
  INDICATES:         "#444",
  ASSOCIATED_WITH:   "#777",
  CONTRAINDICATION:  "#c00",
  CONTRADICTS:       "#c00",
  HAS_FINDING:       "#999",
  REWORK_OF:         "#333",
};

const SEV_COLORS = {
  critical: { bg: "#fee2e2", text: "#991b1b", dot: "#c00" },
  high:     { bg: "#fef3c7", text: "#92400e", dot: "#c06000" },
  moderate: { bg: "#fefce8", text: "#713f12", dot: "#a37500" },
  low:      { bg: "#f5f5f5", text: "#555",    dot: "#bbb" },
};

const TYPE_LAYOUT = {
  Condition:   { cx: 0.50, cy: 0.26 },
  Abnormality: { cx: 0.20, cy: 0.62 },
  Decision:    { cx: 0.80, cy: 0.62 },
  Finding:     { cx: 0.50, cy: 0.88 },
  Outcome:     { cx: 0.50, cy: 0.75 },
};

const CANVAS_W = 960;
const CANVAS_H = 720;

// ─── HELPERS ──────────────────────────────────────────────
function nodeColor(node) {
  const sig = node.all_attrs?.clinical_significance || node.severity;
  if (node.node_type === "Abnormality") {
    if (sig === "critical") return "#c00";
    if (sig === "high")     return "#c06000";
    if (sig === "moderate") return "#555";
    return "#bbb";
  }
  return TYPE_COLORS[node.node_type] || "#aaa";
}

function nodeRadius(node) {
  const base = { Condition: 26, Decision: 22, Abnormality: 20, Finding: 16, Outcome: 14 };
  return (base[node.node_type] || 16) + Math.min((node.occurrence_count || 1) * 1.5, 8);
}

function computePositions(nodes) {
  const groups = {};
  nodes.forEach(n => {
    if (!groups[n.node_type]) groups[n.node_type] = [];
    groups[n.node_type].push(n);
  });
  const pos = {};
  Object.entries(groups).forEach(([type, grp]) => {
    const layout = TYPE_LAYOUT[type] || { cx: 0.5, cy: 0.5 };
    const cx = layout.cx * CANVAS_W;
    const cy = layout.cy * CANVAS_H;
    const count  = grp.length;
    const radius = Math.max(80, Math.min(count * 22, 200));
    grp.forEach((n, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      pos[n.label] = {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    });
  });
  return pos;
}

function truncate(str, len = 14) {
  return str && str.length > len ? str.slice(0, len - 1) + "…" : str;
}

// ─── FONTS ────────────────────────────────────────────────
const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  * { font-family: 'Open Sans', sans-serif; box-sizing: border-box; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #f5f5f5; }
  ::-webkit-scrollbar-thumb { background: #ccc; }
`;

// ─── LOADING SKELETON ─────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ display: "flex", height: "100vh", background: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "2px solid #0a0a0a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 12, fontWeight: 300, color: "#888", letterSpacing: "0.1em" }}>LOADING GRAPH…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── ERROR STATE ──────────────────────────────────────────
function ErrorState({ message, onRetry }) {
  return (
    <div style={{ display: "flex", height: "100vh", background: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#c00", letterSpacing: "0.14em", textTransform: "uppercase" }}>Error Loading Graph</div>
      <div style={{ fontSize: 12, fontWeight: 300, color: "#555", maxWidth: 320, textAlign: "center" }}>{message}</div>
      <button onClick={onRetry} style={{ marginTop: 8, padding: "7px 20px", border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
        Retry
      </button>
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────
function StatCard({ value, label, accent }) {
  return (
    <div style={{ padding: "10px 14px", background: "#fafafa", borderRight: "1px solid #e8e8e8" }}>
      <div style={{ fontSize: 22, fontWeight: 300, color: accent || "#0a0a0a", lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ─── SEV BADGE ────────────────────────────────────────────
function SevBadge({ sev }) {
  const s = SEV_COLORS[sev] || SEV_COLORS.low;
  return (
    <span style={{ display: "inline-block", padding: "2px 7px", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: s.bg, color: s.text }}>
      {sev}
    </span>
  );
}

// ─── NODE DETAIL ──────────────────────────────────────────
function NodeDetail({ node, edges, onSelectNode }) {
  if (!node) {
    return (
      <div style={{ padding: "28px 16px", textAlign: "center", color: "#bbb", fontSize: 11, fontWeight: 300 }}>
        Click any node to inspect
      </div>
    );
  }

  const a = node.all_attrs || {};
  const color = nodeColor(node);
  const connected = (edges || []).filter(e => e.from_label === node.label || e.to_label === node.label);

  return (
    <div>
      <div style={{ background: color, padding: "14px 16px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 3 }}>{node.label}</div>
        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>
          {node.node_type} · {node.occurrence_count || 1}×
        </div>
      </div>
      <div style={{ padding: "8px 16px 10px" }}>
        {(a.clinical_significance || node.severity) && (
          <AttrRow k="Severity"><SevBadge sev={a.clinical_significance || node.severity} /></AttrRow>
        )}
        {a.direction && <AttrRow k="Direction">{a.direction}</AttrRow>}
        {(a.value && a.value !== "null") && <AttrRow k="Value">{a.value}{a.unit ? ` ${a.unit}` : ""}</AttrRow>}
        {a.normal_range && <AttrRow k="Normal">{a.normal_range}</AttrRow>}
        {a.action_type && <AttrRow k="Action">{a.action_type}</AttrRow>}
        {a.urgency && <AttrRow k="Urgency">{a.urgency}</AttrRow>}
        {(a.explanation || node.explanation) && (
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 300, color: "#555", lineHeight: 1.6, background: "#f8f8f8", padding: "8px 10px" }}>
            {a.explanation || node.explanation}
          </div>
        )}
      </div>
      {connected.length > 0 && (
        <div style={{ borderTop: "1px solid #efefef" }}>
          <div style={{ padding: "8px 16px 4px", fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#aaa" }}>
            Connections ({connected.length})
          </div>
          {connected.slice(0, 8).map((e, i) => {
            const other  = e.from_label === node.label ? e.to_label : e.from_label;
            const dir    = e.from_label === node.label ? "→" : "←";
            const rel    = e.relation || "";
            const relCol = RELATION_COLORS[rel] || "#888";
            return (
              <div
                key={i}
                onClick={() => onSelectNode(other)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 16px", borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                onMouseEnter={ev => ev.currentTarget.style.background = "#f8f8f8"}
                onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                  <span style={{ color: "#aaa", fontSize: 11 }}>{dir}</span>
                  <span style={{ fontSize: 11, fontWeight: 300, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{other}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 8, fontWeight: 600, color: relCol, letterSpacing: "0.05em", textTransform: "uppercase" }}>{rel.replace(/_/g, " ")}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#aaa" }}>{Math.round((e.weight || 0) * 100)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttrRow({ k, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #f5f5f5" }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "#aaa", flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 300, color: "#111", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </div>
  );
}

// ─── GRAPH CANVAS ─────────────────────────────────────────
function GraphCanvas({ nodes, edges, selectedNode, onSelectNode }) {
  const svgRef = useRef(null);
  const [zoom, setZoom]         = useState(1);
  const [pan, setPan]           = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [tooltip, setTooltip]   = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const positions = useMemo(() => computePositions(nodes), [nodes]);

  const onWheel = useCallback(e => {
    e.preventDefault();
    setZoom(z => Math.max(0.25, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const onMouseDown = e => {
    if (e.target.closest(".ng")) return;
    setDragging(true);
    setDragStart({ mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y });
  };
  const onMouseMove = e => {
    if (!dragging || !dragStart) return;
    setPan({ x: dragStart.px + (e.clientX - dragStart.mx), y: dragStart.py + (e.clientY - dragStart.my) });
  };
  const onMouseUp = () => { setDragging(false); setDragStart(null); };

  function renderEdges() {
    return (edges || []).map((edge, i) => {
      const p1 = positions[edge.from_label];
      const p2 = positions[edge.to_label];
      if (!p1 || !p2) return null;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const curve = Math.min(dist * 0.22, 55);
      const mx = (p1.x + p2.x) / 2 - (dy / dist) * curve;
      const my = (p1.y + p2.y) / 2 + (dx / dist) * curve;
      const isContra  = edge.relation === "CONTRAINDICATION" || edge.relation === "CONTRADICTS";
      const isHeavy   = (edge.weight || 0) >= 0.75;
      const strokeC   = isContra ? "#c00" : (isHeavy ? "#222" : "#ccc");
      const strokeW   = 0.5 + (edge.weight || 0.5) * 1.5;
      const isSelected = selectedNode && (edge.from_label === selectedNode || edge.to_label === selectedNode);
      const opacity   = selectedNode
        ? (isSelected ? 0.92 : 0.05)
        : (isHeavy ? 0.55 : 0.28);
      const lx = (p1.x + mx * 2 + p2.x) / 4;
      const ly = (p1.y + my * 2 + p2.y) / 4 - 5;

      return (
        <g key={i}>
          <path
            d={`M${p1.x} ${p1.y} Q${mx} ${my} ${p2.x} ${p2.y}`}
            fill="none" stroke={strokeC} strokeWidth={strokeW} strokeOpacity={opacity}
            markerEnd={`url(#arr-${isContra ? "red" : isHeavy ? "dark" : "gray"})`}
            style={{ cursor: "pointer" }}
            onMouseEnter={ev => {
              const rect = svgRef.current?.getBoundingClientRect();
              setTooltip({ type: "edge", edge });
              setTooltipPos({ x: ev.clientX - (rect?.left || 0) + 10, y: ev.clientY - (rect?.top || 0) + 10 });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
          {isSelected && (
            <text x={lx} y={ly} textAnchor="middle" fontSize={7} fontFamily="'Open Sans',sans-serif" fontWeight={600} fill={strokeC} opacity={0.7} pointerEvents="none">
              {(edge.relation || "").replace(/_/g, " ")}
            </text>
          )}
        </g>
      );
    });
  }

  function renderNodes() {
    return (nodes || []).map(node => {
      const p = positions[node.label];
      if (!p) return null;
      const r = nodeRadius(node);
      const col = nodeColor(node);
      const isSelected = node.label === selectedNode;
      const sig = node.all_attrs?.clinical_significance || node.severity;
      const isCritical = sig === "critical" || sig === "high";

      return (
        <g
          key={node.label}
          className="ng"
          transform={`translate(${p.x},${p.y})`}
          style={{ cursor: "pointer" }}
          onClick={() => onSelectNode(node.label === selectedNode ? null : node.label)}
          onMouseEnter={ev => {
            const rect = svgRef.current?.getBoundingClientRect();
            setTooltip({ type: "node", node });
            setTooltipPos({ x: ev.clientX - (rect?.left || 0) + 12, y: ev.clientY - (rect?.top || 0) + 8 });
          }}
          onMouseLeave={() => setTooltip(null)}
        >
          {isSelected && <circle r={r + 6} fill="none" stroke={col} strokeWidth={1} strokeDasharray="3 2" opacity={0.45} />}
          <circle r={r} fill={isSelected ? col : "#fff"} stroke={col} strokeWidth={isSelected ? 0 : 1.5} />
          {isCritical && (
            <circle cx={r * 0.6} cy={-r * 0.6} r={4}
              fill={sig === "critical" ? "#c00" : "#c06000"}
              stroke="#fff" strokeWidth={1.5} />
          )}
          <text textAnchor="middle" dominantBaseline="central" fontSize={r > 22 ? 9 : 8} fontWeight={600}
            fontFamily="'Open Sans',sans-serif" fill={isSelected ? "#fff" : col} pointerEvents="none">
            {truncate(node.label, r > 22 ? 15 : 12)}
          </text>
        </g>
      );
    });
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#fff" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ width: "100%", height: "100%", cursor: dragging ? "grabbing" : "grab", userSelect: "none" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      >
        <defs>
          {[["gray","#ccc"],["dark","#333"],["red","#c00"]].map(([id, sc]) => (
            <marker key={id} id={`arr-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M1 2L8 5L1 8" fill="none" stroke={sc} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {renderEdges()}
          {renderNodes()}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position: "absolute", left: tooltipPos.x, top: tooltipPos.y, background: "#111", color: "#fff", padding: "8px 12px", fontSize: 11, fontFamily: "'Open Sans',sans-serif", fontWeight: 300, pointerEvents: "none", zIndex: 50, maxWidth: 260, lineHeight: 1.5 }}>
          {tooltip.type === "node" ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltip.node.label}</div>
              <div style={{ color: "#aaa" }}>
                {tooltip.node.node_type} · {tooltip.node.all_attrs?.clinical_significance || tooltip.node.severity || "—"}
                {tooltip.node.all_attrs?.value && tooltip.node.all_attrs.value !== "null"
                  ? ` · ${tooltip.node.all_attrs.value}${tooltip.node.all_attrs.unit ? " " + tooltip.node.all_attrs.unit : ""}`
                  : ""}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltip.edge.from_label} → {tooltip.edge.to_label}</div>
              <div style={{ color: "#aaa" }}>{(tooltip.edge.relation || "").replace(/_/g, " ")} · {Math.round((tooltip.edge.weight || 0) * 100)}%</div>
            </>
          )}
        </div>
      )}

      {/* Zoom controls */}
      <div style={{ position: "absolute", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 4 }}>
        {[{ l: "+", fn: () => setZoom(z => Math.min(z * 1.2, 5)) },
          { l: "−", fn: () => setZoom(z => Math.max(z * 0.8, 0.25)) },
          { l: "⊙", fn: () => { setZoom(1); setPan({ x: 0, y: 0 }); } }].map(b => (
          <button key={b.l} onClick={b.fn} style={{
            width: 30, height: 30, border: "1px solid #0a0a0a", background: "#fff",
            cursor: "pointer", fontSize: b.l === "⊙" ? 13 : 16, fontFamily: "'Open Sans',sans-serif",
            fontWeight: 300, color: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center",
          }}>{b.l}</button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ position: "absolute", bottom: 16, left: 16, background: "rgba(255,255,255,0.95)", border: "1px solid #e8e8e8", padding: "8px 12px", fontSize: 9, fontFamily: "'Open Sans',sans-serif", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888" }}>
        {[
          { label: "Condition",        color: "#0a0a0a", circle: true },
          { label: "Abnormality",      color: "#555",    circle: true },
          { label: "Decision",         color: "#888",    circle: true },
          { label: "Finding",          color: "#bbb",    circle: true },
          { label: "Contraindication", color: "#c00",    circle: false },
        ].map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: item.circle ? 8 : 16, height: item.circle ? 8 : 1.5, background: item.color, borderRadius: item.circle ? "50%" : 0, flexShrink: 0 }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MATRIX VIEW ──────────────────────────────────────────
function MatrixView({ nodes, edges, onSelectNode }) {
  const [tooltip, setTooltip]       = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const matrixNodes = useMemo(() => {
    const inEdges = new Set();
    (edges || []).forEach(e => { inEdges.add(e.from_label); inEdges.add(e.to_label); });
    return (nodes || []).filter(n => inEdges.has(n.label)).slice(0, 24);
  }, [nodes, edges]);

  const edgeMap = useMemo(() => {
    const m = {};
    (edges || []).forEach(e => { m[`${e.from_label}||${e.to_label}`] = e; });
    return m;
  }, [edges]);

  const cellSize = Math.floor(Math.min(32, 560 / Math.max(matrixNodes.length, 1)));
  const labelW = 150, labelH = 90;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "auto", padding: "16px 12px", background: "#fff" }}>
      <svg width={labelW + matrixNodes.length * cellSize + 10} height={labelH + matrixNodes.length * cellSize + 10}>
        {matrixNodes.map((n, j) => (
          <text key={`ch-${j}`}
            x={labelW + j * cellSize + cellSize / 2} y={labelH - 6}
            textAnchor="end" fontSize={8} fontFamily="'Open Sans',sans-serif" fontWeight={600}
            fill={nodeColor(n)} transform={`rotate(-55,${labelW + j * cellSize + cellSize / 2},${labelH - 6})`}
            style={{ cursor: "pointer" }} onClick={() => onSelectNode(n.label)}>
            {truncate(n.label, 15)}
          </text>
        ))}
        {matrixNodes.map((rowNode, i) => (
          <g key={`row-${i}`}>
            <text x={labelW - 6} y={labelH + i * cellSize + cellSize / 2}
              textAnchor="end" dominantBaseline="central" fontSize={8}
              fontFamily="'Open Sans',sans-serif" fontWeight={600}
              fill={nodeColor(rowNode)} style={{ cursor: "pointer" }} onClick={() => onSelectNode(rowNode.label)}>
              {truncate(rowNode.label, 18)}
            </text>
            {matrixNodes.map((colNode, j) => {
              const edge   = edgeMap[`${rowNode.label}||${colNode.label}`];
              const isDiag = i === j;
              const w      = edge?.weight || 0;
              const fill   = isDiag
                ? "#e8e8e8"
                : edge
                  ? `rgb(${Math.round(255*(1-w))},${Math.round(255*(1-w))},${Math.round(255*(1-w))})`
                  : "#f8f8f8";
              return (
                <rect key={`cell-${j}`}
                  x={labelW + j * cellSize} y={labelH + i * cellSize}
                  width={cellSize - 1} height={cellSize - 1} rx={1}
                  fill={fill} stroke="#efefef" strokeWidth={0.5}
                  style={{ cursor: edge ? "pointer" : "default" }}
                  onMouseEnter={ev => {
                    if (edge) {
                      const rect = containerRef.current?.getBoundingClientRect();
                      setTooltip(edge);
                      setTooltipPos({ x: ev.clientX - (rect?.left || 0) + 8, y: ev.clientY - (rect?.top || 0) + 8 });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => edge && onSelectNode(rowNode.label)}
                />
              );
            })}
          </g>
        ))}
      </svg>

      {tooltip && (
        <div style={{ position: "absolute", left: tooltipPos.x, top: tooltipPos.y, background: "#111", color: "#fff", padding: "8px 12px", fontSize: 11, fontFamily: "'Open Sans',sans-serif", fontWeight: 300, pointerEvents: "none", zIndex: 50 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltip.from_label} → {tooltip.to_label}</div>
          <div style={{ color: "#aaa" }}>{(tooltip.relation || "").replace(/_/g, " ")} · {Math.round((tooltip.weight || 0) * 100)}%</div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#aaa" }}>Weight</div>
        <div style={{ width: 120, height: 10, background: "linear-gradient(to right, #f0f0f0, #111)", border: "1px solid #e8e8e8" }} />
        <div style={{ fontSize: 9, color: "#aaa" }}>Low → High</div>
      </div>
    </div>
  );
}

// ─── CHAIN ITEM ───────────────────────────────────────────
function ChainItem({ chain, onSelect }) {
  const urgencyColors = { urgent: "#c00", high: "#c06000", moderate: "#8a7500" };
  const condition = chain.condition || chain.condition_label || "";
  const decision  = chain.decision  || chain.decision_label  || "";
  const urgency   = chain.urgency   || "";
  const prob      = chain.probability || 0;
  const outcome   = chain.expected_outcome || "";
  const count     = chain.occurrence_count || chain.count || 1;

  return (
    <div
      onClick={() => onSelect(condition)}
      style={{ padding: "10px 14px", borderBottom: "1px solid #efefef", cursor: "pointer" }}
      onMouseEnter={e => e.currentTarget.style.background = "#f8f8f8"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#111", background: "#f0f0f0", padding: "2px 7px" }}>{condition}</span>
        <span style={{ fontSize: 10, color: "#aaa" }}>→</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#555", background: "#f8f8f8", padding: "2px 7px" }}>{decision}</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: "#888" }}>P = {Math.round(prob * 100)}%</span>
        <span style={{ fontSize: 9, fontWeight: 600, color: "#888" }}>{count}× observed</span>
        {urgency && <span style={{ fontSize: 9, fontWeight: 600, color: urgencyColors[urgency] || "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>{urgency}</span>}
      </div>
      {outcome && <div style={{ fontSize: 9, color: "#aaa", marginTop: 3, fontStyle: "italic" }}>→ {outcome}</div>}
    </div>
  );
}

// ─── FLAG ITEM ────────────────────────────────────────────
function FlagItem({ flag }) {
  const sev = flag.severity || "low";
  const col = SEV_COLORS[sev] || SEV_COLORS.low;
  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid #efefef" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: col.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>
          {(flag.flag_type || "").replace(/_/g, " ")}
        </span>
        <SevBadge sev={sev} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 300, color: "#111", lineHeight: 1.5, marginBottom: 4 }}>{flag.description}</div>
      {flag.recommendation && (
        <div style={{ fontSize: 10, fontWeight: 300, color: "#666", fontStyle: "italic", lineHeight: 1.4 }}>↗ {flag.recommendation}</div>
      )}
      {(flag.entity_involved || flag.decision_involved) && (
        <div style={{ marginTop: 5, fontSize: 9, color: "#aaa", fontWeight: 600, letterSpacing: "0.06em" }}>
          {flag.entity_involved}{flag.decision_involved ? ` → ${flag.decision_involved}` : ""}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────
export default function ClinicalGraphViewer({ apiBase = "", fetchFn }) {
  const doctorId = new URLSearchParams(window.location.search).get("doctor_id");

  const _fetch = fetchFn || window.fetch.bind(window);

  // ── Graph state ──────────────────────────────────────────
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // ── Left sidebar state ───────────────────────────────────
  const [tab, setTab]               = useState("nodes"); // nodes | edges | chains
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQ, setSearchQ]       = useState("");

  // ── Canvas state ─────────────────────────────────────────
  const [view, setView]             = useState("graph"); // graph | matrix
  const [selectedNode, setSelectedNode] = useState(null);

  // ── Right panel: skills state ─────────────────────────────
  const [skillsTab, setSkillsTab]               = useState("flags"); // flags | pending | skills
  const [skillCandidates, setSkillCandidates]   = useState([]);
  const [confirmedSkills, setConfirmedSkills]   = useState([]);
  const [skillsLoading, setSkillsLoading]       = useState(false);
  const [skillAction, setSkillAction]           = useState(null); // { id, type: "confirm"|"reject" }

  // ── Fetch graph ──────────────────────────────────────────
  const loadGraph = useCallback(async () => {
    if (!doctorId) {
      setError("No doctorId provided.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `${apiBase}api/hms/users/ai-legacy/graph/query/full-graph/${doctorId}`;

      const res = await _fetch(url);

      console.log("Response Status:", res.status);
      console.log("Response OK:", res.ok);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();

      // raw backend response
      console.log("Raw Graph Response:");
      console.log(text);

      let json;

      try {
        json = JSON.parse(text);

        console.log("Parsed JSON:", json);
        console.log("Nodes:", json.nodes);
        console.log("Edges:", json.edges);

      } catch (e) {
        console.error("JSON Parse Error:", e);
        throw new Error("Backend did not return valid JSON");
      }

      setData(normalizeApiResponse(json));

    } catch (err) {

      console.error("Graph Fetch Error:", err);

      setError(err.message || "Failed to load graph.");

    } finally {

      setLoading(false);

    }
  }, [doctorId, apiBase]);

  // ── Fetch skills ─────────────────────────────────────────
  const loadSkills = useCallback(async () => {
    if (!doctorId) return;
    setSkillsLoading(true);
    try {
      const [candRes, confRes] = await Promise.all([
        _fetch(`${apiBase}api/hms/users/ai-legacy/graph/skills/candidates/${doctorId}`),
        _fetch(`${apiBase}api/hms/users/ai-legacy/graph/skills/${doctorId}`),
      ]);
      if (candRes.ok) {
        const d = await candRes.json();
        setSkillCandidates(d.pending_candidates || []);
      }
      if (confRes.ok) {
        const d = await confRes.json();
        setConfirmedSkills(d.skills || []);
      }
    } catch (e) {
      console.error("Skills load failed:", e);
    } finally {
      setSkillsLoading(false);
    }
  }, [doctorId, apiBase]);

  useEffect(() => { loadGraph(); loadSkills(); }, [loadGraph, loadSkills]);

  // ── Skill confirm ─────────────────────────────────────────
  const handleConfirmSkill = async (candidateId) => {
    setSkillAction({ id: candidateId, type: "confirm" });
    try {
      const res = await _fetch(
        `${apiBase}api/hms/users/ai-legacy/graph/skills/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidate_id: candidateId, doctor_id: doctorId }),
        }
      );
      if (res.ok) {
        setSkillCandidates(prev => prev.filter(c => c.candidate_id !== candidateId));
        loadSkills();
      }
    } catch (e) {
      console.error("Confirm failed:", e);
    } finally {
      setSkillAction(null);
    }
  };

  // ── Skill reject ──────────────────────────────────────────
  const handleRejectSkill = async (candidateId) => {
    setSkillAction({ id: candidateId, type: "reject" });
    try {
      const res = await _fetch(
        `${apiBase}api/hms/users/ai-legacy/graph/skills/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidate_id: candidateId, doctor_id: doctorId }),
        }
      );
      if (res.ok) {
        setSkillCandidates(prev => prev.filter(c => c.candidate_id !== candidateId));
      }
    } catch (e) {
      console.error("Reject failed:", e);
    } finally {
      setSkillAction(null);
    }
  };

  // ── Derived data ──────────────────────────────────────────
  const { nodes = [], edges = [], decision_chains = [], impact_flags = [], abnormalities = [], stats = {} } = data || {};

  const uniqueNodes = useMemo(() => {
    const seen = new Set();
    return (nodes || []).filter(n => { if (seen.has(n.label)) return false; seen.add(n.label); return true; });
  }, [nodes]);

  const uniqueFlags = useMemo(() => {
    const seen = new Set();
    return (impact_flags || []).filter(f => {
      const k = f.flag_id || f.description;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }, [impact_flags]);

  const nodeTypes = useMemo(() => [...new Set(uniqueNodes.map(n => n.node_type))], [uniqueNodes]);

  const filteredNodes = useMemo(() =>
    uniqueNodes.filter(n => {
      const typeOk   = typeFilter === "all" || n.node_type === typeFilter;
      const searchOk = !searchQ || n.label.toLowerCase().includes(searchQ.toLowerCase());
      return typeOk && searchOk;
    }),
  [typeFilter, searchQ, uniqueNodes]);

  const filteredEdges = useMemo(() =>
    (edges || []).filter(e =>
      !searchQ ||
      [e.from_label, e.to_label, e.relation].some(s => (s || "").toLowerCase().includes(searchQ.toLowerCase()))
    ),
  [edges, searchQ]);

  const selectedNodeObj = useMemo(() =>
    selectedNode ? uniqueNodes.find(n => n.label === selectedNode) : null,
  [selectedNode, uniqueNodes]);

  function handleSelectNode(label) {
    setSelectedNode(label);
    if (label) setTab("nodes");
  }

  // ── Early returns (must be after all hooks) ───────────────
  if (loading) return <><style>{FONT_STYLE}</style><Skeleton /></>;
  if (error)   return <><style>{FONT_STYLE}</style><ErrorState message={error} onRetry={loadGraph} /></>;
  if (!data)   return null;

  // ── Style helpers ─────────────────────────────────────────
  const typeAbbr = { Abnormality: "ABNORM", Condition: "CONDI", Decision: "DECIS", Finding: "FINDI", Outcome: "OUTCO" };

  const tabStyle = (active) => ({
    flex: 1, padding: "9px 6px", fontSize: 9, fontWeight: 600,
    letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "center",
    cursor: "pointer", color: active ? "#0a0a0a" : "#aaa",
    border: "none", background: active ? "#fff" : "transparent",
    borderBottom: active ? "2px solid #0a0a0a" : "2px solid transparent",
    fontFamily: "'Open Sans',sans-serif", transition: "all 0.15s",
  });

  const chipStyle = (active) => ({
    padding: "3px 9px", fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
    textTransform: "uppercase", border: "1px solid", cursor: "pointer",
    borderColor: active ? "#0a0a0a" : "#e0e0e0",
    background: active ? "#0a0a0a" : "#fff",
    color: active ? "#fff" : "#888",
    fontFamily: "'Open Sans',sans-serif",
  });

  const viewBtnStyle = (active) => ({
    padding: "6px 14px", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
    textTransform: "uppercase", border: "1px solid", cursor: "pointer",
    borderColor: active ? "#0a0a0a" : "#ddd",
    background: active ? "#0a0a0a" : "#fff",
    color: active ? "#fff" : "#888",
    fontFamily: "'Open Sans',sans-serif", whiteSpace: "nowrap",
  });

  const skillTabStyle = (active) => ({
    flex: 1, padding: "8px 4px", fontSize: 9, fontWeight: 600,
    letterSpacing: "0.09em", textTransform: "uppercase", textAlign: "center",
    cursor: "pointer", border: "none", fontFamily: "'Open Sans',sans-serif",
    color: active ? "#0a0a0a" : "#aaa",
    background: active ? "#fff" : "transparent",
    borderBottom: active ? "2px solid #0a0a0a" : "2px solid transparent",
    transition: "all 0.15s",
  });

  return (
    <>
      <style>{FONT_STYLE}</style>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 290px", height: "100vh", fontFamily: "'Open Sans',sans-serif", fontWeight: 300, color: "#0a0a0a", background: "#fff", overflow: "hidden" }}>

        {/* ── LEFT SIDEBAR ────────────────────────────────────── */}
        <div style={{ borderRight: "1px solid #0a0a0a", display: "flex", flexDirection: "column", overflow: "hidden", background: "#fafafa" }}>

          {/* Header */}
          <div style={{ padding: "20px 16px 14px", borderBottom: "1px solid #e8e8e8" }}>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#aaa", marginBottom: 5 }}>Clinical Graph</div>
            <div style={{ fontSize: 18, fontWeight: 300, color: "#0a0a0a", lineHeight: 1.25 }}>Knowledge<br />Graph Viewer</div>
            <div style={{ fontSize: 9, color: "#aaa", marginTop: 8, fontFamily: "monospace" }}>
              {doctorId?.slice(0, 20)}{doctorId?.length > 20 ? "…" : ""}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#e8e8e8", gap: "1px", borderBottom: "1px solid #e8e8e8" }}>
            <StatCard value={stats?.total_nodes ?? uniqueNodes.length} label="Nodes" />
            <StatCard value={stats?.total_edges ?? (edges || []).length} label="Edges" />
            <StatCard value={stats?.total_abnormalities ?? (abnormalities || []).filter(a => a.severity === "critical").length} label="Critical" accent="#c00" />
            <StatCard value={stats?.total_flags ?? uniqueFlags.length} label="Flags" />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #e8e8e8" }}>
            {["nodes", "edges", "chains"].map(t => (
              <button key={t} style={tabStyle(tab === t)} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>

          {/* Type chips */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #efefef", display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button style={chipStyle(typeFilter === "all")} onClick={() => setTypeFilter("all")}>All</button>
            {nodeTypes.map(t => (
              <button key={t} style={chipStyle(typeFilter === t)} onClick={() => setTypeFilter(t)}>
                {typeAbbr[t] || t.slice(0, 5)}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {tab === "nodes" && (
              filteredNodes.length === 0
                ? <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 12 }}>No nodes match</div>
                : filteredNodes.map(n => {
                    const col        = nodeColor(n);
                    const sig        = n.all_attrs?.clinical_significance || n.severity;
                    const isSelected = selectedNode === n.label;
                    return (
                      <div
                        key={n.label}
                        onClick={() => handleSelectNode(isSelected ? null : n.label)}
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 14px", cursor: "pointer", background: isSelected ? "#f0f0f0" : "transparent", borderLeft: isSelected ? "3px solid #0a0a0a" : "3px solid transparent", transition: "all 0.1s" }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f8f8f8"; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
                        <div style={{ flex: 1, fontSize: 12, fontWeight: 300, color: "#0a0a0a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "#aaa", flexShrink: 0 }}>
                          {sig ? sig[0].toUpperCase() : (n.node_type || "")[0]}{n.occurrence_count || ""}
                        </div>
                      </div>
                    );
                  })
            )}
            {tab === "edges" && (
              filteredEdges.length === 0
                ? <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 12 }}>No edges</div>
                : filteredEdges.map((e, i) => {
                    const col = RELATION_COLORS[e.relation] || "#888";
                    return (
                      <div key={i}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                        onClick={() => handleSelectNode(e.from_label)}
                        onMouseEnter={ev => ev.currentTarget.style.background = "#f8f8f8"}
                        onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: col, flexShrink: 0 }} />
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ fontSize: 10, fontWeight: 300, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.from_label} → {e.to_label}</div>
                          <div style={{ fontSize: 9, fontWeight: 600, color: col, letterSpacing: "0.06em", marginTop: 1 }}>{(e.relation || "").replace(/_/g, " ")}</div>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#888", flexShrink: 0 }}>{Math.round((e.weight || 0) * 100)}%</div>
                      </div>
                    );
                  })
            )}
            {tab === "chains" && (
              (decision_chains || []).length === 0
                ? <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 12 }}>No chains</div>
                : (decision_chains || []).map((c, i) => <ChainItem key={i} chain={c} onSelect={handleSelectNode} />)
            )}
          </div>
        </div>

        {/* ── MAIN CANVAS ─────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #e0e0e0", background: "#fff", flexShrink: 0, zIndex: 10 }}>
            <input
              type="text"
              placeholder="Search nodes, relations, conditions…"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              style={{ flex: 1, padding: "6px 11px", fontSize: 12, fontFamily: "'Open Sans',sans-serif", fontWeight: 300, border: "1px solid #0a0a0a", background: "#fff", outline: "none", color: "#0a0a0a" }}
            />
            <button style={viewBtnStyle(view === "graph")}  onClick={() => setView("graph")}>Graph</button>
            <button style={viewBtnStyle(view === "matrix")} onClick={() => setView("matrix")}>Matrix</button>
          </div>
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {view === "graph"
              ? <GraphCanvas nodes={filteredNodes} edges={edges || []} selectedNode={selectedNode} onSelectNode={handleSelectNode} />
              : <MatrixView  nodes={uniqueNodes}   edges={edges || []} onSelectNode={handleSelectNode} />
            }
          </div>
        </div>

        {/* ── RIGHT PANEL ─────────────────────────────────────── */}
        <div style={{ borderLeft: "1px solid #0a0a0a", display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff" }}>

          {/* Selected node */}
          <div style={{ borderBottom: "1px solid #e8e8e8", flexShrink: 0 }}>
            <div style={{ padding: "12px 16px 8px", fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#aaa" }}>Selected Node</div>
            <NodeDetail node={selectedNodeObj} edges={edges || []} onSelectNode={handleSelectNode} />
          </div>

          {/* Abnormalities */}
          {/* Abnormalities */}
{(abnormalities || []).length > 0 && (
  <div style={{ 
    borderBottom: "1px solid #e8e8e8", 
    flex: 1,  // Change from flexShrink: 0 to flex: 1
    minHeight: 0,  // Required for flex child scrolling
    display: "flex", 
    flexDirection: "column",
    overflow: "hidden"  // Hide overflow on container
  }}>
    <div style={{ 
      padding: "10px 16px 6px", 
      fontSize: 9, 
      fontWeight: 600, 
      letterSpacing: "0.14em", 
      textTransform: "uppercase", 
      color: "#aaa",
      flexShrink: 0  // Keep header fixed
    }}>
      Abnormalities ({(abnormalities || []).length})
    </div>
    <div style={{ 
      flex: 1, 
      overflowY: "auto",  // Add scroll here
      minHeight: 0  // Required for scrolling
    }}>
      {(abnormalities || []).map((ab, i) => (
        <div key={i}
          style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            padding: "5px 16px", 
            cursor: "pointer" 
          }}
          onClick={() => handleSelectNode(ab.entity_name || ab.label)}
          onMouseEnter={e => e.currentTarget.style.background = "#f8f8f8"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <span style={{ fontSize: 11, fontWeight: 300, color: "#111" }}>{ab.entity_name || ab.label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {ab.value && <span style={{ fontSize: 10, color: "#888" }}>{ab.value}{ab.unit ? ` ${ab.unit}` : ""}</span>}
            <SevBadge sev={ab.severity || ab.clinical_significance || "low"} />
          </div>
        </div>
      ))}
    </div>
  </div>
)}

          {/* ── BOTTOM SECTION: 3-tab (Flags / Pending / My Skills) ── */}
          <div style={{ borderTop: "1px solid #e8e8e8", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>

            {/* Sub-tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid #e8e8e8", flexShrink: 0 }}>
              <button style={skillTabStyle(skillsTab === "flags")}
                onClick={() => setSkillsTab("flags")}>
                Flags ({uniqueFlags.length})
              </button>
              <button style={skillTabStyle(skillsTab === "pending")}
                onClick={() => setSkillsTab("pending")}>
                Pending ({skillCandidates.length})
              </button>
              <button style={skillTabStyle(skillsTab === "skills")}
                onClick={() => setSkillsTab("skills")}>
                Skills ({confirmedSkills.length})
              </button>
            </div>

            {/* ── FLAGS ── */}
            {skillsTab === "flags" && (
              <div style={{ flex: 1, overflowY: "auto" }}>
                {uniqueFlags.length === 0
                  ? <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 12 }}>No flags</div>
                  : uniqueFlags.map((f, i) => <FlagItem key={f.flag_id || i} flag={f} />)
                }
              </div>
            )}

            {/* ── PENDING SKILL CANDIDATES ── */}
            {skillsTab === "pending" && (
              <div style={{ flex: 1, overflowY: "auto" }}>
                {skillsLoading && (
                  <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 11 }}>Loading…</div>
                )}
                {!skillsLoading && skillCandidates.length === 0 && (
                  <div style={{ padding: "20px 16px", textAlign: "center", color: "#aaa", fontSize: 11, lineHeight: 1.7 }}>
                    No pending candidates.<br />
                    <span style={{ fontSize: 10 }}>Run Pattern Analysis in the Upload page to generate skill candidates.</span>
                  </div>
                )}
                {skillCandidates.map(cand => {
                  const isActing = skillAction?.id === cand.candidate_id;
                  return (
                    <div key={cand.candidate_id} style={{ padding: "10px 14px", borderBottom: "1px solid #efefef" }}>
                      {/* Pattern */}
                      <div style={{ fontSize: 11, fontWeight: 400, color: "#111", marginBottom: 4, lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 600 }}>{cand.condition_label}</span>
                        <span style={{ color: "#aaa", margin: "0 5px" }}>→</span>
                        {cand.decision_label}
                      </div>
                      {/* Meta */}
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: "#059669" }}>
                          {Math.round((cand.weight || 0) * 100)}% confidence
                        </span>
                        <span style={{ fontSize: 9, color: "#aaa" }}>{cand.occurrence_count}× seen</span>
                        {cand.speciality && <span style={{ fontSize: 9, color: "#aaa" }}>{cand.speciality}</span>}
                      </div>
                      {/* Actions */}
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleConfirmSkill(cand.candidate_id)}
                          disabled={isActing}
                          style={{
                            flex: 1, padding: "5px 0", fontSize: 9, fontWeight: 600,
                            letterSpacing: "0.08em", textTransform: "uppercase",
                            border: "1px solid #0a0a0a", background: "#0a0a0a", color: "#fff",
                            cursor: isActing ? "not-allowed" : "pointer",
                            opacity: isActing ? 0.5 : 1,
                            fontFamily: "'Open Sans',sans-serif", transition: "all 0.15s",
                          }}
                        >
                          {isActing && skillAction.type === "confirm" ? "…" : "✓ Confirm"}
                        </button>
                        <button
                          onClick={() => handleRejectSkill(cand.candidate_id)}
                          disabled={isActing}
                          style={{
                            flex: 1, padding: "5px 0", fontSize: 9, fontWeight: 600,
                            letterSpacing: "0.08em", textTransform: "uppercase",
                            border: "1px solid #e0e0e0", background: "#fff", color: "#888",
                            cursor: isActing ? "not-allowed" : "pointer",
                            opacity: isActing ? 0.5 : 1,
                            fontFamily: "'Open Sans',sans-serif", transition: "all 0.15s",
                          }}
                        >
                          {isActing && skillAction.type === "reject" ? "…" : "✕ Reject"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── CONFIRMED SKILLS ── */}
            {skillsTab === "skills" && (
              <div style={{ flex: 1, overflowY: "auto" }}>
                {skillsLoading && (
                  <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 11 }}>Loading…</div>
                )}
                {!skillsLoading && confirmedSkills.length === 0 && (
                  <div style={{ padding: "20px 16px", textAlign: "center", color: "#aaa", fontSize: 11, lineHeight: 1.7 }}>
                    No confirmed skills yet.<br />
                    <span style={{ fontSize: 10 }}>Confirm candidates from the Pending tab.</span>
                  </div>
                )}
                {confirmedSkills.map((skill, i) => (
                  <div key={skill.skill_key || i} style={{ padding: "10px 14px", borderBottom: "1px solid #efefef" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 400, color: "#111", marginBottom: 3, lineHeight: 1.4 }}>
                          <span style={{ fontWeight: 600 }}>{skill.condition_label}</span>
                          <span style={{ color: "#aaa", margin: "0 5px" }}>→</span>
                          {skill.decision_label}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {skill.speciality && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                              {skill.speciality}
                            </span>
                          )}
                          <span style={{ fontSize: 9, color: "#aaa" }}>{skill.occurrence_count}× seen</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 300, color: "#059669" }}>
                          {Math.round((skill.weight || skill.confidence || 0) * 100)}%
                        </div>
                        <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "#aaa" }}>
                          confidence
                        </div>
                      </div>
                    </div>
                    {/* Confirmed badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#059669" }} />
                      <span style={{ fontSize: 8, fontWeight: 600, color: "#059669", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Confirmed Skill
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
          {/* ── END BOTTOM SECTION ── */}

        </div>
        {/* ── END RIGHT PANEL ── */}

      </div>
    </>
  );
}

// ─── API RESPONSE NORMALIZER ──────────────────────────────
function normalizeApiResponse(raw) {
  const nodes = (raw.nodes || []).map(n => ({
    label:           n.label,
    node_type:       n.node_type ?? n.all_attrs?.type ?? "Condition",
    occurrence_count: n.occurrence_count || 1,
    all_attrs:       n.all_attrs || {},
    severity:        n.all_attrs?.clinical_significance,
    explanation:     n.all_attrs?.explanation,
  }));

  const edges = (raw.edges || []).map(e => ({
    from_label: e.from_label,
    from_type:  e.from_type,
    to_label:   e.to_label,
    to_type:    e.to_type,
    relation:   e.relation,
    weight:     e.weight || 0,
    count:      e.count  || 1,
    confidence: e.confidence || e.weight || 0,
  }));

  const abnormalities = (raw.abnormalities || []).map(a => ({
    label:           a.label,
    entity_name:     a.label,
    direction:       a.direction,
    severity:        a.severity || a.clinical_significance || "low",
    explanation:     a.explanation,
    value:           a.value,
    unit:            a.unit,
    normal_range:    a.normal_range,
    occurrence_count: a.occurrence_count || 1,
  }));

  const impact_flags = (raw.impact_flags || []).map((f, i) => ({
    flag_id:           f.flag_id || `f${i}`,
    flag_type:         f.flag_type || "INFO",
    severity:          f.severity || "low",
    description:       f.description,
    entity_involved:   f.entity_involved,
    decision_involved: f.decision_involved,
    recommendation:    f.recommendation,
    created_at:        f.created_at,
  }));

  const decision_chains = (raw.decision_chains || []).map(c => ({
    condition:        c.condition || c.condition_label || "",
    decision:         c.decision  || c.decision_label  || "",
    action_type:      c.action_type,
    urgency:          c.urgency,
    probability:      c.probability || 0,
    expected_outcome: c.expected_outcome,
    occurrence_count: c.count || 1,
  }));

  const summary = raw.summary || {};

  return {
    doctor_id: raw.doctor_id,
    nodes,
    edges,
    abnormalities,
    impact_flags,
    decision_chains,
    stats: {
      total_nodes:         summary.total_nodes         ?? nodes.length,
      total_edges:         summary.total_edges         ?? edges.length,
      total_abnormalities: summary.total_abnormalities ?? abnormalities.length,
      total_flags:         summary.total_flags         ?? impact_flags.length,
      total_chains:        summary.total_chains        ?? decision_chains.length,
    },
  };
}