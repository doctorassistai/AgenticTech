import { useState, useEffect, useMemo, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// DoctorKnowledgeDashboard.jsx
// ─────────────────────────────────────────────────────────────
// Five views, wired to the endpoints already exposed in
// phase1_router.py (added 29-07-2026):
//
//   GET /phase1/doctor/{doctor_id}/knowledge-dashboard/overview
//   GET /phase1/doctor/{doctor_id}/knowledge-dashboard/diseases
//   GET /phase1/doctor/{doctor_id}/knowledge-dashboard/diseases/{disease_name}/graph
//   GET /phase1/doctor/{doctor_id}/knowledge-dashboard/diseases/{disease_name}/skills
//   GET /phase1/doctor/{doctor_id}/knowledge-dashboard/diseases/{disease_name}/documents
//
// Nothing here is hardcoded to a specialty — every list, count, and
// label is rendered directly from whatever the backend returns, so
// it scales the same way for a doctor with 1 document or 100.
//
// CHANGE LOG (this revision):
//   The disease graph view no longer tries to render every node in a
//   single radial layout. Once a disease accumulates hundreds of
//   symptoms/drugs/biomarkers/evidence nodes merged from many
//   guidelines, that overlaps into an unreadable hairball. The graph
//   view is now category-first:
//     1) Category cards (Symptoms (24), Drugs (32), ...), computed
//        client-side from the same /graph response — no new endpoint.
//     2) Click a category -> searchable list of its items.
//     3) Click an item -> a small focused graph of just that item,
//        the disease, and its direct neighbors (typically < 15 nodes).
//     4) If the whole graph is small enough to render safely
//        (<= FULL_GRAPH_NODE_LIMIT nodes), a "Show full graph" toggle
//        is still available for the classic single-view layout.
//
// Drop-in usage (see bottom of file for the exact wiring snippet
// for Phase1Upload.jsx):
//
//   <DoctorKnowledgeDashboard doctorId={doctorId} apiBase={getApiBase()} />
// ─────────────────────────────────────────────────────────────

// ─── API ──────────────────────────────────────────────────────
const BASE_PATH = "api/hms/users/ai-legacy/phase1";

const buildEndpoints = (apiBase = "") => ({
  overview: (d) => `${apiBase}${BASE_PATH}/doctor/${d}/knowledge-dashboard/overview`,
  diseases: (d) => `${apiBase}${BASE_PATH}/doctor/${d}/knowledge-dashboard/diseases`,
  diseaseGraph: (d, disease, maxHops = 2) =>
    `${apiBase}${BASE_PATH}/doctor/${d}/knowledge-dashboard/diseases/${encodeURIComponent(disease)}/graph?max_hops=${maxHops}`,
  diseaseSkills: (d, disease) =>
    `${apiBase}${BASE_PATH}/doctor/${d}/knowledge-dashboard/diseases/${encodeURIComponent(disease)}/skills`,
  diseaseDocuments: (d, disease) =>
    `${apiBase}${BASE_PATH}/doctor/${d}/knowledge-dashboard/diseases/${encodeURIComponent(disease)}/documents`,
});

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// ─── STYLE — matches Phase1Upload's pure black & white theme ──
const DashboardStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap');
    .dkd * { box-sizing: border-box; }
    .dkd {
      --ink: #000000; --paper: #ffffff; --text-soft: rgba(0,0,0,0.62);
      --text-faint: rgba(0,0,0,0.4); --line: #000000;
      font-family: 'Open Sans', sans-serif; color: #000; background: #fff;
    }
    .dkd ::selection { background: #000; color: #fff; }
    @keyframes dkd-spin { to { transform: rotate(360deg); } }
    @keyframes dkd-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .dkd-fade { animation: dkd-fade 0.2s ease; }
    .dkd-scroll::-webkit-scrollbar { width: 6px; }
    .dkd-scroll::-webkit-scrollbar-thumb { background: #000; border-radius: 3px; }
  `}</style>
);

// ─── SHARED UI ATOMS ────────────────────────────────────────────

function Spinner({ label }) {
  return (
    <div style={{ padding: "2rem", textAlign: "center", color: "#000" }}>
      <i className="ti ti-loader-2" style={{ fontSize: "24px", animation: "dkd-spin 1s linear infinite", display: "block", marginBottom: "10px" }} aria-hidden />
      {label && <span style={{ fontSize: "12px", color: "var(--text-soft)" }}>{label}</span>}
    </div>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{
      padding: "11px 14px", marginBottom: "14px", fontSize: "12px", fontWeight: 600,
      background: "#000", color: "#fff", borderRadius: "8px",
      display: "flex", alignItems: "center", gap: "8px",
    }}>
      <i className="ti ti-alert-circle" style={{ fontSize: "15px", flexShrink: 0 }} aria-hidden />
      {message}
    </div>
  );
}

function EmptyState({ icon = "ti-database-off", title, subtitle }) {
  return (
    <div style={{
      padding: "2.5rem 1.5rem", textAlign: "center", color: "#000",
      background: "#fff", borderRadius: "10px", border: "2px dashed #000",
    }}>
      <i className={`ti ${icon}`} style={{ fontSize: "30px", display: "block", marginBottom: "10px", opacity: 0.4 }} aria-hidden />
      <p style={{ margin: "0 0 4px", fontSize: "13px", fontWeight: 700 }}>{title}</p>
      {subtitle && <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>{subtitle}</p>}
    </div>
  );
}

function MetricCard({ label, value, icon }) {
  return (
    <div style={{ background: "#fff", border: "2px solid #000", borderRadius: "10px", padding: "14px 16px" }}>
      <p style={{
        margin: "0 0 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "var(--text-faint)",
      }}>
        <i className={`ti ${icon}`} style={{ fontSize: "11px", marginRight: "5px" }} aria-hidden />
        {label}
      </p>
      <p style={{ margin: 0, fontSize: "26px", fontWeight: 800, lineHeight: 1.15 }}>
        {value ?? 0}
      </p>
    </div>
  );
}

function ProgressBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{ height: "8px", background: "rgba(0,0,0,0.1)", borderRadius: "999px", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${clamped}%`, background: "#000", borderRadius: "999px", transition: "width 0.3s ease" }} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// VIEW 1 — Doctor Knowledge Overview
// ═════════════════════════════════════════════════════════════

function OverviewView({ overview, loading, error }) {
  if (loading) return <Spinner label="Loading knowledge overview..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!overview) return null;

  const metrics = [
    { label: "Documents",             value: overview.documents,             icon: "ti-file-text" },
    { label: "Diseases",              value: overview.diseases,              icon: "ti-virus" },
    { label: "Subtypes",              value: overview.subtypes,              icon: "ti-git-branch" },
    { label: "Biomarkers",            value: overview.biomarkers,            icon: "ti-dna" },
    { label: "Drugs",                 value: overview.drugs,                 icon: "ti-pill" },
    { label: "Relationships",         value: overview.relationships,         icon: "ti-vector-bezier-2" },
    { label: "Skills",                value: overview.skills,                icon: "ti-brain" },
    { label: "Diagnosis skills",      value: overview.diagnosis_skills,      icon: "ti-stethoscope" },
    { label: "Treatment skills",      value: overview.treatment_skills,      icon: "ti-hearts" },
    { label: "Graph nodes",           value: overview.knowledge_graph_nodes, icon: "ti-hierarchy" },
    { label: "Graph edges",           value: overview.knowledge_graph_edges, icon: "ti-share-2" },
  ];

  return (
    <div className="dkd-fade">
      <p style={{ margin: "0 0 3px", fontSize: "18px", fontWeight: 800 }}>Doctor Knowledge Base</p>
      <p style={{ margin: "0 0 16px", fontSize: "12px", color: "var(--text-soft)" }}>
        Aggregated across every document you've uploaded and approved.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
        {metrics.map(m => <MetricCard key={m.label} {...m} />)}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// VIEW 2 — Disease Explorer (left panel)
// ═════════════════════════════════════════════════════════════

function DiseaseExplorer({ diseases, loading, error, selected, onSelect, search, onSearchChange }) {
  const filtered = (diseases || []).filter(d =>
    !search || d.disease.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      background: "#fff", border: "2px solid #000", borderRadius: "12px",
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
    }}>
      <div style={{ padding: "13px 15px", borderBottom: "2px solid #000" }}>
        <p style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <i className="ti ti-list-search" style={{ fontSize: "12px", marginRight: "5px" }} aria-hidden />
          Diseases {diseases ? `(${diseases.length})` : ""}
        </p>
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search diseases..."
          style={{
            width: "100%", padding: "7px 10px", fontSize: "12px",
            border: "1.5px solid #000", borderRadius: "6px", outline: "none",
          }}
        />
      </div>

      <div className="dkd-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loading && <Spinner label="Loading diseases..." />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState icon="ti-virus-off" title="No diseases found" subtitle={search ? "Try a different search term." : "Upload and save a document to populate this list."} />
        )}
        {!loading && filtered.map(d => {
          const isSelected = selected === d.disease;
          return (
            <button
              key={d.disease}
              onClick={() => onSelect(d.disease)}
              style={{
                width: "100%", textAlign: "left", padding: "11px 12px", marginBottom: "6px",
                borderRadius: "8px", cursor: "pointer",
                background: isSelected ? "#000" : "#fff",
                border: `1.5px solid #000`,
                color: isSelected ? "#fff" : "#000",
                transition: "all 0.12s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.disease}
                </span>
                <span style={{
                  fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", flexShrink: 0,
                  background: isSelected ? "#fff" : "#000", color: isSelected ? "#000" : "#fff",
                }}>{d.skill_count}</span>
              </div>
              <div style={{ fontSize: "11px", marginTop: "3px", opacity: isSelected ? 0.75 : 0.55 }}>
                {d.subtype_count} subtype{d.subtype_count !== 1 ? "s" : ""} · {d.document_count} doc{d.document_count !== 1 ? "s" : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// VIEW 3 — Disease-specific Knowledge Graph (category-first, drill-down)
// ═════════════════════════════════════════════════════════════

/** Deterministic radial layout — center node + concentric rings by node type. No layout libs required. */
function buildRadialLayout(nodes, centerIndex, width = 640, height = 440) {
  const cx = width / 2, cy = height / 2;
  const center = nodes.find(n => n.index === centerIndex);
  const others = nodes.filter(n => n.index !== centerIndex);

  const byType = {};
  others.forEach(n => {
    byType[n.type] = byType[n.type] || [];
    byType[n.type].push(n);
  });
  const types = Object.keys(byType);
  const ringGap = Math.min(width, height) / 2 / (types.length + 1);

  const positions = {};
  if (center) positions[center.index] = { x: cx, y: cy, node: center };

  types.forEach((type, ringIdx) => {
    const radius = ringGap * (ringIdx + 1);
    const group = byType[type];
    group.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 2;
      positions[n.index] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), node: n };
    });
  });

  return positions;
}

// Graphs at or under this size are still safe to render in one shot —
// above it, everything overlaps into an unreadable hairball, so the
// category drill-down becomes the only path.
const FULL_GRAPH_NODE_LIMIT = 60;

const CATEGORY_ICON = {
  disease: "ti-virus", subtype: "ti-git-branch", stage: "ti-stairs-up",
  biomarker: "ti-dna", drug: "ti-pill", regimen: "ti-clipboard-list",
  symptom: "ti-stethoscope", investigation: "ti-microscope",
  evidence: "ti-certificate", default: "ti-circle",
};

function categoryIcon(type) {
  return CATEGORY_ICON[type] || CATEGORY_ICON.default;
}

function titleCase(s) {
  return (s || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Group every non-center node by type, sorted by name. */
function groupByType(nodes, centerIndex) {
  const groups = {};
  nodes.forEach(n => {
    if (n.index === centerIndex) return;
    groups[n.type] = groups[n.type] || [];
    groups[n.type].push(n);
  });
  Object.values(groups).forEach(list => list.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
  return groups;
}

/** Direct neighbors of a node, either direction. */
function neighborsOf(edges, nodeIndex) {
  const ids = new Set();
  edges.forEach(e => {
    if (e.from === nodeIndex) ids.add(e.to);
    if (e.to === nodeIndex) ids.add(e.from);
  });
  return ids;
}

function CategoryCard({ type, count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", padding: "14px 15px", borderRadius: "10px", cursor: "pointer",
        background: "#fff", border: "2px solid #000",
        display: "flex", flexDirection: "column", gap: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <i className={`ti ${categoryIcon(type)}`} style={{ fontSize: "17px" }} aria-hidden />
        <span style={{ fontSize: "20px", fontWeight: 800 }}>{count}</span>
      </div>
      <span style={{ fontSize: "12px", fontWeight: 700 }}>{titleCase(type)}</span>
    </button>
  );
}

function CategoryDetailList({ type, items, onBack, onSelectNode }) {
  const [q, setQ] = useState("");
  const filtered = items.filter(n => !q || (n.name || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="dkd-fade">
      <button
        onClick={onBack}
        style={{
          marginBottom: "12px", padding: "6px 13px", fontSize: "11px", fontWeight: 700,
          borderRadius: "6px", cursor: "pointer", background: "#fff", border: "1.5px solid #000",
          display: "inline-flex", alignItems: "center", gap: "5px",
        }}
      >
        <i className="ti ti-arrow-left" style={{ fontSize: "11px" }} aria-hidden />
        Categories
      </button>

      <p style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 800 }}>
        <i className={`ti ${categoryIcon(type)}`} style={{ fontSize: "14px", marginRight: "6px" }} aria-hidden />
        {titleCase(type)} ({items.length})
      </p>

      {items.length > 10 && (
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Search ${titleCase(type).toLowerCase()}...`}
          style={{
            width: "100%", padding: "7px 10px", fontSize: "12px", marginBottom: "10px",
            border: "1.5px solid #000", borderRadius: "6px", outline: "none",
          }}
        />
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {filtered.map(n => (
          <button
            key={n.index}
            onClick={() => onSelectNode(n.index)}
            style={{
              padding: "7px 13px", fontSize: "12px", fontWeight: 600, borderRadius: "999px",
              cursor: "pointer", background: "#fff", border: "1.5px solid #000",
            }}
          >
            {n.name}
          </button>
        ))}
        {filtered.length === 0 && (
          <p style={{ fontSize: "12px", color: "var(--text-faint)" }}>No matches.</p>
        )}
      </div>
    </div>
  );
}

function FocusedNodeGraph({ graph, focusIndex, onBack }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const width = 640, height = 380;

  const { nodes: subNodes, positions } = useMemo(() => {
    const centerNode = graph.nodes.find(n => n.index === graph.center_index);
    const focusNode = graph.nodes.find(n => n.index === focusIndex);
    if (!centerNode || !focusNode) return { nodes: [], positions: {} };

    const neighborIds = neighborsOf(graph.edges, focusIndex);
    const nodeMap = new Map(graph.nodes.map(n => [n.index, n]));
    const subset = [centerNode, focusNode];
    neighborIds.forEach(id => {
      if (id !== centerNode.index && id !== focusNode.index && nodeMap.has(id)) {
        subset.push(nodeMap.get(id));
      }
    });
    return { nodes: subset, positions: buildRadialLayout(subset, centerNode.index, width, height) };
  }, [graph, focusIndex]);

  const subEdges = useMemo(() => {
    const ids = new Set(subNodes.map(n => n.index));
    return graph.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  }, [graph, subNodes]);

  const focusNode = graph.nodes.find(n => n.index === focusIndex);

  return (
    <div className="dkd-fade">
      <button
        onClick={onBack}
        style={{
          marginBottom: "12px", padding: "6px 13px", fontSize: "11px", fontWeight: 700,
          borderRadius: "6px", cursor: "pointer", background: "#fff", border: "1.5px solid #000",
          display: "inline-flex", alignItems: "center", gap: "5px",
        }}
      >
        <i className="ti ti-arrow-left" style={{ fontSize: "11px" }} aria-hidden />
        {focusNode ? titleCase(focusNode.type) : "Back"}
      </button>

      <p style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 800 }}>
        {focusNode?.name}{" "}
        <span style={{ fontWeight: 500, fontSize: "12px", color: "var(--text-faint)" }}>
          · {Math.max(subNodes.length - 1, 0)} connection{subNodes.length - 1 !== 1 ? "s" : ""}
        </span>
      </p>

      <div style={{ border: "2px solid #000", borderRadius: "12px", overflow: "hidden", background: "#fff" }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {subEdges.map((e, i) => {
            const a = positions[e.from], b = positions[e.to];
            if (!a || !b) return null;
            const dim = hoveredNode && hoveredNode !== e.from && hoveredNode !== e.to;
            return (
              <line
                key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#000" strokeWidth={dim ? 0.4 : 1} opacity={dim ? 0.12 : 0.35}
              />
            );
          })}
          {Object.values(positions).map(({ x, y, node }) => {
            const isFocus = node.index === focusIndex;
            const isCenter = node.index === graph.center_index;
            const r = isCenter || isFocus ? 10 : 6;
            const dim = hoveredNode && hoveredNode !== node.index &&
              !subEdges.some(e => (e.from === hoveredNode && e.to === node.index) || (e.to === hoveredNode && e.from === node.index));
            return (
              <g
                key={node.index}
                onMouseEnter={() => setHoveredNode(node.index)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: "pointer" }}
                opacity={dim ? 0.25 : 1}
              >
                <circle cx={x} cy={y} r={r} fill={isCenter || isFocus ? "#000" : "#fff"} stroke="#000" strokeWidth={isCenter || isFocus ? 0 : 1.5} />
                <text
                  x={x} y={y + r + 11} textAnchor="middle"
                  fontSize={isCenter || isFocus ? 11 : 9} fontWeight={isCenter || isFocus ? 700 : 500}
                  fill="#000" fontFamily="Open Sans, sans-serif"
                >
                  {(node.name || "").length > 20 ? node.name.slice(0, 18) + "…" : node.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function FullGraphSvg({ graph }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const width = 640, height = 440;
  const positions = useMemo(() => buildRadialLayout(graph.nodes, graph.center_index, width, height), [graph]);

  return (
    <div style={{ border: "2px solid #000", borderRadius: "12px", overflow: "hidden", background: "#fff" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {graph.edges.map((e, i) => {
          const a = positions[e.from], b = positions[e.to];
          if (!a || !b) return null;
          const dim = hoveredNode && hoveredNode !== e.from && hoveredNode !== e.to;
          return (
            <line
              key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#000" strokeWidth={dim ? 0.4 : 1} opacity={dim ? 0.12 : 0.35}
            />
          );
        })}
        {Object.values(positions).map(({ x, y, node }) => {
          const isCenter = node.index === graph.center_index;
          const r = isCenter ? 11 : 6;
          const dim = hoveredNode && hoveredNode !== node.index &&
            !graph.edges.some(e => (e.from === hoveredNode && e.to === node.index) || (e.to === hoveredNode && e.from === node.index));
          return (
            <g
              key={node.index}
              onMouseEnter={() => setHoveredNode(node.index)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: "pointer" }}
              opacity={dim ? 0.25 : 1}
            >
              <circle cx={x} cy={y} r={r} fill={isCenter ? "#000" : "#fff"} stroke="#000" strokeWidth={isCenter ? 0 : 1.5} />
              <text
                x={x} y={y + r + 11} textAnchor="middle"
                fontSize={isCenter ? 11 : 9} fontWeight={isCenter ? 700 : 500}
                fill="#000" fontFamily="Open Sans, sans-serif"
              >
                {(node.name || "").length > 20 ? node.name.slice(0, 18) + "…" : node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function GraphView({ graph, loading, error, diseaseName }) {
  const [mode, setMode] = useState("categories"); // "categories" | "category-detail" | "node-focus" | "full"
  const [activeCategory, setActiveCategory] = useState(null);
  const [focusIndex, setFocusIndex] = useState(null);

  // reset drill-down state whenever the disease (and therefore the graph) changes
  useEffect(() => {
    setMode("categories");
    setActiveCategory(null);
    setFocusIndex(null);
  }, [graph]);

  const groups = useMemo(() => (graph ? groupByType(graph.nodes, graph.center_index) : {}), [graph]);

  if (loading) return <Spinner label={`Building graph for ${diseaseName}...`} />;
  if (error) return <ErrorBanner message={error} />;
  if (!graph || !graph.nodes?.length) {
    return <EmptyState icon="ti-hierarchy-2" title="No graph data" subtitle="This disease has no connected knowledge graph nodes yet." />;
  }

  const canShowFull = graph.node_count <= FULL_GRAPH_NODE_LIMIT;

  return (
    <div className="dkd-fade">
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px", alignItems: "center" }}>
        <div style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, background: "#000", color: "#fff" }}>
          {graph.node_count} nodes
        </div>
        <div style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: "1.5px solid #000" }}>
          {graph.edge_count} edges
        </div>
        {canShowFull && (
          <button
            onClick={() => setMode(mode === "full" ? "categories" : "full")}
            style={{
              marginLeft: "auto", padding: "6px 13px", fontSize: "11px", fontWeight: 700, borderRadius: "6px", cursor: "pointer",
              background: mode === "full" ? "#000" : "#fff", color: mode === "full" ? "#fff" : "#000", border: "1.5px solid #000",
            }}
          >
            {mode === "full" ? "Back to categories" : "Show full graph"}
          </button>
        )}
      </div>

      {mode === "full" && <FullGraphSvg graph={graph} />}

      {mode === "categories" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
          {Object.entries(groups).map(([type, items]) => (
            <CategoryCard
              key={type}
              type={type}
              count={items.length}
              onClick={() => { setActiveCategory(type); setMode("category-detail"); }}
            />
          ))}
        </div>
      )}

      {mode === "category-detail" && activeCategory && (
        <CategoryDetailList
          type={activeCategory}
          items={groups[activeCategory] || []}
          onBack={() => setMode("categories")}
          onSelectNode={(idx) => { setFocusIndex(idx); setMode("node-focus"); }}
        />
      )}

      {mode === "node-focus" && focusIndex != null && (
        <FocusedNodeGraph
          graph={graph}
          focusIndex={focusIndex}
          onBack={() => setMode("category-detail")}
        />
      )}

      {mode !== "full" && (
        <p style={{ margin: "12px 0 0", fontSize: "11px", color: "var(--text-faint)" }}>
          {mode === "categories" && `Nodes for ${diseaseName} are grouped by type to avoid rendering every node at once. Click a category to browse it, then click an item to see its direct connections.`}
          {mode === "category-detail" && "Click an item to see its neighborhood graph."}
          {mode === "node-focus" && "Showing only this item's direct connections to keep the graph readable."}
        </p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// VIEW 4 — Cross-document Skill Explorer
// ═════════════════════════════════════════════════════════════

function SkillRow({ skill }) {
  const isDiag = skill.skill_type === "diagnosis";
  return (
    <div style={{ border: "1.5px solid #000", borderRadius: "8px", padding: "11px 13px", marginBottom: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", flexWrap: "wrap" }}>
        <span style={{
          fontSize: "9px", fontWeight: 700, padding: "2px 8px", borderRadius: "3px",
          background: "#000", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em",
        }}>{isDiag ? "Diagnosis" : "Treatment"}</span>
        {skill.guideline && (
          <span style={{ fontSize: "10px", color: "var(--text-faint)" }}>
            <i className="ti ti-file-text" style={{ fontSize: "10px", marginRight: "3px" }} aria-hidden />
            {skill.guideline} {skill.guideline_version}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>{skill.name}</p>
      {skill.description && (
        <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-soft)", lineHeight: 1.5 }}>{skill.description}</p>
      )}
    </div>
  );
}

function SkillExplorerView({ skillData, loading, error, diseaseName }) {
  const [activeSubtype, setActiveSubtype] = useState(null);

  useEffect(() => {
    setActiveSubtype(skillData?.subtype_order?.[0] ?? null);
  }, [skillData]);

  if (loading) return <Spinner label={`Loading skills for ${diseaseName}...`} />;
  if (error) return <ErrorBanner message={error} />;
  if (!skillData || !skillData.total_skills) {
    return <EmptyState icon="ti-brain-off" title="No skills found" subtitle="No diagnosis or treatment skills exist yet for this disease." />;
  }

  const bucket = skillData.by_subtype?.[activeSubtype] || { diagnosis: [], treatment: [] };

  return (
    <div className="dkd-fade">
      <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
        <div style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, background: "#000", color: "#fff" }}>
          {skillData.total_skills} total
        </div>
        <div style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1.5px solid #000" }}>
          {skillData.diagnosis_count} diagnosis
        </div>
        <div style={{ padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1.5px solid #000" }}>
          {skillData.treatment_count} treatment
        </div>
      </div>

      {/* subtype tabs — "General" (disease-level) first, per backend ordering */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
        {(skillData.subtype_order || []).map(st => (
          <button
            key={st}
            onClick={() => setActiveSubtype(st)}
            style={{
              padding: "6px 14px", fontSize: "11px", fontWeight: 700, borderRadius: "999px", cursor: "pointer",
              background: activeSubtype === st ? "#000" : "#fff",
              color: activeSubtype === st ? "#fff" : "#000",
              border: "1.5px solid #000",
            }}
          >{st}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div>
          <p style={{ margin: "0 0 8px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" }}>
            Diagnosis ({bucket.diagnosis.length})
          </p>
          {bucket.diagnosis.length === 0
            ? <p style={{ fontSize: "12px", color: "var(--text-faint)" }}>None for this subtype.</p>
            : bucket.diagnosis.map(s => <SkillRow key={s.skill_id} skill={s} />)
          }
        </div>
        <div>
          <p style={{ margin: "0 0 8px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" }}>
            Treatment ({bucket.treatment.length})
          </p>
          {bucket.treatment.length === 0
            ? <p style={{ fontSize: "12px", color: "var(--text-faint)" }}>None for this subtype.</p>
            : bucket.treatment.map(s => <SkillRow key={s.skill_id} skill={s} />)
          }
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// VIEW 5 — Document Contribution
// ═════════════════════════════════════════════════════════════

function DocumentContributionView({ docData, loading, error, diseaseName }) {
  if (loading) return <Spinner label={`Loading document contributions for ${diseaseName}...`} />;
  if (error) return <ErrorBanner message={error} />;
  if (!docData || !docData.documents?.length) {
    return <EmptyState icon="ti-files-off" title="No contributing documents" subtitle="No saved guidelines are linked to this disease yet." />;
  }

  return (
    <div className="dkd-fade">
      <p style={{ margin: "0 0 14px", fontSize: "12px", color: "var(--text-soft)" }}>
        <strong style={{ color: "#000" }}>{docData.total_skills}</strong> total skills for{" "}
        <strong style={{ color: "#000" }}>{diseaseName}</strong>, contributed by {docData.documents.length} document{docData.documents.length !== 1 ? "s" : ""}.
      </p>

      {docData.documents.map(doc => (
        <div key={doc.doc_id} style={{ border: "1.5px solid #000", borderRadius: "10px", padding: "13px 15px", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {doc.guideline_name || "Untitled guideline"}
              </p>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-faint)" }}>
                {doc.guideline_version && <>v{doc.guideline_version} · </>}
                {doc.created_at ? new Date(doc.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
              </p>
            </div>
            <span style={{
              fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px",
              background: "#000", color: "#fff", flexShrink: 0,
            }}>{doc.skill_count} skill{doc.skill_count !== 1 ? "s" : ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ flex: 1 }}><ProgressBar pct={doc.contribution_pct} /></div>
            <span style={{ fontSize: "12px", fontWeight: 700, minWidth: "42px", textAlign: "right" }}>{doc.contribution_pct}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════

const DETAIL_TABS = [
  { id: "graph",     label: "Knowledge graph", icon: "ti-hierarchy" },
  { id: "skills",    label: "Skills",          icon: "ti-brain" },
  { id: "documents", label: "Documents",       icon: "ti-files" },
];

export default function DoctorKnowledgeDashboard({ doctorId, apiBase = "" }) {
  const ENDPOINTS = useMemo(() => buildEndpoints(apiBase), [apiBase]);

  // View 1 state
  const [overview, setOverview]           = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError]  = useState(null);

  // View 2 state
  const [diseases, setDiseases]           = useState(null);
  const [diseasesLoading, setDiseasesLoading] = useState(true);
  const [diseasesError, setDiseasesError]  = useState(null);
  const [search, setSearch]               = useState("");
  const [selectedDisease, setSelectedDisease] = useState(null);

  // Views 3-5 state
  const [activeTab, setActiveTab] = useState("graph");
  const [graph, setGraph]         = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError]     = useState(null);

  const [skillData, setSkillData]       = useState(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError]     = useState(null);

  const [docData, setDocData]           = useState(null);
  const [docsLoading, setDocsLoading]   = useState(false);
  const [docsError, setDocsError]       = useState(null);

  // ── Load View 1 + View 2 on mount ──
  useEffect(() => {
    if (!doctorId) return;
    let cancelled = false;

    setOverviewLoading(true);
    fetchJson(ENDPOINTS.overview(doctorId))
      .then(d => !cancelled && setOverview(d))
      .catch(e => !cancelled && setOverviewError(e.message))
      .finally(() => !cancelled && setOverviewLoading(false));

    setDiseasesLoading(true);
    fetchJson(ENDPOINTS.diseases(doctorId))
      .then(d => {
        if (cancelled) return;
        setDiseases(d.diseases || []);
        // auto-select the top disease so the dashboard isn't empty on first load
        if (d.diseases?.length) setSelectedDisease(prev => prev || d.diseases[0].disease);
      })
      .catch(e => !cancelled && setDiseasesError(e.message))
      .finally(() => !cancelled && setDiseasesLoading(false));

    return () => { cancelled = true; };
  }, [doctorId, ENDPOINTS]);

  // ── Load Views 3-5 whenever the selected disease changes ──
  const loadDiseaseDetail = useCallback((disease) => {
    if (!doctorId || !disease) return;

    setGraphLoading(true); setGraphError(null);
    fetchJson(ENDPOINTS.diseaseGraph(doctorId, disease))
      .then(setGraph)
      .catch(e => setGraphError(e.message))
      .finally(() => setGraphLoading(false));

    setSkillsLoading(true); setSkillsError(null);
    fetchJson(ENDPOINTS.diseaseSkills(doctorId, disease))
      .then(setSkillData)
      .catch(e => setSkillsError(e.message))
      .finally(() => setSkillsLoading(false));

    setDocsLoading(true); setDocsError(null);
    fetchJson(ENDPOINTS.diseaseDocuments(doctorId, disease))
      .then(setDocData)
      .catch(e => setDocsError(e.message))
      .finally(() => setDocsLoading(false));
  }, [doctorId, ENDPOINTS]);

  useEffect(() => {
    if (selectedDisease) loadDiseaseDetail(selectedDisease);
  }, [selectedDisease, loadDiseaseDetail]);

  if (!doctorId) {
    return (
      <div className="dkd">
        <DashboardStyle />
        <ErrorBanner message="Missing doctorId — the dashboard needs a doctor_id to load knowledge data." />
      </div>
    );
  }

  return (
    <div className="dkd">
      <DashboardStyle />

      {/* ── View 1 ── */}
      <div style={{ marginBottom: "22px" }}>
        <OverviewView overview={overview} loading={overviewLoading} error={overviewError} />
      </div>

      {/* ── Views 2-5 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "18px", alignItems: "start" }}>
        <div style={{ height: "640px" }}>
          <DiseaseExplorer
            diseases={diseases}
            loading={diseasesLoading}
            error={diseasesError}
            selected={selectedDisease}
            onSelect={setSelectedDisease}
            search={search}
            onSearchChange={setSearch}
          />
        </div>

        <div>
          {!selectedDisease ? (
            <EmptyState icon="ti-hand-click" title="Select a disease" subtitle="Choose a disease from the list to explore its graph, skills, and contributing documents." />
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
                <p style={{ margin: 0, fontSize: "17px", fontWeight: 800 }}>{selectedDisease}</p>
                <div style={{ display: "flex", gap: 0, border: "2px solid #000", borderRadius: "8px", overflow: "hidden" }}>
                  {DETAIL_TABS.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        padding: "8px 14px", fontSize: "11px", fontWeight: 700, cursor: "pointer", border: "none",
                        background: activeTab === tab.id ? "#000" : "#fff",
                        color: activeTab === tab.id ? "#fff" : "#000",
                        display: "flex", alignItems: "center", gap: "5px",
                      }}
                    >
                      <i className={`ti ${tab.icon}`} style={{ fontSize: "12px" }} aria-hidden />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === "graph" && (
                <GraphView graph={graph} loading={graphLoading} error={graphError} diseaseName={selectedDisease} />
              )}
              {activeTab === "skills" && (
                <SkillExplorerView skillData={skillData} loading={skillsLoading} error={skillsError} diseaseName={selectedDisease} />
              )}
              {activeTab === "documents" && (
                <DocumentContributionView docData={docData} loading={docsLoading} error={docsError} diseaseName={selectedDisease} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// WIRING INTO Phase1Upload.jsx
// ─────────────────────────────────────────────────────────────
//
// 1) Import it at the top of Phase1Upload.jsx:
//
//      import DoctorKnowledgeDashboard from "./DoctorKnowledgeDashboard";
//
// 2) Add "dashboard" as a third mode alongside "list" / "upload" / "detail":
//
//      const [mode, setMode] = useState("list");   // already exists — no change needed
//
// 3) Add a button next to "Upload new" in DocumentsListView's header
//    (or anywhere in Phase1Upload's top-level header) that switches mode:
//
//      <button
//        onClick={() => setMode("dashboard")}
//        style={{ ...same styling as the "Upload new" button, but outlined... }}
//      >
//        <i className="ti ti-chart-donut" style={{ marginRight: "6px" }} aria-hidden />
//        Knowledge Dashboard
//      </button>
//
//    DocumentsListView takes an onUpload prop already — add a sibling
//    onOpenDashboard prop the same way and pass it down from Phase1Upload:
//
//      <DocumentsListView
//        doctorId={doctorId}
//        onSelect={...}
//        onUpload={() => { setMode("upload"); ... }}
//        onOpenDashboard={() => setMode("dashboard")}
//      />
//
// 4) Render it as a new top-level mode branch in Phase1Upload's return,
//    right next to the existing "detail" and "list" branches:
//
//      if (mode === "dashboard") {
//        return (
//          <Wrapper>
//            <button
//              onClick={() => setMode("list")}
//              style={{ marginBottom: "1.5rem", padding: "7px 15px", fontSize: "12px",
//                       fontWeight: 700, borderRadius: "6px", cursor: "pointer",
//                       background: "#fff", border: "1.5px solid #000", color: "#000",
//                       display: "inline-flex", alignItems: "center", gap: "6px" }}
//            >
//              <i className="ti ti-arrow-left" style={{ fontSize: "12px" }} aria-hidden />
//              Back to library
//            </button>
//            <DoctorKnowledgeDashboard doctorId={doctorId} apiBase={getApiBase()} />
//          </Wrapper>
//        );
//      }
//
//    Place this branch before the "if (mode === 'list')" branch so it's
//    checked in the same if/else chain already used for "detail" and "list".
//
// That's the entire integration — the component is self-contained,
// fetches its own data from the five endpoints above, and needs nothing
// else from Phase1Upload except the doctorId string. No backend changes
// are required for the graph rewrite — everything is computed client-side
// from the same /graph response you already have.
// ─────────────────────────────────────────────────────────────