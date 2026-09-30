/**
 * radiationApi.js — Frontend client for the Radiation Oncology Intelligence agents.
 *
 * Talks to the FastAPI backend (radiation_onc_workflow/api.py). The dashboard uses
 * exactly two operations, each a SINGLE backend call that fans out server-side:
 *   loadDashboard()       → page visit: load-or-generate ALL modules in one request
 *   regenerateDashboard() → "Regenerate" button: run ALL modules fresh in one request
 *
 * The set of live modules is owned entirely by the backend REGISTRY. The frontend
 * keeps NO per-agent list, so a newly built agent shows up automatically with no edit
 * to this file. The backend returns a moduleId→envelope map; a module the backend
 * omits simply keeps its frozen placeholder values in the JSX.
 *
 * The backend persists every generation in the `radiation_onco_agentic` collection, so
 * loads are cheap and history is kept silently. Each module envelope is:
 *   { status, cached, version, generatedAt, data: { moduleId, slug, num, title,
 *     status, summary, rows: [{param, finding, ref, status, statusLabel, action}], meta } }
 *
 * This file overlays VALUES only — it never changes the frozen dashboard structure.
 */

const RAW_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_BACKEND_URL) ||
  "https://doctorassist.ai/api/";

const BASE = String(RAW_BASE).replace(/\/+$/, "");
const ROOT = `${BASE}/hms/users/ai-legacy/radiotherapyagents`;

async function handle(res) {
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.detail || "";
    } catch {
      /* body not JSON */
    }
    throw new Error(`Radiation API ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

function query({ patientId, doctorId } = {}) {
  const q = new URLSearchParams();
  if (patientId) q.set("patientId", patientId);
  if (doctorId) q.set("doctorId", doctorId);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Load latest saved generation for one module (generates on first-ever visit). */
export async function loadModule(slug, ctx = {}) {
  return handle(await fetch(`${ROOT}/module/${slug}${query(ctx)}`));
}

/** Regenerate one module — runs the agent and stores a new version. */
export async function regenerateModule(slug, ctx = {}) {
  return handle(
    await fetch(`${ROOT}/module/${slug}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: ctx.patientId ?? null,
        doctorId: ctx.doctorId ?? null,
      }),
    })
  );
}

/** Version history for a module (metadata only). */
export async function moduleHistory(slug, ctx = {}) {
  return handle(await fetch(`${ROOT}/module/${slug}/history${query(ctx)}`));
}

/**
 * Load the WHOLE dashboard in a SINGLE backend call. The backend runs every
 * registered agent and returns them keyed by dashboard moduleId, plus a `header`
 * summary block (patient strip + KPI values):
 *   { modules: { m1: {...}, m9: {...} }, header: { patientStrip, kpis, generatedAt } }
 * Which modules are live is decided entirely by the backend REGISTRY — the frontend
 * keeps no per-agent list, so new agents appear here with no change to this file.
 * A module the backend omits simply keeps its frozen values in the JSX; likewise a
 * missing/blank header value keeps the frozen "Not available" placeholder.
 */
export async function loadDashboard(ctx = {}) {
  const body = await handle(await fetch(`${ROOT}/dashboard${query(ctx)}`));
  return { modules: body?.modules || {}, header: body?.header || null };
}

/**
 * Regenerate the WHOLE dashboard in a SINGLE backend call — runs every registered
 * agent fresh and stores a new version each. Returns the same { modules, header } shape.
 */
export async function regenerateDashboard(ctx = {}) {
  const body = await handle(
    await fetch(`${ROOT}/dashboard/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: ctx.patientId ?? null,
        doctorId: ctx.doctorId ?? null,
      }),
    })
  );
  return { modules: body?.modules || {}, header: body?.header || null };
}
