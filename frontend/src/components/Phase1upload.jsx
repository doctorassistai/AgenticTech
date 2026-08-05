import { useState, useRef, useCallback, useEffect } from "react";
import KnowledgeLineageView from "./phase1KnowledgeLineageView"; // adjust path to wherever you save it
import DoctorKnowledgeDashboard from "./phase1DoctorKnowledgeDashboard";
// ─── FONT STYLES — PURE BLACK & WHITE THEME ───────────────────
const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap');

    * { box-sizing: border-box; }

    :root {
      --bg: #ffffff;
      --surface: #ffffff;
      --ink: #000000;
      --paper: #ffffff;
      --text: #000000;
      --text-on-ink: #ffffff;
      --text-soft: rgba(0,0,0,0.62);
      --text-faint: rgba(0,0,0,0.38);
      --line: #000000;
      --line-soft: rgba(0,0,0,0.16);
      --danger: #000000;
      --font-sans: 'Open Sans', sans-serif;
      --font-mono: 'IBM Plex Mono', monospace;
    }

    body { font-family: var(--font-sans); background: var(--bg); color: var(--text); }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .fade-in { animation: fadeIn 0.2s ease; }

    ::selection { background: #000; color: #fff; }
  `}</style>
);

// ─── CONSTANTS ────────────────────────────────────────────────
const getDoctorId = () => new URLSearchParams(window.location.search).get("doctor_id");
const getApiBase  = () => "";

const API_ENDPOINTS = {
  upload:    (d)      => `${getApiBase()}api/hms/users/ai-legacy/phase1/upload?doctor_id=${d}`,
  approve:   (d)      => `${getApiBase()}api/hms/users/ai-legacy/phase1/approve?doctor_id=${d}`,
  documents: (d)      => `${getApiBase()}api/hms/users/ai-legacy/phase1/documents?doctor_id=${d}`,
  allJobs:   (d)      => `${getApiBase()}api/hms/users/ai-legacy/phase1/jobs?doctor_id=${d}`, // NEW
  document:  (d, id)  => `${getApiBase()}api/hms/users/ai-legacy/phase1/documents/${id}?doctor_id=${d}`,
  deleteDocument: (d, id) => `${getApiBase()}api/hms/users/ai-legacy/phase1/documents/${d}/${id}`,
  job:       (d, id)  => `${getApiBase()}api/hms/users/ai-legacy/phase1/jobs/${id}?doctor_id=${d}`,
  jobResult: (d, id)  => `${getApiBase()}api/hms/users/ai-legacy/phase1/jobs/${id}/result?doctor_id=${d}`,
  skillMarkdown: (d, skillId, skillType) =>
    `${getApiBase()}api/hms/users/ai-legacy/phase1/skills/${d}/${skillId}/markdown?skill_type=${skillType}`,
  downloadMarkdown: (d, skillId, skillType) =>
    `${getApiBase()}api/hms/users/ai-legacy/phase1/skills/${d}/${skillId}/download?skill_type=${skillType}`,
  // ADD THESE TWO:
  previewSkillMarkdown: (d, docId, skillId) =>
    `${getApiBase()}api/hms/users/ai-legacy/phase1/jobs/${docId}/skills/${skillId}/markdown?doctor_id=${d}`,
  previewDownloadMarkdown: (d, docId, skillId) =>
    `${getApiBase()}api/hms/users/ai-legacy/phase1/jobs/${docId}/skills/${skillId}/download?doctor_id=${d}`,
};

const POLL_INTERVAL_MS = 8000;
const POLL_MAX_WAIT_MS = 30 * 60 * 1000;  // 30 min timeout

const STEPS = [
  { id: "upload",     label: "Upload",     icon: "ti-cloud-upload" },
  { id: "processing", label: "Processing", icon: "ti-cpu"          },
  { id: "review",     label: "Review",     icon: "ti-eye"          },
  { id: "saved",      label: "Saved",      icon: "ti-circle-check" },
];

const STEP_LABELS = {
  extracting:    "Extracting text from document...",
  classifying:   "Classifying document type...",
  understanding: "Understanding clinical entities...",
  diagnosis:     "Extracting diagnosis knowledge...",
  treatment:     "Extracting treatment knowledge...",
  graph:         "Building knowledge graph...",
  skills:        "Generating skills...",
  done:          "Complete",
};

// ─── LOCAL PERSISTENCE FOR EXTRACTED-BUT-NOT-YET-SAVED DOCS ───
// This solves the core problem: the pipeline can finish and produce a full
// preview (skills, graph, knowledge) even if the user never clicks
// "save to database". Without this, that output is lost the moment the
// processing screen closes. We keep a durable local record per-doctor so
// it always reappears in the library, clearly marked, until it's saved.

const LS_PREFIX = "phase1_extracted_docs__";
const lsKey = (doctorId) => `${LS_PREFIX}${doctorId}`;

function readExtractedDocs(doctorId) {
  try {
    const raw = window.localStorage.getItem(lsKey(doctorId));
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function writeExtractedDocs(doctorId, map) {
  try {
    window.localStorage.setItem(lsKey(doctorId), JSON.stringify(map));
  } catch {
    // ignore quota / serialization errors — non-fatal
  }
}

function upsertExtractedDoc(doctorId, docId, record) {
  const map = readExtractedDocs(doctorId);
  map[docId] = { ...(map[docId] || {}), ...record, doc_id: docId };
  writeExtractedDocs(doctorId, map);
}

function markExtractedDocSaved(doctorId, docId, savedSummary) {
  const map = readExtractedDocs(doctorId);
  if (map[docId]) {
    map[docId].status = "saved";
    map[docId].saved_summary = savedSummary;
    writeExtractedDocs(doctorId, map);
  }
}

function removeExtractedDoc(doctorId, docId) {
  const map = readExtractedDocs(doctorId);
  delete map[docId];
  writeExtractedDocs(doctorId, map);
}

// ─── SHARED SUB-COMPONENTS ────────────────────────────────────

function Tag({ label }) {
  const displayLabel = typeof label === "string" ? label : (label?.name || label?.value || String(label));
  return (
    <span style={{
      display: "inline-block", padding: "4px 11px", borderRadius: "3px",
      fontSize: "11px", fontWeight: 600, margin: "3px 5px 3px 0",
      background: "#fff", color: "#000", border: "1.5px solid #000",
    }}>{displayLabel}</span>
  );
}

function SectionCard({ title, icon, children, accent }) {
  return (
    <div style={{
      background: "var(--paper)", border: "1.5px solid var(--line)",
      borderRadius: "10px", marginBottom: "16px", overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "9px",
        padding: "13px 16px", borderBottom: "1.5px solid var(--line)",
        background: accent ? "#000" : "#fff",
      }}>
        <i className={`ti ${icon}`} style={{ fontSize: "14px", color: accent ? "#fff" : "#000" }} aria-hidden />
        <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", color: accent ? "#fff" : "#000", textTransform: "uppercase" }}>{title}</span>
      </div>
      <div style={{ padding: "16px" }}>{children}</div>
    </div>
  );
}

function ConfidenceBadge({ score }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "3px",
      background: "#000", color: "#fff", letterSpacing: "0.02em",
    }}>{pct}%</span>
  );
}

function StatusBadge({ status }) {
  const isSaved = status === "saved";
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, padding: "3px 9px", borderRadius: "3px",
      letterSpacing: "0.05em", textTransform: "uppercase",
      background: isSaved ? "#000" : "#fff",
      color: isSaved ? "#fff" : "#000",
      border: "1.5px solid #000",
      display: "inline-flex", alignItems: "center", gap: "5px",
    }}>
      <i className={`ti ${isSaved ? "ti-database-check" : "ti-clock-hour-4"}`} style={{ fontSize: "11px" }} aria-hidden />
      {isSaved ? "Saved" : "Not saved yet"}
    </span>
  );
}

function SkillCard({ skill, selected, onToggle, onEdit, onEditMarkdown, onDownloadMarkdown }) {
  const isDiag = skill.skill_type === "diagnosis";
  return (
    <div
      onClick={onToggle}
      style={{
        background: selected ? "#000" : "#fff",
        border: "1.5px solid #000",
        borderRadius: "10px", padding: "13px 15px", cursor: "pointer",
        transition: "all 0.15s ease", position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
        <span style={{
          fontSize: "10px", fontWeight: 700, padding: "2px 9px", borderRadius: "3px",
          background: selected ? "#fff" : "#000", color: selected ? "#000" : "#fff",
          letterSpacing: "0.04em", textTransform: "uppercase",
        }}>{isDiag ? "Diagnosis" : "Treatment"}</span>
        <span style={{ fontSize: "11px", color: selected ? "rgba(255,255,255,0.7)" : "var(--text-soft)" }}>{skill.subtype}</span>
        <ConfidenceBadge score={skill.confidence?.score} />
        {selected && (
          <span style={{ marginLeft: "auto" }}>
            <i className="ti ti-circle-check-filled" style={{ color: "#fff", fontSize: "17px" }} aria-hidden />
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 4px", fontSize: "13px", fontWeight: 700, color: selected ? "#fff" : "#000" }}>{skill.name}</p>
      <p style={{ margin: "0 0 9px", fontSize: "12px", color: selected ? "rgba(255,255,255,0.78)" : "var(--text-soft)", lineHeight: 1.5 }}>
        {skill.description}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "9px" }}>
        {(skill.trigger_keywords || []).slice(0, 6).map(k => (
          <span key={k} style={{
            fontSize: "10px", padding: "2px 9px", borderRadius: "3px",
            background: "transparent", color: selected ? "#fff" : "#000",
            border: `1px solid ${selected ? "#fff" : "#000"}`,
          }}>{k}</span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "11px", color: selected ? "rgba(255,255,255,0.65)" : "var(--text-faint)" }}>
          <i className="ti ti-sitemap" style={{ fontSize: "12px", marginRight: "3px" }} aria-hidden />
          {skill.graph_path}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(skill); }}
              style={{
                fontSize: "11px", padding: "5px 11px",
                borderRadius: "4px", cursor: "pointer", fontWeight: 600,
                background: selected ? "#fff" : "#000",
                color: selected ? "#000" : "#fff",
                border: "none", transition: "opacity 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
            >
              <i className="ti ti-edit" style={{ fontSize: "12px", marginRight: "4px" }} aria-hidden />
              Edit JSON
            </button>
          )}
          {onEditMarkdown && (
            <button
              onClick={e => { e.stopPropagation(); onEditMarkdown(skill); }}
              style={{
                fontSize: "11px", padding: "5px 11px",
                borderRadius: "4px", cursor: "pointer", fontWeight: 600,
                background: selected ? "#fff" : "#000",
                color: selected ? "#000" : "#fff",
                border: "none", transition: "opacity 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
            >
              <i className="ti ti-markdown" style={{ fontSize: "12px", marginRight: "4px" }} aria-hidden />
              Edit MD
            </button>
          )}
          {onDownloadMarkdown && (
            <button
              onClick={e => { e.stopPropagation(); onDownloadMarkdown(skill); }}
              style={{
                fontSize: "11px", padding: "5px 11px",
                borderRadius: "4px", cursor: "pointer", fontWeight: 600,
                background: selected ? "#fff" : "#000",
                color: selected ? "#000" : "#fff",
                border: "none", transition: "opacity 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
            >
              <i className="ti ti-download" style={{ fontSize: "12px", marginRight: "4px" }} aria-hidden />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditModal({ skill, onSave, onClose }) {
  const [body, setBody] = useState(JSON.stringify(skill.body, null, 2));
  const [err,  setErr]  = useState(null);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(body);
      onSave(skill.skill_id, parsed);
      onClose();
    } catch {
      setErr("Invalid JSON — please fix before saving.");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", border: "2px solid #000", borderRadius: "12px",
        width: "min(680px, 96vw)", maxHeight: "80vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "2px solid #000", background: "#000",
        }}>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "#fff" }}>Edit skill — {skill.name}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
            <i className="ti ti-x" style={{ fontSize: "18px", color: "#fff" }} aria-hidden />
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>
          <p style={{ fontSize: "12px", color: "var(--text-soft)", marginBottom: "8px" }}>
            Edit the skill body JSON below. Changes will be saved when you click "Save skill".
          </p>
          {err && (
            <div style={{
              padding: "9px 12px", marginBottom: "10px", fontSize: "12px", fontWeight: 600,
              background: "#000", color: "#fff", borderRadius: "6px",
            }}>{err}</div>
          )}
          <textarea
            value={body}
            onChange={e => { setBody(e.target.value); setErr(null); }}
            style={{
              width: "100%", minHeight: "320px", fontFamily: "var(--font-mono)",
              fontSize: "12px", lineHeight: 1.6, padding: "10px 12px",
              border: "1.5px solid #000", borderRadius: "6px",
              resize: "vertical", boxSizing: "border-box",
              background: "#fff", color: "#000",
            }}
          />
        </div>
        <div style={{
          display: "flex", gap: "8px", justifyContent: "flex-end",
          padding: "12px 18px", borderTop: "2px solid #000",
        }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", cursor: "pointer",
            background: "#fff", border: "1.5px solid #000", color: "#000",
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            padding: "8px 16px", fontSize: "13px", borderRadius: "6px", cursor: "pointer",
            background: "#000", color: "#fff", border: "1.5px solid #000", fontWeight: 700,
          }}>Save skill</button>
        </div>
      </div>
    </div>
  );
}

function MarkdownEditModal({ skill, fetchUrl, saveUrl, onSaved, onClose }) {
  const [markdown, setMarkdown] = useState("");
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error("Failed to load markdown for this skill.");
        setMarkdown(await res.text());
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchUrl]);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(saveUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Save failed.");
      }
      onSaved?.(skill.skill_id);
      const result = await res.json();
      onSaved?.(skill.skill_id, result.body);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", border: "2px solid #000", borderRadius: "12px",
        width: "min(760px, 96vw)", maxHeight: "82vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "2px solid #000", background: "#000",
        }}>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "#fff" }}>
            Edit (Markdown) — {skill.name}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
            <i className="ti ti-x" style={{ fontSize: "18px", color: "#fff" }} aria-hidden />
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>
          {err && (
            <div style={{
              padding: "9px 12px", marginBottom: "10px", fontSize: "12px", fontWeight: 600,
              background: "#000", color: "#fff", borderRadius: "6px",
            }}>{err}</div>
          )}
          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#000" }}>
              <i className="ti ti-loader-2" style={{ fontSize: "22px", animation: "spin 1s linear infinite" }} aria-hidden />
            </div>
          ) : (
            <textarea
              value={markdown}
              onChange={e => setMarkdown(e.target.value)}
              style={{
                width: "100%", minHeight: "420px", fontFamily: "var(--font-mono)",
                fontSize: "12px", lineHeight: 1.6, padding: "10px 12px",
                border: "1.5px solid #000", borderRadius: "6px",
                resize: "vertical", boxSizing: "border-box",
                background: "#fff", color: "#000",
              }}
            />
          )}
        </div>
        <div style={{
          display: "flex", gap: "8px", justifyContent: "flex-end",
          padding: "12px 18px", borderTop: "2px solid #000",
        }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", cursor: "pointer",
            background: "#fff", border: "1.5px solid #000", color: "#000",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={loading || saving} style={{
            padding: "8px 16px", fontSize: "13px", borderRadius: "6px",
            cursor: loading || saving ? "not-allowed" : "pointer",
            background: "#000", color: "#fff", border: "1.5px solid #000", fontWeight: 700,
          }}>
            {saving ? "Saving..." : "Save skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressStep({ label, done, active }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 0" }}>
      <span style={{
        width: "22px", height: "22px", borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        background: done ? "#000" : "#fff",
        border: "1.5px solid #000",
        transition: "all 0.2s",
      }}>
        {done
          ? <i className="ti ti-check" style={{ fontSize: "11px", color: "#fff" }} aria-hidden />
          : active
            ? <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#000", display: "block" }} />
            : null
        }
      </span>
      <span style={{
        fontSize: "12px",
        color: "#000",
        fontWeight: active ? 700 : done ? 500 : 400,
        opacity: done || active ? 1 : 0.4,
      }}>{label}</span>
    </div>
  );
}

// ─── DOCUMENT LIST CARD ──────────────────────────────────────

function DocumentCard({ doc, onClick, onDelete }) {
  const conf    = doc.confidence_stats;
  const date    = doc.created_at
    ? new Date(doc.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const isUnsaved = doc.status === "extracted";

  return (
    <div
      onClick={onClick}
      className="fade-in"
      style={{
        background: "#fff",
        border: "2px solid #000",
        borderRadius: "12px", padding: "17px 19px", cursor: "pointer",
        transition: "all 0.15s ease",
        borderStyle: isUnsaved ? "dashed" : "solid",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "#000";
        e.currentTarget.querySelectorAll("[data-flip]").forEach(el => { el.style.color = "#fff"; });
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "#fff";
        e.currentTarget.querySelectorAll("[data-flip]").forEach(el => { el.style.color = "#000"; });
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "11px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p data-flip style={{
            margin: "0 0 4px", fontSize: "14px", fontWeight: 700, color: "#000",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {doc.guideline_name}
          </p>
          <p data-flip style={{ margin: 0, fontSize: "11px", color: "#000", opacity: 0.6 }}>
            {doc.guideline_version && <span>v{doc.guideline_version} · </span>}
            {doc.specialty && <span style={{ textTransform: "capitalize" }}>{doc.specialty} · </span>}
            {date && <span>{date}</span>}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <StatusBadge status={isUnsaved ? "extracted" : "saved"} />
            {onDelete && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(doc); }}
                title="Delete document"
                data-flip
                style={{
                  width: "24px", height: "24px", display: "flex", alignItems: "center",
                  justifyContent: "center", background: "transparent", border: "1.5px solid #000",
                  borderRadius: "5px", cursor: "pointer", color: "#000", flexShrink: 0,
                }}
              >
                <i className="ti ti-trash" style={{ fontSize: "12px" }} aria-hidden />
              </button>
            )}
          </div>
          {conf?.mean != null && <ConfidenceBadge score={conf.mean} />}
        </div>
      </div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {doc.disease_type && (
          <span data-flip style={{
            fontSize: "11px", padding: "3px 9px", borderRadius: "3px", fontWeight: 600,
            background: "transparent", border: "1px solid #000", color: "#000",
          }}>
            <i className="ti ti-virus" style={{ fontSize: "10px", marginRight: "4px" }} aria-hidden />
            {doc.disease_type}
          </span>
        )}
        {(doc.subtypes || []).slice(0, 3).map((s, i) => {
          const label = typeof s === "string" ? s : (s?.name || String(s));
          return (
            <span data-flip key={`subtype-${i}`} style={{
              fontSize: "11px", padding: "3px 9px", borderRadius: "3px",
              background: "transparent", border: "1px solid #000", color: "#000",
            }}>{label}</span>
          );
        })}
        {(doc.subtypes || []).length > 3 && (
          <span data-flip style={{
            fontSize: "11px", padding: "3px 9px", borderRadius: "3px",
            background: "transparent", border: "1px solid #000", color: "#000", opacity: 0.6,
          }}>+{doc.subtypes.length - 3} more</span>
        )}
      </div>

      <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
        <code data-flip style={{
          fontSize: "10px", color: "#000", opacity: 0.55,
          background: "transparent", padding: "1px 6px", border: "1px solid #000", borderRadius: "3px",
        }}>
          {doc.doc_id?.slice(0, 8)}...
        </code>
        <span data-flip style={{
          marginLeft: "auto", fontSize: "11px", color: "#000", fontWeight: 600,
          display: "flex", alignItems: "center", gap: "4px",
        }}>
          {isUnsaved ? "Review & save" : "View details"} <i className="ti ti-arrow-right" style={{ fontSize: "12px" }} aria-hidden />
        </span>
      </div>
    </div>
  );
}

// ─── DOCUMENTS LIST VIEW ─────────────────────────────────────

function DocumentsListView({ doctorId, onSelect, onUpload, onOpenDashboard }) {
  const [docs,      setDocs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
  (async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 1. Fetch ALL jobs from the server (both pending and completed)
      const jobsRes = await fetch(API_ENDPOINTS.allJobs(doctorId));
      if (!jobsRes.ok) throw new Error("Failed to load documents");
      const jobsJson = await jobsRes.json();
      
      // 2. Convert jobs to document format
      const rawJobs = [...(jobsJson.jobs || [])].reverse();
const serverDocs = rawJobs.map(job => ({
  doc_id: job.doc_id,
        guideline_name: job.guideline_name || job.filename || "Untitled",
        guideline_version: job.guideline_version || "",
        disease_type: job.disease_type || "",
        specialty: job.specialty || "",
        subtypes: job.subtypes || [],
        status: job.status === "completed" ? "saved" : "extracted",
        confidence_stats: job.confidence_stats || null,
        created_at: job.created_at,
        filename: job.filename,
        // Store full job data for detail view
        _job: job,
      }));
      
      // 3. Get locally-tracked extracted documents (for cases where we saved locally but server doesn't have it yet)
      const localMap = readExtractedDocs(doctorId);
      const localDocs = Object.values(localMap)
        .filter(d => !serverDocs.some(s => s.doc_id === d.doc_id)) // Only include if not on server
        .map(d => ({
          ...d,
          status: "extracted",
          _local: true,
        }));
      
      // 4. Merge server docs + local docs
      const merged = [...serverDocs, ...localDocs].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      
      setDocs(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  })();
}, [doctorId]);

  const filtered = docs.filter(d =>
    !search ||
    d.guideline_name?.toLowerCase().includes(search.toLowerCase()) ||
    d.disease_type?.toLowerCase().includes(search.toLowerCase()) ||
    d.specialty?.toLowerCase().includes(search.toLowerCase())
  );

  const unsavedCount = docs.filter(d => d.status === "extracted").length;

  const handleDelete = async (doc) => {
    if (!window.confirm(
      `Delete "${doc.guideline_name || doc.filename || doc.doc_id}"? This permanently removes ` +
      `the document and every skill, graph node, and embedding derived from it. This cannot be undone.`
    )) {
      return;
    }

    setDeleteError(null);
    setDeletingId(doc.doc_id);

    // Local-only (never reached the server as a job) — just drop it from
    // localStorage, nothing to call on the backend.
    if (doc._local) {
      removeExtractedDoc(doctorId, doc.doc_id);
      setDocs(prev => prev.filter(d => d.doc_id !== doc.doc_id));
      setDeletingId(null);
      return;
    }

    try {
      const res = await fetch(API_ENDPOINTS.deleteDocument(doctorId, doc.doc_id), {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Delete failed");
      }
      // Clean up the localStorage "extracted but not saved" cache too, in
      // case this doc_id is tracked there (harmless no-op if it isn't).
      removeExtractedDoc(doctorId, doc.doc_id);
      setDocs(prev => prev.filter(d => d.doc_id !== doc.doc_id));
    } catch (e) {
      setDeleteError(`Failed to delete "${doc.guideline_name || doc.doc_id}": ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px", gap: "12px", flexWrap: "wrap",
      }}>
        <div>
          <p style={{ margin: "0 0 2px", fontSize: "20px", fontWeight: 800, color: "#000", letterSpacing: "-0.01em" }}>
            Clinical Knowledge Library
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
            {docs.length} document{docs.length !== 1 ? "s" : ""} total
            {unsavedCount > 0 && <> · <strong style={{ color: "#000" }}>{unsavedCount} not saved yet</strong></>}
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>

        <button
            onClick={onOpenDashboard}
            style={{
                padding: "10px 20px",
                fontSize: "12px",
                fontWeight: 700,
                borderRadius: "8px",
                cursor: "pointer",
                background: "#fff",
                color: "#000",
                border: "2px solid #000",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                textTransform: "uppercase",
            }}
        >
            <i className="ti ti-chart-donut" />
            Knowledge Dashboard
        </button>

        <button
            onClick={onUpload}
            style={{
                padding: "10px 20px",
                fontSize: "12px",
                fontWeight: 700,
                borderRadius: "8px",
                cursor: "pointer",
                background: "#000",
                color: "#fff",
                border: "2px solid #000",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                textTransform: "uppercase",
            }}
        >
            <i className="ti ti-plus" />
            Upload New
        </button>

    </div>
      </div>

      {unsavedCount > 0 && (
        <div style={{
          padding: "12px 16px", marginBottom: "16px", fontSize: "12px", fontWeight: 600,
          background: "#fff", border: "2px dashed #000", borderRadius: "8px", color: "#000",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: "16px", flexShrink: 0 }} aria-hidden />
          You have {unsavedCount} processed document{unsavedCount !== 1 ? "s" : ""} with extracted skills and graphs that {unsavedCount !== 1 ? "haven't" : "hasn't"} been saved to the database yet. Open them below to review and save.
        </div>
      )}

      {/* Search */}
      <div style={{ position: "relative", marginBottom: "20px" }}>
        <i className="ti ti-search" style={{
          position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)",
          fontSize: "14px", color: "#000",
        }} aria-hidden />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by guideline name, disease, or specialty..."
          style={{
            width: "100%", padding: "10px 12px 10px 36px", fontSize: "13px",
            border: "2px solid #000", borderRadius: "8px",
            background: "#fff", color: "#000", outline: "none", fontWeight: 500,
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: "12px", marginBottom: "16px", fontSize: "13px", fontWeight: 600,
          background: "#000", color: "#fff", borderRadius: "8px",
        }}>{error}</div>
      )}

      {deleteError && (
        <div style={{
          padding: "12px", marginBottom: "16px", fontSize: "13px", fontWeight: 600,
          background: "#000", color: "#fff", borderRadius: "8px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <i className="ti ti-alert-circle" style={{ fontSize: "16px", flexShrink: 0 }} aria-hidden />
          {deleteError}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "#000" }}>
          <i className="ti ti-loader-2" style={{
            fontSize: "28px", animation: "spin 1s linear infinite", display: "block", marginBottom: "10px",
          }} aria-hidden />
          Loading documents...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: "3rem", textAlign: "center", color: "#000",
          background: "#fff", borderRadius: "10px", border: "2px dashed #000",
        }}>
          <i className="ti ti-file-off" style={{
            fontSize: "36px", display: "block", marginBottom: "12px", opacity: 0.4,
          }} aria-hidden />
          {search
            ? "No documents match your search."
            : "No documents uploaded yet. Upload your first guideline."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "14px" }}>
          {filtered.map(doc => (
            <div key={doc.doc_id} style={{ opacity: deletingId === doc.doc_id ? 0.45 : 1, transition: "opacity 0.15s", pointerEvents: deletingId === doc.doc_id ? "none" : "auto" }}>
              <DocumentCard
                doc={doc}
                onClick={() => onSelect(doc.doc_id, doc.status === "extracted" ? doc : null)}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DOCUMENT DETAIL VIEW ──────────────────────────────────────
// Supports two sources of data:
//  1. A saved document — fetched from the server via GET /documents/{id}
//  2. A local-only "extracted but not saved" document — loaded straight from
//     localStorage (localRecord), with no fetch needed, plus a save action.

function DocumentDetailView({ docId, doctorId, localRecord, onBack, onSavedToLibrary, onDeleted }) {
  // Check if this is a local-only document (has preview data in localStorage)
  const isLocalOnly = !!localRecord?.preview;
  // Check if this is a server-side pending document
  const isServerPending = localRecord?._job?.status === "pending_review" || localRecord?.status === "extracted";

  const [data, setData] = useState(isLocalOnly ? { preview: localRecord.preview } : null);
  const [loading, setLoading] = useState(!isLocalOnly);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [editingSkill, setEditingSkill] = useState(null);
  const [editingMarkdownSkill, setEditingMarkdownSkill] = useState(null);
  const [editedSkills, setEditedSkills] = useState({});
  const [selectedSkillIds, setSelectedSkillIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedOk, setSavedOk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  

  useEffect(() => {
    if (isLocalOnly) {
      // Local-only: use the preview from localStorage
      const allSkillIds = (localRecord.preview?.skills_preview || []).map(s => s.skill_id);
      setSelectedSkillIds(allSkillIds);
      setLoading(false);
      return;
    }
    
    (async () => {
      setLoading(true);
      setError(null);
      
      try {
        let response;
        let json;
        
        // Check if this is a pending job from the server
        if (isServerPending) {
          console.log("Loading server-side pending document:", docId);
          response = await fetch(API_ENDPOINTS.jobResult(doctorId, docId));
          if (!response.ok) throw new Error("Failed to load pending document");
          json = await response.json();
          
          // Transform job result to match document format
          const preview = json.preview || {};
          const skills = json.skills || [];
          
          // Use skills from job result if skills_preview is empty
          if (!preview.skills_preview || preview.skills_preview.length === 0) {
            preview.skills_preview = skills.map(s => ({
              skill_id: s.skill_id,
              skill_index: s.skill_index,
              name: s.name || "Unnamed skill",
              skill_type: s.skill_type || "diagnosis",
              subtype: s.subtype || "General",
              description: s.description || "",
              trigger_keywords: s.trigger_keywords || [],
              graph_path: s.graph_path || "",
              body: s.body || {},
              source_pages: s.source_pages || [],
              confidence: s.confidence || {},
              status: s.status || "pending",
            }));
          }
          
          setData({
            doc_id: docId,
            preview: preview,
            skills: skills,
          });
          
          const allSkillIds = (preview.skills_preview || []).map(s => s.skill_id);
          setSelectedSkillIds(allSkillIds);
          
        } else {
          // Use /documents/{doc_id} for saved documents
          console.log("Loading saved document:", docId);
          response = await fetch(API_ENDPOINTS.document(doctorId, docId));
          if (!response.ok) throw new Error("Failed to load document");
          json = await response.json();
          setData(json);
          
          const preview = json.preview || {};
          const allSkillIds = (preview.skills_preview || []).map(s => s.skill_id);
          setSelectedSkillIds(allSkillIds);
        }
        
      } catch (e) {
        console.error("Error loading document:", e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [docId, doctorId, isLocalOnly, isServerPending, localRecord]);

  const toggleSkill = (id) => setSelectedSkillIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  
  const handleEditSave = (skillId, newBody) =>
    setEditedSkills(prev => ({ ...prev, [skillId]: newBody }));

  const handleResave = async () => {
    setSaving(true); 
    setSaveError(null); 
    setSavedOk(false);
    
    try {
      const res = await fetch(API_ENDPOINTS.approve(doctorId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_id: docId,
          doctor_id: doctorId,
          approved_skill_ids: selectedSkillIds,
          edited_skills: editedSkills,
        }),
      });
      
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Save failed");
      }
      
      const result = await res.json().catch(() => ({}));
      setSavedOk(true);
      
      // Always mark as saved in localStorage to remove from "pending" list
      markExtractedDocSaved(doctorId, docId, result.saved);
      
      // Notify parent component to refresh the list
      if (onSavedToLibrary) {
        onSavedToLibrary(docId);
      }
      
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(
      "Delete this document? This permanently removes it and every skill, graph node, " +
      "and embedding derived from it. This cannot be undone."
    )) {
      return;
    }

    setDeleteError(null);
    setDeleting(true);

    // Local-only document — nothing saved server-side yet.
    if (isLocalOnly) {
      removeExtractedDoc(doctorId, docId);
      setDeleting(false);
      onDeleted?.(docId);
      return;
    }

    try {
      const res = await fetch(API_ENDPOINTS.deleteDocument(doctorId, docId), {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Delete failed");
      }
      removeExtractedDoc(doctorId, docId);
      onDeleted?.(docId);
    } catch (e) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "#000" }}>
      <i className="ti ti-loader-2" style={{
        fontSize: "28px", animation: "spin 1s linear infinite", display: "block", marginBottom: "12px",
      }} aria-hidden />
      Loading document...
    </div>
  );

  if (error) return (
    <div style={{
      padding: "16px", background: "#000", color: "#fff",
      borderRadius: "8px", fontSize: "13px", fontWeight: 600,
    }}>{error}</div>
  );

  // Determine if this document is pending (not saved yet)
  const isPending = isLocalOnly || isServerPending || data?.status === "pending_review";

  const preview = data?.preview || {};
  const summary = preview.summary || {};
  const skills = preview.skills_preview || [];
  const diagSkills = skills.filter(s => s.skill_type === "diagnosis");
  const treatSkills = skills.filter(s => s.skill_type === "treatment");
  const tabs = ["overview", "diagnosis", "treatment", "graph", "lineage", "skills"];

  return (
    <div className="fade-in">
      {/* Back + header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px", flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{
            padding: "8px 15px", fontSize: "12px", fontWeight: 700, borderRadius: "6px", cursor: "pointer",
            background: "#fff", border: "1.5px solid #000", color: "#000",
            display: "flex", alignItems: "center", gap: "6px",
          }}
        >
          <i className="ti ti-arrow-left" style={{ fontSize: "13px" }} aria-hidden />
          Back
        </button>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <p style={{ margin: "0 0 2px", fontSize: "17px", fontWeight: 700, color: "#000" }}>
            {preview.guideline?.name || "Untitled Document"}
          </p>
          <p style={{ margin: 0, fontSize: "11px", color: "var(--text-faint)" }}>
            {preview.guideline?.version && `v${preview.guideline.version} · `}
            {skills.length} skills · {preview.graph?.total_nodes || 0} graph nodes
          </p>
        </div>
        <StatusBadge status={isPending ? "extracted" : "saved"} />
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: "8px 15px", fontSize: "12px", fontWeight: 700, borderRadius: "6px",
            cursor: deleting ? "not-allowed" : "pointer",
            background: "#fff", border: "1.5px solid #000", color: "#000",
            display: "flex", alignItems: "center", gap: "6px", opacity: deleting ? 0.5 : 1,
          }}
        >
          {deleting
            ? <i className="ti ti-loader-2" style={{ fontSize: "13px", animation: "spin 1s linear infinite" }} aria-hidden />
            : <i className="ti ti-trash" style={{ fontSize: "13px" }} aria-hidden />
          }
          Delete
        </button>
      </div>

      {deleteError && (
        <div style={{
          padding: "12px", marginBottom: "16px", fontSize: "13px", fontWeight: 600,
          background: "#000", color: "#fff", borderRadius: "8px",
        }}>{deleteError}</div>
      )}

      {isPending && (
        <div style={{
          padding: "12px 16px", marginBottom: "18px", fontSize: "12px", fontWeight: 600,
          background: "#fff", border: "2px dashed #000", borderRadius: "8px", color: "#000",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <i className="ti ti-info-circle" style={{ fontSize: "16px", flexShrink: 0 }} aria-hidden />
          This document was fully processed by the pipeline but hasn't been saved to the database. Review the tabs below, then use the "Skills" tab to save it.
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "Subtypes", value: summary.subtypes?.length ?? 0, icon: "ti-git-branch" },
          { label: "Stages", value: summary.stages?.length ?? 0, icon: "ti-list-numbers" },
          { label: "Graph nodes", value: preview.graph?.total_nodes ?? 0, icon: "ti-hierarchy" },
          { label: "Skills", value: skills.length, icon: "ti-brain" },
        ].map(m => (
          <div key={m.label} style={{
            background: "#fff", borderRadius: "10px", padding: "14px 16px",
            border: "2px solid #000",
          }}>
            <p style={{
              margin: "0 0 4px", fontSize: "11px", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)",
            }}>
              <i className={`ti ${m.icon}`} style={{ fontSize: "12px", marginRight: "4px" }} aria-hidden />
              {m.label}
            </p>
            <p style={{ margin: 0, fontSize: "30px", fontWeight: 800, lineHeight: 1.2, color: "#000" }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: "16px", borderBottom: "2px solid #000" }}>
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 18px", fontSize: "12px", fontWeight: 700,
              letterSpacing: "0.05em", textTransform: "uppercase",
              cursor: "pointer", border: "none",
              background: activeTab === tab ? "#000" : "transparent",
              color: activeTab === tab ? "#fff" : "#000", marginBottom: "-2px",
              borderRadius: "6px 6px 0 0",
            }}
          >{tab}</button>
        ))}
      </div>

      {/* ── Tab: Overview ── */}
      {activeTab === "overview" && (
        <div>
          {Object.entries({
            diseases: summary.diseases,
            subtypes: summary.subtypes,
            stages: summary.stages,
            biomarkers: summary.biomarkers,
            drugs: summary.drugs,
            investigations: summary.investigations,
            regimens: summary.regimens,
          }).filter(([, v]) => v?.length > 0).map(([key, vals]) => (
            <SectionCard
              key={key}
              title={key.charAt(0).toUpperCase() + key.slice(1)}
              icon={
                key === "diseases" ? "ti-virus" :
                key === "subtypes" ? "ti-git-branch" :
                key === "stages" ? "ti-list-numbers" :
                key === "biomarkers" ? "ti-dna" :
                key === "drugs" ? "ti-pill" :
                key === "investigations" ? "ti-microscope" : "ti-notes"
              }
            >
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {vals.map((v, i) => {
                  const label = typeof v === "string" ? v : (v?.name || v?.value || String(v));
                  return <Tag key={`${key}-${i}`} label={label} />;
                })}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* ── Tab: Diagnosis ── */}
      {activeTab === "diagnosis" && (
        <div>
          {preview.diagnosis_knowledge && Object.entries(preview.diagnosis_knowledge).map(([key, val]) => {
            if (!val || (Array.isArray(val) && !val.length)) return null;
            return (
              <SectionCard key={key} title={key.replace(/_/g, " ")} icon="ti-stethoscope" accent>
                <pre style={{
                  margin: 0, fontSize: "11px", lineHeight: 1.7, whiteSpace: "pre-wrap",
                  color: "#000", fontFamily: "var(--font-mono)",
                }}>{JSON.stringify(val, null, 2)}</pre>
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* ── Tab: Treatment ── */}
      {activeTab === "treatment" && (
        <div>
          {preview.treatment_knowledge && Object.entries(preview.treatment_knowledge).map(([key, val]) => {
            if (!val || (Array.isArray(val) && !val.length)) return null;
            return (
              <SectionCard key={key} title={key.replace(/_/g, " ")} icon="ti-hearts" accent>
                <pre style={{
                  margin: 0, fontSize: "11px", lineHeight: 1.7, whiteSpace: "pre-wrap",
                  color: "#000", fontFamily: "var(--font-mono)",
                }}>{JSON.stringify(val, null, 2)}</pre>
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* ── Tab: Graph ── */}
      {activeTab === "graph" && (
        <div>
          <SectionCard title="Knowledge graph structure" icon="ti-hierarchy">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              {preview.graph?.node_types?.map(t => (
                <div key={t} style={{
                  padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                  background: "#fff", border: "1.5px solid #000", color: "#000",
                }}>
                  <i className="ti ti-circle-dot" style={{ fontSize: "11px", marginRight: "5px" }} aria-hidden />
                  {t}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "24px" }}>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
                <span style={{ fontWeight: 800, color: "#000" }}>{preview.graph?.total_nodes || 0}</span> nodes
              </p>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
                <span style={{ fontWeight: 800, color: "#000" }}>{preview.graph?.total_edges || 0}</span> edges
              </p>
            </div>
          </SectionCard>
          <div style={{ fontSize: "12px", color: "var(--text-soft)", lineHeight: 1.7, padding: "8px 4px" }}>
            Graph path: <strong style={{ color: "#000" }}>
              Doctor → {summary.disease_type || summary.cancer_type || "Disease"} → Subtypes → Stages → Biomarkers → Drugs
            </strong>
          </div>
        </div>
      )}

      {/* ── Tab: Knowledge Lineage (5-view suite) ── */}
      {activeTab === "lineage" && (
        <KnowledgeLineageView
          preview={preview}
          skills={skills}
          skillCoverage={data?.skill_coverage}
          doctorId={doctorId}
          docId={docId}
        />
      )}

      {/* ── Tab: Skills (save / re-approve / edit)) ── */}
      {activeTab === "skills" && (
        <div>
          <div style={{
            padding: "16px 18px", background: "#fff",
            border: "2px solid #000", borderRadius: "10px", marginBottom: "16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#000" }}>
                {selectedSkillIds.length} of {skills.length} skills selected
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setSelectedSkillIds(skills.map(s => s.skill_id))}
                  style={{ fontSize: "11px", fontWeight: 600, padding: "5px 13px", borderRadius: "4px", cursor: "pointer", background: "#fff", border: "1.5px solid #000", color: "#000" }}
                >Select all</button>
                <button
                  onClick={() => setSelectedSkillIds([])}
                  style={{ fontSize: "11px", fontWeight: 600, padding: "5px 13px", borderRadius: "4px", cursor: "pointer", background: "#fff", border: "1.5px solid #000", color: "#000" }}
                >Clear</button>
              </div>
            </div>

            {diagSkills.length > 0 && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: "10px", fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Diagnosis skills
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                  {diagSkills.map(s => (
                    <SkillCard
                      key={s.skill_id} skill={s}
                      selected={selectedSkillIds.includes(s.skill_id)}
                      onToggle={() => toggleSkill(s.skill_id)}
                      onEditMarkdown={sk => setEditingMarkdownSkill(sk)}
                      onDownloadMarkdown={sk => window.open(
                        isPending
                          ? API_ENDPOINTS.previewDownloadMarkdown(doctorId, docId, sk.skill_id)
                          : API_ENDPOINTS.downloadMarkdown(doctorId, sk.skill_id, sk.skill_type)
                      )}
                    />
                  ))}
                </div>
              </>
            )}

            {treatSkills.length > 0 && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: "10px", fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Treatment skills
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                  {treatSkills.map(s => (
                    <SkillCard
                      key={s.skill_id} skill={s}
                      selected={selectedSkillIds.includes(s.skill_id)}
                      onToggle={() => toggleSkill(s.skill_id)}
                      onEditMarkdown={sk => setEditingMarkdownSkill(sk)}
                      onDownloadMarkdown={sk => window.open(
                        isPending
                          ? API_ENDPOINTS.previewDownloadMarkdown(doctorId, docId, sk.skill_id)
                          : API_ENDPOINTS.downloadMarkdown(doctorId, sk.skill_id, sk.skill_type)
                      )}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {saveError && (
            <div style={{ padding: "10px 14px", marginBottom: "10px", fontSize: "12px", fontWeight: 600, background: "#000", color: "#fff", borderRadius: "6px" }}>
              {saveError}
            </div>
          )}
          {savedOk && (
            <div style={{ padding: "10px 14px", marginBottom: "10px", fontSize: "12px", fontWeight: 600, background: "#fff", color: "#000", border: "1.5px solid #000", borderRadius: "6px" }}>
              <i className="ti ti-check" style={{ marginRight: "6px" }} aria-hidden />
              {isPending ? "Document saved to the database." : "Skills updated successfully."}
            </div>
          )}

          <button
            onClick={handleResave}
            disabled={saving || !selectedSkillIds.length}
            style={{
              width: "100%", padding: "13px", fontSize: "12px", fontWeight: 700,
              letterSpacing: "0.05em", borderRadius: "8px", textTransform: "uppercase",
              cursor: saving || !selectedSkillIds.length ? "not-allowed" : "pointer",
              background: selectedSkillIds.length ? "#000" : "#fff",
              color: selectedSkillIds.length ? "#fff" : "var(--text-faint)",
              border: "2px solid #000",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}
          >
            {saving
              ? <><i className="ti ti-loader-2" style={{ fontSize: "15px", animation: "spin 1s linear infinite" }} aria-hidden />Saving...</>
              : <><i className="ti ti-database-import" style={{ fontSize: "15px" }} aria-hidden />
                  {isPending ? `Save ${selectedSkillIds.length} skills to database` : `Re-save ${selectedSkillIds.length} skills`}
                </>
            }
          </button>
        </div>
      )}

      {editingSkill && (
        <EditModal skill={editingSkill} onSave={handleEditSave} onClose={() => setEditingSkill(null)} />
      )}
      {editingMarkdownSkill && (
        <MarkdownEditModal
          skill={editingMarkdownSkill}
          fetchUrl={isPending
            ? API_ENDPOINTS.previewSkillMarkdown(doctorId, docId, editingMarkdownSkill.skill_id)
            : API_ENDPOINTS.skillMarkdown(doctorId, editingMarkdownSkill.skill_id, editingMarkdownSkill.skill_type)}
          saveUrl={isPending
            ? API_ENDPOINTS.previewSkillMarkdown(doctorId, docId, editingMarkdownSkill.skill_id)
            : API_ENDPOINTS.skillMarkdown(doctorId, editingMarkdownSkill.skill_id, editingMarkdownSkill.skill_type)}
          onSaved={(skillId, updatedBody) => {
            if (updatedBody) {
              setData(prev => prev && ({
                ...prev,
                preview: prev.preview && ({
                  ...prev.preview,
                  skills_preview: (prev.preview.skills_preview || []).map(s =>
                    s.skill_id === skillId ? { ...s, body: updatedBody } : s
                  ),
                }),
              }));
            }
            setEditingMarkdownSkill(null);
          }}
          onClose={() => setEditingMarkdownSkill(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export default function Phase1Upload() {
  // mode: "list" | "upload" | "detail"
  const [mode,          setMode]          = useState("list");
  const [step,          setStep]          = useState("upload");
  const [dragging,      setDragging]      = useState(false);
  const [file,          setFile]          = useState(null);
  const [processingStep,setProcessingStep]= useState(null);
  const [doneSteps,     setDoneSteps]     = useState([]);
  const [error,         setError]         = useState(null);
  const [docId,         setDocId]         = useState(null);
  const [preview,       setPreview]       = useState(null);
  const [pipelineResult,setPipelineResult]= useState(null);
  const [selectedSkillIds,setSelectedSkillIds] = useState([]);
  const [editedSkills,  setEditedSkills]  = useState({});
  const [editingSkill,  setEditingSkill]  = useState(null);
  const [editingMarkdownSkill, setEditingMarkdownSkill] = useState(null); // ← add this line
  const [saving,        setSaving]        = useState(false);
  const [savedSummary,  setSavedSummary]  = useState(null);
  const [activeTab,     setActiveTab]     = useState("overview");
  const [viewingDocId,  setViewingDocId]  = useState(null);
  const [viewingLocal,  setViewingLocal]  = useState(null);

  const fileInputRef = useRef();
  const doctorId     = getDoctorId();
  const PROCESS_STEPS = Object.keys(STEP_LABELS).filter(s => s !== "done");

  // ── Guard: missing doctor_id ───────────────────────────────
  if (!doctorId) return (
    <>
      <FontStyle />
      <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto", fontFamily: "var(--font-sans)" }}>
        <div style={{
          padding: "14px 18px", fontSize: "13px", fontWeight: 600,
          background: "#000", color: "#fff", borderRadius: "8px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <i className="ti ti-alert-circle" style={{ fontSize: "18px", flexShrink: 0 }} aria-hidden />
          Missing doctor_id parameter. Please provide a valid doctor_id in the URL (e.g., ?doctor_id=DR_DEMO_001)
        </div>
      </div>
    </>
  );

  // ── Helpers ────────────────────────────────────────────────
  const handleFile = (f) => {
    if (!f) return;
    const ext = "." + f.name.split(".").pop().toLowerCase();
    if (![".pdf", ".docx", ".doc", ".txt", ".md"].includes(ext)) {
      setError("Unsupported file type. Please upload PDF, DOCX, or TXT.");
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setStep("processing");
    setError(null);
    setDoneSteps([]);
    setProcessingStep(null);

    // ── 1. Upload the file — returns immediately with { doc_id, task_id, status: "queued" } ──
    let uploadedDocId;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(API_ENDPOINTS.upload(doctorId), { method: "POST", body: formData });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Upload failed");
      }
      const data = await res.json();
      uploadedDocId = data.doc_id;
      setDocId(data.doc_id);
    } catch (err) {
      setError(err.message || "Upload failed. Please try again.");
      setStep("upload");
      setDoneSteps([]);
      setProcessingStep(null);
      return;
    }

    // ── 2. Poll GET /jobs/{doc_id} until status = "pending_review" ──
    const stepKeys = Object.keys(STEP_LABELS).filter(s => s !== "done");
    let stepIndex  = 0;
    const startedAt = Date.now();

    await new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        if (stepIndex < stepKeys.length) {
          const current = stepKeys[stepIndex];
          setProcessingStep(current);
          if (stepIndex > 0) {
            setDoneSteps(prev => [...prev, stepKeys[stepIndex - 1]]);
          }
          stepIndex++;
        }

        if (Date.now() - startedAt > POLL_MAX_WAIT_MS) {
          clearInterval(interval);
          reject(new Error("Processing timed out after 30 minutes. Please try again."));
          return;
        }

        try {
          const res  = await fetch(API_ENDPOINTS.job(doctorId, uploadedDocId));
          if (!res.ok) return;
          const data = await res.json();

          if (data.status === "pending_review") {
            clearInterval(interval);
            setDoneSteps(stepKeys);
            setProcessingStep(null);

            try {
              const resultRes  = await fetch(API_ENDPOINTS.jobResult(doctorId, uploadedDocId));
              const resultData = await resultRes.json();
              const jobPreview = resultData.preview;

              if (!jobPreview || !jobPreview.skills_preview?.length) {
                reject(new Error("Pipeline completed but no skills were generated. Please try again."));
                return;
              }

              setPreview(jobPreview);
              setPipelineResult(resultData);
              setSelectedSkillIds((jobPreview.skills_preview || []).map(s => s.skill_id));

              // Persist immediately so this output is never lost, even if
              // the user never reaches/clicks the final "save" button.
              upsertExtractedDoc(doctorId, uploadedDocId, {
                status: "extracted",
                guideline_name: jobPreview.guideline?.name,
                guideline_version: jobPreview.guideline?.version,
                specialty: jobPreview.summary?.specialty,
                disease_type: jobPreview.summary?.disease_type || jobPreview.summary?.cancer_type,
                subtypes: jobPreview.summary?.subtypes,
                skill_ids: (jobPreview.skills_preview || []).map(s => s.skill_id),
                confidence_stats: jobPreview.confidence_stats || null,
                created_at: new Date().toISOString(),
                preview: jobPreview,
              });

              resolve();
            } catch {
              reject(new Error("Failed to load pipeline results. Please refresh and try again."));
            }
            return;
          }

          if (data.status === "failed") {
            clearInterval(interval);
            reject(new Error(data.error || "Pipeline failed. Please try again."));
          }
        } catch {
          // Network hiccup — keep polling
        }
      }, POLL_INTERVAL_MS);
    }).then(() => {
      setStep("review");
    }).catch(err => {
      setError(err.message);
      setStep("upload");
      setDoneSteps([]);
      setProcessingStep(null);
    });
  };

  const toggleSkill    = (id) => setSelectedSkillIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const handleEditSave = (skillId, newBody) =>
    setEditedSkills(prev => ({ ...prev, [skillId]: newBody }));

  const handleGenerateSkills = async () => {
    if (!selectedSkillIds.length) { setError("Select at least one skill to save."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API_ENDPOINTS.approve(doctorId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_id:             docId,
          doctor_id:          doctorId,
          approved_skill_ids: selectedSkillIds,
          edited_skills:      editedSkills,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Save failed");
      }
      const data = await res.json();
      setSavedSummary(data.saved);
      if (docId) markExtractedDocSaved(doctorId, docId, data.saved);
      setStep("saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStep("upload"); setMode("list");
    setFile(null); setPreview(null); setPipelineResult(null); setDocId(null);
    setSelectedSkillIds([]); setEditedSkills({}); setError(null); setSavedSummary(null);
    setDoneSteps([]); setProcessingStep(null); setActiveTab("overview");
  };

  const summary     = preview?.summary || {};
  const skills      = preview?.skills_preview || [];
  const diagSkills  = skills.filter(s => s.skill_type === "diagnosis");
  const treatSkills = skills.filter(s => s.skill_type === "treatment");
  const currentStepIdx = STEPS.findIndex(s => s.id === step);

  // ── Shared outer wrapper ───────────────────────────────────
  const Wrapper = ({ children }) => (
    <>
      <FontStyle />
      <div style={{
        padding: "2rem", maxWidth: "1400px", margin: "0 auto",
        fontFamily: "var(--font-sans)", background: "#fff", minHeight: "100vh",
      }}>
        {/* Doctor ID pill */}
        <div style={{
          marginBottom: "1.5rem", padding: "7px 16px",
          background: "#000", border: "2px solid #000",
          borderRadius: "999px", display: "inline-flex", alignItems: "center",
          gap: "8px", fontSize: "11px", color: "#fff", fontWeight: 600,
        }}>
          <i className="ti ti-user" style={{ fontSize: "12px" }} aria-hidden />
          Doctor: <strong style={{ color: "#fff", fontWeight: 800 }}>{doctorId}</strong>
        </div>
        {children}
      </div>
    </>
  );

  // ══════════════════════════════════════════════
  // MODE: DETAIL — view a previously processed document (saved or not)
  // ══════════════════════════════════════════════
  if (mode === "detail" && viewingDocId) {
    return (
      <Wrapper>
        <DocumentDetailView
  docId={viewingDocId}
  doctorId={doctorId}
  localRecord={viewingLocal}
  onBack={() => { setViewingDocId(null); setViewingLocal(null); setMode("list"); }}
  onSavedToLibrary={() => {
    setViewingLocal(null);
    // The document list will refresh when user goes back to list view
  }}
  onDeleted={() => {
    setViewingDocId(null);
    setViewingLocal(null);
    setMode("list");
  }}
/>
      </Wrapper>
    );
  }

  // ══════════════════════════════════════════════
  // MODE: LIST — library of all processed documents (saved + not-yet-saved)
  // ══════════════════════════════════════════════

  if (mode === "dashboard") {
    return (
        <div className="fade-in">

            <button
                onClick={() => setMode("list")}
                style={{
                    marginBottom: "20px",
                    padding: "8px 16px",
                    border: "2px solid #000",
                    background: "#fff",
                    cursor: "pointer",
                    borderRadius: "8px",
                    fontWeight: 700,
                }}
            >
                <i className="ti ti-arrow-left" />
                Back to Library
            </button>

            <DoctorKnowledgeDashboard
                doctorId={doctorId}
                apiBase={getApiBase()}
            />

        </div>
    );
}

  if (mode === "list") {
    return (
      <Wrapper>
        <DocumentsListView
          doctorId={doctorId}
          onSelect={(id, localDoc) => { setViewingDocId(id); setViewingLocal(localDoc); setMode("detail"); }}
          onUpload={() => { setMode("upload"); setStep("upload"); setError(null); }}
          onOpenDashboard={() => setMode("dashboard")}
        />
      </Wrapper>
    );
  }

  // ══════════════════════════════════════════════
  // MODE: UPLOAD — upload / processing / review / saved
  // ══════════════════════════════════════════════
  return (
    <Wrapper>
      <h2 className="sr-only">Phase 1 — Clinical knowledge creation</h2>

      {/* Back to library */}
      <button
        onClick={() => { setMode("list"); setStep("upload"); setError(null); }}
        style={{
          marginBottom: "1.5rem", padding: "7px 15px", fontSize: "12px", fontWeight: 700, borderRadius: "6px",
          cursor: "pointer", background: "#fff", border: "1.5px solid #000",
          color: "#000", display: "inline-flex", alignItems: "center", gap: "6px",
        }}
      >
        <i className="ti ti-arrow-left" style={{ fontSize: "12px" }} aria-hidden />
        Back to library
      </button>

      {/* ── Step indicator ────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "2rem", gap: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <div style={{
                width: "38px", height: "38px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: i <= currentStepIdx ? "#000" : "#fff",
                border: "2px solid #000",
                transition: "all 0.25s",
              }}>
                {i < currentStepIdx
                  ? <i className="ti ti-check" style={{ fontSize: "14px", color: "#fff" }} aria-hidden />
                  : <i className={`ti ${s.icon}`} style={{ fontSize: "15px", color: i === currentStepIdx ? "#fff" : "#000" }} aria-hidden />
                }
              </div>
              <span style={{
                fontSize: "10px", fontWeight: i === currentStepIdx ? 700 : 500,
                color: "#000", opacity: i <= currentStepIdx ? 1 : 0.4,
                letterSpacing: "0.02em",
              }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: "2px", margin: "0 8px", marginBottom: "24px",
                background: i < currentStepIdx ? "#000" : "rgba(0,0,0,0.2)",
                transition: "background 0.25s",
              }} />
            )}
          </div>
        ))}
      </div>

      {/* ── Error banner ─────────────────────────── */}
      {error && (
        <div style={{
          padding: "13px 16px", marginBottom: "20px", fontSize: "13px", fontWeight: 600,
          background: "#000", color: "#fff", borderRadius: "8px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <i className="ti ti-alert-circle" style={{ fontSize: "18px", flexShrink: 0 }} aria-hidden />
          {error}
        </div>
      )}

      {/* ══════════════════════════════════════════
          STEP: UPLOAD
      ══════════════════════════════════════════ */}
      {step === "upload" && (
        <div>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2.5px dashed #000`,
              borderRadius: "12px", padding: "3rem 1.5rem",
              textAlign: "center", cursor: "pointer",
              background: dragging ? "#000" : "#fff",
              transition: "all 0.2s ease", marginBottom: "1.5rem",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              style={{ display: "none" }}
              onChange={e => handleFile(e.target.files[0])}
            />
            <i className="ti ti-cloud-upload" style={{
              fontSize: "44px", color: dragging ? "#fff" : "#000",
              display: "block", marginBottom: "12px",
            }} aria-hidden />
            {file ? (
              <>
                <p style={{ fontWeight: 700, fontSize: "14px", margin: "0 0 4px", color: dragging ? "#fff" : "#000" }}>{file.name}</p>
                <p style={{ fontSize: "12px", color: dragging ? "rgba(255,255,255,0.75)" : "var(--text-soft)", margin: 0 }}>
                  {(file.size / 1024).toFixed(1)} KB · Click to change
                </p>
              </>
            ) : (
              <>
                <p style={{ fontWeight: 700, fontSize: "14px", margin: "0 0 4px", color: dragging ? "#fff" : "#000" }}>
                  Drop clinical document here
                </p>
                <p style={{ fontSize: "12px", color: dragging ? "rgba(255,255,255,0.75)" : "var(--text-soft)", margin: 0 }}>
                  PDF, DOCX, TXT · Guidelines, research papers, hospital protocols
                </p>
              </>
            )}
          </div>

          {/* Supported formats */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "10px", marginBottom: "24px",
          }}>
            {["NCCN Guideline", "ASCO Protocol", "ESMO Guideline", "Research Paper", "Hospital SOP", "Textbook Chapter"].map(t => (
              <div key={t} style={{
                padding: "11px 12px", fontSize: "11px", fontWeight: 600, textAlign: "center",
                color: "#000", background: "#fff",
                border: "1.5px solid #000", borderRadius: "8px",
              }}>
                <i className="ti ti-file-text" style={{ fontSize: "14px", display: "block", marginBottom: "4px" }} aria-hidden />
                {t}
              </div>
            ))}
          </div>

          <button
            disabled={!file}
            onClick={handleUpload}
            style={{
              width: "100%", padding: "13px", fontSize: "12px", fontWeight: 700,
              letterSpacing: "0.05em", borderRadius: "8px", textTransform: "uppercase",
              cursor: file ? "pointer" : "not-allowed",
              background: file ? "#000" : "#fff",
              color: file ? "#fff" : "var(--text-faint)",
              border: "2px solid #000",
              transition: "all 0.2s",
            }}
          >
            <i className="ti ti-cpu" style={{ marginRight: "8px", fontSize: "14px" }} aria-hidden />
            Process Document
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          STEP: PROCESSING
      ══════════════════════════════════════════ */}
      {step === "processing" && (
        <div style={{
          background: "#fff", border: "2px solid #000",
          borderRadius: "14px", padding: "2rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1.5rem" }}>
            <div style={{
              width: "46px", height: "46px", borderRadius: "50%",
              background: "#000", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className="ti ti-cpu" style={{ fontSize: "20px", color: "#fff" }} aria-hidden />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: "#000" }}>Processing {file?.name}</p>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
                Running clinical knowledge extraction pipeline
              </p>
            </div>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            {PROCESS_STEPS.map(s => (
              <ProgressStep
                key={s}
                label={STEP_LABELS[s]}
                done={doneSteps.includes(s)}
                active={processingStep === s && !doneSteps.includes(s)}
              />
            ))}
          </div>

          <div style={{ height: "4px", background: "rgba(0,0,0,0.15)", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: "999px", background: "#000",
              width: `${Math.round((doneSteps.length / PROCESS_STEPS.length) * 100)}%`,
              transition: "width 0.4s ease",
            }} />
          </div>
          <p style={{ margin: "10px 0 0", fontSize: "11px", color: "var(--text-faint)", textAlign: "right", fontWeight: 600 }}>
            {Math.round((doneSteps.length / PROCESS_STEPS.length) * 100)}% complete
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════
          STEP: REVIEW
      ══════════════════════════════════════════ */}
      {step === "review" && preview && (
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: "19px", fontWeight: 800, color: "#000" }}>
                {preview.guideline?.name}
              </p>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
                Version {preview.guideline?.version} · {skills.length} skills generated · {preview.graph?.total_nodes} graph nodes
              </p>
            </div>
            <button
              onClick={handleReset}
              style={{
                padding: "8px 15px", fontSize: "12px", fontWeight: 700, borderRadius: "6px", cursor: "pointer",
                background: "#fff", border: "1.5px solid #000", color: "#000",
              }}
            >
              <i className="ti ti-arrow-left" style={{ marginRight: "6px", fontSize: "12px" }} aria-hidden />
              Re-upload
            </button>
          </div>

          {/* Stat row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
            {[
              { label: "Subtypes",    value: summary.subtypes?.length    ?? 0, icon: "ti-git-branch"  },
              { label: "Stages",      value: summary.stages?.length      ?? 0, icon: "ti-list-numbers" },
              { label: "Drugs",       value: summary.drugs?.length       ?? 0, icon: "ti-pill"         },
              { label: "Graph nodes", value: preview.graph?.total_nodes  ?? 0, icon: "ti-hierarchy"   },
            ].map(m => (
              <div key={m.label} style={{
                background: "#fff", borderRadius: "10px", padding: "14px 16px",
                border: "2px solid #000",
              }}>
                <p style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                  <i className={`ti ${m.icon}`} style={{ fontSize: "12px", marginRight: "4px" }} aria-hidden />
                  {m.label}
                </p>
                <p style={{ margin: 0, fontSize: "30px", fontWeight: 800, color: "#000", lineHeight: 1.2 }}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: "16px", borderBottom: "2px solid #000" }}>
            {["overview", "diagnosis", "treatment", "graph"].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "10px 20px", fontSize: "12px", fontWeight: 700,
                  letterSpacing: "0.05em", textTransform: "uppercase",
                  cursor: "pointer", border: "none",
                  background: activeTab === tab ? "#000" : "transparent",
                  color: activeTab === tab ? "#fff" : "#000", marginBottom: "-2px",
                  borderRadius: "6px 6px 0 0",
                }}
              >{tab}</button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div>
              {Object.entries({
                diseases: summary.diseases, subtypes: summary.subtypes,
                stages: summary.stages, biomarkers: summary.biomarkers,
                drugs: summary.drugs, investigations: summary.investigations,
                regimens: summary.regimens,
              }).filter(([, v]) => v?.length > 0).map(([key, vals]) => (
                <SectionCard
                  key={key}
                  title={key.charAt(0).toUpperCase() + key.slice(1)}
                  icon={
                    key === "diseases"       ? "ti-virus"       :
                    key === "subtypes"       ? "ti-git-branch"  :
                    key === "stages"         ? "ti-list-numbers":
                    key === "biomarkers"     ? "ti-dna"         :
                    key === "drugs"          ? "ti-pill"        :
                    key === "investigations" ? "ti-microscope"  : "ti-notes"
                  }
                >
                  <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {vals.map((v, i) => {
                      const label = typeof v === "string" ? v : (v?.name || v?.value || String(v));
                      return <Tag key={`${key}-${i}`} label={label} />;
                    })}
                  </div>
                </SectionCard>
              ))}
            </div>
          )}

          {activeTab === "diagnosis" && (
            <div>
              {preview.diagnosis_knowledge && Object.entries(preview.diagnosis_knowledge).map(([key, val]) => {
                if (!val || (Array.isArray(val) && !val.length)) return null;
                return (
                  <SectionCard key={key} title={key.replace(/_/g, " ")} icon="ti-stethoscope" accent>
                    <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#000", fontFamily: "var(--font-mono)" }}>
                      {JSON.stringify(val, null, 2)}
                    </pre>
                  </SectionCard>
                );
              })}
            </div>
          )}

          {activeTab === "treatment" && (
            <div>
              {preview.treatment_knowledge && Object.entries(preview.treatment_knowledge).map(([key, val]) => {
                if (!val || (Array.isArray(val) && !val.length)) return null;
                return (
                  <SectionCard key={key} title={key.replace(/_/g, " ")} icon="ti-hearts" accent>
                    <pre style={{ margin: 0, fontSize: "11px", lineHeight: 1.7, whiteSpace: "pre-wrap", color: "#000", fontFamily: "var(--font-mono)" }}>
                      {JSON.stringify(val, null, 2)}
                    </pre>
                  </SectionCard>
                );
              })}
            </div>
          )}

          {activeTab === "graph" && (
            <div>
              <SectionCard title="Knowledge graph structure" icon="ti-hierarchy">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {preview.graph?.node_types?.map(t => (
                    <div key={t} style={{
                      padding: "6px 13px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                      background: "#fff", border: "1.5px solid #000", color: "#000",
                    }}>
                      <i className="ti ti-circle-dot" style={{ fontSize: "11px", marginRight: "5px" }} aria-hidden />
                      {t}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "24px", marginTop: "14px" }}>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
                    <span style={{ fontWeight: 800, color: "#000" }}>{preview.graph?.total_nodes}</span> nodes
                  </p>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-soft)" }}>
                    <span style={{ fontWeight: 800, color: "#000" }}>{preview.graph?.total_edges}</span> edges
                  </p>
                </div>
              </SectionCard>
              <div style={{ fontSize: "12px", color: "var(--text-soft)", lineHeight: 1.7, padding: "8px 4px" }}>
                Graph path: <strong style={{ color: "#000" }}>
                  Doctor → {summary.cancer_type || summary.disease_type} → Subtypes → Stages → Biomarkers → Drugs
                </strong>
              </div>
            </div>
          )}

          {/* Skills selection */}
          <div style={{
            marginTop: "24px", padding: "17px 20px",
            background: "#fff", border: "2px solid #000",
            borderRadius: "12px", marginBottom: "16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#000" }}>Select skills to save</p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setSelectedSkillIds(skills.map(s => s.skill_id))} style={{ fontSize: "11px", fontWeight: 600, padding: "5px 13px", borderRadius: "4px", cursor: "pointer", background: "#fff", border: "1.5px solid #000", color: "#000" }}>Select all</button>
                <button onClick={() => setSelectedSkillIds([])} style={{ fontSize: "11px", fontWeight: 600, padding: "5px 13px", borderRadius: "4px", cursor: "pointer", background: "#fff", border: "1.5px solid #000", color: "#000" }}>Clear</button>
              </div>
            </div>

            {diagSkills.length > 0 && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: "10px", fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Diagnosis skills
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginBottom: "16px" }}>
                  {diagSkills.map(s => (
                    <SkillCard
                      key={s.skill_id} skill={s}
                      selected={selectedSkillIds.includes(s.skill_id)}
                      onToggle={() => toggleSkill(s.skill_id)}
                      // onEdit={sk => setEditingSkill(pipelineResult?.skills?.find(x => x.skill_id === sk.skill_id) || sk)}
                      onEditMarkdown={sk => setEditingMarkdownSkill(sk)}
                      onDownloadMarkdown={sk => window.open(API_ENDPOINTS.previewDownloadMarkdown(doctorId, docId, sk.skill_id))}
                    />
                  ))}
                </div>
              </>
            )}

            {treatSkills.length > 0 && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: "10px", fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Treatment skills
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                  {treatSkills.map(s => (
                    <SkillCard
                      key={s.skill_id} skill={s}
                      selected={selectedSkillIds.includes(s.skill_id)}
                      onToggle={() => toggleSkill(s.skill_id)}
                      // onEdit={sk => setEditingSkill(pipelineResult?.skills?.find(x => x.skill_id === sk.skill_id) || sk)}
                      onEditMarkdown={sk => setEditingMarkdownSkill(sk)}
                      onDownloadMarkdown={sk => window.open(API_ENDPOINTS.previewDownloadMarkdown(doctorId, docId, sk.skill_id))}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleGenerateSkills}
            disabled={saving || !selectedSkillIds.length}
            style={{
              width: "100%", padding: "15px", fontSize: "13px", fontWeight: 700,
              letterSpacing: "0.05em", borderRadius: "10px", textTransform: "uppercase",
              cursor: saving || !selectedSkillIds.length ? "not-allowed" : "pointer",
              background: selectedSkillIds.length > 0 ? "#000" : "#fff",
              color: selectedSkillIds.length > 0 ? "#fff" : "var(--text-faint)",
              border: "2px solid #000",
              transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}
          >
            {saving
              ? <><i className="ti ti-loader-2" style={{ fontSize: "16px", animation: "spin 1s linear infinite" }} aria-hidden />Saving skills to database...</>
              : <><i className="ti ti-database-import" style={{ fontSize: "16px" }} aria-hidden />Generate & save {selectedSkillIds.length} skill{selectedSkillIds.length !== 1 ? "s" : ""} to database</>
            }
          </button>

          <p style={{ margin: "10px 0 0", fontSize: "11px", color: "var(--text-faint)", textAlign: "center" }}>
            This document is already visible in your library, marked "Not saved yet" — you can return to review it anytime even without saving now.
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════
          STEP: SAVED
      ══════════════════════════════════════════ */}
      {step === "saved" && savedSummary && (
        <div style={{
          background: "#000", border: "2px solid #000",
          borderRadius: "14px", padding: "2.5rem", textAlign: "center",
        }}>
          <div style={{
            width: "66px", height: "66px", borderRadius: "50%", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <i className="ti ti-circle-check" style={{ fontSize: "34px", color: "#000" }} aria-hidden />
          </div>
          <p style={{ margin: "0 0 6px", fontSize: "19px", fontWeight: 800, color: "#fff" }}>
            Skills saved to database
          </p>
          <p style={{ margin: "0 0 24px", fontSize: "13px", color: "rgba(255,255,255,0.75)" }}>
            Doc ID: <code style={{ fontSize: "11px", background: "#fff", color: "#000", padding: "2px 7px", borderRadius: "4px" }}>{docId}</code>
          </p>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "12px", marginBottom: "28px", textAlign: "left",
          }}>
            {Object.entries(savedSummary)
              .filter(([key]) => key !== "confidence_stats")
              .map(([col, count]) => (
                <div key={col} style={{
                  background: "#fff", borderRadius: "10px", padding: "13px 15px",
                }}>
                  <p style={{ margin: "0 0 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)" }}>
                    {col.replace(/_/g, " ")}
                  </p>
                  <p style={{ margin: 0, fontSize: "25px", fontWeight: 800, color: "#000" }}>{count}</p>
                </div>
              ))}

            {savedSummary.confidence_stats && (
              <div style={{
                background: "#fff", borderRadius: "10px", padding: "13px 15px",
                gridColumn: "span 2",
              }}>
                <p style={{ margin: "0 0 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)" }}>
                  Confidence Stats
                </p>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "4px" }}>
                  <span style={{ fontSize: "12px", color: "#000" }}>
                    Mean: <strong>{(savedSummary.confidence_stats.mean * 100).toFixed(1)}%</strong>
                  </span>
                  <span style={{ fontSize: "12px", color: "#000" }}>
                    Min: <strong>{(savedSummary.confidence_stats.min * 100).toFixed(1)}%</strong>
                  </span>
                  <span style={{ fontSize: "12px", color: "#000" }}>
                    Max: <strong>{(savedSummary.confidence_stats.max * 100).toFixed(1)}%</strong>
                  </span>
                  <span style={{ fontSize: "12px", color: "#000" }}>
                    Skills: <strong>{savedSummary.confidence_stats.count}</strong>
                  </span>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => { setMode("list"); setStep("upload"); }}
              style={{
                padding: "11px 26px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em",
                borderRadius: "8px", cursor: "pointer",
                background: "transparent", color: "#fff", border: "2px solid #fff",
              }}
            >
              <i className="ti ti-library" style={{ marginRight: "6px", fontSize: "14px" }} aria-hidden />
              View library
            </button>
            <button
              onClick={handleReset}
              style={{
                padding: "11px 26px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em",
                borderRadius: "8px", cursor: "pointer", background: "#fff", color: "#000", border: "2px solid #fff",
              }}
            >
              <i className="ti ti-plus" style={{ marginRight: "6px", fontSize: "14px" }} aria-hidden />
              Upload another
            </button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {/* Edit modal */}
      {editingSkill && (
        <EditModal skill={editingSkill} onSave={handleEditSave} onClose={() => setEditingSkill(null)} />
      )}
      {editingMarkdownSkill && (
        <MarkdownEditModal
          skill={editingMarkdownSkill}
          fetchUrl={API_ENDPOINTS.previewSkillMarkdown(doctorId, docId, editingMarkdownSkill.skill_id)}
          saveUrl={API_ENDPOINTS.previewSkillMarkdown(doctorId, docId, editingMarkdownSkill.skill_id)}
          onSaved={(skillId, updatedBody) => {
            setPreview(prev => prev && ({
              ...prev,
              skills_preview: (prev.skills_preview || []).map(s =>
                s.skill_id === skillId ? { ...s, body: updatedBody } : s
              ),
            }));
            setPipelineResult(prev => prev && ({
              ...prev,
              skills: (prev.skills || []).map(s =>
                s.skill_id === skillId ? { ...s, body: updatedBody } : s
              ),
            }));
            setEditingMarkdownSkill(null);
          }}
          onClose={() => setEditingMarkdownSkill(null)}
        />
      )}
    </Wrapper>
  );
}