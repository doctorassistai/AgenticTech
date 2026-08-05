import { useRef, useState, useCallback, useEffect } from "react";
import { useAnnotations } from "./AnnotationContext";

// ─── Color palette for annotations ───────────────────────────────────────────
export const ANNOTATION_COLORS = {
  yellow: {
    bg: "#fef9c3",
    border: "#fde047",
    text: "#713f12",
    popoverBg: "#fffde7",
    markerBg: "#fef08a",
    label: "Yellow",
  },
  blue: {
    bg: "#dbeafe",
    border: "#93c5fd",
    text: "#1e3a8a",
    popoverBg: "#eff6ff",
    markerBg: "#bfdbfe",
    label: "Blue",
  },
  green: {
    bg: "#dcfce7",
    border: "#86efac",
    text: "#14532d",
    popoverBg: "#f0fdf4",
    markerBg: "#bbf7d0",
    label: "Green",
  },
  red: {
    bg: "#fee2e2",
    border: "#fca5a5",
    text: "#7f1d1d",
    popoverBg: "#fff5f5",
    markerBg: "#fecaca",
    label: "Red",
  },
};

// ─── Popover: shown on text selection ────────────────────────────────────────
function SelectionPopover({ position, onAdd, onDismiss, selectedText }) {
  const [note, setNote] = useState("");
  const [color, setColor] = useState("yellow");
  const textareaRef = useRef(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const handleAdd = () => {
    if (!note.trim()) return;
    onAdd({ note: note.trim(), color });
  };

  // Stop ALL mouse events from bubbling out of the popover
  const stopProp = (e) => e.stopPropagation();

  return (
    <div
      data-ann-popover="true"
      onMouseDown={stopProp}
      onMouseUp={stopProp}
      onClick={stopProp}
      style={{
        position: "absolute",
        left: Math.min(position.x, window.innerWidth - 320),
        top: position.y + 8,
        zIndex: 200,
        width: 288,
        background: "#ffffff",
        border: "0.5px solid rgba(0,0,0,0.18)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        padding: "10px 12px",
        fontFamily: "inherit",
      }}
    >
      {/* Selected text preview */}
      <div style={{
        fontSize: 10,
        color: "#888",
        marginBottom: 6,
        fontStyle: "italic",
        borderLeft: "2px solid #e2e2e2",
        paddingLeft: 6,
        lineHeight: 1.5,
        maxHeight: 36,
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
      }}>
        "{selectedText}"
      </div>

      {/* Note textarea */}
      <textarea
        ref={textareaRef}
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Add reviewer note…"
        onKeyDown={e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); }
  if (e.key === "Escape") onDismiss();
}}
        style={{
          width: "100%",
          minHeight: 60,
          resize: "vertical",
          border: "0.5px solid rgba(0,0,0,0.14)",
          borderRadius: 5,
          padding: "6px 8px",
          fontSize: 11,
          lineHeight: 1.6,
          fontFamily: "inherit",
          color: "#111",
          background: "#fafafa",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {/* Color picker row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 10, color: "#888", marginRight: 2 }}>Color</span>
        {Object.entries(ANNOTATION_COLORS).map(([key, c]) => (
          <button
            key={key}
            title={c.label}
            onClick={() => setColor(key)}
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: c.markerBg,
              border: color === key ? `2px solid ${c.text}` : `1px solid ${c.border}`,
              cursor: "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          />
        ))}
        <span style={{ flex: 1 }} />
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "0.5px solid rgba(0,0,0,0.12)",
            borderRadius: 4,
            padding: "3px 8px",
            fontSize: 10,
            cursor: "pointer",
            color: "#666",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={!note.trim()}
          style={{
            background: note.trim() ? "#111" : "#e5e5e5",
            border: "none",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: 10,
            cursor: note.trim() ? "pointer" : "not-allowed",
            color: note.trim() ? "#fff" : "#999",
            fontFamily: "inherit",
            fontWeight: 500,
          }}
        >
          Add note
        </button>
      </div>
    </div>
  );
}

// ─── Inline sticky marker ─────────────────────────────────────────────────────
function StickyMarker({ annotation, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.note);
  const c = ANNOTATION_COLORS[annotation.color] || ANNOTATION_COLORS.yellow;

  const handleSave = () => {
    onEdit(annotation.id, draft);
    setEditing(false);
  };

  const stopProp = (e) => e.stopPropagation();

  return (
    <span
      style={{ position: "relative", display: "inline" }}
      data-annotation-id={annotation.id}
      onMouseDown={stopProp}
      onMouseUp={stopProp}
    >
      {/* The marker pill */}
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          marginLeft: 1,
          marginRight: 1,
          padding: "0px 4px",
          borderRadius: 99,
          background: c.markerBg,
          border: `0.5px solid ${c.border}`,
          cursor: "pointer",
          fontSize: 10,
          fontWeight: 600,
          color: c.text,
          verticalAlign: "middle",
          lineHeight: 1.6,
          userSelect: "none",
          flexShrink: 0,
        }}
        title={annotation.note}
      >
        <i className="ti ti-note" style={{ fontSize: 10 }} aria-hidden="true" />
      </span>

      {/* Flyout note card */}
      {open && (
        <span
          data-ann-popover="true"
          onMouseDown={stopProp}
          onMouseUp={stopProp}
          onClick={stopProp}
          style={{
            position: "absolute",
            left: "100%",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 100,
            marginLeft: 6,
            background: c.popoverBg,
            border: `0.5px solid ${c.border}`,
            borderRadius: 7,
            boxShadow: "0 3px 12px rgba(0,0,0,0.10)",
            padding: "8px 10px",
            width: 220,
            display: "inline-block",
            fontFamily: "inherit",
          }}
        >
          {/* Selected text ref */}
          <span style={{
            display: "block",
            fontSize: 9,
            color: c.text,
            opacity: 0.6,
            marginBottom: 4,
            borderLeft: `2px solid ${c.border}`,
            paddingLeft: 5,
            fontStyle: "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            "{annotation.selectedText.slice(0, 40)}{annotation.selectedText.length > 40 ? "…" : ""}"
          </span>

          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
                onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(annotation.note); } }}
                style={{
                  width: "100%",
                  minHeight: 54,
                  resize: "vertical",
                  border: "0.5px solid rgba(0,0,0,0.14)",
                  borderRadius: 4,
                  padding: "5px 7px",
                  fontSize: 11,
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  color: "#111",
                  background: "#fff",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
              <span style={{ display: "flex", gap: 5, marginTop: 6 }}>
                <button onClick={() => { setEditing(false); setDraft(annotation.note); }}
                  style={{ flex: 1, background: "none", border: "0.5px solid rgba(0,0,0,0.12)", borderRadius: 4, padding: "3px 0", fontSize: 10, cursor: "pointer", color: "#666", fontFamily: "inherit" }}>
                  Cancel
                </button>
                <button onClick={handleSave}
                  style={{ flex: 1, background: "#111", border: "none", borderRadius: 4, padding: "3px 0", fontSize: 10, cursor: "pointer", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>
                  Save
                </button>
              </span>
            </>
          ) : (
            <>
              <span style={{
                display: "block",
                fontSize: 11,
                color: c.text,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                marginBottom: 6,
              }}>
                {annotation.note}
              </span>
              <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: 9, color: c.text, opacity: 0.5, flex: 1 }}>
                  {annotation.updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  onClick={() => { setEditing(true); setDraft(annotation.note); }}
                  style={{ background: "none", border: "0.5px solid rgba(0,0,0,0.10)", borderRadius: 4, padding: "2px 7px", fontSize: 9, cursor: "pointer", color: c.text, fontFamily: "inherit" }}
                  title="Edit note"
                >
                  <i className="ti ti-edit" style={{ fontSize: 10 }} aria-hidden="true" /> Edit
                </button>
                <button
                  onClick={() => { onDelete(annotation.id); setOpen(false); }}
                  style={{ background: "none", border: "0.5px solid rgba(200,50,50,0.2)", borderRadius: 4, padding: "2px 7px", fontSize: 9, cursor: "pointer", color: "#b91c1c", fontFamily: "inherit" }}
                  title="Delete note"
                >
                  <i className="ti ti-trash" style={{ fontSize: 10 }} aria-hidden="true" />
                </button>
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

// ─── Main: AnnotatableContent ─────────────────────────────────────────────────
export default function AnnotatableContent({ html, blockIndex }) {
  const wrapperRef = useRef(null);   // outer div (position:relative)
  const contentRef = useRef(null);   // the dangerouslySetInnerHTML div
  const popoverOpen = useRef(false); // true while selection popover is visible

  const { addAnnotation, updateAnnotation, deleteAnnotation, getAnnotationsForBlock } = useAnnotations();
  const annotations = getAnnotationsForBlock(blockIndex);

  const [pendingSelection, setPendingSelection] = useState(null);

  // ── Re-inject highlight marks whenever annotations or html changes ─────────
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    // Strip previous highlights (unwrap them so text is clean)
    el.querySelectorAll("[data-ann-highlight]").forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });

    annotations.forEach(ann => {
      const searchText = ann.selectedText;
      if (!searchText?.trim()) return;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      let found = false;
      while ((node = walker.nextNode()) && !found) {
        const idx = node.textContent.indexOf(searchText);
        if (idx === -1) continue;
        if (node.parentElement?.closest("[data-ann-highlight]")) continue;

        try {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + searchText.length);
          const c = ANNOTATION_COLORS[ann.color] || ANNOTATION_COLORS.yellow;
          const mark = document.createElement("mark");
          mark.setAttribute("data-ann-highlight", ann.id);
          mark.style.cssText = `background:${c.bg};border-bottom:2px solid ${c.border};border-radius:2px;padding:0 1px;color:inherit;cursor:pointer;`;
          range.surroundContents(mark);
          found = true;
        } catch {
          // cross-element range — skip gracefully
        }
      }
    });
  }, [annotations, html]);

  // ── mouseup on the content div → capture selection ────────────────────────
  const handleMouseUp = useCallback((e) => {
    // If the click was inside an existing marker or popover, do nothing
    if (e.target.closest("[data-annotation-id]") || e.target.closest("[data-ann-popover]")) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const selectedText = range.toString().trim();

    if (!selectedText || selectedText.length < 2) {
      // Only dismiss if popover isn't open
      if (!popoverOpen.current) setPendingSelection(null);
      return;
    }

    // Confirm selection is within the content div
    if (!contentRef.current?.contains(range.commonAncestorContainer)) return;

    const rect = range.getBoundingClientRect();
    const wRect = wrapperRef.current.getBoundingClientRect();

    popoverOpen.current = true;
    setPendingSelection({
      range: range.cloneRange(),
      selectedText,
      position: {
        x: rect.left - wRect.left,
        y: rect.bottom - wRect.top,
      },
    });
  }, []);

  // ── Global mousedown → dismiss popover only when clicking outside ─────────
  useEffect(() => {
    const handler = (e) => {
  if (!popoverOpen.current) return;
  if (e.target.closest("[data-ann-popover]") || e.target.closest("[data-annotation-id]")) return;
  popoverOpen.current = false;
  setPendingSelection(null);
  // do NOT call removeAllRanges here — it kills the next selection drag
};
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleAdd = useCallback(({ note, color }) => {
    if (!pendingSelection) return;
    addAnnotation({
      blockIndex,
      selectedText: pendingSelection.selectedText,
      range: pendingSelection.range,
      note,
      color,
    });
    popoverOpen.current = false;
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [pendingSelection, addAnnotation, blockIndex]);

const handleDismiss = useCallback(() => {
  popoverOpen.current = false;
  setPendingSelection(null);
}, []);

  return (
    <div ref={wrapperRef} style={{ position: "relative", userSelect: "text", WebkitUserSelect: "text" }}>
      {/* Document HTML */}
      <div
        ref={contentRef}
        className="raw-doc-wrap"
        style={{ fontSize: 12, lineHeight: 1.75, color: "#555550", userSelect: "text", WebkitUserSelect: "text" }}
        dangerouslySetInnerHTML={{ __html: html }}
        onMouseUp={handleMouseUp}
      />

      {/* Sticky note markers — floated via ResizeObserver-tracked positions */}
      {annotations.map(ann => {
        const highlightEl = contentRef.current?.querySelector(`[data-ann-highlight="${ann.id}"]`);
        if (!highlightEl) return null;
        return (
          <AnnotationMarkerPortal
            key={ann.id}
            ann={ann}
            highlightEl={highlightEl}
            containerRef={wrapperRef}
            onEdit={updateAnnotation}
            onDelete={deleteAnnotation}
          />
        );
      })}

      {/* Selection popover */}
      {pendingSelection && (
        <SelectionPopover
          position={pendingSelection.position}
          selectedText={pendingSelection.selectedText}
          onAdd={handleAdd}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}

// ─── Marker portal: positions the sticky pill next to its highlight ───────────
function AnnotationMarkerPortal({ ann, highlightEl, containerRef, onEdit, onDelete }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!highlightEl || !containerRef.current) return;
    const update = () => {
      const hRect = highlightEl.getBoundingClientRect();
      const cRect = containerRef.current.getBoundingClientRect();
      setPos({
        top: hRect.top - cRect.top + hRect.height / 2 - 8,
        left: hRect.right - cRect.left + 4,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [highlightEl, containerRef]);

  if (!pos) return null;

  return (
    <div style={{ position: "absolute", top: pos.top, left: pos.left, zIndex: 50, pointerEvents: "all" }}>
      <StickyMarker
        annotation={ann}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}