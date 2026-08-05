/**
 * ClinicalKnowledgeGraph.jsx  (unified — stable grouped layout)
 * =============================================================
 * Merges ClinicalGraphComparison into the right-panel as a 5th tab.
 * No modal, no second component file needed.
 * 
 * MODIFIED: Graph layout is now compact, stable, and grouped by clinical categories.
 * Nodes are organized in a structured grid-like fashion with clear visual hierarchy.
 * Makes the data clinically understandable for doctors.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ──────────────────────────────────────────────────────────────
   FONT + GLOBAL STYLES
────────────────────────────────────────────────────────────── */
const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; }

    :root {
      --bg:      #ffffff;
      --surface: #f8f8f8;
      --surface2:#f0f0f0;
      --border:  rgba(0,0,0,0.08);
      --text:    #0a0a0a;
      --muted:   #6b7280;
      --accent:  #000000;
      --font:    'Open Sans', sans-serif;
      --mono:    'IBM Plex Mono', monospace;
    }

    ::-webkit-scrollbar { width: 3px; height: 3px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

    .node-text {
      font-family: var(--font);
      font-size: 8px;
      font-weight: 600;
      letter-spacing: 0.02em;
      pointer-events: none;
      text-anchor: middle;
      dominant-baseline: central;
    }

    .node-g:hover circle { filter: brightness(1.15); }
    .node-g.selected circle { stroke-width: 3px !important; }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .fade-up { animation: fadeUp 0.25s ease both; }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 0.8s linear infinite; }

    .graph-list-item {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
      transition: background 0.15s;
    }
    .graph-list-item:hover { background: #f8f8f8; }
    .graph-list-item.active { background: #000; }
    .graph-list-item.active * { color: #fff !important; }

    /* ── Comparison panel styles ── */
    .finding-card {
      background: var(--sev-bg);
      border: 1px solid var(--sev-border);
      border-left: 3px solid var(--sev);
      border-radius: 3px;
      padding: 10px 12px;
      margin-bottom: 7px;
      animation: slideIn 0.2s ease both;
      cursor: pointer;
    }
    .sev-critical { --sev:#dc2626; --sev-bg:#fef2f2; --sev-border:#fecaca; }
    .sev-high     { --sev:#d97706; --sev-bg:#fffbeb; --sev-border:#fde68a; }
    .sev-moderate { --sev:#2563eb; --sev-bg:#eff6ff; --sev-border:#bfdbfe; }
    .sev-low      { --sev:#059669; --sev-bg:#f0fdf4; --sev-border:#bbf7d0; }
    .sev-info     { --sev:#7c3aed; --sev-bg:#f5f3ff; --sev-border:#ddd6fe; }

    .sev-badge {
      display: inline-flex;
      align-items: center;
      font-family: var(--mono);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 2px;
      background: var(--sev);
      color: #fff;
    }
    .cat-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 5px;
      border-radius: 2px;
      border: 1px solid var(--sev-border);
      color: var(--sev);
      background: #fff;
      margin-left: 4px;
    }
    .upload-zone {
      border: 1.5px dashed #d1d5db;
      border-radius: 4px;
      padding: 20px 14px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 10px;
    }
    .upload-zone:hover { border-color: #000; background: #fafafa; }
    .risk-bar-track { height: 6px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }
    .risk-bar-fill  { height: 100%; border-radius: 4px; transition: width 1s ease; }
    .cmp-tab-btn {
      padding: 6px 8px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-family: var(--mono);
      border: none;
      background: none;
      cursor: pointer;
      color: #9ca3af;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      transition: color 0.15s;
    }
    .cmp-tab-btn.active { color: #000; border-bottom-color: #000; }
    .cmp-tab-btn:hover:not(.active) { color: #374151; }
  `}</style>
);

/* ──────────────────────────────────────────────────────────────
   LOAD D3
────────────────────────────────────────────────────────────── */
function loadD3() {
  return new Promise((resolve, reject) => {
    if (window.d3) { resolve(window.d3); return; }
    const s = document.createElement("script");
    s.src = "https://d3js.org/d3.v7.min.js";
    s.onload = () => resolve(window.d3);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ──────────────────────────────────────────────────────────────
   COLOUR MAP
────────────────────────────────────────────────────────────── */
const COLOR = {
  disease:"#1a1a1a",drug:"#3a3a3a",study:"#555555",biomarker:"#707070",
  recommendation:"#8a8a8a",subgroup:"#2e2e2e",patient_subgroup:"#2e2e2e",
  outcome:"#4a4a4a",symptom:"#606060",symptom_sign:"#606060",test:"#787878",
  diagnostic_test:"#787878",risk:"#202020",risk_factor:"#202020",
  surgical:"#484848",surgical_procedure:"#484848",classification:"#626262",
  classification_system:"#626262",research:"#7a7a7a",research_gap:"#7a7a7a",
};
function nodeColor(n){ return COLOR[n?.color_group]||COLOR[n?.type]||"#555555"; }
function edgeColor(r=""){
  if(r.includes("contra"))  return "#000";
  if(r.includes("first_line")) return "#111";
  if(r.includes("treat"))   return "#222";
  if(r.includes("recommend"))return "#333";
  if(r.includes("downgrad")) return "#555";
  if(r.includes("upgrad")||r.includes("support")) return "#444";
  if(r.includes("predict"))  return "#3a3a3a";
  return "rgba(0,0,0,0.25)";
}
const RADIUS={1:14,2:10,3:7};
function nodeRadius(n){ return RADIUS[n?.visual_priority]??10; }
function trunc(s="",max=18){ return s.length>max?s.slice(0,max-1)+"…":s; }
function formatDate(iso){
  if(!iso) return "—";
  try{ return new Date(iso).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }
  catch{ return iso.slice(0,10); }
}

/* ──────────────────────────────────────────────────────────────
   STABLE GROUPED LAYOUT ENGINE
   - Groups nodes by clinical category (Disease, Drug, Biomarker, etc.)
   - Positions groups in a structured grid
   - Places nodes within groups in a compact, non-overlapping way
────────────────────────────────────────────────────────────── */
function useStableGroupedLayout(nodes, edges, width, height) {
  const [positions, setPositions] = useState({});
  const [d3Loaded, setD3Loaded] = useState(!!window.d3);
  const layoutRef = useRef(null);
  const animationRef = useRef(null);

  // Define group order for clinical importance (top to bottom, left to right)
  const GROUP_ORDER = [
    "disease", "subgroup", "patient_subgroup", "symptom", "symptom_sign",
    "biomarker", "diagnostic_test", "test", "classification", "classification_system",
    "drug", "surgical_procedure", "treatment", "recommendation",
    "outcome", "risk_factor", "risk", "study", "research", "research_gap"
  ];

  // Group colors for visual distinction
  const GROUP_COLORS = {
    disease: "#1a1a1a", subgroup: "#2e2e2e", symptom: "#606060",
    biomarker: "#707070", diagnostic_test: "#787878", classification: "#626262",
    drug: "#3a3a3a", recommendation: "#8a8a8a", outcome: "#4a4a4a",
    risk_factor: "#202020", study: "#555555", default: "#666666"
  };

  useEffect(() => {
    if (!window.d3) loadD3().then(() => setD3Loaded(true)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!d3Loaded || !nodes.length || !width || !height) return;
    if (layoutRef.current) cancelAnimationFrame(layoutRef.current);

    // Group nodes by type
    const groups = new Map();
    nodes.forEach(node => {
      const groupKey = node.type || "other";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(node);
    });

    // Sort groups by clinical importance
    const sortedGroups = Array.from(groups.keys()).sort((a, b) => {
      const idxA = GROUP_ORDER.indexOf(a);
      const idxB = GROUP_ORDER.indexOf(b);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    // Grid dimensions
    const cols = 5; // Number of columns in group grid
    const groupWidth = Math.min(240, (width - 100) / cols);
    const groupHeight = 180;
    const startX = 60;
    const startY = 60;

    // Calculate positions for each group
    const groupPositions = new Map();
    sortedGroups.forEach((group, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      groupPositions.set(group, {
        x: startX + col * groupWidth,
        y: startY + row * groupHeight,
        width: groupWidth,
        height: groupHeight
      });
    });

    // Position nodes within each group using D3 force layout (light, contained)
    const allNodesWithPositions = [...nodes];
    const groupNodeMap = new Map();
    
    // Initialize positions
    allNodesWithPositions.forEach(node => {
      const group = node.type || "other";
      const groupPos = groupPositions.get(group);
      if (groupPos) {
        // Initial position within group bounds
        node.x = groupPos.x + (groupPos.width / 2) + (Math.random() - 0.5) * 60;
        node.y = groupPos.y + (groupPos.height / 2) + (Math.random() - 0.5) * 40;
        node.fx = null;
        node.fy = null;
        if (!groupNodeMap.has(group)) groupNodeMap.set(group, []);
        groupNodeMap.get(group).push(node);
      } else {
        node.x = width / 2 + (Math.random() - 0.5) * 100;
        node.y = height / 2 + (Math.random() - 0.5) * 100;
      }
    });

    // Build edges with node references
    const nodeMap = new Map(allNodesWithPositions.map(n => [n.id, n]));
    const edgesWithRefs = edges
      .map(e => ({
        ...e,
        source: typeof e.source === "object" ? e.source.id : e.source,
        target: typeof e.target === "object" ? e.target.id : e.target
      }))
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map(e => ({
        ...e,
        source: nodeMap.get(e.source),
        target: nodeMap.get(e.target)
      }));

    const d3 = window.d3;
    if (!d3) return;

    // Create containment forces for each group
    const containmentForces = [];
    for (const [group, groupNodes] of groupNodeMap.entries()) {
      const bounds = groupPositions.get(group);
      if (bounds && groupNodes.length > 0) {
        groupNodes.forEach(node => {
          // Apply soft containment (spring to center)
          node.groupCenterX = bounds.x + bounds.width / 2;
          node.groupCenterY = bounds.y + bounds.height / 2;
          node.groupStrength = 0.08;
        });
      }
    }

    // Run force simulation
    const simulation = d3.forceSimulation(allNodesWithPositions)
      .force("link", d3.forceLink(edgesWithRefs).id(d => d.id).distance(70).strength(0.3))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force("collision", d3.forceCollide(20).strength(0.7))
      .force("group", () => {
        // Custom group containment force
        for (const node of allNodesWithPositions) {
          if (node.groupCenterX !== undefined) {
            const dx = node.groupCenterX - node.x;
            const dy = node.groupCenterY - node.y;
            node.vx += dx * node.groupStrength;
            node.vy += dy * node.groupStrength;
          }
        }
      })
      .alphaTarget(0.1)
      .velocityDecay(0.6)
      .on("tick", () => {
        const newPositions = {};
        allNodesWithPositions.forEach(node => {
          if (node.x && node.y) {
            // Clamp to within group bounds if needed
            if (node.groupCenterX !== undefined) {
              const bounds = groupPositions.get(node.type);
              if (bounds) {
                node.x = Math.max(bounds.x - 10, Math.min(bounds.x + bounds.width + 10, node.x));
                node.y = Math.max(bounds.y - 10, Math.min(bounds.y + bounds.height + 10, node.y));
              }
            }
            newPositions[node.id] = { x: node.x, y: node.y };
          }
        });
        setPositions(newPositions);
      });

    // Stop after stabilization
    setTimeout(() => {
      if (simulation) simulation.alphaTarget(0).stop();
    }, 2000);

    layoutRef.current = simulation;
    return () => {
      if (layoutRef.current) layoutRef.current.stop();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [nodes, edges, width, height, d3Loaded]);

  return positions;
}
/* ──────────────────────────────────────────────────────────────
   GRAPH CANVAS with Stable Grouped Layout
────────────────────────────────────────────────────────────── */
function GraphCanvas({nodes,edges,selected,onSelect,layout}){
  const containerRef=useRef(null);
  const svgRef=useRef(null);
  const [dims,setDims]=useState({w:900,h:600});
  const [transform,setTransform]=useState({x:0,y:0,k:1});
  const [drag,setDrag]=useState(null);
  const [tooltip,setTooltip]=useState(null);
  
  // Use stable grouped layout (ignores the 'layout' prop, always grouped)
  const positions = useStableGroupedLayout(nodes, edges, dims.w, dims.h);
  
  useEffect(()=>{
    if(!containerRef.current) return;
    const ro=new ResizeObserver(([e])=>setDims({w:e.contentRect.width||900,h:e.contentRect.height||600}));
    ro.observe(containerRef.current);
    return()=>ro.disconnect();
  },[]);
  
  useEffect(()=>{
    const el=svgRef.current; 
    if(!el) return;
    const h=(e)=>{ 
      e.preventDefault(); 
      const d=e.deltaY>0?0.88:1.14; 
      setTransform(t=>({...t,k:Math.max(0.15,Math.min(4,t.k*d))})); 
    };
    el.addEventListener("wheel",h,{passive:false});
    return()=>el.removeEventListener("wheel",h);
  },[]);
  
  const onMouseDown=(e)=>{ 
    if(e.target.closest(".node-g")) return; 
    setDrag({sx:e.clientX,sy:e.clientY,ox:transform.x,oy:transform.y}); 
  };
  
  const onMouseMove=(e)=>{ 
    if(!drag) return; 
    setTransform(t=>({...t,x:drag.ox+e.clientX-drag.sx,y:drag.oy+e.clientY-drag.sy})); 
  };
  
  const onMouseUp=()=>setDrag(null);
  
  const fitGraph=()=>{
    const xv=Object.values(positions).map(p=>p.x);
    const yv=Object.values(positions).map(p=>p.y);
    if(!xv.length) return;
    const minX=Math.min(...xv);
    const maxX=Math.max(...xv);
    const minY=Math.min(...yv);
    const maxY=Math.max(...yv);
    const gw=maxX-minX||1;
    const gh=maxY-minY||1;
    const k=Math.min(0.85*dims.w/gw,0.85*dims.h/gh,1.2);
    setTransform({k,x:dims.w/2-k*(minX+gw/2),y:dims.h/2-k*(minY+gh/2)});
  };
  
  // Auto-fit on first load
  useEffect(() => {
    if (Object.keys(positions).length > 0) {
      setTimeout(fitGraph, 100);
    }
  }, [positions]);
  
  const connected=useMemo(()=>{
    if(!selected) return null;
    const ids=new Set([selected]);
    edges.forEach(e=>{ 
      const s=typeof e.source==="object"?e.source.id:e.source;
      const t=typeof e.target==="object"?e.target.id:e.target; 
      if(s===selected) ids.add(t); 
      if(t===selected) ids.add(s); 
    });
    return ids;
  },[selected,edges]);
  
  const nodeById=useMemo(()=>{ 
    const m={}; 
    nodes.forEach(n=>{m[n.id]=n;}); 
    return m; 
  },[nodes]);
  
  const visEdges=useMemo(()=>{
    return edges.map(e=>({
      ...e,
      source:typeof e.source==="object"?e.source.id:e.source,
      target:typeof e.target==="object"?e.target.id:e.target
    }))
    .filter(e=>nodeById[e.source]&&nodeById[e.target]&&positions[e.source]&&positions[e.target]);
  },[edges,nodeById,positions]);
  
  // Group nodes by type for display (show group labels)
  const groupBounds = useMemo(() => {
    const bounds = new Map();
    nodes.forEach(node => {
      const pos = positions[node.id];
      if (!pos) return;
      const type = node.type || "other";
      if (!bounds.has(type)) {
        bounds.set(type, { minX: pos.x, maxX: pos.x, minY: pos.y, maxY: pos.y, count: 1 });
      }
      const b = bounds.get(type);
      b.minX = Math.min(b.minX, pos.x);
      b.maxX = Math.max(b.maxX, pos.x);
      b.minY = Math.min(b.minY, pos.y);
      b.maxY = Math.max(b.maxY, pos.y);
      b.count++;
    });
    return bounds;
  }, [nodes, positions]);
  
  return(
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-white" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} style={{cursor:drag?"grabbing":"grab"}}>
      <svg ref={svgRef} width={dims.w} height={dims.h} style={{display:"block",width:"100%",height:"100%"}} onClick={()=>onSelect(null)}>
        <defs>
          <marker id="arr-bw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10Z" fill="rgba(0,0,0,0.4)"/>
          </marker>
          <marker id="arr-contra" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10Z" fill="#000"/>
          </marker>
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Draw group background boxes for visual grouping */}
          {Array.from(groupBounds.entries()).map(([type, bounds]) => {
            const groupColor = nodeColor({ type }) + "08";
            const borderColor = nodeColor({ type }) + "33";
            const padding = 15;
            return (
              <rect
                key={`group-${type}`}
                x={bounds.minX - padding}
                y={bounds.minY - padding - 15}
                width={bounds.maxX - bounds.minX + padding * 2}
                height={bounds.maxY - bounds.minY + padding * 2 + 20}
                rx={6}
                fill={groupColor}
                stroke={borderColor}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.5}
              />
            );
          })}
          
          {/* Group labels */}
          {Array.from(groupBounds.entries()).map(([type, bounds]) => {
            const label = type.replace(/_/g, " ").toUpperCase();
            return (
              <text
                key={`label-${type}`}
                x={bounds.minX + (bounds.maxX - bounds.minX) / 2}
                y={bounds.minY - 8}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill="#6b7280"
                letterSpacing="0.1em"
                className="group-label"
              >
                {label} ({bounds.count})
              </text>
            );
          })}
          
          {/* Edges */}
          <g>
            {visEdges.map(e=>{
              const sp=positions[e.source];
              const tp=positions[e.target]; 
              if(!sp||!tp) return null; 
              const isC=e.relation?.includes("contra"); 
              const sw=(e.weight??2)>=4?2:1.2; 
              return(
                <line 
                  key={e.id} 
                  x1={sp.x} y1={sp.y} 
                  x2={tp.x} y2={tp.y} 
                  stroke={edgeColor(e.relation)} 
                  strokeWidth={sw} 
                  strokeOpacity={0.6} 
                  strokeDasharray={isC?"5 3":undefined} 
                  markerEnd={`url(#${isC?"arr-contra":"arr-bw"})`}
                />
              );
            })}
          </g>
          
          {/* Nodes */}
          <g>
            {nodes.map(n=>{ 
              const pos=positions[n.id]; 
              if(!pos) return null; 
              const r=nodeRadius(n);
              const col=nodeColor(n);
              const isSel=selected===n.id;
              const isDim=connected&&!connected.has(n.id); 
              return(
                <g 
                  key={n.id} 
                  className="node-g" 
                  transform={`translate(${pos.x},${pos.y})`} 
                  style={{opacity:isDim?0.15:1,cursor:"pointer",transition:"opacity 0.2s"}} 
                  onClick={ev=>{ev.stopPropagation();onSelect(isSel?null:n.id);}} 
                  onMouseEnter={ev=>setTooltip({n,mx:ev.clientX,my:ev.clientY})} 
                  onMouseLeave={()=>setTooltip(null)}
                >
                  {isSel && <circle r={r+5} fill="none" stroke="#000" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5}/>}
                  <circle r={r} fill={isSel?col:"#fff"} stroke={col} strokeWidth={isSel?2:1.8}/>
                  <text className="node-text" fill={isSel?"#fff":col} y={r+11} style={{fontSize:"7.5px"}}>
                    {trunc(n.label||n.id,15)}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {tooltip && (
        <div className="fade-up" style={{position:"fixed",left:tooltip.mx+14,top:tooltip.my-10,background:"#000",color:"#fff",padding:"6px 10px",fontSize:11,pointerEvents:"none",zIndex:999,maxWidth:200,boxShadow:"0 4px 16px rgba(0,0,0,0.25)"}}>
          <div style={{fontWeight:600}}>{tooltip.n.label||tooltip.n.id}</div>
          <div style={{color:"#9ca3af",fontSize:10,marginTop:2}}>{(tooltip.n.type||"").replace(/_/g," ")}</div>
        </div>
      )}
      <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",display:"flex",gap:6,background:"#fff",border:"1px solid #e5e7eb",padding:"6px 10px",boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>
        {[
          {label:"+",action:()=>setTransform(t=>({...t,k:Math.min(t.k*1.35,4)}))},
          {label:"−",action:()=>setTransform(t=>({...t,k:Math.max(t.k*0.74,0.15)}))},
          {label:"⊡",action:fitGraph},
          {label:"↺",action:()=>setTransform({x:0,y:0,k:1})}
        ].map(b=>(
          <button 
            key={b.label} 
            onClick={b.action} 
            style={{background:"none",border:"none",cursor:"pointer",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:"#6b7280",borderRadius:3,transition:"all 0.15s"}} 
            onMouseEnter={e=>{e.currentTarget.style.background="#f3f4f6";e.currentTarget.style.color="#000";}} 
            onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color="#6b7280";}}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
/* ──────────────────────────────────────────────────────────────
   GRAPH HISTORY SIDEBAR
────────────────────────────────────────────────────────────── */
function GraphHistorySidebar({apiBase,doctorId,activePipelineId,onSelectPipeline,onNewGraph}){
  const [pipelines,setPipelines]=useState([]);
  const [loading,setLoading]=useState(false);
  const fetchPipelines=useCallback(async()=>{
    if(!doctorId) return;
    setLoading(true);
    try{
      const res=await fetch(`${apiBase}api/hms/users/ai-legacy/graph/pipelines/${doctorId}`);
      if(!res.ok) throw new Error(`${res.status}`);
      const data=await res.json();
      setPipelines(data.pipelines||[]);
    }catch(err){ console.error("Failed to fetch pipelines:",err); }
    finally{ setLoading(false); }
  },[apiBase,doctorId]);
  useEffect(()=>{ fetchPipelines(); },[fetchPipelines]);
  useEffect(()=>{ const h=()=>fetchPipelines(); window.addEventListener("graph-uploaded",h); return()=>window.removeEventListener("graph-uploaded",h); },[fetchPipelines]);
  const labelStyle={fontSize:9,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9ca3af"};
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",fontFamily:"var(--font)"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={labelStyle}>Saved Graphs</span>
        <div style={{display:"flex",gap:6}}>
          <button onClick={fetchPipelines} title="Refresh" style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:13,padding:2,lineHeight:1}} onMouseEnter={e=>e.currentTarget.style.color="#000"} onMouseLeave={e=>e.currentTarget.style.color="#9ca3af"}>↻</button>
          <button onClick={onNewGraph} title="Upload new graph" style={{background:"#000",border:"none",cursor:"pointer",color:"#fff",fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",padding:"3px 8px",borderRadius:2,fontFamily:"var(--font)"}}>+ New</button>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {loading&&(<div style={{padding:20,textAlign:"center"}}><div className="spin" style={{width:18,height:18,border:"2px solid #e5e7eb",borderTopColor:"#000",borderRadius:"50%",margin:"0 auto"}}/></div>)}
        {!loading&&pipelines.length===0&&(<div style={{padding:"20px 14px",fontSize:11,color:"#9ca3af",textAlign:"center",lineHeight:1.6}}>No graphs yet.<br/>Upload a guideline to begin.</div>)}
        {!loading&&pipelines.map((p,i)=>{
          const isActive=p.pipeline_id===activePipelineId;
          return(
            <div key={p.pipeline_id} className={`graph-list-item${isActive?" active":""}`} onClick={()=>onSelectPipeline(p.pipeline_id)}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                <div style={{width:6,height:6,borderRadius:"50%",flexShrink:0,background:isActive?"#fff":"#000"}}/>
                <span style={{fontSize:10,fontWeight:700,color:isActive?"#fff":"#111",letterSpacing:"0.02em"}}>{(p.source_names||[]).join(", ").slice(0,28)||`Run #${i+1}`}</span>
              </div>
              <div style={{paddingLeft:12,display:"flex",gap:10}}>
                <span style={{fontSize:9,color:isActive?"#ccc":"#9ca3af"}}>{formatDate(p.generated_at)}</span>
                <span style={{fontSize:9,color:isActive?"#ccc":"#9ca3af"}}>{p.total_nodes??"?"} nodes</span>
                <span style={{fontSize:9,color:isActive?"#ccc":"#9ca3af"}}>{p.total_edges??"?"} edges</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ──────────────────────────────────────────────────────────────
   POLLING SCREEN — shown while Celery task is running
────────────────────────────────────────────────────────────── */
const PIPELINE_STAGES = [
  "Extracting text",
  "Parsing entities",
  "Building relationships",
  "Resolving conflicts",
  "Scoring evidence",
  "Generating pathways",
  "Creating reasoning chains",
  "Finalizing graph",
];

function PollingScreen({ taskStatus, phase, onCancel }) {
  const [tick, setTick] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      setElapsed((e) => e + 1);
      setStageIdx((i) => Math.min(i + (Math.random() > 0.7 ? 1 : 0), PIPELINE_STAGES.length - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const dots = ["●  ○  ○", "○  ●  ○", "○  ○  ●"][tick % 3];
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const progressPct = Math.min(((stageIdx + 1) / PIPELINE_STAGES.length) * 100, 95);

  return (
    <div style={{ padding: 40, maxWidth: 440, margin: "0 auto", textAlign: "center", fontFamily: "var(--font)" }}>
      <div style={{ position: "relative", width: 56, height: 56, margin: "0 auto 20px" }}>
        <div
          className="spin"
          style={{ width: 56, height: 56, border: "2px solid #f3f4f6", borderTopColor: "#000", borderRadius: "50%" }}
        />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
          ◆
        </div>
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 6 }}>
        Processing Pipeline
      </div>

      <div style={{ fontSize: 13, color: "#111", fontWeight: 600, marginBottom: 4 }}>
        {PIPELINE_STAGES[stageIdx]}…
      </div>

      <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 20, fontFamily: "var(--mono)" }}>
        {dots}  {elapsedStr}
      </div>

      <div style={{ height: 3, background: "#f3f4f6", borderRadius: 2, overflow: "hidden", marginBottom: 24 }}>
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            background: "#000",
            borderRadius: 2,
            transition: "width 0.8s ease",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 24, textAlign: "left" }}>
        {PIPELINE_STAGES.map((s, i) => {
          const done = i < stageIdx;
          const current = i === stageIdx;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, opacity: done || current ? 1 : 0.3 }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                background: done ? "#000" : current ? "#f3f4f6" : "#f9fafb",
                border: current ? "2px solid #000" : "1px solid #e5e7eb",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {done && <span style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}>✓</span>}
                {current && <div className="spin" style={{ width: 8, height: 8, border: "1.5px solid #e5e7eb", borderTopColor: "#000", borderRadius: "50%" }} />}
              </div>
              <span style={{ fontSize: 11, color: done ? "#6b7280" : current ? "#000" : "#d1d5db", fontWeight: current ? 600 : 400 }}>
                {s}
              </span>
            </div>
          );
        })}
      </div>

      {taskStatus && (
        <div style={{ padding: "6px 10px", background: "#f8f8f8", border: "1px solid #e5e7eb", borderRadius: 3, fontSize: 10, color: "#6b7280", fontFamily: "var(--mono)", marginBottom: 16 }}>
          task: {taskStatus.task_id?.slice(0, 24) ?? "queued"}…
        </div>
      )}

      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16, lineHeight: 1.6 }}>
        This takes 1–3 minutes depending on document size.<br />
        The graph will load automatically when ready.
      </div>

      <button
        onClick={onCancel}
        style={{ background: "none", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af", padding: "5px 14px", fontFamily: "var(--font)" }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#000"; e.currentTarget.style.color = "#000"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.color = "#9ca3af"; }}
      >
        Cancel
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   UPLOAD PANEL  — supports Files / URL / Both modes
────────────────────────────────────────────────────────────── */
function UploadPanel({ apiBase, onGraph }) {
  const params = new URLSearchParams(window.location.search);
  const doctorId = params.get("doctorId");

  const [mode, setMode] = useState("files");
  const [files, setFiles] = useState([]);
  const [urls, setUrls] = useState([]);
  const [urlInput, setUrlInput] = useState("");
  const [source, setSource] = useState("nccn");
  const [version, setVersion] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");

  const [phase, setPhase] = useState("idle");
  const [taskStatus, setTaskStatus] = useState(null);
  const [pollError, setPollError] = useState(null);
  const pollRef = useRef(null);

  const dropRef = useRef(null);
  const SOURCES = ["nccn", "acog", "esmo", "nejm", "lancet", "asco", "other"];

  useEffect(() => () => clearInterval(pollRef.current), []);

  const addFiles = (fs) =>
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...[...fs].filter((f) => !names.has(f.name))];
    });

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const addUrl = () => {
    const v = urlInput.trim();
    if (!v || !v.startsWith("http")) return;
    if (!urls.includes(v)) setUrls((prev) => [...prev, v]);
    setUrlInput("");
  };

  const canRun =
    mode === "files"
      ? files.length > 0
      : mode === "urls"
      ? urls.length > 0
      : files.length > 0 || urls.length > 0;

  const extractPipelineId = (task) => {
    if (task.result?.pipeline_id) return task.result.pipeline_id;
    if (task.pipeline_id) return task.pipeline_id;
    if (task.result?.graph?.pipeline_id) return task.result.graph.pipeline_id;
    if (task.result?.id) return task.result.id;
    return null;
  };

  const startPolling = useCallback(() => {
    if (!doctorId) return;
    setPhase("polling");

    let attempts = 0;
    const MAX_ATTEMPTS = 120;

    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setPollError("Timed out waiting for pipeline to complete.");
        setPhase("error");
        return;
      }

      try {
        const res = await fetch(
          `${apiBase}api/hms/users/data/context/api/pipeline/tasks/${doctorId}/latest`
        );
        if (!res.ok) {
          if (res.status !== 404) {
            console.warn(`Polling got status ${res.status}, continuing...`);
          }
          return;
        }

        const data = await res.json();
        const task = data.latest_task;
        setTaskStatus(task);

        if (!task) return;

        if (task.status === "completed") {
          clearInterval(pollRef.current);
          
          const pipelineId = extractPipelineId(task);
          
          if (!pipelineId) {
            console.error("Task completed but no pipeline_id found. Task data:", task);
            setPollError("Task completed but no pipeline ID found. Please refresh and try again.");
            setPhase("error");
            return;
          }

          console.log("✅ Pipeline completed with ID:", pipelineId);
          setPhase("done");

          try {
            const graphRes = await fetch(
              `${apiBase}api/hms/users/ai-legacy/pipeline/graph/doctor/${doctorId}/pipeline/${pipelineId}`
            );
            
            if (!graphRes.ok) {
              throw new Error(`HTTP ${graphRes.status}`);
            }
            
            const graphData = await graphRes.json();
            
            window.dispatchEvent(new Event("graph-uploaded"));
            onGraph(graphData.graph ?? graphData, pipelineId);
            
          } catch (graphErr) {
            console.error("Failed to fetch graph:", graphErr);
            setPollError(`Pipeline completed but failed to load graph: ${graphErr.message}`);
            setPhase("error");
          }
          return;
        }

        if (task.status === "failed") {
          clearInterval(pollRef.current);
          const errorMsg = task.error_message || 
                         task.result?.error || 
                         task.result?.detail ||
                         "Pipeline failed. Please try again.";
          setPollError(errorMsg);
          setPhase("error");
          return;
        }
        
      } catch (err) {
        console.error("Poll error:", err);
      }
    }, 3000);
  }, [apiBase, doctorId, onGraph]);

  const runPipeline = async () => {
    if (!canRun) { setStatus("Please add at least one file or URL."); return; }

    setRunning(true);
    setPhase("submitted");
    setStatus("");
    setPollError(null);

    try {
      const hasFiles = (mode === "files" || mode === "both") && files.length > 0;
      const hasUrls  = (mode === "urls"  || mode === "both") && urls.length > 0;

      if (hasFiles) {
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        form.append("guideline_source", source);
        if (version) form.append("version", version);
        const res = await fetch(
          `${apiBase}api/hms/users/ai-legacy/pipeline/run?doctor_id=${doctorId}`,
          { method: "POST", body: form }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
        startPolling();
        return;
      }

      if (hasUrls) {
        const res = await fetch(
          `${apiBase}api/hms/users/ai-legacy/pipeline/run-urls?doctor_id=${doctorId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              urls,
              guideline_source: source,
              version: version || undefined,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
        startPolling();
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      setPhase("idle");
    } finally {
      setRunning(false);
    }
  };

  const resetForm = () => {
    clearInterval(pollRef.current);
    setPhase("idle");
    setPollError(null);
    setTaskStatus(null);
    setFiles([]);
    setUrls([]);
    setStatus("");
  };

  const inputStyle = {
    width: "100%",
    padding: "6px 10px",
    border: "1px solid #e5e7eb",
    fontSize: 12,
    fontFamily: "var(--font)",
    outline: "none",
    background: "#fff",
    color: "#000",
    transition: "border-color 0.2s",
  };

  if (phase === "submitted" || phase === "polling") {
    return (
      <PollingScreen
        taskStatus={taskStatus}
        phase={phase}
        onCancel={resetForm}
      />
    );
  }

  if (phase === "error") {
    return (
      <div style={{ padding: 40, maxWidth: 420, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>◆</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#dc2626" }}>
          Pipeline Failed
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 20, lineHeight: 1.6 }}>
          {pollError}
        </div>
        <button
          onClick={resetForm}
          style={{
            padding: "8px 20px", background: "#000", color: "#fff",
            border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700,
            letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "var(--font)"
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 520, margin: "0 auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 16 }}>
        Upload Guidelines — New Graph
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 20, lineHeight: 1.6, padding: "8px 10px", background: "#f8f8f8", border: "1px solid #e5e7eb" }}>
        Each upload creates a <strong>brand new</strong> knowledge graph.
      </div>

      <div style={{ display: "flex", gap: 0, border: "1px solid #e5e7eb", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
        {[["files", "Files"]].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{ flex: 1, padding: "7px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", border: "none", cursor: "pointer", fontFamily: "var(--font)", background: mode === id ? "#000" : "#fff", color: mode === id ? "#fff" : "#6b7280" }}>
            {label}
          </button>
        ))}
      </div>

      {(mode === "files" || mode === "both") && (
        <div ref={dropRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()} className="upload-zone" onClick={() => dropRef.current?.querySelector("input")?.click()}>
          <input type="file" multiple accept=".pdf,.docx,.doc,.txt,.md" style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
          <div style={{ fontSize: 28, marginBottom: 8 }}>↑</div>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "var(--font)" }}>Drop PDF / DOCX / TXT files or click to browse</div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>Supported: .pdf .docx .doc .txt .md</div>
        </div>
      )}

      {(mode === "files" || mode === "both") && files.length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "#f9fafb", border: "1px solid #e5e7eb", fontSize: 11 }}>
              <span style={{ fontFamily: "var(--mono)", color: "#374151", fontSize: 10 }}>{f.name}</span>
              <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 13 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {mode === "both" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          <span style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em" }}>and / or</span>
          <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
        </div>
      )}

      {(mode === "urls" || mode === "both") && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input type="url" placeholder="https://guidelines.example.com/…" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addUrl(); }} style={{ ...inputStyle, flex: 1 }} onFocus={(e) => (e.currentTarget.style.borderColor = "#000")} onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")} />
            <button onClick={addUrl} style={{ padding: "6px 14px", background: "#000", color: "#fff", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--font)" }}>Add</button>
          </div>
          {urls.map((u, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "#f9fafb", border: "1px solid #e5e7eb", fontSize: 10, marginBottom: 4 }}>
              <span style={{ fontFamily: "var(--mono)", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{u}</span>
              <button onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 13 }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b7280", display: "block", marginBottom: 4 }}>Guideline Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
            {SOURCES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b7280", display: "block", marginBottom: 4 }}>Version (optional)</label>
          <input type="text" placeholder="e.g. 2024.1" value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <button
        onClick={runPipeline}
        disabled={running || !canRun}
        style={{ width: "100%", padding: "10px 0", background: running || !canRun ? "#9ca3af" : "#000", color: "#fff", border: "none", cursor: running || !canRun ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "var(--font)" }}
      >
        {running ? "Submitting…" : "Run 8-Stage Pipeline"}
      </button>

      {status && (
        <div style={{ marginTop: 12, fontSize: 11, color: status.startsWith("Error") ? "#dc2626" : "#059669", fontFamily: "var(--font)" }}>
          {status}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   NODE DETAIL
────────────────────────────────────────────────────────────── */
function NodeDetail({node,allEdges,allNodes,onSelectNode}){
  if(!node) return(<div style={{padding:32,textAlign:"center",color:"#9ca3af",fontSize:11,fontFamily:"var(--font)"}}>Click a node to see its clinical details.</div>);
  const col=nodeColor(node);
  const flags=Array.isArray(node.flags)?node.flags:[];
  const myEdges=allEdges.filter(e=>{ const s=typeof e.source==="object"?e.source.id:e.source,t=typeof e.target==="object"?e.target.id:e.target; return s===node.id||t===node.id; });
  const metaItems=[node.visual_priority&&["Priority",`P${node.visual_priority}`],node.guideline_source&&["Source",node.guideline_source?.toUpperCase()],node.version&&["Version",node.version],node.evidence_quality&&["Evidence",node.evidence_quality],node.strength&&["Strength",node.strength?.replace(/_/g," ")],node.drug_class&&["Class",node.drug_class],node.line_of_therapy&&["Line",node.line_of_therapy],node.biomarker_type&&["Biomarker",node.biomarker_type]].filter(Boolean);
  return(
    <div className="fade-up" style={{fontFamily:"var(--font)"}}>
      <div style={{padding:"12px 14px 0"}}>
        <span style={{display:"inline-block",fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",padding:"2px 8px",borderRadius:2,marginBottom:8,background:col+"18",color:col,border:`1px solid ${col}44`}}>{(node.type||"").replace(/_/g," ")}</span>
        <div style={{fontSize:15,fontWeight:600,color:"#000",lineHeight:1.4,marginBottom:8}}>{node.label||node.id}</div>
        <div style={{fontSize:11,color:"#6b7280",lineHeight:1.6,marginBottom:10}}>{node.description||"No description available"}</div>
      </div>
      {node.source_quote&&(<div style={{margin:"0 14px 12px",padding:"8px 10px",background:"#f8f8f8",borderLeft:"3px solid #000",fontSize:10,color:"#6b7280",fontStyle:"italic",lineHeight:1.5}}>"{node.source_quote}"</div>)}
      {flags.length>0&&(<div style={{padding:"0 14px 10px",display:"flex",flexWrap:"wrap",gap:4}}>{flags.map(f=>(<span key={f} style={{fontSize:9,padding:"2px 6px",borderRadius:2,background:"#f3f4f6",border:"1px solid #e5e7eb",color:"#374151",fontWeight:600,letterSpacing:"0.06em"}}>{f.replace(/_/g," ")}</span>))}</div>)}
      {metaItems.length>0&&(<div style={{padding:"0 14px 12px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>{metaItems.slice(0,8).map(([k,v])=>(<div key={k} style={{background:"#f8f8f8",borderRadius:3,padding:"5px 8px"}}><div style={{fontSize:9,color:"#9ca3af",marginBottom:2,letterSpacing:"0.06em"}}>{k}</div><div style={{fontSize:11,fontWeight:600,color:"#000"}}>{String(v)}</div></div>))}</div>)}
      {myEdges.length>0&&(<><div style={{padding:"6px 14px 4px",fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"#9ca3af"}}>Connections</div><div style={{padding:"0 14px 12px",display:"flex",flexWrap:"wrap",gap:4}}>{myEdges.slice(0,10).map(e=>{ const s=typeof e.source==="object"?e.source.id:e.source,t=typeof e.target==="object"?e.target.id:e.target,other=s===node.id?t:s,dir=s===node.id?"→":"←",otherNode=allNodes.find(n=>n.id===other); return(<span key={e.id+other} onClick={()=>onSelectNode(other)} style={{display:"inline-flex",alignItems:"center",gap:3,background:"#f8f8f8",border:"1px solid #e5e7eb",borderRadius:3,fontSize:10,padding:"3px 7px",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#000"} onMouseLeave={e=>e.currentTarget.style.borderColor="#e5e7eb"}><span style={{color:"#000",fontSize:9}}>{dir}</span><span style={{color:"#374151"}}>{(e.relation||"").replace(/_/g," ")}</span><span style={{color:"#9ca3af"}}>{trunc(otherNode?.label||other,18)}</span></span>); })}</div></>)}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   DELTAS PANEL
────────────────────────────────────────────────────────────── */
function DeltasPanel({deltas=[]}){
  if(!deltas.length) return(<div style={{padding:24,textAlign:"center",color:"#9ca3af",fontSize:11,fontFamily:"var(--font)"}}>No guideline deltas detected.</div>);
  const impactCol={high:"#dc2626",medium:"#d97706",low:"#059669"};
  return(
    <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,fontFamily:"var(--font)"}}>
      {deltas.map(d=>(<div key={d.id} style={{background:"#f8f8f8",border:"1px solid #e5e7eb",borderRadius:4,padding:"10px 12px"}} className="fade-up"><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><div style={{width:7,height:7,borderRadius:"50%",background:impactCol[d.impact_level]||"#9ca3af"}}/><span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#6b7280"}}>{(d.change_type||"").replace(/_/g," ")}</span><span style={{marginLeft:"auto",fontSize:9,fontWeight:600,color:impactCol[d.impact_level]||"#6b7280",textTransform:"uppercase"}}>{d.impact_level}</span></div><div style={{fontSize:12,color:"#111",lineHeight:1.5,marginBottom:4}}>{d.what_changed}</div><div style={{fontSize:10,color:"#6b7280",lineHeight:1.4}}>{d.why_changed}</div></div>))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   REASONING PANEL
────────────────────────────────────────────────────────────── */
function ReasoningPanel({chains=[],apiBase,pipelineId,onNewChain}){
  const [q,setQ]=useState("");
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");
  const ask=async()=>{
    if(!q.trim()) return;
    setLoading(true); setErr("");
    try{
      const res=await fetch(`${apiBase}api/hms/users/ai-legacy/pipeline/query`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clinical_question:q,pipeline_id:pipelineId})});
      if(!res.ok) throw new Error(`${res.status}`);
      const data=await res.json();
      onNewChain({id:`q_${Date.now()}`,clinical_question:q,final_answer:data.what_changed||data.final_answer||data.answer||JSON.stringify(data),confidence:data.confidence||0.8});
      setQ("");
    }catch(e){ setErr(e.message); }
    finally{ setLoading(false); }
  };
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",fontFamily:"var(--font)"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid #f0f0f0"}}>
        <textarea rows={2} placeholder="Ask a clinical question…" value={q} onChange={e=>setQ(e.target.value)} style={{width:"100%",padding:"6px 8px",border:"1px solid #e5e7eb",fontSize:11,fontFamily:"var(--font)",resize:"none",outline:"none",color:"#000",background:"#fff"}} onFocus={e=>e.currentTarget.style.borderColor="#000"} onBlur={e=>e.currentTarget.style.borderColor="#e5e7eb"} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask();}}}/>
        <button onClick={ask} disabled={loading||!q.trim()||!pipelineId} style={{marginTop:6,padding:"5px 14px",background:loading?"#9ca3af":"#000",color:"#fff",border:"none",cursor:loading?"not-allowed":"pointer",fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"var(--font)"}}>{loading?"Asking…":"Ask"}</button>
        {!pipelineId&&<div style={{fontSize:9,color:"#9ca3af",marginTop:4}}>Load a pipeline to enable live Q&A.</div>}
        {err&&<div style={{fontSize:10,color:"#dc2626",marginTop:4}}>{err}</div>}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:8}}>
        {!chains.length&&<div style={{textAlign:"center",color:"#9ca3af",fontSize:11,padding:24}}>No reasoning chains yet.</div>}
        {chains.map(c=>{ const pct=Math.round((c.confidence||0)*100); return(<div key={c.id} style={{background:"#f8f8f8",border:"1px solid #e5e7eb",borderRadius:4,padding:"10px 12px"}} className="fade-up"><div style={{fontSize:10,fontWeight:700,color:"#000",marginBottom:5}}>{c.clinical_question}</div><div style={{fontSize:11,color:"#374151",lineHeight:1.6,marginBottom:8}}>{c.final_answer||"—"}</div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:9,color:"#9ca3af"}}>{pct}% conf</span><div style={{flex:1,height:2,background:"#e5e7eb",borderRadius:1}}><div style={{width:`${pct}%`,height:"100%",background:"#000",borderRadius:1}}/></div></div></div>); })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   PATHWAYS PANEL
────────────────────────────────────────────────────────────── */
function PathwaysPanel({protocols=[]}){
  const [expanded,setExpanded]=useState(null);
  if(!protocols.length) return(<div style={{padding:24,textAlign:"center",color:"#9ca3af",fontSize:11,fontFamily:"var(--font)"}}>No protocol pathways extracted.</div>);
  return(
    <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:8,fontFamily:"var(--font)"}}>
      {protocols.map(p=>(<div key={p.id} style={{background:"#f8f8f8",border:"1px solid #e5e7eb",borderRadius:4,overflow:"hidden"}} className="fade-up"><div style={{padding:"10px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}} onClick={()=>setExpanded(expanded===p.id?null:p.id)}><div><div style={{fontSize:11,fontWeight:600,color:"#000"}}>{p.name}</div><div style={{fontSize:9,color:"#9ca3af",marginTop:2}}>{p.applicable_population}</div></div><span style={{fontSize:13,color:"#9ca3af"}}>{expanded===p.id?"▲":"▼"}</span></div>{expanded===p.id&&(<div style={{padding:"0 12px 10px",borderTop:"1px solid #e5e7eb"}}><div style={{fontSize:10,color:"#6b7280",margin:"8px 0 10px",lineHeight:1.5}}><strong>Q:</strong> {p.clinical_question}</div>{(p.steps||[]).map((s,i)=>(<div key={i} style={{display:"flex",gap:8,marginBottom:8}}><div style={{width:20,height:20,borderRadius:"50%",background:"#000",color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{s.step_number}</div><div><div style={{fontSize:11,color:"#000",fontWeight:500}}>{s.action}</div>{s.condition_to_proceed&&<div style={{fontSize:9,color:"#6b7280",marginTop:2}}>→ {s.condition_to_proceed}</div>}{(s.branch_positive||s.branch_negative)&&(<div style={{fontSize:9,marginTop:2,display:"flex",gap:8}}>{s.branch_positive&&<span style={{color:"#059669"}}>✓ {s.branch_positive}</span>}{s.branch_negative&&<span style={{color:"#dc2626"}}>✗ {s.branch_negative}</span>}</div>)}</div></div>))}{p.terminal_outcomes?.length>0&&<div style={{marginTop:6,fontSize:9,color:"#6b7280"}}><strong>Outcomes:</strong> {p.terminal_outcomes.join(" · ")}</div>}</div>)}</div>))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ▶  COMPARISON PANEL  (previously ClinicalGraphComparison)
   Lives entirely inside the right sidebar as a 5th tab.
══════════════════════════════════════════════════════════════ */

const SEV_CONFIG={
  critical:{label:"Critical",icon:"⛔",cls:"sev-critical",color:"#dc2626"},
  high:    {label:"High",    icon:"⚠", cls:"sev-high",    color:"#d97706"},
  moderate:{label:"Moderate",icon:"◆", cls:"sev-moderate",color:"#2563eb"},
  low:     {label:"Low",     icon:"●", cls:"sev-low",     color:"#059669"},
  info:    {label:"Info",    icon:"＋",cls:"sev-info",     color:"#7c3aed"},
};
const CAT_LABELS={
  outdated_recommendation:"Outdated Rec",changed_evidence:"Evidence Change",
  new_contraindication:"New Contraindication",removed_contraindication:"Contraindication Removed",
  removed_treatment:"Removed Treatment",safety_alert:"Safety Alert",
  drug_approval_change:"Drug Approval",staging_criteria_change:"Staging Change",
  conflicting_evidence:"Conflict",missing_biomarker:"Missing Biomarker",
  superior_study:"Superior Study",pathway_change:"Pathway Change",
  added_recommendation:"New Recommendation",evidence_upgrade:"Evidence Upgrade",
  evidence_downgrade:"Evidence Downgrade",
};

function FindingCard({finding}){
  const [expanded,setExpanded]=useState(false);
  const sev=SEV_CONFIG[finding.severity]||SEV_CONFIG.low;
  const catLabel=CAT_LABELS[finding.category]||finding.category;
  return(
    <div className={`finding-card ${sev.cls}`} onClick={()=>setExpanded(e=>!e)}>
      <div style={{display:"flex",alignItems:"flex-start",gap:6,marginBottom:3}}>
        <span style={{fontSize:12,flexShrink:0,marginTop:1}}>{sev.icon}</span>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:3,marginBottom:3}}>
            <span className="sev-badge">{sev.label}</span>
            <span className="cat-badge">{catLabel}</span>
          </div>
          <div style={{fontSize:11,fontWeight:600,color:"#0a0a0a",lineHeight:1.4}}>{finding.title}</div>
        </div>
        <span style={{fontSize:9,color:"#9ca3af",flexShrink:0,marginTop:2}}>{expanded?"▲":"▼"}</span>
      </div>
      {expanded&&(
        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid var(--sev-border)"}}>
          {finding.description&&<p style={{fontSize:11,color:"#374151",lineHeight:1.6,marginBottom:8}}>{finding.description}</p>}
          {(finding.baseline_value||finding.comparison_value)&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
              {finding.baseline_value&&(<div style={{background:"#fff",border:"1px solid var(--sev-border)",borderRadius:3,padding:"5px 7px"}}><div style={{fontSize:9,color:"#9ca3af",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Baseline</div><div style={{fontSize:10,color:"#374151",fontFamily:"var(--mono)"}}>{finding.baseline_value}</div></div>)}
              {finding.comparison_value&&(<div style={{background:"#fff",border:"1px solid var(--sev-border)",borderRadius:3,padding:"5px 7px"}}><div style={{fontSize:9,color:"#9ca3af",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Comparison</div><div style={{fontSize:10,color:"#374151",fontFamily:"var(--mono)"}}>{finding.comparison_value}</div></div>)}
            </div>
          )}
          {finding.clinical_impact&&(<div style={{marginBottom:5}}><span style={{fontSize:9,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>Clinical Impact: </span><span style={{fontSize:11,color:"#374151"}}>{finding.clinical_impact}</span></div>)}
          {finding.action_required&&(<div style={{background:"rgba(0,0,0,0.04)",borderRadius:3,padding:"5px 7px"}}><span style={{fontSize:9,fontWeight:700,color:"#000",textTransform:"uppercase",letterSpacing:"0.06em"}}>Action: </span><span style={{fontSize:11,color:"#0a0a0a",fontWeight:500}}>{finding.action_required}</span></div>)}
          {finding.evidence_quote&&(<div style={{marginTop:8,padding:"5px 8px",borderLeft:"2px solid var(--sev)",background:"#fff",fontSize:10,color:"#6b7280",fontStyle:"italic",lineHeight:1.5}}>"{finding.evidence_quote}"</div>)}
        </div>
      )}
    </div>
  );
}

function PathwayDiffCard({diff}){
  const [exp,setExp]=useState(false);
  const typeColor={added:"#059669",removed:"#dc2626",modified:"#d97706",reordered:"#2563eb"};
  const color=typeColor[diff.change_type]||"#9ca3af";
  return(
    <div style={{border:"1px solid #e5e7eb",borderLeft:`3px solid ${color}`,borderRadius:3,marginBottom:7,overflow:"hidden"}}>
      <div style={{padding:"8px 10px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}} onClick={()=>setExp(e=>!e)}>
        <div><span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color,marginRight:6,fontFamily:"var(--mono)"}}>{diff.change_type}</span><span style={{fontSize:11,fontWeight:600,color:"#0a0a0a"}}>{diff.pathway_name}</span></div>
        <span style={{fontSize:10,color:"#9ca3af"}}>{exp?"▲":"▼"}</span>
      </div>
      {exp&&(<div style={{padding:"0 10px 8px",borderTop:"1px solid #f0f0f0"}}><p style={{fontSize:11,color:"#6b7280",lineHeight:1.5,margin:"6px 0"}}>{diff.description}</p>{diff.steps_added?.length>0&&(<div style={{marginBottom:5}}><div style={{fontSize:9,fontWeight:700,color:"#059669",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Steps Added</div>{diff.steps_added.map((s,i)=><div key={i} style={{fontSize:11,color:"#374151",padding:"1px 0"}}>+ {s}</div>)}</div>)}{diff.steps_removed?.length>0&&(<div><div style={{fontSize:9,fontWeight:700,color:"#dc2626",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Steps Removed</div>{diff.steps_removed.map((s,i)=><div key={i} style={{fontSize:11,color:"#374151",padding:"1px 0"}}>− {s}</div>)}</div>)}</div>)}
    </div>
  );
}

function StatsRow({report}){
  const stats=[{label:"Critical",val:report.critical_count,color:"#dc2626"},{label:"High",val:report.high_count,color:"#d97706"},{label:"Moderate",val:report.moderate_count,color:"#2563eb"},{label:"Low",val:report.low_count,color:"#059669"},{label:"Total",val:report.total_findings,color:"#000"}];
  return(
    <div style={{display:"flex",borderBottom:"1px solid #f0f0f0"}}>
      {stats.map(s=>(<div key={s.label} style={{flex:1,padding:"8px 0",textAlign:"center",borderRight:"1px solid #f0f0f0"}}><div style={{fontSize:18,fontWeight:700,color:s.color,fontFamily:"var(--mono)",lineHeight:1.2}}>{s.val}</div><div style={{fontSize:9,color:"#9ca3af",letterSpacing:"0.06em",textTransform:"uppercase",marginTop:2}}>{s.label}</div></div>))}
    </div>
  );
}

const CMP_TABS=[
  {id:"all",label:"All",key:"findings"},{id:"critical",label:"Critical",key:"critical_findings"},
  {id:"safety",label:"Safety",key:"safety_alerts"},{id:"contra",label:"Contra",key:"contraindications"},
  {id:"evidence",label:"Evidence",key:"evidence_changes"},{id:"treatments",label:"Treatments",key:"removed_treatments"},
  {id:"biomarkers",label:"Biomarkers",key:"missing_biomarkers"},{id:"studies",label:"Studies",key:"superior_studies"},
  {id:"recs",label:"New Recs",key:"added_recommendations"},{id:"pathways",label:"Pathways",key:null},
];

function CmpUploadForm({onRun, loading}){
  const [files, setFiles] = useState([]);
  const [urls, setUrls] = useState([]);
  const [urlInput, setUrlInput] = useState("");
  const [mode, setMode] = useState("files");
  const [source, setSource] = useState("other");
  const [version, setVersion] = useState("");
  const dropRef = useRef(null);
  const SOURCES = ["nccn","acog","esmo","nejm","lancet","asco","other"];

  const addFiles = fs => setFiles(prev => {
    const names = new Set(prev.map(f => f.name));
    return [...prev, ...[...fs].filter(f => !names.has(f.name))];
  });

  const addUrl = () => {
    const v = urlInput.trim();
    if (!v || !v.startsWith("http")) return;
    if (!urls.includes(v)) setUrls(prev => [...prev, v]);
    setUrlInput("");
  };

  const canRun = (mode === "files" || mode === "both") ? files.length > 0 : urls.length > 0;

  const inputStyle = {width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",fontSize:12,fontFamily:"var(--font)",outline:"none",background:"#fff",color:"#000",transition:"border-color 0.2s"};

  return(
    <div style={{padding:28,maxWidth:520,margin:"0 auto"}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9ca3af",marginBottom:16}}>Upload Guidelines — New Graph</div>
      <div style={{fontSize:11,color:"#6b7280",marginBottom:20,lineHeight:1.6,padding:"8px 10px",background:"#f8f8f8",border:"1px solid #e5e7eb"}}>Each upload creates a <strong>brand new</strong> knowledge graph. To view existing graphs, pick one from the sidebar.</div>

      <div style={{display:"flex",gap:0,border:"1px solid #e5e7eb",borderRadius:4,overflow:"hidden",marginBottom:16}}>
        {[["files","Files"],["urls","URL / Link"],["both","Both"]].map(([id,label]) => (
          <button key={id} onClick={() => setMode(id)}
            style={{flex:1,padding:"7px 0",fontSize:10,fontWeight:700,letterSpacing:"0.1em",
              textTransform:"uppercase",border:"none",cursor:"pointer",fontFamily:"var(--font)",
              background: mode===id ? "#000" : "#fff",
              color: mode===id ? "#fff" : "#6b7280"}}>
            {label}
          </button>
        ))}
      </div>

      {(mode === "files" || mode === "both") && (
        <div ref={dropRef}
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onDragOver={e => e.preventDefault()}
          className="upload-zone"
          onClick={() => dropRef.current?.querySelector("input")?.click()}
          onMouseEnter={e => e.currentTarget.style.borderColor="#000"}
          onMouseLeave={e => e.currentTarget.style.borderColor="#d1d5db"}>
          <input type="file" multiple accept=".pdf,.docx,.doc,.txt,.md" style={{display:"none"}} onChange={e => addFiles(e.target.files)}/>
          <div style={{fontSize:28,marginBottom:8}}>↑</div>
          <div style={{fontSize:12,color:"#6b7280",fontFamily:"var(--font)"}}>Drop PDF / DOCX / TXT files or click to browse</div>
          <div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>Supported: .pdf .docx .doc .txt .md</div>
        </div>
      )}

      {(mode === "files" || mode === "both") && files.length > 0 && (
        <div style={{marginBottom:12,display:"flex",flexDirection:"column",gap:4}}>
          {files.map((f,i) => (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 8px",background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:11}}>
              <span style={{fontFamily:"var(--mono)",color:"#374151",fontSize:10}}>{f.name}</span>
              <button onClick={() => setFiles(prev => prev.filter((_,j) => j!==i))} style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:13}}>×</button>
            </div>
          ))}
        </div>
      )}

      {mode === "both" && (
        <div style={{display:"flex",alignItems:"center",gap:8,margin:"12px 0"}}>
          <div style={{flex:1,height:1,background:"#e5e7eb"}}/>
          <span style={{fontSize:9,color:"#9ca3af",textTransform:"uppercase",letterSpacing:"0.1em"}}>and / or</span>
          <div style={{flex:1,height:1,background:"#e5e7eb"}}/>
        </div>
      )}

      {(mode === "urls" || mode === "both") && (
        <div style={{marginBottom:12}}>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <input type="url" placeholder="https://guidelines.example.com/…"
              value={urlInput} onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addUrl(); }}
              style={{...inputStyle, flex:1}}
              onFocus={e => e.currentTarget.style.borderColor="#000"}
              onBlur={e => e.currentTarget.style.borderColor="#e5e7eb"}/>
            <button onClick={addUrl}
              style={{padding:"6px 14px",background:"#000",color:"#fff",border:"none",
                cursor:"pointer",fontSize:10,fontWeight:700,letterSpacing:"0.1em",
                textTransform:"uppercase",fontFamily:"var(--font)"}}>
              Add
            </button>
          </div>
          {urls.map((u,i) => (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"4px 8px",background:"#f9fafb",border:"1px solid #e5e7eb",fontSize:10,marginBottom:4}}>
              <span style={{fontFamily:"var(--mono)",color:"#374151",overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:360}}>{u}</span>
              <button onClick={() => setUrls(prev => prev.filter((_,j) => j!==i))}
                style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:13}}>×</button>
            </div>
          ))}
          <div style={{fontSize:10,color:"#9ca3af",lineHeight:1.5,marginTop:4}}>
            Paste any publicly accessible URL. Firecrawl + httpx fallback will extract content.
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        <div>
          <label style={{fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#6b7280",display:"block",marginBottom:4}}>Guideline Source</label>
          <select value={source} onChange={e => setSource(e.target.value)} style={inputStyle}>
            {SOURCES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#6b7280",display:"block",marginBottom:4}}>Version (optional)</label>
          <input type="text" placeholder="e.g. 2024.1" value={version} onChange={e => setVersion(e.target.value)} style={inputStyle}/>
        </div>
      </div>

      <button
        onClick={() => onRun({ files, urls, source, version })}
        disabled={loading || !canRun}
        style={{
          width:"100%", padding:"10px 0",
          background: loading || !canRun ? "#9ca3af" : "#000",
          color:"#fff", border:"none",
          cursor: loading || !canRun ? "not-allowed" : "pointer",
          fontSize:11, fontWeight:700, letterSpacing:"0.15em",
          textTransform:"uppercase", fontFamily:"var(--font)"
        }}
      >
        {loading ? "Running Pipeline…" : "Run Comparison"}
      </button>
    </div>
  );
}

function ComparisonPanel({apiBase,doctorId,pipelineId}){
  const [phase,setPhase]=useState("upload");
  const [report,setReport]=useState(null);
  const [error,setError]=useState(null);
  const [cmpTab,setCmpTab]=useState("all");

  const fetchedRef = useRef(null);

  useEffect(() => {
    if (!pipelineId || !doctorId) return;
    if (fetchedRef.current === pipelineId) return;
    fetchedRef.current = pipelineId;

    setReport(null);
    setPhase("loading");

    const loadExistingComparison = async () => {
      try {
        const res = await fetch(
          `${apiBase}api/hms/users/ai-legacy/pipeline/compare/report/latest` +
          `?doctor_id=${doctorId}&baseline_pipeline_id=${pipelineId}`
        );
        if (!res.ok) {
          setPhase("upload");
          return;
        }
        const data = await res.json();
        setReport(data);
        setPhase("result");
      } catch (err) {
        console.error("Failed to load comparison:", err);
        setPhase("upload");
      }
    };

    loadExistingComparison();
  }, [pipelineId, doctorId, apiBase]);

  const runComparison = useCallback(async ({files, urls, source, version}) => {
    if (!pipelineId) { setError("No baseline pipeline loaded."); return; }
    setPhase("loading"); setError(null);
    try {
      let res;
      if (files.length > 0) {
        const form = new FormData();
        files.forEach(f => form.append("files", f));
        form.append("guideline_source", source);
        if (version) form.append("version", version);
        res = await fetch(
          `${apiBase}api/hms/users/ai-legacy/pipeline/compare/${pipelineId}?doctor_id=${doctorId}`,
          { method: "POST", body: form }
        );
      } else {
        res = await fetch(
          `${apiBase}api/hms/users/ai-legacy/pipeline/compare/${pipelineId}/url` +
          `?doctor_id=${doctorId}&url=${encodeURIComponent(urls[0])}&guideline_source=${source}` +
          (version ? `&version=${version}` : ""),
          { method: "POST" }
        );
      }
      if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(`HTTP ${res.status}: ${d.detail||"Server error"}`); }
      const data = await res.json();
      setReport(data); setPhase("result");
    } catch(err) { setError(err.message); setPhase("upload"); }
  }, [apiBase, doctorId, pipelineId]);

  if(!pipelineId){
    return(<div style={{padding:24,textAlign:"center",color:"#9ca3af",fontSize:11,fontFamily:"var(--font)",lineHeight:1.6}}>Select a graph from the sidebar first, then upload a comparison document here.</div>);
  }

  if(phase==="upload") return(
    <div style={{fontFamily:"var(--font)"}}>
      <div style={{padding:"8px 14px",background:"#f8f8f8",borderBottom:"1px solid #f0f0f0"}}>
        <span style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--mono)"}}>Baseline: <strong style={{color:"#374151"}}>{pipelineId.slice(0,20)}…</strong></span>
      </div>
      {error&&(<div style={{margin:"10px 14px 0",padding:"8px 10px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:3,fontSize:11,color:"#dc2626"}}>⛔ {error}</div>)}
      <CmpUploadForm onRun={runComparison} loading={false}/>
      <div style={{margin:"0 14px 14px",padding:"10px 12px",background:"#f8f8f8",border:"1px solid #e5e7eb",borderRadius:3}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.13em",textTransform:"uppercase",color:"#9ca3af",marginBottom:6,fontFamily:"var(--mono)"}}>What gets detected</div>
        {[["⛔","Outdated recommendations & removed treatments"],["⚠","Changed evidence grades & safety alerts"],["⛔","New / removed contraindications"],["◆","Drug approvals & staging criteria changes"],["●","Newer / superior studies & pathway diffs"]].map(([icon,label])=>(<div key={label} style={{display:"flex",gap:7,marginBottom:4}}><span style={{fontSize:11,width:16,flexShrink:0}}>{icon}</span><span style={{fontSize:11,color:"#374151"}}>{label}</span></div>))}
      </div>
    </div>
  );

  if(phase==="loading") return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:280,gap:14,fontFamily:"var(--font)"}}>
      <div className="spin" style={{width:30,height:30,border:"2px solid #e5e7eb",borderTopColor:"#000",borderRadius:"50%"}}/>
      <div style={{textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.18em",textTransform:"uppercase",color:"#9ca3af",fontFamily:"var(--mono)",marginBottom:3}}>Running Comparison</div><div style={{fontSize:11,color:"#6b7280"}}>Matching nodes, detecting contradictions…</div></div>
    </div>
  );

  const tabDef=CMP_TABS.find(t=>t.id===cmpTab)||CMP_TABS[0];
  const findings=cmpTab==="pathways"?[]:(report[tabDef.key]||[]);
  const pathwayDiffs=report.pathway_diffs||[];

  return(
    <div style={{display:"flex",flexDirection:"column",fontFamily:"var(--font)"}}>
      <div style={{padding:"6px 14px",borderBottom:"1px solid #f0f0f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--mono)"}}>vs. <strong style={{color:"#374151"}}>{pipelineId.slice(0,16)}…</strong></span>
        <button onClick={()=>{setPhase("upload");}} style={{background:"none",border:"1px solid #e5e7eb",borderRadius:2,cursor:"pointer",fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#6b7280",padding:"2px 8px",fontFamily:"var(--mono)"}} onMouseEnter={e=>e.currentTarget.style.borderColor="#000"} onMouseLeave={e=>e.currentTarget.style.borderColor="#e5e7eb"}>↺ New</button>
      </div>
      <StatsRow report={report}/>
      <div style={{margin:"10px 14px",padding:"10px 12px",background:"#f8f8f8",border:"1px solid #e5e7eb",borderRadius:3}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.13em",textTransform:"uppercase",color:"#9ca3af",fontFamily:"var(--mono)",marginBottom:6}}>Executive Summary</div>
        <p style={{fontSize:11,color:"#0a0a0a",lineHeight:1.7}}>{report.executive_summary||"Comparison complete."}</p>
        <div style={{marginTop:8,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--mono)"}}>Baseline: <strong style={{color:"#000"}}>{report.baseline_source||"—"}</strong></span>
          <span style={{fontSize:12,color:"#d1d5db"}}>⇄</span>
          <span style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--mono)"}}>Comparison: <strong style={{color:"#000"}}>{report.comparison_source||"—"}</strong></span>
        </div>
      </div>
      <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #f0f0f0",flexShrink:0}}>
        {CMP_TABS.map(t=>{
          const count=t.id==="pathways"?pathwayDiffs.length:(report[t.key]||[]).length;
          return(<button key={t.id} className={`cmp-tab-btn${cmpTab===t.id?" active":""}`} onClick={()=>setCmpTab(t.id)}>{t.label}{count>0&&(<span style={{marginLeft:4,fontSize:9,padding:"1px 4px",background:cmpTab===t.id?"#000":"#f3f4f6",color:cmpTab===t.id?"#fff":"#6b7280",borderRadius:8,fontFamily:"var(--mono)"}}>{count}</span>)}</button>);
        })}
      </div>
      <div style={{overflowY:"auto",padding:"10px 14px"}}>
        {cmpTab==="pathways"
          ?(pathwayDiffs.length===0?<div style={{padding:"24px 0",textAlign:"center",color:"#9ca3af",fontSize:11}}>◇ No pathway changes.</div>:pathwayDiffs.map((d,i)=><PathwayDiffCard key={i} diff={d}/>))
          :(findings.length===0?<div style={{padding:"24px 0",textAlign:"center",color:"#9ca3af",fontSize:11}}>◇ No findings in this category.</div>:findings.map(f=><FindingCard key={f.id} finding={f}/>))
        }
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function ClinicalKnowledgeGraph({
  apiBase="",
  pipelineId:initPipelineId=null,
}){
  const params=new URLSearchParams(window.location.search);
  const doctorId=params.get("doctorId");
  const [graph,setGraph]=useState(null);
  const [pipelineId,setPipelineId]=useState(initPipelineId);
  const [loading,setLoading]=useState(false);
  const [loadErr,setLoadErr]=useState(null);
  const [showUpload,setShowUpload]=useState(false);
  const [search,setSearch]=useState("");
  const [visibleTypes,setVisibleTypes]=useState(new Set());
  const [priorityFilter,setPriorityFilter]=useState(99);
  const [layout,setLayout]=useState("force"); // layout prop kept for compatibility, but grouped layout is always used
  const [selected,setSelected]=useState(null);
  const [rightTab,setRightTab]=useState("node");
  const [extraChains,setExtraChains]=useState([]);

  const loadGraph=useCallback(async(pid)=>{
    if(!doctorId||!pid) return;
    setLoading(true); setLoadErr(null); setShowUpload(false);
    try{
      const res=await fetch(`${apiBase}api/hms/users/ai-legacy/pipeline/graph/doctor/${doctorId}/pipeline/${pid}`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      receiveGraph(data.graph||data,pid);
    }catch(e){ setLoadErr(e.message); }
    finally{ setLoading(false); }
  },[apiBase,doctorId]);

  useEffect(()=>{ if(initPipelineId) loadGraph(initPipelineId); },[loadGraph,initPipelineId]);

  function receiveGraph(g,pid){
    setGraph(g); setPipelineId(pid||g?.pipeline_id);
    setShowUpload(false);
    setVisibleTypes(new Set((g?.nodes||[]).map(n=>n.type)));
    setExtraChains([]); setSelected(null);
  }

  const typeCounts=useMemo(()=>{ if(!graph) return {}; const c={}; (graph.nodes||[]).forEach(n=>{c[n.type]=(c[n.type]||0)+1;}); return c; },[graph]);
  const visNodes=useMemo(()=>{ if(!graph) return []; const q=search.toLowerCase(); return(graph.nodes||[]).filter(n=>visibleTypes.has(n.type)&&(n.visual_priority??2)<=priorityFilter&&(!q||n.label?.toLowerCase().includes(q)||n.type?.toLowerCase().includes(q))); },[graph,visibleTypes,priorityFilter,search]);
  const visEdges=useMemo(()=>{ if(!graph) return []; const ids=new Set(visNodes.map(n=>n.id)); return(graph.edges||[]).filter(e=>{const s=typeof e.source==="object"?e.source.id:e.source,t=typeof e.target==="object"?e.target.id:e.target;return ids.has(s)&&ids.has(t);}); },[graph,visNodes]);
  const allChains=useMemo(()=>[...(graph?.reasoning_chains||[]),...extraChains],[graph,extraChains]);
  const selectedNode=useMemo(()=>(graph?.nodes||[]).find(n=>n.id===selected)??null,[graph,selected]);

  const RIGHT_TABS=[
    {id:"node",label:"Node"},
    {id:"delta",label:"Deltas"},
    {id:"reason",label:"Reasoning"},
    {id:"pathways",label:"Pathways"},
    {id:"compare",label:"Compare"},
  ];

  if(loading) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"var(--font)"}}>
      <FontStyle/>
      <div style={{textAlign:"center"}}>
        <div className="spin" style={{width:32,height:32,border:"2px solid #e5e7eb",borderTopColor:"#000",borderRadius:"50%",margin:"0 auto 16px"}}/>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.2em",textTransform:"uppercase",color:"#9ca3af"}}>Loading Graph…</div>
      </div>
    </div>
  );

  if(loadErr) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"var(--font)"}}>
      <FontStyle/>
      <div style={{textAlign:"center",maxWidth:360}}>
        <div style={{fontSize:36,marginBottom:12,color:"#e5e7eb"}}>◆</div>
        <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Failed to Load</div>
        <div style={{fontSize:11,color:"#6b7280",marginBottom:16}}>{loadErr}</div>
        <button onClick={()=>loadGraph(pipelineId)} style={{padding:"8px 20px",background:"#000",color:"#fff",border:"none",cursor:"pointer",fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",fontFamily:"var(--font)"}}>Retry</button>
      </div>
    </div>
  );

  return(
    <>
      <FontStyle/>
      <div style={{height:"100vh",display:"grid",gridTemplateRows:"48px 1fr",gridTemplateColumns:"200px 220px 1fr 300px",overflow:"hidden",fontFamily:"var(--font)",background:"#fff",color:"#0a0a0a"}}>

        {/* ── HEADER ── */}
        <header style={{gridColumn:"1 / -1",background:"#fff",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",gap:14,padding:"0 20px",height:48}}>
          <span style={{fontSize:13,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Clinical Knowledge Graph</span>
          <span style={{fontSize:9,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",padding:"2px 8px",border:"1px solid #e5e7eb",color:"#6b7280",borderRadius:2}}>Agentic Graph RAG</span>
          {graph&&(
            <div style={{display:"flex",gap:16,marginLeft:"auto"}}>
              {[["Nodes",graph.total_nodes||(graph.nodes||[]).length],["Edges",graph.total_edges||(graph.edges||[]).length],["Pathways",graph.total_pathways||(graph.protocol_graphs||[]).length],["Deltas",graph.total_deltas||(graph.deltas||[]).length],["Chains",graph.total_chains||(graph.reasoning_chains||[]).length]].map(([l,v])=>(<span key={l} style={{fontSize:10,color:"#6b7280"}}>{l} <strong style={{color:"#000",fontWeight:700}}>{v??0}</strong></span>))}
              {pipelineId&&(<span style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--mono)",padding:"2px 6px",background:"#f3f4f6"}}>{pipelineId.slice(0,20)}…</span>)}
            </div>
          )}
          {!graph&&(<div style={{marginLeft:"auto",fontSize:10,color:"#9ca3af"}}>Select a graph from the sidebar or upload a new one</div>)}
        </header>

        {/* ── LEFT: GRAPH HISTORY ── */}
        <aside style={{background:"#fafafa",borderRight:"1px solid #e5e7eb",overflow:"hidden"}}>
          <GraphHistorySidebar apiBase={apiBase} doctorId={doctorId} activePipelineId={pipelineId} onSelectPipeline={pid=>loadGraph(pid)} onNewGraph={()=>{setShowUpload(true);setGraph(null);setPipelineId(null);}}/>
        </aside>

        {/* ── FILTER SIDEBAR ── */}
        <aside style={{background:"#fff",borderRight:"1px solid #e5e7eb",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"10px 14px",borderBottom:"1px solid #f0f0f0"}}>
            <input type="search" placeholder="Search nodes…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:11,outline:"none",color:"#000"}} onFocus={e=>e.currentTarget.style.borderColor="#000"} onBlur={e=>e.currentTarget.style.borderColor="#e5e7eb"}/>
          </div>
          <div style={{padding:"10px 14px",borderBottom:"1px solid #f0f0f0"}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9ca3af",marginBottom:8}}>Priority</div>
            <div style={{display:"flex",gap:5}}>{[["All",99],["P1",1],["P1+2",2]].map(([lbl,val],i)=>(<button key={i} onClick={()=>setPriorityFilter(val)} style={{flex:1,padding:"4px 0",border:"1px solid",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:600,background:priorityFilter===val?"#000":"#fff",color:priorityFilter===val?"#fff":"#6b7280",borderColor:priorityFilter===val?"#000":"#e5e7eb"}}>{lbl}</button>))}</div>
          </div>
          <div style={{padding:"10px 14px 4px",borderBottom:"1px solid #f0f0f0"}}><div style={{fontSize:9,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9ca3af",marginBottom:4}}>Node Types</div></div>
          <div style={{flex:1,overflowY:"auto",padding:"4px 14px 10px"}}>
            {Object.entries(typeCounts).map(([type,count])=>{ const col=COLOR[type]||"#555",on=visibleTypes.has(type); return(<div key={type} onClick={()=>{const n=new Set(visibleTypes);n.has(type)?n.delete(type):n.add(type);setVisibleTypes(n);}} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",cursor:"pointer",opacity:on?1:0.35}}><div style={{width:9,height:9,borderRadius:"50%",background:col,flexShrink:0}}/><span style={{fontSize:11,flex:1,color:"#374151"}}>{type.replace(/_/g," ")}</span><span style={{fontSize:10,color:"#9ca3af",background:"#f3f4f6",borderRadius:2,padding:"0 4px"}}>{count}</span></div>); })}
            {!graph&&<div style={{fontSize:11,color:"#d1d5db",paddingTop:8}}>No graph loaded</div>}
          </div>
          {graph&&(<div style={{padding:"10px 14px",borderTop:"1px solid #f0f0f0"}}><div style={{fontSize:9,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9ca3af",marginBottom:8}}>Layout</div><div style={{display:"flex",gap:5}}>{["force","radial"].map(l=>(<button key={l} onClick={()=>setLayout(l)} style={{flex:1,padding:"5px 0",border:"1px solid",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:600,textTransform:"capitalize",background:layout===l?"#000":"#fff",color:layout===l?"#fff":"#6b7280",borderColor:layout===l?"#000":"#e5e7eb"}}>{l}</button>))}</div></div>)}
        </aside>

        {/* ── MAIN CANVAS (now always uses grouped layout) ── */}
        <main style={{position:"relative",overflow:"hidden",background:"#fff"}}>
          {showUpload||!graph?(
            <div style={{width:"100%",height:"100%",overflowY:"auto"}}><UploadPanel apiBase={apiBase} onGraph={receiveGraph}/></div>
          ):(
            <GraphCanvas nodes={visNodes} edges={visEdges} selected={selected} onSelect={setSelected} layout={layout}/>
          )}
        </main>

        {/* ── RIGHT DETAIL PANEL ── */}
        <aside style={{background:"#fff",borderLeft:"1px solid #e5e7eb",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:"1px solid #f0f0f0",flexShrink:0}}>
            {RIGHT_TABS.map(({id,label})=>(
              <button key={id} onClick={()=>setRightTab(id)} style={{flex:1,padding:"10px 2px",fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",border:"none",background:"none",color:rightTab===id?"#000":"#9ca3af",borderBottom:rightTab===id?"2px solid #000":"2px solid transparent",
                ...(id==="compare"&&pipelineId&&rightTab!=="compare"?{color:"#2563eb"}:{}),
              }}>{label}</button>
            ))}
          </div>

          <div style={{flex:1,overflowY:"auto"}}>
            {rightTab==="node"      && <NodeDetail node={selectedNode} allEdges={graph?.edges||[]} allNodes={graph?.nodes||[]} onSelectNode={setSelected}/>}
            {rightTab==="delta"     && <DeltasPanel deltas={graph?.deltas||[]}/>}
            {rightTab==="reason"    && <ReasoningPanel chains={allChains} apiBase={apiBase} pipelineId={pipelineId} onNewChain={c=>setExtraChains(prev=>[...prev,c])}/>}
            {rightTab==="pathways"  && <PathwaysPanel protocols={graph?.protocol_graphs||[]}/>}
            {rightTab==="compare"   && <ComparisonPanel apiBase={apiBase} doctorId={doctorId} pipelineId={pipelineId}/>}
          </div>
        </aside>

      </div>
    </>
  );
}