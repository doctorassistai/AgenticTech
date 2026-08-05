import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

// ─── Context (exported so PDFEditorPage can consume it directly) ──────────────
export const AnnotationContext = createContext(null);

// Stable anchor key for a range
function makeAnchorKey(range) {
  try {
    const container = range.commonAncestorContainer;
    const node = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    const text = range.toString().trim().slice(0, 60);
    const offset = range.startOffset;
    return `${node.tagName || "?"}::${offset}::${text}`;
  } catch {
    return `fallback::${Date.now()}`;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function AnnotationProvider({ caseId, children }) {
  const storageKey = caseId ? `reviewer-annotations:${caseId}` : "reviewer-annotations";

  const [annotations, setAnnotations] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return [];
      return JSON.parse(saved).map(a => ({
        ...a,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
      }));
    } catch { return []; }
  });
  const idRef = useRef(Date.now());

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(annotations));
  }, [annotations, storageKey]);

  const addAnnotation = useCallback(({ blockIndex, selectedText, range, note, color = "yellow" }) => {
    const id = `ann-${idRef.current++}`;
    const anchorKey = makeAnchorKey(range);
    setAnnotations(prev => [
      ...prev,
      { id, blockIndex, selectedText, anchorKey, note, color,
        createdAt: new Date(), updatedAt: new Date() },
    ]);
    return id;
  }, []);

  const updateAnnotation = useCallback((id, note) => {
    setAnnotations(prev =>
      prev.map(a => a.id === id ? { ...a, note, updatedAt: new Date() } : a)
    );
  }, []);

  const deleteAnnotation = useCallback((id) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  const getAnnotationsForBlock = useCallback((blockIndex) =>
    annotations.filter(a => a.blockIndex === blockIndex),
    [annotations]
  );

  return (
    <AnnotationContext.Provider value={{
      annotations,
      addAnnotation,
      updateAnnotation,
      deleteAnnotation,
      getAnnotationsForBlock,
    }}>
      {children}
    </AnnotationContext.Provider>
  );
}

export function useAnnotations() {
  const ctx = useContext(AnnotationContext);
  if (!ctx) throw new Error("useAnnotations must be used inside <AnnotationProvider>");
  return ctx;
}