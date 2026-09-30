// shared/cascade.js — CLSI M100 cascade + intrinsic-resistance engine for Tab 5C
//
// Pure, deterministic (no model). Given the confirmed organism and the AST rows
// the tech recorded, it decides which antibiotics are REPORTED and which are
// SUPPRESSED from the final report:
//
//   • Intrinsic resistance (per group/species, e.g. Klebsiella + Ampicillin)
//     → suppressed automatically; the row is still stored.
//   • Urine-only agents (e.g. Nitrofurantoin) are reported only for a urine
//     specimen — suppressed on any other specimen.
//   • Cascade tiering: agents are ordered in each panel from narrowest/first-line
//     to broadest. If a tested first-line (lower index) agent reads S, the broader
//     (higher index) agents that were also tested are suppressed from the report —
//     unless the microbiologist overrides with a documented reason.
//
// The catalogue (organism classification + per-group/per-species panels) lives in
// ./astData.js — the engine here is the contract and does not change when panels
// grow. Unclassified organisms / untested agents simply report nothing suppressed.

import { AST_PROFILES, canonicalAntibiotic } from "./astData";

const EMPTY_PROFILE = { key: "", label: "", agents: [], intrinsic: [], urineOnly: [], qcOrganisms: [] };
const isUrineSpecimenType = (t) => /urine/i.test(String(t || ""));

// Resolve an organism name (+ optional specimen type) to its AST profile.
// A species key that appears in the name narrows the family panel (see astData.js).
export function resolveAstProfile(organism = "", specimenType = "") {
  const name = String(organism || "").trim().toLowerCase();
  if (!name) return { ...EMPTY_PROFILE };

  const group = AST_PROFILES.find((g) => g.match.test(String(organism)));
  if (!group) return { ...EMPTY_PROFILE };

  const panel = { ...(group.panel || {}) };
  if (group.species) {
    const overrideKey = Object.keys(group.species).find((spKey) => name.includes(spKey));
    if (overrideKey) Object.assign(panel, group.species[overrideKey]);
  }

  return {
    key: group.key || "",
    label: group.label || "",
    agents: Array.isArray(panel.agents) ? panel.agents : [],
    intrinsic: Array.isArray(panel.intrinsic) ? panel.intrinsic : [],
    urineOnly: Array.isArray(panel.urine_only) ? panel.urine_only : [],
    qcOrganisms: Array.isArray(panel.qc_organisms) ? panel.qc_organisms : [],
  };
}

// Suggested agents for the "+ Suggested" quick-add: the profile's panel, with the
// urine-only drugs appended only when the specimen is urine.
export function suggestedPanel(organism = "", specimenType = "") {
  const p = resolveAstProfile(organism, specimenType);
  return isUrineSpecimenType(specimenType) ? [...p.agents, ...p.urineOnly] : p.agents;
}

// Family/group label for display (thin wrapper over the profile).
export function classifyOrganismGroup(organism = "") {
  return resolveAstProfile(organism).label;
}

// Normalise a recorded antibiotic to its canonical catalogue name (alias-aware).
export function normalizeAntibiotic(name) {
  return canonicalAntibiotic(name) || String(name || "").trim();
}

// ─── Cascade application ──────────────────────────────────────────────────────
//
// profile: a resolved profile from resolveAstProfile (or an organism string).
// rows:    [{ antibiotic, interpretation: "S"|"I"|"R"|"", override_reason }]
// opts:    { specimenType } so urine-only agents can be filtered by site.
// Returns per-row status for display: "reported" | "suppressed".
export function applyCascade(profile, rows, opts = {}) {
  const p = (profile && typeof profile === "object" && Array.isArray(profile.agents))
    ? profile
    : EMPTY_PROFILE;
  const isUrine = isUrineSpecimenType(opts && opts.specimenType);

  const agents = p.agents || [];
  const norm = (label) => {
    const canon = canonicalAntibiotic(label) || String(label || "").trim();
    return canon.toLowerCase();
  };
  const intrinsicNorm = new Set((p.intrinsic || []).map(norm));
  const urineNorm = new Set((p.urineOnly || []).map(norm));

  const agentIndexOf = (label) => agents.findIndex((a) => norm(a) === norm(label));

  return (rows || []).map((row) => {
    const abx = row.antibiotic || "";
    const interp = (row.interpretation || "").toUpperCase();
    const idx = agentIndexOf(abx);
    const abxNorm = norm(abx);

    // Intrinsic resistance: automatic suppression (never reported as tested-S).
    if (intrinsicNorm.has(abxNorm)) {
      return {
        ...row,
        cascade_status: "suppressed",
        cascade_reason: "Intrinsic resistance — suppressed automatically (CLSI M100)",
        reported: false,
      };
    }

    // Urine-only agent on a non-urine specimen: not reportable at this site.
    if (urineNorm.has(abxNorm) && !isUrine) {
      return {
        ...row,
        cascade_status: "suppressed",
        cascade_reason: "Urine-only agent — not reported for this specimen",
        reported: false,
      };
    }

    // Untested / non-panel agent: nothing cascades.
    if (idx < 0) {
      return { ...row, cascade_status: "reported", cascade_reason: "", reported: true };
    }

    // If any lower-index (first-line relative) agent reads S, suppress this row.
    let suppressedBy = "";
    for (let j = 0; j < idx; j++) {
      const lower = (rows || []).find((r) => norm(r.antibiotic) === norm(agents[j]));
      if (lower && (lower.interpretation || "").toUpperCase() === "S") {
        suppressedBy = agents[j];
        break;
      }
    }

    if (suppressedBy && !row.override_reason) {
      return {
        ...row,
        cascade_status: "suppressed",
        cascade_reason: `Suppressed — ${suppressedBy} susceptible (cascade, CLSI M100)`,
        reported: false,
      };
    }
    if (suppressedBy && row.override_reason) {
      return {
        ...row,
        cascade_status: "reported",
        cascade_reason: `Released — override: ${row.override_reason}`,
        reported: true,
      };
    }

    return { ...row, cascade_status: "reported", cascade_reason: "", reported: true };
  });
}
