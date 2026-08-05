import { useMemo, useState, useEffect } from "react";

// ═════════════════════════════════════════════════════════════════
// KnowledgeLineageView — 5 connected visualizations
// ═════════════════════════════════════════════════════════════════
//
//   1. Knowledge Flow      — PDF -> extraction -> relationships
//                            -> graph -> capability extraction -> skills
//   2. Knowledge Graph     — REAL backend graph (nodes/edges), fetched from
//                            GET /documents/{doctor_id}/{doc_id}/full — NOT
//                            reconstructed client-side anymore.
//   3. Skill Lineage       — pick a skill, see exactly what produced it
//   4. Evidence Tree        — expandable Guideline -> Disease -> ... tree
//   5. Relationship Explorer — searchable table of extracted triples
//
// Props:
//   preview        — the pipeline's `preview` object
//   skills         — optional override list of skills; defaults to
//                     preview.skills_preview
//   skillCoverage  — optional { llm_derived_skills, structurally_derived_skills }
//   doctorId       — REQUIRED for View 2 to fetch the real graph
//   docId          — REQUIRED for View 2 to fetch the real graph
//   graph          — optional: pass { nodes, edges } directly (backend shape)
//                     to skip the fetch entirely (e.g. if the parent already
//                     loaded it via /documents/{doctorId}/{docId}/full or
//                     /jobs/{docId}/full)
//   apiBase        — optional override for the fetch URL prefix (defaults to
//                     the same "api/hms/users/ai-legacy/phase1" prefix your
//                     app already uses in API_ENDPOINTS)
// ═════════════════════════════════════════════════════════════════

const INK = "#000";
const PAPER = "#fff";

const FIELD_LABELS = {
  disease_overview: "Disease overview",
  clinical_presentation: "Clinical presentation",
  diagnostic_criteria: "Diagnostic criteria",
  investigations: "Investigations",
  biomarkers: "Biomarkers",
  molecular_testing: "Molecular testing",
  staging: "Staging",
  risk_stratification: "Risk stratification",
  subtypes: "Subtypes",
  diagnostic_pathway: "Diagnostic pathway",
  special_populations: "Special populations",
  key_evidence: "Key evidence",
  differential_diagnosis: "Differential diagnosis",
  exclusion_criteria: "Exclusion criteria",
  treatment_principles: "Treatment principles",
  stage_wise_treatment: "Stage-wise treatment",
  surgery: "Surgery",
  radiation: "Radiation",
  chemotherapy: "Chemotherapy regimens",
  therapeutic_procedures: "Therapeutic procedures",
  immunotherapy: "Immunotherapy",
  targeted_therapy: "Targeted therapy",
  hormone_therapy: "Hormone therapy",
  follow_up: "Follow-up plan",
  supportive_care: "Supportive care",
  contraindications: "Contraindications",
  dose_modifications: "Dose modifications",
  monitoring: "Monitoring",
  if_then_rules: "Clinical decision rules",
  recommendations: "Guideline recommendations",
  toxicity_monitoring: "Toxicity monitoring",
  response_assessment: "Response assessment",
  surveillance_schedule: "Surveillance schedule",
  dose_hold_criteria: "Dose hold criteria",
  dose_resume_criteria: "Dose resume criteria",
};

const META_KEYS = new Set([
  "source_pages", "gaps", "skill_boundaries", "relationships",
  "_source_pages", "_source_sections", "_disease_focus", "_subtype_focus",
  "_specificity_ratio", "_inheritance", "_subtypes_inherited",
]);

// ── generic helpers ────────────────────────────────────────────────

function countItems(v) {
  if (v == null) return 0;
  if (typeof v === "string") return v.trim() ? 1 : 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === "object") return Object.values(v).reduce((acc, x) => acc + countItems(x), 0);
  return v ? 1 : 0;
}

function entityName(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return item.name || item.stage || item.regimen_name || item.drug || item.trial || item.condition || null;
  }
  return null;
}

function prettify(key) {
  return String(key).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildKnowledgeComponents(body) {
  if (!body || typeof body !== "object") return [];
  const out = [];
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith("_") || META_KEYS.has(key)) continue;
    const count = countItems(value);
    if (count > 0) out.push({ key, label: FIELD_LABELS[key] || prettify(key), count });
  }
  return out.sort((a, b) => b.count - a.count);
}

function extractFieldEntities(body) {
  const out = { biomarker: [], drug: [], stage: [], investigation: [] };
  if (!body) return out;

  (body.biomarkers || []).forEach((b) => {
    const n = entityName(b);
    if (n) out.biomarker.push(n);
  });

  (body.staging || []).forEach((s) => {
    const n = (s && s.stage) || entityName(s);
    if (n) out.stage.push(n);
  });

  const drugSources = [
    ...((body.chemotherapy && body.chemotherapy.regimens) || []).flatMap((r) => (r && r.drugs) || []),
    ...((body.targeted_therapy && body.targeted_therapy.drugs) || []),
    ...((body.immunotherapy && body.immunotherapy.drugs) || []),
    ...((body.hormone_therapy && body.hormone_therapy.drugs) || []),
  ];
  drugSources.forEach((d) => { if (d) out.drug.push(d); });

  const inv = body.investigations || {};
  Object.values(inv).forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const n = entityName(item);
      if (n) out.investigation.push(n);
    });
  });

  return out;
}

function aggregateRelationships(skills) {
  const map = new Map();
  (skills || []).forEach((skill) => {
    const rels = (skill.body && skill.body.relationships) || [];
    rels.forEach((r) => {
      if (!r || !r.source || !r.relation || !r.target) return;
      const key = `${r.source}|${r.relation}|${r.target}`.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { source: r.source, relation: r.relation, target: r.target, source_page: r.source_page, skills: [] });
      }
      const entry = map.get(key);
      if (!entry.skills.includes(skill.name)) entry.skills.push(skill.name);
      if (!entry.source_page && r.source_page) entry.source_page = r.source_page;
    });
  });
  return Array.from(map.values()).sort((a, b) => a.source.localeCompare(b.source));
}

function buildRelationshipChains(rels) {
  if (!rels || !rels.length) return [];
  const bySourceLower = new Map();
  rels.forEach((r) => {
    const k = r.source.toLowerCase();
    if (!bySourceLower.has(k)) bySourceLower.set(k, []);
    bySourceLower.get(k).push(r);
  });
  const targetSet = new Set(rels.map((r) => r.target.toLowerCase()));
  const startRels = rels.filter((r) => !targetSet.has(r.source.toLowerCase()));
  const starts = startRels.length ? startRels : rels;

  const usedIdx = new Set();
  const chains = [];
  starts.forEach((start) => {
    const startIdx = rels.indexOf(start);
    if (usedIdx.has(startIdx)) return;
    const chain = [{ node: start.source, relation: null }];
    let current = start;
    let hops = 0;
    while (current && hops < 6) {
      const idx = rels.indexOf(current);
      usedIdx.add(idx);
      chain.push({ node: current.target, relation: current.relation });
      const candidates = bySourceLower.get(current.target.toLowerCase()) || [];
      current = candidates.find((r) => !usedIdx.has(rels.indexOf(r)));
      hops += 1;
    }
    chains.push(chain);
  });
  return chains.slice(0, 10);
}

// ── shared primitives ───────────────────────────────────────────────

function Chip({ children, tone = "outline", size = "sm" }) {
  const isFilled = tone === "filled";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        padding: size === "sm" ? "3px 9px" : "5px 12px",
        borderRadius: "999px", fontSize: size === "sm" ? "10.5px" : "12px",
        fontWeight: 600, border: `1.3px solid ${INK}`,
        background: isFilled ? INK : "transparent",
        color: isFilled ? PAPER : INK,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SectionHeading({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <i className={`ti ${icon}`} style={{ fontSize: "16px" }} aria-hidden />
        <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title}
        </span>
      </div>
      {subtitle && <p style={{ margin: "4px 0 0", fontSize: "12px", color: "rgba(0,0,0,0.55)" }}>{subtitle}</p>}
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ padding: "1.5rem", textAlign: "center", border: `2px dashed ${INK}`, borderRadius: "10px" }}>
      <i className={`ti ${icon}`} style={{ fontSize: "24px", display: "block", marginBottom: "8px", opacity: 0.4 }} aria-hidden />
      <p style={{ margin: 0, fontSize: "12px", opacity: 0.6 }}>{text}</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// 1. CLINICAL KNOWLEDGE FLOW
// ═════════════════════════════════════════════════════════════════
//
// Reads preview.diagnosis_knowledge / preview.treatment_knowledge directly
// (NOT preview.summary — summary only has document-level tag lists, the
// real extracted content lives in diagnosis_knowledge/treatment_knowledge).
//
// Counts are computed generically via countClinicalEntities() below, so
// this works unmodified for any specialty schema (oncology, cardiology,
// nephrology, etc.) — it never references field names like "biomarkers"
// or "chemotherapy" for the purpose of deciding what to count; it just
// walks whatever shape the backend actually sent, skips known metadata
// keys, and counts array-of-entity lengths at every level.

// Keys that are metadata / bookkeeping, not clinical entities — skipped
// everywhere in the walk so they never inflate the counts. Mirrors the
// same metadata keys the backend itself treats as non-entity (see
// META_KEYS / _NON_ENTITY_KEYS in the pipeline).
const ENTITY_META_KEYS = new Set([
  "source_pages", "source_page", "gaps", "skill_boundaries", "relationships",
  "confidence", "confidence_summary",
  "_source_pages", "_source_sections", "_disease_focus", "_subtype_focus",
  "_specificity_ratio", "_inheritance", "_subtypes_inherited",
]);

// Generic, specialty-agnostic clinical-entity counter.
//
// Rule: an array counts as N entities (its length). If its items are
// objects, we also look one level inside each item for further nested
// entity arrays (e.g. stage_wise_treatment[].options[].drugs[]) so those
// get counted too — but we never count plain descriptive strings
// (definitions, notes, free text) as entities, since those aren't
// "things extracted", they're prose.
function countClinicalEntities(value, depth = 0) {
  if (value == null || depth > 8) return 0;

  if (Array.isArray(value)) {
    let count = value.length;
    value.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.entries(item).forEach(([k, v]) => {
          if (k.startsWith("_") || ENTITY_META_KEYS.has(k)) return;
          if (Array.isArray(v) || (v && typeof v === "object")) {
            count += countClinicalEntities(v, depth + 1);
          }
        });
      }
    });
    return count;
  }

  if (typeof value === "object") {
    let count = 0;
    Object.entries(value).forEach(([k, v]) => {
      if (k.startsWith("_") || ENTITY_META_KEYS.has(k)) return;
      if (Array.isArray(v) || (v && typeof v === "object")) {
        count += countClinicalEntities(v, depth + 1);
      }
      // scalar strings/numbers/booleans directly on an object (e.g.
      // "definition", "diagnostic_criteria") are descriptive text, not
      // countable entities — intentionally skipped.
    });
    return count;
  }

  return 0;
}

function FlowNode({ icon, title, value, note, size = "md" }) {
  return (
    <div style={{
      border: `1.5px solid ${INK}`, borderRadius: "10px",
      padding: size === "lg" ? "16px 18px" : "12px 14px",
      background: PAPER, textAlign: "center",
      minWidth: size === "lg" ? "220px" : "150px",
    }}>
      <i className={`ti ${icon}`} style={{ fontSize: size === "lg" ? "20px" : "16px" }} aria-hidden />
      {typeof value !== "undefined" && value !== null && (
        <p style={{ margin: "6px 0 0", fontSize: size === "lg" ? "26px" : "20px", fontWeight: 800, lineHeight: 1 }}>{value}</p>
      )}
      <p style={{ margin: "4px 0 0", fontSize: size === "lg" ? "13px" : "11.5px", fontWeight: 700 }}>{title}</p>
      {note && <p style={{ margin: "2px 0 0", fontSize: "10.5px", color: "rgba(0,0,0,0.5)" }}>{note}</p>}
    </div>
  );
}

function VLine({ height = 22 }) {
  return <div style={{ width: "2px", height: `${height}px`, background: INK, margin: "0 auto" }} />;
}

function BranchRow({ branches }) {
  return (
    <div style={{ width: "100%" }}>
      <VLine height={18} />
      <div style={{ borderTop: `2px solid ${INK}`, paddingTop: "14px", display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" }}>
        {branches.map((b, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "1 1 160px", maxWidth: "220px", position: "relative" }}>
            <div style={{ position: "absolute", top: "-14px", width: "2px", height: "14px", background: INK }} />
            <FlowNode icon={b.icon} title={b.title} value={b.value} note={b.note} />
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeFlowView({ preview, skills, skillCoverage }) {
  // ── Real pipeline data, read from the fields that actually hold content ──
  const diagnosis = preview?.diagnosis_knowledge || {};
  const treatment = preview?.treatment_knowledge || {};
  const graph = preview?.graph || {};
  const relSummary = preview?.relationship_summary || {};

  // ── Generic entity counts — works for any specialty schema ──
  const diagCount = countClinicalEntities(diagnosis);
  const treatCount = countClinicalEntities(treatment);
  const biomarkerCount = countClinicalEntities(diagnosis.biomarkers);

  // Evidence: prefer the graph's edge count (always populated by
  // build_knowledge_graph()), fall back to relationship_summary if the
  // graph section is ever missing for some reason.
  const evidenceCount = graph.total_edges || relSummary.total_relationships || 0;

  const diagSkills = skills.filter((s) => s.skill_type === "diagnosis").length;
  const treatSkills = skills.filter((s) => s.skill_type === "treatment").length;

  // ── Skill coverage: only show real backend numbers, never invent them ──
  // pipeline_result.skill_coverage (llm_derived_skills / structurally_derived_skills)
  // comes from a different internal list (clinical_skills, via collect_skills())
  // than skills_preview does — there's no reliable way to re-derive an
  // llm-vs-structural split from skills_preview alone on the frontend. So:
  //   - if the caller passes skillCoverage (e.g. from pipeline_result /
  //     job.skill_coverage), show the real split.
  //   - if not, show the total skill count with an honest note instead of
  //     "undefined".
  const hasSkillCoverage = !!skillCoverage;

  return (
    <div>
      <SectionHeading icon="ti-route" title="Clinical knowledge flow" subtitle="How this document became reviewable clinical skills" />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <FlowNode icon="ti-file-text" title={preview?.guideline?.name || "Guideline"} note={preview?.guideline?.version ? `v${preview.guideline.version}` : "PDF guideline"} size="lg" />
        <VLine />
        <FlowNode icon="ti-search" title="Clinical knowledge extraction" note="Diagnosis · Treatment · Biomarkers · Evidence" size="lg" />

        <div style={{ width: "100%", maxWidth: "760px" }}>
          <BranchRow
            branches={[
              { icon: "ti-stethoscope", title: "Diagnosis", value: diagCount, note: "extracted diagnosis entities" },
              { icon: "ti-pill", title: "Treatment", value: treatCount, note: "extracted treatment entities" },
              { icon: "ti-dna", title: "Biomarkers", value: biomarkerCount, note: "molecular markers" },
              { icon: "ti-file-search", title: "Evidence", value: evidenceCount, note: "relationships · graph edges" },
            ]}
          />
        </div>

        <VLine />
        <FlowNode icon="ti-arrows-join" title="Relationship extraction" value={relSummary.total_relationships ?? graph.total_edges ?? 0} note="clinical triples" size="lg" />
        <VLine />
        <FlowNode icon="ti-hierarchy" title="Knowledge graph" value={graph.total_nodes || 0} note={`${graph.total_edges || 0} connections`} size="lg" />
        <VLine />
        <FlowNode
          icon="ti-adjustments"
          title="Structural capability extraction"
          value={hasSkillCoverage ? skillCoverage.structurally_derived_skills : skills.length}
          note={
            hasSkillCoverage
              ? `+${skillCoverage.llm_derived_skills ?? 0} LLM-declared`
              : "skill_coverage not passed in — showing total skills instead"
          }
          size="lg"
        />
        <VLine />
        <FlowNode icon="ti-bulb" title="Generated skills" value={skills.length} note={`${diagSkills} diagnosis · ${treatSkills} treatment`} size="lg" />
      </div>
    </div>
  );
}
// ═════════════════════════════════════════════════════════════════
// 2. INTERACTIVE KNOWLEDGE GRAPH  — REWRITTEN to use the REAL backend
//    graph (build_knowledge_graph() output), fetched from
//    GET /documents/{doctor_id}/{doc_id}/full  (or passed in directly
//    via the `graph` prop). Nothing here is reconstructed/guessed.
//
//    PHASE 1: disease-centric view. Instead of rendering all nodes/edges
//    at once (unreadable hairball on large real graphs), the left panel
//    lists every disease-type node; selecting one scopes the graph to
//    that disease plus its directly-connected neighbors only. An
//    escape hatch ("Show full graph") is provided for anyone who wants
//    the unscoped view, and graphs with no disease-type nodes fall back
//    to the full view automatically.
// ═════════════════════════════════════════════════════════════════

// Backend node shape:  { index, type, name, doctor_id, doc_id, created_at, ...extra }
// Backend edge shape:  { from, to, relationship, doc_id, doctor_id, ...extra }

const KNOWN_TYPE_COLORS = {
  doctor: "#111827",
  disease: "#1d4ed8",
  subtype: "#15803d",
  biomarker: "#9333ea",
  drug: "#ea580c",
  regimen: "#c2410c",
  investigation: "#dc2626",
  stage: "#0d9488",
  symptom: "#0891b2",
  monitoring: "#0369a1",
  complication: "#b91c1c",
  contraindication: "#991b1b",
  guideline_recommendation: "#7c3aed",
  diagnostic_pathway: "#4338ca",
  if_then_rule: "#a16207",
  dose_modification: "#92400e",
  evidence: "#065f46",
  follow_up: "#0f766e",
  procedure: "#b45309",
  clinical_entity: "#334155",
};

// Any backend node "type" not listed above (pipelines evolve — new node
// types get added over time) still gets a stable, deterministic color
// instead of silently falling back to grey or crashing the legend.
const FALLBACK_PALETTE = [
  "#1d4ed8", "#15803d", "#9333ea", "#ea580c", "#dc2626", "#0d9488", "#7c3aed",
  "#0891b2", "#a16207", "#065f46", "#b45309", "#334155", "#c2410c", "#0369a1",
];

function colorForType(type) {
  if (KNOWN_TYPE_COLORS[type]) return KNOWN_TYPE_COLORS[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

// Normalizes the raw backend graph into the shape the renderer wants,
// without inventing, dropping, or re-deriving anything — a straight
// field rename/pass-through.
function normalizeBackendGraph(rawGraph) {
  const nodes = (rawGraph?.nodes || []).map((n) => ({
    id: n.index,
    type: n.type || "entity",
    label: n.name || String(n.index),
    raw: n,
  }));
  const edges = (rawGraph?.edges || [])
    .filter((e) => e && e.from && e.to)
    .map((e) => ({
      from: e.from,
      to: e.to,
      relation: (e.relationship || "").replace(/_/g, " ").toLowerCase() || "related to",
      raw: e,
    }));
  return { nodes, edges };
}

// Fetches the REAL graph for this document from your existing backend
// endpoint (works for both pending-review and already-approved docs,
// per phase1_router's get_full_document implementation).
async function fetchBackendGraph(apiBase, doctorId, docId) {
  const base = apiBase || "api/hms/users/ai-legacy/phase1";
  const url = `${base}/documents/${doctorId}/${docId}/full`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load knowledge graph (HTTP ${res.status})`);
  }
  const data = await res.json();
  const kg = data.knowledge_graph || {};
  return { nodes: kg.nodes || [], edges: kg.edges || [] };
}

// Concentric-ring layout, grouped by node type — generic, works for
// however many/whichever types the backend graph actually contains
// (doesn't assume a fixed oncology-specific type list).
// Concentric-ring layout, grouped by node type — generic, works for
// however many/whichever types the backend graph actually contains.
//
// FIX: previously used a fixed RING_STEP + fixed CX/CY, which meant any
// graph with several node types (many rings) or a ring crowded with many
// nodes/long labels would compute positions OUTSIDE the fixed 760×760
// viewBox — those nodes rendered off-canvas (invisible) while their
// edges, which just connect two coordinates, still drew across the
// visible area. This version computes ring radii large enough to fit
// every ring's node count without overlap, then returns the canvas size
// that's actually needed so the caller can size the viewBox to match —
// nothing gets clipped regardless of how many types/nodes are present.
function layoutRealGraph(nodes) {
  const byType = {};
  nodes.forEach((n) => { (byType[n.type] = byType[n.type] || []).push(n); });

  const preferredOrder = ["doctor", "disease", "subtype", "stage"];
  const typesSorted = Object.keys(byType).sort((a, b) => {
    const ia = preferredOrder.indexOf(a);
    const ib = preferredOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return byType[b].length - byType[a].length;
  });

  // Minimum arc length (px) to leave per node on a ring so its label
  // (~up to 16 chars, ~7px/char) doesn't overlap its neighbors.
  const MIN_ARC_PER_NODE = 46;
  const MIN_RING_GAP = 90; // minimum radial distance between consecutive rings

  const positions = {};
  let radius = 0;

  typesSorted.forEach((type, ringIdx) => {
    const ringNodes = byType[type];

    if (ringIdx === 0 && ringNodes.length === 1) {
      // Center node (e.g. the single "doctor" or focal disease) — radius stays 0.
      positions[ringNodes[0].id] = { ...ringNodes[0], x: 0, y: 0 };
      return;
    }

    // Radius needed so this ring's circumference has room for all its
    // nodes at MIN_ARC_PER_NODE spacing: circumference = 2πr >= n * arc
    const requiredRadius = (ringNodes.length * MIN_ARC_PER_NODE) / (2 * Math.PI);
    radius = Math.max(radius + MIN_RING_GAP, requiredRadius);

    ringNodes.forEach((n, i) => {
      const angle = (i / ringNodes.length) * Math.PI * 2 - Math.PI / 2;
      positions[n.id] = {
        ...n,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      };
    });
  });

  // Canvas must fit the outermost radius plus margin for label width/height.
  const LABEL_MARGIN = 60;
  const maxRadius = radius + LABEL_MARGIN;
  const canvasSize = Math.max(760, Math.ceil(maxRadius * 2));
  const center = canvasSize / 2;

  // Shift every position from origin-centered to canvas-centered coords.
  Object.keys(positions).forEach((id) => {
    positions[id].x += center;
    positions[id].y += center;
  });

  return { positions, canvasSize };
}

function GraphLegend({ types }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
      {types.map((t) => (
        <span key={t} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600 }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: colorForType(t), display: "inline-block" }} />
          {prettify(t)}
        </span>
      ))}
    </div>
  );
}

function TypeFilterChips({ typeCounts, activeTypes, onToggle, onShowAll }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
      {typeCounts.map(([type, count]) => {
        const active = activeTypes.has(type);
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "4px 10px", borderRadius: "999px", cursor: "pointer",
              border: `1.3px solid ${INK}`, fontSize: "11px", fontWeight: 600,
              background: active ? INK : "transparent",
              color: active ? PAPER : INK,
            }}
          >
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: colorForType(type) }} />
            {prettify(type)} ({count})
          </button>
        );
      })}
      <button
        onClick={onShowAll}
        style={{
          padding: "4px 10px", borderRadius: "999px", cursor: "pointer",
          border: `1.3px dashed ${INK}`, fontSize: "11px", fontWeight: 600,
          background: "transparent", color: INK,
        }}
      >
        Show all types
      </button>
    </div>
  );
}

function NodeDetailPanel({ node, neighbors }) {
  const HIDDEN_KEYS = new Set(["index", "type", "name", "doctor_id", "doc_id", "created_at"]);
  const extraFields = Object.entries(node.raw || {}).filter(
    ([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== "" &&
      !(Array.isArray(v) && v.length === 0)
  );

  return (
    <div style={{ border: `1.5px solid ${INK}`, borderRadius: "10px", padding: "14px" }}>
      <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colorForType(node.type) }}>
        {prettify(node.type)}
      </span>
      <p style={{ margin: "4px 0 10px", fontSize: "14px", fontWeight: 800 }}>{node.label}</p>

      {extraFields.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          {extraFields.slice(0, 8).map(([k, v]) => (
            <div key={k} style={{ fontSize: "11px", padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
              <strong style={{ textTransform: "capitalize" }}>{prettify(k)}:</strong>{" "}
              {Array.isArray(v) ? v.join(", ") : String(v).slice(0, 160)}
            </div>
          ))}
        </div>
      )}

      <p style={{ margin: "0 0 6px", fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", opacity: 0.5 }}>
        Connections ({neighbors.length})
      </p>
      <div style={{ maxHeight: "280px", overflowY: "auto" }}>
        {neighbors.map((n, i) => (
          <div key={i} style={{ fontSize: "11.5px", padding: "5px 0", borderBottom: "1px solid rgba(0,0,0,0.1)" }}>
            {n.direction === "out"
              ? <>→ <em>{n.relation}</em> → <strong>{n.node.label}</strong></>
              : <><strong>{n.node.label}</strong> → <em>{n.relation}</em> →</>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PHASE 1: Disease sidebar ────────────────────────────────────────
// Lists every disease-type node from the real graph. Clicking one scopes
// the visible graph to just that disease + its direct neighbors, via
// diseaseGraph in KnowledgeGraphView below.

function DiseaseSidebar({ diseaseNodes, selectedDisease, onSelect, degreeById }) {
  return (
    <div style={{
      width: "220px", flexShrink: 0,
      border: `1.5px solid ${INK}`, borderRadius: "12px",
      overflow: "hidden", display: "flex", flexDirection: "column",
      maxHeight: "620px",
    }}>
      <div style={{
        padding: "10px 12px", borderBottom: `1.5px solid ${INK}`,
        background: INK, color: PAPER, fontSize: "11px", fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.05em",
      }}>
        Diseases ({diseaseNodes.length})
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {diseaseNodes.length === 0 ? (
          <p style={{ fontSize: "11px", opacity: 0.5, padding: "12px" }}>
            No disease-type nodes found in this graph.
          </p>
        ) : (
          diseaseNodes.map((d) => {
            const active = selectedDisease === d.id;
            return (
              <div
                key={d.id}
                onClick={() => onSelect(d.id)}
                style={{
                  padding: "10px 12px", cursor: "pointer",
                  background: active ? "#eef4ff" : PAPER,
                  borderLeft: active ? `3px solid ${INK}` : "3px solid transparent",
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                <p style={{ margin: 0, fontSize: "12.5px", fontWeight: active ? 800 : 600 }}>
                  {d.label}
                </p>
                {typeof degreeById[d.id] === "number" && (
                  <p style={{ margin: "2px 0 0", fontSize: "10.5px", opacity: 0.5 }}>
                    {degreeById[d.id]} connection{degreeById[d.id] !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const MAX_RENDERED_NODES = 300;

function KnowledgeGraphView({ doctorId, docId, graph: graphProp, apiBase }) {
  const [rawGraph, setRawGraph] = useState(graphProp || null);
  const [loading, setLoading] = useState(!graphProp);
  const [error, setError] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState(null); // null = "show default subset"

  // PHASE 1 state — which disease is scoping the graph, and whether the
  // user has explicitly asked to bypass scoping and see everything.
  const [selectedDisease, setSelectedDisease] = useState(null);
  const [showFullGraph, setShowFullGraph] = useState(false);
  const [zoom, setZoom] = useState(1);

  // PHASE 2: how many hops out from the selected disease to include — 1 =
  // direct connections only (Phase 1 behavior), 2 = also pull in each of
  // those neighbors' own connections, giving the full chain (e.g. disease
  // -> biomarker -> drug -> recommendation) instead of stopping one edge
  // short of it.
  const [hopDepth, setHopDepth] = useState(1);

  useEffect(() => {
    if (graphProp) {
      setRawGraph(graphProp);
      setLoading(false);
      return;
    }
    if (!doctorId || !docId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBackendGraph(apiBase, doctorId, docId)
      .then((g) => { if (!cancelled) { setRawGraph(g); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [graphProp, doctorId, docId, apiBase]);

  const { nodes, edges } = useMemo(() => normalizeBackendGraph(rawGraph), [rawGraph]);

  useEffect(() => {
    console.group("VIEW 2 - KNOWLEDGE GRAPH");

    console.log("Raw Graph");
    console.log(rawGraph);

    console.table(nodes);

    console.table(edges);

    console.groupEnd();
  }, [rawGraph, nodes, edges]);

  // ── PHASE 1: extract disease nodes and default-select the first one ──
  // Connection-count per node (computed from the FULL, unscoped edge set —
  // moved up here, ahead of diseaseNodes, because we now need degree to
  // decide which diseases even qualify for the sidebar).
  const degreeById = useMemo(() => {
    const counts = {};
    edges.forEach((e) => {
      counts[e.from] = (counts[e.from] || 0) + 1;
      counts[e.to] = (counts[e.to] || 0) + 1;
    });
    return counts;
  }, [edges]);

  // Minimum number of connections a disease node must have to be worth
  // showing in the sidebar — diseases with only a handful of edges tend to
  // be near-empty stubs (e.g. a co-mentioned differential with barely any
  // extracted knowledge) and just add noise to the picker.
  const MIN_DISEASE_DEGREE = 5;

  // ── PHASE 1: extract disease nodes with enough real connections,
  // and default-select the first one ──
  const diseaseNodes = useMemo(
    () => nodes.filter((n) => n.type === "disease" && (degreeById[n.id] || 0) >= MIN_DISEASE_DEGREE),
    [nodes, degreeById]
  );

  useEffect(() => {
    // Reset selection whenever the underlying graph changes (new document
    // loaded), and default to the first disease if none is selected yet.
    if (diseaseNodes.length === 0) {
      setSelectedDisease(null);
      return;
    }
    setSelectedDisease((prev) => {
      const stillValid = prev && diseaseNodes.some((d) => d.id === prev);
      return stillValid ? prev : diseaseNodes[0].id;
    });
  }, [diseaseNodes]);

  // Clicking a different disease should clear whatever node was focused
  // in the detail panel — it may not even be in the new subgraph.
  function handleSelectDisease(id) {
    setSelectedDisease(id);
    setFocusId(null);
    setSearch("");
    setActiveTypes(null);
  }

  // ── PHASE 1: build the 1-hop subgraph for the selected disease ──
  const diseaseGraph = useMemo(() => {
    if (!selectedDisease) return { nodes: [], edges: [] };

    // PHASE 2: BFS outward from the selected disease for `hopDepth` rounds.
    // `frontier` holds only nodes newly reached in the previous round, so
    // hop 2 expands from hop-1's neighbors rather than re-walking the
    // disease node itself. Edges are deduped via a key set since the same
    // edge can otherwise be picked up again when traversing from either end.
    const connected = new Set([selectedDisease]);
    const edgeKeys = new Set();
    const graphEdges = [];
    let frontier = new Set([selectedDisease]);

    for (let hop = 0; hop < hopDepth; hop++) {
      const nextFrontier = new Set();
      edges.forEach((edge) => {
        if (!frontier.has(edge.from) && !frontier.has(edge.to)) return;

        const key = `${edge.from}|${edge.to}|${edge.relation}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          graphEdges.push(edge);
        }

        if (!connected.has(edge.to)) nextFrontier.add(edge.to);
        if (!connected.has(edge.from)) nextFrontier.add(edge.from);
        connected.add(edge.to);
        connected.add(edge.from);
      });
      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }

    const graphNodes = nodes.filter((n) => connected.has(n.id));
    return { nodes: graphNodes, edges: graphEdges };
  }, [selectedDisease, nodes, edges, hopDepth]);

  // Connection-count per disease, shown in the sidebar as a quick signal
  // of how much content each disease actually has attached to it.
 

  // Scoped mode uses the disease subgraph; full mode (or graphs with no
  // disease nodes at all) falls back to the entire node/edge set exactly
  // as before.
  const usingScopedView = diseaseNodes.length > 0 && !!selectedDisease && !showFullGraph;
  const baseNodes = usingScopedView ? diseaseGraph.nodes : nodes;
  const baseEdges = usingScopedView ? diseaseGraph.edges : edges;

  const typeCounts = useMemo(() => {
    const counts = {};
    baseNodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [baseNodes]);

  // Default: show the 8 most common types so a large full-graph view
  // isn't an unreadable hairball on first render. In scoped (disease)
  // mode the subgraph is already small, so default to showing every
  // type present — no need to hide anything.
  const effectiveActiveTypes = useMemo(() => {
    if (activeTypes) return activeTypes;
    if (usingScopedView) return new Set(typeCounts.map(([t]) => t));
    return new Set(typeCounts.slice(0, 8).map(([t]) => t));
  }, [activeTypes, typeCounts, usingScopedView]);

  function toggleType(type) {
    setActiveTypes((prev) => {
      const base = prev || effectiveActiveTypes;
      const next = new Set(base);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }
  function showAllTypes() {
    setActiveTypes(new Set(typeCounts.map(([t]) => t)));
  }

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseNodes.filter((n) => {
      if (!effectiveActiveTypes.has(n.type)) return false;
      if (q && !n.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [baseNodes, effectiveActiveTypes, search]);

  const truncated = filteredNodes.length > MAX_RENDERED_NODES;
  const renderNodes = truncated ? filteredNodes.slice(0, MAX_RENDERED_NODES) : filteredNodes;
  const renderIds = useMemo(() => new Set(renderNodes.map((n) => n.id)), [renderNodes]);
  const renderEdges = useMemo(
    () => baseEdges.filter((e) => renderIds.has(e.from) && renderIds.has(e.to)),
    [baseEdges, renderIds]
  );

  const { positions, canvasSize } = useMemo(() => layoutRealGraph(renderNodes), [renderNodes]);

  const neighborIds = useMemo(() => {
    if (!focusId) return null;
    const set = new Set([focusId]);
    renderEdges.forEach((e) => {
      if (e.from === focusId) set.add(e.to);
      if (e.to === focusId) set.add(e.from);
    });
    return set;
  }, [focusId, renderEdges]);

  const focusNode = focusId ? positions[focusId] : null;
  const focusNeighbors = useMemo(() => {
    if (!focusId) return [];
    return renderEdges
      .filter((e) => e.from === focusId || e.to === focusId)
      .map((e) => {
        const otherId = e.from === focusId ? e.to : e.from;
        return { node: positions[otherId], relation: e.relation, direction: e.from === focusId ? "out" : "in" };
      })
      .filter((n) => n.node);
  }, [focusId, renderEdges, positions]);

  if (loading) {
    return (
      <div>
        <SectionHeading icon="ti-affiliate" title="Interactive knowledge graph" subtitle="Loading the real knowledge graph for this document..." />
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <i className="ti ti-loader-2" style={{ fontSize: "24px", animation: "spin 1s linear infinite" }} aria-hidden />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeading icon="ti-affiliate" title="Interactive knowledge graph" />
        <EmptyState icon="ti-alert-triangle" text={`Could not load the real knowledge graph: ${error}`} />
      </div>
    );
  }

  if (!rawGraph || nodes.length === 0) {
    return (
      <div>
        <SectionHeading icon="ti-affiliate" title="Interactive knowledge graph" />
        <EmptyState icon="ti-affiliate" text="No knowledge graph data available for this document yet." />
      </div>
    );
  }

  const selectedDiseaseLabel = diseaseNodes.find((d) => d.id === selectedDisease)?.label;

  return (
    <div>
      <SectionHeading
        icon="ti-affiliate"
        title="Interactive knowledge graph"
        subtitle={
          usingScopedView
            ? `Scoped to "${selectedDiseaseLabel}" — showing ${
                hopDepth === 1
                  ? "this disease and its direct connections"
                  : "this disease plus two hops out (direct connections and their connections)"
              }`
            : "Real graph from this document's pipeline output — click any node to trace its connections"
        }
      />

      {diseaseNodes.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
          <p style={{ margin: 0, fontSize: "11px", opacity: 0.6 }}>
            {usingScopedView
              ? `${diseaseGraph.nodes.length} nodes · ${diseaseGraph.edges.length} edges for this disease (${hopDepth} hop${hopDepth > 1 ? "s" : ""}, out of ${nodes.length} total nodes)`
              : `Showing the entire graph — ${nodes.length} nodes · ${edges.length} edges`}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {usingScopedView && (
              <div style={{ display: "flex", border: `1.3px solid ${INK}`, borderRadius: "999px", overflow: "hidden" }}>
                {[1, 2].map((depth) => (
                  <button
                    key={depth}
                    onClick={() => setHopDepth(depth)}
                    style={{
                      padding: "5px 12px", cursor: "pointer", border: "none", fontSize: "11px", fontWeight: 700,
                      background: hopDepth === depth ? INK : "transparent",
                      color: hopDepth === depth ? PAPER : INK,
                    }}
                  >
                    {depth} Hop{depth > 1 ? "s" : ""}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowFullGraph((v) => !v)}
              style={{
                padding: "5px 12px", borderRadius: "999px", cursor: "pointer",
                border: `1.3px solid ${INK}`, fontSize: "11px", fontWeight: 700,
                background: showFullGraph ? INK : "transparent",
                color: showFullGraph ? PAPER : INK,
              }}
            >
              {showFullGraph ? "Back to disease view" : "Show full graph (all diseases)"}
            </button>
          </div>
        </div>
      )}

      <TypeFilterChips
        typeCounts={typeCounts}
        activeTypes={effectiveActiveTypes}
        onToggle={toggleType}
        onShowAll={showAllTypes}
      />

      <div style={{ position: "relative", marginBottom: "12px", maxWidth: "320px" }}>
        <i className="ti ti-search" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "12px" }} aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search node names..."
          style={{ width: "100%", padding: "7px 9px 7px 28px", fontSize: "12px", border: `1.5px solid ${INK}`, borderRadius: "7px", outline: "none" }}
        />
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {/* PHASE 1: disease sidebar — hidden once "Show full graph" is on,
            or if the graph has no disease-type nodes to begin with. */}
        {diseaseNodes.length > 0 && !showFullGraph && (
          <DiseaseSidebar
            diseaseNodes={diseaseNodes}
            selectedDisease={selectedDisease}
            onSelect={handleSelectDisease}
            degreeById={degreeById}
          />
        )}

        <div style={{ flex: "1 1 460px", border: `1.5px solid ${INK}`, borderRadius: "12px", padding: "10px", overflow: "hidden" }}>
  {renderNodes.length === 0 ? (
    <EmptyState icon="ti-affiliate" text="No nodes match the current filters." />
  ) : (
    <>
      {/* Zoom controls — needed because dynamic canvasSize can now be much
          larger than 760 for graphs with many types/dense rings, so the
          whole graph would otherwise render very small on first view. */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "8px", justifyContent: "flex-end" }}>
        <button
          onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.2).toFixed(2)))}
          style={{ width: "28px", height: "28px", borderRadius: "6px", border: `1.3px solid ${INK}`, background: PAPER, cursor: "pointer", fontWeight: 700 }}
        >−</button>
        <button
          onClick={() => setZoom(1)}
          style={{ padding: "0 10px", height: "28px", borderRadius: "6px", border: `1.3px solid ${INK}`, background: PAPER, cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
        >Reset</button>
        <button
          onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
          style={{ width: "28px", height: "28px", borderRadius: "6px", border: `1.3px solid ${INK}`, background: PAPER, cursor: "pointer", fontWeight: 700 }}
        >+</button>
      </div>

      {/* Scrollable viewport — the svg itself is sized to canvasSize (which
          can exceed the visible area for large/dense graphs), and this
          wrapper lets the user pan via scrolling instead of nodes being
          silently clipped off the edge. */}
      <div style={{ width: "100%", height: "620px", overflow: "auto", background: "#fafafa", borderRadius: "8px" }}>
        <svg
          viewBox={`0 0 ${canvasSize} ${canvasSize}`}
          width={canvasSize * zoom}
          height={canvasSize * zoom}
          style={{ display: "block" }}
        >
          {renderEdges.map((e, i) => {
            const a = positions[e.from], b = positions[e.to];
            if (!a || !b) return null;
            const dim = neighborIds && !(neighborIds.has(e.from) && neighborIds.has(e.to));
            return (
              <line
                key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={dim ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.35)"}
                strokeWidth={dim ? 1 : 1.5}
              />
            );
          })}
          {Object.values(positions).map((n) => {
            const r = n.type === "disease" ? 15 : n.type === "doctor" ? 13 : 7;
            const dim = neighborIds && !neighborIds.has(n.id);
            return (
              <g key={n.id} onClick={() => setFocusId(focusId === n.id ? null : n.id)} style={{ cursor: "pointer" }} opacity={dim ? 0.25 : 1}>
                <circle cx={n.x} cy={n.y} r={r} fill={colorForType(n.type)} stroke={INK} strokeWidth={focusId === n.id ? 2.5 : 1} />
                <text x={n.x} y={n.y + r + 11} textAnchor="middle" style={{ fontSize: "8.5px", fontWeight: 600, fill: INK }}>
                  {n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label}
                </text>
                <title>{n.label}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  )}
</div>

        <div style={{ flex: "0 1 260px", minWidth: "220px" }}>
          {focusNode ? (
            <NodeDetailPanel node={focusNode} neighbors={focusNeighbors} />
          ) : (
            <EmptyState icon="ti-hand-click" text="Click a node to see its real connections and stored fields." />
          )}
        </div>
      </div>

      <p style={{ fontSize: "11px", opacity: 0.5, marginTop: "10px" }}>
        Showing {renderNodes.length} of {baseNodes.length} nodes
        {truncated ? " (truncated — narrow your filters/search to see more)" : ""}
        {" · "}{renderEdges.length} of {baseEdges.length} edges visible.
        This is the actual graph persisted by the pipeline — not a reconstruction.
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// 3. SKILL LINEAGE VIEW
// ═════════════════════════════════════════════════════════════════

function extractDisease(skill) {
  if (skill.disease_type) return skill.disease_type;

  const rel = skill.body?.relationships || [];
  const disease =
    rel.find((r) => r.disease)?.disease ||
    rel.find((r) => r.target)?.target;

  if (disease) return disease;

  return skill.name
    .replace("General ", "")
    .replace(" Diagnosis Skill", "")
    .replace(" Treatment Skill", "");
}

// Normalizes investigations whether stored as a flat array of strings,
// an array of {name} objects, or a { Laboratory: [...], Imaging: [...], Pathology: [...] } map.
function extractInvestigations(body) {
  const raw = body.investigations || body.investigation_categories || body.investigations_by_category;
  if (!raw) return {};

  if (Array.isArray(raw)) {
    const flat = raw.map((i) => (typeof i === "string" ? i : i.name)).filter(Boolean);
    return flat.length ? { Investigations: flat } : {};
  }

  if (typeof raw === "object") {
    const out = {};
    Object.entries(raw).forEach(([category, items]) => {
      if (!items) return;
      const list = Array.isArray(items) ? items : [items];
      const flat = list.map((i) => (typeof i === "string" ? i : i.name)).filter(Boolean);
      if (flat.length) out[category] = flat;
    });
    return out;
  }

  return {};
}

// Diagnostic pathway may be an array of steps (strings or {step}) or a single string.
function extractDiagnosticPathway(body) {
  const raw = body.diagnostic_pathway || body.diagnosticPathway || body.pathway;
  if (!raw) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.map((s) => (typeof s === "string" ? s : s.step || s.name)).filter(Boolean);
  }
  return [];
}

function extractDifferentialDiagnosis(body) {
  const raw = body.differential_diagnosis || body.differentialDiagnosis;
  if (!raw) return [];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.map((d) => (typeof d === "string" ? d : d.name)).filter(Boolean);
  }
  return [];
}

function extractExtractedSkills(body) {
  const raw = body.skills || body.extracted_skills || body.skills_extracted;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => (typeof s === "string" ? s : s.name)).filter(Boolean);
  }
  return [];
}

function SkillMiniRow({ skill, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "9px 11px", borderRadius: "7px", cursor: "pointer", marginBottom: "5px",
        border: `1.3px solid ${INK}`, background: active ? INK : PAPER, color: active ? PAPER : INK,
      }}
    >
      <div style={{ display: "flex", gap: "5px", alignItems: "center", marginBottom: "2px" }}>
        <span style={{ fontSize: "9.5px", fontWeight: 700, textTransform: "uppercase", opacity: 0.75 }}>{skill.skill_type}</span>
        {skill.subtype && skill.subtype !== "General" && <span style={{ fontSize: "9.5px", opacity: 0.75 }}>· {skill.subtype}</span>}
      </div>
      <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, lineHeight: 1.3 }}>{skill.name}</p>
    </div>
  );
}

function LineageStep({ icon, title, children }) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "7px" }}>
        <i className={`ti ${icon}`} style={{ fontSize: "13px" }} aria-hidden />
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function LineageChain({ skill }) {
  const body = skill.body || {};
  const components = buildKnowledgeComponents(body);
  const relationships = body.relationships || [];
  const found = useMemo(() => extractFieldEntities(body), [body]);

  const investigationGroups = useMemo(() => extractInvestigations(body), [body]);
  const diagnosticPathway = useMemo(() => extractDiagnosticPathway(body), [body]);
  const differentialDx = useMemo(() => extractDifferentialDiagnosis(body), [body]);
  const extractedSkills = useMemo(() => extractExtractedSkills(body), [body]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "14px" }}>
        <Chip tone="filled" size="md">{skill.skill_type === "diagnosis" ? "Diagnosis skill" : "Treatment skill"}</Chip>
      </div>

      <div style={{ textAlign: "center", marginBottom: "4px" }}>
        <i className="ti ti-arrow-narrow-down" style={{ fontSize: "18px", opacity: 0.5 }} aria-hidden />
      </div>
      <p style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.6, marginBottom: "16px" }}>
        Generated because of
      </p>
      <div style={{ borderTop: `1.5px solid ${INK}`, marginBottom: "18px" }} />

      <LineageStep icon="ti-virus" title="Disease">
        <Chip size="md">{extractDisease(skill)}</Chip>
      </LineageStep>

      {skill.subtype && skill.subtype !== "General" && (
        <LineageStep icon="ti-git-branch" title="Subtype">
          <Chip size="md">{skill.subtype}</Chip>
        </LineageStep>
      )}

      {diagnosticPathway.length > 0 && (
        <LineageStep icon="ti-route" title="Diagnostic pathway">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            {diagnosticPathway.map((step, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Chip size="md">{step}</Chip>
                {i < diagnosticPathway.length - 1 && (
                  <i className="ti ti-arrow-narrow-right" style={{ fontSize: "13px", opacity: 0.6 }} aria-hidden />
                )}
              </span>
            ))}
          </div>
        </LineageStep>
      )}

      {Object.keys(investigationGroups).length > 0 && (
        <LineageStep icon="ti-stethoscope" title="Investigations">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {Object.entries(investigationGroups).map(([category, items]) => (
              <div key={category}>
                <p style={{ margin: "0 0 4px", fontSize: "10.5px", fontWeight: 700, opacity: 0.6, textTransform: "uppercase" }}>{category}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {items.map((item, i) => <Chip key={i}>{item}</Chip>)}
                </div>
              </div>
            ))}
          </div>
        </LineageStep>
      )}

      {found.biomarker.length > 0 && (
        <LineageStep icon="ti-dna" title="Biomarkers">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {found.biomarker.slice(0, 12).map((b, i) => <Chip key={i}>{b}</Chip>)}
          </div>
        </LineageStep>
      )}

      {found.stage.length > 0 && (
        <LineageStep icon="ti-list-numbers" title="Stage">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {found.stage.slice(0, 8).map((s, i) => <Chip key={i}>{s}</Chip>)}
          </div>
        </LineageStep>
      )}

      {differentialDx.length > 0 && (
        <LineageStep icon="ti-git-compare" title="Differential diagnosis">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {differentialDx.map((d, i) => <Chip key={i}>{d}</Chip>)}
          </div>
        </LineageStep>
      )}

      {found.drug.length > 0 && (
        <LineageStep icon="ti-pill" title="Treatments considered">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {found.drug.slice(0, 12).map((d, i) => <Chip key={i}>{d}</Chip>)}
          </div>
        </LineageStep>
      )}

      {relationships.length > 0 && (
        <LineageStep icon="ti-arrows-join" title="Relationships used">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {relationships.map((rel, i) => (
              <div key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                <Chip size="md">{rel.source}</Chip>
                <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontStyle: "italic", opacity: 0.7 }}>
                  <i className="ti ti-arrow-narrow-right" style={{ fontSize: "13px" }} aria-hidden />
                  {rel.relation || "relates to"}
                  <i className="ti ti-arrow-narrow-right" style={{ fontSize: "13px" }} aria-hidden />
                </span>
                <Chip size="md">{rel.target}</Chip>
              </div>
            ))}
          </div>
        </LineageStep>
      )}

      {extractedSkills.length > 0 && (
        <LineageStep icon="ti-checkbox" title="Skills extracted">
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {extractedSkills.map((s, i) => (
              <span key={i} style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <i className="ti ti-check" style={{ fontSize: "13px" }} aria-hidden />
                {s}
              </span>
            ))}
          </div>
        </LineageStep>
      )}

      <LineageStep icon="ti-adjustments" title="Capability rule matched">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {components.length
            ? components.map((c) => <Chip key={c.key}>{c.label} rule · {c.count}</Chip>)
            : <span style={{ fontSize: "12px", opacity: 0.5 }}>No structural rule recorded.</span>}
        </div>
      </LineageStep>

      <div style={{ textAlign: "center", margin: "18px 0 10px" }}>
        <i className="ti ti-arrow-narrow-down" style={{ fontSize: "18px", opacity: 0.5 }} aria-hidden />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ background: INK, color: PAPER, padding: "14px 22px", borderRadius: "10px", textAlign: "center", maxWidth: "420px" }}>
          <p style={{ margin: 0, fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7 }}>Generated skill</p>
          <p style={{ margin: "4px 0 0", fontSize: "15px", fontWeight: 800 }}>{skill.name}</p>
          {typeof skill.knowledge_completeness === "number" && (
            <p style={{ margin: "6px 0 0", fontSize: "11px", opacity: 0.8 }}>
              {Math.round(skill.knowledge_completeness * 100)}% keyword coverage
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillLineageView({ skills, selectedSkillId, setSelectedSkillId }) {
  const [search, setSearch] = useState("");
  const filtered = skills.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${s.name} ${s.subtype} ${s.description || ""}`.toLowerCase().includes(q);
  });
  const selected = skills.find((s) => s.skill_id === selectedSkillId) || filtered[0] || skills[0];

  useEffect(() => {
    console.group("VIEW 3 - SKILL LINEAGE");
    console.log("Selected Skill");
    console.log(selected);
    console.log("Skill Body");
    console.log(selected?.body);
    console.log("Relationships");
    console.log(selected?.body?.relationships);
    console.groupEnd();
  }, [selected]);

  return (
    <div>
      <SectionHeading icon="ti-sitemap" title="Skill lineage" subtitle="Pick a skill to see exactly which extracted knowledge produced it" />
      {skills.length === 0 ? (
        <EmptyState icon="ti-bulb-off" text="No skills available yet." />
      ) : (
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 260px", maxWidth: "100%" }}>
            <div style={{ position: "relative", marginBottom: "10px" }}>
              <i className="ti ti-search" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "12px" }} aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills..."
                style={{ width: "100%", padding: "7px 9px 7px 28px", fontSize: "12px", border: `1.5px solid ${INK}`, borderRadius: "7px", outline: "none" }}
              />
            </div>
            <div style={{ maxHeight: "560px", overflowY: "auto", paddingRight: "4px" }}>
              {filtered.length === 0 ? (
                <p style={{ fontSize: "12px", opacity: 0.5 }}>No skills match.</p>
              ) : (
                filtered.map((s) => (
                  <SkillMiniRow key={s.skill_id} skill={s} active={selected?.skill_id === s.skill_id} onClick={() => setSelectedSkillId(s.skill_id)} />
                ))
              )}
            </div>
          </div>
          <div style={{ flex: "1 1 380px", border: `1.5px solid ${INK}`, borderRadius: "12px", padding: "22px 20px" }}>
            {selected ? <LineageChain skill={selected} /> : <EmptyState icon="ti-bulb-off" text="Select a skill from the list." />}
          </div>
        </div>
      )}
    </div>
  );
}
// ═════════════════════════════════════════════════════════════════
// 4. EXPANDABLE EVIDENCE TREE  (unchanged — already real data)
// ═════════════════════════════════════════════════════════════════

function leafLabel(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const name = entityName(item);
    const extra = item.significance || item.criteria || item.finding || item.statement || item.definition || item.action || "";
    if (name && extra) return `${name} — ${String(extra).slice(0, 90)}`;
    if (name) return name;
    const firstStr = Object.values(item).find((v) => typeof v === "string" && v.trim());
    return firstStr ? firstStr.slice(0, 90) : "Item";
  }
  return String(item);
}

function toTreeNode(key, value) {
  if (key.startsWith("_") || META_KEYS.has(key)) return null;
  if (countItems(value) === 0) return null;
  const label = FIELD_LABELS[key] || prettify(key);

  if (typeof value === "string") return { label, children: [{ label: value, leaf: true }] };

  if (Array.isArray(value)) {
    const children = value.slice(0, 30).map((item) => ({ label: leafLabel(item), leaf: true }));
    return { label, count: value.length, children };
  }

  if (typeof value === "object") {
    const children = Object.entries(value).map(([k, v]) => toTreeNode(k, v)).filter(Boolean);
    if (!children.length) return null;
    return { label, children };
  }

  return null;
}

function buildEvidenceTree(preview, skills) {
  const summary = preview?.summary || {};
  const diag = preview?.diagnosis_knowledge || {};
  const treat = preview?.treatment_knowledge || {};
  const rels = aggregateRelationships(skills);

  const diagChildren = Object.entries(diag).map(([k, v]) => toTreeNode(k, v)).filter(Boolean);
  const treatChildren = Object.entries(treat).map(([k, v]) => toTreeNode(k, v)).filter(Boolean);

  const relChildren = rels.slice(0, 60).map((r) => ({
    label: `${r.source} → ${r.relation} → ${r.target}${r.source_page ? ` (p. ${r.source_page})` : ""}`,
    leaf: true,
  }));

  const skillsByType = {};
  (skills || []).forEach((s) => {
    (skillsByType[s.skill_type] = skillsByType[s.skill_type] || []).push(s);
  });
  const skillChildren = Object.entries(skillsByType).map(([type, list]) => ({
    label: `${prettify(type)} skills`,
    count: list.length,
    children: list.map((s) => ({
      label: `${s.name}${s.subtype && s.subtype !== "General" ? ` (${s.subtype})` : ""}`,
      leaf: true,
    })),
  }));

  return {
    label: preview?.guideline?.name || "Guideline",
    children: [
      {
        label: summary.disease_type || summary.disease_name || "Disease",
        children: [
          diagChildren.length ? { label: "Diagnosis", count: diagChildren.length, children: diagChildren } : null,
          treatChildren.length ? { label: "Treatment", count: treatChildren.length, children: treatChildren } : null,
          rels.length ? { label: "Relationships", count: rels.length, children: relChildren } : null,
          skills.length ? { label: "Skills", count: skills.length, children: skillChildren } : null,
        ].filter(Boolean),
      },
    ],
  };
}

function TreeNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : "16px" }}>
      <div
        onClick={() => hasChildren && setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "5px 6px",
          cursor: hasChildren ? "pointer" : "default", borderRadius: "5px",
          borderLeft: depth > 0 ? "1.5px solid rgba(0,0,0,0.25)" : "none",
          paddingLeft: depth > 0 ? "10px" : "6px",
        }}
      >
        {hasChildren ? (
          <i className={`ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`} style={{ fontSize: "12px", flexShrink: 0 }} aria-hidden />
        ) : (
          <i className="ti ti-point" style={{ fontSize: "8px", flexShrink: 0, opacity: 0.5 }} aria-hidden />
        )}
        <span style={{ fontSize: node.leaf ? "12px" : "12.5px", fontWeight: node.leaf ? 400 : 700, color: node.leaf ? "rgba(0,0,0,0.75)" : INK }}>
          {node.label}
        </span>
        {typeof node.count === "number" && <span style={{ fontSize: "10.5px", color: "rgba(0,0,0,0.45)" }}>({node.count})</span>}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((child, i) => <TreeNode key={i} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function EvidenceTreeView({ preview, skills }) {
  const tree = useMemo(() => buildEvidenceTree(preview, skills), [preview, skills]);

  useEffect(() => {
    console.group("VIEW 4 - EVIDENCE TREE");

    console.log("Diagnosis Knowledge");
    console.log(preview?.diagnosis_knowledge);

    console.log("Treatment Knowledge");
    console.log(preview?.treatment_knowledge);

    console.log("Tree");
    console.log(tree);

    console.groupEnd();
  }, [preview, tree]);
  return (
    <div>
      <SectionHeading icon="ti-list-tree" title="Evidence tree" subtitle="Expand any branch to see exactly what was extracted, down to the source item" />
      <div style={{ border: `1.5px solid ${INK}`, borderRadius: "10px", padding: "12px 10px" }}>
        <TreeNode node={tree} depth={0} />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// 5. RELATIONSHIP EXPLORER  (unchanged — already real data)
// ═════════════════════════════════════════════════════════════════

function RelationshipExplorerView({ skills }) {
  const relationships = useMemo(() => aggregateRelationships(skills), [skills]);

  useEffect(() => {
    console.group("VIEW 5 - RELATIONSHIP EXPLORER");

    console.table(relationships);

    console.groupEnd();
  }, [relationships]);
  const [search, setSearch] = useState("");
  const [relationFilter, setRelationFilter] = useState("all");
  const [expandedKey, setExpandedKey] = useState(null);

  const relationTypes = useMemo(() => Array.from(new Set(relationships.map((r) => r.relation))).sort(), [relationships]);

  const filtered = relationships.filter((r) => {
    if (relationFilter !== "all" && r.relation !== relationFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !`${r.source} ${r.target} ${r.relation}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div>
      <SectionHeading icon="ti-arrows-right-left" title="Relationship explorer" subtitle="Clinical relationships extracted from the guideline text, and which skills rely on them" />

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <i className="ti ti-search" style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", fontSize: "13px" }} aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search source, target, relation..."
            style={{ width: "100%", padding: "8px 10px 8px 32px", fontSize: "12.5px", border: `1.5px solid ${INK}`, borderRadius: "7px", outline: "none" }}
          />
        </div>
        <select
          value={relationFilter}
          onChange={(e) => setRelationFilter(e.target.value)}
          style={{ padding: "8px 10px", fontSize: "12.5px", border: `1.5px solid ${INK}`, borderRadius: "7px", background: PAPER }}
        >
          <option value="all">All relationship types ({relationships.length})</option>
          {relationTypes.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="ti-arrows-right-left" text="No relationships match the current filters." />
      ) : (
        <div style={{ border: `1.5px solid ${INK}`, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr 90px", background: INK, color: PAPER, fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <div style={{ padding: "9px 12px" }}>Source</div>
            <div style={{ padding: "9px 12px" }}>Relationship</div>
            <div style={{ padding: "9px 12px" }}>Target</div>
            <div style={{ padding: "9px 12px" }}>Evidence</div>
          </div>
          {filtered.map((r) => {
            const key = `${r.source}|${r.relation}|${r.target}`;
            const isOpen = expandedKey === key;
            return (
              <div key={key} style={{ borderTop: "1px solid rgba(0,0,0,0.15)" }}>
                <div
                  onClick={() => setExpandedKey(isOpen ? null : key)}
                  style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr 90px", cursor: "pointer", alignItems: "center" }}
                >
                  <div style={{ padding: "9px 12px", fontSize: "12.5px", fontWeight: 600 }}>{r.source}</div>
                  <div style={{ padding: "9px 12px", fontSize: "11.5px", fontStyle: "italic", opacity: 0.75 }}>{r.relation}</div>
                  <div style={{ padding: "9px 12px", fontSize: "12.5px", fontWeight: 600 }}>{r.target}</div>
                  <div style={{ padding: "9px 12px", fontSize: "11.5px", display: "flex", alignItems: "center", gap: "4px" }}>
                    {r.source_page ? `p. ${r.source_page}` : "—"}
                    <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize: "11px", marginLeft: "auto" }} aria-hidden />
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: "10px 14px 14px", background: "rgba(0,0,0,0.03)" }}>
                    <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Used by skills</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                      {r.skills.map((s, i) => <Chip key={i}>{s}</Chip>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// MAIN EXPORT — tab shell over the 5 views
// ═════════════════════════════════════════════════════════════════

export default function KnowledgeLineageView({
  preview,
  skills: skillsProp,
  skillCoverage,
  doctorId,   // NEW — required for View 2's real graph fetch
  docId,      // NEW — required for View 2's real graph fetch
  graph,      // NEW — optional: pass { nodes, edges } directly to skip the fetch
  apiBase,    // NEW — optional override for the fetch URL prefix
}) {
  const skills = skillsProp || preview?.skills_preview || [];
  const [activeView, setActiveView] = useState("flow");
  const [selectedSkillId, setSelectedSkillId] = useState(skills[0]?.skill_id || null);

  useEffect(() => {
    console.group("========== BACKEND RESPONSE ==========");

    console.log("Preview");
    console.log(preview);

    console.log("Skills");
    console.log(skills);

    console.log("Skill Coverage");
    console.log(skillCoverage);

    console.groupEnd();
}, [preview, skills, skillCoverage]);

  const TABS = [
    { id: "flow", label: "Knowledge Flow", icon: "ti-route" },
    { id: "graph", label: "Knowledge Graph", icon: "ti-affiliate" },
    { id: "lineage", label: "Skill Lineage", icon: "ti-sitemap" },
    { id: "tree", label: "Evidence Tree", icon: "ti-list-tree" },
    { id: "relationships", label: "Relationships", icon: "ti-arrows-right-left" },
  ];

  return (
    <div style={{ fontFamily: "'Open Sans', sans-serif", color: INK }}>
      <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap", borderBottom: `2px solid ${INK}`, paddingBottom: "10px" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveView(t.id)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "8px 14px", fontSize: "12px", fontWeight: 700,
              borderRadius: "7px", border: `1.5px solid ${INK}`, cursor: "pointer",
              background: activeView === t.id ? INK : PAPER,
              color: activeView === t.id ? PAPER : INK,
            }}
          >
            <i className={`ti ${t.icon}`} style={{ fontSize: "13px" }} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {activeView === "flow" && <KnowledgeFlowView preview={preview} skills={skills} skillCoverage={skillCoverage} />}
      {activeView === "graph" && (
        <KnowledgeGraphView doctorId={doctorId} docId={docId} graph={graph} apiBase={apiBase} />
      )}
      {activeView === "lineage" && (
        <SkillLineageView skills={skills} selectedSkillId={selectedSkillId} setSelectedSkillId={setSelectedSkillId} />
      )}
      {activeView === "tree" && <EvidenceTreeView preview={preview} skills={skills} />}
      {activeView === "relationships" && <RelationshipExplorerView skills={skills} />}
    </div>
  );
}