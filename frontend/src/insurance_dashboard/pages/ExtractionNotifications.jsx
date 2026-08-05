import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
 * ExtractionNotificationProvider
 *
 * WHERE TO MOUNT THIS: at your App root, ABOVE <Routes>/<Router> — e.g.:
 *
 *   import { ExtractionNotificationProvider } from "./ExtractionNotifications";
 *
 *   function App() {
 *     return (
 *       <ExtractionNotificationProvider>
 *         <BrowserRouter>
 *           <Routes>
 *             ...your existing routes, including AuditingDoctorReview and
 *             the PDF editor page...
 *           </Routes>
 *         </BrowserRouter>
 *       </ExtractionNotificationProvider>
 *     );
 *   }
 *
 * This is what makes the toast survive navigating from the case list to the
 * PDF editor mid-extraction — the poll lives above both routes, so it never
 * unmounts when either page does.
 *
 * WHY IT WORKS ACROSS RELOADS TOO: "seen" event ids are persisted to
 * localStorage, so a page refresh won't re-toast something already shown,
 * but a genuinely new completion (even one that finished while the tab was
 * closed, within the backend's 15-minute event window) will still show up.
 * ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = import.meta.env.VITE_BACKEND_URL;
const b = (BASE_URL || "").replace(/\/$/, "");

const SEEN_KEY = "extraction_seen_event_ids_v1";
const POLL_MS = 5000;
const TOAST_MS = 8000;

function loadSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  try {
    // Cap stored ids so this doesn't grow forever across months of use.
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    /* ignore quota errors */
  }
}

const ExtractionContext = createContext(null);

/**
 * useExtractionEvents() gives any component:
 *  - activeCaseIds: Set<caseId>            — currently extracting
 *  - eventsByCaseId: { [caseId]: event }    — latest finished event per case
 *  - eventsByDocId:  { [docId]: event }     — latest finished event per doc
 * Throws if used outside the provider, so you'll notice immediately if the
 * provider isn't mounted yet at your App root.
 */
export function useExtractionEvents() {
  const ctx = useContext(ExtractionContext);
  if (!ctx) {
    throw new Error(
      "useExtractionEvents() must be used inside <ExtractionNotificationProvider>. " +
      "Mount the provider once at your App root, above your <Routes>."
    );
  }
  return ctx;
}

export function ExtractionNotificationProvider({ children }) {
  const [activeCaseIds, setActiveCaseIds] = useState(() => new Set());
  const [eventsByCaseId, setEventsByCaseId] = useState({});
  const [eventsByDocId, setEventsByDocId] = useState({});
  const [toasts, setToasts] = useState([]);
  const seenRef = useRef(loadSeen());

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((event) => {
    const id = event.task_id;
    setToasts((prev) => [...prev, { id, event }]);
    setTimeout(() => dismissToast(id), TOAST_MS);
  }, [dismissToast]);

  useEffect(() => {
    const doctorId = localStorage.getItem("user_id") || "";
    if (!doctorId) return;
    let cancelled = false;

    const poll = () => {
      fetch(`${b}/insurance/web/advanced-upload/active-tasks`, {
        headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
      })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setActiveCaseIds(new Set(d.active_case_ids || []));

          const events = d.events || [];
          if (events.length === 0) return;

          setEventsByCaseId((prev) => {
            const next = { ...prev };
            for (const ev of events) {
              const existing = next[ev.case_id];
              if (!existing || new Date(ev.completed_at) >= new Date(existing.completed_at)) {
                next[ev.case_id] = ev;
              }
            }
            return next;
          });

          setEventsByDocId((prev) => {
            const next = { ...prev };
            for (const ev of events) next[ev.doc_id] = ev;
            return next;
          });

          const fresh = events.filter((ev) => ev.task_id && !seenRef.current.has(ev.task_id));
          if (fresh.length > 0) {
            fresh.forEach((ev) => {
              seenRef.current.add(ev.task_id);
              pushToast(ev);
            });
            saveSeen(seenRef.current);
          }
        })
        .catch(() => {}); // stay quiet — this is a background convenience poll
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pushToast]);

  return (
    <ExtractionContext.Provider value={{ activeCaseIds, eventsByCaseId, eventsByDocId }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </ExtractionContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: 320,
      }}
    >
      {toasts.map(({ id, event }) => {
        const isSuccess = event.status === "success";
        return (
          <div
            key={id}
            onClick={() => onDismiss(id)}
            style={{
              cursor: "pointer",
              background: "#fff",
              border: `1px solid ${isSuccess ? "#2e7d32" : "#d32f2f"}`,
              borderLeft: `4px solid ${isSuccess ? "#2e7d32" : "#d32f2f"}`,
              boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
              padding: "10px 12px",
              fontFamily: "'Open Sans', sans-serif",
              animation: "extraction-toast-in 0.18s ease-out",
            }}
          >
            <style>{`@keyframes extraction-toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: isSuccess ? "#2e7d32" : "#d32f2f",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {isSuccess ? "Extraction finished" : "Extraction failed"}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#000", marginTop: 3 }}>
              {event.insurer_ref || event.case_id} · {event.insurer || "—"}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
              {event.claimant_name ? `${event.claimant_name} — ` : ""}
              {isSuccess
                ? `${event.fields_found ?? 0} field(s) merged from ${event.display_label || event.file_name}.`
                : (event.error || "See the document card for details.")}
            </div>
          </div>
        );
      })}
    </div>
  );
}