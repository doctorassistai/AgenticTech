// rheumatologyContextBus.js
// Shared pub/sub: any Rheumatology module announces "I just saved data",
// any other module silently re-checks its context-preview/gating state.

export const RHEUM_CONTEXT_EVENT = "rheumatologyContextUpdated";

export function announceRheumContextUpdate(source) {
  window.dispatchEvent(new CustomEvent(RHEUM_CONTEXT_EVENT, { detail: { source } }));
}

export function subscribeRheumContextUpdate(callback) {
  const handler = () => callback();
  window.addEventListener(RHEUM_CONTEXT_EVENT, handler);
  return () => window.removeEventListener(RHEUM_CONTEXT_EVENT, handler);
}