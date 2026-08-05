import { useState, useCallback } from "react";
import { useAnnotations } from "./AnnotationContext";
import { ANNOTATION_COLORS } from "./AnnotatableContent";

function AnnotationRow({ ann, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ann.note);
  const [hovered, setHovered] = useState(false);
  const c = ANNOTATION_COLORS[ann.color] || ANNOTATION_COLORS.yellow;

  const handleSave = () => {
    onEdit(ann.id, draft.trim() || ann.note);
    setEditing(false);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "8px 10px", borderRadius: 6,
        background: c.bg, border: `0.5px solid ${c.border}`,
        marginBottom: 6, position: "relative",
      }}
    >
      <div style={{
        fontSize: 9, color: c.text, opacity: 0.65,
        borderLeft: `2px solid ${c.border}`, paddingLeft: 5,
        fontStyle: "italic", lineHeight: 1.5, marginBottom: 5,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        "{ann.selectedText.slice(0, 50)}{ann.selectedText.length > 50 ? "…" : ""}"
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
              if (e.key === "Escape") { setEditing(false); setDraft(ann.note); }
            }}
            style={{
              width: "100%", minHeight: 50, resize: "vertical",
              border: "0.5px solid rgba(0,0,0,0.14)", borderRadius: 4,
              padding: "5px 7px", fontSize: 11, lineHeight: 1.6,
              fontFamily: "inherit", color: "#111", background: "#fff",
              boxSizing: "border-box", outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
            <button onClick={() => { setEditing(false); setDraft(ann.note); }}
              style={{ flex: 1, background: "none", border: "0.5px solid rgba(0,0,0,0.12)", borderRadius: 4, padding: "3px 0", fontSize: 10, cursor: "pointer", color: "#555", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button onClick={handleSave}
              style={{ flex: 1, background: c.text, border: "none", borderRadius: 4, padding: "3px 0", fontSize: 10, cursor: "pointer", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: c.text, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", paddingRight: hovered ? 48 : 0 }}>
            {ann.note}
          </div>
          <div style={{ marginTop: 4, fontSize: 9, color: c.text, opacity: 0.45 }}>
            {ann.updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            {ann.updatedAt.getTime() !== ann.createdAt.getTime() ? " · edited" : ""}
          </div>
          {hovered && (
            <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 3 }}>
              <button
                onClick={() => { setEditing(true); setDraft(ann.note); }}
                title="Edit"
                style={{
                  background: "rgba(255,255,255,0.8)", border: `0.5px solid ${c.border}`,
                  borderRadius: 4, width: 22, height: 22,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: c.text,
                }}
              >
                <i className="ti ti-edit" style={{ fontSize: 10 }} />
              </button>
              <button
                onClick={() => onDelete(ann.id)}
                title="Delete"
                style={{
                  background: "rgba(255,255,255,0.8)", border: "0.5px solid #fca5a5",
                  borderRadius: 4, width: 22, height: 22,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#b91c1c",
                }}
              >
                <i className="ti ti-trash" style={{ fontSize: 10 }} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AnnotationsSidebar() {
  const { annotations, updateAnnotation, deleteAnnotation } = useAnnotations();
  const [open, setOpen] = useState(true);

  const T = {
    bg: "#ffffff", bgAlt: "#f9f9f8",
    border: "rgba(0,0,0,0.10)", text: "#111111",
    textSec: "#555550", textMuted: "#999994",
  };

  return (
    <div style={{
      width: open ? 240 : 36, flexShrink: 0,
      borderLeft: `0.5px solid ${T.border}`,
      background: T.bgAlt, display: "flex", flexDirection: "column",
      transition: "width 0.2s", overflow: "hidden", minHeight: 300,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 10px", borderBottom: `0.5px solid ${T.border}`,
        background: T.bg, flexShrink: 0,
      }}>
        <button
          onClick={() => setOpen(o => !o)}
          title={open ? "Collapse notes" : "Expand notes"}
          style={{ background: "none", border: "none", cursor: "pointer", color: T.textSec, padding: 0, fontSize: 14, display: "flex", alignItems: "center" }}
        >
          <i className={`ti ${open ? "ti-layout-sidebar-right-collapse" : "ti-layout-sidebar-right-expand"}`} aria-hidden="true" />
        </button>
        {open && (
          <>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.text, letterSpacing: "0.04em" }}>
              Reviewer notes
            </span>
            {annotations.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, background: "#111", color: "#fff", borderRadius: 99, padding: "1px 6px", marginLeft: 2 }}>
                {annotations.length}
              </span>
            )}
          </>
        )}
      </div>

      {open && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
          {annotations.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center" }}>
              <i className="ti ti-note-off" style={{ fontSize: 22, color: T.textMuted }} aria-hidden="true" />
              <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
                Select any text in a document to add a reviewer note.
              </div>
            </div>
          ) : (
            annotations.map(ann => (
              <AnnotationRow
                key={ann.id}
                ann={ann}
                onEdit={updateAnnotation}
                onDelete={deleteAnnotation}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}