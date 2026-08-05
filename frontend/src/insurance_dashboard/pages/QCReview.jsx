import { useState, useEffect, useCallback, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = "https://doctorassist.ai/api/hms/app";

const INV_META = {
  MV:   { label: "Medical Visit",          color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
  HV:   { label: "Hospital Visit",         color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" },
  HVI:  { label: "Home / Neighbour Visit", color: "#EA580C", bg: "#FFF7ED", border: "#FED7AA" },
  TELE: { label: "Telephone Verification", color: "#7C3AED", bg: "#FAF5FF", border: "#DDD6FE" },
  BILL: { label: "Bill Verification",      color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
};

const STATUS_META = {
  PENDING:       { label: "Pending",        bg: "#F3F4F6", color: "#6B7280" },
  PARTIAL:       { label: "Partial",        bg: "#FEF9C3", color: "#854D0E" },
  COMPLETED:     { label: "Completed",      bg: "#DCFCE7", color: "#166534" },
  REINVESTIGATE: { label: "Re-investigate", bg: "#FEE2E2", color: "#991B1B" },
  VERIFIED:      { label: "Verified",       bg: "#D1FAE5", color: "#065F46" },
  ALLOCATED:     { label: "Allocated",      bg: "#EDE9FE", color: "#5B21B6" },
  IN_PROGRESS:   { label: "In Progress",    bg: "#DBEAFE", color: "#1D4ED8" },
};

const PRIORITY_COLOR = {
  Critical: "#DC2626", High: "#EA580C", Urgent: "#BE185D", Normal: "#6B7280",
};
const LAB_RESULT_META = { bg: "#F0F9FF", color: "#0369A1" };

const ENTITY_META = {
  Diagnosis:   { bg: "#FEE2E2", color: "#991B1B" },
  Finding:     { bg: "#FEF3C7", color: "#92400E" },
  Procedure:   { bg: "#EDE9FE", color: "#5B21B6" },
  Measurement: { bg: "#DBEAFE", color: "#1D4ED8" },
  Treatment:   { bg: "#D1FAE5", color: "#065F46" },
  "Vital Sign":{ bg: "#F0FDF4", color: "#166534" },
};

const ENTITY_TYPES = ["Diagnosis", "Finding", "Procedure", "Measurement", "Treatment", "Vital Sign"];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
const sm  = (s) => STATUS_META[s] || STATUS_META.PENDING;
const em  = (t) => ENTITY_META[t] || { bg: "#F3F4F6", color: "#374151" };

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Tiny shared components ────────────────────────────────────────────────────

function Badge({ status, size = "sm" }) {
  const m = sm(status);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: size === "xs" ? "2px 6px" : "3px 9px",
      borderRadius: 99, fontSize: size === "xs" ? 10 : 11,
      fontWeight: 700, letterSpacing: "0.02em",
      background: m.bg, color: m.color, whiteSpace: "nowrap",
    }}>{m.label}</span>
  );
}

function DocBar({ submitted, total }) {
  const pct  = total > 0 ? Math.round((submitted / total) * 100) : 0;
  const done = submitted === total && total > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: "#E5E7EB", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 99, width: `${pct}%`,
          background: done ? "#16A34A" : "#3B82F6",
          transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 11, color: "#6B7280", minWidth: 32, textAlign: "right" }}>
        {submitted}/{total}
      </span>
    </div>
  );
}

function Spinner({ size = 18, color = "#374151" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid #E5E7EB", borderTopColor: color,
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

// ── Claim sidebar card ────────────────────────────────────────────────────────

function ClaimCard({ claim, selected, onClick }) {
  const pc = PRIORITY_COLOR[claim.priority] || "#6B7280";
  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left",
      padding: "12px 14px",
      background: selected ? "#EFF6FF" : "transparent",
      borderLeft: selected ? "3px solid #2563EB" : "3px solid transparent",
      borderTop: "none", borderRight: "none", borderBottom: "1px solid #F3F4F6",
      cursor: "pointer", transition: "background 0.15s",
    }}
      onMouseEnter={e => !selected && (e.currentTarget.style.background = "#F9FAFB")}
      onMouseLeave={e => !selected && (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em" }}>
          {claim.id}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: pc, flexShrink: 0 }} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 2, lineHeight: 1.3 }}>
        {claim.claimantName}
      </div>
      <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 2 }}>{claim.type}</div>
      <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 8 }}>{claim.insurer}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <DocBar submitted={claim.docsSubmitted} total={claim.docsTotal} />
        </div>
        <Badge status={claim.status} size="xs" />
      </div>
    </button>
  );
}

// ── Entity pill (inline in doc expand) ───────────────────────────────────────

function EntityPill({ e }) {
  const c = em(e.entity_type);
  return (
    <div style={{
      display: "inline-flex", alignItems: "baseline", gap: 4, flexWrap: "wrap",
      padding: "3px 8px", borderRadius: 99,
      background: c.bg, color: c.color, fontSize: 11, maxWidth: "100%",
    }}>
      <span style={{ fontWeight: 800, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.7 }}>
        {e.entity_type}
      </span>
      <span style={{ fontWeight: 600 }}>{e.entity_name}</span>
      {e.entity_value && <span style={{ opacity: 0.85 }}>→ {e.entity_value}</span>}
    </div>
  );
}

// ── Document row ──────────────────────────────────────────────────────────────

function DocRow({ doc, invType, flagged, onToggleFlag, onPreview }) {
  const [open, setOpen] = useState(false);
  const c = INV_META[invType] || INV_META.MV;

  return (
    <div style={{
      border: `1px solid ${flagged ? "#FCA5A5" : "#E5E7EB"}`,
      borderRadius: 8, overflow: "hidden", marginBottom: 6,
      background: flagged ? "#FFF5F5" : "#fff",
      transition: "border-color 0.2s, background 0.2s",
    }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "9px 12px",
        gap: 10, cursor: doc.submitted ? "pointer" : "default",
      }} onClick={() => doc.submitted && setOpen(v => !v)}>

        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke={doc.submitted ? c.color : "#D1D5DB"} strokeWidth="2" strokeLinecap="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: doc.submitted ? "#374151" : "#9CA3AF" }}>
            {doc.label}
          </div>
          <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc.submitted ? (doc.file_name || "Document received") : "Not yet submitted"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {doc.submitted && doc.entities?.length > 0 && (
            <span style={{
              padding: "2px 7px", borderRadius: 99, fontSize: 10,
              background: "#EDE9FE", color: "#5B21B6", fontWeight: 700,
            }}>
              {doc.entities.length} entities
            </span>
          )}
          {doc.submitted && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onPreview(doc); }}
                title="Preview PDF"
                style={{
                  border: "1px solid #BFDBFE", borderRadius: 6,
                  background: "#EFF6FF", padding: "3px 7px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  color: "#2563EB", fontSize: 11, fontWeight: 600,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                View
              </button>

              <button
                onClick={e => { e.stopPropagation(); onToggleFlag(); }}
                title={flagged ? "Remove flag" : "Flag for re-investigation"}
                style={{
                  border: `1px solid ${flagged ? "#FCA5A5" : "#E5E7EB"}`,
                  borderRadius: 6, background: flagged ? "#FEE2E2" : "#F9FAFB",
                  padding: "3px 7px", cursor: "pointer", display: "flex", alignItems: "center",
                  color: flagged ? "#DC2626" : "#9CA3AF", transition: "all 0.15s",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24"
                  fill={flagged ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
              </button>

              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF"
                strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <polyline points="6,9 12,15 18,9" />
              </svg>
            </>
          )}
        </div>
      </div>

      {open && doc.submitted && (
        <div style={{
          borderTop: "1px solid #F3F4F6", padding: "10px 12px",
          background: "#FAFAFA", animation: "fadeIn 0.15s ease",
        }}>
          {doc.document_id && (
            <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 8, fontFamily: "monospace" }}>
              {doc.document_id}
            </div>
          )}
          {doc.entities?.length > 0 ? (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Extracted data
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {doc.entities.map((e, i) => <EntityPill key={i} e={e} />)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#9CA3AF", fontStyle: "italic" }}>
              No extracted entities for this document
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Investigation section ─────────────────────────────────────────────────────

function InvSection({ invType, inv, flaggedDocs, onToggleFlag, onPreview }) {
  const [open, setOpen] = useState(true);
  const c         = INV_META[invType] || INV_META.MV;
  const submitted = inv.docs.filter(d => d.submitted).length;
  const total     = inv.docs.length;
  const sub       = inv.submission;

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", background: c.bg,
        border: "none", cursor: "pointer", textAlign: "left",
      }}>
        <span style={{
          padding: "3px 8px", borderRadius: 6,
          background: c.color, color: "#fff",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
        }}>{invType}</span>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{inv.label}</div>
          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 1 }}>
            {inv.investigatorName}
            {sub?.submitted_at ? ` · ${sub.submitted_at}` : ""}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: c.color }}>{submitted}/{total} docs</span>
          {sub && <Badge status={sub.status} size="xs" />}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={c.color}
            strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </div>
      </button>

      {open && (
        <div style={{ padding: "10px 14px" }}>
          {sub?.text_fields && Object.keys(sub.text_fields).length > 0 && (
            <div style={{
              background: "#F9FAFB", borderRadius: 8, padding: "10px 12px",
              marginBottom: 10, border: "1px solid #E5E7EB",
            }}>
              {Object.entries(sub.text_fields).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, marginBottom: 5, fontSize: 12 }}>
                  <span style={{ color: "#9CA3AF", minWidth: 120, textTransform: "capitalize", flexShrink: 0 }}>
                    {k.replace(/_/g, " ")}
                  </span>
                  <span style={{ color: "#374151", flex: 1 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {inv.docs.map(doc => (
            <DocRow
              key={doc.key}
              doc={doc}
              invType={invType}
              flagged={!!flaggedDocs[`${invType}::${doc.key}`]}
              onToggleFlag={() => onToggleFlag(invType, doc.key)}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Entity Editor Modal ───────────────────────────────────────────────────────

function EntityEditorModal({ doc, onSave, onClose, loading }) {
  const [entities, setEntities] = useState(
    (doc.entities || []).map((e, i) => ({ ...e, _id: i }))
  );
  const [nextId, setNextId] = useState((doc.entities || []).length);

  const updateEntity = (id, field, value) =>
    setEntities(prev => prev.map(e => e._id === id ? { ...e, [field]: value } : e));

  const deleteEntity = (id) =>
    setEntities(prev => prev.filter(e => e._id !== id));

  const addEntity = () => {
    setEntities(prev => [...prev, {
      _id: nextId, entity_type: "Finding",
      entity_name: "", entity_value: "", confidence: 0.99, evidence_text: "",
    }]);
    setNextId(n => n + 1);
  };

  const handleSave = () => {
    const clean = entities.map(({ _id, ...rest }) => rest);
    onSave(doc.document_id, clean);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14,
        width: "min(680px, 96vw)", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid #E5E7EB",
          background: "#F9FAFB", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Edit Extracted Entities</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
              {doc.label} ·{" "}
              <span style={{ fontFamily: "monospace" }}>{doc.document_id}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            border: "1px solid #E5E7EB", borderRadius: 7, background: "#fff",
            padding: "6px 10px", cursor: "pointer", color: "#6B7280", fontSize: 13,
          }}>✕</button>
        </div>

        {/* Entity rows */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {entities.length === 0 && (
            <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "24px 0", fontStyle: "italic" }}>
              No entities yet. Add one below.
            </div>
          )}

          {entities.map((e) => {
            const c = em(e.entity_type);
            return (
              <div key={e._id} style={{
                border: `1px solid ${c.color}33`, borderLeft: `3px solid ${c.color}`,
                borderRadius: 9, padding: "12px 14px", marginBottom: 10, background: c.bg,
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                {/* Type + delete */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", minWidth: 80 }}>Type</span>
                  <select
                    value={e.entity_type}
                    onChange={ev => updateEntity(e._id, "entity_type", ev.target.value)}
                    style={{
                      flex: 1, padding: "5px 8px", borderRadius: 7,
                      border: "1px solid #D1D5DB", fontSize: 12, fontWeight: 600,
                      color: c.color, background: "#fff", outline: "none",
                    }}
                  >
                    {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button onClick={() => deleteEntity(e._id)} title="Delete" style={{
                    border: "1px solid #FCA5A5", borderRadius: 7,
                    background: "#FEE2E2", padding: "5px 9px",
                    cursor: "pointer", color: "#DC2626", fontSize: 12, flexShrink: 0,
                  }}>✕</button>
                </div>

                {/* Name */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", minWidth: 80 }}>Name</span>
                  <input
                    value={e.entity_name}
                    onChange={ev => updateEntity(e._id, "entity_name", ev.target.value)}
                    placeholder="Entity name"
                    style={{
                      flex: 1, padding: "5px 9px", borderRadius: 7,
                      border: "1px solid #D1D5DB", fontSize: 12, outline: "none",
                    }}
                  />
                </div>

                {/* Value */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", minWidth: 80 }}>Value</span>
                  <input
                    value={e.entity_value || ""}
                    onChange={ev => updateEntity(e._id, "entity_value", ev.target.value)}
                    placeholder="Optional value"
                    style={{
                      flex: 1, padding: "5px 9px", borderRadius: 7,
                      border: "1px solid #D1D5DB", fontSize: 12, outline: "none",
                    }}
                  />
                </div>

                {/* Evidence */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", minWidth: 80, paddingTop: 5 }}>Evidence</span>
                  <textarea
                    rows={2}
                    value={e.evidence_text || ""}
                    onChange={ev => updateEntity(e._id, "evidence_text", ev.target.value)}
                    placeholder="Supporting text from document"
                    style={{
                      flex: 1, padding: "5px 9px", borderRadius: 7,
                      border: "1px solid #D1D5DB", fontSize: 11,
                      outline: "none", resize: "vertical",
                      fontFamily: "inherit", color: "#374151",
                    }}
                  />
                </div>
              </div>
            );
          })}

          {/* Add entity */}
          <button onClick={addEntity} style={{
            width: "100%", padding: "10px", borderRadius: 9,
            border: "1.5px dashed #D1D5DB", background: "#F9FAFB",
            fontSize: 13, fontWeight: 600, color: "#6B7280",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Entity
          </button>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 18px", borderTop: "1px solid #E5E7EB",
          background: "#F9FAFB", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            padding: "10px 20px", borderRadius: 9,
            border: "1px solid #E5E7EB", background: "#fff",
            fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={loading} style={{
            padding: "10px 24px", borderRadius: 9, border: "none",
            background: loading ? "#9CA3AF" : "#2563EB",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {loading
              ? <Spinner size={14} color="#fff" />
              : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  Save Changes
                </>
              )
            }
          </button>
        </div>
      </div>
    </div>
  );
}
function ContentEditorModal({ doc, onSave, onClose, loading }) {
  const [activeEdit, setActiveEdit] = useState("raw"); // "raw" | "sections"
  const [rawMarkdown, setRawMarkdown] = useState(doc.raw_markdown || "");
  const [sections, setSections] = useState(
    doc.sections?.sections
      ? doc.sections.sections.map((s, i) => ({ ...s, _id: i }))
      : []
  );
  const [tables, setTables] = useState(doc.sections?.tables || []);
  const [nextId, setNextId] = useState(doc.sections?.sections?.length || 0);

  const updateSection = (id, field, value) =>
    setSections(prev => prev.map(s => s._id === id ? { ...s, [field]: value } : s));

  const deleteSection = (id) =>
    setSections(prev => prev.filter(s => s._id !== id));

  const addSection = () => {
    setSections(prev => [...prev, { _id: nextId, heading: "", content: "" }]);
    setNextId(n => n + 1);
  };

  const handleSave = () => {
    const cleanSections = sections.map(({ _id, ...rest }) => rest);
    onSave(doc.document_id, {
      raw_markdown: rawMarkdown,
      sections: { tables, sections: cleanSections },
    });
  };

  const TAB = (active) => ({
    padding: "6px 16px", borderRadius: 7, border: "none",
    background: active ? "#2563EB" : "transparent",
    color: active ? "#fff" : "#6B7280",
    fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 400,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14,
        width: "min(780px, 96vw)", height: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid #E5E7EB",
          background: "#F9FAFB", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>
              Edit Document Content
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
              {doc.label} ·{" "}
              <span style={{ fontFamily: "monospace" }}>{doc.document_id}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            border: "1px solid #E5E7EB", borderRadius: 7, background: "#fff",
            padding: "6px 10px", cursor: "pointer", color: "#6B7280", fontSize: 13,
          }}>✕</button>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: "flex", gap: 4, padding: "10px 18px",
          borderBottom: "1px solid #E5E7EB", background: "#F9FAFB",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: 4, background: "#F3F4F6", padding: 3, borderRadius: 9 }}>
            <button style={TAB(activeEdit === "raw")} onClick={() => setActiveEdit("raw")}>
              Raw Markdown
            </button>
            <button style={TAB(activeEdit === "sections")} onClick={() => setActiveEdit("sections")}>
              Sections ({sections.length})
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>

          {/* RAW MARKDOWN EDITOR */}
          {activeEdit === "raw" && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
              }}>
                Raw Markdown Text
              </div>
              <textarea
                value={rawMarkdown}
                onChange={e => setRawMarkdown(e.target.value)}
                placeholder="Raw extracted markdown text from the document..."
                style={{
                  flex: 1, minHeight: 400,
                  padding: "12px 14px", borderRadius: 9,
                  border: "1px solid #D1D5DB", fontSize: 12,
                  lineHeight: 1.7, color: "#374151",
                  fontFamily: "'DM Mono', monospace",
                  resize: "vertical", outline: "none",
                  background: "#FAFAFA",
                }}
              />
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 6 }}>
                {rawMarkdown.length} characters · {rawMarkdown.split("\n").length} lines
              </div>
            </div>
          )}

          {/* SECTIONS EDITOR */}
          {activeEdit === "sections" && (
            <div>
              {/* Tables */}
              {tables.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
                  }}>
                    Tables ({tables.length}) — read only
                  </div>
                  {tables.map((t, i) => (
                    <div key={i} style={{
                      background: "#FFFBEB", border: "1px solid #FDE68A",
                      borderRadius: 8, padding: "10px 12px", marginBottom: 8,
                      fontSize: 11, color: "#92400E",
                      fontFamily: "'DM Mono', monospace",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {typeof t === "string" ? t : JSON.stringify(t, null, 2)}
                    </div>
                  ))}
                </div>
              )}

              {/* Section rows */}
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
              }}>
                Sections
              </div>

              {sections.length === 0 && (
                <div style={{
                  fontSize: 13, color: "#9CA3AF", textAlign: "center",
                  padding: "20px 0", fontStyle: "italic",
                }}>
                  No sections yet. Add one below.
                </div>
              )}

              {sections.map((s) => (
                <div key={s._id} style={{
                  border: "1px solid #BFDBFE", borderLeft: "3px solid #2563EB",
                  borderRadius: 9, marginBottom: 12, overflow: "hidden",
                }}>
                  {/* Heading row */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", background: "#EFF6FF",
                    borderBottom: "1px solid #BFDBFE",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                      minWidth: 60, flexShrink: 0,
                    }}>Heading</span>
                    <input
                      value={s.heading}
                      onChange={ev => updateSection(s._id, "heading", ev.target.value)}
                      placeholder="Section heading..."
                      style={{
                        flex: 1, padding: "5px 9px", borderRadius: 7,
                        border: "1px solid #BFDBFE", fontSize: 12,
                        fontWeight: 600, color: "#1D4ED8",
                        outline: "none", background: "#fff",
                      }}
                    />
                    <button onClick={() => deleteSection(s._id)} title="Delete section" style={{
                      border: "1px solid #FCA5A5", borderRadius: 7,
                      background: "#FEE2E2", padding: "5px 9px",
                      cursor: "pointer", color: "#DC2626", fontSize: 12, flexShrink: 0,
                    }}>✕</button>
                  </div>
                  {/* Content area */}
                  <div style={{ padding: "8px 12px", background: "#fff" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                      display: "block", marginBottom: 4,
                    }}>Content</span>
                    <textarea
                      rows={4}
                      value={s.content}
                      onChange={ev => updateSection(s._id, "content", ev.target.value)}
                      placeholder="Section content..."
                      style={{
                        width: "100%", padding: "7px 10px", borderRadius: 7,
                        border: "1px solid #E5E7EB", fontSize: 11,
                        lineHeight: 1.6, color: "#374151",
                        fontFamily: "'DM Mono', monospace",
                        resize: "vertical", outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>
              ))}

              {/* Add section button */}
              <button onClick={addSection} style={{
                width: "100%", padding: "10px", borderRadius: 9,
                border: "1.5px dashed #D1D5DB", background: "#F9FAFB",
                fontSize: 13, fontWeight: 600, color: "#6B7280",
                cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Section
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 18px", borderTop: "1px solid #E5E7EB",
          background: "#F9FAFB", display: "flex", gap: 10,
          justifyContent: "flex-end", flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            padding: "10px 20px", borderRadius: 9,
            border: "1px solid #E5E7EB", background: "#fff",
            fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={loading} style={{
            padding: "10px 24px", borderRadius: 9, border: "none",
            background: loading ? "#9CA3AF" : "#2563EB",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {loading
              ? <Spinner size={14} color="#fff" />
              : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  Save to Database
                </>
              )
            }
          </button>
        </div>
      </div>
    </div>
  );
}
// ── PDF Preview panel ─────────────────────────────────────────────────────────

function PdfPreviewPanel({ doc, onClose, onEditContent }) {
  const [tab, setTab] = useState("raw"); // "raw" | "sections"
  if (!doc) return null;

  const TAB_STYLE = (active) => ({
    padding: "6px 14px", borderRadius: 7, border: "none",
    background: active ? "#2563EB" : "transparent",
    color: active ? "#fff" : "#6B7280",
    fontSize: 11, fontWeight: 700, cursor: "pointer",
    transition: "all 0.15s",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14,
        width: "min(1100px, 96vw)", height: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{doc.label}</div>
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
              {doc.file_name || doc.document_id}
              {doc.document_id && (
                <span style={{ fontFamily: "monospace", marginLeft: 8, opacity: 0.7 }}>
                  · {doc.document_id}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a href={doc.file_url} target="_blank" rel="noreferrer" style={{
              padding: "6px 12px", borderRadius: 7,
              background: "#EFF6FF", color: "#2563EB",
              fontSize: 12, fontWeight: 600, textDecoration: "none",
              border: "1px solid #BFDBFE", display: "flex", alignItems: "center", gap: 5,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Open in new tab
            </a>
            <button onClick={onClose} style={{
              border: "1px solid #E5E7EB", borderRadius: 7, background: "#fff",
              padding: "6px 10px", cursor: "pointer", color: "#6B7280",
            }}>✕</button>
          </div>
        </div>

        {/* Split: PDF left, data right */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

          {/* PDF iframe */}
          <iframe
            src={doc.file_url}
            title="Document preview"
            style={{ flex: 3, border: "none", minHeight: 0 }}
          />

          {/* Right panel */}
          <div style={{
            flex: 2, borderLeft: "1px solid #E5E7EB",
            display: "flex", flexDirection: "column", minHeight: 0,
          }}>

            {/* Tab bar + Edit button */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", borderBottom: "1px solid #E5E7EB",
              background: "#F9FAFB", flexShrink: 0, gap: 8,
            }}>
              <div style={{
                display: "flex", gap: 4,
                background: "#F3F4F6", padding: 3, borderRadius: 9,
              }}>
                <button style={TAB_STYLE(tab === "raw")} onClick={() => setTab("raw")}>
                  Raw Text
                </button>
                <button style={TAB_STYLE(tab === "sections")} onClick={() => setTab("sections")}>
                  Sections
                  {doc.sections?.sections?.length > 0 && (
                    <span style={{
                      marginLeft: 5, background: "rgba(255,255,255,0.3)",
                      borderRadius: 99, padding: "0 5px", fontSize: 10,
                    }}>
                      {doc.sections.sections.length}
                    </span>
                  )}
                </button>
              </div>

              {doc.document_id && (
                <button onClick={() => onEditContent(doc)} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 12px", borderRadius: 7,
                  border: "1px solid #BFDBFE", background: "#EFF6FF",
                  color: "#2563EB", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit Content
                </button>
              )}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

              {/* RAW TEXT */}
              {tab === "raw" && (
                doc.raw_markdown ? (
                  <pre style={{
                    fontSize: 11, lineHeight: 1.7, color: "#374151",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    fontFamily: "'DM Mono', monospace",
                    background: "#F9FAFB", borderRadius: 8,
                    padding: 12, border: "1px solid #E5E7EB", margin: 0,
                  }}>
                    {doc.raw_markdown}
                  </pre>
                ) : (
                  <div style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    height: "100%", gap: 8, color: "#9CA3AF",
                  }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14,2 14,8 20,8"/>
                    </svg>
                    <div style={{ fontSize: 12, fontStyle: "italic" }}>No raw text available</div>
                    {doc.document_id && (
                      <button onClick={() => onEditContent(doc)} style={{
                        marginTop: 4, padding: "6px 14px", borderRadius: 7,
                        border: "1px solid #BFDBFE", background: "#EFF6FF",
                        color: "#2563EB", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      }}>
                        Add raw text
                      </button>
                    )}
                  </div>
                )
              )}

              {/* SECTIONS */}
              {tab === "sections" && (
                doc.sections ? (
                  <>
                    {/* Tables */}
                    {doc.sections.tables?.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
                          display: "flex", alignItems: "center", gap: 6,
                        }}>
                          <span style={{
                            background: "#FEF3C7", color: "#92400E",
                            padding: "2px 6px", borderRadius: 4, fontSize: 9,
                          }}>TABLE</span>
                          {doc.sections.tables.length} table(s)
                        </div>
                        {doc.sections.tables.map((t, i) => (
                          <div key={i} style={{
                            background: "#FFFBEB", border: "1px solid #FDE68A",
                            borderRadius: 8, padding: "10px 12px", marginBottom: 8,
                            fontSize: 11, color: "#92400E",
                            fontFamily: "'DM Mono', monospace",
                            whiteSpace: "pre-wrap", wordBreak: "break-word",
                          }}>
                            {typeof t === "string" ? t : JSON.stringify(t, null, 2)}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Sections list */}
                    {doc.sections.sections?.length > 0 ? (
                      <div>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: "#9CA3AF",
                          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
                        }}>
                          {doc.sections.sections.length} section(s)
                        </div>
                        {doc.sections.sections.map((s, i) => (
                          <div key={i} style={{
                            marginBottom: 10, borderRadius: 8, overflow: "hidden",
                            border: "1px solid #E5E7EB",
                          }}>
                            <div style={{
                              background: "#EFF6FF", padding: "7px 12px",
                              fontSize: 11, fontWeight: 700, color: "#1D4ED8",
                              borderBottom: "1px solid #BFDBFE",
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                              <span style={{
                                background: "#DBEAFE", color: "#1D4ED8",
                                borderRadius: 4, padding: "1px 5px",
                                fontSize: 9, fontWeight: 800,
                              }}>§{i + 1}</span>
                              {s.heading}
                            </div>
                            <pre style={{
                              margin: 0, padding: "9px 12px",
                              fontSize: 11, lineHeight: 1.6, color: "#374151",
                              whiteSpace: "pre-wrap", wordBreak: "break-word",
                              fontFamily: "'DM Mono', monospace",
                              background: "#fff",
                            }}>
                              {s.content}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        padding: "24px 0", gap: 8, color: "#9CA3AF",
                      }}>
                        <div style={{ fontSize: 12, fontStyle: "italic" }}>No sections parsed</div>
                        {doc.document_id && (
                          <button onClick={() => onEditContent(doc)} style={{
                            padding: "6px 14px", borderRadius: 7,
                            border: "1px solid #BFDBFE", background: "#EFF6FF",
                            color: "#2563EB", fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}>Add sections</button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    height: "100%", gap: 8, color: "#9CA3AF",
                  }}>
                    <div style={{ fontSize: 12, fontStyle: "italic" }}>No sections data available</div>
                    {doc.document_id && (
                      <button onClick={() => onEditContent(doc)} style={{
                        padding: "6px 14px", borderRadius: 7,
                        border: "1px solid #BFDBFE", background: "#EFF6FF",
                        color: "#2563EB", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      }}>Add sections</button>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Verify modal ──────────────────────────────────────────────────────────────

function VerifyModal({ doctors, onVerify, onClose, loading }) {
  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks]   = useState("");

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: 28,
        width: "min(440px, 92vw)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        animation: "slideUp 0.2s ease",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 6 }}>Verify & Assign</div>
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>Select the doctor to assign this claim to</div>

        <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 8 }}>
          Assign to doctor *
        </label>
        <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, maxHeight: 180, overflowY: "auto", marginBottom: 16 }}>
          {doctors.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "#9CA3AF", textAlign: "center" }}>No doctors found</div>
          )}
          {doctors.map(d => (
  <button key={d.sys_user_id} onClick={() => setSelected(d)} style={{
    display: "flex", alignItems: "center", gap: 10,
    width: "100%", padding: "10px 12px",
    border: "none", borderBottom: "1px solid #F3F4F6",
    background: selected?.sys_user_id === d.sys_user_id ? "#F0FDF4" : "#fff",
    cursor: "pointer", textAlign: "left",
  }}>
    <div style={{
      width: 16, height: 16, borderRadius: "50%",
      border: `2px solid ${selected?.sys_user_id === d.sys_user_id ? "#16A34A" : "#D1D5DB"}`,
      background: selected?.sys_user_id === d.sys_user_id ? "#16A34A" : "#fff",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      {selected?.sys_user_id === d.sys_user_id && (
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
      )}
    </div>
    <span style={{
      fontSize: 13,
      color: selected?.sys_user_id === d.sys_user_id ? "#15803D" : "#374151",
      fontWeight: selected?.sys_user_id === d.sys_user_id ? 600 : 400,
    }}>
      {d.full_name}
    </span>
  </button>
))}
        </div>

        <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 8 }}>
          Remarks (optional)
        </label>
        <textarea
          rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="Any notes for the doctor..."
          style={{
            width: "100%", borderRadius: 10, border: "1px solid #E5E7EB",
            padding: "10px 12px", fontSize: 13, color: "#111827",
            resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            marginBottom: 20, outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: 10 }}>
  <button onClick={onClose} style={{
    flex: 1, padding: "12px", borderRadius: 10,
    border: "1px solid #E5E7EB", background: "#fff",
    fontSize: 14, fontWeight: 600, color: "#374151", cursor: "pointer",
  }}>Cancel</button>
  <button
    onClick={() => onVerify(selected.sys_user_id, selected.full_name, remarks)}
    disabled={!selected || loading}
    style={{
      flex: 2, padding: "12px", borderRadius: 10, border: "none",
      background: selected && !loading ? "#16A34A" : "#9CA3AF",
      color: "#fff", fontSize: 14, fontWeight: 700,
      cursor: selected && !loading ? "pointer" : "not-allowed",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      transition: "background 0.2s",
    }}
  >
    {loading ? <Spinner size={16} color="#fff" /> : "✓ Verify Claim"}
  </button>
</div>
      </div>
    </div>
  );
}

// ── Re-investigate modal ──────────────────────────────────────────────────────

function ReinvModal({ flaggedDocs, onSubmit, onClose, loading }) {
  const [remarks, setRemarks] = useState("");
  const flaggedList = Object.entries(flaggedDocs).filter(([, v]) => v);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: 28,
        width: "min(440px, 92vw)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        animation: "slideUp 0.2s ease",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 6 }}>Request Re-investigation</div>
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
          {flaggedList.length} document(s) flagged for re-collection
        </div>

        <div style={{ background: "#FFF5F5", border: "1px solid #FCA5A5", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          {flaggedList.map(([key]) => {
            const [invType, docKey] = key.split("::");
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 12, color: "#DC2626" }}>
                <span>⚑</span>
                <span style={{ fontWeight: 600 }}>{invType}</span>
                <span style={{ opacity: 0.7 }}>—</span>
                <span>{docKey.replace(/_/g, " ")}</span>
              </div>
            );
          })}
        </div>

        <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 8 }}>
          Reason / Instructions *
        </label>
        <textarea
          rows={4} value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="Explain what needs to be re-collected or corrected..."
          style={{
            width: "100%", borderRadius: 10, border: "1px solid #E5E7EB",
            padding: "10px 12px", fontSize: 13, color: "#111827",
            resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            marginBottom: 20, outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "12px", borderRadius: 10,
            border: "1px solid #E5E7EB", background: "#fff",
            fontSize: 14, fontWeight: 600, color: "#374151", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={() => onSubmit(remarks)} disabled={!remarks.trim() || loading} style={{
            flex: 2, padding: "12px", borderRadius: 10, border: "none",
            background: remarks.trim() && !loading ? "#DC2626" : "#9CA3AF",
            color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: remarks.trim() && !loading ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "background 0.2s",
          }}>
            {loading ? <Spinner size={16} color="#fff" /> : "↩ Send Back"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main QC Review page ───────────────────────────────────────────────────────

export default function QCReview() {
  const [claims, setClaims]               = useState([]);
  const [doctors, setDoctors]             = useState([]);
  const [loadingList, setLoadingList]     = useState(true);
  const [search, setSearch]               = useState("");
  const searchTimer                        = useRef(null);

  const [selectedId, setSelectedId]       = useState(null);
  const [detail, setDetail]               = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [flaggedDocs, setFlaggedDocs]             = useState({});
  const [previewDoc, setPreviewDoc]               = useState(null);
const [editingContent, setEditingContent] = useState(null);
const [saveContentLoading, setSaveContentLoading] = useState(false);
  const [showVerify, setShowVerify]               = useState(false);
  const [showReinv, setShowReinv]                 = useState(false);
  const [actionLoading, setActionLoading]         = useState(false);
  const [toast, setToast]                         = useState(null);

  // ── Toast ────────────────────────────────────────────────────────────────
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load list ────────────────────────────────────────────────────────────
  const loadClaims = useCallback(async (q = "") => {
    setLoadingList(true);
    try {
      const data = await apiFetch(`/qc/claims${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      setClaims(data.claims || []);
      setDoctors(data.doctors || []);
    } catch (e) {
      showToast(`Failed to load claims: ${e.message}`, "error");
    } finally {
      setLoadingList(false);
    }
  }, []);

  // ── Load detail ──────────────────────────────────────────────────────────
  const loadDetail = useCallback(async (id) => {
    setLoadingDetail(true);
    setDetail(null);
    setFlaggedDocs({});
    try {
      const data = await apiFetch(`/qc/claims/${id}`);
      setDetail(data);
    } catch (e) {
      showToast(`Failed to load claim: ${e.message}`, "error");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { loadClaims(); }, [loadClaims]);

  const selectClaim = (id) => { setSelectedId(id); loadDetail(id); };

  const handleSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadClaims(v), 350);
  };

  // ── Save entities ────────────────────────────────────────────────────────
const handleSaveContent = async (documentId, payload) => {
  setSaveContentLoading(true);
  try {
    const res = await apiFetch(`/qc/documents/${documentId}/content`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    showToast(res.message || "Content saved successfully");
    setEditingContent(null);
    // Update previewDoc in place so panel reflects new content immediately
    setPreviewDoc(prev => prev ? {
      ...prev,
      raw_markdown: payload.raw_markdown ?? prev.raw_markdown,
      sections: payload.sections ?? prev.sections,
    } : null);
    loadDetail(selectedId);
  } catch (e) {
    showToast(`Save failed: ${e.message}`, "error");
  } finally {
    setSaveContentLoading(false);
  }
};

  // ── Flag toggle ──────────────────────────────────────────────────────────
  const toggleFlag = (invType, docKey) => {
    const k = `${invType}::${docKey}`;
    setFlaggedDocs(prev => ({ ...prev, [k]: !prev[k] }));
  };

  const flaggedCount = Object.values(flaggedDocs).filter(Boolean).length;

  // ── Verify ───────────────────────────────────────────────────────────────
// In QCReview, fix handleVerify signature and payload:
const handleVerify = async (doctorId, doctorName, remarks) => {
  setActionLoading(true);
  try {
    const data = await apiFetch(`/qc/claims/${selectedId}/verify`, {
      method: "POST",
      body: JSON.stringify({
        doctor_id:   doctorId,
        doctor_name: doctorName,
        remarks:     remarks || "",
      }),
    });
    setShowVerify(false);
    showToast(data.message || "Claim verified");
    loadClaims(search);
    loadDetail(selectedId);
    
  } catch (e) {
    showToast(`Verification failed: ${e.message}`, "error");
  } finally {
    setActionLoading(false);
  }
};

  // ── Reinvestigate ────────────────────────────────────────────────────────
  const handleReinv = async (remarks) => {
    setActionLoading(true);
    try {
      const flaggedList = Object.entries(flaggedDocs)
        .filter(([, v]) => v)
        .map(([k]) => { const [invType, docKey] = k.split("::"); return { invType, docKey }; });
      const data = await apiFetch(`/qc/claims/${selectedId}/reinvestigate`, {
        method: "POST",
        body: JSON.stringify({ flaggedDocs: flaggedList, remarks }),
      });
      setShowReinv(false);
      setFlaggedDocs({});
      showToast(data.message || "Re-investigation requested");
      loadClaims(search);
      loadDetail(selectedId);
    } catch (e) {
      showToast(`Failed: ${e.message}`, "error");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const allDocsIn = detail
    ? detail.docsSubmitted === detail.docsTotal && detail.docsTotal > 0
    : false;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 99px; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes toastIn { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        button   { font-family: 'DM Sans', sans-serif; }
        textarea { font-family: 'DM Sans', sans-serif; }
      `}</style>

      <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', sans-serif", background: "#F3F4F6" }}>

        {/* ── SIDEBAR ── */}
        <div style={{
          width: 272, flexShrink: 0,
          background: "#fff", borderRight: "1px solid #E5E7EB",
          display: "flex", flexDirection: "column", height: "100vh",
        }}>
          <div style={{
            padding: "16px 14px 12px", borderBottom: "1px solid #E5E7EB",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>QC Queue</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{claims.length} claims</div>
            </div>
            <button onClick={() => loadClaims(search)} title="Refresh" style={{
              border: "1px solid #E5E7EB", borderRadius: 8, background: "#F9FAFB",
              padding: "6px 8px", cursor: "pointer", display: "flex", alignItems: "center", color: "#6B7280",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>

          <div style={{ padding: "10px 10px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#F3F4F6", borderRadius: 8, padding: "7px 10px" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                value={search} onChange={e => handleSearch(e.target.value)}
                placeholder="Search ID or name..."
                style={{ border: "none", background: "transparent", fontSize: 12, color: "#111827", outline: "none", width: "100%" }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingList ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spinner /></div>
            ) : claims.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "#9CA3AF" }}>No claims found</div>
            ) : (
              claims.map(c => (
                <ClaimCard key={c.id} claim={c} selected={c.id === selectedId} onClick={() => selectClaim(c.id)} />
              ))
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
          {!selectedId ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#9CA3AF" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
              <div style={{ fontSize: 14 }}>Select a claim from the queue to review</div>
            </div>
          ) : loadingDetail ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexDirection: "column", color: "#9CA3AF" }}>
              <Spinner size={28} />
              <div style={{ fontSize: 13 }}>Loading claim...</div>
            </div>
          ) : detail ? (
            <>
              {/* Detail header */}
              <div style={{
                background: "#fff", borderBottom: "1px solid #E5E7EB",
                padding: "16px 24px",
                display: "flex", alignItems: "flex-start", gap: 24, flexShrink: 0,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", fontFamily: "'DM Mono', monospace" }}>
                      {detail.id}
                    </span>
                    <Badge status={detail.status} />
                    {detail.priority && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                        background: "#FEF3C7", color: PRIORITY_COLOR[detail.priority] || "#6B7280",
                      }}>{detail.priority}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 4 }}>
                    {detail.claimantName}
                  </div>
                  <div style={{ fontSize: 12, color: "#6B7280", display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>{detail.type}</span>
                    <span>·</span>
                    <span>{detail.insurer}</span>
                    <span>·</span>
                    <span style={{ fontWeight: 600, color: "#374151" }}>{fmt(detail.claimedAmount)}</span>
                  </div>
                </div>

                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#111827", lineHeight: 1 }}>
                    {detail.docsSubmitted}
                    <span style={{ fontSize: 16, color: "#9CA3AF", fontWeight: 400 }}>/{detail.docsTotal}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2, marginBottom: 6 }}>docs received</div>
                  <div style={{ width: 100 }}>
                    <DocBar submitted={detail.docsSubmitted} total={detail.docsTotal} />
                  </div>
                </div>
              </div>

              {/* Investigations */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 120px" }}>
                {detail.investigations && Object.keys(detail.investigations).length > 0 ? (
                  Object.entries(detail.investigations).map(([invType, inv]) => (
                    <InvSection
                      key={invType}
                      invType={invType}
                      inv={inv}
                      flaggedDocs={flaggedDocs}
                      onToggleFlag={toggleFlag}
                      onPreview={setPreviewDoc}
                    />
                  ))
                ) : (
                  <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF", fontSize: 13 }}>
                    No investigations assigned to this claim
                  </div>
                )}
              </div>

              {/* Action footer */}
              <div style={{
                position: "sticky", bottom: 0,
                background: "#fff", borderTop: "1px solid #E5E7EB",
                padding: "12px 24px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                {flaggedCount > 0 && (
                  <button onClick={() => setShowReinv(true)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "11px 18px", borderRadius: 10,
                    border: "1.5px solid #FCA5A5", background: "#FFF5F5",
                    color: "#DC2626", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    transition: "all 0.15s",
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="0">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                      <line x1="4" y1="22" x2="4" y2="15" strokeWidth="2"/>
                    </svg>
                    Re-investigate ({flaggedCount})
                  </button>
                )}

                {!allDocsIn && (
                  <div style={{ fontSize: 12, color: "#9CA3AF", flex: 1 }}>
                    {detail.docsTotal - detail.docsSubmitted} document(s) still pending from investigators
                  </div>
                )}
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setShowVerify(true)}
                  disabled={!allDocsIn}
                  title={!allDocsIn ? "All documents must be submitted before verifying" : ""}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "12px 24px", borderRadius: 10, border: "none",
                    background: allDocsIn ? "#16A34A" : "#E5E7EB",
                    color: allDocsIn ? "#fff" : "#9CA3AF",
                    fontSize: 14, fontWeight: 700,
                    cursor: allDocsIn ? "pointer" : "not-allowed",
                    transition: "all 0.2s",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  Verify & Assign Doctor
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Modals ── */}

      {previewDoc && (
  <PdfPreviewPanel
    doc={previewDoc}
    onClose={() => setPreviewDoc(null)}
    onEditContent={(doc) => setEditingContent(doc)}
  />
)}

{editingContent && (
  <ContentEditorModal
    doc={editingContent}
    onSave={handleSaveContent}
    onClose={() => setEditingContent(null)}
    loading={saveContentLoading}
  />
)}

      {showVerify && (
        <VerifyModal
          doctors={doctors}
          onVerify={handleVerify}
          onClose={() => setShowVerify(false)}
          loading={actionLoading}
        />
      )}

      {showReinv && (
        <ReinvModal
          flaggedDocs={flaggedDocs}
          onSubmit={handleReinv}
          onClose={() => setShowReinv(false)}
          loading={actionLoading}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 999,
          padding: "12px 18px", borderRadius: 10,
          background: toast.type === "error" ? "#DC2626" : "#16A34A",
          color: "#fff", fontSize: 13, fontWeight: 600,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          animation: "toastIn 0.2s ease", maxWidth: 360,
        }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}